/**
 * LLF-76 — Robot-3 pick-and-place constraint planner (src/robot/planner.js).
 * Run: node tests/test_robot3_planner.js   (seeded, deterministic, no deps)
 */
'use strict';
const assert = require('assert');
const path = require('path');
const RP = require(path.join(__dirname, '..', 'src', 'robot', 'planner.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}

// ---- shared scene: bin around y=0, tray row at y=420, two zones -----------
const ZONES = [
  { id: 'bin',  min: { x: -50, y: -150, z: -10 }, max: { x: 650, y: 150, z: 300 } },
  { id: 'tray', min: { x: -50, y: 380,  z: -10 }, max: { x: 650, y: 470, z: 300 } }
];
function arm(id, x, extra) {
  const basePose = { x, y: 210, z: 0 };
  return Object.assign({ id, basePose, toolType: 'pinch', tools: ['pinch', 'vacuum'],
    reachable: RP.sphereShellReach(basePose, 40, 520), discardPose: { x, y: 250, z: 0 } }, extra || {});
}
function rng(seed) { return RP._mulberry32(seed); }
// scatter glyphs on a grid in the bin, well spaced so pinch works
function bin(chars, seed) {
  const r = rng(seed || 7);
  const cells = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) cells.push({ x: 20 + i * 50, y: -90 + j * 60 });
  // seeded shuffle
  for (let i = cells.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [cells[i], cells[k]] = [cells[k], cells[i]]; }
  return chars.split('').map((c, i) => ({ id: 'g' + i + c, char: c, pose: { x: cells[i].x, y: cells[i].y, z: 0 }, upright: false, occludedBy: [] }));
}
function assertValid(res, slots) {
  assert.deepStrictEqual(RP.zoneViolations(res), [], 'zone intervals overlap');
  const places = res.schedule.filter(j => j.kind === 'place');
  const glyphIds = new Set();
  places.forEach(j => { assert.ok(!glyphIds.has(j.glyphId), 'glyph used twice ' + j.glyphId); glyphIds.add(j.glyphId); });
  assert.strictEqual(places.length, slots.length, 'every slot filled');
  places.forEach(j => {
    const s = slots.find(x => x.id === j.slot);
    assert.ok(j.char === s.char || RP.SUBSTITUTES[s.char] === j.char, 'char mismatch ' + j.char + ' in ' + s.char);
    assert.ok(j.tPlace > j.tPick, 'place after pick');
  });
  // an arm never does two jobs at once
  const byArm = {};
  res.schedule.forEach(j => (byArm[j.armId] = byArm[j.armId] || []).push(j));
  Object.values(byArm).forEach(list => {
    list.sort((a, b) => a.tPick - b.tPick);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].tPick >= list[i - 1].tEnd - 1e-9, 'arm double-booked');
  });
}

console.log('Running tests for LLF-76 (robot planner)...');

test('(a) HELLO with 2 arms + exact letters -> valid schedule, zone intervals never overlap', () => {
  const p = RP.createPlanner({ words: 'HELLO', glyphs: bin('HELLOXQ'), arms: [arm('A', 120), arm('B', 420)], zones: ZONES, options: { seed: 3 } });
  const res = p.solve();
  assert.strictEqual(res.status, 'solved', JSON.stringify(res.reasons));
  assertValid(res, p.slots);
  assert.strictEqual(res.stats.substitutes, 0);
  assert.ok(new Set(res.schedule.map(j => j.armId)).size === 2, 'both arms used');
  assert.ok(res.stats.makespan > 0 && res.stats.iterations > 0);
  // the two arms really did contend for the shared bin zone (non-trivial check)
  const binZone = res.zones.find(z => z.zone === 'bin');
  assert.ok(new Set(binZone.intervals.map(i => i.armId)).size === 2);
});

test('(b) missing O with a 0 present -> uses substitute', () => {
  const p = RP.createPlanner({ words: 'HELLO', glyphs: bin('HELL0'), arms: [arm('A', 120), arm('B', 420)], zones: ZONES });
  const res = p.solve();
  assert.strictEqual(res.status, 'solved');
  const o = res.schedule.find(j => j.slotChar === 'O');
  assert.strictEqual(o.char, '0');
  assert.strictEqual(o.substitute, true);
  assert.strictEqual(res.stats.substitutes, 1);
  assertValid(res, p.slots);
  // a real O is preferred over the substitute when both exist
  const res2 = RP.plan({ words: 'HELLO', glyphs: bin('HELL0O'), arms: [arm('A', 120), arm('B', 420)], zones: ZONES });
  assert.strictEqual(res2.stats.substitutes, 0);
});

test('(c) missing Q with none -> unsat reason mentions Q', () => {
  const res = RP.plan({ words: 'QUIZ', glyphs: bin('UIZ0'), arms: [arm('A', 120), arm('B', 420)], zones: ZONES });
  assert.strictEqual(res.status, 'unsat');
  assert.ok(res.reasons.some(r => /\bQ\b/.test(r) && /bin empty of Q/.test(r)), JSON.stringify(res.reasons));
  assert.deepStrictEqual(res.unfilled, ['0:0']);
  // the rest still gets a partial schedule
  assert.strictEqual(res.schedule.filter(j => j.kind === 'place').length, 3);
  // unreachable letter -> 'no E reachable'
  const g = bin('HLLO').concat([{ id: 'farE', char: 'E', pose: { x: 3000, y: 0, z: 0 } }]);
  const r2 = RP.plan({ words: 'HELLO', glyphs: g, arms: [arm('A', 120), arm('B', 420)], zones: ZONES });
  assert.ok(r2.reasons.some(r => /no E reachable/.test(r)), JSON.stringify(r2.reasons));
  // shortage
  const r3 = RP.plan({ words: 'HELLO', glyphs: bin('HELO'), arms: [arm('A', 120)], zones: ZONES });
  assert.ok(r3.reasons.some(r => /need 2 × L but only 1/.test(r)), JSON.stringify(r3.reasons));
});

test('(d) occluded letter not picked until occluder removed (precedence emerges)', () => {
  // E is buried under X (not needed) which sits under K (not needed); H is buried under L (needed).
  const glyphs = RP.computeOcclusion([
    { id: 'E', char: 'E', pose: { x: 200, y: 0, z: 0 } },
    { id: 'X', char: 'X', pose: { x: 205, y: 5, z: 12 } },
    { id: 'K', char: 'K', pose: { x: 198, y: -4, z: 24 } },
    { id: 'H', char: 'H', pose: { x: 400, y: 0, z: 0 } },
    { id: 'L1', char: 'L', pose: { x: 402, y: 3, z: 12 } },
    { id: 'L2', char: 'L', pose: { x: 50, y: 90, z: 0 } },
    { id: 'O', char: 'O', pose: { x: 550, y: -90, z: 0 } }
  ]);
  assert.deepStrictEqual(glyphs.find(g => g.id === 'E').occludedBy.sort(), ['K', 'X']);
  const res = RP.plan({ words: 'HELLO', glyphs, arms: [arm('A', 120), arm('B', 420)], zones: ZONES, options: { seed: 5 } });
  assert.strictEqual(res.status, 'solved', JSON.stringify(res.reasons));
  const job = id => res.schedule.find(j => j.glyphId === id);
  assert.ok(job('X') && job('X').kind === 'clear', 'X cleared to discard');
  assert.ok(job('K') && job('K').kind === 'clear', 'K cleared to discard');
  assert.ok(job('E').tPick >= job('X').tPick + RP.DEFAULTS.pickTime - 1e-9, 'E after X lifted');
  assert.ok(job('X').tPick >= job('K').tPick + RP.DEFAULTS.pickTime - 1e-9, 'X after K lifted');
  assert.ok(job('H').tPick >= job('L1').tPick + RP.DEFAULTS.pickTime - 1e-9, 'H after L1 lifted');
  assert.strictEqual(job('L1').kind, 'place', 'needed occluder is used, not discarded');
  assert.deepStrictEqual(RP.zoneViolations(res), []);
  // buried with nowhere to put the occluder -> human-readable reason
  const noDiscard = [arm('A', 120, { discardPose: null }), arm('B', 420, { discardPose: null })];
  const r2 = RP.plan({ words: 'E', glyphs, arms: noDiscard, zones: ZONES });
  assert.strictEqual(r2.status, 'unsat');
  assert.ok(r2.reasons.some(r => /every E is buried/.test(r)), JSON.stringify(r2.reasons));
});

test('(e) 4 arms, 12-letter phrase solves < 50 ms total in node', () => {
  const phrase = 'ROBOT FACTORY'; // 12 letters
  const glyphs = bin('ROBOTFACTORYXJWQEEN', 11);
  const arms = [arm('A', 60), arm('B', 220), arm('C', 380), arm('D', 540)];
  const t0 = process.hrtime.bigint();
  const p = RP.createPlanner({ words: phrase, glyphs, arms, zones: ZONES, options: { seed: 9 } });
  const res = p.solve();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(res.status, 'solved', JSON.stringify(res.reasons));
  assert.strictEqual(p.slots.length, 12);
  assertValid(res, p.slots);
  console.log('       12 letters / 4 arms: ' + ms.toFixed(1) + ' ms, ' + res.stats.iterations + ' iterations, makespan ' + res.stats.makespan.toFixed(2) + ' s');
  assert.ok(ms < 50, 'took ' + ms.toFixed(1) + ' ms');
});

test('seeded determinism + time-sliced generator gives the same answer as solve()', () => {
  const mk = () => RP.createPlanner({ words: 'ROBOT FACTORY', glyphs: bin('ROBOTFACTORYXJWQEEN', 11),
    arms: [arm('A', 60), arm('B', 220), arm('C', 380), arm('D', 540)], zones: ZONES, options: { seed: 9 } });
  const full = mk().solve();
  const again = mk().solve();
  assert.deepStrictEqual(again.schedule, full.schedule);
  // slice with a fake clock: each step gets exactly 3 generator ticks
  let tick = 0;
  const p = RP.createPlanner({ words: 'ROBOT FACTORY', glyphs: bin('ROBOTFACTORYXJWQEEN', 11),
    arms: [arm('A', 60), arm('B', 220), arm('C', 380), arm('D', 540)], zones: ZONES, options: { seed: 9, now: () => tick++ } });
  let r, slices = 0;
  do { r = p.step(3); slices++; assert.ok(slices < 10000); if (!p.done) assert.strictEqual(r.status, 'running'); } while (!p.done);
  assert.ok(slices > 5, 'actually sliced');
  assert.deepStrictEqual(r.schedule, full.schedule);
  // HUD stats present
  ['iterations', 'conflicts', 'makespan', 'substitutes', 'toolChanges', 'phase', 'slices'].forEach(k => assert.ok(k in r.stats, k));
  // real-clock slices stay inside a frame budget
  const q = mk(); let worst = 0;
  while (!q.done) { const t = process.hrtime.bigint(); q.step(4); worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6); }
  assert.ok(worst < 16, 'worst slice ' + worst.toFixed(2) + ' ms');
});

test('grasp rules: vacuum needs a flat face up, pinch needs jaw clearance, tool change counted', () => {
  // an upright E jammed between neighbours: no pinch (clearance) and no vacuum (on edge)
  const jam = [
    { id: 'E', char: 'E', pose: { x: 200, y: 0, z: 0 }, upright: true },
    { id: 'N1', char: 'N', pose: { x: 245, y: 0, z: 0 } },
    { id: 'N2', char: 'N', pose: { x: 155, y: 0, z: 0 } }
  ];
  const r = RP.plan({ words: 'E', glyphs: jam, arms: [arm('A', 120)], zones: ZONES });
  assert.strictEqual(r.status, 'unsat');
  assert.ok(r.reasons.some(x => /can be gripped/.test(x)), JSON.stringify(r.reasons));
  // lying flat but crowded -> vacuum only -> pinch arm must change tool once
  const flat = jam.map(g => Object.assign({}, g, { upright: false }));
  const r2 = RP.plan({ words: 'E', glyphs: flat, arms: [arm('A', 120)], zones: ZONES });
  assert.strictEqual(r2.status, 'solved');
  assert.strictEqual(r2.schedule[0].grasp, 'vacuum');
  assert.strictEqual(r2.stats.toolChanges, 1);
  // pinch-only arm can't do it
  const r3 = RP.plan({ words: 'E', glyphs: flat, arms: [arm('A', 120, { tools: ['pinch'] })], zones: ZONES });
  assert.strictEqual(r3.status, 'unsat');
});

test('left-to-right precedence option orders the placements', () => {
  const res = RP.plan({ words: 'HELLO', glyphs: bin('HELLO'), arms: [arm('A', 120), arm('B', 420)], zones: ZONES, options: { leftToRight: true } });
  assert.strictEqual(res.status, 'solved');
  const places = res.schedule.filter(j => j.kind === 'place').sort((a, b) => a.slotIndex - b.slotIndex);
  for (let i = 1; i < places.length; i++) assert.ok(places[i].tPlace >= places[i - 1].tPlace, 'slot ' + i + ' placed before slot ' + (i - 1));
});

if (failures) { console.error('❌ LLF-76: ' + failures + ' test(s) failed'); process.exit(1); }
console.log('✅ LLF-76: robot planner tests passed');
