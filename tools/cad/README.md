# CAD asset pipeline (LLF-69)

Every prop in Letter Launcher is a real, dimensioned part built by our NativeCAD engine. You do not
hand-model meshes or bake primitives. You write a **recipe**, run it through the NativeCAD MCP tools,
and commit what comes out:

```
recipe (tools/cad/recipes/<name>.json)
  -> NativeCAD MCP (cad_batch of the recipe ops)  -> assets/cad/<name>.glb  (3 LODs, PBR, quantized)
  -> cad_mass_properties per part                  -> tools/cad/massprops/<name>.json
  -> cad_preview_body                              -> assets/cad/previews/<name>.png
  -> node tools/cad/build_manifest.js <name>       -> assets/cad/manifest.json entry
  -> node tools/cad/check_manifest.js              (release gate, also run by npm test)
  -> AssetLib.place('<name>', {...}) in a scene    -> in game
```

There is no CLI for the CAD part. An agent runs the recipe through the MCP tools, step by step,
following **[run_recipe.md](run_recipe.md)**. This file is the contract. The three shipped recipes
are worked examples you can copy:

| recipe | shows |
|---|---|
| `street_lamp.json` | revolve (tapered hollow tube), rotated cylinder, 5 touching parts, `effective-*` density for a solid-modelled assembly |
| `wooden_crate.json` | `cad_joint` half-laps, chaining joint outputs (`$j1.bodies[0].handle`), 13 parts |
| `fire_hydrant.json` | boolean unions in a safe order, pentagon `cad_extrude_profile`, declared `joints` |

## 1. Recipe file: `tools/cad/recipes/<name>.json`

`<name>` is snake_case and is used everywhere: the recipe file, `assets/cad/<name>.glb`,
`massprops/<name>.json`, `previews/<name>.png`, the manifest key, and `AssetLib.place('<name>')`.

```jsonc
{
  "name": "street_lamp",                       // = file name
  "prompt": "20 ft tapered aluminium pole ...", // the plain-English spec, with the real numbers
  "kind": "prop",                              // "prop" (default budget 3k tris) | "hero" (20k)
  "budget": { "lod0Tris": 3000, "why": "..." }, // optional override of the kind default; say why
  "sources": ["https://...spec-sheet.pdf"],    // REQUIRED: where the dimensions came from
  "dimensions": { "pole height": "6096 mm, source 1", "base plate": "300 mm (assumed: ...)" },
  "units": "mm",                               // always mm, kernel frame is +Z up
  "ops": [ { "tool": "cad_box", "args": {...}, "as": "$base_plate" }, ... ],
  "parts": [ { "of": "$base_plate.handle", "material": "6061-T6", "nodeName": "base_plate" }, ... ],
  "export": {
    "lods": [{ "tolerance": 0.5 }, { "tolerance": 3 }, { "tolerance": 12 }],
    "compression": { "quantize": true, "instance": true },
    "creaseAngleDeg": 30, "upAxis": "Y", "units": "m", "bakeTransforms": false
  },
  "joints": [ { "node": "operating_nut", "type": "revolute", "axis": [0, 1, 0], "min": 0, "max": 94.25 } ]
}
```

Field rules:

- **sources / dimensions**: research the real object with WebSearch before you model it. Put each
  spec-sheet or manual URL in `sources`. In `dimensions`, give every key number with the source it
  came from. Mark a number you had to assume as `(assumed: reason)`. A recipe without sources fails
  `check_manifest`.
- **ops**: NativeCAD MCP calls, in order, exactly as `cad_batch` takes them: `{tool, args, as?}`.
  `"as": "$x"` names a result. Later ops reference it as `"$x.handle"`. For `cad_joint`, which
  returns two bodies, use `"$j.bodies[0].handle"` (the entering part, `partA`) and
  `"$j.bodies[1].handle"` (the receiving part, `partB`). Do not pass `document` in recipe ops. The
  recipe runs in a fresh session's default document. Keep `ops.length + parts.length <= 64`, because
  that is one `cad_batch` and `$refs` only live inside one batch.
- **parts**: one entry per final body that ships. `of` is the `$ref` of the body's **final** handle
  (after every joint or boolean). `nodeName` becomes the glTF node name, and code can find it with
  `getObjectByName` or `AssetLib.joints`. `material` must be a key in `tools/cad/materials.json`.
  To add a stock, add it there first with density, PBR values and a source. For a part you model
  solid that is really a hollow assembly (a luminaire, an engine block), add an `effective-<thing>`
  stock whose density is spec weight ÷ modelled volume. Every body left in the document must be a
  part: no stray tool bodies.
- **export**: the `cad_export_body` arguments. Pass everything **except `upAxis`**, which NativeCAD
  refuses for glb. glTF is +Y up by spec, and the exporter's root node already rotates Z-up to Y-up
  and scales mm to m. Use a **tolerance-only** LOD ladder (finest first, each coarser). Do not put
  `maxTriangles` on the last level: when a body cannot reach it, the exporter falls back to a
  "coarsest-achievable" mesh that can have *more* triangles than the level above (seen on the
  hydrant: 6510 > 3004). The export result must say `"monotonic": true`.
- **joints** (optional): movable parts for gameplay or physics. `node` is a `nodeName`. `axis` is
  in the GLB frame (+Y up, metres): the kernel's +Z becomes glTF +Y, and kernel +Y becomes glTF −Z.
  `min`/`max` are in radians for revolute joints and metres for prismatic ones.
  `AssetLib.joints(group)` returns them.

## 2. Modelling rules that keep `strict:true` export passing

The export runs with `strict:true` (assembly release gate). It refuses parts that float, parts that
interpenetrate, and assemblies whose lowest part is not on z = 0. So:

- Model in mm, +Z up, with the object standing on z = 0. The origin is the pivot in game, so put it
  where the object meets the ground (for example the centre of the base).
- Parts must **touch**: face-to-face contact, or a line contact like the arm resting on the
  luminaire. They must not overlap. A post that sits *on* a plate starts at the plate's top face.
- `cad_boolean_union` refuses more often than you'd think. Rules that worked:
  - Union **one tool per call**.
  - Do small side branches first and the big ones last. On the hydrant, both hose nozzles went in
    before the pumper nozzle; the other order failed with `self_intersection`.
  - Tool bodies must not overlap *each other* inside the base.
  - Each tool must clearly pierce the base, not just touch it.
  - Cone + cylinder unions (a tapered pole plus an arm) can fail with `volume_not_conserved`. Make
    them separate touching parts instead. That's also more honest, since it is two parts.
- **A failed op stays in the document** as an error feature and its inputs stay live. Don't try to
  patch around it. Fix the recipe, call `cad_session_reset {confirm:true}`, and replay the whole
  batch. Recipes are cheap to replay, and a replayed recipe is what we commit.
- `cad_joint` `half_lap`: set `axis` to the long axis of the entering member (`partA`), and set
  `direction` to point toward the corner it laps into. If you set `axis` to the lap direction
  instead, the joint keeps only a 9.5 mm stub of the rail.
- Rotated cylinders: `cad_cylinder` grows along +Z from `origin`. Pass `rotate` with
  `center` = `origin`:
  - `{ry: +π/2}` points the cylinder along +X.
  - `{ry: −π/2}` points it along −X.
  - `{rx: −π/2}` points it along +Y.
  - `{rx: +π/2}` points it along −Y.
- Hollow things, like a pole, are a revolve of an annulus profile `[[ri,z0],[ro,z0],[ro2,z1],[ri2,z1]]`.
  That keeps mass realistic (16 kg for the pole, not 130 kg solid).

## 3. Outputs and where they go

| path | what | written by |
|---|---|---|
| `assets/cad/<name>.glb` | glTF binary: one node per part (named `nodeName`), PBR material per part, `KHR_mesh_quantization`, `MSFT_lod` chain (3 levels) | `cad_export_body` (absolute Windows path into the worktree) |
| `assets/cad/previews/<name>.png` | `cad_preview_body` render (`views:["front","iso"]` frames tall things well) | preview tool → copy into place |
| `tools/cad/massprops/<name>.json` | `{ "<nodeName>": { "volumeMm3": n, "centroidMm": [x,y,z] } }`, copied from `cad_mass_properties` (kernel frame) | you |
| `assets/cad/manifest.json` | the entry below | `node tools/cad/build_manifest.js <name>` |

Manifest entry (the GLB frame: metres, +Y up):

```jsonc
"street_lamp": {
  "file": "street_lamp.glb", "preview": "previews/street_lamp.png", "kind": "prop",
  "tris": [1400, 652, 652],            // per LOD level, read from the GLB
  "budgetTris": 3000,
  "bboxM": { "min": [..], "max": [..], "size": [..] },
  "massKg": 62.03,                     // density x CAD volume, summed over parts
  "comM": [x, y, z], "inertia": [[..],[..],[..]],  // kg*m^2 about comM, from the LOD0 mesh
  "parts": { "pole": { "material": "6061-T6", "massKg": 16.2 }, ... },
  "joints": [...], "materials": ["6061-T6", ...],
  "recipeHash": "16 hex",              // sha256 of the recipe's canonical JSON
  "sources": [...]
}
```

`build_manifest.js` fails, and tells you why, if:
- a part's GLB mesh volume is more than 3 % off the CAD volume,
- a part's GLB centroid is more than 5 mm off the CAD centroid,
- a `nodeName` is missing from the GLB, or
- a GLB material name differs from the recipe material.

These failures catch wrong part order, stray bodies and stale GLBs.

`check_manifest.js` (wired into `npm test` through `tests/test_forgep1_assetlib.js`) fails if:
- a GLB is missing or has a bad header,
- the tris don't match the GLB or rise from one LOD to the next,
- LOD0 is over budget,
- `recipeHash` is stale (the recipe was edited after export),
- `sources` is empty, or
- a recipe has no manifest entry.

## 4. Using an asset in a scene

```js
// inside a scene builder (src/scenes/<scene>.js). Synchronous; never await here.
AssetLib.place('fire_hydrant', { x: 8.4, y: -5.1, z: 6, rotY: Math.PI });   // LOD'd by default
AssetLib.place('wooden_crate', { x: -12, y: -5.1, z: -14, rotY: 0.2, lod: false });
```

`place` adds an empty placeholder group to `scene` right away, so the clean-slate scene swap owns
it. The model swaps in when the GLB arrives. If the GLB is missing or the page is offline, it swaps
in `AssetLib.fallback(name)` instead: the baked `makeProp(name)` if one exists, otherwise a box the
size of the manifest bbox. Wrap your placement block in `try/catch`, like `city.js` does. One
metre is one world unit. For the ground height, use the scene's own value: `-5.1` in CITY, and
`coastHeight(x, z)` in COASTAL CITY.

Other API: `AssetLib.load(name)` → `Promise<Group>`, `AssetLib.lod(name, [d0, d1, d2])` →
`Promise<THREE.LOD>`, `AssetLib.joints(group)` → `{nodeName: {object, type, axis, min, max}}`,
`AssetLib.info(name)` → the manifest entry.

To eyeball every asset, serve the repo root (`run.bat` / `run.sh`) and open `/tools/cad/viewer.html`.
Use `?only=<name>` to show one asset, or `?lod=0` to skip LOD.

## 5. Definition of done for a new asset

1. The recipe is committed. It has sources and a dimensions table, and every assumption is marked.
2. The GLB was exported with `strict:true`, and the export result showed `"monotonic": true`.
3. `massprops/<name>.json`, `previews/<name>.png` and the manifest entry are committed.
4. `node tools/cad/check_manifest.js` and `npm test` pass.
5. The asset is placed in at least one scene through `AssetLib.place`, and it looks right in
   `tools/cad/viewer.html`.

## 6. Jointed assets: `rig` + `tools/cad/rig_glb.js` (LLF-74)

`cad_export_body` writes every part as a flat child of `nativecad-root`, and a part node's origin is
its quantisation centre, so rotating it spins the part about the wrong point and moves nothing
downstream. For an articulated asset (the robot arm), add a `rig.links` list to the recipe, parent
first, and run `node tools/cad/rig_glb.js <name>` right after the export, before `build_manifest`:

```jsonc
"rig": { "links": [
  { "node": "J0_base",      "pivotMm": [0, 0, 0],     "parts": ["base_casting"] },
  { "node": "J1_turret",    "pivotMm": [0, 0, 230],   "parts": ["turret_casting", "j1_motor"] },
  { "node": "J2_upper_arm", "pivotMm": [150, 0, 450], "parts": ["upper_arm"] } ] }
```

It nests the parts under empty pivot nodes placed exactly on each joint axis (glTF frame, no
rotation, so `joints[].axis` is also the node-local axis), keeps every part's world placement, and
writes `extras.axis` / `extras.joint` on each pivot (three exposes them as `userData`, which
`RobotRig.bind` and `AssetLib.joints` read). Running it twice is a no-op. Lower LOD levels are
static copies, so place jointed assets with `AssetLib.place(name, {lod: false})`.

Strict export gotchas found on the arm: parts must share an exact face (a 0.3 mm gap is "touches
nothing", a tangent cylinder is "interpenetrate 0 mm^3"); a `cad_tube_sweep` resting on a face needs
a D-section with its flat on the face and a straight `points` path (a bspline path facets the flat);
prefer one `cad_extrude_profile` line/arc outline (box + hub) over box/cylinder unions. Record the
accepted strict export in `massprops/<name>.json` as `"_export": {"strict": true, "floating": 0,
"interferingPairs": 0}`; `build_manifest` turns it into `assemblyOk`. The NativeCAD MCP session is
shared by every lane: never `cad_session_reset` while other lanes run; put `document: "new"` on the
first op and `"$first.document"` on the rest, and put `cad_export_body` inside the same `cad_batch`.
