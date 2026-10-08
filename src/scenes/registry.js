// Letter Launcher — src/scenes/registry.js
// Scene registry (LLF-67). Every src/scenes/<name>.js registers itself:
//     SCENES['NAME'] = { build: createXScene, kind: 'level' | 'sandbox', menuOrder: n };
// The SCENES menu (scenesItems / GAME_LEVEL_NAMES) and selectCurrentScene() are driven
// from this map, so a new map (e.g. Robot Factory) is one new scene file plus its
// <script> tag in index.html, and nothing else. Loaded before the scene files.
var SCENES = window.SCENES || {};
window.SCENES = SCENES;

// Registered scene names, ordered by menuOrder (then name).
function sceneRegistryNames() {
    return Object.keys(SCENES)
        .filter(n => SCENES[n] && typeof SCENES[n].build === 'function')
        .sort((a, b) => ((SCENES[a].menuOrder ?? 999) - (SCENES[b].menuOrder ?? 999)) || a.localeCompare(b));
}

// Rebuild the scenes-menu list from the registry: word-quest levels ('level') land on
// the top shelf via GAME_LEVEL_NAMES, sandbox scenes below, BACK last. Wrapped so a bad
// registration can never break the menu (it keeps the built-in defaults instead).
function syncScenesFromRegistry() {
    try {
        const names = sceneRegistryNames();
        if (!names.length) return;
        scenesItems = names.concat(['BACK']);
        GAME_LEVEL_NAMES.splice(0, GAME_LEVEL_NAMES.length, ...names.filter(n => SCENES[n].kind === 'level'));
    } catch (e) {
        console.warn('Letter Launcher: syncScenesFromRegistry failed', e);
    }
}
