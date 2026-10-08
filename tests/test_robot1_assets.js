/**
 * LLF-74 [Robot-1] — robot workcell CAD assets (node tests/test_robot1_assets.js)
 * - manifest has robot_arm with 6 revolute joints J1..J6: axis + limits inside datasheet sanity bands
 * - the GLB is a real joint hierarchy (J0_base > J1 > ... > J6_flange), each J node sits on its joint axis
 *   and carries extras.axis / extras.joint, so RobotRig.bind + AssetLib.joints work on it
 * - forward kinematics through the GLB node tree == RobotKin.fk for random joint vectors (the CAD
 *   link lengths ARE the DH table in src/robot/kinematics.js), and dhFromManifest(joints) == DEFAULT_CHAIN
 * - strict-export assembly soundness recorded in manifest.assemblyOk
 * - workcell props (gripper prismatic travel > 0 etc.) are checked when their manifest entries exist
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const K = require(path.join(ROOT, 'src', 'robot', 'kinematics.js'));
const glb = require(path.join(ROOT, 'tools', 'cad', 'glb.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'cad', 'manifest.json'), 'utf8'));

const DEG = Math.PI / 180;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + ': ' + (e && e.stack || e)); }
}
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---- tiny column-major 4x4 helpers (glTF convention) ----
function mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(t, q, s) {
  t = t || [0, 0, 0]; q = q || [0, 0, 0, 1]; s = s || [1, 1, 1];
  const [x, y, z, w] = q;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1];
  for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[c * 4 + k] *= s[c];
  return m;
}
function qAxis(a, ang) { const n = Math.hypot(a[0], a[1], a[2]), s = Math.sin(ang / 2) / n; return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)]; }
function qMul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
function apply(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }
const robotToGltf = (x, y, z) => [x, z, -y];

console.log('LLF-74 robot workcell assets');
const arm = manifest.robot_arm;
const armFile = path.join(ROOT, 'assets', 'cad', 'robot_arm.glb');
const g = fs.existsSync(armFile) ? glb.readGlb(fs.readFileSync(armFile)) : null;
const nodes = g ? g.json.nodes : [];
const idx = {}; nodes.forEach((n, i) => { idx[n.name] = i; });
const JN = ['J1_turret', 'J2_upper_arm', 'J3_elbow', 'J4_forearm', 'J5_wrist', 'J6_flange'];

test('manifest robot_arm: 6 revolute joints J1..J6 with axis + limits', () => {
  assert.ok(arm, 'robot_arm missing from manifest');
  assert.strictEqual(arm.joints.length, 6);
  arm.joints.forEach((j, i) => {
    assert.strictEqual(j.name, 'J' + (i + 1));
    assert.strictEqual(j.node, JN[i]);
    assert.strictEqual(j.type, 'revolute');
    assert.ok(Array.isArray(j.axis) && j.axis.length === 3 && Math.abs(Math.hypot(...j.axis) - 1) < 1e-9, 'unit axis');
    assert.ok(j.min < 0 && j.max > 0 && j.min < j.max, 'limits straddle zero');
    assert.ok(Math.abs(j.min - j.limits.min * DEG) < 1e-5 && Math.abs(j.max - j.limits.max * DEG) < 1e-5, 'rad/deg limits agree');
    assert.ok(j.vmax > 0 && j.dh && typeof j.dh.d === 'number', 'vmax + dh row');
  });
});

test('joint limits inside datasheet sanity bands (10 kg / 1.4 m class)', () => {
  const L = arm.joints.map((j) => j.limits);
  assert.ok(Math.abs(L[0].min) >= 170 && Math.abs(L[0].min) <= 185 && L[0].max >= 170 && L[0].max <= 185, 'J1 +-170..185');
  assert.ok(L[1].max - L[1].min >= 180 && L[1].max - L[1].min <= 270, 'J2 total 180..270');
  assert.ok(L[2].max - L[2].min >= 250 && L[2].max - L[2].min <= 330, 'J3 total 250..330');
  assert.ok(L[3].max >= 165 && L[3].max <= 360, 'J4');
  assert.ok(L[4].max >= 115 && L[4].max <= 140, 'J5 +-115..140');
  assert.ok(L[5].max >= 270 && L[5].max <= 450, 'J6');
});

test('manifest joint table == RobotKin.DEFAULT_JOINT_TABLE (CAD built to the IK model)', () => {
  K.DEFAULT_JOINT_TABLE.forEach((r, i) => {
    const j = arm.joints[i];
    ['d', 'a', 'alpha', 'offset'].forEach((k) => assert.ok(Math.abs(j.dh[k] - r.dh[k]) < 1e-9, j.name + ' dh.' + k));
    assert.strictEqual(j.limits.min, r.limits.min); assert.strictEqual(j.limits.max, r.limits.max);
    assert.strictEqual(j.vmax, r.vmax);
  });
  const chain = K.dhFromManifest(arm.joints);
  assert.ok(chain.analytic);
  const r = rng(7);
  for (let n = 0; n < 50; n++) {
    const q = K.randomQ(r);
    assert.ok(K.poseError(K.fk(q, chain), K.fk(q)).pos < 1e-12);
  }
});

test('GLB hierarchy: J0_base > J1 > ... > J6_flange, J nodes carry axis extras, parts are children', () => {
  assert.ok(g, 'robot_arm.glb missing');
  const chainNames = ['J0_base'].concat(JN);
  for (let i = 1; i < chainNames.length; i++) {
    const p = nodes[idx[chainNames[i - 1]]];
    assert.ok(p && (p.children || []).includes(idx[chainNames[i]]), chainNames[i] + ' must be a child of ' + chainNames[i - 1]);
  }
  JN.forEach((n, i) => {
    const node = nodes[idx[n]];
    assert.ok(!node.rotation && !node.mesh, n + ' is an unrotated empty pivot');
    assert.deepStrictEqual(node.extras.axis, arm.joints[i].axis);
    assert.strictEqual(node.extras.joint.type, 'revolute');
  });
  const parts = new Set(glb.partNodes(g).map((p) => p.name));
  Object.keys(arm.parts).forEach((p) => assert.ok(parts.has(p), 'part ' + p));
  assert.ok(arm.tris[0] <= 40000, 'LOD0 within 40k');
});

test('each J node sits on its joint axis (pivotM)', () => {
  const world = {};
  (function walk(i, pm) { const m = mul(pm, trs(nodes[i].translation, nodes[i].rotation, nodes[i].scale)); world[i] = m; (nodes[i].children || []).forEach((c) => walk(c, m)); })(g.json.scenes[0].nodes[0], trs());
  arm.joints.forEach((j) => {
    const w = world[idx[j.node]];
    const d = Math.hypot(w[12] - j.pivotM[0], w[13] - j.pivotM[1], w[14] - j.pivotM[2]);
    assert.ok(d < 1e-6, j.node + ' off its pivot by ' + d);
  });
});

test('FK through the GLB node tree matches RobotKin.fk (300 random poses, < 0.01 mm)', () => {
  const r = rng(42);
  const pivot6 = arm.joints[5].pivotM;
  const faceLocal = [0.910 - pivot6[0], 0, 0]; // flange face centre (DH frame 6 origin) in J6 local
  const zLocal = [1, 0, 0];                    // DH z6 (approach) = +X at zero pose
  let worst = 0;
  for (let n = 0; n < 300; n++) {
    const q = K.randomQ(r);
    const rot = {}; JN.forEach((nm, i) => { rot[idx[nm]] = qAxis(arm.joints[i].axis, q[i]); });
    let m6 = null;
    (function walk(i, pm) {
      const nd = nodes[i];
      let qr = nd.rotation || [0, 0, 0, 1];
      if (rot[i]) qr = qMul(qr, rot[i]);
      const m = mul(pm, trs(nd.translation, qr, nd.scale));
      if (i === idx.J6_flange) m6 = m;
      (nd.children || []).forEach((c) => walk(c, m));
    })(g.json.scenes[0].nodes[0], trs());
    const p = apply(m6, faceLocal);
    const z = apply(m6, zLocal).map((v, k) => v - m6[12 + k]);
    const T = K.fk(q);
    const pe = robotToGltf(T[3], T[7], T[11]);
    const ze = robotToGltf(T[2], T[6], T[10]);
    const e = Math.hypot(p[0] - pe[0], p[1] - pe[1], p[2] - pe[2]);
    worst = Math.max(worst, e);
    assert.ok(e < 1e-5, 'flange position off by ' + e + ' m at q=' + q.map((v) => (v / DEG).toFixed(1)));
    assert.ok(Math.hypot(z[0] - ze[0], z[1] - ze[1], z[2] - ze[2]) < 1e-6, 'flange approach axis');
  }
  console.log('      worst flange error ' + (worst * 1000).toExponential(2) + ' mm');
});

test('strict assembly export recorded sound (manifest.assemblyOk)', () => {
  assert.strictEqual(arm.assemblyOk, true);
  assert.ok(arm.massKg > 150 && arm.massKg < 230, 'arm mass ~190 kg datasheet class, got ' + arm.massKg);
});

test('gripper: prismatic finger joints with travel > 0 (when present)', () => {
  const gr = manifest.gripper;
  if (!gr) { console.log('      (gripper not in manifest yet)'); return; }
  const pj = gr.joints.filter((j) => j.type === 'prismatic');
  assert.ok(pj.length >= 2, 'two prismatic fingers');
  pj.forEach((j) => assert.ok(j.max - j.min > 0, j.node + ' travel'));
  assert.strictEqual(gr.assemblyOk, true);
});

test('workcell props present are sound and sourced', () => {
  ['letter_bin', 'type_tray', 'conveyor', 'fence', 'tool_rack', 'pedestal', 'vacuum_tool'].forEach((n) => {
    const e = manifest[n];
    if (!e) return;
    assert.strictEqual(e.assemblyOk, true, n + ' assemblyOk');
    assert.ok(e.sources.length > 0, n + ' sources');
  });
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
