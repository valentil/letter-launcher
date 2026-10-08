# Hooks: add features without touching core files

`src/core/hooks.js` defines a tiny event bus, `window.LLHooks`:

```js
LLHooks.on(evt, fn);        // register (returns fn)
LLHooks.off(evt, fn);       // unregister
LLHooks.emit(evt, ...args); // core files only; true if any handler returned true
```

Every handler runs inside try/catch, so a broken feature can't stop the game loop
(the first error per handler is logged to the console).

## Rule for new lanes

**Register from your own file. Do not add hook lines to `engine.js`, `menu.js`,
`scene_swap.js` or `letters.js`.** Parallel branches that each added a one-line
call at the same spot in those files could not be rebased (LLF-91 cleaned that up).

1. Put the feature in its own file, e.g. `src/core/myfeature.js`.
2. At the bottom of that file, register:
   ```js
   if (typeof LLHooks !== 'undefined') {
       LLHooks.on('frame', function (dt, now) { updateMyFeature(dt); });
       LLHooks.on('keydown', function (e) { return myFeatureKey(e); }); // true = consumed
   }
   ```
   The `typeof` guard keeps the file loadable in node/vm tests. If registration
   needs state that only exists after `init()`, register from `src/main.js` instead.
3. Add your `<script src="src/core/myfeature.js">` tag next to the other feature
   tags (after `src/scenes/*`, before `src/robot/*`). `hooks.js` already loads right
   after `engine.js`, so it is always defined by then. index.html is union-merged.
4. In tests, check the registration in your file (`LLHooks.on('frame'`), not a line in
   a core file.

If you need an event that doesn't exist, add ONE `LLHooks.emit(...)` to the core file
in its own small ticket, and list it here.

## Events

| Event | Args | Emitted from | Return `true` to |
|---|---|---|---|
| `frame` | `dt` (s, fixed 0.016), `now` (ms) | `engine.js` `animate()`, after the camera lerp, just before render | — |
| `keydown` | `e` | `menu.js` `onKeyDown`, before Escape/menu handling | consume the key (e.g. ride eats Escape) |
| `keyup` | `e` | `menu.js` `onKeyUp`, after the LLF-12 rain release | — |
| `mousedown` | `e` | `menu.js` `onMouseDown`, first line | consume the click |
| `mousemove` | `e` | `menu.js` `onMouseMove`, after `mouse` / parallax are updated | — |
| `mouseup` | `e` | `menu.js` `onMouseUp`, first line | consume |
| `letterKey` | `char`, `now`, `opts` | `menu.js`, a letter/digit key while playing, before `spawnLetter` | — (mutate `opts`: `scale`, `impulse`, `toneGain`) |
| `letterSpawned` | `char`, `letterObj` (`{mesh, body}`), `opts` | `menu.js`, right after the typed letter spawns | — |
| `typed` | `inputBuffer` | `menu.js`, after each typed letter is appended to the buffer | consume: the buffer is cleared and word matching is skipped (e.g. STAMPEDE) |
| `word` | `word` | `menu.js`, when the dictionary matcher recognises a word (longest match) | — |
| `beforeSceneSwap` | — | `scene_swap.js` `clearSceneGeometry()`, first line | — |
| `afterSceneBuild` | `sceneName` | `scene_swap.js` `buildScene()`, after the builder finished | — |

Bodies a feature drives itself (riding, stampede) can set `pb.hookDriven = true` so the
engine's built-in zoo-animal wander leaves them alone.

## Who uses it

- `rhythm.js` (LLF-6): `letterKey`, `letterSpawned`, `frame`
- `stampede.js` (LLF-8): `typed`, `frame`
- `constellations.js` (LLF-9): `mousedown`, `keydown`, `frame`, `beforeSceneSwap`
- `ride.js` (LLF-10): `frame`, `keydown`, `typed`, `mousedown`, `mouseup`, `beforeSceneSwap`
- `keyforce.js` (LLF-11): `letterKey`, `letterSpawned`, `keyup`, `frame`
- `sculpt.js` (LLF-14): `mousedown` (alt+left only), `mouseup`, `frame`, `typed` (UNWELD / BREAK), `word`, `beforeSceneSwap`

## Never edit a shared index file; one file per asset/feature

Parallel lanes only merge cleanly when they touch different files. Never edit a shared
index file; one file per asset/feature. CAD assets each get their own
`assets/cad/manifest.d/<name>.json` (there is no `assets/cad/manifest.json` any more,
and `check_manifest.js` fails if one reappears); features register through `LLHooks`
from their own file. LLF-104 had to hand-port six finished branches (robot workcell,
glyphs, waterworks, moon rocket, Kyoto, sandbox kit) because each appended entries to
the old single `manifest.json`. If you need a list of things, make the directory the
list. The append-only exceptions are `index.html` (union-merged) and
`tools/cad/materials.json`; add new keys at the end and never reformat existing ones.
