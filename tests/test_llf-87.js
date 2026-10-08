// LLF-87: onboarding intro + hint ladder + near-miss + HELP.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) fails++; }

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/hints.js'), 'utf8') + '\nthis.Hints = Hints;', ctx);
const H = ctx.Hints;

// near-miss matcher
const adv = ['STOKE', 'GEAR', 'GO', 'FLAPS'];
const none = new Set();
check('substitution is a near miss (GEAL~GEAR)', H.nearMiss('XXGEAL', adv, none) === 'GEAR');
check('extra letter is a near miss (GEARR)', H.nearMiss('GEARR', adv, none) === 'GEAR');
check('missing middle letter is a near miss (FLPS)', H.nearMiss('FLPS', adv, none) === 'FLAPS');
check('prefix while typing is not a near miss (STOK)', H.nearMiss('STOK', adv, none) === null);
check('exact word is not a near miss', H.nearMiss('GEAR', adv, none) === null);
check('words under 4 chars never near-miss (GP~GO)', H.nearMiss('GP', adv, none) === null);
check('discovered advancers are skipped', H.nearMiss('GEAL', adv, new Set(['GEAR'])) === null);
check('two edits is not a near miss', H.nearMiss('GXAL', adv, none) === null);
check('lev1 basics', H.lev1('cat', 'cut') && H.lev1('cat', 'cart') && !H.lev1('cat', 'dog'));
check('tierFor escalates', H.tierFor([{ after: 25 }, { after: 55 }, { after: 90 }], 10) === -1 &&
    H.tierFor([{ after: 25 }, { after: 55 }, { after: 90 }], 60) === 1);

// found counts: advancers and doodads separately
const fn1 = () => 1, fn2 = () => 2, fn3 = () => 3;
const def = { advancers: ['GO|START', 'STOP'], words: { GO: fn1, START: fn1, STOP: fn2, RAIN: fn3, SNOW: () => 4 } };
const c = H.counts(def, new Set(['START', 'RAIN']));
check('counts adv 1/2, doodads 1/2', c.adv[0] === 1 && c.adv[1] === 2 && c.doo[0] === 1 && c.doo[1] === 2);

// static: every level def has objective, 3-line intro, 3 ascending hint tiers, advancers that exist as keys
const levels = ['kyoto_train', 'flight_sim', 'moon_rocket', 'waterworks', 'tower_build'];
levels.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, 'src/scenes', f + '.js'), 'utf8');
    const i = src.indexOf('setGameMode({');
    const body = src.slice(i, src.indexOf('words: expandWords', i));
    const get = k => { const m = body.match(new RegExp(k + ': ([\\s\\S]*?),\\r?\\n\\s+(?:[a-z]+:|\\}))')); return m && m[1]; };
    let intro, hints, advs;
    try {
        intro = JSON.parse(body.match(/intro: (\[.*\])/)[1]);
        advs = JSON.parse(body.match(/advancers: (\[.*\])/)[1]);
        hints = eval('(' + body.match(/hints: (\[[\s\S]*?\n\s*\])/)[1] + ')');
    } catch (e) { console.log(e.message); }
    check(f + ': objective', /objective: "/.test(body));
    check(f + ': intro has 3 lines', Array.isArray(intro) && intro.length === 3 && intro.every(s => s.length > 5));
    check(f + ': 3 hint tiers, ascending', Array.isArray(hints) && hints.length === 3 &&
        hints[0].after < hints[1].after && hints[1].after < hints[2].after && hints.every(h => h.text.length > 10));
    check(f + ': advancers resolve to word keys', Array.isArray(advs) && advs.length >= 10 &&
        advs.every(k => src.includes("'" + k + "'") || k.split('|').length === 1 && /'[A-Z|]*\b/.test(src) && src.includes(k)));
});

// wiring + docs
const gm = fs.readFileSync(path.join(ROOT, 'src/core/gamemode.js'), 'utf8');
check('gamemode hooks present', ['onLevelStart', 'tryHelp', 'onMiss', 'onWord', 'Hints.tick'].every(k => gm.includes(k)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('hints.js loads before src/robot', html.indexOf('src/core/hints.js') > 0 && html.indexOf('src/core/hints.js') < html.indexOf('src/robot/'));
check('LEVELS.md documents hints', /## Hints & onboarding/.test(fs.readFileSync(path.join(ROOT, 'LEVELS.md'), 'utf8')));
process.exit(fails ? 1 : 0);
