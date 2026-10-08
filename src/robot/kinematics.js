/**
 * src/robot/kinematics.js — LLF-75 [Robot-2]
 * Pure 6-DOF kinematics for the robot letter-factory arm. No THREE dependency.
 * Browser: window.RobotKin.  Node: require('./src/robot/kinematics.js').
 *
 * Conventions
 *  - Robot base frame, Z up, metres, radians internally. Joint tables are written in degrees.
 *  - Poses are 4x4 homogeneous matrices as flat 16-element arrays, ROW-major
 *    (THREE.Matrix4.set(...) takes the same order: m.set.apply(m, T)).
 *  - Standard DH per joint i: T = Rz(theta) * Tz(d) * Tx(a) * Rx(alpha), theta = q + offset.
 *
 * DEFAULT_JOINT_TABLE — stand-in until the Robot-1 manifest (GLB joint table) exists.
 * Proportions are a generic 6-axis, ~10 kg payload, ~1.42 m reach industrial arm with a
 * spherical wrist. Sources: public manufacturer datasheets for the 10 kg / 1.42-1.45 m class
 * (e.g. a 10 kg / 1450 mm arm spec sheet: J1 +-170, J2 +70/-150, J3 +142/-155, J4 +-170,
 * J5 +-120, J6 +-360 deg; speeds 220/220/220/375/375/450 deg/s; reach 1450 mm), plus typical
 * link proportions of that class (base 450 mm, shoulder offset 150 mm, upper arm 610 mm,
 * elbow offset 100 mm, forearm 660 mm, flange 100 mm -> wrist-centre reach ~1.43 m).
 * Accelerations are not published; amax is an estimate (~3x vmax per second).
 * Swap the table with dhFromManifest(manifest.joints) when Robot-1 lands — same row shape.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RobotKin = api;
})(this, function () {
  'use strict';
  var PI = Math.PI, D2R = PI / 180;

  // ---------- default joint table (degrees / metres) ----------
  var DEFAULT_JOINT_TABLE = [
    { name: 'J1', dh: { d: 0.450, a: 0.150, alpha: -90, offset: 0 },   limits: { min: -170, max: 170 }, vmax: 220, amax: 660,  weight: 1.5 },
    { name: 'J2', dh: { d: 0,     a: 0.610, alpha: 0,   offset: -90 }, limits: { min: -70,  max: 150 }, vmax: 220, amax: 660,  weight: 1.5 },
    { name: 'J3', dh: { d: 0,     a: 0.100, alpha: -90, offset: 0 },   limits: { min: -142, max: 155 }, vmax: 220, amax: 660,  weight: 1.0 },
    { name: 'J4', dh: { d: 0.660, a: 0,     alpha: 90,  offset: 0 },   limits: { min: -170, max: 170 }, vmax: 375, amax: 1125, weight: 0.6 },
    { name: 'J5', dh: { d: 0,     a: 0,     alpha: -90, offset: 0 },   limits: { min: -120, max: 120 }, vmax: 375, amax: 1125, weight: 0.6 },
    { name: 'J6', dh: { d: 0.100, a: 0,     alpha: 0,   offset: 0 },   limits: { min: -360, max: 360 }, vmax: 450, amax: 1350, weight: 0.4 }
  ];

  // ---------- small matrix helpers (row-major 4x4) ----------
  function ident() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mul(A, B) {
    var C = new Array(16);
    for (var r = 0; r < 4; r++) {
      var a0 = A[r*4], a1 = A[r*4+1], a2 = A[r*4+2], a3 = A[r*4+3];
      C[r*4]   = a0*B[0] + a1*B[4] + a2*B[8]  + a3*B[12];
      C[r*4+1] = a0*B[1] + a1*B[5] + a2*B[9]  + a3*B[13];
      C[r*4+2] = a0*B[2] + a1*B[6] + a2*B[10] + a3*B[14];
      C[r*4+3] = a0*B[3] + a1*B[7] + a2*B[11] + a3*B[15];
    }
    return C;
  }
  function invRigid(T) {
    // [R p]^-1 = [R^T, -R^T p]
    var r = [T[0],T[4],T[8], T[1],T[5],T[9], T[2],T[6],T[10]];
    var px = T[3], py = T[7], pz = T[11];
    return [r[0],r[1],r[2], -(r[0]*px + r[1]*py + r[2]*pz),
            r[3],r[4],r[5], -(r[3]*px + r[4]*py + r[5]*pz),
            r[6],r[7],r[8], -(r[6]*px + r[7]*py + r[8]*pz),
            0,0,0,1];
  }
  function dhMat(theta, d, a, alpha) {
    var ct = Math.cos(theta), st = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha);
    return [ct, -st*ca,  st*sa, a*ct,
            st,  ct*ca, -ct*sa, a*st,
            0,   sa,     ca,    d,
            0,   0,      0,     1];
  }
  /** Pose from position (m) and fixed-axis roll/pitch/yaw (rad): R = Rz(yaw) Ry(pitch) Rx(roll). */
  function poseFromXYZRPY(x, y, z, roll, pitch, yaw) {
    var cr = Math.cos(roll||0), sr = Math.sin(roll||0), cp = Math.cos(pitch||0), sp = Math.sin(pitch||0),
        cy = Math.cos(yaw||0), sy = Math.sin(yaw||0);
    return [cy*cp, cy*sp*sr - sy*cr, cy*sp*cr + sy*sr, x,
            sy*cp, sy*sp*sr + cy*cr, sy*sp*cr - cy*sr, y,
            -sp,   cp*sr,            cp*cr,            z,
            0,0,0,1];
  }
  function xyzRPYFromPose(T) {
    var pitch = Math.atan2(-T[8], Math.sqrt(T[0]*T[0] + T[4]*T[4]));
    return { x: T[3], y: T[7], z: T[11], roll: Math.atan2(T[9], T[10]), pitch: pitch, yaw: Math.atan2(T[4], T[0]) };
  }
  /** Rotation-vector (axis*angle, world frame) taking Rb onto Ra: log(Ra * Rb^T). */
  function rotErrVec(Ta, Tb) {
    // R = Ra * Rb^T
    var R = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      R[i*3+j] = Ta[i*4]*Tb[j*4] + Ta[i*4+1]*Tb[j*4+1] + Ta[i*4+2]*Tb[j*4+2];
    var tr = R[0] + R[4] + R[8];
    var c = Math.max(-1, Math.min(1, (tr - 1) / 2));
    var ang = Math.acos(c);
    var vx = R[7] - R[5], vy = R[2] - R[6], vz = R[3] - R[1];
    if (ang < 1e-9) return [vx/2, vy/2, vz/2];
    if (PI - ang < 1e-6) {
      // near 180 deg: axis from the diagonal
      var xx = Math.sqrt(Math.max(0, (R[0]+1)/2)), yy = Math.sqrt(Math.max(0, (R[4]+1)/2)), zz = Math.sqrt(Math.max(0, (R[8]+1)/2));
      if (xx >= yy && xx >= zz) { yy = (R[1]+R[3])/(4*xx); zz = (R[2]+R[6])/(4*xx); }
      else if (yy >= zz) { xx = (R[1]+R[3])/(4*yy); zz = (R[5]+R[7])/(4*yy); }
      else { xx = (R[2]+R[6])/(4*zz); yy = (R[5]+R[7])/(4*zz); }
      return [xx*ang, yy*ang, zz*ang];
    }
    var k = ang / (2 * Math.sin(ang));
    return [vx*k, vy*k, vz*k];
  }
  /** Position error (m) and rotation error (rad) between two poses. */
  function poseError(Ta, Tb) {
    var dx = Ta[3]-Tb[3], dy = Ta[7]-Tb[7], dz = Ta[11]-Tb[11];
    var w = rotErrVec(Ta, Tb);
    return { pos: Math.sqrt(dx*dx+dy*dy+dz*dz), rot: Math.sqrt(w[0]*w[0]+w[1]*w[1]+w[2]*w[2]) };
  }
  function wrapPi(x) { x = (x + PI) % (2*PI); if (x < 0) x += 2*PI; return x - PI; }

  // ---------- chain construction ----------
  /**
   * dhFromManifest(jointTable) -> chain.
   * jointTable rows: {name, dh:{d,a,alpha(deg),offset(deg)}, limits:{min,max}(deg), vmax(deg/s), amax(deg/s^2), weight, axis?}
   * Also accepts {joints:[...], base:16[], tool:16[]} (a manifest object). Rows without dh are rejected
   * (URDF origin/axis conversion is a later ticket once the Robot-1 manifest format is fixed).
   */
  function dhFromManifest(jointTable) {
    var rows = Array.isArray(jointTable) ? jointTable : (jointTable && jointTable.joints);
    if (!rows || rows.length !== 6) throw new Error('RobotKin.dhFromManifest: need exactly 6 joints');
    var joints = rows.map(function (r, i) {
      if (!r.dh) throw new Error('RobotKin.dhFromManifest: joint ' + (r.name || i) + ' has no dh block');
      var lim = r.limits || {};
      return {
        name: r.name || ('J' + (i+1)),
        d: +r.dh.d || 0, a: +r.dh.a || 0, alpha: (+r.dh.alpha || 0) * D2R, offset: (+r.dh.offset || 0) * D2R,
        min: (lim.min != null ? lim.min : -180) * D2R, max: (lim.max != null ? lim.max : 180) * D2R,
        vmax: (r.vmax != null ? r.vmax : 180) * D2R, amax: (r.amax != null ? r.amax : 540) * D2R,
        weight: r.weight != null ? r.weight : 1,
        axis: r.axis || null
      };
    });
    var J = joints, eps = 1e-9;
    // Analytic solver supports the classic layout: alpha = [-90, 0, -90, +90, -90, 0], d2=d3=d5=0, a4=a5=a6=0.
    var pattern = [-PI/2, 0, -PI/2, PI/2, -PI/2, 0];
    var analytic = J.every(function (j, i) { return Math.abs(j.alpha - pattern[i]) < 1e-6; }) &&
      Math.abs(J[1].d) < eps && Math.abs(J[2].d) < eps && Math.abs(J[4].d) < eps &&
      Math.abs(J[3].a) < eps && Math.abs(J[4].a) < eps && Math.abs(J[5].a) < eps;
    var g = {
      d1: J[0].d, a1: J[0].a, a2: J[1].a, a3: J[2].a, d4: J[3].d, d6: J[5].d
    };
    g.L3 = Math.sqrt(g.a3*g.a3 + g.d4*g.d4);
    g.beta = Math.atan2(g.d4, g.a3);
    g.reachMax = g.a2 + g.L3;              // shoulder -> wrist centre
    g.reachMin = Math.abs(g.a2 - g.L3);
    return {
      joints: joints,
      base: (jointTable && jointTable.base) || ident(),
      tool: (jointTable && jointTable.tool) || ident(),
      analytic: analytic,
      geom: g
    };
  }

  var DEFAULT_CHAIN = dhFromManifest(DEFAULT_JOINT_TABLE);
  function C(chain) { return chain || DEFAULT_CHAIN; }

  // ---------- forward kinematics ----------
  /** Per-link poses: [base, after J1, ..., after J6 (flange), tool]. Length 8. */
  function fkAll(q, chain) {
    chain = C(chain);
    var T = chain.base.slice(), out = [T];
    for (var i = 0; i < 6; i++) {
      var j = chain.joints[i];
      T = mul(T, dhMat(q[i] + j.offset, j.d, j.a, j.alpha));
      out.push(T);
    }
    out.push(mul(T, chain.tool));
    return out;
  }
  /** Flange/tool pose for joint vector q (rad). */
  function fk(q, chain) { var all = fkAll(q, chain); return all[7]; }

  // ---------- limits ----------
  function withinLimits(q, chain, tol) {
    chain = C(chain); tol = tol || 1e-9;
    for (var i = 0; i < 6; i++) {
      var j = chain.joints[i];
      if (!(q[i] >= j.min - tol && q[i] <= j.max + tol)) return false;
    }
    return true;
  }
  /** Choose q + 2k*pi inside [min,max] closest to ref; NaN if none fits. */
  function fitAngle(a, ref, min, max) {
    var best = NaN, bd = Infinity;
    var k0 = Math.ceil((min - a) / (2*PI)), k1 = Math.floor((max - a) / (2*PI));
    for (var k = k0; k <= k1; k++) {
      var c = a + 2*PI*k, dd = Math.abs(c - ref);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }
  function weightedDist(q, s, chain) {
    var sum = 0;
    for (var i = 0; i < 6; i++) { var d = q[i] - s[i]; sum += chain.joints[i].weight * d * d; }
    return sum;
  }

  // ---------- reachability ----------
  function wristCentre(T, chain) {
    // undo base and tool, then step back d6 along flange z
    chain = C(chain);
    var F = mul(mul(invRigid(chain.base), T), invRigid(chain.tool));
    var d6 = chain.geom.d6;
    return { F: F, x: F[3] - d6*F[2], y: F[7] - d6*F[6], z: F[11] - d6*F[10] };
  }
  /** Quick O(1) check: is the wrist centre inside the shoulder annulus (either shoulder config)? */
  function reachable(T, chain) {
    chain = C(chain);
    var g = chain.geom, w = wristCentre(T, chain);
    var rxy = Math.sqrt(w.x*w.x + w.y*w.y), dz = w.z - g.d1, tol = 1e-9;
    var rf = rxy - g.a1, rb = -rxy - g.a1;
    var df = Math.sqrt(rf*rf + dz*dz), db = Math.sqrt(rb*rb + dz*dz);
    return (df <= g.reachMax + tol && df >= g.reachMin - tol) || (db <= g.reachMax + tol && db >= g.reachMin - tol);
  }

  // ---------- analytic IK ----------
  /**
   * All raw analytic solutions (no limit filtering), up to 8: shoulder front/back x elbow up/down x wrist flip.
   * Returns {solutions:[{q,shoulder,elbow,wrist,singular}], singular:boolean}.
   */
  function ikAnalyticAll(T, qSeed, chain) {
    chain = C(chain);
    var g = chain.geom, J = chain.joints, sols = [], anySing = false;
    if (!chain.analytic) return { solutions: sols, singular: false };
    var w = wristCentre(T, chain), F = w.F;
    var rxy = Math.sqrt(w.x*w.x + w.y*w.y);
    var shoulderSing = rxy < 1e-6;
    var t1base = shoulderSing ? (qSeed ? qSeed[0] + J[0].offset : 0) : Math.atan2(w.y, w.x);
    for (var sh = 0; sh < 2; sh++) {
      var t1 = sh === 0 ? t1base : t1base + PI;
      var r = sh === 0 ? rxy : -rxy;
      var Dx = r - g.a1, Dy = w.z - g.d1;
      var D2 = Dx*Dx + Dy*Dy;
      var cg = (D2 - g.a2*g.a2 - g.L3*g.L3) / (2 * g.a2 * g.L3);
      if (cg > 1 + 1e-9 || cg < -1 - 1e-9) continue;
      cg = Math.max(-1, Math.min(1, cg));
      var elbowSing = Math.abs(Math.abs(cg) - 1) < 1e-9;
      for (var el = 0; el < 2; el++) {
        if (elbowSing && el === 1) break;
        var gam = (el === 0 ? 1 : -1) * Math.acos(cg);
        var phi2 = Math.atan2(Dy, Dx) - Math.atan2(g.L3*Math.sin(gam), g.a2 + g.L3*Math.cos(gam));
        var t2 = -phi2, t3 = -(gam + g.beta);
        var q1 = t1 - J[0].offset, q2 = t2 - J[1].offset, q3 = t3 - J[2].offset;
        // R03, then R36 = R03^T R
        var T03 = mul(mul(mul(chain.base, dhMat(t1, J[0].d, J[0].a, J[0].alpha)), dhMat(t2, J[1].d, J[1].a, J[1].alpha)), dhMat(t3, J[2].d, J[2].a, J[2].alpha));
        T03 = mul(invRigid(chain.base), T03);
        var R = new Array(9);
        for (var i = 0; i < 3; i++) for (var k = 0; k < 3; k++)
          R[i*3+k] = T03[i]*F[k] + T03[4+i]*F[4+k] + T03[8+i]*F[8+k];
        // R36 = Rz(t4) * Ry(-t5) * Rz(t6)
        var s5abs = Math.sqrt(R[2]*R[2] + R[5]*R[5]);
        var wristSing = s5abs < 1e-6;
        if (wristSing) {
          anySing = true;
          // t5 = 0 (or pi): only t4 + t6 is determined. Keep t4 at the seed.
          var t5 = R[8] > 0 ? 0 : PI;
          var t4 = qSeed ? qSeed[3] + J[3].offset : 0;
          var sum = Math.atan2(R[3], R[0]); // for t5=0: R = Rz(t4+t6)
          // t5 = pi: Rz(t4)Ry(-pi)Rz(t6) has R00 = -cos(t4-t6), R10 = -sin(t4-t6)
          var t6 = R[8] > 0 ? sum - t4 : t4 - Math.atan2(-R[3], -R[0]);
          sols.push({ q: [q1, q2, q3, t4 - J[3].offset, t5 - J[4].offset, t6 - J[5].offset], shoulder: sh, elbow: el, wrist: 0, singular: true });
        } else {
          for (var wf = 0; wf < 2; wf++) {
            var sg = wf === 0 ? 1 : -1;
            var t5b = Math.atan2(sg * s5abs, R[8]);
            var t4b = Math.atan2(-sg * R[5], -sg * R[2]);
            var t6b = Math.atan2(-sg * R[7], sg * R[6]);
            sols.push({ q: [q1, q2, q3, t4b - J[3].offset, t5b - J[4].offset, t6b - J[5].offset], shoulder: sh, elbow: el, wrist: wf, singular: s5abs < 1e-3 });
          }
        }
      }
    }
    return { solutions: sols, singular: anySing };
  }

  /**
   * ikAnalytic(targetPose, qSeed, chain) -> {q, solutions, singular} | null.
   * Filters by joint limits (picking the 2k*pi branch nearest the seed), chooses min weighted
   * joint distance from qSeed. solutions = all limit-valid ones, sorted best first.
   */
  function ikAnalytic(T, qSeed, chain) {
    chain = C(chain);
    var seed = qSeed || [0,0,0,0,0,0];
    var raw = ikAnalyticAll(T, seed, chain), valid = [];
    for (var s = 0; s < raw.solutions.length; s++) {
      var q = raw.solutions[s].q.slice(), ok = true;
      for (var i = 0; i < 6 && ok; i++) {
        var j = chain.joints[i];
        q[i] = fitAngle(q[i], seed[i], j.min, j.max);
        if (q[i] !== q[i]) ok = false;
      }
      if (ok) valid.push({ q: q, cost: weightedDist(q, seed, chain), singular: raw.solutions[s].singular });
    }
    if (!valid.length) return null;
    valid.sort(function (a, b) { return a.cost - b.cost; });
    return { q: valid[0].q, singular: valid[0].singular, solutions: valid.map(function (v) { return v.q; }) };
  }

  // ---------- Jacobian / manipulability ----------
  function jacobian(q, chain) {
    var all = fkAll(q, chain), Te = all[7];
    var pe = [Te[3], Te[7], Te[11]], Jm = [];
    for (var i = 0; i < 6; i++) {
      var Ti = all[i], z = [Ti[2], Ti[6], Ti[10]], p = [pe[0]-Ti[3], pe[1]-Ti[7], pe[2]-Ti[11]];
      Jm.push([z[1]*p[2]-z[2]*p[1], z[2]*p[0]-z[0]*p[2], z[0]*p[1]-z[1]*p[0], z[0], z[1], z[2]]);
    }
    // Jm[i] is column i; return as rows 6x6
    var rows = [];
    for (var r = 0; r < 6; r++) { rows.push([Jm[0][r], Jm[1][r], Jm[2][r], Jm[3][r], Jm[4][r], Jm[5][r]]); }
    return rows;
  }
  function det6(M) {
    var A = M.map(function (r) { return r.slice(); }), det = 1;
    for (var c = 0; c < 6; c++) {
      var p = c;
      for (var r = c+1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-300) return 0;
      if (p !== c) { var t = A[p]; A[p] = A[c]; A[c] = t; det = -det; }
      det *= A[c][c];
      for (var r2 = c+1; r2 < 6; r2++) {
        var f = A[r2][c] / A[c][c];
        for (var k = c; k < 6; k++) A[r2][k] -= f * A[c][k];
      }
    }
    return det;
  }
  /** Yoshikawa manipulability sqrt(det(J J^T)) = |det J| for a square Jacobian. 0 at singularities. */
  function manipulability(q, chain) { return Math.abs(det6(jacobian(q, chain))); }

  function solve6(A, b) {
    var M = A.map(function (r, i) { return r.concat([b[i]]); }), n = 6;
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c+1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[p]; M[p] = M[c]; M[c] = t;
      var piv = M[c][c] || 1e-300;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c] / piv;
        if (f !== 0) for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    var x = new Array(n);
    for (var i = 0; i < n; i++) x[i] = M[i][n] / (M[i][i] || 1e-300);
    return x;
  }

  // ---------- DLS fallback ----------
  /**
   * ikDLS(targetPose, qSeed, {iters:60, lambda:0.05, posTol:1e-5, rotTol:1e-5}, chain)
   * -> {q, converged, posErr, rotErr, iters}. Damping is adaptive: full lambda only as
   * manipulability drops, near-zero otherwise so it converges to sub-micron precision.
   * Joints are clamped to limits every step; never returns NaN (falls back to the seed).
   */
  function ikDLS(T, qSeed, opts, chain) {
    chain = C(chain); opts = opts || {};
    var iters = opts.iters || 60, lam0 = opts.lambda != null ? opts.lambda : 0.05;
    var posTol = opts.posTol || 1e-5, rotTol = opts.rotTol || 1e-5, w0 = opts.wThreshold || 0.02;
    var q = (qSeed || [0,0,0,0,0,0]).slice(), it = 0, err = null;
    for (var i = 0; i < 6; i++) { var j = chain.joints[i]; q[i] = Math.max(j.min, Math.min(j.max, q[i])); }
    for (it = 0; it < iters; it++) {
      var Tc = fk(q, chain);
      var e = rotErrVec(T, Tc);
      var ev = [T[3]-Tc[3], T[7]-Tc[7], T[11]-Tc[11], e[0], e[1], e[2]];
      var pe = Math.sqrt(ev[0]*ev[0]+ev[1]*ev[1]+ev[2]*ev[2]), re = Math.sqrt(e[0]*e[0]+e[1]*e[1]+e[2]*e[2]);
      err = { pos: pe, rot: re };
      if (pe < posTol && re < rotTol) break;
      // limit step size so big errors don't overshoot
      var sc = Math.min(1, 0.3 / Math.max(pe, 1e-12), 0.5 / Math.max(re, 1e-12));
      for (var k = 0; k < 6; k++) ev[k] *= sc;
      var Jr = jacobian(q, chain), w = Math.abs(det6(Jr));
      var lam2 = w < w0 ? lam0*lam0 * (1 - (w/w0)*(w/w0)) : 1e-10;
      // dq = J^T (J J^T + lam^2 I)^-1 e
      var A = [];
      for (var r = 0; r < 6; r++) {
        A.push([]);
        for (var c = 0; c < 6; c++) {
          var s = 0; for (var m = 0; m < 6; m++) s += Jr[r][m] * Jr[c][m];
          A[r].push(s + (r === c ? lam2 : 0));
        }
      }
      var y = solve6(A, ev);
      for (var n = 0; n < 6; n++) {
        var dq = 0; for (var r3 = 0; r3 < 6; r3++) dq += Jr[r3][n] * y[r3];
        var jn = chain.joints[n], nv = q[n] + dq;
        if (nv !== nv) { nv = q[n]; }
        q[n] = Math.max(jn.min, Math.min(jn.max, nv));
      }
    }
    if (!err || it === iters) err = poseError(T, fk(q, chain));
    return { q: q, converged: err.pos < posTol*10 && err.rot < rotTol*10, posErr: err.pos, rotErr: err.rot, iters: it };
  }

  // ---------- top-level IK ----------
  /**
   * ik(targetPose, qSeed, opts, chain) -> {q, method:'analytic'|'dls', posErr, rotErr, singular} | null
   * 1. reachable() O(1) rejects impossible poses -> null.
   * 2. analytic (limit-filtered, nearest to seed).
   * 3. near a singularity, or no analytic solution inside limits, DLS refines from the best
   *    available guess. Returns null if DLS can't reach opts.acceptPos/acceptRot (1 mm / 0.5 deg).
   */
  function ik(T, qSeed, opts, chain) {
    chain = C(chain); opts = opts || {};
    var seed = qSeed || [0,0,0,0,0,0];
    if (!reachable(T, chain)) return null;
    var a = chain.analytic ? ikAnalytic(T, seed, chain) : null;
    if (a && !a.singular) {
      var e = poseError(T, fk(a.q, chain));
      return { q: a.q, method: 'analytic', posErr: e.pos, rotErr: e.rot, singular: false, solutions: a.solutions };
    }
    var d = ikDLS(T, a ? a.q : seed, opts, chain);
    var accPos = opts.acceptPos || 1e-3, accRot = opts.acceptRot || 0.5 * D2R;
    if (d.posErr > accPos || d.rotErr > accRot) return null;
    return { q: d.q, method: 'dls', posErr: d.posErr, rotErr: d.rotErr, singular: !!(a && a.singular), iters: d.iters };
  }

  // ---------- motion limiting ----------
  /**
   * Velocity/acceleration-limited step from qCur toward qTarget over dt seconds.
   * state: optional {v:[6]} carried between calls (joint velocities). Returns {q, v, done}.
   * Time-scales all joints together so the arm moves in a coordinated straight line in joint space.
   */
  function stepToward(qCur, qTarget, dt, state, chain) {
    chain = C(chain); state = state || {};
    var v = state.v || [0,0,0,0,0,0], q = qCur.slice(), done = true;
    // coordinated: find slowest joint's required time
    var tNeed = 0;
    for (var i = 0; i < 6; i++) {
      var j = chain.joints[i], dist = Math.abs(qTarget[i] - qCur[i]);
      tNeed = Math.max(tNeed, dist / j.vmax);
    }
    var nv = new Array(6);
    for (var k = 0; k < 6; k++) {
      var jk = chain.joints[k], delta = qTarget[k] - qCur[k];
      var vDes = tNeed > 1e-9 ? delta / Math.max(tNeed, dt) : 0;
      // braking distance limit: v^2 <= 2 a |delta|
      var vBrake = Math.sqrt(2 * jk.amax * Math.abs(delta));
      if (Math.abs(vDes) > vBrake) vDes = Math.sign(vDes) * vBrake;
      var dv = Math.max(-jk.amax*dt, Math.min(jk.amax*dt, vDes - v[k]));
      var vk = v[k] + dv;
      vk = Math.max(-jk.vmax, Math.min(jk.vmax, vk));
      var step = vk * dt;
      if (Math.abs(step) >= Math.abs(delta)) { step = delta; vk = 0; }
      q[k] = Math.max(jk.min, Math.min(jk.max, qCur[k] + step));
      nv[k] = vk;
      if (Math.abs(qTarget[k] - q[k]) > 1e-6) done = false;
    }
    state.v = nv;
    return { q: q, v: nv, done: done };
  }

  function homePose(chain) { return [0, 0, 0, 0, 0, 0]; }
  function randomQ(rng, chain) {
    chain = C(chain); rng = rng || Math.random;
    return chain.joints.map(function (j) { return j.min + (j.max - j.min) * rng(); });
  }

  return {
    DEFAULT_JOINT_TABLE: DEFAULT_JOINT_TABLE,
    DEFAULT_CHAIN: DEFAULT_CHAIN,
    dhFromManifest: dhFromManifest,
    fk: fk, fkAll: fkAll,
    ikAnalytic: ikAnalytic, ikAnalyticAll: ikAnalyticAll, ikDLS: ikDLS, ik: ik,
    reachable: reachable, manipulability: manipulability, jacobian: jacobian,
    withinLimits: withinLimits, stepToward: stepToward,
    poseError: poseError, poseFromXYZRPY: poseFromXYZRPY, xyzRPYFromPose: xyzRPYFromPose,
    mul: mul, invRigid: invRigid, dhMat: dhMat, identity: ident, wrapPi: wrapPi,
    homePose: homePose, randomQ: randomQ,
    DEG: D2R
  };
});
