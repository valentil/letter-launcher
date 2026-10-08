// LLF-67 (Forge-00): layout guard for the index.html -> src/ split.
//  - index.html stays a thin shell (< 400 lines, no inline game code)
//  - every src/**/*.js file passes `node --check`
//  - every scene from the old hard-coded builders map is registered in window.SCENES
//  - the registry rebuilds the scenes menu in the original order
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { srcFiles, readAllSource, ROOT } = require('./_src');

let failures = 0;
function check(name, cond, extra) {
    if (cond) console.log('PASS', name);
    else { failures++; console.error('FAIL', name, extra || ''); }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlLines = html.split('\n').length;
check('index.html < 400 lines (' + htmlLines + ')', htmlLines < 400);
check('index.html has no inline animate/init', !/function (animate|init)\s*\(/.test(html));

const files = srcFiles();
const expected = ['src/core/engine.js', 'src/core/playarea.js', 'src/core/scene_swap.js', 'src/core/enrich.js',
    'src/core/audio.js', 'src/core/letters.js', 'src/core/gamemode.js', 'src/core/menu.js', 'src/scenes/registry.js', 'src/main.js'];
expected.forEach(f => check(f + ' exists + loaded by index.html', files.includes(f) && fs.existsSync(path.join(ROOT, f))));
check('registry loads before every scene file',
    files.filter(f => f.startsWith('src/scenes/') && f !== 'src/scenes/registry.js')
        .every(f => files.indexOf(f) > files.indexOf('src/scenes/registry.js')));
check('main.js (boot) loads last', files[files.length - 1] === 'src/main.js');

files.forEach(f => {
    let ok = true, err = '';
    try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
    catch (e) { ok = false; err = String(e.stderr || e.message).split('\n').slice(0, 3).join(' '); }
    check('node --check ' + f, ok, err);
});

const builders = {
    'KYOTO TRAIN': 'createKyotoTrainScene', 'FLIGHT SIM': 'createFlightSimScene',
    'MOON ROCKET': 'createMoonRocketScene', 'WATERWORKS': 'createWaterworksScene',
    'TOWER BUILD': 'createTowerBuildScene', 'WILD WEST': 'createWildWestScene',
    'COASTAL CITY': 'createCoastalCityScene', 'DESERT': 'createDesertScene',
    'SPACE': 'createSpaceScene', 'CITY': 'createCityScene', 'FOREST': 'createForestScene'
};
const all = readAllSource();
Object.entries(builders).forEach(([name, fn]) => {
    const re = new RegExp("SCENES\\['" + name + "'\\]\\s*=\\s*\\{\\s*build:\\s*" + fn + "\\b");
    check(name + ' registered as SCENES entry building ' + fn, re.test(all));
});
check('old hard-coded builders map removed', !/const builders\s*=\s*\{/.test(all));

// Load every src file (except the boot) into one context with permissive stubs: proves
// no load-time cross-file ordering bugs (TDZ, missing globals) and that the registry
// reproduces the original scenes-menu order.
function stub() {
    const f = function () { return p; };
    const p = new Proxy(f, {
        get: (t, k) => k === Symbol.toPrimitive ? () => 0 : (k === 'then' ? undefined : p),
        apply: () => p, construct: () => p, set: () => true
    });
    return p;
}
const ctx = { console, Math, setTimeout, clearTimeout, THREE: stub(), CANNON: stub(), document: stub(),
    navigator: stub(), performance: { now: () => 0 }, requestAnimationFrame: () => 0 };
ctx.window = ctx;
vm.createContext(ctx);
let loadErr = null;
try {
    files.filter(f => f !== 'src/main.js')
        .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
    vm.runInContext('syncScenesFromRegistry(); globalThis.__menu = scenesItems.slice(); globalThis.__levels = GAME_LEVEL_NAMES.slice();', ctx);
} catch (e) { loadErr = e; }
check('all src files load together without errors', !loadErr, loadErr && loadErr.message);
if (!loadErr) {
    check('scenes menu order preserved', JSON.stringify(ctx.__menu) === JSON.stringify(['KYOTO TRAIN', 'FLIGHT SIM', 'MOON ROCKET',
        'WATERWORKS', 'TOWER BUILD', 'ROBOT FACTORY', 'COASTAL CITY', 'DESERT', 'SPACE', 'CITY', 'FOREST', 'WILD WEST', 'ROBOT SANDBOX', 'BACK']), JSON.stringify(ctx.__menu));
    check('word-quest levels from registry kind', JSON.stringify(ctx.__levels) === JSON.stringify(['KYOTO TRAIN', 'FLIGHT SIM',
        'MOON ROCKET', 'WATERWORKS', 'TOWER BUILD', 'ROBOT FACTORY']), JSON.stringify(ctx.__levels));
}

if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('test_forge00_layout: all checks passed');
