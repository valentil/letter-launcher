# Letter Launcher — Audit Notes (A1) + W1/W2 change log

Audit performed against `showcase/letter-launcher/index.html` (the canonical build).
Line numbers below are approximate and refer to the file *after* the W1/W2 edits
(the audit itself was done on the pre-edit file; offsets shifted by the additions).

## A1 — Where things live

### Scenes
The app has **six** scenes (the owner's "bathtub"/"moon" were illustrative, not literal):
`coastal_city`, `desert`, `space`, `city`, `forest`, `wild_west`.
Selection dispatch: `selectCurrentScene()` (~line 1725) maps the `scenesItems`
menu entries to `create<Name>Scene()` builders. `currentScene` (global, ~line 65)
gates all per-scene animate logic.

### The spawn "box" / launchers (the abstract spawn region)
- Letters do **not** spawn from a box volume; they spawn from three fixed
  **launcher** cylinders created in `createLaunchers()` (~line 1296) at world
  positions `(-10,10,0)`, `(10,10,0)`, `(0,12,-5)`.
- `spawnLetter()` (~line 1486), `spellWordInScene()` (~line 1552) and
  `spawnShape()` (~line 1662) drop bodies from those launcher positions (or `y≈15`)
  and let gravity settle them onto whatever collider is below.
- The "abstract box" the owner referred to was the **ground collider**: every scene
  registered a single flat `CANNON.Box` as the floor, regardless of what the visible
  ground mesh actually looked like.

### Per-scene ground colliders (BEFORE)
All pushed onto the global `colliderBodies` array (~line 47), which
`selectCurrentScene()` clears (`world.removeBody`) on every scene switch (~line 1727).

| Scene        | Visible ground                                             | OLD collider (the "box")                                  | Problem |
|--------------|------------------------------------------------------------|-----------------------------------------------------------|---------|
| coastal_city | sculpted land: deep water / **beach ramp** / plateau       | `Box(400,10,400)` at `(200,-15.1,0)` → flat top y=-5.1     | Letters floated ~1.5 above the sloped beach (invisible plane). |
| desert       | `PlaneGeometry` **dunes** `sin*cos*2` at y=-5.1            | `Box(100,2,100)` at y=-7.1 → flat top y=-5.1               | Letters rested flat while dunes poke through / trough gaps. |
| space        | **no ground mesh at all** (just starfield + distant planet)| `Box(500,1,500)` at y=-6.1 → flat top y=-5.1               | Letters rested on an invisible plane in the void. |
| city         | flat road plane at y=-5.1                                   | `Box(50,1,100)` at y=-6.1 → flat top y=-5.1                | OK (flat matches flat). |
| forest       | flat ground plane at y=-5.1                                 | `Box(100,1,100)` at y=-6.1 → flat top y=-5.1               | OK (flat matches flat). |
| wild_west    | sculpted canyon floor `sin*cos*1.5` + track dip at y=-5.1  | `Box(500,1,500)` at y=-6.1 → flat top y=-5.1               | Letters rested flat over undulating ground. |

Props already had colliders (buildings = `Box`, mountains = `Cylinder`); these
work because Cannon dispatches `boxConvex`/`boxBox` for those pairs.

### The train (BEFORE) — in `createWildWestScene()`
- Track: two hand-integrated `createCurvedTrack(0,-500)` / `(15,-500)` groups
  (~200 segments each) starting 500 units away at z=-500.
- Train: a `THREE.Group` (`scene.userData.train`) of the locomotive + 4 cars built
  along local **X**, positioned at `(0,-5.1,0)`.
- Motion: `animate()` (~old line 2708) re-integrated the 200-segment path **from
  scratch every frame**, decremented `scene.userData.trainProgress` ("travels
  backwards"), copied the result to the group and set `rotation.y = angle + PI/2`.
- **No collider** — letters passed straight through the train.

## Key engine finding (drives the W1 fix)
Verified empirically against `cannon@0.6.2` (installed from npm cache in-sandbox):
- **Box-vs-Trimesh does NOT collide** — a dynamic Box tunnels straight through a
  `CANNON.Trimesh` (test: box fell to y≈-470). So Trimesh is unusable for letters.
- **Box-vs-Heightfield DOES collide** — box rests on the surface (test: y=0.5 on a
  flat heightfield at y=0). Ramps and crater bowls also work.
- **Teleported static bodies still collide** under `NaiveBroadphase` (which the app
  uses), so a kinematic-style train (mass 0, position set each frame) is picked up
  by letters without needing `KINEMATIC`/`aabbNeedsUpdate` flags.

Therefore W1 uses **`CANNON.Heightfield`** colliders sampled from the *same*
procedural height functions the visible meshes use.

## W1 — Changes made
- New helper `addHeightfieldCollider(minX,minZ,maxX,maxZ,elementSize,heightFn,name)`
  (~line 545): samples `heightFn` into a Heightfield, rotates it so height→world +Y,
  positions it, adds to world + `colliderBodies`, and stores `scene.userData.groundHeightFn`.
- **coastal_city** (~line 623): replaced the flat box with a heightfield matching the
  deep-water/beach-ramp/plateau `coastHeight(x,z)`.
- **desert** (~line 800): heightfield matching the dune function; visible plane enlarged
  `200→320` so it covers the collider footprint.
- **space** (~line 895): added a **visible cratered moon surface** mesh (`moonHeight`
  with 5 crater bowls) and a matching heightfield — letters now rest on a real moon.
- **wild_west** (~line 1082): heightfield matching the canyon-floor function; the
  function is stored on `scene.userData.wwHeight` and reused by the track + train.
- `city` and `forest` left as flat boxes (already correct — they match their flat
  visible ground).

## W2 — Changes made (`createWildWestScene()` + `animate()`)
- Replaced both `createTrack`/`createCurvedTrack` builders with a single closed
  **`THREE.CatmullRomCurve3`** loop (`trackCurve`); rails + ties are laid along
  `getSpacedPoints()` and dropped onto the terrain via `wwHeight`.
- Rebuilt the train as **articulated cars**: `buildCarUnit()` makes each unit
  (locomotive with boiler/cabin/chimney/cowcatcher, tender, 3 cars) oriented with
  forward = local +Z, using `MeshStandard` materials, shadows, and wheels.
- Each car gets its own **kinematic `CANNON.Box` collider** added to `colliderBodies`
  (so letters land on / bounce off it, and it is cleaned up on scene switch).
- Motion: `animate()` advances one arc-length head parameter `trainHeadU`; each car
  trails it by a fixed arc gap and is placed with `getPointAt`/`getTangentAt`
  (smooth, even-speed), and its collider body is teleported to match.
- Removed the old `scene.userData.train` / `trainProgress` per-frame path re-integration.

## W3 — Usability (this run)
- **Controls hint:** new `#controlsHint` DOM element (styled) + `updateControlsHint()`
  which is called each frame but only touches the DOM when the game state changes.
  It is context-aware (main menu / scenes menu / options / in-game) and covers keys,
  Space slow-mo, **middle-click** explode, right-drag rocket, and Esc menu. The menu
  variant explicitly says "choose **SCENES** to pick a map" and the scenes menu
  announces "**Scene selector**" for discoverability.
- **Audio gate:** `unlockAudio()` runs on the first `pointerdown`/`keydown` (a real
  user gesture) and removes itself; `initAudio()` now `resume()`s a suspended context.
  Removes browser autoplay warnings.

## W4 — Features (this run)
- **LLF-2 Combo-Based Firework Triggers:** rolling `comboKeyTimes` buffer; when
  `COMBO_SPEED_COUNT` (7) keystrokes land within `COMBO_SPEED_MS` (1400 ms) and the
  `COMBO_COOLDOWN_MS` (2500 ms) has elapsed, `triggerComboFireworks()` fires a
  staggered volley (reusing `spawnFirework`) plus a rising 4-note chord.
- **LLF-12 Alphabetical Rain Mode:** a same-letter streak (`RAIN_TRIGGER_COUNT` 4
  within `RAIN_WINDOW_MS` 600 ms — e.g. holding a key auto-repeats) calls
  `startLetterRain(char)`, which rains 24 of that letter from y≈16-22 via `spawnLetter`
  (so the W5 cap still applies), guarded by `rainActive` against overlap.

## W5 — Performance (this run)
- Replaced the **six** duplicated inline "retire oldest non-NPC body" loops with a
  single `retireExcessBodies()` helper enforcing `Math.min(maxLetters, HARD_BODY_CAP)`
  (HARD_BODY_CAP = 120) — an absolute ceiling even if `maxLetters` is raised to 200 in
  Options. Net effect also removed ~2 KB of duplicated source.
- New `capParticles()` (MAX_PARTICLES = 400) trims the oldest firework/explosion
  particle meshes; called after every particle burst (`spawnFirework`,
  `spawnFireParticle`, `explodeLetter`) so combos/rain can't balloon the scene.

## Verification limits
No browser / no Three.js CDN in the sandbox, so **visual confirmation was not possible**.
Additionally, the workspace mount **hard-caps reads of `index.html` at the original
138232 bytes**; W3-W5 edits grew the file past that, so the tail (train *animate* block,
firework animate, rocket, screen-letter and render code, final `</script></html>`) is
invisible to headless `node`/`grep` run against the mount. Consequences + how each was
handled:
- New W3/W4/W5 anchors were placed **early** (bytes ~1.7 KB-12 KB), so
  `tests/test_w3_usability.js`, `test_llf-2_combo_fireworks.js`,
  `test_llf-12_alphabetical_rain.js`, `test_w5_body_cap.js` and `test_w1_scene_colliders.js`
  all **pass** through the mount (the LLF-2/12/W5 specs also run a pure-logic simulation
  of the trigger/cap predicates).
- `test_w2_train.js` **fails only through the truncated mount** because its animate-side
  anchors (`getPointAt(u)`, `car.body.position.set`, …) are at lines 2890-2897, past the
  cap. That code is **prior-run W2 work, unchanged this run**. It was confirmed present
  in the authoritative file with the uncapped Read/Grep tool (train build at 1311-1424,
  animate at 2877-2897; `trainProgress`/`createCurvedTrack` absent).
- Full-script **`node --check` passed** on a reconstruction of the complete file
  (current prefix + committed suffix), validating that all W3-W5 edits are
  syntactically valid and brace-balanced.
- The 15 legacy `test_llf-*`/`test_llb-*` failures are **pre-existing** (they reference an
  obsolete hardcoded `switcher/public/LetterLauncher/launcher.html` path) and are
  unrelated to this run.
