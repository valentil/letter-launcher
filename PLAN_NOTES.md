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

# Follow-up run — Fix1–Fix4 change log

## Word-detection logic (the "babysmash-style" typed-buffer + dictionary lookup)
Located in `onKeyDown()`:
- `let inputBuffer = ""` global — comment "Last 16 characters" (index.html ~line 90).
- On each typed `a-zA-Z0-9` key: `inputBuffer += char; if (inputBuffer.length > 16) inputBuffer = inputBuffer.slice(-16);` (~2273-2275). So the game keeps a rolling **16-char window** of recent keystrokes.
- Detection scan (~2280-2291): `for (const word of DICTIONARY) if (inputBuffer.endsWith(word)) foundWords.push(word);` then `foundWords.sort((a,b)=>b.length-a.length)` → `longestWord`. This is the babysmash-style "did the last few letters just spell a word?" check.
- Events fired from `longestWord`: `"FEATUREBOARD"` easter egg (~2293), `zooAnimals.includes(longestWord)` → `spawnZooAnimal()` (~2307-2309), otherwise a 5 s debounced `spellWordInScene(longestWord)` via `wordPending` (~2319-2333). Space clears the buffer (~2348).
- **Perf note:** the scan is O(DICTIONARY.length) per keystroke, which is why Fix2 defaults the online source to the ~10k google-10000 list rather than the 370k-word `words_alpha` (kept as a documented alternative in `DICTIONARY_SOURCES`).

## Fix1 — On-screen spawn box + containment (Z-clash)
- New globals: `playBounds`, `containmentBodies`, `spawnTick`, `SPAWN_STACK_H=5`, `DEFAULT_FLOOR_Y=-5.1` (after `capParticles`).
- `computePlayBounds()` builds a throwaway camera at the fixed gameplay vantage `(0,5,15)` looking at the origin (so bounds don't jitter with the live mouse-offset camera), unprojects the **lower** NDC band (`ny -0.82..-0.08`, floor only visible below the horizon) onto the floor plane, takes the inner rectangle of the perspective trapezoid, and insets 12%.
- `isWithinPlayBounds(pos,b,tol)` — reused predicate (also in the test).
- `buildContainmentWalls(b)` — 4 static `CANNON.Box` walls (left/right/near/far) around the box; rebuilt each call. Cinematic rockets are script-driven (no body) so walls never block them.
- `setupPlayArea()` — recompute bounds + walls and nudge the 3 visual launchers to the top edge; called from `init()`, `onWindowResize()`, `selectCurrentScene()`, and both START-GAME paths.
- `spawnLetter()` now spawns inside `playBounds` via a golden-ratio X/Z spread + `(idx%6)` height stagger (was: pick a launcher at `y≈10` with ±1 jitter → off-screen / interpenetrating).
- **Verification (test_fix1_containment.js):** reimplements the THREE projection and proves every corner of the spawn box (floor..floor+5) projects to NDC within ±(1−0.03) for aspects 1.0/1.2/1.333/1.6/1.777/2.2, that 500 staggered spawns all land in-bounds and on-screen, and that the predicate rejects out-of-view points. The empirical box at 16:9 is ≈ x∈[-11,11], z∈[-9,6] on the floor at y=-5.1.

## Fix2 — Online dictionary loader
- `FALLBACK_WORDS` (~200 common words, `const`) loaded into `DICTIONARY` immediately, then `loadDictionary()` runs. Try-order: `./dictionary.txt` → `google-10000-english-no-swears.txt` (online) → keep fallback. `words.length > 50` and `/^[A-Z]+$/` guards reject stub/HTML responses; every fetch is wrapped in try/catch (no uncaught rejections). Confirmed the online URL is live (9,898 words).
- Removed the old `let DICTIONARY = [...]` seed array + the bare `fetch('dictionary.txt')`.
- **Verification (test_fix2_dictionary_loader.js):** local-first, fall-through to online, both-fail-keeps-fallback, undersized-file-skipped, and a typed-buffer `endsWith` scan still detects a word from the loaded list.

## Fix3 — Cinematic rockets + varied bursts
- Rocket flight (in the `pendingRockets` animate block) is now **script-driven**: on launch the physics body is detached, origin snapped to near the ground (`floorY+0.5`), then position is interpolated over ~1.5–2.3 s — `y` rises with an ease-out toward apex while `z` recedes (`-depth`) into the background and `x` drifts, so it arcs away from the camera. A thin exhaust trail follows the nose; the mesh is oriented to its velocity.
- `detonateFirework(pos, style, hue)` + `fwParticle()` extend the LLF-2 firework system with 5 styles: **sphere** (even), **willow** (slow drooping gold, high gravity/long life), **ring** (flat tilted ring), **crackle** (bright flash + 2-3 delayed micro-pops), **palm** (few thick rising-then-drooping fronds). Each detonation randomizes style + HSL color.
- The firework **animate loop** now honors optional per-particle `gravity`/`drag`/`decay` (defaults preserve the old look for existing `spawnFirework`/`explodeLetter` particles). `capParticles()` is still called after every burst (and inside the crackle timeouts) so `MAX_PARTICLES` (400) can't be exceeded.

## Fix4 — Synthesized rocket SFX
- `makeNoiseBuffer(dur)`, `playRocketWhoosh()` (sine 220→1300 Hz whistle + band-passed noise sweep, ~1.5 s) triggered when a rocket starts its cinematic flight; `playRocketBoom()` (sine 170→38 Hz thump + high-passed noise crackle) called inside `detonateFirework()`. Both `initAudio()` and early-return when `soundVolume<=0`, and rely on the existing `unlockAudio()` gesture gate → no autoplay warnings. Volumes scale with `soundVolume`.

## Verification this run
- **Full-file `node --check` PASSED.** The Linux mount still hard-caps `index.html` reads at the original 138232 bytes, so the file was reconstructed as *current mount prefix (all early edits) + git-HEAD tail spliced at an unchanged anchor + the two late edits (firework loop, rocket block) re-applied* → extracted `<script>` bodies compiled clean. The authoritative file was confirmed via the uncapped Read tool.
- `tests/test_fix1_containment.js` and `tests/test_fix2_dictionary_loader.js` **PASS** (run from the mount after busting its per-file size cache with a rename+copy). Prior specs `test_w1/w3/w5`, `test_llf-2/12_*` still **PASS**.
- **Not visually verified** (no browser / no Three/Cannon CDN in the sandbox): the actual on-screen framing, the rocket arc's look, and audio playback are reasoned from the geometry/DSP but not rendered. Also note the pre-existing broken git index (a conflicted file literally named " " and null-sha cache entries) is unrelated to these edits.

# Follow-up run — Menu state machine + Bowl spawns (Fix5–Fix6)

## The menu was 3D text meshes, not DOM
The "menu" is not HTML buttons — it is `THREE.TextGeometry` meshes clicked via raycasting.
MAIN items live in `menuItems = ['START GAME','SCENES','OPTIONS','EXIT']`; SCENES is a 5×5
"TV wall" (`tvMeshes`/`tvGrid`); OPTIONS is a list of sliders.

## Bugs found (BEFORE)
- **EXIT was a dead button.** Neither the keyboard `Enter` handler (`onKeyDown`) nor the
  main-menu mouse-click branch (`onMouseDown`) had any `'EXIT'` case. The mouse branch also
  had no `'OPTIONS'` case, so OPTIONS could only be opened by keyboard.
- **SCENES + OPTIONS could both be open.** `createScenesMenu()`/`createOptionsMenu()` each set
  only their own flag and never cleared the other's meshes. Worse, the `onKeyDown` guard chain
  led with `if (!gameStarted && !inScenesMenu) { …main-menu… } else if (inOptionsMenu) …`, so
  when OPTIONS was open (from MAIN) the FIRST branch still captured input — options keyboard was
  effectively broken and panels stacked.
- The in-game pause used a **separate** ad-hoc overlay (`handleEscapeMenu`/`createEscapeMenu`/
  `removeEscapeMenu` + `showEscapeMenu`) — a fourth, parallel menu state.

## Fix5 — `setMenuScreen()` single-active-screen state machine
- New globals: `MENU_SCREENS = ['MAIN','SCENES','OPTIONS','PLAYING']`, `let menuScreen = 'MAIN'`
  (index.html ~line 94). The legacy booleans (`gameStarted`, `inScenesMenu`, `inOptionsMenu`,
  `showEscapeMenu`) are now **derived** and kept in sync by the state machine, so the existing
  hint/hover/animate code keeps working.
- `clearAllMenuMeshes()` removes `menuMeshes`, `scenesMenuMeshes` (+`tvMeshes`/`tvGrid`),
  `optionsMenuMeshes`, `escapeMenuMeshes` and zeroes their arrays — the exclusivity teardown.
- `setMenuScreen(name)` (~line 2160): validates `name`, calls `clearAllMenuMeshes()`, resets
  `inScenesMenu`/`inOptionsMenu=false`, sets `menuScreen`, then builds exactly one screen:
  MAIN→`createMenu()` (+`clearBowl()`), SCENES→`createScenesMenu()`, OPTIONS→`createOptionsMenu()`,
  PLAYING→`gameStarted=true`, create default scene only if `currentScene==='default'`, then
  `setupPlayArea()`.
- `activateMainMenuItem(item)` (~line 2205): START GAME → `currentScene='default'` + `PLAYING`
  (fresh default); SCENES/OPTIONS → those screens; **EXIT → `setMenuScreen('PLAYING')`** (close
  menu, resume the toy — or start default if nothing is running). No dead button.
- Wiring: `onKeyDown` — `Esc` → `setMenuScreen(menuScreen==='PLAYING'?'MAIN':'PLAYING')` (toggle);
  MAIN `Enter` → `activateMainMenuItem(menuItems[selectedIndex])`; OPTIONS `BACK`/SCENES `BACK`
  → `setMenuScreen('MAIN')`. `onMouseDown` gated on `menuScreen==='PLAYING'`/`'OPTIONS'`/`'SCENES'`/
  else MAIN, MAIN click → `activateMainMenuItem`. `selectCurrentScene()` rewritten with a
  `builders{}` map + `setMenuScreen('PLAYING')`. Font-loader now boots via `setMenuScreen('MAIN')`.
- Deleted the escape-overlay trio (`handleEscapeMenu`/`createEscapeMenu`/`removeEscapeMenu`);
  `escapeMenuMeshes` kept as an empty array for `clearAllMenuMeshes`/animate safety. Grep proof:
  `handleEscapeMenu`/`createEscapeMenu`/`removeEscapeMenu` = **0** refs; `createMenu`/`createScenesMenu`/
  `createOptionsMenu` = **2** each (definition + the single `setMenuScreen` call — only reachable
  through the one authority).
- Test: `tests/test_menu_state_machine.js` — pure reducer proves exactly one screen active across
  all 16 transitions, EXIT→PLAYING (resume vs. START GAME's fresh default), Back→MAIN, Esc toggle;
  plus a static grep of the real source (EXIT handled, arrays cleared, Esc→setMenuScreen, no live
  `handleEscapeMenu`). **23 checks PASS.**

## Fix6 — Bowl container + centered spawns
- Reconfirmed the engine constraint (PLAN_NOTES "Key engine finding"): **Box-vs-Trimesh does not
  collide** in Cannon 0.6.2, so the bowl is built from primitives that do.
- New globals `bowlBodies`/`bowlMeshes`/`bowlInfo` (~line 173). `buildBowl(b)` (~line 268):
  - Center = play-box center `((minX+maxX)/2, (minZ+maxZ)/2)` on the floor; `rTop = clamp(halfSpan*0.82, 4..6.5)`,
    `rBottom = 0.42·rTop`, `height = min(5.5, 0.95·rTop)`.
  - **Physics:** 16 inward-tilted `CANNON.Box` staves. Each stave's orientation is an orthonormal
    wall frame `makeBasis(T=tangent, U=up-slant, N=T×U inward-normal)` copied into the body
    quaternion; staves overlap (`segWidth = 1.2·chord`). A flat bottom `CANNON.Box` caps the base.
  - **Visual:** translucent open `CylinderGeometry(rTop,rBottom,height,open)` cone + a torus rim +
    a base disc (all `opacity ≤ 0.28`, `depthWrite:false`) so the bowl reads without clutter.
- `bowlSpawnPos(sizeY)` (~line 355): golden-angle spiral inside `0.5·rTop`, height `topY + 1.5 +
  (idx%5)·0.5 + sizeY·0.5` — i.e. ABOVE the rim, so pieces fall INTO the bowl and pile up centered.
- `spawnLetter` (~line 1990), `spawnShape`, `spawnZooAnimal` now call `bowlSpawnPos()`;
  `spellWordInScene` drops its row centered on `bowlInfo.cx/cz` above the rim (was `z=-10`,
  `y=15`, off-screen). `setupPlayArea()` calls `buildBowl()` after `buildContainmentWalls()`
  (walls kept as an outer safety net; the bowl does the centering). `clearBowl()` tears it down
  when leaving PLAYING (setMenuScreen).
- Test: `tests/test_bowl_spawn.js` — for 4 play boxes, the bowl is centered on and fits inside the
  box, and 600 staggered spawns/box all land inside the rim, above the bowl, and on-screen
  (golden-angle keeps consecutive drops separated). **9,621 checks PASS.**

## Verification this run
- **`node --check` PASSED** on the extracted inline `<script>` (168 KB). The Linux mount still
  serves flaky/short `cat`/`tail` streams of the 170 KB `index.html`, so the full file was
  reconstructed as *working-file prefix (`fs.readFileSync`, contains all Fix5/Fix6 edits — they sit
  before byte ~168 KB) + git-HEAD tail spliced at the unchanged anchor `depth: 26 + Math.random() * 20,`*.
  All new symbols (`setMenuScreen`, `buildBowl`, `bowlSpawnPos`, `activateMainMenuItem`, `clearBowl`,
  `menuScreen`) confirmed present in the extracted script.
- New specs `test_menu_state_machine.js` (23) + `test_bowl_spawn.js` (9,621) **PASS**. Prior specs
  `test_fix1_containment`, `test_fix2_dictionary_loader`, `test_w3_usability`, `test_w5_body_cap`,
  `test_llf-2_combo_fireworks`, `test_llf-12_alphabetical_rain` **still PASS** (no regression).
- **Not visually verified** (no browser / no Three/Cannon CDN in the sandbox): the actual on-screen
  framing, whether the translucent bowl reads well against each scene, and the settle behaviour of
  the stave ring are reasoned from the geometry (quaternion basis, golden-angle spiral, in-bounds
  projection) but **not rendered**. The 16-stave funnel is an approximation of a smooth bowl; small
  gaps between staves near the rim are possible but the 1.2× overlap + bottom cap + outer containment
  walls keep letters corralled.
