/**
 * src/scenes/robot_factory/layout.js — LLF-78 [Robot-5] ROBOT FACTORY scene layout table.
 * Browser: window.RFLayout.  Node: require('./src/scenes/robot_factory/layout.js').
 *
 * ROBOT WORLD frame (same as RobotKin / RobotMotion): metres, Z up, +X to the right as seen from the
 * camera, +Y away from the camera (toward the back wall). THREE (Y up): (x, y, z)robot -> (x, z, -y).
 * The cannon cell world uses the same Y-up mapping (RobotMotion.Z_UP_TO_Y_UP).
 *
 * Every floor-standing prop is one row: {id, asset, x, y, yaw (rad, about Z), hx, hy (plan half extents
 * AFTER yaw, m), h (height, m)}. Every prop stands on the floor (z = 0) or on the prop named in `on`.
 * overlaps() is the no-collision check the tests run: no two footprints of things standing on the same
 * surface may intersect. Hanging things (hopper, lamps, order board) carry `hangFrom` and their hanger
 * length so nothing floats.
 *
 * Numbers come from the robot asset manifests (assets/cad/manifest.d/*.json bboxM):
 *   pedestal 0.8 x 0.8 x 0.555 (robot mounting face at 555 mm), letter_bin 1.22 x 0.82 x 1.098 (tote floor
 *   at 603 mm), type_tray 3.44 x 0.25 x 0.79 (slot groove floor at 720 mm, 12 slots at 280 mm pitch),
 *   conveyor 3.016 x 0.849 x 0.9 (belt top 900 mm; glTF z -0.559..0.29), tool_rack 0.6 x 0.3 x 0.927,
 *   fence panel 4.15 x 0.15 x 2.0 (posts at local x = 0 and 4.0).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RFLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PI = Math.PI;

  var PEDESTAL_H = 0.555;
  var ARM_BASES = [
    { id: 'A1', x: -1.05, y: -0.12, yaw: 0, color: 0xf2a900 },
    { id: 'A2', x: 1.05, y: -0.12, yaw: PI, color: 0xf2a900 }
  ];
  var BIN = { x: 0, y: -0.62 };          // letter_bin centre (tote origin on the floor)
  var TRAY = { x: 0, y: 0.50 };          // type_tray centre
  var CONVEYOR = { x: 0, y: 1.0 };
  var CRATE = { x: 1.8, y: 1.1, hx: 0.2, hy: 0.25, h: 0.6 };
  var FENCE_Y = 1.85, FENCE_X = 2.2, CURTAIN_Y = -2.15;
  var CAMERA = { pos: [0, -4.9, 3.05], look: [0, -0.05, 0.78] };   // robot frame

  // ------------------------------------------------------------------ the table
  var PROPS = [
    { id: 'bin', asset: 'letter_bin', x: BIN.x, y: BIN.y, yaw: 0, hx: 0.61, hy: 0.41, h: 1.098 },
    { id: 'pedestal_A1', asset: 'pedestal', x: ARM_BASES[0].x, y: ARM_BASES[0].y, yaw: 0, hx: 0.4, hy: 0.4, h: PEDESTAL_H },
    { id: 'pedestal_A2', asset: 'pedestal', x: ARM_BASES[1].x, y: ARM_BASES[1].y, yaw: 0, hx: 0.4, hy: 0.4, h: PEDESTAL_H },
    { id: 'arm_A1', asset: 'robot_arm', x: ARM_BASES[0].x, y: ARM_BASES[0].y, yaw: ARM_BASES[0].yaw, hx: 0.21, hy: 0.21, h: 1.25, on: 'pedestal_A1', z: PEDESTAL_H },
    { id: 'arm_A2', asset: 'robot_arm', x: ARM_BASES[1].x, y: ARM_BASES[1].y, yaw: ARM_BASES[1].yaw, hx: 0.21, hy: 0.21, h: 1.25, on: 'pedestal_A2', z: PEDESTAL_H },
    { id: 'tray', asset: 'type_tray', x: TRAY.x, y: TRAY.y, yaw: 0, hx: 1.72, hy: 0.125, h: 0.79 },
    // conveyor glTF z spans -0.559..0.29 -> robot y offsets +0.559..-0.29 about its origin
    { id: 'conveyor', asset: 'conveyor', x: CONVEYOR.x, y: CONVEYOR.y, yaw: 0, hx: 1.51, hy: 0.425, cy: 0.1345, h: 0.9 },
    { id: 'crate', asset: null, x: CRATE.x, y: CRATE.y, yaw: 0, hx: CRATE.hx, hy: CRATE.hy, h: CRATE.h },
    { id: 'rack_A1', asset: 'tool_rack', x: -1.75, y: -0.95, yaw: 0, hx: 0.3, hy: 0.15, h: 0.927 },
    { id: 'rack_A2', asset: 'tool_rack', x: 1.75, y: -0.95, yaw: 0, hx: 0.3, hy: 0.15, h: 0.927 },
    { id: 'andon_A1', asset: null, x: -1.75, y: -0.35, yaw: 0, hx: 0.1, hy: 0.1, h: 1.75 },
    { id: 'andon_A2', asset: null, x: 1.75, y: -0.35, yaw: 0, hx: 0.1, hy: 0.1, h: 1.75 },
    // fence panels: posts at local x 0 and 4.0 (bbox -0.075..4.075 x +-0.075)
    { id: 'fence_back', asset: 'fence', x: -2.0, y: FENCE_Y, yaw: 0, hx: 2.075, hy: 0.075, cx: 2.0, h: 2.0 },
    { id: 'fence_left', asset: 'fence', x: -FENCE_X, y: FENCE_Y, yaw: -PI / 2, hx: 0.075, hy: 2.075, cy: -2.0, h: 2.0 },
    { id: 'fence_right', asset: 'fence', x: FENCE_X, y: FENCE_Y, yaw: -PI / 2, hx: 0.075, hy: 2.075, cy: -2.0, h: 2.0 },
    { id: 'curtain_L', asset: null, x: -2.0, y: CURTAIN_Y, yaw: 0, hx: 0.06, hy: 0.06, h: 1.8 },
    { id: 'curtain_R', asset: null, x: 2.0, y: CURTAIN_Y, yaw: 0, hx: 0.06, hy: 0.06, h: 1.8 },
    // outside the cell
    { id: 'weld_booth', asset: null, x: -4.3, y: 1.2, yaw: 0, hx: 0.9, hy: 0.9, h: 2.2 },
    { id: 'vending', asset: null, x: 3.6, y: 3.0, yaw: 0, hx: 0.45, hy: 0.4, h: 1.9 },
    { id: 'bench', asset: null, x: 4.1, y: -0.6, yaw: 0, hx: 0.7, hy: 0.35, h: 0.9 },
    { id: 'radio', asset: null, x: 4.35, y: -0.6, yaw: 0, hx: 0.16, hy: 0.08, h: 0.18, on: 'bench', z: 0.9 },
    { id: 'board_posts', asset: null, x: 0, y: 3.4, yaw: 0, hx: 1.9, hy: 0.1, h: 4.4 }
  ];
  // Hanging things: hung from the roof truss at z = ROOF by rods (no floaters).
  var ROOF = 6.0;
  var HANGING = [
    { id: 'hopper', x: BIN.x, y: BIN.y, zBottom: 2.15, zTop: 2.85, hangFrom: 'truss', rods: 4 },
    { id: 'lamp_1', x: -1.4, y: 0.2, zBottom: 4.6, zTop: 4.9, hangFrom: 'truss', rods: 1 },
    { id: 'lamp_2', x: 1.4, y: 0.2, zBottom: 4.6, zTop: 4.9, hangFrom: 'truss', rods: 1 },
    { id: 'lamp_3', x: -4.3, y: 1.2, zBottom: 4.6, zTop: 4.9, hangFrom: 'truss', rods: 1 },
    { id: 'lamp_4', x: 3.8, y: 2.0, zBottom: 4.6, zTop: 4.9, hangFrom: 'truss', rods: 1 }
  ];
  // Board: big order board on two floor posts behind the back fence (board face 1.9 m .. 4.3 m)
  var BOARD = { x: 0, y: 3.4, w: 3.6, h: 2.1, zMid: 3.25 };

  // Forklift route (robot frame, metres): aisle -> through the light curtain -> back out.
  var FORKLIFT_PATH = [[-9, -3.4], [-1.2, -3.4], [-0.3, -2.9], [-0.3, -1.7], [-0.3, -2.9], [-1.2, -3.4], [-9, -3.4]];
  var WORKER_PATH = [[-4.3, 2.4], [-2.6, 2.6], [0, 2.6], [2.8, 2.6], [3.6, 2.5]];

  // ------------------------------------------------------------------ helpers
  function footprint(p) {
    var cx = p.x + (p.cx || 0), cy = p.y + (p.cy || 0);
    return { minX: cx - p.hx, maxX: cx + p.hx, minY: cy - p.hy, maxY: cy + p.hy };
  }
  /** Pairs of props standing on the same surface whose plan footprints intersect (tolerance m). */
  function overlaps(props, tol) {
    props = props || PROPS; tol = tol == null ? 0.005 : tol;
    var out = [];
    for (var i = 0; i < props.length; i++) for (var j = i + 1; j < props.length; j++) {
      var a = props[i], b = props[j];
      if ((a.on || 'floor') !== (b.on || 'floor')) continue;
      var A = footprint(a), B = footprint(b);
      if (A.minX < B.maxX - tol && B.minX < A.maxX - tol && A.minY < B.maxY - tol && B.minY < A.maxY - tol) out.push(a.id + ' x ' + b.id);
    }
    return out;
  }
  /** Props with `on` must sit inside their support footprint at its height. */
  function unsupported(props) {
    props = props || PROPS;
    var byId = {}; props.forEach(function (p) { byId[p.id] = p; });
    return props.filter(function (p) {
      if (!p.on) return false;
      var s = byId[p.on]; if (!s) return true;
      var A = footprint(p), S = footprint(s);
      return Math.abs((p.z || 0) - s.h) > 0.01 || A.minX < S.minX - 0.01 || A.maxX > S.maxX + 0.01 || A.minY < S.minY - 0.01 || A.maxY > S.maxY + 0.01;
    }).map(function (p) { return p.id; });
  }
  function byId(id) { for (var i = 0; i < PROPS.length; i++) if (PROPS[i].id === id) return PROPS[i]; return null; }
  /** robot (x, y, z) -> THREE (x, z, -y) as an array */
  function toThree(x, y, z) { return [x, z, -y]; }
  /** Row-major 4x4 base pose of arm i on its pedestal (robot world). */
  function armBasePose(i) {
    var a = ARM_BASES[i], c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    return [c, -s, 0, a.x, s, c, 0, a.y, 0, 0, 1, PEDESTAL_H, 0, 0, 0, 1];
  }
  function trayPose() { return [1, 0, 0, TRAY.x, 0, 1, 0, TRAY.y, 0, 0, 1, 0, 0, 0, 0, 1]; }

  return {
    PROPS: PROPS, HANGING: HANGING, ROOF: ROOF, BOARD: BOARD, ARM_BASES: ARM_BASES, BIN: BIN, TRAY: TRAY,
    CONVEYOR: CONVEYOR, CRATE: CRATE, CAMERA: CAMERA, PEDESTAL_H: PEDESTAL_H, FENCE_Y: FENCE_Y, FENCE_X: FENCE_X,
    CURTAIN_Y: CURTAIN_Y, FORKLIFT_PATH: FORKLIFT_PATH, WORKER_PATH: WORKER_PATH,
    footprint: footprint, overlaps: overlaps, unsupported: unsupported, byId: byId, toThree: toThree,
    armBasePose: armBasePose, trayPose: trayPose
  };
});
