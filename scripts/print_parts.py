"""Split the logo-pose reindeer into two hollow, millimetre-scaled parts for FDM printing.

blender --background model/reindeer.blend --python-exit-code 1 --python scripts/print_parts.py
Append: -- --output-dir DIR --sizes test,full --test-height 150 --full-scale 25

The master is not modified. The cut follows the level mouth line of the logo pose; both
parts print cut face down (the neck part upside down). The neck and the cranium are hollow,
open at the cut for an LED string, with a magnet pocket, a rear wire hole and blind holes
for 1.75 mm filament dowels. Outer facets come from exact booleans; the hidden cavity is
meshed from a distance field so wall thickness and 45-degree roofs can be enforced.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
import numpy as np
import openvdb as vdb
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export  # noqa: E402

ROOT = export.ROOT
CONFIG = export.CONFIG

# Lengths in millimetres unless named *_design (normalized model units).
PARAMS = dict(
    cut_z_design=5.5,        # level mouth line, below the ears (lowest at 6.1)
    throat_z_design=4.7,     # neck section under the jaw; the jaw cavity rises 45 degrees from it
    wall=1.6,                # shell thickness; thin enough for frosted PC to glow
    rim=1.2,                 # extra wall at the cut for glue, tapering at 45 degrees
    magnet_diameter=8.0, magnet_height=3.0, magnet_clearance=0.3,
    magnet_floor=1.2,        # between the magnet pocket and the cavity
    magnet_wall=1.6,         # around the pocket; sets how much of the neck tip is cut off
    wire_diameter=3.2,
    dowel_diameter=1.75, dowel_clearance=0.25, dowel_depth=5.0,
    dowel_inset=2.8,         # hole axis distance from the outer surface at the cut
    dowel_boss=3.2,          # solid radius around each hole inside the cavity
    keep_out=3.0,            # solid around the buried antler and ear roots
    bed=176.0,               # Prusa Mini 180 mm cube, less margin
    test_height=150.0,
)


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'build' / 'print')
    parser.add_argument('--sizes', default='test,full')
    parser.add_argument('--test-height', type=float, default=PARAMS['test_height'])
    parser.add_argument('--full-scale', type=float, help='mm per model unit; default fits the bed')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def mesh_arrays(data):
    data.calc_loop_triangles()
    verts = np.array([v.co[:] for v in data.vertices], dtype=np.float64)
    tris = np.array([t.vertices[:] for t in data.loop_triangles], dtype=np.int64)
    return verts, tris


def posed_arrays(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    data = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    try:
        data.transform(evaluated.matrix_world)
        return mesh_arrays(data)
    finally:
        bpy.data.meshes.remove(data)


def level_set(verts, tris, voxel, half_width):
    return vdb.FloatGrid.createLevelSetFromPolygons(
        verts.astype(np.float32), triangles=tris.astype(np.uint32),
        transform=vdb.createLinearTransform(voxel), halfWidth=half_width)


def dense(grid, origin, shape):
    array = np.zeros(shape, dtype=np.float32)
    grid.copyToArray(array, ijk=tuple(int(i) for i in origin))
    return array


def distance_to(targets, voxel):
    """2D distance from every cell to the nearest True cell of `targets` (0 inside)."""
    edge = targets & ~(np.roll(targets, 1, 0) & np.roll(targets, -1, 0) &
                       np.roll(targets, 1, 1) & np.roll(targets, -1, 1))
    points = np.argwhere(edge).astype(np.float64)
    result = np.zeros(targets.shape)
    if len(points) == 0:
        result[:] = np.inf
        return result
    cells = np.argwhere(~targets).astype(np.float64)
    best = np.empty(len(cells))
    for start in range(0, len(cells), 2048):
        chunk = cells[start:start + 2048]
        best[start:start + 2048] = np.sqrt(
            ((chunk[:, None, :] - points[None, :, :]) ** 2).sum(-1).min(1))
    result[~targets] = best * voxel
    return result


def flood(void, seed):
    reached = seed & void
    while True:
        grown = reached.copy()
        grown[1:] |= reached[:-1]
        grown[:-1] |= reached[1:]
        grown[:, 1:] |= reached[:, :-1]
        grown[:, :-1] |= reached[:, 1:]
        grown[:, :, 1:] |= reached[:, :, :-1]
        grown[:, :, :-1] |= reached[:, :, 1:]
        grown &= void
        if grown.sum() == reached.sum():
            return reached
        reached = grown


def unsupported_voxels(void, solid, upward):
    """Count solid voxels with no solid within 1 or 2 cells one layer lower (in print)."""
    if not upward:
        void, solid = void[:, :, ::-1], solid[:, :, ::-1]
    result = {}
    for reach in (1, 2):
        below = void[:, :, :-1].copy()
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                below &= np.roll(np.roll(void[:, :, :-1], dx, 0), dy, 1)
        flagged = solid[:, :, 1:] & below
        result[f'unsupported_beyond_{reach}_voxels'] = int(flagged.sum())
    return result


def depth_profile(verts, tris):
    """Largest inscribed distance per height near the neck tip, in model units."""
    voxel = 0.02
    grid = level_set(verts, tris, voxel, 75)
    low = verts[:, 2].min()
    keep = verts[:, 2] < low + 2.0
    origin = np.floor(verts[keep].min(0) / voxel).astype(int) - 2
    top = np.ceil(verts[keep].max(0) / voxel).astype(int) + 2
    phi = dense(grid, origin, top - origin)
    heights = (origin[2] + np.arange(phi.shape[2])) * voxel
    return heights, np.maximum(0.0, -phi.min(axis=(0, 1)))


def truncation_height(profile, scale):
    heights, depth = profile
    need = (PARAMS['magnet_diameter'] / 2 + PARAMS['magnet_clearance'] / 2 +
            PARAMS['magnet_wall']) / scale
    index = int(np.argmax(depth >= need))
    if depth[index] < need:
        raise RuntimeError('The neck is too thin for the magnet at this scale.')
    return float(heights[index])


def fit_angle(points):
    """Rotation about Z (degrees) minimizing the larger side of the footprint."""
    best = None
    for degrees in range(0, 90):
        a = math.radians(degrees)
        rotated = points @ np.array([[math.cos(a), math.sin(a)], [-math.sin(a), math.cos(a)]])
        size = rotated.max(0) - rotated.min(0)
        if best is None or size.max() < best[1].max():
            best = (degrees, size)
    return best


def full_scale(verts):
    cut = PARAMS['cut_z_design']
    upper = verts[verts[:, 2] >= cut - 0.05]
    _, footprint = fit_angle(upper[:, :2])
    lower = verts[verts[:, 2] <= cut + 0.05]
    _, lower_footprint = fit_angle(lower[:, :2])
    limit = min(PARAMS['bed'] / footprint.max(),
                PARAMS['bed'] / (verts[:, 2].max() - cut),
                PARAMS['bed'] / (cut - verts[:, 2].min()),
                PARAMS['bed'] / lower_footprint.max())
    return math.floor(limit * 4) / 4


# Blender mesh helpers ------------------------------------------------------------------

def new_object(collection, name, verts, faces):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(map(int, f)) for f in faces])
    data.validate()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    return obj


def cylinder(collection, name, start, end, radius_start, radius_end=None, segments=48):
    start, end = Vector(start), Vector(end)
    axis = end - start
    bm = bmesh.new()
    matrix = (Matrix.Translation((start + end) / 2) @
              axis.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=radius_start,
                          radius2=radius_start if radius_end is None else radius_end,
                          depth=axis.length, matrix=matrix)
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    return obj


def outward(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
    bm.free()


def box(collection, name, low, high):
    low, high = np.array(low), np.array(high)
    corners = [(x, y, z) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return new_object(collection, name, corners, faces)


def boolean(target, cutter, operation):
    modifier = target.modifiers.new(operation.title(), 'BOOLEAN')
    modifier.operation = operation
    modifier.solver = 'MANIFOLD'
    modifier.object = cutter
    depsgraph = bpy.context.evaluated_depsgraph_get()
    result = bpy.data.meshes.new_from_object(target.evaluated_get(depsgraph), depsgraph=depsgraph)
    old = target.data
    target.modifiers.remove(modifier)
    target.data = result
    bpy.data.meshes.remove(old)


def check_solid(obj):
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        seen, components = set(), 0
        for vertex in bm.verts:
            if vertex in seen:
                continue
            components += 1
            pending = [vertex]
            seen.add(vertex)
            while pending:
                for edge in pending.pop().link_edges:
                    for other in edge.verts:
                        if other not in seen:
                            seen.add(other)
                            pending.append(other)
        return dict(components=components,
                    nonmanifold_edges=sum(not e.is_manifold for e in bm.edges),
                    triangles=len(bm.faces),
                    volume_cm3=round(bm.calc_volume() / 1000, 2))
    finally:
        bm.free()


# The parts ----------------------------------------------------------------------------

def choose_dowels(phi, origin, voxel, cut_index, span):
    """Three hole axes near the outer wall, spread wide and unequal so the fit is unique."""
    layer = phi[:, :, cut_index]
    band = (layer < -PARAMS['dowel_inset']) & (layer > -PARAMS['dowel_inset'] - 3.0)
    need = PARAMS['dowel_diameter'] / 2 + PARAMS['dowel_clearance'] / 2 + 1.2
    column = phi[:, :, cut_index - span:cut_index + span + 1].max(axis=2)
    cells = np.argwhere(band & (column < -need))
    if len(cells) < 3:
        raise RuntimeError('No room for dowel holes at the cut.')
    xy = (cells + origin[:2]) * voxel
    first = xy[np.argmin(xy[:, 1])]              # toward the muzzle
    second = xy[np.argmax(np.linalg.norm(xy - first, axis=1))]
    edge = second - first
    area = np.abs(edge[0] * (xy[:, 1] - first[1]) - edge[1] * (xy[:, 0] - first[0]))
    # Unequal sides, so the parts only fit one way round.
    area[np.abs(np.linalg.norm(xy - first, axis=1) - np.linalg.norm(xy - second, axis=1)) < 3.0] = -1
    third = xy[np.argmax(area)]
    chosen = [first, second, third]
    sides = sorted(np.linalg.norm(a - b) for a, b in
                   ((chosen[0], chosen[1]), (chosen[1], chosen[2]), (chosen[2], chosen[0])))
    if min(sides[1] - sides[0], sides[2] - sides[1]) < 2.0:
        print('Warning: dowel triangle is nearly symmetric', sides)
    return [tuple(map(float, p)) for p in chosen], [round(float(s), 1) for s in sides]


def build_size(label, scale, union, extras, profile, collection, output):
    p = PARAMS
    verts_design, tris = union
    verts = verts_design * scale
    body_verts = extras['body'] * scale
    voxel = 0.5 if scale > 20 else 0.35
    half_width = int(math.ceil(14 / voxel))

    z_trunc = truncation_height(profile, scale) * scale
    z_cut = p['cut_z_design'] * scale

    # Dense grid over the head/neck shell; the cavity can only be in there.
    origin = np.floor(body_verts.min(0) / voxel).astype(int) - 4
    top = np.ceil(body_verts.max(0) / voxel).astype(int) + 4
    shape = top - origin
    phi = dense(level_set(verts, tris, voxel, half_width), origin, shape)
    X, Y, Z = np.meshgrid(*((origin[i] + np.arange(shape[i])) * voxel for i in range(3)),
                          indexing='ij', sparse=True)
    cut_index = int(round(z_cut / voxel)) - origin[2]
    dowel_span = int(math.ceil((p['dowel_depth'] + 1.0) / voxel))

    # Magnet axis: the deepest point just above the truncation.
    k = int(round(z_trunc / voxel)) - origin[2] + 1
    i, j = np.unravel_index(np.argmin(phi[:, :, k]), phi.shape[:2])
    magnet = ((origin[0] + i) * voxel, (origin[1] + j) * voxel)

    dowels, dowel_sides = choose_dowels(phi, origin, voxel, cut_index, dowel_span)

    # Shared shell constraint: void where every term is negative.
    h = np.abs(Z - z_cut)
    shell = phi + p['wall'] + np.maximum(0.0, p['rim'] - h)
    boss_radius = p['dowel_boss'] - np.maximum(0.0, h - (p['dowel_depth'] + 1.0))
    for x, y in dowels:
        shell = np.maximum(shell, boss_radius - np.hypot(X - x, Y - y))

    # Neck part, printed upside down: its "roofs" are the cavity floor and the jaw underside.
    z_apex = z_trunc + p['magnet_height'] + p['magnet_clearance'] + p['magnet_floor']
    lower = np.maximum(shell, z_apex + np.hypot(X - magnet[0], Y - magnet[1]) - Z)
    throat = int(round(p['throat_z_design'] * scale / voxel)) - origin[2]
    z_throat = (throat + origin[2]) * voxel
    reach = distance_to(phi[:, :, throat] < 0, voxel)[:, :, None]
    # Start the 45-degree jaw floor high enough that the near-level jaw underside never
    # forms a ceiling: at or above the shell floor in every jaw column.
    jaw = (shell <= 0) & (Z >= z_throat) & (reach > 0)
    has_void = jaw.any(axis=2)
    floor = (origin[2] + jaw.argmax(axis=2)) * voxel
    z_jaw = float(np.max((floor - reach[:, :, 0])[has_void])) if has_void.any() else z_throat
    lower = np.maximum(lower, np.where((Z >= z_throat) & (reach > 0), z_jaw + reach - Z, -np.inf))
    lower[:, :, cut_index + 1:] = np.inf

    # Cranium part, printed upright: keep solid around antler and ear roots, then a hip
    # roof over the opening so no ceiling is flatter than 45 degrees.
    upper = shell.copy()
    for verts_k, tris_k in extras['roots']:
        psi = dense(level_set(verts_k * scale, tris_k, voxel, half_width), origin, shape)
        upper = np.maximum(upper, p['keep_out'] - psi)
    upper[:, :, :cut_index] = np.inf
    # Columns under solid that would hang inside the roofed cavity get no cavity at all.
    obstacle = (upper > 0) & (shell <= 0) & (Z > z_cut)
    footprint = upper[:, :, cut_index] <= 0
    for _ in range(6):
        roof = distance_to(~footprint, voxel)[:, :, None]
        blocked = (obstacle & (Z - z_cut <= roof)).any(axis=2) & footprint
        if not blocked.any():
            break
        footprint &= ~blocked
    upper = np.maximum(upper, Z - z_cut - roof)

    # Light from the neck should pass straight into the head.
    neck_opening = lower[:, :, cut_index] <= 0
    shared = float((neck_opening & (upper[:, :, cut_index] <= 0)).sum() / max(1, neck_opening.sum()))
    parts = {}
    for name, field, upward in (('lower', lower, False), ('upper', upper, True)):
        void = field <= 0
        seed = np.zeros_like(void)
        seed[:, :, cut_index] = void[:, :, cut_index]
        void = flood(void, seed)
        inside = phi < 0
        if name == 'lower':
            inside[:, :, cut_index + 1:] = False
            inside &= Z >= z_trunc
        else:
            inside[:, :, :cut_index] = False
        unsupported = unsupported_voxels(void, inside & ~void, upward)
        # Mesh the cavity, extended a few voxels through the cut so it opens cleanly.
        field = np.clip(np.where(void, field, np.maximum(field, voxel)), -4 * voxel, 4 * voxel)
        extend = range(cut_index + 1, cut_index + 4) if name == 'lower' else range(cut_index - 3, cut_index)
        for index in extend:
            field[:, :, index] = field[:, :, cut_index]
        field[[0, -1], :, :] = field[:, [0, -1], :] = 4 * voxel
        field[:, :, [0, -1]] = 4 * voxel
        grid = vdb.FloatGrid(background=4 * voxel)
        grid.transform = vdb.createLinearTransform(voxel)
        grid.copyFromArray(field.astype(np.float32), ijk=tuple(int(o) for o in origin))
        points, triangles, quads = grid.convertToPolygons(isovalue=0.0, adaptivity=0.3)
        faces = [tuple(t) for t in triangles] + [tuple(q) for q in quads]
        cavity = new_object(collection, f'{label}_{name}_cavity', points, faces)
        outward(cavity)
        parts[name] = dict(cavity=cavity, unsupported_voxels=unsupported,
                           cavity_cm3=round(float(void.sum()) * voxel ** 3 / 1000, 1))

    # Exact outer facets, then the cavities and fittings.
    big = np.abs(verts).max() * 2
    report = dict(scale_mm_per_unit=scale, voxel_mm=voxel,
                  truncated_design_units=round(z_trunc / scale - verts_design[:, 2].min(), 3),
                  total_height_mm=round(verts[:, 2].max() - z_trunc, 1),
                  dowels_xy_mm=[[round(c, 1) for c in d] for d in dowels],
                  dowel_triangle_sides_mm=dowel_sides,
                  neck_opening_open_into_head=round(shared, 3), parts={})
    for name in ('lower', 'upper'):
        solid = new_object(collection, f'{label}_{name}', verts, tris)
        if name == 'lower':
            slab = box(collection, 'slab', (-big, -big, z_trunc), (big, big, z_cut))
        else:
            slab = box(collection, 'slab', (-big, -big, z_cut), (big, big, big))
        boolean(solid, slab, 'INTERSECT')
        boolean(solid, parts[name]['cavity'], 'DIFFERENCE')
        hole_radius = (p['dowel_diameter'] + p['dowel_clearance']) / 2
        for x, y in dowels:
            boolean(solid, cylinder(collection, 'dowel', (x, y, z_cut - p['dowel_depth']),
                                    (x, y, z_cut + p['dowel_depth']), hole_radius, segments=24),
                    'DIFFERENCE')
            # A small countersink keeps elephant's foot out of the hole and holds glue.
            side = -1 if name == 'lower' else 1
            boolean(solid, cylinder(collection, 'chamfer', (x, y, z_cut - 0.3 * side),
                                    (x, y, z_cut + 0.6 * side), hole_radius + 0.8,
                                    hole_radius - 0.1, segments=20), 'DIFFERENCE')
        if name == 'lower':
            pocket_top = z_trunc + p['magnet_height'] + p['magnet_clearance']
            boolean(solid, cylinder(collection, 'magnet', (*magnet, z_trunc - 1), (*magnet, pocket_top),
                                    (p['magnet_diameter'] + p['magnet_clearance']) / 2), 'DIFFERENCE')
            z_wire = z_apex + p['wire_diameter'] / 2 + 1.0
            boolean(solid, cylinder(collection, 'wire', (magnet[0], magnet[1], z_wire),
                                    (magnet[0], verts[:, 1].max() + 5, z_wire),
                                    p['wire_diameter'] / 2, segments=24), 'DIFFERENCE')
            report['magnet_xy_mm'] = [round(c, 1) for c in magnet]
            report['wire_hole_height_mm'] = round(z_wire - z_trunc, 1)
            # Upside down, the cut face on the bed.
            placement = Matrix.Rotation(math.pi, 4, 'X') @ Matrix.Translation((0, 0, -z_cut))
            angle = 0
        else:
            data_xy = np.array([v.co[:2] for v in solid.data.vertices])
            angle, _ = fit_angle(data_xy)
            placement = Matrix.Rotation(math.radians(angle), 4, 'Z') @ Matrix.Translation((0, 0, -z_cut))
        solid.data.transform(placement)
        co = np.array([v.co[:] for v in solid.data.vertices])
        centre = (co.min(0) + co.max(0)) / 2
        solid.data.transform(Matrix.Translation((-centre[0], -centre[1], -co[:, 2].min())))
        co = np.array([v.co[:] for v in solid.data.vertices])
        check = check_solid(solid)
        if check['components'] != 1 or check['nonmanifold_edges']:
            raise RuntimeError(f'{label} {name} failed validation: {check}')
        path = output / f'reindeer-print-{label}-{name}.stl'
        bpy.ops.object.select_all(action='DESELECT')
        solid.select_set(True)
        bpy.context.view_layer.objects.active = solid
        bpy.ops.wm.stl_export(filepath=str(path), export_selected_objects=True,
                              apply_modifiers=False)
        size = co.max(0) - co.min(0)
        report['parts'][name] = dict(
            file=path.name, size_mm=[round(float(s), 1) for s in size],
            rotation_about_z_degrees=angle,
            fits_bed=bool(size.max() <= 180 and size[2] <= 180),
            cavity_cm3=parts[name]['cavity_cm3'],
            **parts[name]['unsupported_voxels'], **check)
    return report


def main():
    args = arguments()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    rig = scene.objects[CONFIG['rig']]
    if (float(rig[CONFIG['head_turn_control']]), float(rig[CONFIG['head_tilt_control']])) != (19.0, 15.0):
        raise RuntimeError('Print parts are designed for the logo pose (yaw 19, tilt 15).')
    meshes = [scene.objects[name] for name in CONFIG['meshes']]
    collection = bpy.data.collections.new('Temporary print parts')
    scene.collection.children.link(collection)
    temporary_meshes = []
    try:
        base, _ = export.printable_union(meshes, collection, temporary_meshes)
        union = mesh_arrays(base.data)
        body = posed_arrays(meshes[0])
        extras = dict(body=body[0], roots=[posed_arrays(obj) for obj in meshes[1:]])
        profile = depth_profile(*body)
        report = dict(source_revision=CONFIG['source_revision'],
                      blender_version=bpy.app.version_string,
                      pose='logo (head_yaw_deg 19, head_pitch_deg 15)',
                      parameters_mm=PARAMS, sizes={})
        for label in args.sizes.split(','):
            if label == 'full':
                scale = args.full_scale or full_scale(union[0])
            elif label == 'test':
                top = union[0][:, 2].max()
                scale = args.test_height / top
                for _ in range(4):
                    scale = args.test_height / (top - truncation_height(profile, scale))
                scale = round(scale, 2)
            else:
                raise SystemExit(f'Unknown size {label!r}; use test and/or full.')
            print(f'Building {label} at {scale} mm per unit')
            report['sizes'][label] = build_size(label, scale, union, extras, profile,
                                                collection, output)
        (output / 'print-report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
    finally:
        export.remove_collection(collection, temporary_meshes)


if __name__ == '__main__':
    main()
