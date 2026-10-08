# Word-Quest Levels

Letter Launcher's gamified scenes: the simulation reacts to whole **typed words**.
Discovering the vocabulary *is* the puzzle — the objective HUD gives the goal and
riddle-ish hints, found words collect on screen, and the input buffer at the bottom
glows **green** (ready) → **orange** (typing) → flashes **blue** (word recognized) →
fades back to green.

Every level's vocabulary has two tiers, encoded directly in the level definition
(`setGameMode({ words: {...} })` in `index.html`):

- **State advancers** — change the sim's state and move you toward the win.
- **Doodads** — reactive flavor: the scene responds, but nothing progresses.

Aliases are pipe-separated in the source (`'GO|START|CHOO': fn`) and expanded by
`expandWords()`. Matching is longest-word-wins against the tail of the input buffer.

---

## 1. KYOTO TRAIN (isometric)

**Goal:** deliver the Shogun to the palace. Stop at his station, speak his name to
board him, dodge the stalled school bus on the outer line (switch to the inner
line, or clear the bus), open the palace gates, and stop at the palace crossing.
Coal runs out; children near the school force a crawl unless warned.

**State advancers (11):**

| Word(s) | Effect |
|---|---|
| GO / START / CHOO / DEPART / ONWARD | train moves (needs coal) |
| STOP / HALT / BRAKE | train halts (boarding & arrival happen while stopped) |
| FAST / HURRY / EXPRESS | speed ×1.8 |
| SLOW / EASY / GENTLE | speed ×0.6 |
| SWITCH / POINTS / TRACKS | toggle outer ↔ inner line at nearest point |
| REVERSE / BACK | reverse direction |
| SHOGUN | while stopped at his station: he boards |
| PALACE / GATES / OPEN | open the palace gates (required to win) |
| BUS | driver clears the crossing for a short window |
| WHISTLE / HORN | warns the schoolkids — lifts the school-zone crawl |
| STOKE / COAL / FIRE | refill the firebox (fuel) |

**Doodads (26):** TREE/SAKURA (cycles spring→summer→autumn→winter on the cherry
trees), CHERRY/BLOSSOM/HANAMI (petal-fall toggle), RAIN, SNOW, SUN/CLEAR, NIGHT
(lanterns light), DAY, FOG/MIST, WIND/GUST, BIRD/CRANE (flock flyby), CAT (rooftop
cat), BELL/TEMPLE (gong + palace pulse), DRUM/TAIKO (town bounces), LANTERN
(toggle glow), HANABI/FIREWORK (burst over palace), KOI (pond leap), GARDEN/FLOWER
(blooms), TEA (teahouse steam), NINJA (rooftop dash), MONK (walks the path), TORII
(vermilion glow), SMOKE/STEAM (engine rings), STAR(S), FUJI (mountain rises on the
horizon), MOON (moonrise toggle), QUAKE (rumble + shake).

*Future ideas:* GEISHA (fan dance), RICKSHAW (crosses a street), CARP (streamers),
HAIKU (three chimes), ONSEN (steam pool), FESTIVAL (lanterns + drums combo).

---

## 2. FLIGHT SIM

**Goal:** name a destination city, take off, navigate, then land on its runway —
towers demand GEAR down and FLAPS out before they'll clear you.

**State advancers (16):**

| Word(s) | Effect |
|---|---|
| TAKEOFF / FLY | full-power ground roll, rotate at 55 kt, climb out (gear retracts on positive climb) |
| LAND | final approach — only near target, gear down, flaps out; the autopilot flies the descent and flare, and the touchdown must be under 1.3 x stall speed (for the flaps set) with under 3 m/s sink, or you bounce / land hard and go around |
| LEFT · RIGHT | bank 45° |
| TURN / AROUND | 180° |
| HIGHER / CLIMB · LOWER / DESCEND / DIVE | target altitude ±5 (≈ ±125 m); an altitude-hold autopilot pitches for it |
| FAST / THROTTLE / BOOST · SLOW / CRUISE | autothrottle 135 kt · 110 kt (FAST also keeps full power on approach) |
| GEAR / WHEELS | retract / extend the landing gear (retractable-gear trainer; gear-down adds drag) |
| FLAPS | step the flaps 0 → 10 → 20 → 30 → 0; more flap = lower stall speed and more drag (needed to land) |
| AUTOPILOT / AUTO | track the target city automatically |
| OSAKA (N) · PARIS (E) · CAIRO (S) · RIO (W) | set destination; its beacon lights |

**Flight model (LLF-81):** the aircraft is the CAD asset `light_aircraft` (generic high-wing
four-seat trainer, no brand marks) with moving ailerons, elevator, rudder, flaps, prop and gear.
It flies on a 3-DOF point-mass + pitch model (`src/scenes/flight/flight_model.js`) using the aero
tables in `assets/cad/aircraft_aero.json`. Fly too slowly (e.g. no throttle while holding altitude)
and the wing stalls: buffet, a warning horn, and the nose drops. Full flaps (FLAPS ×3) and normal
power make a landing that sticks; flaps 10 or FAST floats you in too fast and you bounce.
WIND / TURBULENCE puts real gusts on the wing.

**Doodads (27):** LOOP, ROLL/BARREL, WAVE/WAGGLE (wing waggle), SMOKE/TRAIL
(airshow smoke toggle), CLOUD(S), RAIN, SNOW, STORM/THUNDER (flash + boom),
SUN/CLEAR, NIGHT, DAY, RAINBOW, BIRD/FLOCK, BALLOON, BLIMP/ZEPPELIN, UFO, COW/MOO,
TREE/FOREST (seasons), RADIO (tower chatter), TOWER (light sweep), FLARE(S),
STARS, MOON, JET (sonic boom flyby), KITE, FIREWORK (over nearest city),
WIND/TURBULENCE.

*Future ideas:* MAYDAY (dramatic klaxon, nothing actually wrong), WING (walker),
GOOSE (formation joins you), PHOTO (camera shutter freeze-frame), ACE (aileron
victory roll + smoke rings).

---

## 3. MOON ROCKET

**Goal:** one full orbit around the moon, then land back on the pad. The spent
booster must be STAGEd before the ship can circularize; RETRO before you can land;
fuel gates launches and boosts. Space props (starfield, nebula, distant planet)
are lifted from the SPACE scene.

**Staged flight (LLF-82).** When the CAD models load, the rocket is a real
three-stage heavy-lift stack in Saturn V proportions (`assets/cad/moon_rocket.glb`,
separate S-IC / S-II / S-IVB node groups) standing on its launch platform beside an
umbilical tower with four swing arms (`launch_tower.glb`, revolute joints), and the
return vehicle is a lunar lander with four deployable legs (`lunar_lander.glb`).
Masses, centres of mass and inertia come from `cad_mass_properties`
(`tools/cad/massprops/*`, written to `assets/cad/rocket_stages.json` by
`tools/cad/build_rocket_stages.js` together with the public propellant table).
`src/scenes/rocket/ascent.js` flies it: thrust from mass flow x Isp (sea level to
vacuum), exponential-atmosphere drag (Cd 0.35, **approximate**; the one
`cad_wind_tunnel` quick-look run did not converge, see the JSON), point-mass gravity,
a programmed gravity turn and an altitude hold to a 185 km orbit. Time is warped 20x
and drops to 3x in the last 16% of a stage's propellant so there is time to type.
If the models fail to load the original arcade rocket plays unchanged.

- **LAUNCH** lights the first stage and the tower arms swing away (about 1.5 s).
- **STAGE** works only near burnout (last 10% of a stage's propellant). Earlier it is an
  *early staging* penalty: the interlock refuses and vents 1.5% of the propellant. A
  stage nobody separates is released 25 s (sim) after burnout. On separation the total
  mass drops by the stage's dry mass plus its leftover propellant; the stage tumbles
  away as a cannon.js body with its real mass and CAD-derived inertia. The interstage
  skirt (8 s after S-IC) and the escape tower (30 s) jettison by themselves.
- **ORBIT** waits for orbital insertion (the S-IVB burn), then needs the first STAGE done.
- **LAND** swaps to the lander and deploys the legs (**LEGS / GEAR / DEPLOY** does it
  early, during the descent); touchdown waits until the legs are down.

**State advancers (11):**

| Word(s) | Effect |
|---|---|
| LAUNCH / IGNITE / BLAST / LIFTOFF | ascend from the pad (burns fuel); tower arms swing away |
| STAGE / SEPARATE / JETTISON | drop the spent stage near burnout (required for orbit); too early = penalty |
| ORBIT / CIRCLE | circularize (needs altitude + staging) |
| BOOST / BURN | raise the orbit (burns fuel) |
| RETRO / BRAKE / SLOW | de-orbit burn (required before landing) |
| LAND / TOUCHDOWN | descend — only above the pad; lander legs deploy first |
| LEGS / GEAR / DEPLOY | deploy the lander legs during the descent |
| ABORT | emergency auto-return to the pad |
| FUEL / REFUEL / TANK | top off (pad only) |
| FLIP / REVERSE | orbit the other way |
| SCAN / RADAR / MAP | toggle pad beacon + orbit guide ring |

**Doodads (23 + aliases):** STARS/TWINKLE, COMET/REX (comet flyby with cyan tail),
METEOR/SHOWER (surface strikes), EARTH/PLANET/HOME (pulse), SUN/FLARE, NEBULA
(hue shift), ALIEN (peeks from a crater), UFO/SAUCER, FLAG (plant it), MOON/WOBBLE
(mochi jiggle), CRATER/GEYSER (dust vent), DUST, SATELLITE (blinking flyby), ROVER
(trundles between craters), WAVE/HELLO, LIGHTS/BEACON/STROBE, MUSIC/SONG,
ECLIPSE (lights dim), AURORA, ASTEROID/ROCK, GALAXY/SPIRAL, DINO/DINOSAUR
(space dinosaur cameo), SIGNAL/PING (expanding rings).

*Future ideas:* GRAVITY (everything hops), WORMHOLE (screen ripple), LASER (pew
pew, hits nothing), HOUSTON (radio exchange), CHEESE (the moon briefly yellows).

---

## 4. WATERWORKS (pipe maze)

**Goal:** fill all three buckets to the white line. Overflow (past ~115%) dumps a
bucket back to zero. The water is real path-following particles: drops snapshot
the route when they leave the tank, travel the pipes, then free-fall into a
bucket — fill rises because water *arrives*. Joints randomly spring leaks
(drops spray out at the joint) until FIXed; PRESSURE overdrive fills fast but
triples leak risk.

**The maze:** TANK → big rotary VALVE picks the LEFT or RIGHT main → each main
ends in a rotating ELBOW (a visible pipe arm that swings) which multiplexes the
stream DOWN into its outer bucket or ACROSS diagonal cross-pipes into the shared
middle bucket. The middle bucket has no direct line.

**State advancers (12):**

| Word(s) | Effect |
|---|---|
| WATER / FLOW / POUR / OPEN | start the flow |
| STOP / OFF / SHUT / CLOSE | stop the flow |
| VALVE / TURN | toggle the main valve L↔R (big wheel spins) |
| LEFT · RIGHT | set the main valve directly |
| ROTATE / ELBOW / SPIN | swing the LEFT elbow down↔across |
| CRANK / WHEEL | swing the RIGHT elbow down↔across |
| PUMP / FAST / MORE | rate ×2 |
| SLOW / TRICKLE / GENTLE / LESS | rate ×0.5 |
| NORMAL / STEADY | rate ×1, overdrive off |
| PRESSURE / BLAST / SURGE | overdrive, leak-prone |
| DRAIN / EMPTY / DUMP | empty the currently-routed bucket |
| FIX / PATCH / WRENCH / REPAIR | patch the active leak |

**Doodads (28):** BUBBLE(S), SPLASH, DUCK (bobs in the fullest bucket), FISH
(bucket-to-bucket arc), STEAM, ICE/FREEZE (glacier-blue water), WARM/HOT, GLOW/NEON,
RAIN, SNOW, SUN/CLEAR, NIGHT, DAY, RUST/OLD (pipes age), PAINT/NEW (repaint),
WAVE/SLOSH, FROG (rim-hopper + croak), SOAP/FOAM (tank foams over), TAP/DRIP
(plink… plink…), PLUMBER (wrench salute), PIPE/CLANK (rattle), TANK (slosh),
WHIRLPOOL/VORTEX, RAINBOW/MIST, GURGLE, FOUNTAIN (junction burp), BIRD, TREE(S)
(seasons).

*Future ideas:* GOLDFISH (lives in a bucket permanently), SPONGE (absorbs a
spill), KETTLE (whistles), SIPHON (secret transfer between buckets).

---

## 5. TOWER BUILD

**Goal:** stack and weld blocks until the tower reaches the red GOAL beam
(~5 blocks). Blocks are real physics bodies — sloppy stacks topple. Weld settled
blocks (bottom-up) to lock them; aim the trolley with LEFT/RIGHT; drop height
changes how chaotic landings are.

**State advancers (14):**

| Word(s) | Effect |
|---|---|
| LOAD / BLOCK / CONCRETE | concrete block on the hook |
| BRICK(S) | lighter brick block |
| STEEL / GIRDER | heavy, narrower, very stable |
| DROP / PLACE / RELEASE | release the block |
| WELD / FUSE / FIX | weld the lowest settled block solid |
| UP / RAISE / LIFT · DOWN / LOWER | hook height (drop chaos) |
| LEFT · RIGHT · CENTER / MIDDLE / AIM | trolley aim |
| CLEAR / WRECK / SCRAP | remove loose blocks |
| MAGNET | falling blocks drawn to the trolley line |
| SCAFFOLD / SUPPORT / BRACE | temporary side walls (they expire!) |
| CEMENT / SLAB / FOUNDATION | one-time wide foundation slab |

**Doodads (29):** HAT/HELMET, WORKER/CREW/WAVE, HORN/AIRHORN, LUNCH (whistle +
sit-down), COFFEE (cab jitters), RADIO/MUSIC (cones bop), DOG (steals a glove),
PIGEON/BIRD (off the jib), SPARK/GRIND, PAINT (loose blocks recolored), FLAG
(runs up the mast), LIGHTS/FLOODLIGHT, NIGHT, DAY/SUN, RAIN, SNOW, CLEAR, WIND
(cable sway + dust), MUD/PUDDLE, CONE(S) (they dance), TRUCK (drives past),
MIXER/DRUM, JACKHAMMER, SIREN, STAR(S), TREE(S) (seasons), BANNER/SAFETY
(unfurls), CAT (walks the jib), ECHO/HAMMER.

*Future ideas:* INSPECTOR (clipboard pause), OVERTIME (night + floodlights combo),
DYNAMITE (refused, with a stern message), ELEVATOR (rides the mast), TOPOUT
(ceremonial evergreen once the goal is hit).

---

## 6. ROBOT FACTORY (constraint-solved typesetting)

**Goal:** fill the shift's five sign orders before the shift clock runs out (shift 1: OPEN, SALE, EXIT,
PIZZA, WELCOME HOME — 4:00). You don't move the robots: you type an order and a real solver does the
rest. `RobotPlanner` (CSP: glyph x arm x grasp x time, occlusion precedence, shared airspace zones, tool
changes, substitutes) picks which letters to take out of the tote and which arm takes each one;
`RobotMotion` drives the two pedestal arms (analytic IK, guarded transits, vacuum/gripper physics) and
the glyphs really stand in the type-tray slots before the conveyor ships the sign.

What makes it a puzzle:
- **Finite letters** — the tote starts with 40 glyphs in Scrabble proportions plus a number drawer (0, 2,
  2, 5). PIZZA needs two Z and there is one: REFILL, or let the solver set a `2` as a substitute (−25).
- **Buried / face-down letters** — the vacuum cup only takes a face-up glyph lying within 25° of flat
  (a face-down one would be set mirror-reversed), the jaws only take a glyph standing upright. The solver
  digs (lifts occluders off and drops them aside); when it can't, the reason shows in the panel.
- **Faults** — a vacuum drop is a JAM (red andon) until you RESET; FAST makes drops likelier.
- **Safety** — a forklift periodically heads for the cell. STOP before it breaks the light curtain or
  take a safety trip (−50, fault); GO once it has backed out.

Scoring per sign: 100 + 20/letter + speed bonus (3/s under 60 s) − 25 per substitute. Win banner shows
orders, average cycle time, substitutes and faults. Stars (stored per shift with
`Progress.recordShift('ROBOT FACTORY', n, …)`): ★ finished, ★★ under 3:00, ★★★ no faults and no
substitutes. Shifts 2 and 3 unlock with a shift-1 star (`Progress.isUnlocked`).

**State advancers:**

| Word(s) | Effect |
|---|---|
| the order, typed as one word (OPEN, SALE, EXIT, PIZZA, WELCOMEHOME; shift 2: TAXI, HOTEL, JAZZ, BAKERY, NOPARKING; shift 3: QUIZ, VIDEO, BOXING, EXPRESS, WAFFLEHOUSE) | queue that sign: planner solves → robots set it → conveyor ships it (+points) |
| REFILL / HOPPER / FILL | overhead hopper pours the letters the open orders still miss + a Scrabble handful (arms wait ~3 s) |
| SHAKE / VIBRATE / JIGGLE | tote vibrator (12 mm, 8 Hz) reshuffles the pile, then the solver re-plans |
| RESET / CLEAR / FIX | clear a JAM fault (and a tripped curtain once the forklift is out) |
| SWAP / TOOL / CHANGE | force a tool change (vacuum cup ↔ gripper) on idle arms; the solver re-plans |
| FAST / FASTER / HURRY | arm speed override 150% — vacuum drop chance ×5 |
| SLOW / SLOWER / CAREFUL | 50% — fewer drops |
| NORMAL / NOMINAL | back to 100% |
| STOP / ESTOP / HALT | emergency stop: arms and held letters freeze (needed before the forklift crosses) |
| GO / RUN / RESUME | resume after a stop (refused while the forklift is inside) |
| PLAN / SOLVER / GANTT | planner overlay: Gantt strip per arm (pick / transit / place bars, planned jobs), reach shells, chosen glyph highlighted with a line to its slot, solver iteration / evaluation / makespan stats |
| NEXT / SHIFT | go to the next shift (if unlocked) |
| AGAIN / RETRY | restart this shift |

**Doodads:**

| Word(s) | Effect |
|---|---|
| SPARK / WELD / WELDER | the welding booth behind the fence flashes blue and sprays sparks |
| OIL / GREASE | a tech oils the J2 gearboxes |
| LIGHTS / LAMP / LAMPS | dim / restore the high-bays (andons glow) |
| BREAK / LUNCH / VENDING | two operators walk to the vending machine |
| FORKLIFT | a forklift beeps past on the aisle (it stays out of the cell) |
| ALARM / SIREN | test alarm: every andon flashes red |
| COFFEE | steam at the vending machine |
| MUSIC / RADIO | the bench radio plays the factory jingle |
| DANCE / BOOGIE | idle arms trace a synchronised figure-8 (every keyframe IK-solved) |
| WAVE | a wave rolls from A1 to A2 |
| HELLO | both arms lift and wave at the camera |

**Intro / hints:** 3-line intro card; hints at 25 s (riddle: what happens when you type a sign?), 55 s
(nudge: type OPEN; SHAKE unburies, REFILL brings letters), 90 s (near answer: orders as one word, RESET
clears a JAM, GO resumes, FAST trades drops for speed).

**ROBOT SANDBOX** (scenes menu, sandbox shelf): same cell, no clock — type anything (up to 12
characters, Enter or a pause) and the robots set it; control words (SHAKE, REFILL, PLAN, FAST, DANCE …)
still work when typed on their own.

Wiring: `src/scenes/robot_factory.js` (level, vocabulary, scoring, HUD, PLAN overlay, forklift event,
sandbox), `robot_factory/cell.js` (engine-free cannon world + planner bridge + arm hub — node-tested),
`robot_factory/stage.js` (set dressing), `robot_factory/layout.js` (the placement table: every prop on
the floor or its support, no overlapping footprints — checked by `tests/test_robot5_level.js`).
Exposes `window.__llRobotStats = {placed, orders, faults}`.

Design decisions (LLF-78): glyphs are 180 mm (0.18 scale, the bin default) so ~20 lie in one tote layer;
the gripper uses a narrow-jaw finger set (110 mm open / 60 mm closed) so the 72 mm-thick glyphs fit;
glyphs lying in the tote collide as their CAD bounding box (60 jumbled CAD hull sets cost ~20 ms per
physics step) and switch to their real convex hulls the moment they are grasped, so pinch checks, slot
drops and settle verdicts run on true geometry; a vacuum-held glyph is carried horizontally into the
groove and released 85 mm up so it clears the 70 mm groove wall; idle arms park at a retracted home and
a mutual capsule-guard hold is broken by the empty-handed arm yielding.

## Hints & onboarding (LLF-87)

`src/core/hints.js` (global `Hints`) adds a play-ladder to every word-quest level. Level
definitions passed to `setGameMode` carry four extra fields:

- `objective` - one line, shown by the HELP word.
- `intro` - three short lines, shown as a dismissible card the first time a level is played
  (auto-closes after 20 s; seen flag `ll_intro_seen_<LEVEL NAME>` in localStorage, try/catch).
- `hints` - three tiers `{ after: secondsIdle, text }`: riddle, nudge, near-answer with first
  letters. "Idle" means no state-advancer word for that many seconds; typing an advancer resets it.
- `advancers` - the pipe keys of the state advancers (same strings as in `words`). Every other
  word is a doodad. The found list reads `Advancers x/N - Doodads y/M`.

Other behaviour: typing **HELP** shows the objective plus the current hint. If the buffer tail is
one edit (Levenshtein <= 1) from an undiscovered advancer of 4+ letters, an amber `close...`
flashes. Prefixes of the word never count, so typing STOKE does not flash at STOK.
Tests: `tests/test_llf-87.js`.

## How it's wired

- `setGameMode(def)` installs a level: `{ name, words, update() }` plus shared
  containers (tweens, flybys, weather, sky lerp) driven by `gameFrame()` each frame.
- Typing in a game level feeds `handleGameKey()` → `tryGameWords()` — longest
  dictionary hit at the buffer tail fires; the buffer clears and flashes blue.
- Shared doodad toolkit: `tween`, `flyby`, `puffBurst`, `setWeather`,
  `skyTo`, `makeGameTree`/`cycleSeason`, `birdsAcross`, `gameBeep`/`beeps`,
  `makeBoxMan`, `makeTextLabel`.
- The classic sandbox scenes are untouched; game levels sit at the top of the
  SCENES menu.

## Polish notes

- **Baked geometry:** Kyoto's rails, ties, house bodies, roofs, tree trunks and
  foliage are merged into single meshes via `BufferGeometryUtils` (hundreds of
  draw calls → a handful). Houses/trees place procedurally with clearance
  checks against both track curves and every landmark, so nothing clips.
- **Animated trees:** the merged foliage material gets a wind-sway vertex
  shader via `onBeforeCompile` — every tree waves continuously at zero JS cost;
  the WIND word gusts the same uniform.
- **Moon:** indexed sphere with deterministic displacement (no face cracks) and
  the real moon texture from the comet-rex project (`assets/moon_2k.jpg`,
  downscaled from `comet-rex/assets/8k_moon.jpg`); beacon and orbit ring use
  additive blending so they glow instead of darkening the sky.
- **Kyoto finale:** win requires the gates OPEN and a stop at the inner-line
  palace crossing; hints repeat so the last step is never a mystery. On
  victory the Shogun dismounts, walks the gates under a petal storm, and the
  camera pushes in.

## Letter materials (LLF-73)

Sandbox doodads: type a material word and every letter you spawn afterwards is made of it.
Look, mass, bounce, friction, impact sound and break behaviour all come from one table in
`src/core/materials.js`. Each scene starts with its own default (KYOTO = wood, SPACE = aluminium,
the robot factory = steel); other scenes leave letters as they were until you type a word.

| Word | Material | Density (kg/m3) | Bounce | Friction | Rings like |
|---|---|---|---|---|---|
| CHROME | mirror-polished steel | 7850 | 0.25 | 0.35 | steel |
| STEEL | brushed steel | 7850 | 0.25 | 0.4 | steel |
| BRASS | brass | 8500 | 0.2 | 0.4 | brass |
| ALUMINIUM | aluminium | 2700 | 0.3 | 0.35 | aluminium |
| WOOD | grained wood (procedural texture) | 600 | 0.4 | 0.6 | wood |
| RUBBER | rubber | 1100 | 0.8 | 0.9 | a damped thud |
| GLASS | glass | 2500 | 0.15 | 0.3 | aluminium-range ring |

- Mass is the letter's CAD volume times the density, so a STEEL letter is hundreds of times
  heavier than the default foam one and a RUBBER one bounces back up from a 3 m drop.
- GLASS shatters on a hard impact (6 m/s or more along the contact normal) into the usual
  letter-burst particles. On High and Ultra quality it renders with real transmission; lower tiers
  use a 50% transparent surface.
