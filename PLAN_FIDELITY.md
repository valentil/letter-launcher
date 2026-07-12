# Letter Launcher — Fidelity & Water-Level Plan

Goal: take the scenes from "toy" density (tens–~150 hand-placed meshes) to **10–50×**
richer, tuned for performance, plus a new interactive **water level** (a wall of
spigots), with a **Gemini Nano layout director** that lays every scene out differently
each run. Concept art approved (dense valley + spigot wall).

## Core technique: GPU instancing (not more meshes)

Placing 50× more individual `THREE.Mesh` objects would tank the framerate (draw calls).
Instead each scene gets an **enrichment pass** that adds background density as a handful
of `THREE.InstancedMesh` objects — one draw call for thousands of grass blades / rocks /
trees / stars / bricks. So "10–50×" is measured in *visible props*, not draw calls or
physics bodies.

- `addInstanced(geo, mat, count, placeFn)` builds one InstancedMesh, positions every
  instance via a seeded `placeFn`, routes it through `scene.add` (so the clean-slate
  swap hook still tears it down), and returns it. `frustumCulled` on.
- Instanced props are **visual only** — no Cannon colliders — so density costs almost
  nothing and letters/physics are unaffected (they still collide with the real ground
  and hero props).
- Budget: default ~8–40k instances/scene (grass dominant), clamped so low-end machines
  can dial down. One shared `Object3D` scratch matrix; no per-frame rebuild.

## Gemini Nano layout director (different every run)

`NanoLayout.specFor(sceneName)` returns a validated JSON layout spec that drives the
enrichment: `{ seed, palette, grass, trees, rocks, props, spigots:{cols,rows,openFraction} }`.

- **On-device Nano** (Chrome Prompt API: `window.LanguageModel` / `window.ai.languageModel`)
  is asked for the spec with a strict schema; the reply is JSON-parsed and **sanitised /
  clamped** (judgement + JSON — the same paradigm as SlopRadar/MarriageBank). Nano runs
  fully client-side, no network.
- **Fallback**: when Nano is unavailable/refuses/returns junk, a seeded `mulberry32` PRNG
  produces a valid spec. The run seed advances every build, so **even the fallback lays
  the scene out differently each time** — Nano just makes the variation smarter
  (coherent palettes, clustered groves, valve patterns).
- Non-blocking: the build uses the immediate seeded/cached spec; a Nano request is fired
  in the background and its result is applied on the *next* load, so the scene never
  stalls waiting on the model.

## Per-scene enrichment palettes

| Scene | Instanced density added |
|---|---|
| FOREST | dense grass + multi-layer trees + rocks + ferns |
| DESERT / WILD WEST | scrub tufts, cacti, rock scatter, tumbleweed motes |
| COASTAL CITY (**water level**) | the spigot wall + basin, plus dockside crates & grass |
| CITY | brick/window facades, street props, planters |
| SPACE | thousands of instanced stars + regolith pebbles |

## Water level — wall of interactive spigots

Built by `buildSpigotWall(spec)` when the water scene loads:

- A tiled back wall studded with a `cols × rows` grid of **brass spigots** (handwheel +
  spout), arrangement/`openFraction` from the layout spec.
- **Click a valve** (raycast the wheel in the PLAYING mouse handler) to toggle its flow;
  open spigots emit a water **stream + droplet particles** and a chime.
- A **basin** at the base fills while any spigot is open (its water plane rises), and
  letters that land in it bob — so typing + plumbing interact.
- `updateSpigots(dt)` (called from the animate loop, guarded) advances droplets and the
  fill level.

## Safety / rollout

- All new per-frame and per-build entry points (`enrichScene`, `updateSpigots`, spigot
  clicks) are wrapped in try/catch so untested code can't crash the game loop.
- Everything is added via `scene.add`, so the existing clean-slate scene-swap wipes it.
- Canonical edits in `showcase/letter-launcher/index.html`, then mirrored to
  `examples/letter-launcher/`. Verified by isolated syntax checks + a stubbed
  full-script parse/init harness (WebGL can't be rendered here).
