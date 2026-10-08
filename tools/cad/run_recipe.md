# Running a recipe through NativeCAD (agent procedure)

There is no CLI for this. You run it with the NativeCAD MCP tools, which live on the Windows
machine as `mcp__remote-devices__NativeCAD_MCP__*`. Load them with ToolSearch first, for example
`select:...cad_session_reset,...cad_batch,...cad_export_body,...cad_mass_properties,...cad_preview_body`.
`cad_help({tool})` returns any tool's full documentation.

`<WT>` below means the worktree's Windows path, for example
`C:\clawds\main_bot_dev\clawd-workspace\showcase\letter-launcher-worktrees\LLF-NN`. NativeCAD needs
**absolute Windows paths**.

## 0. Research, then write the recipe

Search the web for the real object's spec sheet or manual: overall size, the key feature sizes, and
weight if available. Write `tools/cad/recipes/<name>.json` following the [README](README.md)
contract. Cite every URL. Copy the closest shipped recipe as a starting point.

## 1. Fresh session

```
cad_session_reset { "confirm": true }
```

## 2. Build: one `cad_batch`

Send `ops` = the recipe's `ops`, followed by one `cad_set_part` per `parts[]` entry:

```json
{ "tool": "cad_set_part", "args": { "of": "<part.of>", "part": "<part.nodeName>", "material": "<part.material>" } }
```

Leave `result` at the default `"compact"`. Expect `ok: true`.

If it fails, the error names `failedIndex` and gives a hint. Fix the recipe, then go back to step 1.
Do not add more ops to a document that already holds a failed op. The README §2 rules cover the
usual failures: union order, overlapping tools, and the half-lap axis.

## 3. Export the GLB (strict)

Call `cad_export_body` with:

```json
{
  "format": "glb",
  "path": "<WT>\\assets\\cad\\<name>.glb",
  "lods": <export.lods>, "lodMode": "single",
  "compression": <export.compression>, "creaseAngleDeg": <export.creaseAngleDeg>,
  "units": "m", "bakeTransforms": false, "strict": true,
  "materialsOverride": [ one {"name": <stock>, "pbrMetallicRoughness": materials.d/<stock>.json .pbr} per part, in parts[] order ]
}
```

- Do **not** pass `upAxis`, because it is refused for glb.
- If every part uses the same stock, you can pass `"material": {"name":..., "pbrMetallicRoughness":...}`
  once instead of `materialsOverride`.
- Check the result:
  - `lod.monotonic` must be `true` (otherwise use a coarser tolerance ladder).
  - `lod.levels[0].triangles` must be within budget.
  - `assembly.counts` must show `floating: 0` and `interferingPairs: 0`.
- If the refusal is `E_ASSEMBLY_UNSOUND`, a part floats, overlaps another or is off z = 0. Fix the
  recipe and go back to step 1.

## 4. Mass properties, one per part

For each part, call `cad_mass_properties { "solid": <ref> }`. The ref can be:
- the handle from the compact batch output, or
- `"<featureId>#<bodyIndex>"` from `cad_list_model_state` features. For example, `box_4#0` is body 0
  of the 5th op, and `joint_6#1` is the receiving body of the 7th op.

A `cad_batch` of these with `result:"full"` does them all in one call.

Copy only `volume` and `centroid` into `tools/cad/massprops/<name>.json`:

```json
{ "_frame": "cad_mass_properties output, kernel frame (mm, +Z up), unit density",
  "<nodeName>": { "volumeMm3": 2250000, "centroidMm": [0, 0, 12.5] } }
```

Inertia is computed later from the GLB mesh, so don't copy the tensors.

## 5. Preview

Call `cad_preview_body { "views": ["front", "iso"], "tile": 256 }`. For a compact object,
`{ "azimuth": 35, "elevation": 30, "width": 320 }` also works. Look at the image and check the part
reads as the real thing: proportions, and features in the right places. The tool returns the PNG to
your session.

To save it as `assets/cad/previews/<name>.png`:
1. Copy the PNG from the tool-results path into `/mnt/user-data/outputs/...`.
2. Call `device_commit_files` with `devicePath` set to `<WT>\assets\cad\previews\<name>.png`.

## 6. Manifest and gate (device shell, node)

```
cd "$HOME/mnt/letter-launcher-worktrees/LLF-NN"
node tools/cad/build_manifest.js <name>     # writes assets/cad/manifest.d/<name>.json; prints tris + kg, or FAIL
node tools/cad/check_manifest.js            # must print "N asset(s) OK"
node tools/cad/glb.js assets/cad/<name>.glb # optional: node names, tris per LOD, bbox (m, Y up)
node tests/run_all.js
```

## 7. Place it in a scene and commit

Add an `AssetLib.place('<name>', {...})` block to the scene builder (README §4). Then commit every
file:
- the recipe
- `assets/cad/<name>.glb`
- `assets/cad/previews/<name>.png`
- `tools/cad/massprops/<name>.json`
- `assets/cad/manifest.d/<name>.json` (one file per asset; there is no shared manifest index to edit)
- any `materials.d/` change
- the scene file

If you edit the recipe after exporting, `check_manifest` fails on the stale `recipeHash`. Re-run
steps 1 to 6. Don't hand-edit the hash.
