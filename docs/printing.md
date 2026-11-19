# Printing the reindeer

`scripts/print_parts.py` turns the logo pose into two hollow, millimetre-scaled parts for an FDM printer with a 180 mm cube (Prusa Mini). It does not modify the master. From the repository root:

```sh
blender --background model/reindeer.blend --python-exit-code 1 --python scripts/print_parts.py
```

This writes STLs and `print-report.json` to `build/print/` (not tracked). Options after `--`: `--sizes test,full`, `--test-height 150` (mm), `--full-scale 25` (mm per model unit; by default the largest that fits), `--output-dir DIR`. Dimensions and clearances are in `PARAMS` at the top of the script.

## Sizes

| Size | Scale | Height | Neck part | Head part | Antler sections |
| --- | --- | --- | --- | --- | --- |
| test | 14.36 mm/unit | 150 mm | 35 × 63 × 66 mm | 92 × 92 × 84 mm | about 1.4–2.3 mm |
| full | 27.25 mm/unit | 302 mm | 66 × 120 × 142 mm | 175 × 174 × 159 mm | about 2.7–4.4 mm |

The full head part leaves about 2.5 mm to the edge of the bed, turned 6° (already applied in the STL). Use `--full-scale 26` for more room (about 288 mm tall).

The magnet needs a flat base, so the pointed neck tip is cut off. The magnet is a fixed size, so the smaller the print, the more is removed: 0.25 model units at full size, 0.87 at test size.

## Split and orientation

The cut is the level mouth line of the logo pose (model height 5.5), below the ears. Both parts print cut face down:

- **Neck part, upside down.** The neck narrows toward the top as it prints, so it needs no supports. Inside cavity roofs are at least 45°: a gable under the magnet, and a 45° slope under the jaw.
- **Head part, upright.** It needs supports for the antlers and ears only: organic supports, from the build plate only. Its cavity has a 45° hip roof, and solid material is kept around the buried antler and ear roots.

`print-report.json` counts solid voxels inside each part that have nothing below them in print orientation. The head part has none. The neck part has a few dozen just ahead of the throat. They are less than a millimetre across and print as short bridges.

## Features

- **Shell:** 1.6 mm walls. Thicker at the joint (2.8 mm at the cut face, tapering at 45°) for glue.
- **Opening:** the neck opening lies entirely inside the head opening, so light and the LED string pass straight into the head.
- **Magnet:** pocket for an 8 × 3 mm magnet (8.3 × 3.3 mm), centred on the flat base, with 1.2 mm below the cavity.
- **Wire hole:** 3.2 mm, through the back, 7 mm above the base.
- **Dowel holes:** three 2.0 mm blind holes for 1.75 mm filament, 5 mm deep in each part, with small countersinks. Solid bosses surround them inside the cavity. Their triangle has unequal sides, so the parts fit only one way round.

## Assembly

1. Print the test size first and check the magnet, dowel and wire-hole fits. Clearances are in `PARAMS`.
2. Cut three 9 mm pieces of 1.75 mm filament and dry-fit the parts.
3. Feed the LED string in from outside through the wire hole and up the neck, and lay the LEDs into both cavities. The plug stays outside.
4. Glue the cut faces with the dowels in place, and press the magnet into its pocket with a drop of glue.

## Slicing notes

- Turn on elephant's foot compensation, since the holes start on the first layer.
- Frosted PC shows light only through thin material. The perimeters fill the 1.6 mm shell; the bosses, jaw and antlers get infill.
- PC warps. A brim on the cut faces and a draft shield or enclosure help, as does a PC blend.
- The mesh checks establish closed, single-component solids. They do not establish print strength. The test-size antler tips are fragile.
