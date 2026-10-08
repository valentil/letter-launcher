/**
 * src/robot/rig.js — LLF-75 [Robot-2]
 * Binds a THREE.Group arm (AssetLib GLB or the DH proxy below) to RobotKin joint angles.
 * Browser: window.RobotRig (needs window.THREE r128 and window.RobotKin).
 * Node: module.exports (pass THREE explicitly).
 *
 *   const rig = RobotRig.bind(armGroup);            // finds J1..J6 (or J1_xxx / J0_base..J6_flange)
 *   rig.setJoints([q1..q6]);                         // radians, rotates each J node about its axis
 *   const f = RobotRig.createFollower(rig);          // velocity-limited IK follower
 *   f.setTarget({x:1.0, y:0.2, z:0.8, roll:180, pitch:0, yaw:0});  // metres + degrees, robot base frame (Z up)
 *   // in the animate loop (already try/catch-wrapped there): f.update(dt)
 *   RobotRig.installConsole(f);                      // window.robotGoTo(x,y,z,roll,pitch,yaw) / robotJoints(...deg)
 *
 * Joint axis per node, first match wins: opts.axes[i] -> node.userData.axis (GLB extras / manifest)
 * -> chain joint .axis -> DEFAULT_AXES[i] (Y-up GLB, arm facing +X). Sign: opts.signs[i] or
 * node.userData.sign or +1. The node's pose at bind time is treated as q = 0 (opts.zero overrides).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RobotRig = api;
})(this, function (root) {
  'use strict';
  var DEG = Math.PI / 180;
  // Typical Y-up GLB export of a floor-mounted arm facing +X:
  // J1 vertical, J2/J3/J5 horizontal (pitch), J4/J6 along the forearm/flange.
  var DEFAULT_AXES = [[0, 1, 0], [0, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 1], [1, 0, 0]];
  var NAME_RE = /^J([1-6])(?:$|[_\-\s.])/i;

  function getTHREE(T) {
    var t = T || (typeof window !== 'undefined' && window.THREE) || (root && root.THREE);
    if (!t) throw new Error('RobotRig: THREE not available');
    return t;
  }
  function getKin(K) {
    var k = K || (typeof window !== 'undefined' && window.RobotKin);
    if (!k && typeof require === 'function') { try { k = require('./kinematics.js'); } catch (e) { /* browser */ } }
    if (!k) throw new Error('RobotRig: RobotKin not available');
    return k;
  }

  /** Find joint nodes J1..J6 under group. Returns array of 6 (throws if any missing). */
  function findJoints(group) {
    var found = [null, null, null, null, null, null];
    group.traverse(function (o) {
      var m = NAME_RE.exec(o.name || '');
      if (m) { var i = +m[1] - 1; if (!found[i]) found[i] = o; }
    });
    var missing = [];
    found.forEach(function (n, i) { if (!n) missing.push('J' + (i + 1)); });
    if (missing.length) throw new Error('RobotRig.bind: missing joint nodes ' + missing.join(','));
    return found;
  }

  /**
   * bind(group, {THREE, kin, chain, axes, signs, zero}) -> rig
   * rig: {nodes, chain, q, setJoints(q), getJoints(), flangeWorld(target?)}
   */
  function bind(group, opts) {
    opts = opts || {};
    var THREE = getTHREE(opts.THREE), K = getKin(opts.kin);
    var chain = opts.chain || K.DEFAULT_CHAIN;
    var nodes = findJoints(group);
    var tmpQ = new THREE.Quaternion();
    var joints = nodes.map(function (node, i) {
      var ud = node.userData || {};
      var ax = (opts.axes && opts.axes[i]) || ud.axis || (chain.joints[i] && chain.joints[i].axis) || DEFAULT_AXES[i];
      var axis = new THREE.Vector3(ax[0], ax[1], ax[2]).normalize();
      var sign = (opts.signs && opts.signs[i]) || ud.sign || 1;
      return { node: node, axis: axis, sign: sign, rest: node.quaternion.clone(), zero: (opts.zero && opts.zero[i]) || 0 };
    });
    var q = [0, 0, 0, 0, 0, 0];
    var rig = {
      group: group, nodes: nodes, chain: chain, joints: joints, q: q,
      setJoints: function (qn) {
        for (var i = 0; i < 6; i++) {
          var v = +qn[i];
          if (v !== v) continue; // never write NaN into the scene graph
          var jl = chain.joints[i];
          if (jl) v = Math.max(jl.min, Math.min(jl.max, v));
          q[i] = v;
          var j = joints[i];
          tmpQ.setFromAxisAngle(j.axis, j.sign * (v - j.zero));
          j.node.quaternion.copy(j.rest).multiply(tmpQ);
        }
        return rig;
      },
      getJoints: function () { return q.slice(); },
      /** World position of the J6 node (or a flange child) — handy for gizmo sync. */
      flangeWorld: function (target) {
        target = target || new THREE.Vector3();
        var flange = group.getObjectByName('J6_flange') || group.getObjectByName('flange') || nodes[5];
        group.updateMatrixWorld(true);
        return flange.getWorldPosition(target);
      }
    };
    return rig;
  }

  /**
   * buildProxyArm(THREE, chain, {color}) -> THREE.Group
   * A placeholder arm generated straight from the DH table, so the factory map can run before the
   * Robot-1 GLB exists. Joint nodes J1..J6 each rotate about local Z (DH frames) with userData.axis
   * = [0,0,1] and rest pose = Rz(offset), so bind() + setJoints(q) matches RobotKin.fk(q) exactly.
   * The root is rotated -90 deg about X so robot Z-up becomes THREE Y-up.
   */
  function buildProxyArm(THREE_, chain, opts) {
    var THREE = getTHREE(THREE_), K = getKin(opts && opts.kin);
    chain = chain || K.DEFAULT_CHAIN; opts = opts || {};
    var mat = new THREE.MeshStandardMaterial({ color: opts.color != null ? opts.color : 0xf2a900, metalness: 0.3, roughness: 0.55 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.4, roughness: 0.6 });
    var root = new THREE.Group(); root.name = 'robot_proxy';
    root.rotation.x = -Math.PI / 2;
    var base = new THREE.Group(); base.name = 'J0_base'; root.add(base);
    var baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.12, 24), dark);
    baseMesh.rotation.x = Math.PI / 2; baseMesh.position.z = 0.06; base.add(baseMesh);
    // segment helper: box from a to b (local coords)
    function link(parent, a, b, r, m) {
      var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return;
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(r, r, len), m || mat);
      mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      var dir = new THREE.Vector3(dx, dy, dz).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      parent.add(mesh);
    }
    var parent = base, sizes = [0.2, 0.16, 0.14, 0.11, 0.09, 0.07];
    for (var i = 0; i < 6; i++) {
      var j = chain.joints[i];
      var jn = new THREE.Group(); jn.name = 'J' + (i + 1);
      jn.userData.axis = [0, 0, 1];
      jn.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), j.offset);
      parent.add(jn);
      // joint housing on the axis
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(sizes[i] * 0.6, sizes[i] * 0.6, sizes[i] * 1.1, 20), dark);
      hub.rotation.x = Math.PI / 2; jn.add(hub);
      // fixed DH part: Tz(d) Tx(a) Rx(alpha)
      link(jn, [0, 0, 0], [0, 0, j.d], sizes[i]);
      link(jn, [0, 0, j.d], [j.a, 0, j.d], sizes[i]);
      var fixed = new THREE.Group(); fixed.name = 'J' + (i + 1) + '_frame';
      fixed.position.set(j.a, 0, j.d);
      fixed.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), j.alpha);
      jn.add(fixed);
      parent = fixed;
    }
    var flange = new THREE.Group(); flange.name = 'J6_flange'; parent.add(flange);
    var fl = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 20), dark);
    fl.rotation.x = Math.PI / 2; flange.add(fl);
    return root;
  }

  /**
   * createFollower(rig, {kin}) -> {setTarget(pose), setJointsTarget(qDeg|qRad), update(dt), target, lastIk}
   * pose: 16-array (row-major, robot base frame) or {x,y,z (m), roll,pitch,yaw (deg)}.
   * Unreachable targets are ignored (arm holds its last good goal) and reported via lastIk = null.
   */
  function createFollower(rig, opts) {
    opts = opts || {};
    var K = getKin(opts.kin), chain = rig.chain, motion = {};
    var goal = rig.getJoints();
    var f = {
      target: null, lastIk: null, goal: goal,
      setTarget: function (pose) {
        var T = Array.isArray(pose) ? pose :
          K.poseFromXYZRPY(+pose.x || 0, +pose.y || 0, +pose.z || 0, (+pose.roll || 0) * DEG, (+pose.pitch || 0) * DEG, (+pose.yaw || 0) * DEG);
        f.target = T;
        var res = K.ik(T, goal, {}, chain);
        f.lastIk = res;
        if (res) goal = f.goal = res.q;
        return res;
      },
      setJointsTarget: function (qn, degrees) {
        goal = f.goal = qn.map(function (v) { return degrees ? v * DEG : v; });
      },
      update: function (dt) {
        dt = Math.min(Math.max(+dt || 0, 0), 0.1);
        if (!dt) return true;
        var s = K.stepToward(rig.getJoints(), goal, dt, motion, chain);
        rig.setJoints(s.q);
        return s.done;
      }
    };
    return f;
  }

  /** Console helpers for debug mode: robotGoTo(x,y,z,roll,pitch,yaw) in m/deg, robotJoints(...deg). */
  function installConsole(follower) {
    if (typeof window === 'undefined') return;
    window.robotGoTo = function (x, y, z, roll, pitch, yaw) {
      var r = follower.setTarget({ x: x, y: y, z: z, roll: roll == null ? 180 : roll, pitch: pitch || 0, yaw: yaw || 0 });
      if (!r) console.warn('robotGoTo: unreachable', x, y, z);
      return r ? r.q.map(function (v) { return +(v / DEG).toFixed(2); }) : null;
    };
    window.robotJoints = function () { follower.setJointsTarget([].slice.call(arguments), true); };
  }

  return { bind: bind, findJoints: findJoints, buildProxyArm: buildProxyArm, createFollower: createFollower, installConsole: installConsole, DEFAULT_AXES: DEFAULT_AXES };
});
