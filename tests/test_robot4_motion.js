/**
 * LLF-77 — Robot-4 motion + grasp physics (src/robot/motion.js).
 * Run: node tests/test_robot4_motion.js   (needs the cannon devDependency for the physics cases)
 *  1. pure path pieces: quintic joint segments stay inside vmax/amax, Cartesian moves reject joint
 *     jumps, schedule shifting, tray slot layout, capsule maths.
 *  2. full pick/place: an 'A' standing in the bin is pinched, lifted, carried over a via waypoint
 *     and stood in a type-tray slot with guide colliders; final pose within 10 mm / 8 deg, no joint
 *     over its velocity limit at any frame, own link capsules never intersect along the path.
 *  3. timing: a job planned too early reports a delay and shifts the queued jobs.
 *  4. safety net: an arm parked in the transit corridor makes the other arm hold, then go.
 *  5. vacuum: face-normal 15 deg gate; forced 100% drop chance fires a JAM and a re-pick.
 *  6. settle check: a glyph released outside a slot is reported 'mis-set'.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const K = require(path.join(ROOT, 'src', 'robot', 'kinematics.js'));
const M = require(path.join(ROOT, 'src', 'robot', 'motion.js'));
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('  ok   ' + name); }
  catch (e) { failures++; console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}
const DEG = Math.PI / 180;
const ARM_META = JSON.parse(rd('assets/cad/manifest.d/robot_arm.json'));
const GRIP_META = JSON.parse(rd('assets/cad/manifest.d/gripper.json'));
const VAC_META = JSON.parse(rd('assets/cad/manifest.d/vacuum_tool.json'));
const CHAIN = K.dhFromManifest(ARM_META.joints);
const RADII = M.capsuleRadii(ARM_META, GRIP_META);
const O = M.DEFAULTS;

// ------------------------------------------------------------------ 1. pure pieces
test('quintic joint segment respects every joint vmax / amax', () => {
  const q0 = [0, 0, 0, 0, 0, 0], q1 = [1.2, -0.4, 0.8, 2.0, -1.0, 3.0];
  const s = M.jointSegment(q0, null, q1, null, CHAIN, O);
  for (let k = 0; k <= 200; k++) {
    const t = s.T * k / 200;
    for (let i = 0; i < 6; i++) {
      const c = s.coeffs[i];
      const v = c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5])));
      const a = 2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5]));
      assert(Math.abs(v) <= CHAIN.joints[i].vmax * 1.001, 'J' + (i + 1) + ' v ' + v);
      assert(Math.abs(a) <= CHAIN.joints[i].amax * 1.02, 'J' + (i + 1) + ' a ' + a);
    }
  }
  const end = s.coeffs.map(c => c.reduce((acc, ci, n) => acc + ci * Math.pow(s.T, n), 0));
  end.forEach((v, i) => assert(Math.abs(v - q1[i]) < 1e-9));
});

test('Cartesian move: IK every 8 ms, joint-jump guard rejects flips', () => {
  const ch = M.armChain(CHAIN, null, 0.245);
  const down = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  const A = down.slice(); A[3] = 0.9; A[7] = -0.3; A[11] = 1.0;
  const B = down.slice(); B[3] = 0.9; B[7] = -0.3; B[11] = 0.85;
  const qa = K.ik(A, [0, 0, 0, 0, 0, 0], {}, ch).q;
  const seg = M.cartesianSegment(A, B, qa, ch, O);
  assert(Math.abs(seg.h - seg.T / (seg.qs.length - 1)) < 1e-12 && seg.h <= 0.008 + 1e-12, 'sample step <= 8 ms');
  const e = K.poseError(B, K.fk(seg.qs[seg.qs.length - 1], ch));
  assert(e.pos < 1e-4 && e.rot < 1e-3, 'ends on target');
  assert.throws(() => M.cartesianSegment(A, B, qa, ch, Object.assign({}, O, { maxJumpDeg: 0.01 })), /jumps/);
  // a seed in the other wrist configuration is a flip at the very first sample
  const flipped = qa.slice(); flipped[3] += Math.PI; flipped[5] += Math.PI; flipped[4] = -flipped[4];
  assert.throws(() => M.cartesianSegment(A, B, flipped, ch, O), e2 => e2.code === 'joint-jump');
});

test('shiftSchedule moves only jobs at/after the delayed one; tray slots follow the recipe', () => {
  const jobs = [{ tPick: 1, tPlace: 2 }, { tPick: 3, tPlace: 5, tEnd: 5.6 }, { tPick: 4, tPlace: 6 }];
  assert.strictEqual(M.shiftSchedule(jobs, 3, 0.5), 2);
  assert.deepStrictEqual(jobs.map(j => j.tPick), [1, 3.5, 4.5]);
  assert.strictEqual(jobs[1].tEnd, 6.1);
  const slots = M.traySlots(null);
  assert.strictEqual(slots.length, 12);
  assert(Math.abs(slots[1].center[0] - slots[0].center[0] - 0.28) < 1e-9 && Math.abs(slots[0].center[2] - 0.72) < 1e-9);
});

test('capsules: segment distance + self clearance at home is positive', () => {
  assert(Math.abs(M.segSegDist([0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, 2, 0]) - 1) < 1e-12);
  assert(Math.abs(M.segSegDist([0, 0, 0], [1, 0, 0], [0.5, -1, 1], [0.5, 1, 1]) - 1) < 1e-12);
  assert(Math.abs(M.segSegDist([0, 0, 0], [0, 0, 0], [3, 4, 0], [3, 4, 0]) - 5) < 1e-12);
  assert(M.selfClearance(M.linkCapsules([0, 0, 0, 0, 0, 0], M.armChain(CHAIN, null, 0.245), RADII)) > 0);
  // a pose folding the gripper back into the base column is caught
  const bad = M.linkCapsules([0, -70 * DEG, 155 * DEG, 0, -120 * DEG, 0], M.armChain(CHAIN, null, 0.245), RADII);
  assert(M.selfClearance(bad) < 0, 'folded pose should self-intersect, clearance ' + M.selfClearance(bad));
});

// ------------------------------------------------------------------ physics scaffolding
let CANNON = null;
try { CANNON = require('cannon'); } catch (e) { /* devDependency missing */ }
if (!CANNON) {
  console.error('  FAIL cannon devDependency missing — run npm install');
  process.exit(1);
}
const PHYS = JSON.parse(rd('assets/cad/glyph_physics.json'));
const ctx = { console, CANNON, window: {}, Math };
vm.createContext(ctx);
vm.runInContext(rd('src/core/glyphs.js'), ctx, { filename: 'glyphs.js' });
const LG = ctx.window.LetterGlyphs;
LG._setPhysics(PHYS);
const SCALE = 0.23;                         // tray glyphs: the A is 1.1 em wide, so 0.23 m keeps it inside the 270 mm slot (92 mm thick: still inside the 90-130 mm jaw)
function glyphBody(ch) {
  const e = PHYS.glyphs[ch];
  const b = new CANNON.Body({ mass: LG.massFor(ch, SCALE, LG.DENSITY.foam) });
  LG.buildHullShapes(e, SCALE).forEach(s => b.addShape(s.shape, s.offset));
  const f = LG.DENSITY.foam / 1000 * Math.pow(SCALE, 5), I = e.inertia;
  b.inertia.set(I[0][0] * f, I[1][1] * f, I[2][2] * f);
  b.invInertia.set(1 / b.inertia.x, 1 / b.inertia.y, 1 / b.inertia.z);
  b.updateInertiaWorld(true);
  b.__glyph = true;
  return b;
}
function makeWorld() {
  const w = new CANNON.World();
  w.gravity.set(0, 0, -9.82);
  w.broadphase = new CANNON.NaiveBroadphase();
  w.solver.iterations = 20;
  w.defaultContactMaterial.friction = 0.5;
  w.defaultContactMaterial.restitution = 0.0;
  return w;
}
function staticBox(w, hx, hy, hz, x, y, z) {
  const b = new CANNON.Body({ mass: 0 });
  b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
  b.position.set(x, y, z); w.addBody(b); return b;
}
/** Upright glyph pose (robot world): glyph +Y -> world up, depth -> -Y, then yaw about Z. */
function uprightAt(ch, x, y, floorZ, yaw) {
  const e = PHYS.glyphs[ch], h = (e.com[1] - e.bbox.min[1]) * SCALE;
  const R = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  const Y = K.poseFromXYZRPY(x, y, floorZ + h + 0.002, 0, 0, yaw || 0);
  return K.mul(Y, R);
}
function setPose(b, T) { const q = M.quatFromMat(T); b.position.set(T[3], T[7], T[11]); b.quaternion.set(q[0], q[1], q[2], q[3]); }
const BIN_FLOOR = 0.60, BIN = [0.85, -0.45];
const SLOT = { id: 's0', center: [0.85, 0.50, 0.72], halfX: 0.135, halfY: 0.055, yaw: 0, wallH: 0.07, dividerH: 0.03 };
const PEDESTAL = K.poseFromXYZRPY(0, 0, 0.555, 0, 0, 0);   // pedestal.json: robot mounting face at 555 mm
const HOME = (() => {
  const ch = M.armChain(CHAIN, PEDESTAL, 0.245);
  const T = [1, 0, 0, 0.8, 0, -1, 0, 0, 0, 0, -1, 1.15, 0, 0, 0, 1];
  return K.ik(T, [0, 0, 0, 0, -90 * DEG, 0], {}, ch).q;
})();

function scene(opts) {
  opts = opts || {};
  const world = makeWorld();
  staticBox(world, 0.5, 0.33, 0.01, BIN[0], BIN[1], BIN_FLOOR - 0.01);     // tote floor
  M.addSlotGuides(CANNON, world, SLOT, null);
  const body = glyphBody(opts.char || 'A');
  setPose(body, opts.pose || uprightAt(opts.char || 'A', BIN[0], BIN[1], BIN_FLOOR, 12 * DEG));
  world.addBody(body);
  for (let i = 0; i < 120; i++) world.step(1 / 120);                         // let it settle in the bin
  const grasp = M.createGrasp(Object.assign({ CANNON, rng: opts.rng || (() => 0.5) }, opts.graspOpts || {}));
  const events = [];
  const hub = M.createHub(Object.assign({
    grasp, autoUpdate: false,
    onEvent: (t, info) => events.push({ t, info }),
    resolve: () => ({ body, grasp: opts.grasp || 'top-pinch', placeGlyph: M.slotGlyphPose(SLOT, PHYS.glyphs[opts.char || 'A'], SCALE, O.placeClearance), slot: SLOT })
  }, opts.hub || {}));
  const arm = hub.addArm({ id: 'A1', chain: CHAIN, basePose: PEDESTAL, q: HOME, radii: RADII, tool: opts.grasp === 'vacuum' ? 'vacuum' : 'pinch' });
  return { world, body, grasp, hub, arm, events };
}
function run(S, seconds, perFrame) {
  const dt = 1 / 125;                                                         // 8 ms frames
  for (let t = 0; t < seconds; t += dt) {
    S.hub.update(dt);
    S.world.step(dt);
    if (perFrame) perFrame(dt);
  }
}
const has = (S, type) => S.events.some(e => e.t === type);

// ------------------------------------------------------------------ 2. full pick / place
test("pick 'A' from the bin and stand it in a tray slot (10 mm / 8 deg, velocity limits, no self-intersection)", () => {
  const S = scene();
  S.hub.load([{ kind: 'place', armId: 'A1', glyphId: 'g0', char: 'A', slot: 's0', grasp: 'top-pinch', tPick: 2.0, tPlace: 5.5, tEnd: 6.1 }]);
  let prevQ = S.arm.q.slice(), worstV = 0, worstSelf = Infinity, minHeldZ = Infinity, closedAt = null, openedAt = null;
  run(S, 9, (dt) => {
    S.arm.q.forEach((v, i) => { worstV = Math.max(worstV, Math.abs(v - prevQ[i]) / dt / CHAIN.joints[i].vmax); });
    prevQ = S.arm.q.slice();
    worstSelf = Math.min(worstSelf, M.selfClearance(M.linkCapsules(S.arm.q, S.arm.chain, S.arm.radii)));
    if (S.grasp.isAttached(S.body)) minHeldZ = Math.min(minHeldZ, S.body.position.z);
    const ph = S.arm.path && S.arm.path.segments[Math.max(0, S.arm.seg)].phase;
    if (ph === 'close' && closedAt == null) closedAt = S.hub.time;
    if (ph === 'open' && openedAt == null) openedAt = S.hub.time;
  });
  const types = S.events.map(e => e.t);
  ['start', 'grasp', 'release', 'set', 'done'].forEach(t => assert(types.includes(t), 'event ' + t + ' missing: ' + types.join(',')));
  assert(!['fail', 'miss', 'mis-set', 'delay', 'hold'].some(t => types.includes(t)), types.join(','));
  assert(worstV <= 1.0 + 1e-6, 'joint velocity ratio ' + worstV.toFixed(3));
  assert(worstSelf > 0, 'self capsule clearance ' + worstSelf);
  assert(Math.abs(closedAt - 2.0) < 0.02, 'gripper closes at planned tPick (' + closedAt + ')');
  assert(Math.abs(openedAt - 5.5) < 0.02, 'gripper opens at planned tPlace (' + openedAt + ')');
  const target = M.slotGlyphPose(SLOT, PHYS.glyphs.A, SCALE, 0);
  const fin = M.bodyPose(S.body, null), err = K.poseError(target, fin);
  assert(err.pos < 0.010, 'final position error ' + (err.pos * 1000).toFixed(1) + ' mm');
  const up = [fin[1], fin[5], fin[9]];
  assert(Math.acos(up[2]) < 8 * DEG, 'final tilt ' + (Math.acos(up[2]) / DEG).toFixed(2) + ' deg');
  assert(err.rot < 8 * DEG, 'final rotation error ' + (err.rot / DEG).toFixed(2) + ' deg');
  assert(S.body.type === CANNON.Body.DYNAMIC, 'body restored to DYNAMIC');
  assert(minHeldZ > BIN_FLOOR, 'carried glyph never dips below the bin floor');
});

// ------------------------------------------------------------------ 3. delay notification
test('a job planned earlier than the arm can reach reports a delay and shifts queued jobs', () => {
  const resched = [];
  const S = scene({ hub: { onReschedule: (job, d) => resched.push(d) } });
  S.hub.load([
    { kind: 'place', armId: 'A1', glyphId: 'g0', char: 'A', slot: 's0', grasp: 'top-pinch', tPick: 0.1, tPlace: 0.5 },
    { kind: 'place', armId: 'A1', glyphId: 'g1', char: 'B', slot: 's1', grasp: 'top-pinch', tPick: 9, tPlace: 11 }
  ]);
  const before = S.arm.queue[1].tPick;
  S.hub.update(1 / 125);
  assert(resched.length >= 1 && resched[0] > 0.3, 'reschedule notified: ' + resched);
  assert(S.arm.queue[0].tPick > before, 'queued job shifted ' + before + ' -> ' + S.arm.queue[0].tPick);
});

// ------------------------------------------------------------------ 4. capsule guard
test('transit holds while another arm blocks the corridor, then proceeds', () => {
  const S = scene();
  // second arm across the cell, its gripper parked right where A1's pre-pick approach goes
  const base2 = K.poseFromXYZRPY(1.75, -0.45, 0.555, 0, 0, Math.PI);
  const ch2 = M.armChain(CHAIN, base2, 0.245);
  const park = [1, 0, 0, BIN[0] + 0.05, 0, -1, 0, BIN[1], 0, 0, -1, 1.0, 0, 0, 0, 1];
  const q2 = K.ik(park, [0, 0, 0, 0, -90 * DEG, 0], {}, ch2).q;
  const B = S.hub.addArm({ id: 'B1', chain: CHAIN, basePose: base2, q: q2, radii: RADII });
  S.hub.load([{ kind: 'place', armId: 'A1', glyphId: 'g0', char: 'A', slot: 's0', grasp: 'top-pinch', tPick: null, tPlace: null }]);
  run(S, 1.0);
  assert(has(S, 'hold'), 'A1 should hold: ' + S.events.map(e => e.t));
  assert(!has(S, 'grasp'), 'no grasp while blocked');
  // B1 retreats out of the way
  B.q = K.ik([1, 0, 0, 1.3, 0, -1, 0, -0.45, 0, 0, -1, 1.2, 0, 0, 0, 1], q2, {}, ch2).q;
  run(S, 6);
  assert(has(S, 'grasp') && has(S, 'delay'), 'A1 resumes and reports the delay: ' + S.events.map(e => e.t));
});

// ------------------------------------------------------------------ 5. vacuum
test('vacuum: face-normal gate and JAM drop', () => {
  // flat 'O' lying face-up in the bin
  const flat = K.mul(K.poseFromXYZRPY(BIN[0], BIN[1], BIN_FLOOR + 0.05 + 0.003, 0, 0, 0.3), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const S = scene({ char: 'O', pose: flat, grasp: 'vacuum', rng: () => 0.0 });   // rng 0 < 2% -> always jams
  const tcp = M.graspPose(S.body, 'vacuum', O, null);
  assert(tcp && tcp[10] < -0.99, 'vacuum approaches straight down');
  const fakeArm = (T) => ({ q: K.ik(T, HOME, {}, S.arm.chains.vacuum).q, chain: S.arm.chains.vacuum });
  assert(S.grasp.contact(fakeArm(tcp), S.body, 'vacuum').ok, 'cup on the face is accepted');
  const tilted = K.mul(tcp, [1, 0, 0, 0, 0, Math.cos(20 * DEG), -Math.sin(20 * DEG), 0, 0, Math.sin(20 * DEG), Math.cos(20 * DEG), 0, 0, 0, 0, 1]);
  const c20 = S.grasp.contact(fakeArm(tilted), S.body, 'vacuum');
  assert(!c20.ok && /tilted/.test(c20.reason), 'tool 20 deg off the face normal is refused');
  S.hub.load([{ kind: 'place', armId: 'A1', glyphId: 'g0', char: 'O', slot: 's0', grasp: 'vacuum', tPick: null, tPlace: null }]);
  run(S, 4);
  assert(has(S, 'grasp') && has(S, 'jam'), 'grasped then dropped: ' + S.events.map(e => e.t));
  assert(S.body.type === CANNON.Body.DYNAMIC, 'dropped body is dynamic again');
  assert(S.arm.queue.some(j => j.repickOf === 'jam') || has(S, 'start'), 're-pick queued');
});

// ------------------------------------------------------------------ 6. settle verify
test("release outside the slot -> 'mis-set' within 1.5 s", () => {
  const world = makeWorld();
  staticBox(world, 2, 2, 0.01, 0, 0, -0.01);
  const b = glyphBody('A');
  setPose(b, K.mul(uprightAt('A', 0.4, 0, 0, 0), [1, 0, 0, 0, 0, Math.cos(1.2), -Math.sin(1.2), 0, 0, Math.sin(1.2), Math.cos(1.2), 0, 0, 0, 0, 1]));
  world.addBody(b);
  const g = M.createGrasp({ CANNON });
  const arm = { q: HOME, chain: M.armChain(CHAIN, null, 0.245) };
  const verdicts = [];
  const h = { arm, body: b, offset: K.identity(), prev: null };
  g.handles.push(h);
  g.release(h, { center: [0, 0, 0], halfX: 0.135, halfY: 0.055, yaw: 0 }, v => verdicts.push(v));
  for (let t = 0; t < 2; t += 1 / 125) { world.step(1 / 125); g.update(1 / 125); }
  assert.deepStrictEqual(verdicts, ['mis-set']);
});

// ------------------------------------------------------------------ 7. wiring
test('frame hook registered in motion.js; script tag after planner.js; Y-up frame helper is a rotation', () => {
  const src = rd('src/robot/motion.js');
  assert(/LLHooks\.on\('frame'/.test(src), 'LLHooks frame registration');
  const html = rd('index.html');
  const iP = html.indexOf('src="src/robot/planner.js"'), iM = html.indexOf('src="src/robot/motion.js"');
  assert(iP > 0 && iM > iP, 'motion.js tag after planner.js');
  const F = M.Z_UP_TO_Y_UP, p = [F[1], F[5], F[9]];
  assert.deepStrictEqual([F[2], F[6], F[10]], [0, 1, 0], 'robot +Z -> physics +Y');
  assert.deepStrictEqual(p, [0, 0, -1], 'robot +Y -> physics -Z');
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
