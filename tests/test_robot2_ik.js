/**
 * LLF-75 [Robot-2] — kinematics tests (node tests/test_robot2_ik.js)
 * 500 random reachable poses round-trip fk(ik(p)) within 0.5 mm / 0.1 deg, limits honoured,
 * singular pose handled by DLS without NaN, unreachable poses rejected fast (<0.2 ms avg).
 * Prints a BENCH {...} JSON line for log_benchmark suite 'robot-ik'.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const K = require(path.join(__dirname, '..', 'src', 'robot', 'kinematics.js'));

const DEG = Math.PI / 180;
const POS_TOL = 0.5e-3, ROT_TOL = 0.1 * DEG;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + ': ' + (e && e.stack || e)); }
}
// deterministic RNG (mulberry32)
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const now = () => Number(process.hrtime.bigint()) / 1e6;
const finite = (q) => q.every(Number.isFinite);
const bench = {};

console.log('LLF-75 robot kinematics');

test('default chain is analytic-capable and ~1.42 m reach', () => {
  const g = K.DEFAULT_CHAIN.geom;
  assert.ok(K.DEFAULT_CHAIN.analytic);
  const reach = g.a1 + g.reachMax;
  assert.ok(reach > 1.38 && reach < 1.48, 'wrist-centre reach ' + reach);
});

test('fk home pose: flange ahead and above base', () => {
  const T = K.fk([0, 0, 0, 0, 0, 0]);
  // home: upper arm vertical, forearm horizontal along +X, flange pointing +X
  assert.ok(Math.abs(T[3] - (0.150 + 0.660 + 0.100)) < 1e-9, 'x ' + T[3]);
  assert.ok(Math.abs(T[7]) < 1e-9);
  assert.ok(Math.abs(T[11] - (0.450 + 0.610 + 0.100)) < 1e-9, 'z ' + T[11]);
  assert.ok(Math.abs(T[2] - 1) < 1e-9, 'flange z axis along +X');
  assert.strictEqual(K.fkAll([0, 0, 0, 0, 0, 0]).length, 8);
});

test('500 random reachable poses round-trip within 0.5 mm / 0.1 deg, limits honoured', () => {
  const r = rng(75);
  let maxPos = 0, maxRot = 0, nAnalytic = 0, nDls = 0, tSum = 0, fails = [];
  for (let i = 0; i < 500; i++) {
    const qTrue = K.randomQ(r);
    const T = K.fk(qTrue);
    const seed = K.randomQ(r);
    const t0 = now();
    const res = K.ik(T, seed);
    tSum += now() - t0;
    if (!res) { fails.push('null at ' + i); continue; }
    assert.ok(finite(res.q), 'NaN in q');
    assert.ok(K.withinLimits(res.q), 'limits violated at ' + i + ': ' + res.q.map(x => (x / DEG).toFixed(1)));
    const e = K.poseError(T, K.fk(res.q));
    maxPos = Math.max(maxPos, e.pos); maxRot = Math.max(maxRot, e.rot);
    if (e.pos > POS_TOL || e.rot > ROT_TOL) fails.push(i + ' err ' + (e.pos * 1000).toFixed(3) + 'mm ' + (e.rot / DEG).toFixed(3) + 'deg via ' + res.method);
    res.method === 'analytic' ? nAnalytic++ : nDls++;
  }
  bench.roundTripPoses = 500; bench.roundTripFailures = fails.length;
  bench.maxPosErrMm = +(maxPos * 1000).toExponential(3); bench.maxRotErrDeg = +(maxRot / DEG).toExponential(3);
  bench.analyticShare = nAnalytic / 500; bench.dlsCount = nDls; bench.meanIkMs = +(tSum / 500).toFixed(4);
  assert.strictEqual(fails.length, 0, fails.slice(0, 5).join('; '));
});

test('analytic returns multiple valid configurations, nearest to seed chosen', () => {
  const q = [20 * DEG, 30 * DEG, -20 * DEG, 40 * DEG, 50 * DEG, 10 * DEG];
  const T = K.fk(q);
  const raw = K.ikAnalyticAll(T, q).solutions;
  assert.ok(raw.length >= 4 && raw.length <= 8, 'raw solutions ' + raw.length);
  raw.forEach((s) => { const e = K.poseError(T, K.fk(s.q)); assert.ok(e.pos < 1e-9 && e.rot < 1e-9, 'raw sol off ' + e.pos + ' ' + e.rot); });
  const a = K.ikAnalytic(T, q);
  assert.ok(a.solutions.length >= 2);
  a.q.forEach((v, i) => assert.ok(Math.abs(v - q[i]) < 1e-9, 'seed-nearest should equal original'));
});

test('singular pose (wrist aligned, J5=0) -> DLS solution, no NaN, accurate', () => {
  const q = [10 * DEG, 20 * DEG, 10 * DEG, 30 * DEG, 0, -15 * DEG];
  const T = K.fk(q);
  const res = K.ik(T, [0, 0, 0, 0, 0, 0]);
  assert.ok(res, 'null');
  assert.strictEqual(res.method, 'dls');
  assert.ok(finite(res.q) && K.withinLimits(res.q));
  assert.ok(res.posErr < POS_TOL && res.rotErr < ROT_TOL, res.posErr + ' ' + res.rotErr);
  assert.ok(K.manipulability(q) < 1e-9, 'manipulability should vanish at wrist singularity');
  assert.ok(K.manipulability([0, 30 * DEG, -30 * DEG, 0, 45 * DEG, 0]) > 1e-3);
});

test('ikDLS alone converges from a perturbed seed near singularity, never NaN', () => {
  const q = [-30 * DEG, 40 * DEG, -10 * DEG, 0, 0.5 * DEG, 0];
  const T = K.fk(q);
  const seed = q.map((v, i) => v + (i % 2 ? 0.15 : -0.15));
  const d = K.ikDLS(T, seed, { iters: 60, lambda: 0.05 });
  assert.ok(finite(d.q));
  assert.ok(d.posErr < POS_TOL && d.rotErr < ROT_TOL, (d.posErr * 1000).toFixed(3) + 'mm ' + (d.rotErr / DEG).toFixed(3) + 'deg after ' + d.iters);
  bench.dlsItersNearSingular = d.iters;
});

test('shoulder singularity (wrist centre on J1 axis) solved without NaN', () => {
  // wrist centre straight above base (x=y=0): take an arm config placing it there, then a comfortable wrist
  const probe = K.poseFromXYZRPY(0, 0, 1.1, Math.PI, 0, 0); // wrist centre at z=1.2
  const arm = K.ikAnalyticAll(probe, [0, 0, 0, 0, 0, 0]).solutions
    .find((s) => K.withinLimits([s.q[0], s.q[1], s.q[2], 0, 0, 0]));
  assert.ok(arm, 'no arm config with wrist centre on axis');
  const qs = [arm.q[0], arm.q[1], arm.q[2], 20 * DEG, 60 * DEG, -10 * DEG];
  const T = K.fk(qs);
  const res = K.ik(T, [0.3, 0, 0, 0, 0, 0]);
  assert.ok(res, 'should be reachable');
  assert.ok(finite(res.q) && K.withinLimits(res.q));
  assert.ok(res.posErr < POS_TOL && res.rotErr < ROT_TOL);
});

test('unreachable poses return null fast (<0.2 ms avg)', () => {
  const r = rng(7);
  const poses = [];
  for (let i = 0; i < 1000; i++) {
    const a = r() * 2 * Math.PI, rad = 2.0 + r() * 3;
    poses.push(K.poseFromXYZRPY(rad * Math.cos(a), rad * Math.sin(a), r() * 3 - 1, r(), r(), r()));
  }
  const t0 = now();
  let nulls = 0;
  for (const T of poses) if (K.ik(T, [0, 0, 0, 0, 0, 0]) === null) nulls++;
  const avg = (now() - t0) / poses.length;
  bench.unreachableAvgMs = +avg.toFixed(5);
  assert.strictEqual(nulls, poses.length);
  assert.ok(avg < 0.2, 'avg ' + avg + ' ms');
  assert.strictEqual(K.reachable(K.fk([0, 0, 0, 0, 0, 0])), true);
});

test('dhFromManifest: manifest-shaped table swaps in; non-spherical chain falls back to DLS', () => {
  const table = JSON.parse(JSON.stringify(K.DEFAULT_JOINT_TABLE));
  const chain = K.dhFromManifest({ joints: table });
  const q = [5 * DEG, 10 * DEG, 15 * DEG, 20 * DEG, 25 * DEG, 30 * DEG];
  assert.ok(K.poseError(K.fk(q, chain), K.fk(q)).pos < 1e-12);
  table[4].dh.a = 0.02; // break the spherical wrist
  const bent = K.dhFromManifest(table);
  assert.strictEqual(bent.analytic, false);
  const T = K.fk(q, bent);
  const res = K.ik(T, q.map((v) => v + 0.1), {}, bent);
  assert.ok(res && res.method === 'dls' && res.posErr < POS_TOL && res.rotErr < ROT_TOL);
  assert.throws(() => K.dhFromManifest([{ name: 'J1' }]));
});

test('stepToward respects vmax/amax and arrives', () => {
  const chain = K.DEFAULT_CHAIN;
  let q = [0, 0, 0, 0, 0, 0];
  const target = [90 * DEG, 40 * DEG, -30 * DEG, 120 * DEG, 60 * DEG, 200 * DEG];
  const st = {}; const dt = 1 / 60; let steps = 0, done = false, prev = q.slice();
  while (!done && steps < 2000) {
    const s = K.stepToward(q, target, dt, st);
    s.q.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) <= chain.joints[i].vmax * dt + 1e-9, 'vmax exceeded on J' + (i + 1)));
    prev = s.q; q = s.q; done = s.done; steps++;
  }
  assert.ok(done, 'did not arrive in ' + steps + ' steps');
  bench.moveSteps60Hz = steps;
});

test('pose helpers round-trip', () => {
  const T = K.poseFromXYZRPY(0.5, -0.2, 0.8, 0.3, -0.4, 1.1);
  const p = K.xyzRPYFromPose(T);
  [['x', 0.5], ['y', -0.2], ['z', 0.8], ['roll', 0.3], ['pitch', -0.4], ['yaw', 1.1]].forEach(([k, v]) => assert.ok(Math.abs(p[k] - v) < 1e-12, k));
});

// ---------- rig.js ----------
const Rig = require(path.join(__dirname, '..', 'src', 'robot', 'rig.js'));
// Minimal THREE stand-in (only what bind/setJoints touch) so the rig is covered without a CDN.
const MockTHREE = (() => {
  class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; } }
  class Q {
    constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
    setFromAxisAngle(a, t) { const s = Math.sin(t / 2); this.x = a.x * s; this.y = a.y * s; this.z = a.z * s; this.w = Math.cos(t / 2); return this; }
    clone() { return new Q(this.x, this.y, this.z, this.w); }
    copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
    multiply(b) { const a = this; const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z; this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  }
  return { Vector3: V, Quaternion: Q };
})();
function mockGroup(names) {
  const kids = names.map((n) => ({ name: n, userData: {}, quaternion: new MockTHREE.Quaternion() }));
  return { name: 'arm', kids, traverse(fn) { fn(this); kids.forEach(fn); } };
}

test('rig.bind finds J1..J6 / J1_xxx names and rotates about each axis; NaN ignored, limits clamped', () => {
  const g = mockGroup(['J0_base', 'J1_turret', 'J2', 'J3_elbow', 'J4', 'J5', 'J6_flange']);
  const rig = Rig.bind(g, { THREE: MockTHREE, kin: K });
  assert.strictEqual(rig.nodes[0].name, 'J1_turret');
  assert.strictEqual(rig.nodes[5].name, 'J6_flange');
  rig.setJoints([30 * DEG, 0, 0, 0, 0, 0]);
  const q1 = rig.nodes[0].quaternion; // default axis J1 = +Y
  assert.ok(Math.abs(q1.y - Math.sin(15 * DEG)) < 1e-12 && Math.abs(q1.w - Math.cos(15 * DEG)) < 1e-12);
  rig.setJoints([NaN, 999, 0, 0, 0, 0]);
  assert.ok(Math.abs(rig.getJoints()[0] - 30 * DEG) < 1e-12, 'NaN must not overwrite');
  assert.ok(Math.abs(rig.getJoints()[1] - K.DEFAULT_CHAIN.joints[1].max) < 1e-12, 'clamped to J2 max');
  assert.throws(() => Rig.bind(mockGroup(['J1', 'J2']), { THREE: MockTHREE, kin: K }), /missing joint nodes/);
});

test('follower: setTarget runs IK, update() walks the rig there smoothly, unreachable ignored', () => {
  const g = mockGroup(['J1', 'J2', 'J3', 'J4', 'J5', 'J6']);
  const rig = Rig.bind(g, { THREE: MockTHREE, kin: K });
  const f = Rig.createFollower(rig, { kin: K });
  const qGoal = [40 * DEG, 30 * DEG, -10 * DEG, 20 * DEG, 45 * DEG, 0];
  assert.ok(f.setTarget(K.fk(qGoal)));
  let done = false, n = 0; while (!done && n < 600) { done = f.update(1 / 60); n++; }
  assert.ok(done);
  assert.ok(K.poseError(K.fk(rig.getJoints()), K.fk(qGoal)).pos < POS_TOL);
  assert.strictEqual(f.setTarget({ x: 5, y: 0, z: 1 }), null);
  assert.ok(f.update(1 / 60), 'holds last goal after unreachable target');
});

let THREE = null; try { THREE = require('three'); } catch (e) { /* three is CDN-only in this repo */ }
if (THREE) test('proxy arm (real THREE) flange matches RobotKin.fk', () => {
  const arm = Rig.buildProxyArm(THREE, K.DEFAULT_CHAIN, { kin: K });
  const rig = Rig.bind(arm, { THREE, kin: K });
  const r = rng(3);
  for (let i = 0; i < 20; i++) {
    const q = K.randomQ(r); rig.setJoints(q);
    const p = rig.flangeWorld(); const T = K.fk(q);
    const err = Math.hypot(p.x - T[3], p.y - T[11], p.z + T[7]); // Z-up robot -> Y-up scene
    assert.ok(err < 1e-6, 'proxy flange off by ' + err);
  }
});
else console.log('  skip proxy-arm/THREE check (three not installed for node)');

console.log('BENCH ' + JSON.stringify(bench));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
