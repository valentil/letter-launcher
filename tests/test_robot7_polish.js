/**
 * LLF-80 [Robot-7] ROBOT FACTORY polish (node tests/test_robot7_polish.js).
 *  sound:    servo whine pitch rises with joint speed and is silent at rest; joint-speed + smoothing helpers;
 *            the scene wires hiss (grasp/release by tool), modal clunk on place, conveyor hum, fault buzzer.
 *  andons:   RFStage.andonFor maps arm state -> green moving / amber waiting / amber flashing e-stop / red jam.
 *  director: fitCameraToBox really zoom-fits (every corner inside the frustum, and tight: a 5 % closer camera
 *            clips) for every camera at desktop and iPhone aspects; CLOSE word + Tab/Shift+C + touch button;
 *            close-ups own the camera in the LLHooks 'frame' hook; phone HUD (progress bar < 600 px, order strip).
 *  pacing:   RFPacing refill counts (open letters on top, upcoming misses, spares) and the lever advice.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('  ok   ' + name); }
  catch (e) { failures++; console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}

const SND = require(path.join(ROOT, 'src/scenes/robot_factory/sound.js'));
const DIR = require(path.join(ROOT, 'src/scenes/robot_factory/director.js'));
const PACE = require(path.join(ROOT, 'src/scenes/robot_factory/pacing.js'));
const STAGE = require(path.join(ROOT, 'src/scenes/robot_factory/stage.js'));
const L = require(path.join(ROOT, 'src/scenes/robot_factory/layout.js'));
const SRC = rd('src/scenes/robot_factory.js');
const html = rd('index.html');

// ------------------------------------------------------------------ sound
test('servo whine: silent at rest, pitch and level rise with joint speed, capped', () => {
  assert.strictEqual(SND.servoVoice(0).gain, 0);
  const a = SND.servoVoice(0.3), b = SND.servoVoice(1.5), c = SND.servoVoice(50);
  assert(a.freq < b.freq && b.freq < c.freq + 1e-9, 'pitch monotonic');
  assert(a.gain > 0 && b.gain >= a.gain && c.gain <= SND.SERVO.gainMax + 1e-12);
  assert(Math.abs(c.freq - SND.SERVO.fMax) < 1e-6, 'pitch capped at fMax');
  assert.strictEqual(SND.jointSpeed([0, 0, 0, 0, 0, 0], [0, 0.1, -0.3, 0, 0, 0], 0.1).toFixed(3), '3.000');
  assert.strictEqual(SND.jointSpeed(null, [1], 0.1), 0);
  let v = 0; for (let i = 0; i < 60; i++) v = SND.smooth(v, 1, 1 / 60, 0.12);
  assert(v > 0.99 && SND.smooth(0, 1, 1 / 60, 0.12) < 0.2, 'one-pole smoothing (filtered whine)');
});

test('scene wiring: hiss on grasp/release per tool, modal clunk on place, hum + buzzer each frame', () => {
  assert(/R\.snd\.hiss\(ha\.tool === 'vacuum' \? \(ht === 'grasp' \? 'vacuum-on' : 'vacuum-off'\) : 'jaw'\)/.test(SRC));
  assert(/R\.snd\.clunk\(info\.glyph\.ch/.test(SRC), 'clunk on placed');
  const sndSrc = rd('src/scenes/robot_factory/sound.js');
  assert(/LLModalAudio/.test(sndSrc) && /playImpact\(ch/.test(sndSrc), 'clunk uses the Forge-P3 modal synth');
  assert(/R\.snd\.update\(dt, cell\.arms, R\.ships\.some/.test(SRC), 'per-frame servo/hum/buzzer update');
  assert(/R\.snd\.dispose\(\)/.test(SRC), 'audio graph torn down with the scene');
  assert(/soundVolume/.test(sndSrc), 'bus follows the volume option');
});

// ------------------------------------------------------------------ andons
test('andons reflect arm state', () => {
  const cell = { estopped: false, holding: false, planner: null, current: null };
  const arm = { faulted: false, path: null, job: null, queue: [] };
  assert.deepStrictEqual(STAGE.andonFor(arm, cell), { state: 'green', flash: false }, 'idle, nothing to do');
  assert.deepStrictEqual(STAGE.andonFor({ ...arm, path: {}, job: { kind: 'place' } }, cell), { state: 'green', flash: false }, 'moving a job');
  const waiting = { ...cell, current: { done: false, slots: [{ state: 'open' }] }, planner: {} };
  assert.deepStrictEqual(STAGE.andonFor(arm, waiting), { state: 'amber', flash: false }, 'waiting on the solver');
  assert.deepStrictEqual(STAGE.andonFor(arm, { ...cell, holding: true }), { state: 'amber', flash: false }, 'tote settling');
  assert.deepStrictEqual(STAGE.andonFor(arm, { ...cell, estopped: true }), { state: 'amber', flash: true }, 'e-stop');
  assert.deepStrictEqual(STAGE.andonFor({ ...arm, faulted: true }, { ...cell, estopped: true }), { state: 'red', flash: true }, 'jam wins');
  assert.deepStrictEqual(STAGE.andonFor(arm, cell, true), { state: 'red', flash: true }, 'ALARM doodad');
  assert(/RFStage\.andonFor\(a, cell/.test(SRC));
});

// ------------------------------------------------------------------ director: zoom-fit
function rbox(x0, y0, z0, x1, y1, z1) { return { min: [Math.min(x0, x1), Math.min(z0, z1), Math.min(-y0, -y1)], max: [Math.max(x0, x1), Math.max(z0, z1), Math.max(-y0, -y1)] }; }
const SUBJECTS = {
  BIN: { box: rbox(-0.61, -1.03, 0.6, 0.61, -0.21, 1.1), dir: [0, 1, 0.4] },
  TRAY: { box: rbox(-1.72, 0.375, 0.62, 1.72, 0.625, 0.98), dir: [0, 1, 1] },
  A1: { box: rbox(-1.5, -1.02, 0, 0, 0.65, 1.9), dir: [-0.75, 1.05, 0.6] },
  A2: { box: rbox(0, -1.02, 0, 1.5, 0.65, 1.9), dir: [0.75, 1.05, 0.6] }
};
test('fitCameraToBox zoom-fits each close-up at desktop and iPhone aspects (inside, and tight)', () => {
  [16 / 9, 800 / 450, 390 / 844, 844 / 390].forEach(aspect => {
    Object.keys(SUBJECTS).forEach(k => {
      const s = SUBJECTS[k], f = DIR.fitCameraToBox(s.box, s.dir, 75, aspect, 1.0);
      assert(DIR.boxInView(s.box, f.pos, f.look, 75, aspect), `${k} @${aspect.toFixed(2)} fully in view`);
      const n = Math.hypot(...s.dir).valueOf(), u = s.dir.map(v => v / n), d = f.dist * 0.95;
      const closer = f.look.map((c, i) => c + u[i] * d);
      assert(!DIR.boxInView(s.box, closer, f.look, 75, aspect), `${k} @${aspect.toFixed(2)} is tight (5 % closer clips)`);
    });
  });
  // portrait needs a longer throw than landscape for the wide tray
  const T = SUBJECTS.TRAY;
  assert(DIR.fitCameraToBox(T.box, T.dir, 75, 390 / 844).dist > DIR.fitCameraToBox(T.box, T.dir, 75, 16 / 9).dist * 1.5);
});

test('director: five cameras, CLOSE word + Tab/Shift+C keys + touch button, close-ups own the camera', () => {
  assert.deepStrictEqual(DIR.CAMS, ['OVERVIEW', 'A1', 'A2', 'BIN', 'TRAY']);
  assert.strictEqual(DIR.nextCam(4, 1), 0); assert.strictEqual(DIR.nextCam(0, -1), 4);
  assert(/'CLOSE\|CAMERA': cycleCamera/.test(SRC), 'CLOSE word cycles');
  assert(/e\.key === 'Tab'/.test(SRC) && /e\.key === 'C' && e\.shiftKey/.test(SRC), 'Tab / Shift+C cycle (plain c still types COFFEE, CLEAR, ...)');
  assert(/LLHooks\.on\('frame', function \(\) \{ if \(R && R\.dir\) R\.dir\.frameHook\(\); \}\)/.test(SRC), 'frame hook');
  const dsrc = rd('src/scenes/robot_factory/director.js');
  assert(/rfCamBtn/.test(dsrc) && /min-width:48px;min-height:48px/.test(dsrc), 'touch camera button (48 px)');
  assert(/fitCameraToBox\(s\.box, s\.dir/.test(dsrc), 'every close-up goes through fitCameraToBox');
  assert(/occlusionMap\(\)/.test(dsrc) && /heatColor\(/.test(dsrc), 'bin cam occlusion heat overlay');
  assert.strictEqual(DIR.heatColor(1), 'rgb(0,220,40)'); assert.strictEqual(DIR.heatColor(0), 'rgb(255,0,40)');
});

test('phone HUD: Gantt -> progress bar under 600 px, compact order strip', () => {
  assert.strictEqual(DIR.NARROW_PX, 600);
  const dsrc = rd('src/scenes/robot_factory/director.js');
  assert(/R\.gantt\.style\.display = R\.planOn && !n/.test(dsrc) && /rfProgress/.test(dsrc));
  const orders = [{ key: 'OPEN', state: 'shipped' }, { key: 'SALE', state: 'active' }, { key: 'EXIT', state: 'queued' }, { key: 'PIZZA', state: 'waiting' }];
  const cur = { slots: [{ state: 'set' }, { state: 'set' }, { state: 'open' }, { state: 'job' }] };
  assert.strictEqual(DIR.orderStrip(orders, cur), 'OPEN ✓ · SALE 2/4 · EXIT … · PIZZA');
});

test('index.html: pacing/sound/director load after stage.js and before robot_factory.js', () => {
  const ix = f => html.indexOf('src="src/scenes/robot_factory/' + f + '"');
  const a = [ix('stage.js'), ix('pacing.js'), ix('sound.js'), ix('director.js'), html.indexOf('src="src/scenes/robot_factory.js"')];
  a.forEach((v, k) => assert(v > 0, 'tag ' + k));
  for (let k = 1; k < a.length; k++) assert(a[k] > a[k - 1], 'order ' + k);
});

// ------------------------------------------------------------------ pacing helpers
test('RFPacing: refill pours the open letters (+spare) on top and covers upcoming misses; lever advice', () => {
  const T = PACE.TUNING;
  const r = PACE.refillCounts(['P'], ['SALE'], { S: 1, A: 0, L: 3, E: 2 }, n => ({ E: n }));   // stock 6 < lowStock: handful added
  assert.strictEqual(r.top.P, 1 + T.refillSpare);
  assert.strictEqual(r.top.A, 1 + T.refillSpare, 'upcoming SALE misses an A');
  assert(!r.top.S && !r.top.L && !r.top.E, 'nothing for letters already in stock');
  assert.deepStrictEqual(r.counts, T.refillExtra > 0 ? { E: T.refillExtra } : {});
  const full = PACE.refillCounts(['P'], [], { E: 40 }, n => ({ E: n }));
  assert.deepStrictEqual(full.counts, {}, 'no handful into a full tote (refills must not snowball)');
  assert.strictEqual(PACE.leverFor('bin empty of P'), 'refill');
  assert.strictEqual(PACE.leverFor('need 2 × L but only 1 usable in the bin'), 'refill');
  assert.strictEqual(PACE.leverFor('no P can be gripped — standing on edge'), 'shake');
  assert.strictEqual(PACE.leverFor('every E is buried and no arm can lift off what is on top of it'), 'refill', 'refill lays fresh copies on top');
  assert.strictEqual(PACE.leverFor('placing order and stacking order contradict each other'), 'shake');
  assert(T.clocks.length === 3 && T.clocks.every(c => c >= 180 && c <= 600));
  assert(/RFPacing\.refillCounts\(open, words/.test(SRC) && /baseSpeed: PACE\.armSpeed/.test(SRC), 'scene reads the tuning');
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
