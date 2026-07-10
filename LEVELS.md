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
| TAKEOFF / FLY | leave the home field (gear auto-retracts after) |
| LAND | final approach — only near target, gear down, flaps out |
| LEFT · RIGHT | bank 45° |
| TURN / AROUND | 180° |
| HIGHER / CLIMB · LOWER / DESCEND / DIVE | altitude ±5 |
| FAST / THROTTLE / BOOST · SLOW / CRUISE | airspeed |
| GEAR / WHEELS | toggle landing gear |
| FLAPS | toggle flaps (slows you; needed to land) |
| AUTOPILOT / AUTO | track the target city automatically |
| OSAKA (N) · PARIS (E) · CAIRO (S) · RIO (W) | set destination; its beacon lights |

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

**State advancers (10):**

| Word(s) | Effect |
|---|---|
| LAUNCH / IGNITE / BLAST / LIFTOFF | ascend from the pad (burns fuel) |
| STAGE / SEPARATE / JETTISON | drop the booster (required for orbit) |
| ORBIT / CIRCLE | circularize (needs altitude + staging) |
| BOOST / BURN | raise the orbit (burns fuel) |
| RETRO / BRAKE / SLOW | de-orbit burn (required before landing) |
| LAND / TOUCHDOWN | descend — only above the pad |
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
