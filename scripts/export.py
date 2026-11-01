"""Export the editable master using Blender's bundled Python; no MCP required.

blender --background model/reindeer.blend --python-exit-code 1 --python scripts/export.py
Append: -- --output-dir /some/other/directory
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
import numpy as np
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'project.json').read_text())


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'exports')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def panel_deviation(body):
    panels = json.loads(body['panel_faces'])
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    try:
        result = {}
        for label, index in panels.items():
            points = np.array([mesh.vertices[i].co[:] for i in mesh.polygons[index].vertices])
            result[label] = float(np.linalg.svd(points-points.mean(axis=0), compute_uv=False)[-1])
        if max(result.values()) > 1e-5:
            raise RuntimeError('A named facet is not planar: ' + json.dumps(result))
        return max(result.values())
    finally:
        ev.to_mesh_clear()


def print_mesh(scene, meshes, destination):
    collection = bpy.data.collections.new('Temporary print export')
    scene.collection.children.link(collection)
    temporary_meshes = []
    try:
        depsgraph = bpy.context.evaluated_depsgraph_get()
        parts = []
        for source in meshes:
            evaluated = source.evaluated_get(depsgraph)
            data = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
            data.transform(evaluated.matrix_world)
            temporary_meshes.append(data)
            obj = bpy.data.objects.new('Print_' + source.name, data)
            collection.objects.link(obj)
            parts.append(obj)
        base = parts[0]
        bpy.context.view_layer.objects.active = base
        for other in parts[1:]:
            modifier = base.modifiers.new('Union', 'BOOLEAN')
            modifier.operation = 'UNION'
            modifier.object = other
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            other.hide_set(True)
            other.hide_render = True

        bm = bmesh.new()
        try:
            bm.from_mesh(base.data)
            bmesh.ops.triangulate(bm, faces=list(bm.faces))
            bm.faces.ensure_lookup_table()
            seen, components = set(), []
            for vertex in bm.verts:
                if vertex in seen:
                    continue
                pending, count = [vertex], 0
                seen.add(vertex)
                while pending:
                    current = pending.pop()
                    count += 1
                    for edge in current.link_edges:
                        adjacent = edge.other_vert(current)
                        if adjacent not in seen:
                            seen.add(adjacent)
                            pending.append(adjacent)
                components.append(count)
            tree = BVHTree.FromBMesh(bm, epsilon=1e-7)
            overlaps = [(a, b) for a, b in tree.overlap(tree)
                        if a < b and not set(bm.faces[a].verts).intersection(bm.faces[b].verts)]
            report = dict(component_sizes=components,
                          nonmanifold_edges=sum(not e.is_manifold for e in bm.edges),
                          boundary_edges=sum(e.is_boundary for e in bm.edges),
                          nonadjacent_overlap_candidates=len(overlaps),
                          triangles=len(bm.faces), volume_design_units=bm.calc_volume())
            if (len(components) != 1 or report['nonmanifold_edges'] or
                    report['boundary_edges'] or overlaps or report['volume_design_units'] <= 0):
                raise RuntimeError('Printable union failed validation: ' + json.dumps(report))
            bm.to_mesh(base.data)
        finally:
            bm.free()
        bpy.ops.object.select_all(action='DESELECT')
        base.select_set(True)
        bpy.context.view_layer.objects.active = base
        bpy.ops.wm.stl_export(filepath=str(destination), export_selected_objects=True)
        return report
    finally:
        for obj in list(collection.objects):
            if obj.data not in temporary_meshes:
                temporary_meshes.append(obj.data)
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(collection)
        for data in temporary_meshes:
            if data.users == 0:
                bpy.data.meshes.remove(data)


def main():
    output = arguments().output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    meshes = [scene.objects[name] for name in CONFIG['meshes']]
    body = meshes[0]
    rig = scene.objects[CONFIG['rig']]
    cameras = [scene.objects[name] for name in CONFIG['cameras']]
    head = rig.pose.bones[CONFIG['head_bone']]
    animation = rig.animation_data
    if animation is None:
        raise RuntimeError('The master is missing its head-turn driver.')
    nominal_yaw = float(rig[CONFIG['head_turn_control']])
    settings = CONFIG['animation']
    original_action = animation.action
    original_slot = animation.action_slot
    original_rotation = head.rotation_euler.copy()
    original_frame = scene.frame_current
    original_range = (scene.frame_start, scene.frame_end, scene.render.fps)
    original_hidden = rig.hide_get()
    original_selection = list(bpy.context.selected_objects)
    original_active = bpy.context.view_layer.objects.active
    drivers = [(driver, driver.mute) for driver in animation.drivers]
    tracks = [(track, track.mute) for track in animation.nla_tracks]
    temporary_action = None
    try:
        rig.update_tag()
        scene.frame_set(original_frame)
        bpy.context.view_layer.update()
        report = dict(source_revision=CONFIG['source_revision'],
                      blender_version=bpy.app.version_string,
                      source_model=CONFIG['master'],
                      print_scale=CONFIG['print_scale'],
                      static_head_yaw_degrees=nominal_yaw,
                      master_body_vertices=len(body.data.vertices),
                      master_body_polygons=len(body.data.polygons))
        source_path = Path(bpy.data.filepath)
        if source_path.is_file():
            report['on_disk_master_sha256'] = hashlib.sha256(source_path.read_bytes()).hexdigest()
        report['print_mesh'] = print_mesh(scene, meshes, output / 'reindeer-normalized.stl')

        animation.action = None
        for driver, _ in drivers:
            driver.mute = True
        for track, _ in tracks:
            track.mute = True
        rig.hide_set(False)
        scene.frame_start, scene.frame_end = settings['frames'][0], settings['frames'][-1]
        scene.render.fps = settings['fps']
        for frame, offset in zip(settings['frames'], settings['yaw_offsets_degrees']):
            head.rotation_euler[1] = math.radians(nominal_yaw + offset)
            head.keyframe_insert(data_path='rotation_euler', frame=frame, group=CONFIG['head_bone'])
        temporary_action = animation.action
        temporary_action.name = 'Head turn reveal'
        deviations = {}
        for frame in settings['frames']:
            scene.frame_set(frame)
            deviations[str(frame)] = panel_deviation(body)
        report['maximum_panel_deviation_by_frame'] = deviations
        scene.frame_set(settings['frames'][0])
        bpy.ops.object.select_all(action='DESELECT')
        for obj in meshes + [rig] + cameras:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        if not hasattr(bpy.types, 'EXPORT_SCENE_OT_gltf'):
            bpy.ops.preferences.addon_enable(module='io_scene_gltf2')
        bpy.ops.export_scene.gltf(filepath=str(output / 'reindeer.glb'),
                                 use_selection=True, use_active_scene=True,
                                 export_cameras=True, export_animations=True,
                                 export_force_sampling=True, export_frame_range=True,
                                 export_animation_mode='SCENE')
        (output / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
        print('Exported GLB, normalized STL and validation.json to', output)
        print(json.dumps(report, indent=2))
    finally:
        animation.action = original_action
        if original_action is not None and original_slot is not None:
            animation.action_slot = original_slot
        head.rotation_euler = original_rotation
        for driver, muted in drivers:
            driver.mute = muted
        for track, muted in tracks:
            track.mute = muted
        scene.frame_start, scene.frame_end, scene.render.fps = original_range
        scene.frame_set(original_frame)
        rig.hide_set(original_hidden)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in original_selection:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = original_active
        if temporary_action is not None and temporary_action.users == 0:
            bpy.data.actions.remove(temporary_action)


if __name__ == '__main__':
    main()
