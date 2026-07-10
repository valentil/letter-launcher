// Word-Quest levels: structural regression test.
// Verifies the game framework, the five levels, their menu wiring, and the
// input-buffer HUD are all present in index.html.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function check(name, cond) {
    if (cond) console.log('PASS', name);
    else { failures++; console.error('FAIL', name); }
}

// Framework
check('setGameMode defined', /function setGameMode\(/.test(html));
check('gameFrame defined', /function gameFrame\(/.test(html));
check('expandWords defined', /function expandWords\(/.test(html));
check('tryGameWords longest-match', /function tryGameWords\(/.test(html));
check('handleGameKey defined', /function handleGameKey\(/.test(html));
check('word HUD element', /id="wordHud"/.test(html));
check('objective HUD element', /id="objectiveHud"/.test(html));
check('banner element', /id="gameBanner"/.test(html));
check('buffer glow green->orange', /135 - 110 \* bufferHeat/.test(html));
check('buffer success flash blue', /#4da6ff/.test(html));
check('season doodad helper', /function cycleSeason\(/.test(html));

// Levels + menu wiring
const levels = [
    ['KYOTO TRAIN', 'createKyotoTrainScene'],
    ['FLIGHT SIM', 'createFlightSimScene'],
    ['MOON ROCKET', 'createMoonRocketScene'],
    ['WATERWORKS', 'createWaterworksScene'],
    ['TOWER BUILD', 'createTowerBuildScene']
];
levels.forEach(([label, fn]) => {
    check(fn + ' defined', new RegExp('function ' + fn + '\\(').test(html));
    check(label + ' in scenes menu', html.includes("'" + label + "'"));
    check(label + ' in builders map', new RegExp("'" + label + "':\\s*" + fn).test(html));
});
check('game levels listed before classic scenes',
    html.indexOf("'KYOTO TRAIN'") < html.indexOf("'COASTAL CITY'"));

// Per-level word tables: a few state advancers + doodads each
[
    ["'GO|START|CHOO|DEPART|ONWARD'", "'SWITCH|POINTS|TRACKS'", "'TREE|TREES|SAKURA'", "'NINJA'"],
    ["'TAKEOFF|FLY'", "'AUTOPILOT|AUTO'", "'BLIMP|ZEPPELIN'", "'UFO'"],
    ["'LAUNCH|IGNITE|BLAST|LIFTOFF'", "'STAGE|SEPARATE|JETTISON'", "'COMET|REX'", "'AURORA'"],
    ["'WATER|FLOW|POUR|OPEN'", "'FIX|PATCH|WRENCH|REPAIR'", "'DUCK'", "'WHIRLPOOL|VORTEX'"],
    ["'DROP|PLACE|RELEASE'", "'WELD|FUSE|FIX'", "'JACKHAMMER'", "'CONE|CONES'"]
].forEach((words, i) => {
    words.forEach(w => check(levels[i][0] + ' word ' + w, html.includes(w)));
});

// Win conditions
check('kyoto win', html.includes('THE SHOGUN REACHES THE PALACE'));
check('flight win', html.includes('WELCOME TO '));
check('rocket win', html.includes('ONE SMALL LAP FOR ROCKETKIND'));
check('water win', html.includes('MASTER PLUMBER'));
check('tower win', html.includes('TOWER TOPPED OUT'));

// Integration points
check('keydown routes to game', /if \(gameMode\) \{\s*handleGameKey\(e\.key\);/.test(html));
check('animate runs gameFrame', /if \(gameMode\) gameFrame\(\);/.test(html));
check('scene swap clears gameMode', /gameMode = null;/.test(html));
check('boot moved after declarations', html.lastIndexOf('init();') > html.indexOf('function animate('));

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('All word-level checks passed.');
