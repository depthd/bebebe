# Base kit: Soviet furniture modelled by script

Six pieces of a 1970s-80s flat, built from scratch by bpy scripts (no third-party assets): the
style-neutral input for the art-style passes (`scripts/assets/styles/<style>.py`, `npm run style-kit`)
and the showroom that compares them.

| id | what | size (w x h x d, m) |
|---|---|---|
| `armchair` | кресло of the 70s, rust velour, polished armrests, splayed legs | 0.73 x 0.85 x 0.85 |
| `tv` | ламповый телевизор (Рубин) on a four-legged stand; the CRT is `screen` | 0.70 x 0.95 x 0.55 |
| `fridge` | ЗИЛ-Москва, door hinged on the left (origin on the hinge) | 0.60 x 1.50 x 0.68 |
| `stenka` | one section of a polished стенка: books, crystal behind glass, mirror back | 1.01 x 2.10 x 0.49 |
| `stove` | газовая плита Брест (Гефест-like) with the lid up (lid origin on the hinge) | 0.50 x 1.39 x 0.68 |
| `stool` | кухонная табуретка with a hand slot | 0.33 x 0.45 x 0.33 |

## Build and preview

```sh
blender -b --factory-startup --python scripts/assets/kit/build.py -- all            # or: tv  /  tv,stool
blender -b --factory-startup --python scripts/assets/kit/preview.py -- all          # Cycles, ~40 s an item
```

- `build.py -- <id|all|id,id> [outdir]` writes `<outdir>/<id>.glb` (default `.cache/kit/base/`) and prints
  one `STATS {"id", "tris", "materials": [...], "size_m": [x, height, depth], "bytes"}` line per item.
- `preview.py -- <id|all|id,id|sheet> [glbdir] [outdir] [samples]` renders `<outdir>/<id>.png` (600x600,
  48 samples + OIDN, mid-grey cyclorama, key/fill/rim, three-quarter front view from the right) and the 3x2
  contact sheet `<outdir>/sheet.png` (defaults: `.cache/kit/base/`, `shots/style/kit/`). It reads any GLB
  with these conventions, so a style pass can preview its output: `-- all .cache/kit/toon shots/style/toon-kit`.
  `THREADS=n` sets the Cycles threads (default 2, the machine is shared).

## Conventions (what a style pass can rely on)

- Metres, Z up in Blender; origin at the bottom centre of the bounding box; the **front faces -Y**
  (glTF +Z, which is what `furniture.js` `model()` expects).
- One root node named after the item; every part is a named child (`seat_cushion`, `case_frame`,
  `crystal_glasses`...). Repeated small parts are joined (`legs`, `knobs`, `grates`). Hinged parts keep
  their pivot: `fridge/door` (with its handle, trim and badge as children) and `stove/lid`.
- Mid-poly, 1.3k-7.1k triangles. Roundings are real geometry, all modifiers applied. Every part is a closed
  solid with outward normals (parts touch or overlap; there are no internal partitions). Normals are
  exact custom split normals: flat panels are flat, bevels and roundings smooth, nothing smeared.
- One material per role, named by the role, plain Principled factors (base colour, metallic,
  roughness, alpha), no textures, no baked light. The colour of a role can differ per item:

  | role | use |
  |---|---|
  | `wood_polished` | dark polished veneer (armchair arms and legs, TV case, стенка) |
  | `wood` | light lacquered wood (stool) |
  | `fabric` | upholstery (rust velour), book cloth (maroon) |
  | `metal_chrome` | chrome: handles, trim, badge letters, ferrules, burner rings; the стенка's (darkened) mirror |
  | `metal_painted` | painted/anodised metal: black (stove grates and door, fridge plinth), silver (TV control strip), gold (стенка handles, book bands) |
  | `enamel` | white enamel (fridge, stove, the field of the ЗИЛ badge) |
  | `plastic_black` | knobs, TV front panel and back cover, burner caps |
  | `glass` | alpha-blended clear glass (стенка doors and shelf, oven window) |
  | `crystal` | alpha-blended crystal (vase, bowl, glasses) |
  | `screen` | the TV picture; mesh and material both `screen`, UVs 0..1 across the picture |
  | `rubber` | fridge door seal |

- UVs: one Smart UV Project (island margin 0.02) over all parts of an item together, so the islands of
  the whole item share one 0..1 atlas without overlaps (ready for baking). Exception: `screen` keeps
  its own planar 0..1 mapping.

## Files

- `common.py`: role materials (`ROLES`, `palette()`), `soft_box`/`box` (rounded boxes with exact
  normals, any radius per side, 0 = sharp), `pillow` (cushions), `lathe`/`cylinder`/`leg`,
  `frame` (rounded-rectangle bezels swept from a cross-section), `tube` (bent bars), `text` (raised
  Cyrillic letters), `subtract` (boolean cut), `join`, `parent_all`.
- `<id>.py`: `build()` makes the item in the current scene and returns its root.
- `build.py`: per item: reset, build, origin, UVs, stats, export.
- `preview.py`: the Cycles previews and the contact sheet.
