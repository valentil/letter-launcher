# Letter Launcher

[![Made with FeatureBoard](https://img.shields.io/badge/Made_with-FeatureBoard-00c8ff?style=flat-square)](https://featureboard.ai) [![License: MIT](https://img.shields.io/badge/License-MIT-3fb950?style=flat-square)](./LICENSE)

A playful **3D typographic toy** built with **Three.js** and **Cannon.js** physics. Type on your keyboard and letters spawn as physics bodies that bounce, collide, and stack. Type whole words to trigger gravity wells; middle-click to shatter letters into glowing particles; type animal names (`LION`, `GIRAFFE`, `ELEPHANT`) to spawn low-poly zoo animals that wander the scene. Each keystroke also plays a spatial-audio tone, turning typing into an instrument. Runs entirely client-side.

> One of the example projects built with [FeatureBoard](https://featureboard.ai).

## Live demo

Open `index.html` in a modern browser.

## Features (implemented)

- Dynamic physics letters (rigid bodies, collisions, impulse on click)
- Word-shape **gravity wells** that cluster loose letters
- **Letter explosion** on middle-click (particles + force-field pulse)
- **Musical keystroke synthesis** — per-key spatial audio tones
- **Reactive zoo animals** that spawn on typed names and wander/animate
- **Firework paintbrush** trails; **time-dilation** slow-mo on spacebar

## What's inside

| File | Role |
|------|------|
| `index.html` | Thin page shell: HUD elements, dictionary loader and the ordered `<script src>` tags (no build step) |
| `src/core/*.js` | Engine, play area, scene swap, enrichment, audio, letters, word-quest game mode, menus/input |
| `src/scenes/*.js` | One file per scene; each registers itself in `window.SCENES` (`src/scenes/registry.js`) — a new map is one file + one script tag |
| `dictionary.txt` | ~370k-word list powering word/combo detection (fetched at runtime) |
| `tools/cad/`, `assets/cad/` | CAD asset pipeline (LLF-69): NativeCAD recipes -> LOD'd GLBs + `manifest.json`, loaded in game by `src/core/assetlib.js` (`AssetLib.place`). Start at `tools/cad/README.md`; `tools/cad/viewer.html` previews every asset |
| `combo_dino_fixed.glb` | Low-poly model used by the scene |
| `tests/` | Feature + regression test specs (`llf-*`, `llb-*`); run all with `npm test` (`tests/legacy/` holds stale specs for the old launcher.html, not run) |

> Note: the original ran against a server route (`/api/dictionary`); this standalone build fetches the bundled `dictionary.txt` instead, so it works fully client-side.

## Tech

- Three.js (WebGL rendering), Cannon.js (physics), Web Audio API (spatial tones)

## License

MIT © Lewis Valentine

## The AI-native approach

Built the FeatureBoard way — see [How We Build](https://featureboard.ai/approach.html):

- **Planning & metadata as substrate** — 40+ tracked features in `featurelist.md` drive the build.
- **Validation over review** — 83 generated test specs, one per feature/bug.
- **Reduce to an AI judgement** — typed-word detection maps free text onto game actions.
