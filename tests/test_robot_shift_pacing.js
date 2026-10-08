/**
 * LLF-80 (LLF-78 leftover a): ROBOT FACTORY shift-1 pacing, headless (node tests/test_robot_shift_pacing.js).
 *
 * A scripted player works shift 1 on the real RFCell physics + planner + motion (cannon devDependency, no
 * browser): it types each order as soon as the previous sign ships (reaction + typing time included), and when
 * the planner reports UNSAT and the arms have stalled it pulls the lever RFPacing.leverFor() names (REFILL with
 * RFPacing.refillCounts, the same call the scene makes, or SHAKE), switching levers if the same one just failed;
 * a JAM gets RESET. The run must finish inside the shift clock with about a quarter of it to spare, which is what
 * lands a first-time player at 4-5 minutes. Tuning lives in src/scenes/robot_factory/pacing.js.
 * Measured at tuning time (this player): seeds 1/2/3/6 = 219 / 255 / 255 / 261 s against the 330 s clock (5:30).
 * Env: LL_PACE_SEEDS=1,2,3 to run other seeds; LL_PACE_VERBOSE=1 for the lever log.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let CANNON = null;
try { CANNON = require('cannon'); } catch (e) { /* devDependency missing */ }
if (!CANNON) { console.error('FAIL cannon devDependency missing — run npm install'); process.exit(1); }
global.CANNON = CANNON;
const RFCell = require(path.join(ROOT, 'src/scenes/robot_factory/cell.js'));
const PACE = require(path.join(ROOT, 'src/scenes/robot_factory/pacing.js'));
const T = PACE.TUNING;
const PHYS = JSON.parse(rd('assets/cad/glyph_physics.json'));
const ctx = { console, CANNON, window: {}, Math };
vm.createContext(ctx);
vm.runInContext(rd('src/core/glyphs.js'), ctx, { filename: 'glyphs.js' });
const LG = ctx.window.LetterGlyphs; LG._setPhysics(PHYS);
const ARM_META = JSON.parse(rd('assets/cad/manifest.d/robot_arm.json'));
const SRC = rd('src/scenes/robot_factory.js');
const ORDERS = [...SRC.matchAll(/\{ orders: \[([^\]]+)\]/g)][0][1].match(/'([A-Z ]+)'/g).map(s => s.slice(1, -1));
const CLOCK = T.clocks[0];
const VERBOSE = !!process.env.LL_PACE_VERBOSE;

// player model (seconds)
const REACT = 1.5, TYPE_PER_LETTER = 0.3, SHIP_ANIM = 1.5, STALL = 2.5, LEVER_GAP = 5, SAME_LEVER_WINDOW = 20, DT = 1 / 30;

function playShift(seed) {
  const ev = [];
  const cell = RFCell.create({
    CANNON, seed, armMeta: ARM_META, baseSpeed: T.armSpeed,
    glyphEntry: ch => PHYS.glyphs[ch], hullShapes: (ch, s) => LG.buildHullShapes(PHYS.glyphs[ch], s),
    makeGlyph: (ch, s) => ({ body: new CANNON.Body({ mass: LG.massFor(ch, s, LG.DENSITY.foam) || 0.4 }) }),
    onEvent: (t, i) => ev.push({ t, i })
  });
  cell.startFill(RFCell.mergeCounts(RFCell.scrabbleStock(T.startStock), T.subsStock));
  let t = 0;
  while (cell.filling && t < 12) { cell.step(DT); t += DT; }
  const t0 = t, log = [], acts = [];
  let k = 0, typeAt = t + REACT + ORDERS[0].replace(/ /g, '').length * TYPE_PER_LETTER;
  let unsat = null, idleT = 0, lastLever = -1e9, lastKind = null;
  while (k < ORDERS.length && t - t0 < CLOCK * 1.25) {
    if (typeAt != null && t >= typeAt) { assert(cell.order(ORDERS[k], { id: k }), 'order accepted'); typeAt = null; }
    const cur = cell.current;
    const idle = cur && !cur.done && !cell.planner && !cell.holding &&
      !cell.arms.some(a => (a.path && a.job && a.job.kind !== 'park') || a.queue.length);
    idleT = idle && unsat ? idleT + DT : 0;
    if (idleT > STALL && t - lastLever > LEVER_GAP) {
      let lv = PACE.leverFor(unsat);
      if (lastKind === lv && t - lastLever < SAME_LEVER_WINDOW) lv = lv === 'shake' ? 'refill' : 'shake';
      if (lv === 'refill') {
        const open = cur.slots.filter(s => s.state === 'open').map(s => s.char);
        const rc = PACE.refillCounts(open, ORDERS.slice(k + 1, k + 3), cell.availability(), RFCell.scrabbleStock);
        cell.refill(rc.counts, { top: rc.top });
      } else cell.shake(2.5);
      cell.cancelQueued();
      if (VERBOSE) console.log(`    ${(t - t0).toFixed(0)} s ${lv} <- ${String(unsat).slice(0, 80)}`);
      lastLever = t; lastKind = lv; acts.push(lv); idleT = 0; unsat = null;
    }
    cell.step(DT); t += DT;
    while (ev.length) {
      const e = ev.shift();
      if (e.t === 'plan') unsat = e.i.unsat ? (e.i.reasons[0] || 'no plan') : null;
      else if (e.t === 'orderDone') {
        assert(cell.ship(), 'ship');
        log.push(ORDERS[k] + '@' + (t - t0).toFixed(0));
        k++;
        if (k < ORDERS.length) typeAt = t + SHIP_ANIM + REACT + ORDERS[k].replace(/ /g, '').length * TYPE_PER_LETTER;
      } else if (e.t === 'fault' && e.i.kind === 'jam') { cell.reset(); acts.push('reset'); }
    }
  }
  return { seed, done: k === ORDERS.length, time: t - t0, log, acts, tote: cell.bin.glyphs.length, stats: cell.stats };
}

const seeds = (process.env.LL_PACE_SEEDS || '2,6').split(',').map(Number);
let failures = 0;
const runs = [];
const w0 = Date.now();
for (const seed of seeds) {
  const r = playShift(seed);
  runs.push(r);
  const spare = 1 - r.time / CLOCK;
  console.log(`  seed ${seed}: ${r.done ? 'shift done' : 'NOT done'} in ${r.time.toFixed(0)} s of ${CLOCK} s (${(spare * 100).toFixed(0)} % spare) · ` +
    `${r.log.join(' ')} · levers ${r.acts.join(',') || 'none'} · tote ${r.tote} · placed ${r.stats.placed}`);
  try {
    assert(r.done, `seed ${seed}: the scripted player must finish shift 1 (got ${r.log.join(' ')})`);
    assert(spare >= 0.08, `seed ${seed}: only ${(spare * 100).toFixed(0)} % of the clock to spare (want >= 8 %)`);
  } catch (e) { failures++; console.error('  FAIL ' + e.message); }
}
const mean = runs.reduce((a, r) => a + (1 - r.time / CLOCK), 0) / runs.length;
try {
  assert(mean >= 0.15 && mean <= 0.40, `mean spare ${(mean * 100).toFixed(0)} % — tune RFPacing so the scripted run keeps ~25 % (15-40 %)`);
  assert(T.armSpeed > 0 && T.startStock >= 20, 'tuning sane');
} catch (e) { failures++; console.error('  FAIL ' + e.message); }
console.log(`\nshift-1 pacing: mean ${(mean * 100).toFixed(0)} % of the ${CLOCK} s clock to spare over seeds ${seeds.join(',')} (${((Date.now() - w0) / 1000).toFixed(0)} s wall)` +
  `\n${failures ? failures + ' failed' : 'all passed'}`);
process.exit(failures ? 1 : 0);
