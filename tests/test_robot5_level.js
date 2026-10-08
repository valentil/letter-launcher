/**
 * LLF-78 [Robot-5] ROBOT FACTORY map (node tests/test_robot5_level.js).
 *  static: registry entries (+ sandbox, smokeWords), script-tag order, every state advancer wired through
 *          setGameMode words, no word fires early while typing another, hooks registered in our own file,
 *          LEVELS.md section 6 with the full vocabulary, intro + 3 hint tiers, Progress shift API,
 *          window.__llRobotStats; layout table: no floaters, no colliding footprints, every CAD asset exists.
 *  planner: per-glyph grasp whitelists (vacuum only face-up, pinch only upright; clear jobs may vacuum a face-down glyph).
 *  physics (cannon devDependency): the RFCell pours its stock, plans OPEN and the robots stand real glyphs in
 *          the tray slots (COM inside the slot footprint), ships the word; SHAKE / STOP / RESET / REFILL levers.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('  ok   ' + name); }
  catch (e) { failures++; console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}

const SRC = rd('src/scenes/robot_factory.js');
const LEVELS = rd('LEVELS.md');
const html = rd('index.html');
const L = require(path.join(ROOT, 'src/scenes/robot_factory/layout.js'));

// ------------------------------------------------------------------ static wiring
test('registry: ROBOT FACTORY is a level with smoke words, ROBOT SANDBOX a sandbox', () => {
  assert(/SCENES\['ROBOT FACTORY'\]\s*=\s*\{\s*build:\s*RobotFactory\.buildFactory,\s*kind:\s*'level'/.test(SRC));
  assert(/SCENES\['ROBOT SANDBOX'\]\s*=\s*\{\s*build:\s*RobotFactory\.buildSandbox,\s*kind:\s*'sandbox'/.test(SRC));
  assert(/smokeWords:\s*\['OPEN',\s*'PLAN',\s*'SHAKE'\]/.test(SRC), 'browser smoke words OPEN, PLAN, SHAKE');
});

test('index.html: robot_factory scripts load after src/robot/ and before main.js, in dependency order', () => {
  const order = ['src/robot/bin.js', 'src/scenes/robot_factory/layout.js', 'src/scenes/robot_factory/cell.js',
    'src/scenes/robot_factory/stage.js', 'src/scenes/robot_factory.js', 'src/main.js'].map(f => html.indexOf('src="' + f + '"'));
  order.forEach((i, k) => assert(i > 0, 'missing tag #' + k));
  for (let k = 1; k < order.length; k++) assert(order[k] > order[k - 1], 'tag order at #' + k);
});

// every word key in the level definition: 'A|B|C': fn
const def = SRC.slice(SRC.indexOf('function levelDef('), SRC.indexOf('// ---------------------------------------------------------------- orders'));
const groups = [...def.matchAll(/'([A-Z|]+)':\s*/g)].map(m => m[1]);
const ADVANCERS = ['REFILL|HOPPER|FILL', 'SHAKE|VIBRATE|JIGGLE', 'RESET|CLEAR|FIX', 'SWAP|TOOL|CHANGE', 'FAST|FASTER|HURRY',
  'SLOW|SLOWER|CAREFUL', 'NORMAL|NOMINAL', 'STOP|ESTOP|HALT', 'GO|RUN|RESUME', 'PLAN|SOLVER|GANTT', 'NEXT|SHIFT', 'AGAIN|RETRY'];
const DOODADS = ['SPARK|WELD|WELDER', 'OIL|GREASE', 'LIGHTS|LAMP|LAMPS', 'BREAK|LUNCH|VENDING', 'FORKLIFT', 'ALARM|SIREN', 'COFFEE',
  'MUSIC|RADIO', 'DANCE|BOOGIE', 'WAVE', 'HELLO'];

test('every state advancer + doodad is a setGameMode word (expandWords) and the orders are words too', () => {
  ADVANCERS.concat(DOODADS).forEach(k => assert(groups.includes(k), 'word group ' + k));
  assert(/setGameMode\(levelDef\(/.test(SRC) && /words:\s*expandWords\(words\)/.test(def), 'setGameMode(levelDef) with expandWords');
  assert(/adv\[o\.key\]\s*=\s*function/.test(def) && /advancers\.unshift\(o\.key\)/.test(def), 'each shift order is an advancer word');
  assert(/advancers:\s*advancers/.test(def) && /var advancers = Object\.keys\(adv\)/.test(def), 'advancers list = the adv map keys');
});

// orders for every shift (typed without spaces)
const shifts = [...SRC.matchAll(/\{ orders: \[([^\]]+)\]/g)].map(m => m[1].match(/'([A-Z ]+)'/g).map(s => s.slice(1, -1)));
test('three shifts of five orders, each fits the 12-slot tray', () => {
  assert.strictEqual(shifts.length, 3);
  shifts.forEach(s => { assert.strictEqual(s.length, 5); s.forEach(w => assert(w.length <= 12, w)); });
  assert.deepStrictEqual(shifts[0], ['OPEN', 'SALE', 'EXIT', 'PIZZA', 'WELCOME HOME']);
});

test('no word fires early while another is being typed (longest-match is only checked at the buffer end)', () => {
  const allGroups = groups.concat(['HELP']);
  shifts.forEach(orders => {
    const gs = allGroups.concat(orders.map(o => o.replace(/ /g, '')));
    const words = []; gs.forEach((g, gi) => g.split('|').forEach(w => words.push({ w, g: gi })));
    words.forEach(a => words.forEach(b => {
      if (a.g === b.g || a.w === b.w || a.w.length < 2) return;
      for (let k = a.w.length; k < b.w.length; k++) {   // prefixes of b (shorter than b) that end with a
        assert(!b.w.slice(0, k).endsWith(a.w), `typing ${b.w} fires ${a.w} first`);
      }
    }));
  });
});

test('hooks registered from our own file; no core file edited for the map', () => {
  assert(/LLHooks\.on\('keydown'/.test(SRC) && /LLHooks\.on\('beforeSceneSwap'/.test(SRC));
  ['src/core/engine.js', 'src/core/menu.js', 'src/core/scene_swap.js', 'src/core/letters.js']
    .forEach(f => assert(!/RobotFactory|RFCell|robot_factory/.test(rd(f)), f + ' mentions the map'));
});

test('intro (3 lines), three ascending hint tiers, objective', () => {
  const intro = JSON.parse(def.match(/intro: (\[.*\])/)[1]);
  assert.strictEqual(intro.length, 3);
  const hints = eval('(' + def.match(/hints: (\[[\s\S]*?\n\s*\])/)[1] + ')');
  assert(hints.length === 3 && hints[0].after < hints[1].after && hints[1].after < hints[2].after);
  assert(/objective: "/.test(def));
});

test('Progress shift API + __llRobotStats + PLAN overlay pieces', () => {
  assert(/Progress\.recordShift\(NAME, R\.shift/.test(SRC) && /Progress\.isUnlocked\(NAME/.test(SRC));
  assert(/window\.__llRobotStats = stats/.test(SRC) && /placed: 0, orders: 0, faults: 0/.test(SRC));
  assert(/rfGantt/.test(SRC) && /rfSolver/.test(SRC), 'Gantt + solver stats DOM');
  const stage = rd('src/scenes/robot_factory/stage.js');
  assert(/st\.shells = /.test(stage) && /SphereGeometry\(r/.test(stage), 'reach shells');
  assert(/linePool/.test(SRC) && /TorusGeometry/.test(SRC), 'chosen-glyph highlight + line to its slot');
  assert(/CanvasTexture/.test(stage) && /drawBoard/.test(SRC), 'order board is a canvas texture');
});

test('LEVELS.md section 6 documents the map with advancers + doodads', () => {
  const i = LEVELS.indexOf('## 6. ROBOT FACTORY');
  assert(i > 0, 'section heading');
  const sec = LEVELS.slice(i, LEVELS.indexOf('\n## ', i + 5));
  ['REFILL', 'SHAKE', 'RESET', 'SWAP', 'FAST', 'SLOW', 'STOP', 'GO', 'PLAN', 'NEXT', 'AGAIN', 'SPARK', 'OIL', 'LIGHTS', 'BREAK', 'FORKLIFT',
    'ALARM', 'COFFEE', 'MUSIC', 'DANCE', 'WAVE', 'HELLO', 'WELCOMEHOME', 'ROBOT SANDBOX'].forEach(w => assert(sec.includes(w), 'LEVELS.md section 6 mentions ' + w));
  assert(/State advancers/.test(sec) && /Doodads/.test(sec));
});

// ------------------------------------------------------------------ layout table
test('layout: every prop on the floor or on its support, no colliding footprints, CAD assets exist', () => {
  assert.deepStrictEqual(L.overlaps(), []);
  assert.deepStrictEqual(L.unsupported(), []);
  L.PROPS.forEach(p => { if (p.asset) assert(fs.existsSync(path.join(ROOT, 'assets/cad/manifest.d', p.asset + '.json')), p.asset); });
  // arms stand on the 555 mm pedestals (wrist limits cannot reach bin + tray from the floor)
  L.PROPS.filter(p => /^arm_/.test(p.id)).forEach(p => assert(p.on && /^pedestal_/.test(p.on) && p.z === 0.555));
  // the tote sits between the pedestals, the tray behind them, the conveyor behind the tray, all inside the fence
  ['bin', 'tray', 'conveyor', 'crate', 'pedestal_A1', 'pedestal_A2'].forEach(id => {
    const f = L.footprint(L.byId(id));
    assert(f.minX > -L.FENCE_X && f.maxX < L.FENCE_X && f.maxY < L.FENCE_Y && f.minY > L.CURTAIN_Y, id + ' inside the cell');
  });
  L.HANGING.forEach(h => assert(h.hangFrom === 'truss' && h.zTop < L.ROOF, h.id + ' hangs from the truss'));
});

// ------------------------------------------------------------------ planner grasp whitelist (LLF-78 addition)
const P = require(path.join(ROOT, 'src/robot/planner.js'));
test('planner honours per-glyph grasp whitelists (place) and clearGrasps (dig)', () => {
  const arm = { id: 'A1', basePose: { x: 0, y: 0, z: 0 }, reachable: () => true, tools: ['vacuum', 'pinch'], toolType: 'vacuum', discardPose: { x: 300, y: 0, z: 0 } };
  const glyphs = [
    { id: 'g0', char: 'A', pose: { x: 100, y: 0, z: 10 }, flatUp: true, grasps: [], clearGrasps: ['vacuum'] },          // face-down-ish: dig only
    { id: 'g1', char: 'A', pose: { x: 300, y: 300, z: 10 }, flatUp: true, grasps: ['vacuum'] }
  ];
  const r = P.plan({ words: 'A', glyphs, arms: [arm], options: { seed: 3 } });
  assert.strictEqual(r.status, 'solved');
  assert.strictEqual(r.schedule.filter(j => j.kind === 'place')[0].glyphId, 'g1', 'the whitelisted glyph is placed');
  const r2 = P.plan({ words: 'A', glyphs: [glyphs[0]], arms: [arm], options: { seed: 3 } });
  assert.strictEqual(r2.status, 'unsat', 'a glyph with no place grasps cannot be placed');
});

// ------------------------------------------------------------------ physics: the cell end to end
let CANNON = null;
try { CANNON = require('cannon'); } catch (e) { /* devDependency missing */ }
if (!CANNON) { console.error('  FAIL cannon devDependency missing — run npm install'); failures++; }
else {
  global.CANNON = CANNON;
  const RFCell = require(path.join(ROOT, 'src/scenes/robot_factory/cell.js'));
  const PHYS = JSON.parse(rd('assets/cad/glyph_physics.json'));
  const ctx = { console, CANNON, window: {}, Math };
  vm.createContext(ctx);
  vm.runInContext(rd('src/core/glyphs.js'), ctx, { filename: 'glyphs.js' });
  const LG = ctx.window.LetterGlyphs; LG._setPhysics(PHYS);
  const ARM_META = JSON.parse(rd('assets/cad/manifest.d/robot_arm.json'));
  function makeCell(seed, events) {
    return RFCell.create({
      CANNON, seed, armMeta: ARM_META,
      glyphEntry: ch => PHYS.glyphs[ch], hullShapes: (ch, s) => LG.buildHullShapes(PHYS.glyphs[ch], s),
      makeGlyph: (ch, s) => ({ body: new CANNON.Body({ mass: LG.massFor(ch, s, LG.DENSITY.foam) || 0.4 }) }),
      onEvent: (t, i) => events && events.push({ t, i })
    });
  }
  function run(cell, seconds, until) { for (let t = 0; t < seconds; t += 1 / 30) { cell.step(1 / 30); if (until && until()) return true; } return false; }

  test('RFCell: Scrabble stock helper keeps every letter and hits the size', () => {
    const s = RFCell.scrabbleStock(40);
    assert.strictEqual(Object.values(s).reduce((a, b) => a + b, 0), 40);
    assert(s.E > s.Z && s.Z === 1 && Object.keys(s).length === 26);
  });

  test("RFCell: pour the stock, plan OPEN, robots stand glyphs in the tray slots and ship the word", () => {
    const ev = [];
    const cell = makeCell(8, ev);
    cell.startFill(RFCell.scrabbleStock(40));
    assert(run(cell, 8, () => !cell.filling), 'fill settles');
    assert(cell.bin.glyphs.length >= 38, 'stock in the tote: ' + cell.bin.glyphs.length);
    assert(cell.order('OPEN', { id: 0 }));
    const done = run(cell, 70, () => cell.current && cell.current.done);
    const types = ev.map(e => e.t);
    assert(types.includes('plan'), 'planner ran');
    const plan = ev.find(e => e.t === 'plan').i;
    assert(plan.jobs.length >= 1 && plan.input.glyphs.length > 10, 'schedule produced from the tote state');
    assert(cell.stats.placed >= 1, 'at least one glyph set: ' + JSON.stringify(cell.stats));
    // every set glyph really stands in its slot
    cell.current.slots.filter(s => s.state === 'set').forEach(s => {
      const p = s.glyph.body.position, c = s.slot.center;     // physics (x, z_r, -y_r)
      assert(Math.abs(p.x - c[0]) <= s.slot.halfX + 0.01 && Math.abs(-p.z - c[1]) <= s.slot.halfY + 0.03 && p.y > c[2], s.char + ' inside its slot');
    });
    assert(done, 'OPEN completed within 70 s sim: ' + cell.current.slots.map(s => s.char + ':' + s.state).join(' '));
    const shipped = cell.ship();
    assert(shipped && shipped.glyphs.length === 4 && !cell.current, 'shipped and tray freed');
    assert(cell.slots.every(s => s.state === 'free'));
  });

  test('RFCell levers: SHAKE holds the arms and vibrates, STOP freezes the arms, REFILL pours through the hopper, RESET clears a jam', () => {
    const cell = makeCell(5, []);
    cell.startFill(RFCell.scrabbleStock(30));
    run(cell, 8, () => !cell.filling);
    const n0 = cell.bin.glyphs.length;
    cell.shake(1.0);
    assert(cell.holding && cell.bin.isVibrating(), 'shake holds + vibrates');
    run(cell, 3);
    assert(!cell.bin.isVibrating());
    cell.estop(true);
    const t0 = cell.hub.time; run(cell, 1);
    assert.strictEqual(cell.hub.time, t0, 'e-stop freezes the arm clock');
    cell.estop(false);
    cell.refill({ Z: 2, Q: 1 });
    run(cell, 6);
    assert.strictEqual(cell.bin.glyphs.length, n0 + 3, 'hopper delivered 3 glyphs into the tote');
    cell.arms[0].faulted = true;
    assert(cell.reset() && !cell.arms[0].faulted, 'reset clears the fault');
    cell.setSpeed(9); assert.strictEqual(cell.speed, 1.5, 'speed override clamps to 150%');
  });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
