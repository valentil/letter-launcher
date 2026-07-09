# Letter Launcher — Improvement Plan

**Canonical source:** `showcase/letter-launcher/index.html` (the real `launcher.html` build) → re-sync to `examples/letter-launcher/` after changes.
**Executor note:** One work item at a time, each with an acceptance check, to avoid context drift.

## Assessment (current state)

- `index.html` (~138 KB) is the full build: Three.js (r128) scene + Cannon.js physics + Web Audio, plus a `dictionary.txt` word list (fetched locally).
- Implemented features (from `featurelist.md`): physics letters, gravity wells, letter explosion, musical keystrokes, reactive zoo animals, firework paintbrush, time-dilation, scene selection (forest/moon/bathtub).
- **Known problems (from Lewis):**
  1. **Letters spawn into an abstract "box" region** rather than conforming to the actual scene geometry — a letter dropped in the "bathtub" scene should collide with the tub, not an invisible cuboid.
  2. **The train** (a set-piece in one scene) **isn't good** — looks/behaves poorly.

## Audit (do first)

- [x] **A1.** Locate and document in `PLAN_NOTES.md`: the spawn-volume definition (the "box"), the per-scene geometry setup, the Cannon.js body/collider creation for the ground/scene, and the "train" object. Record file offsets and the current collider shapes. Acceptance: notes list exactly where the box and train are defined.

## Work items

- [x] **W1 — Letters collide with real scene geometry.** Replace the abstract spawn box with colliders that match the visible scene: build Cannon.js bodies from the actual scene meshes (trimesh or fitted primitives per scene — tub = concave/compound, moon = heightfield/plane, forest = ground + obstacles). Spawn letters above the real surface. Acceptance: in each scene, letters visibly rest on/against the shown geometry (e.g., settle inside the bathtub), not on an invisible plane.
- [x] **W2 — Fix the train.** Rework the train set-piece: cleaner low-poly model or assembled primitives, proper motion along a path, and collision so letters can land on/bounce off it. If the train adds little, replace it with a better-fitting scene prop and note the decision. Acceptance: the train (or its replacement) looks intentional, moves smoothly, and interacts with physics.
- [x] **W3 — Usability pass.** Added a context-aware on-screen controls hint (`#controlsHint` + `updateControlsHint()`) covering typing, Space slow-mo, middle-click explode, right-drag rocket and Esc menu; the menu hint points players at the SCENES selector and the scenes menu announces itself. Gated the AudioContext behind a real user gesture (`unlockAudio()` on first pointerdown/keydown) and resume a suspended context in `initAudio()` (no autoplay warnings). Acceptance: a new player can tell what to do within a few seconds; no console autoplay errors.
- [x] **W4 — Feature completeness.** Implemented **LLF-2 Combo-Based Firework Triggers** (fast typing burst → staggered firework volley + rising chord) and **LLF-12 Alphabetical Rain Mode** (repeating one letter fast → heavy rain of that letter, reusing `spawnLetter` so the body cap applies). Test specs: `tests/test_llf-2_combo_fireworks.js`, `tests/test_llf-12_alphabetical_rain.js` (both include a pure-logic simulation of the trigger predicate).
- [x] **W5 — Performance.** Consolidated the six duplicated inline "retire oldest letter" loops into one `retireExcessBodies()` helper that enforces an absolute `HARD_BODY_CAP` (120) on top of the user's `maxLetters` option, and bounded firework/explosion particles with `capParticles()` / `MAX_PARTICLES` (400). Acceptance: sustained fast typing (and combo/rain effects) can't leak bodies or balloon particle meshes. Test spec: `tests/test_w5_body_cap.js`.

## Follow-up run — Fix1–Fix4 (Z-clash / online dictionary / cinematic fireworks / sound)

- [x] **Fix1 — On-screen spawn volume + containment (Z-clash).** Replaced the fixed-launcher spawn (which let letters land off-screen or clip through scene walls) with a bounded play box derived from the camera frustum. New `computePlayBounds()` unprojects the lower screen band onto the floor plane, `buildContainmentWalls()` wraps it in 4 invisible static Cannon boxes, and `spawnLetter()` now spreads spawns with a golden-ratio + height stagger so fresh letters don't interpenetrate. Verified by projection math for aspect ratios 1.0–2.2. Test: `tests/test_fix1_containment.js`.
- [x] **Fix2 — Online dictionary loader.** `loadDictionary()` tries `./dictionary.txt` → online `google-10000-english-no-swears.txt` → a ~200-word built-in `FALLBACK_WORDS`; cached in the in-memory `DICTIONARY`, all errors caught. The 4 MB local file no longer needs to ship. Word-detection buffer unchanged (see PLAN_NOTES). Test: `tests/test_fix2_dictionary_loader.js`.
- [x] **Fix3 — Cinematic firework rockets.** Rockets now fly a scripted arc (rise + recede into the background) then `detonateFirework()` with a random style: `sphere / willow / ring / crackle / palm`, each with its own color + per-particle gravity/drag/decay. Respects `capParticles()`/`MAX_PARTICLES`.
- [x] **Fix4 — Synthesized SFX.** `playRocketWhoosh()` (rising whistle + airy noise) on launch and `playRocketBoom()` (low thump + high crackle) on detonation, oscillator/noise only, gated behind the existing `unlockAudio()` user-gesture.

## Follow-up run — Menu state machine + Bowl spawns (Fix5–Fix6)

- [x] **Fix5 — Menu is a clean single-active-screen state machine.** Replaced the ad-hoc
  `gameStarted`/`inScenesMenu`/`inOptionsMenu`/`showEscapeMenu` toggling (which let SCENES
  and OPTIONS open on top of each other, and left **EXIT as a dead button**) with a single
  authority `setMenuScreen(name)` over screens `MAIN / SCENES / OPTIONS / PLAYING`. It tears
  down **every** panel first (`clearAllMenuMeshes()`), so only one screen is ever live.
  `activateMainMenuItem()` wires all four MAIN items — including **EXIT**, which now closes
  the menu and returns to **PLAYING** (resumes the toy, or starts the default scene if none
  is loaded). **Esc** toggles PLAYING ↔ MAIN. The old in-game "escape overlay" (`handleEscapeMenu`
  / `createEscapeMenu` / `removeEscapeMenu`) was deleted. Test: `tests/test_menu_state_machine.js`
  (proves exactly one screen active across all transitions + EXIT/Back behaviour + a static
  wiring grep of the real source).
- [x] **Fix6 — Bowl container centers the spawns on-screen.** Added `buildBowl()`: a ring of 16
  inward-tilted `CANNON.Box` staves (an inverted funnel — wide rim, narrow base) plus a flat
  bottom box, all primitives that DO collide with the Box-shaped letters in Cannon 0.6.2
  (Box-vs-Trimesh does not — see PLAN_NOTES). A translucent cone/rim/base mesh makes it read.
  New `bowlSpawnPos()` drops pieces ABOVE the bowl center on a golden-angle spiral inside the
  rim; `spawnLetter` / `spawnShape` / `spawnZooAnimal` / `spellWordInScene` all use it, so
  letters, shapes, animals and spelled words now pour into the centered bowl instead of the
  off-to-the-side launchers. Built in `setupPlayArea()` alongside the existing frustum play
  box + containment walls (kept as an outer safety net; the bowl subsumes their centering job).
  Test: `tests/test_bowl_spawn.js` (600 staggered spawns/box land inside the rim, above the
  bowl, and on-screen; bowl centered on and fitting inside the play box).

## Guardrails
- Stay 100% client-side; dictionary now fetched online with a local-first try-order and an offline fallback (no server of ours).
- Do NOT touch the `examples/letter-launcher/` copy (per this run's instructions); edits are in the canonical `showcase/letter-launcher/index.html` only.
