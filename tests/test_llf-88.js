// LLF-88: progression merge logic, stars, shift unlocks, wiring, in-memory fallback.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0;
function check(n, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fails++; }
const ctx = { window: {} }; // no localStorage: exercises the in-memory fallback
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/progress.js'), 'utf8') + '\nthis.Progress = Progress;', ctx);
const P = ctx.Progress;
const m = P.merge({ completed: true, bestTimeS: 90, stars: 2, wordsFound: ['A'] }, { completed: true, bestTimeS: 70, stars: 1, wordsFound: ['B', 'A'] });
check('better time wins', m.bestTimeS === 70);
check('stars max', m.stars === 2);
check('words union', m.wordsFound.length === 2);
check('zero time does not beat real time', P.merge({ bestTimeS: 50 }, { bestTimeS: 0 }).bestTimeS === 50);
check('stars: finish=1', P.starsFor(500, 180, 0, 5) === 1);
check('stars: under par=2', P.starsFor(100, 180, 2, 5) === 2);
check('stars: all doodads=3', P.starsFor(500, 180, 5, 5) === 3);
check('fmtTime', P.fmtTime(83) === '1:23' && P.fmtTime(0) === '--:--');
P._reset();
P.record('KYOTO TRAIN', { completed: true, bestTimeS: 100, stars: 2 });
P.record('KYOTO TRAIN', { completed: true, bestTimeS: 120, stars: 1 });
const g = P.get('KYOTO TRAIN');
check('record merges in memory without localStorage', g.bestTimeS === 100 && g.stars === 2);
check('unplayed level default', P.get('NOPE').stars === 0 && !P.get('NOPE').completed);
check('shift 1 always unlocked', P.isUnlocked('ROBOT FACTORY', 1));
check('shift 2/3 locked initially', !P.isUnlocked('ROBOT FACTORY', 2) && !P.isUnlocked('ROBOT FACTORY', 3));
P.recordShift('ROBOT FACTORY', 1, { completed: true, bestTimeS: 60, stars: 1 });
check('shift 2/3 unlock after shift 1 star', P.isUnlocked('ROBOT FACTORY', 2) && P.isUnlocked('ROBOT FACTORY', 3));
check('shift 4 does not exist', !P.isUnlocked('ROBOT FACTORY', 4));
check('other maps ungated', P.isUnlocked('KYOTO TRAIN', 2));
P.flags.robotFactoryShiftGating = false;
check('gating flag off unlocks', P.isUnlocked('ROBOT FACTORY', 3));
// throwing localStorage must not break
const c2 = { window: { get localStorage() { throw new Error('private'); } } }; vm.createContext(c2);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/progress.js'), 'utf8') + '\nthis.Progress = Progress;', c2);
check('private browsing safe', c2.Progress.record('X', { completed: true, bestTimeS: 5, stars: 1 }).stars === 1);
// static wiring
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
check('index.html loads progress.js before robot', rd('index.html').indexOf('src/core/progress.js') > 0 && rd('index.html').indexOf('src/core/progress.js') < rd('index.html').indexOf('src/robot/'));
check('gamemode hooks', /Progress\.onStart/.test(rd('src/core/gamemode.js')) && /Progress\.onWin/.test(rd('src/core/gamemode.js')));
check('menu reads SCENES-driven labels via decorateCard', /Progress\.decorateCard\(tv, label/.test(rd('src/core/menu.js')) && /syncScenesFromRegistry/.test(rd('src/core/menu.js')));
process.exit(fails ? 1 : 0);
