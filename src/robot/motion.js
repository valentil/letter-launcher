/**
 * src/robot/motion.js — LLF-77 [Robot-4] motion + grasp physics for the robot letter factory.
 * Browser: window.RobotMotion (needs window.RobotKin; CANNON only for the grasp layer).
 * Node:    require('./src/robot/motion.js')  (pure path code needs nothing; pass CANNON to createGrasp).
 *
 * Frames / units: everything here is the ROBOT WORLD frame — Z up, metres, radians, row-major
 * 4x4 poses (same convention as RobotKin). Each arm's chain carries its base placement
 * (chain.base) and its tool (chain.tool = Tz(tool length)), so fk(q, chain) is the TCP in world.
 * Physics bodies may live in another frame (the game's cannon world is Y up): createGrasp({frame})
 * takes the 4x4 robot-world -> physics-world transform (RobotMotion.Z_UP_TO_Y_UP for the game).
 *
 * One planner job (RobotPlanner schedule item) becomes this path:
 *   current q --(joint quintic, guarded)--> pre-pick (150 mm back along the grasp normal)
 *   [hold so the gripper starts closing at item.tPick]
 *   --(linear Cartesian, IK every 8 ms, <= 10 deg joint jump)--> pick
 *   close (fingers 0.25 s; contact check against the glyph hull AABBs; body -> KINEMATIC)
 *   --- the rest is built when the grasp is made, from the real grasp offset ---
 *   lift (Cartesian) -> transit (joint quintic via a waypoint above the zone boundary, guarded)
 *   [hold so the gripper opens at item.tPlace] -> place (Cartesian) -> open (body -> DYNAMIC,
 *   settle monitor) -> retreat (Cartesian back to pre-place).
 * Guarded segments run a link-capsule check against the other arms and the fence before they
 * start; on a predicted hit the arm holds where it is (= at the zone boundary) and re-checks.
 * Any lateness (slow move, hold) is reported through onReschedule and shifts every queued job.
 *
 *   const hub = RobotMotion.createHub({resolve, onEvent, onReschedule, fence, grasp});
 *   hub.addArm({id:'A1', chain, q, tool:'pinch', rig, fingers});
 *   hub.load(plannerResult.schedule);   // per-frame work is registered on LLHooks 'frame'
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RobotMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var DEG = Math.PI / 180;

  function getKin() {
    var k = (typeof window !== 'undefined' && window.RobotKin) || (root && root.RobotKin);
    if (!k && typeof require === 'function') { try { k = require('./kinematics.js'); } catch (e) { /* browser */ } }
    if (!k) throw new Error('RobotMotion: RobotKin not available');
    return k;
  }
  var K = null;
  function kin() { return K || (K = getKin()); }

  var DEFAULTS = {
    dt: 0.008,              // s, Cartesian IK sample step
    approach: 0.150,        // m, pre-pick / pre-place stand-off along the grasp normal
    maxJumpDeg: 10,         // reject a Cartesian move if any joint jumps more than this between samples
    gripTime: 0.25,         // s, finger close / open animation (and suction build-up)
    linSpeed: 0.35,         // m/s, Cartesian TCP speed cap
    linAccel: 1.2,          // m/s^2
    angSpeed: 1.5,          // rad/s, Cartesian TCP rotation cap
    speedScale: 0.9,        // fraction of each joint's vmax/amax the planner may use
    viaZ: null,             // absolute world z of the transit waypoint (zone-boundary ceiling); null = auto
    viaLift: 0.10,          // m above the higher of pre-pick / pre-place when viaZ is null
    jawOpen: 0.130,         // m fingertip gap open (gripper recipe: 130 open / 90 closed)
    fingerStroke: 0.020,    // m per jaw (gripper manifest prismatic joints)
    padLength: 0.150,       // m finger length (pad region behind the TCP)
    padWidth: 0.036,        // m finger width
    gripDepth: 0.05,        // m the glyph top sits above the fingertips when pinched from the top
    toolLength: { pinch: 0.245, vacuum: 0.156 },  // flange -> TCP (gripper / vacuum_tool bbox heights)
    vacuumMaxDeg: 15,       // face normal must be within this of the tool axis
    vacuumReach: 0.012,     // m, cup must be this close to the face plane
    dropChance: 0.02,       // vacuum JAM chance per pick
    placeClearance: 0.005,  // m, glyph released this far above its rest pose
    settleTime: 1.5,        // s to settle before 'mis-set'
    settleDeg: 8,           // max tilt from upright to count as set
    settleSpeed: 0.05,      // m/s, body must be this slow
    capsuleMargin: 0.01,    // m extra clearance demanded between capsules
    guardStep: 0.04,        // s, sampling step of the predictive capsule check
    holdRecheck: 0.1,       // s between re-checks while holding
    maxRetries: 2           // re-picks after a miss / mis-set / jam before giving up on a job
  };
  function opts(o) {
    var r = {}, k;
    for (k in DEFAULTS) r[k] = DEFAULTS[k];
    if (o) for (k in o) if (o[k] !== undefined) r[k] = o[k];
    return r;
  }

  // ------------------------------------------------------------------ vector / pose helpers
  function v3(T) { return [T[3], T[7], T[11]]; }
  function col(T, c) { return [T[c], T[4 + c], T[8 + c]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scl(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function poseFromAxes(x, y, z, p) {
    return [x[0], y[0], z[0], p[0], x[1], y[1], z[1], p[1], x[2], y[2], z[2], p[2], 0, 0, 0, 1];
  }
  function transl(x, y, z) { return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]; }
  function xform(T, p) {
    return [T[0] * p[0] + T[1] * p[1] + T[2] * p[2] + T[3], T[4] * p[0] + T[5] * p[1] + T[6] * p[2] + T[7],
      T[8] * p[0] + T[9] * p[1] + T[10] * p[2] + T[11]];
  }
  function rotv(T, p) { return [T[0] * p[0] + T[1] * p[1] + T[2] * p[2], T[4] * p[0] + T[5] * p[1] + T[6] * p[2], T[8] * p[0] + T[9] * p[1] + T[10] * p[2]]; }
  /** Pose moved by d along its own z axis (negative d = back off along the approach normal). */
  function alongZ(T, d) { var r = T.slice(); r[3] += T[2] * d; r[7] += T[6] * d; r[11] += T[10] * d; return r; }

  function quatFromMat(T) {
    var m00 = T[0], m01 = T[1], m02 = T[2], m10 = T[4], m11 = T[5], m12 = T[6], m20 = T[8], m21 = T[9], m22 = T[10];
    var tr = m00 + m11 + m22, x, y, z, w, s;
    if (tr > 0) { s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
    else if (m00 > m11 && m00 > m22) { s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
    else if (m11 > m22) { s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
    else { s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
    var l = Math.sqrt(x * x + y * y + z * z + w * w);
    return [x / l, y / l, z / l, w / l];
  }
  function matFromQuat(q, p) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), p[0],
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), p[1],
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), p[2], 0, 0, 0, 1];
  }
  function slerp(a, b, t) {
    var c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], bb = b;
    if (c < 0) { c = -c; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    var k0, k1;
    if (c > 0.9995) { k0 = 1 - t; k1 = t; }
    else { var th = Math.acos(c), s = Math.sin(th); k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s; }
    var r = [a[0] * k0 + bb[0] * k1, a[1] * k0 + bb[1] * k1, a[2] * k0 + bb[2] * k1, a[3] * k0 + bb[3] * k1];
    var l = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3]);
    return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
  }
  function interpPose(Ta, Tb, u) {
    var pa = v3(Ta), pb = v3(Tb);
    return matFromQuat(slerp(quatFromMat(Ta), quatFromMat(Tb), u), add(pa, scl(sub(pb, pa), u)));
  }
  /** Angle (rad) between the rotations of two poses. */
  function rotAngle(Ta, Tb) { return kin().poseError(Ta, Tb).rot; }

  /** Robot world (Z up) -> game physics world (Y up): (x, y, z) -> (x, z, -y). */
  var Z_UP_TO_Y_UP = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

  // ------------------------------------------------------------------ chains / tools
  /** Copy of chain placed at basePose (4x4 world) with a TCP length along flange z. */
  function armChain(chain, basePose, toolLength) {
    var c = {}, k;
    for (k in chain) c[k] = chain[k];
    if (basePose) c.base = basePose.slice();
    c.tool = transl(0, 0, toolLength || 0);
    return c;
  }

  // ------------------------------------------------------------------ quintic joint segments
  /** Quintic coefficients (zero boundary acceleration) for p0,v0 -> p1,v1 over T. */
  function hermite5(p0, v0, p1, v1, T) {
    var h = p1 - p0, T2 = T * T, T3 = T2 * T;
    return [p0, v0, 0,
      (20 * h - (8 * v1 + 12 * v0) * T) / (2 * T3),
      (-30 * h + (14 * v1 + 16 * v0) * T) / (2 * T3 * T),
      (12 * h - 6 * (v1 + v0) * T) / (2 * T3 * T2)];
  }
  function polyAt(c, t) {
    return {
      p: c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * (c[4] + t * c[5])))),
      v: c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5]))),
      a: 2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5]))
    };
  }
  /** Shortest rest-to-rest quintic duration respecting every joint's (scaled) vmax / amax. */
  function quinticRestTime(q0, q1, chain, o) {
    var T = 0, s = o.speedScale;
    for (var i = 0; i < 6; i++) {
      var d = Math.abs(q1[i] - q0[i]), J = chain.joints[i];
      T = Math.max(T, 1.875 * d / (J.vmax * s), Math.sqrt(5.7735 * d / (J.amax * s)));
    }
    return T;
  }
  /** Peak |v|/vmax and |a|/amax ratio of a quintic joint segment (sampled). */
  function polyRatio(coeffs, T, chain, o) {
    var worst = 0, s = o.speedScale;
    for (var k = 0; k <= 48; k++) {
      var t = T * k / 48;
      for (var i = 0; i < 6; i++) {
        var e = polyAt(coeffs[i], t), J = chain.joints[i];
        worst = Math.max(worst, Math.abs(e.v) / (J.vmax * s), Math.abs(e.a) / (J.amax * s));
      }
    }
    return worst;
  }
  /** Joint-space quintic segment q0,v0 -> q1,v1, stretched until every joint is inside its limits. */
  function jointSegment(q0, v0, q1, v1, chain, o, Tmin) {
    var T = Math.max(quinticRestTime(q0, q1, chain, o), Tmin || 0, 0.05), coeffs, it = 0;
    v0 = v0 || [0, 0, 0, 0, 0, 0]; v1 = v1 || [0, 0, 0, 0, 0, 0];
    for (;;) {
      coeffs = [];
      for (var i = 0; i < 6; i++) coeffs.push(hermite5(q0[i], v0[i], q1[i], v1[i], T));
      var r = polyRatio(coeffs, T, chain, o);
      if (r <= 1 + 1e-9 || it++ > 80) break;
      T *= Math.max(1.02, Math.min(1.5, Math.sqrt(r)));
    }
    return { type: 'poly', T: T, coeffs: coeffs, q0: q0.slice(), q1: q1.slice() };
  }
  /**
   * Transit qa -> (qv) -> qb. With a via configuration the two quintics share a via velocity
   * (per joint: mean of the two legs' average speeds when they agree in sign, else 0), so the arm
   * sweeps over the waypoint without stopping.
   */
  function transitSegments(qa, qv, qb, chain, o) {
    if (!qv) return [jointSegment(qa, null, qb, null, chain, o)];
    var T1 = Math.max(quinticRestTime(qa, qv, chain, o), 0.05), T2 = Math.max(quinticRestTime(qv, qb, chain, o), 0.05);
    var vv = [];
    for (var i = 0; i < 6; i++) {
      var s1 = (qv[i] - qa[i]) / T1, s2 = (qb[i] - qv[i]) / T2;
      var v = (s1 * s2 > 0) ? 0.5 * (s1 + s2) : 0;
      var cap = 0.6 * chain.joints[i].vmax * o.speedScale;
      vv.push(Math.max(-cap, Math.min(cap, v)));
    }
    return [jointSegment(qa, null, qv, vv, chain, o, T1), jointSegment(qv, vv, qb, null, chain, o, T2)];
  }

  // ------------------------------------------------------------------ Cartesian segments
  function MotionError(msg, code) { var e = new Error(msg); e.code = code; return e; }
  function quinticS(u) { return u * u * u * (10 + u * (-15 + 6 * u)); }
  /**
   * Straight-line TCP move Ta -> Tb (quintic time scaling), IK at every o.dt sample seeded with the
   * previous sample. Throws code 'unreachable' or 'joint-jump' (any joint > maxJumpDeg between
   * samples = configuration flip / singularity). Stretches the duration until no joint exceeds its
   * scaled vmax. Returns {type:'samples', T, h, qs}.
   */
  function cartesianSegment(Ta, Tb, qSeed, chain, o) {
    var Kn = kin(), dist = len(sub(v3(Tb), v3(Ta))), ang = rotAngle(Ta, Tb);
    var T = Math.max(1.875 * dist / o.linSpeed, Math.sqrt(5.7735 * dist / o.linAccel), 1.875 * ang / o.angSpeed, 2 * o.dt);
    var maxJump = o.maxJumpDeg * DEG;
    for (var attempt = 0; attempt < 8; attempt++) {
      var n = Math.max(2, Math.ceil(T / o.dt)), h = T / n, qs = [], prev = qSeed, worst = 0;
      for (var k = 0; k <= n; k++) {
        var P = interpPose(Ta, Tb, quinticS(k / n));
        var r = Kn.ik(P, prev, {}, chain);
        if (!r) throw MotionError('Cartesian move: pose unreachable at sample ' + k + '/' + n, 'unreachable');
        for (var i = 0; i < 6; i++) {
          var dq = Math.abs(r.q[i] - prev[i]);
          if (dq > maxJump) throw MotionError('Cartesian move: joint J' + (i + 1) + ' jumps ' + (dq / DEG).toFixed(1) + ' deg at sample ' + k + ' (limit ' + o.maxJumpDeg + ')', 'joint-jump');
          if (k > 0) worst = Math.max(worst, dq / h / (chain.joints[i].vmax * o.speedScale));
        }
        qs.push(r.q); prev = r.q;
      }
      if (worst <= 1 + 1e-9) return { type: 'samples', T: T, h: h, qs: qs };
      T *= worst * 1.05;
    }
    throw MotionError('Cartesian move: could not satisfy joint velocity limits', 'velocity');
  }

  // ------------------------------------------------------------------ path evaluation
  function holdSegment(q, T) { return { type: 'hold', T: Math.max(0, T), q: q.slice() }; }
  function segEnd(s) { return s.t0 + s.T; }
  function segQ(s, t) {
    var lt = Math.max(0, Math.min(s.T, t - s.t0));
    if (s.type === 'hold') return s.q.slice();
    if (s.type === 'poly') { var q = []; for (var i = 0; i < 6; i++) q.push(polyAt(s.coeffs[i], lt).p); return q; }
    var f = s.T > 0 ? lt / s.h : 0, k = Math.min(s.qs.length - 2, Math.floor(f)), u = f - k;
    if (k < 0) return s.qs[0].slice();
    var a = s.qs[k], b = s.qs[k + 1], out = [];
    for (var j = 0; j < 6; j++) out.push(a[j] + (b[j] - a[j]) * Math.min(1, u));
    return out;
  }
  function segGrip(s, t) {
    var g0 = s.grip0 || 0, g1 = s.grip1 != null ? s.grip1 : g0;
    if (g0 === g1 || s.T <= 0) return g1;
    return g0 + (g1 - g0) * quinticS(Math.max(0, Math.min(1, (t - s.t0) / s.T)));
  }
  function segEndQ(s) { return s.type === 'hold' ? s.q.slice() : s.type === 'poly' ? s.q1.slice() : s.qs[s.qs.length - 1].slice(); }
  /** Append segments to a path, chaining start times. */
  function appendSegs(path, segs) {
    var t = path.segments.length ? segEnd(path.segments[path.segments.length - 1]) : path.t0;
    segs.forEach(function (s) { s.t0 = t; t += s.T; path.segments.push(s); });
    return path;
  }
  function pathEnd(path) { return path.segments.length ? segEnd(path.segments[path.segments.length - 1]) : path.t0; }
  function pathAt(path, t) {
    var S = path.segments, k = 0;
    while (k + 1 < S.length && t >= S[k + 1].t0) k++;
    return { q: segQ(S[k], t), grip: segGrip(S[k], t), index: k };
  }
  /** Sample a path every h seconds -> [{t, q}]. */
  function samplePath(path, h) {
    var out = [], t0 = path.t0, t1 = pathEnd(path);
    for (var t = t0; t < t1; t += h) out.push({ t: t, q: pathAt(path, t).q });
    out.push({ t: t1, q: pathAt(path, t1).q });
    return out;
  }

  // ------------------------------------------------------------------ link capsules
  /** Radii for the 7 link capsules (base column .. tool) from manifest bboxes (meta = manifest.d json). */
  function capsuleRadii(armMeta, toolMeta) {
    var base = armMeta && armMeta.bboxM ? Math.min(0.25, armMeta.bboxM.size[2] / 2) : 0.2;
    var tool = toolMeta && toolMeta.bboxM ? Math.max(toolMeta.bboxM.size[0], toolMeta.bboxM.size[2]) / 2 : 0.07;
    return [base * 0.75, base * 0.6, base * 0.5, base * 0.4, base * 0.35, base * 0.3, tool];
  }
  var DEFAULT_RADII = capsuleRadii(null, null);
  /** Capsules [{a, b, r}] for joint vector q: base->J1 frame, J1->J2, ..., flange->TCP (7). */
  function linkCapsules(q, chain, radii) {
    var F = kin().fkAll(q, chain), r = radii || DEFAULT_RADII, out = [];
    for (var i = 0; i < 7; i++) out.push({ a: v3(F[i]), b: v3(F[i + 1]), r: r[i] });
    return out;
  }
  /** Closest distance between segments p1q1 and p2q2 (Ericson, RTCD 5.1.9). */
  function segSegDist(p1, q1, p2, q2) {
    var d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    var a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), s, t, EPS = 1e-12;
    if (a <= EPS && e <= EPS) return len(r);
    if (a <= EPS) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
    else {
      var c = dot(d1, r);
      if (e <= EPS) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else {
        var b = dot(d1, d2), den = a * e - b * b;
        s = den > EPS ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
        else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      }
    }
    return len(sub(add(p1, scl(d1, s)), add(p2, scl(d2, t))));
  }
  function pointBoxDist(p, box) {
    var d = 0;
    for (var i = 0; i < 3; i++) { var v = Math.max(box.min[i] - p[i], 0, p[i] - box.max[i]); d += v * v; }
    return Math.sqrt(d);
  }
  function capsuleBoxDist(c, box) {
    var best = Infinity;
    for (var k = 0; k <= 8; k++) best = Math.min(best, pointBoxDist(add(c.a, scl(sub(c.b, c.a), k / 8)), box));
    return best - c.r;
  }
  /** Non-adjacent link pairs worth checking on one arm (the spherical-wrist group 3..6 always touches). */
  var SELF_PAIRS = [[0, 3], [0, 4], [0, 5], [0, 6], [1, 4], [1, 5], [1, 6], [2, 5], [2, 6]];
  /** Smallest clearance (m, negative = intersecting) between an arm's own non-adjacent links. */
  function selfClearance(caps) {
    var best = Infinity;
    SELF_PAIRS.forEach(function (p) {
      var A = caps[p[0]], B = caps[p[1]];
      best = Math.min(best, segSegDist(A.a, A.b, B.a, B.b) - A.r - B.r);
    });
    return best;
  }
  /** Smallest clearance between two arms' capsule sets. */
  function armClearance(capsA, capsB) {
    var best = Infinity;
    for (var i = 0; i < capsA.length; i++) for (var j = 0; j < capsB.length; j++) {
      var A = capsA[i], B = capsB[j];
      best = Math.min(best, segSegDist(A.a, A.b, B.a, B.b) - A.r - B.r);
    }
    return best;
  }
  /** Smallest clearance between an arm's links (excluding the base column, which stands inside the cell) and fence boxes. */
  function fenceClearance(caps, boxes) {
    var best = Infinity;
    for (var i = 1; i < caps.length; i++) for (var j = 0; j < (boxes || []).length; j++) best = Math.min(best, capsuleBoxDist(caps[i], boxes[j]));
    return best;
  }

  // ------------------------------------------------------------------ glyph bodies (duck-typed cannon)
  function bodyPosePhys(body) {
    var q = body.quaternion, p = body.position;
    return matFromQuat([q.x, q.y, q.z, q.w], [p.x, p.y, p.z]);
  }
  function toRobot(T, frameInv) { return frameInv ? kin().mul(frameInv, T) : T; }
  /** Body pose in the robot world. */
  function bodyPose(body, frameInv) { return toRobot(bodyPosePhys(body), frameInv); }
  /** Hull vertex groups (one per convex shape) in the robot world. */
  function hullGroups(body, frameInv) {
    var B = bodyPose(body, frameInv), out = [];
    (body.shapes || []).forEach(function (sh, i) {
      if (!sh.vertices) return;
      var o = body.shapeOffsets[i], qo = body.shapeOrientations[i];
      var S = kin().mul(B, matFromQuat([qo.x, qo.y, qo.z, qo.w], [o.x, o.y, o.z]));
      out.push(sh.vertices.map(function (v) { return xform(S, [v.x, v.y, v.z]); }));
    });
    return out;
  }
  function flat(groups) { return [].concat.apply([], groups); }

  /**
   * TCP pose for grasping a glyph body. grasp: 'top-pinch' | 'side-pinch' | 'vacuum'.
   * Glyph local frame: +X advance, +Y up from baseline, +Z depth (glyph_physics.json).
   *  - pinch closes across the glyph thickness (local Z); top-pinch approaches straight down,
   *    side-pinch horizontally from the arm's side. Fingertips sit o.gripDepth past the first
   *    hull point met along the approach. Returns null when the thickness axis points at the tool.
   *  - vacuum approaches the face (local +-Z) that points most upward, cup on the face plane above
   *    the centre of mass.
   */
  function graspPose(body, grasp, o, frameInv, armBase) {
    o = opts(o);
    var B = bodyPose(body, frameInv), com = v3(B), pts = flat(hullGroups(body, frameInv));
    var gx = col(B, 0), gz = col(B, 2), up = [0, 0, 1];
    if (grasp === 'vacuum') {
      var n = dot(gz, up) >= 0 ? gz : scl(gz, -1);
      var top = -Infinity; pts.forEach(function (p) { top = Math.max(top, dot(p, n)); });
      var a = scl(n, -1), x = norm(sub(gx, scl(a, dot(gx, a))));
      if (len(sub(gx, scl(a, dot(gx, a)))) < 1e-6) x = norm(cross([0, 1, 0], a));
      return poseFromAxes(x, cross(a, x), a, add(com, scl(n, top - dot(com, n))));
    }
    var c = gz, appr;
    if (grasp === 'side-pinch') {
      var toward = armBase ? sub(com, v3(armBase)) : [1, 0, 0];
      toward[2] = 0;
      appr = sub(toward, scl(c, dot(toward, c)));
    } else appr = sub([0, 0, -1], scl(c, dot([0, 0, -1], c)));
    if (len(appr) < 0.5) return null;
    appr = norm(appr);
    var first = Infinity, cmin = Infinity, cmax = -Infinity;
    pts.forEach(function (p) { first = Math.min(first, dot(p, appr)); var d = dot(p, c); cmin = Math.min(cmin, d); cmax = Math.max(cmax, d); });
    var pos = add(com, scl(appr, first + o.gripDepth - dot(com, appr)));
    pos = add(pos, scl(c, 0.5 * (cmin + cmax) - dot(pos, c)));
    return poseFromAxes(c, cross(appr, c), appr, pos);
  }

  /**
   * Finger contact check: hull AABBs in the TCP frame against the pad volume
   * (|y| <= padWidth/2, -padLength <= z <= 0 — behind the fingertips). Pinch succeeds when the
   * material between the pads is thinner than the open jaw and thicker than the closed jaw.
   * Returns {ok, width, travel (m per finger), reason}.
   */
  function fingerContact(groups, tcp, o) {
    o = opts(o);
    var inv = kin().invRigid(tcp), xmin = Infinity, xmax = -Infinity, hit = false, hw = o.padWidth / 2;
    groups.forEach(function (g) {
      var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      g.forEach(function (p) { var l = xform(inv, p); for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], l[i]); hi[i] = Math.max(hi[i], l[i]); } });
      if (hi[1] < -hw || lo[1] > hw || hi[2] < -o.padLength || lo[2] > 0) return;
      hit = true; xmin = Math.min(xmin, lo[0]); xmax = Math.max(xmax, hi[0]);
    });
    var closed = o.jawOpen - 2 * o.fingerStroke;
    if (!hit) return { ok: false, width: 0, travel: o.fingerStroke, reason: 'nothing between the fingers' };
    var width = xmax - xmin;
    if (xmin < -o.jawOpen / 2 || xmax > o.jawOpen / 2) return { ok: false, width: width, travel: 0, reason: 'glyph wider than the open jaw / off-centre (' + (width * 1000).toFixed(0) + ' mm)' };
    if (width < closed) return { ok: false, width: width, travel: o.fingerStroke, reason: 'glyph thinner than the closed jaw (' + (width * 1000).toFixed(0) + ' mm)' };
    return { ok: true, width: width, travel: (o.jawOpen - width) / 2 };
  }
  /** Vacuum check: a glyph face normal within vacuumMaxDeg of the tool axis and the cup on the face. */
  function vacuumContact(body, tcp, o, frameInv) {
    o = opts(o);
    var B = bodyPose(body, frameInv), gz = col(B, 2), toolZ = col(tcp, 2);
    var n = dot(gz, toolZ) < 0 ? gz : scl(gz, -1);           // face normal pointing back at the tool
    var ang = Math.acos(Math.max(-1, Math.min(1, -dot(n, toolZ))));
    if (ang > o.vacuumMaxDeg * DEG) return { ok: false, angle: ang, reason: 'face tilted ' + (ang / DEG).toFixed(1) + ' deg from the tool axis' };
    var top = -Infinity; flat(hullGroups(body, frameInv)).forEach(function (p) { top = Math.max(top, dot(p, n)); });
    var gap = Math.abs(dot(v3(tcp), n) - top);
    if (gap > o.vacuumReach) return { ok: false, angle: ang, reason: 'cup ' + (gap * 1000).toFixed(0) + ' mm off the face' };
    return { ok: true, angle: ang };
  }

  // ------------------------------------------------------------------ grasp manager (cannon)
  /**
   * createGrasp({CANNON, frame, rng, ...opts}) -> grasp layer that owns attached / settling bodies.
   *  attach(arm, body, tool) -> {ok, handle?, travel, reason}   (body becomes KINEMATIC, rides the TCP)
   *  sync(dt)       call before world.step: moves attached bodies to TCP * offset with matching velocity
   *  release(handle, slot?, cb?) body -> DYNAMIC at rest; with a slot, watches it settle
   *  update(dt)     settle monitors: cb('set'|'mis-set', info) within o.settleTime
   */
  function createGrasp(go) {
    go = go || {};
    var o = opts(go);
    var C = go.CANNON || (typeof CANNON !== 'undefined' ? CANNON : null) || (root && root.CANNON);
    var DYN = C && C.Body ? C.Body.DYNAMIC : 1, KIN = C && C.Body ? C.Body.KINEMATIC : 4;
    var frame = go.frame || null, frameInv = frame ? kin().invRigid(frame) : null;
    var rng = go.rng || Math.random;
    var handles = [], monitors = [];
    function physOf(Trobot) { return frame ? kin().mul(frame, Trobot) : Trobot; }

    var g = {
      frame: frame, frameInv: frameInv, handles: handles, monitors: monitors,
      contact: function (arm, body, tool) {
        var tcp = kin().fk(arm.q, arm.chain);
        return tool === 'vacuum' ? vacuumContact(body, tcp, o, frameInv) : fingerContact(hullGroups(body, frameInv), tcp, o);
      },
      attach: function (arm, body, tool, pre) {
        var c = pre || g.contact(arm, body, tool);
        if (!c.ok) return c;
        var tcp = kin().fk(arm.q, arm.chain);
        var h = { arm: arm, body: body, tool: tool, offset: kin().mul(kin().invRigid(tcp), bodyPose(body, frameInv)), prev: null, dropAt: null };
        h.jam = tool === 'vacuum' && rng() < o.dropChance;
        h.savedType = body.type; h.savedSleep = body.allowSleep;
        body.type = KIN;
        body.allowSleep = false;
        if (body.wakeUp) body.wakeUp();
        body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0);
        if (body.updateSolveMassProperties) body.updateSolveMassProperties();
        handles.push(h);
        c.handle = h;
        return c;
      },
      sync: function (dt) {
        handles.forEach(function (h) {
          var target = physOf(kin().mul(kin().fk(h.arm.q, h.arm.chain), h.offset));
          var prev = h.prev || bodyPosePhys(h.body), b = h.body;
          var qp = quatFromMat(prev), qt = quatFromMat(target);
          b.position.set(prev[3], prev[7], prev[11]);
          b.quaternion.set(qp[0], qp[1], qp[2], qp[3]);
          var inv = dt > 0 ? 1 / dt : 0;
          b.velocity.set((target[3] - prev[3]) * inv, (target[7] - prev[7]) * inv, (target[11] - prev[11]) * inv);
          var w = rotVecBetween(target, prev);
          b.angularVelocity.set(w[0] * inv, w[1] * inv, w[2] * inv);
          h.prev = target;
        });
      },
      release: function (h, slot, cb, keepVelocity) {
        var i = handles.indexOf(h);
        if (i < 0) return false;
        handles.splice(i, 1);
        var b = h.body;
        if (h.prev) { b.position.set(h.prev[3], h.prev[7], h.prev[11]); var q = quatFromMat(h.prev); b.quaternion.set(q[0], q[1], q[2], q[3]); }
        b.type = h.savedType != null && h.savedType !== KIN ? h.savedType : DYN;
        if (!keepVelocity) { b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0); }
        b.allowSleep = h.savedSleep !== undefined ? h.savedSleep : true;
        if (b.wakeUp) b.wakeUp();
        if (b.updateSolveMassProperties) b.updateSolveMassProperties();
        if (slot) monitors.push({ body: b, slot: slot, t: 0, still: 0, cb: cb });
        return true;
      },
      update: function (dt) {
        for (var i = monitors.length - 1; i >= 0; i--) {
          var m = monitors[i], s = settleState(m.body, m.slot, o, frameInv);
          m.t += dt;
          m.still = s.ok && s.speed < o.settleSpeed ? m.still + dt : 0;
          if (m.still >= 0.1 || m.t >= o.settleTime) {
            monitors.splice(i, 1);
            var verdict = m.still >= 0.1 ? 'set' : 'mis-set';
            if (m.cb) m.cb(verdict, s);
          }
        }
      },
      isAttached: function (body) { return handles.some(function (h) { return h.body === body; }); }
    };
    return g;
  }
  function rotVecBetween(Ta, Tb) {   // world-frame rotation vector taking Tb's rotation onto Ta's
    var e = kin().poseError(Ta, Tb);
    if (e.rot < 1e-12) return [0, 0, 0];
    // axis from the skew part of Ra * Rb^T
    var R = [];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) R[i * 3 + j] = Ta[i * 4] * Tb[j * 4] + Ta[i * 4 + 1] * Tb[j * 4 + 1] + Ta[i * 4 + 2] * Tb[j * 4 + 2];
    var ax = [R[7] - R[5], R[2] - R[6], R[3] - R[1]], l = len(ax);
    if (l < 1e-12) return [0, 0, 0];
    return scl(ax, e.rot / l);
  }

  /**
   * Slot (robot world): {center:[x,y,z] = groove-floor centre, halfX, halfY, yaw (rad, slot x axis
   * in world), wallH}. Settled = glyph local +Y within settleDeg of world up, COM inside the slot
   * footprint, COM above the floor.
   */
  function slotFrame(slot) {
    var c = Math.cos(slot.yaw || 0), s = Math.sin(slot.yaw || 0);
    return [c, -s, 0, slot.center[0], s, c, 0, slot.center[1], 0, 0, 1, slot.center[2], 0, 0, 0, 1];
  }
  function settleState(body, slot, o, frameInv) {
    o = opts(o);
    var B = bodyPose(body, frameInv), up = col(B, 1);
    var tilt = Math.acos(Math.max(-1, Math.min(1, up[2])));
    var local = xform(kin().invRigid(slotFrame(slot)), v3(B));
    var inside = Math.abs(local[0]) <= slot.halfX && Math.abs(local[1]) <= slot.halfY + 0.01 && local[2] > 0;
    var v = body.velocity, speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { ok: tilt < o.settleDeg * DEG && inside, tilt: tilt, inside: inside, local: local, speed: speed };
  }
  /** Upright glyph pose resting in a slot (COM placed from the glyph_physics entry). */
  function slotGlyphPose(slot, entry, scale, clearance) {
    scale = scale || 1;
    var baseY = entry.bbox ? entry.bbox.min[1] : 0, comY = entry.com ? entry.com[1] : 0;
    var h = (comY - baseY) * scale + (clearance || 0);
    // glyph local X -> slot x, local Y -> world up, local Z -> -slot y
    var F = slotFrame(slot);
    var R = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, h, 0, 0, 0, 1];
    return kin().mul(F, R);
  }
  /**
   * Static guide colliders for one slot (floor, two groove walls, two dividers) added to a cannon
   * world. Dimensions default to the type_tray recipe: 110 mm groove, 70 mm walls, 10 x 30 mm dividers.
   */
  function addSlotGuides(CANNONx, world, slot, frame, th) {
    var C = CANNONx, out = [], t = th || 0.01;
    var F = frame ? kin().mul(frame, slotFrame(slot)) : slotFrame(slot);
    var wallH = slot.wallH || 0.07, divH = slot.dividerH || 0.03;
    function box(hx, hy, hz, x, y, z) {
      var b = new C.Body({ mass: 0 });
      b.addShape(new C.Box(new C.Vec3(hx, hy, hz)));
      var p = xform(F, [x, y, z]), q = quatFromMat(F);
      b.position.set(p[0], p[1], p[2]); b.quaternion.set(q[0], q[1], q[2], q[3]);
      world.addBody(b); out.push(b); return b;
    }
    var L = slot.halfX + 0.05;
    box(L, slot.halfY + t * 2, t, 0, 0, -t);                                  // floor
    box(L, t, wallH / 2, 0, slot.halfY + t, wallH / 2);                       // back wall
    box(L, t, wallH / 2, 0, -slot.halfY - t, wallH / 2);                      // front wall
    box(0.005, slot.halfY, divH / 2, slot.halfX + 0.005, 0, divH / 2);        // dividers
    box(0.005, slot.halfY, divH / 2, -slot.halfX - 0.005, 0, divH / 2);
    return out;
  }
  /** The 12 slots of a type_tray placed at trayPose (robot world, tray recipe frame: Z up, mm -> m). */
  function traySlots(trayPose) {
    var out = [], T = trayPose || kin().identity();
    var yaw = Math.atan2(T[4], T[0]);
    for (var i = 0; i < 12; i++) {
      var c = xform(T, [-1.54 + 0.28 * i, 0, 0.72]);
      out.push({ id: i, center: c, halfX: 0.135, halfY: 0.055, yaw: yaw, wallH: 0.07, dividerH: 0.03 });
    }
    return out;
  }

  // ------------------------------------------------------------------ schedule timing
  /** Shift every job in `jobs` that starts at/after `from` by `delay` seconds (in place). */
  function shiftSchedule(jobs, from, delay) {
    var n = 0;
    (jobs || []).forEach(function (j) {
      if (j.tPick != null && j.tPick >= from - 1e-9) {
        j.tPick += delay; if (j.tPlace != null) j.tPlace += delay; if (j.tEnd != null) j.tEnd += delay; n++;
      }
    });
    return n;
  }

  // ------------------------------------------------------------------ hub + arm controllers
  var hubs = [];
  /**
   * createHub(o):
   *  o.resolve(job, arm, hub) -> {body, grasp?, pickTcp?, placeGlyph? | placeTcp?, slot?} | null
   *  o.grasp   createGrasp(...) instance (optional; without it jobs run motion only)
   *  o.fence   [{min:[3], max:[3]}] boxes in the robot world
   *  o.onEvent(type, info)   'start','grasp','miss','jam','release','set','mis-set','done','hold','delay','fail','giveup'
   *  o.onReschedule(job, delay, queued) notified whenever a job runs late; queued jobs are already shifted
   *  o.repick(job) -> job|null  override for re-pick after miss/mis-set/jam (default: same job ASAP)
   */
  function createHub(ho) {
    ho = ho || {};
    var o = opts(ho);
    var hub = {
      time: 0, arms: {}, armList: [], opts: o, grasp: ho.grasp || null, fence: ho.fence || [],
      events: [], autoUpdate: ho.autoUpdate !== false,
      addArm: function (ao) {
        var Kn = kin(), chain0 = ao.chain || Kn.DEFAULT_CHAIN;
        var arm = {
          id: ao.id, q: (ao.q || Kn.homePose(chain0)).slice(), tool: ao.tool || 'pinch', grip: 0,
          chains: {
            pinch: armChain(chain0, ao.basePose || chain0.base, (ao.toolLength && ao.toolLength.pinch) || o.toolLength.pinch),
            vacuum: armChain(chain0, ao.basePose || chain0.base, (ao.toolLength && ao.toolLength.vacuum) || o.toolLength.vacuum)
          },
          radii: ao.radii || DEFAULT_RADII, rig: ao.rig || null, fingers: ao.fingers || null,
          queue: [], path: null, job: null, seg: 0, handle: null, held: 0, log: []
        };
        arm.chain = arm.chains[arm.tool];
        hub.arms[arm.id] = arm; hub.armList.push(arm);
        return arm;
      },
      load: function (schedule) {
        (schedule || []).slice().sort(function (a, b) { return a.tPick - b.tPick; }).forEach(function (it) {
          var arm = hub.arms[it.armId];
          if (arm) arm.queue.push(Object.assign({}, it, { retries: 0 }));
        });
      },
      enqueue: function (armId, job, front) {
        var arm = hub.arms[armId]; if (!arm) return;
        job.retries = job.retries || 0;
        if (front) arm.queue.unshift(job); else arm.queue.push(job);
      },
      emit: function (type, info) {
        hub.events.push({ t: hub.time, type: type, info: info });
        if (hub.events.length > 500) hub.events.shift();
        if (ho.onEvent) { try { ho.onEvent(type, info); } catch (e) { /* game code must not stop the arms */ } }
      },
      queued: function () { var all = []; hub.armList.forEach(function (a) { all = all.concat(a.queue); }); return all; },
      delay: function (job, d, from) {
        if (!(d > 1e-3)) return;
        var n = shiftSchedule(hub.queued(), from != null ? from : (job.tPick || 0), d);
        hub.emit('delay', { job: job, delay: d, shifted: n });
        if (ho.onReschedule) { try { ho.onReschedule(job, d, hub.queued()); } catch (e) { /* ignore */ } }
      },
      update: function (dt) {
        hub.time += dt;
        hub.armList.forEach(function (arm) { stepArm(hub, arm, dt); });
        if (hub.grasp) {
          hub.grasp.handles.slice().forEach(function (h) {
            if (h.dropAt != null && hub.time >= h.dropAt) {
              hub.grasp.release(h, null, null, true);
              h.arm.handle = null;
              hub.emit('jam', { arm: h.arm.id, job: h.arm.job, body: h.body });
              repick(hub, h.arm, h.arm.job, 'jam');
            }
          });
          hub.grasp.sync(dt);
          hub.grasp.update(dt);
        }
      },
      /** Predicted minimum clearance of arm's path from t0 to t1 against the other arms and the fence. */
      clearance: function (arm, t0, t1) {
        var best = Infinity;
        for (var t = t0; t <= t1 + 1e-9; t += o.guardStep) {
          var caps = linkCapsules(pathAt(arm.path, t).q, arm.chain, arm.radii);
          best = Math.min(best, fenceClearance(caps, hub.fence));
          hub.armList.forEach(function (other) {
            if (other === arm) return;
            var qo = other.path && !other.holding ? pathAt(other.path, Math.min(t, pathEnd(other.path))).q : other.q;
            best = Math.min(best, armClearance(caps, linkCapsules(qo, other.chain, other.radii)));
          });
        }
        return best;
      }
    };
    hubs.push(hub);
    return hub;
  }

  function applyArm(arm) {
    if (arm.rig && arm.rig.setJoints) arm.rig.setJoints(arm.q);
    if (arm.fingers) arm.fingers.forEach(function (f) {
      f.node.position.set(f.rest.x + f.axis[0] * arm.grip, f.rest.y + f.axis[1] * arm.grip, f.rest.z + f.axis[2] * arm.grip);
    });
  }

  function fail(hub, arm, job, why) {
    arm.path = null; arm.job = null;
    hub.emit('fail', { arm: arm.id, job: job, reason: why });
  }
  function repick(hub, arm, job, why) {
    if (!job) return;
    if ((job.retries || 0) >= hub.opts.maxRetries) { hub.emit('giveup', { arm: arm.id, job: job, reason: why }); return; }
    var nj = null;
    if (hub.opts.repick) nj = hub.opts.repick(job, why);
    else nj = Object.assign({}, job, { tPick: null, tPlace: null, retries: (job.retries || 0) + 1, repickOf: why });
    if (nj) arm.queue.unshift(nj);
  }

  /** Build the pick half of a job's path. */
  function startJob(hub, arm, job) {
    var o = hub.opts, Kn = kin();
    var res = hub.opts.resolve ? hub.opts.resolve(job, arm, hub) : job.resolved;
    if (!res || !res.body && !res.pickTcp) return fail(hub, arm, job, 'nothing to pick');
    var tool = res.grasp === 'vacuum' || job.grasp === 'vacuum' ? 'vacuum' : 'pinch';
    if (tool !== arm.tool) { arm.tool = tool; arm.chain = arm.chains[tool]; hub.emit('toolChange', { arm: arm.id, tool: tool }); }
    var frameInv = hub.grasp ? hub.grasp.frameInv : null;
    var pick = res.pickTcp || graspPose(res.body, res.grasp || job.grasp || 'top-pinch', o, frameInv, arm.chain.base);
    if (!pick) return fail(hub, arm, job, 'no grasp pose for ' + (job.grasp || 'top-pinch'));
    var pre = alongZ(pick, -o.approach);
    var r = Kn.ik(pre, arm.q, {}, arm.chain);
    if (!r) return fail(hub, arm, job, 'pre-pick unreachable');
    var path = { t0: hub.time, segments: [], job: job, res: res, pick: pick, prePick: pre, qPrePick: r.q };
    try {
      var tr = transitSegments(arm.q, viaQ(arm, Kn.fk(arm.q, arm.chain), pre, o), r.q, arm.chain, o);
      tr[0].guard = true; tr.forEach(function (s) { s.phase = 'transit-in'; });
      appendSegs(path, tr);
      var down = cartesianSegment(pre, pick, r.q, arm.chain, o); down.phase = 'approach';
      var tClose = pathEnd(path) + down.T;
      if (job.tPick != null && tClose < job.tPick) appendSegs(path, [Object.assign(holdSegment(r.q, job.tPick - tClose), { phase: 'wait-pick' })]);
      appendSegs(path, [down]);
      var qPick = segEndQ(down);
      appendSegs(path, [Object.assign(holdSegment(qPick, o.gripTime), { phase: 'close', grip0: 0, grip1: o.fingerStroke, onStart: 'contact', onEnd: 'attach' })]);
    } catch (e) { return fail(hub, arm, job, e.message); }
    arm.path = path; arm.job = job; arm.seg = -1;
    var late = segEnd(path.segments[path.segments.length - 2]) - (job.tPick != null ? job.tPick : -Infinity);
    hub.emit('start', { arm: arm.id, job: job });
    if (job.tPick != null && late > 1e-3) {
      if (job.tPlace != null) job.tPlace += late;
      hub.delay(job, late, job.tPick);
    }
  }

  /** Transit waypoint above the zone boundary between two TCP poses. */
  function viaQ(arm, Ta, Tb, o) {
    var pa = v3(Ta), pb = v3(Tb);
    var z = o.viaZ != null ? o.viaZ : Math.max(pa[2], pb[2]) + o.viaLift;
    if (len(sub(pa, pb)) < 0.2) return null;
    var V = interpPose(Ta, Tb, 0.5); V[11] = Math.max(z, pa[2], pb[2]);
    var r = kin().ik(V, arm.q, {}, arm.chain);
    return r ? r.q : null;
  }

  /** Build the place half once the glyph is held (uses the real grasp offset). */
  function placeHalf(hub, arm) {
    var o = hub.opts, Kn = kin(), path = arm.path, job = path.job, res = path.res, h = arm.handle;
    var placeTcp = res.placeTcp || (res.placeGlyph && h ? Kn.mul(res.placeGlyph, Kn.invRigid(h.offset)) : null);
    var qNow = segEndQ(path.segments[path.segments.length - 1]);
    var segs = [];
    try {
      var lift = cartesianSegment(path.pick, path.prePick, qNow, arm.chain, o); lift.phase = 'lift';
      segs.push(lift);
      if (!placeTcp) { appendSegs(path, segs); return; }
      var prePlace = alongZ(placeTcp, -o.approach);
      var rp = Kn.ik(prePlace, segEndQ(lift), {}, arm.chain);
      if (!rp) throw MotionError('pre-place unreachable', 'unreachable');
      var tr = transitSegments(segEndQ(lift), viaQ({ q: segEndQ(lift), chain: arm.chain }, path.prePick, prePlace, o), rp.q, arm.chain, o);
      tr[0].guard = true; tr.forEach(function (s) { s.phase = 'transit'; });
      segs = segs.concat(tr);
      var down = cartesianSegment(prePlace, placeTcp, rp.q, arm.chain, o); down.phase = 'place';
      var qPlace = segEndQ(down);
      var up = cartesianSegment(placeTcp, prePlace, qPlace, arm.chain, o); up.phase = 'retreat';
      var t = pathEnd(path); segs.forEach(function (s) { t += s.T; });
      var tOpen = t + down.T;
      if (job.tPlace != null && tOpen < job.tPlace) segs.push(Object.assign(holdSegment(rp.q, job.tPlace - tOpen), { phase: 'wait-place' }));
      segs.push(down);
      segs.push(Object.assign(holdSegment(qPlace, o.gripTime), { phase: 'open', grip0: arm.grip, grip1: 0, onStart: 'release' }));
      segs.push(up);
      appendSegs(path, segs);
      if (h && h.jam) { var ts = tr[0]; h.dropAt = ts.t0 + ts.T * 0.5; }
      var late = job.tPlace != null ? tOpen - job.tPlace : 0;
      if (late > 1e-3) hub.delay(job, late, job.tPlace);
    } catch (e) {
      appendSegs(path, segs);
      hub.emit('fail', { arm: arm.id, job: job, reason: e.message });
    }
  }

  function onSegEvent(hub, arm, s, what) {
    var path = arm.path, job = path.job, res = path.res, g = hub.grasp;
    if (what === 'contact') {
      path.contact = g && res.body ? g.contact(arm, res.body, arm.tool) : { ok: !!res.pickTcp && !res.body, travel: hub.opts.fingerStroke };
      s.grip1 = arm.tool === 'vacuum' ? 0 : (path.contact.travel != null ? path.contact.travel : hub.opts.fingerStroke);
    } else if (what === 'attach') {
      if (g && res.body) {
        var c = path.contact && path.contact.ok ? g.attach(arm, res.body, arm.tool, path.contact) : (path.contact || { ok: false, reason: 'no contact' });
        if (c.ok) { arm.handle = c.handle; hub.emit('grasp', { arm: arm.id, job: job, body: res.body }); }
        else {
          hub.emit('miss', { arm: arm.id, job: job, reason: c.reason });
          path.res = Object.assign({}, res, { placeTcp: null, placeGlyph: null });
          placeHalf(hub, arm);
          // open the fingers again on the way up
          path.segments[path.segments.length - 1].grip0 = arm.grip; path.segments[path.segments.length - 1].grip1 = 0;
          repick(hub, arm, job, 'miss');
          return;
        }
      }
      placeHalf(hub, arm);
    } else if (what === 'release') {
      var h = arm.handle;
      arm.handle = null;
      if (g && h) {
        g.release(h, res.slot || null, res.slot ? function (verdict, st) {
          hub.emit(verdict, { arm: arm.id, job: job, body: h.body, tilt: st.tilt, local: st.local });
          if (verdict === 'mis-set') repick(hub, arm, job, 'mis-set');
        } : null);
        hub.emit('release', { arm: arm.id, job: job, body: h.body });
      }
    }
  }

  function stepArm(hub, arm, dt) {
    if (!arm.path) {
      if (!arm.queue.length) return;
      startJob(hub, arm, arm.queue.shift());
      if (!arm.path) return;
    }
    var path = arm.path, S = path.segments, o = hub.opts;
    // enter every segment whose start time has passed (guard checks may push the rest later)
    while (arm.seg + 1 < S.length && hub.time >= S[arm.seg + 1].t0) {
      var nx = S[arm.seg + 1];
      if (nx.guard && !nx.cleared) {
        var end = segEnd(nx) + (S[arm.seg + 2] ? S[arm.seg + 2].T : 0);
        if (hub.clearance(arm, nx.t0, end) < o.capsuleMargin) {
          var shift = hub.time - nx.t0 + Math.min(dt, o.holdRecheck);
          for (var k = arm.seg + 1; k < S.length; k++) S[k].t0 += shift;
          arm.held += shift;
          if (!arm.holding) hub.emit('hold', { arm: arm.id, job: path.job });
          arm.holding = true;
          break;
        }
        nx.cleared = true;
        if (arm.holding) { arm.holding = false; hub.delay(path.job, arm.held, path.job.tPick != null ? path.job.tPick : hub.time); arm.held = 0; }
      }
      if (arm.seg >= 0 && S[arm.seg].onEnd && !S[arm.seg].ended) { S[arm.seg].ended = true; onSegEvent(hub, arm, S[arm.seg], S[arm.seg].onEnd); }
      arm.seg++;
      if (nx.onStart) onSegEvent(hub, arm, nx, nx.onStart);
      if (arm.path !== path) return;
      S = path.segments;
    }
    var cur = S[Math.max(0, arm.seg)];
    var tEval = Math.min(hub.time, segEnd(cur));
    if (arm.seg >= 0) { arm.q = segQ(cur, tEval); arm.grip = segGrip(cur, tEval); }
    applyArm(arm);
    // finished the last segment: fire its end event, then either more segments were appended or the job is done
    if (arm.seg === S.length - 1 && hub.time >= segEnd(cur)) {
      if (cur.onEnd && !cur.ended) { cur.ended = true; onSegEvent(hub, arm, cur, cur.onEnd); }
      if (arm.seg === path.segments.length - 1) {
        hub.emit('done', { arm: arm.id, job: path.job });
        arm.path = null; arm.job = null;
      }
    }
  }

  function updateAll(dt) { hubs.forEach(function (h) { if (h.autoUpdate) h.update(dt); }); }
  function removeHub(h) { var i = hubs.indexOf(h); if (i >= 0) hubs.splice(i, 1); }

  /** Find gripper finger nodes (finger_l / finger_r) for the prismatic close animation. */
  function bindFingers(group, axes) {
    var out = [];
    var ax = axes || { finger_l: [1, 0, 0], finger_r: [-1, 0, 0] };
    group.traverse(function (n) {
      if (ax[n.name]) out.push({ node: n, axis: ax[n.name], rest: { x: n.position.x, y: n.position.y, z: n.position.z } });
    });
    return out;
  }

  var api = {
    DEFAULTS: DEFAULTS, Z_UP_TO_Y_UP: Z_UP_TO_Y_UP,
    // pure path pieces
    armChain: armChain, hermite5: hermite5, quinticRestTime: quinticRestTime, jointSegment: jointSegment,
    transitSegments: transitSegments, cartesianSegment: cartesianSegment, holdSegment: holdSegment,
    appendSegs: appendSegs, pathAt: pathAt, pathEnd: pathEnd, samplePath: samplePath, segEndQ: segEndQ,
    interpPose: interpPose, alongZ: alongZ, quatFromMat: quatFromMat, matFromQuat: matFromQuat,
    // collision
    capsuleRadii: capsuleRadii, linkCapsules: linkCapsules, segSegDist: segSegDist, selfClearance: selfClearance,
    armClearance: armClearance, fenceClearance: fenceClearance,
    // grasp
    graspPose: graspPose, fingerContact: fingerContact, vacuumContact: vacuumContact, hullGroups: hullGroups,
    bodyPose: bodyPose, createGrasp: createGrasp, settleState: settleState, slotGlyphPose: slotGlyphPose,
    addSlotGuides: addSlotGuides, traySlots: traySlots,
    // runtime
    shiftSchedule: shiftSchedule, createHub: createHub, updateAll: updateAll, removeHub: removeHub, hubs: hubs,
    bindFingers: bindFingers
  };

  // Per-frame work rides the LLHooks bus (docs/HOOKS.md) — never a line in a core file.
  if (typeof LLHooks !== 'undefined' && LLHooks && LLHooks.on) {
    LLHooks.on('frame', function (dt) { updateAll(dt); });
  }
  return api;
});
