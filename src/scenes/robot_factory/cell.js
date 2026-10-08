/**
 * src/scenes/robot_factory/cell.js — LLF-78 [Robot-5] the ROBOT FACTORY work cell, engine-free.
 * Browser: window.RFCell.  Node: require('./src/scenes/robot_factory/cell.js') (inject CANNON + makeGlyph).
 *
 * Owns a private cannon world (Y up, metres — the game world mapping of the robot frame, see
 * RobotMotion.Z_UP_TO_Y_UP) holding the letter tote (RobotBin), the 12 type-tray slot guides, and
 * the glyph bodies; a RobotMotion hub with the two pedestal arms; and the RobotPlanner bridge that
 * turns a typed order ("PIZZA") into pick/place jobs. Nothing here touches THREE except syncing the
 * glyph meshes it was handed, so the whole loop runs headless in node (tests/test_robot5_level.js).
 *
 *   const cell = RFCell.create({CANNON, makeGlyph, glyphEntry, scale, seed, onEvent});
 *   cell.startFill(counts)          pour the starting stock into the tote (incremental, see step())
 *   cell.order('PIZZA', {id})       lay the word into the tray slots and plan it
 *   cell.step(dt)                   advance fill / planning / arms / physics by dt seconds (sub-stepped)
 *   cell.shake(), cell.refill(counts), cell.estop(on), cell.reset(), cell.setSpeed(0.5..1.5),
 *   cell.forceToolSwap(), cell.ship() -> glyph records of the finished word (bodies removed)
 *   cell.stats  {placed, faults, jams, substitutes, crooked, picks, clears, ...}
 *
 * Collision model (perf decision, see LEVELS.md section 6): glyphs lying in the tote collide as their
 * CAD bounding box (one CANNON.Box at the CAD COM offset — 60 jumbled CAD hull sets cost ~20 ms per
 * physics step, boxes cost <1 ms and sleep); the moment a glyph is grasped its shapes are swapped
 * for the real convex hulls from glyph_physics.json, so the pinch check, the slot drop and the
 * settle verdict all run on the true glyph geometry.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RFCell = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function dep(name, file) {
    var v = (typeof window !== 'undefined' && window[name]) || (root && root[name]);
    if (!v && typeof require === 'function') { try { v = require(file); } catch (e) { /* browser */ } }
    if (!v) throw new Error('RFCell: ' + name + ' not available');
    return v;
  }
  var DEG = Math.PI / 180;
  var SUB_DT = 1 / 60;                 // physics + arm sub-step (s)
  var MAX_FRAME = 0.5;                 // longest real frame we catch up on (software GL runs ~0.5 s frames)
  var DROP_Y = 1.32;                   // fill drop height (physics y) — above the rim, below the hopper chute
  var CHUTE_Y = 2.12;                  // hopper chute mouth (physics y)

  /** Scrabble-frequency stock of n glyphs (largest-remainder rounding, every letter with >=1 tile kept >= 1). */
  function scrabbleStock(n, base) {
    base = base || { A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1 };
    var keys = Object.keys(base), tot = 0, out = {}, rem = [];
    keys.forEach(function (k) { tot += base[k]; });
    var used = 0;
    keys.forEach(function (k) {
      var exact = base[k] * n / tot, f = Math.max(1, Math.floor(exact));
      out[k] = f; used += f; rem.push({ k: k, r: exact - Math.floor(exact) });
    });
    rem.sort(function (a, b) { return b.r - a.r || (a.k < b.k ? -1 : 1); });
    for (var i = 0; used < n && i < rem.length * 4; i++) { out[rem[i % rem.length].k]++; used++; }
    return out;
  }
  function mergeCounts(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = (o[k] || 0) + b[k]; return o; }
  function expand(counts) {
    var out = [];
    Object.keys(counts).sort().forEach(function (ch) { for (var i = 0; i < counts[ch]; i++) out.push(ch); });
    return out;
  }

  function create(o) {
    o = o || {};
    var K = dep('RobotKin', '../../robot/kinematics.js');
    var M = dep('RobotMotion', '../../robot/motion.js');
    var P = dep('RobotPlanner', '../../robot/planner.js');
    var RB = dep('RobotBin', '../../robot/bin.js');
    var L = o.layout || dep('RFLayout', './layout.js');
    var C = o.CANNON || (typeof CANNON !== 'undefined' ? CANNON : null) || dep('CANNON', 'cannon');
    var scale = o.scale || 0.18;
    var seed = o.seed == null ? 1 : o.seed;
    var rngState = (seed >>> 0) || 1;
    function rng() {
      rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
      var t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var FRAME = M.Z_UP_TO_Y_UP, FRAME_INV = K.invRigid(FRAME);
    var emit = function (type, info) { if (o.onEvent) { try { o.onEvent(type, info || {}); } catch (e) { /* game code must not stop the cell */ } } };

    // ---------------------------------------------------------------- physics world
    var world = new C.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new C.SAPBroadphase(world);
    world.solver.iterations = 8;
    world.allowSleep = true;
    world.defaultContactMaterial.friction = 0.45;
    world.defaultContactMaterial.restitution = 0.05;
    var floor = new C.Body({ mass: 0 });
    floor.addShape(new C.Plane());
    floor.quaternion.setFromAxisAngle(new C.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(floor);

    var glyphEntry = o.glyphEntry || function () { return null; };
    // Box proxy for a glyph lying in the tote (CAD bbox at the COM offset).
    function boxShapeFor(ch) {
      var e = glyphEntry(ch);
      var mn = e && e.bbox ? e.bbox.min : [0, 0, -0.2], mx = e && e.bbox ? e.bbox.max : [0.8, 1, 0.2], c = e && e.com ? e.com : [0.4, 0.45, 0];
      return {
        // the box's ConvexPolyhedron form: same contact cost as a Box, but it has .vertices for RobotMotion.graspPose
        shape: new C.Box(new C.Vec3((mx[0] - mn[0]) / 2 * scale, (mx[1] - mn[1]) / 2 * scale, (mx[2] - mn[2]) / 2 * scale)).convexPolyhedronRepresentation,
        offset: new C.Vec3(((mx[0] + mn[0]) / 2 - c[0]) * scale, ((mx[1] + mn[1]) / 2 - c[1]) * scale, ((mx[2] + mn[2]) / 2 - c[2]) * scale)
      };
    }
    function setShapes(body, list) {
      body.shapes.length = 0; body.shapeOffsets.length = 0; body.shapeOrientations.length = 0;
      list.forEach(function (s) { body.addShape(s.shape, s.offset); });
      body.updateBoundingRadius(); body.aabbNeedsUpdate = true;
    }
    function toHulls(rec) {
      if (rec.hulls || !o.hullShapes) return;
      var hs = o.hullShapes(rec.ch, scale);
      if (hs && hs.length) { setShapes(rec.body, hs); rec.hulls = true; if (rec.body.updateSolveMassProperties) rec.body.updateSolveMassProperties(); }
    }
    function makeGlyph(ch) {
      var g = o.makeGlyph ? o.makeGlyph(ch, scale) : null;
      if (!g || !g.body) {
        var b = new C.Body({ mass: 0.4 });
        g = { body: b, mesh: g && g.mesh || null };
      }
      setShapes(g.body, [boxShapeFor(ch)]);
      g.body.__glyph = true; g.body.__glyphChar = ch;
      return g;
    }

    var bin = RB.create({
      CANNON: C, world: world, makeGlyph: makeGlyph, seed: seed, scale: scale,
      origin: { x: L.BIN.x, y: 0, z: -L.BIN.y }, shakeAmp: o.shakeAmp || 0.012
    });
    var BINF = bin.BIN;
    var glyphs = {};     // id -> rec {id, ch, body, mesh, state:'bin'|'held'|'tray'|'loose'|'gone', slot}
    function track(rec) {
      if (!rec) return null;
      rec.state = 'bin'; glyphs[rec.id] = rec;
      if (rec.mesh && o.parent) o.parent.add(rec.mesh);
      return rec;
    }

    // ---------------------------------------------------------------- tray slots
    var slots = M.traySlots(L.trayPose());
    // One static compound body per slot (floor, two groove walls, two dividers — RobotMotion.addSlotGuides'
    // dimensions): 12 bodies instead of 60 keeps the broadphase cheap.
    slots.forEach(function (s) {
      var F = K.mul(FRAME, (function () { var c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0); return [c, -n, 0, s.center[0], n, c, 0, s.center[1], 0, 0, 1, s.center[2], 0, 0, 0, 1]; })());
      var b = new C.Body({ mass: 0 }), t = 0.01, wallH = s.wallH || 0.07, divH = s.dividerH || 0.03, Lx = s.halfX + 0.05;
      var R3 = function (x, y, z) { return new C.Vec3(F[0] * x + F[1] * y + F[2] * z, F[4] * x + F[5] * y + F[6] * z, F[8] * x + F[9] * y + F[10] * z); };
      var qF = M.quatFromMat(F), q = new C.Quaternion(qF[0], qF[1], qF[2], qF[3]);
      b.position.set(F[3], F[7], F[11]); b.quaternion.copy(q);
      [[Lx, s.halfY + 2 * t, t, 0, 0, -t], [Lx, t, wallH / 2, 0, s.halfY + t, wallH / 2], [Lx, t, wallH / 2, 0, -s.halfY - t, wallH / 2],
       [0.005, s.halfY, divH / 2, s.halfX + 0.005, 0, divH / 2], [0.005, s.halfY, divH / 2, -s.halfX - 0.005, 0, divH / 2]].forEach(function (d) {
        b.addShape(new C.Box(new C.Vec3(d[0], d[1], d[2])), new C.Vec3(d[3], d[4], d[5]));
      });
      void R3;
      world.addBody(b);
      s.state = 'free'; s.char = null; s.glyph = null;
    });

    // ---------------------------------------------------------------- arms + hub
    var ARM_META = o.armMeta || null;
    var CHAIN = ARM_META && ARM_META.joints ? K.dhFromManifest(ARM_META.joints) : K.DEFAULT_CHAIN;
    var RADII = M.capsuleRadii(ARM_META, o.gripMeta || null);
    var speed = 1, dropChance = 0.02, estopped = false, holdUntil = 0;
    var JAWS = { jawOpen: 0.11, fingerStroke: 0.025 };   // narrow-jaw finger set: 110 open / 60 closed fits the 72 mm-thick 0.18 m glyphs
    var grasp = M.createGrasp({ CANNON: C, frame: FRAME, jawOpen: JAWS.jawOpen, fingerStroke: JAWS.fingerStroke,
      rng: function () { return rng() * (0.02 / dropChance); } });
    var fence = [
      { min: [-L.FENCE_X - 0.1, L.FENCE_Y - 0.1, 0], max: [L.FENCE_X + 0.1, L.FENCE_Y + 0.1, 2.0] },
      { min: [-L.FENCE_X - 0.1, L.CURTAIN_Y, 0], max: [-L.FENCE_X + 0.1, L.FENCE_Y, 2.0] },
      { min: [L.FENCE_X - 0.1, L.CURTAIN_Y, 0], max: [L.FENCE_X + 0.1, L.FENCE_Y, 2.0] }
    ];
    var hub = M.createHub({
      grasp: grasp, fence: fence, autoUpdate: false, maxRetries: 1, linSpeed: 0.5, linAccel: 1.6, approach: 0.12,
      jawOpen: JAWS.jawOpen, fingerStroke: JAWS.fingerStroke,
      resolve: resolve, onEvent: onHubEvent, repick: repick
    });
    var arms = L.ARM_BASES.map(function (a, i) {
      var base = L.armBasePose(i);
      var vch = M.armChain(CHAIN, base, M.DEFAULTS.toolLength.vacuum);
      // home: tool down, 420 mm forward, swung 300 mm toward the tray, 1.3 m up — clear of the other arm's bin corridor
      var homeT = K.mul(base, [1, 0, 0, 0.42, 0, -1, 0, i === 0 ? 0.30 : -0.30, 0, 0, -1, 0.75, 0, 0, 0, 1]);
      var r = K.ik(homeT, [0, 10 * DEG, 10 * DEG, 0, -80 * DEG, 0], {}, vch);
      var arm = hub.addArm({ id: a.id, chain: CHAIN, basePose: base, q: r ? r.q : [0, 0, 0, 0, -90 * DEG, 0], radii: RADII, tool: 'vacuum' });
      arm.home = arm.q.slice(); arm.index = i; arm.faulted = false; arm.parked = [];
      arm.discard = { x: L.BIN.x + (i === 0 ? -0.36 : 0.36), y: L.BIN.y + 0.12, z: BINF.floorY + 0.42 };
      return arm;
    });

    // ---------------------------------------------------------------- stats
    var stats = { placed: 0, faults: 0, jams: 0, substitutes: 0, crooked: 0, picks: 0, clears: 0, misses: 0, giveups: 0, plans: 0, unsat: 0 };

    // ---------------------------------------------------------------- reach (planner) — real IK
    function topDown(x, y, z, yaw) {
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      return [c, s, 0, x, s, -c, 0, y, 0, 0, -1, z, 0, 0, 0, 1];
    }
    function horizontalPlace(x, y, z) { return [-1, 0, 0, x, 0, 0, 1, y, 0, 1, 0, z, 0, 0, 0, 1]; }   // tool z -> +Y (into the slot), x -> -X, y -> +Z
    function canIK(arm, T, tool) { var ch = arm.chains[tool || 'vacuum']; return !!K.ik(T, arm.home, {}, ch); }
    function reachPick(arm) {
      return function (p) {
        var rec = p.gid != null ? glyphs[p.gid] : null;
        if (rec) {   // the real grasp poses for this glyph (tilt, yaw, face) — the same ones RobotMotion will use
          return (p.grasps || ['vacuum']).some(function (gr) {
            var tool = gr === 'vacuum' ? 'vacuum' : 'pinch';
            var T = M.graspPose(rec.body, gr, hub.opts, FRAME_INV, arm.chains[tool].base);
            return T && canIK(arm, T, tool) && canIK(arm, M.alongZ(T, -hub.opts.approach), tool);
          });
        }
        var x = p.x / 1000, y = p.y / 1000, z = p.z / 1000 + 0.05;
        return canIK(arm, topDown(x, y, z), 'vacuum') && canIK(arm, topDown(x, y, z + 0.15), 'vacuum');
      };
    }
    function reachAny(arm) {
      var pick = reachPick(arm);
      return function (p) {
        if (p.slot != null || p.kind === 'slot') {
          var x = p.x / 1000, y = p.y / 1000, z = p.z / 1000;
          return (canIK(arm, horizontalPlace(x, y - 0.05, z + 0.19), 'vacuum') && canIK(arm, horizontalPlace(x, y - 0.20, z + 0.19), 'vacuum')) ||
                 (canIK(arm, topDown(x, y, z + 0.30), 'pinch') && canIK(arm, topDown(x, y, z + 0.45), 'pinch'));
        }
        return pick(p);
      };
    }

    // ---------------------------------------------------------------- orders
    var order = null;        // {id, word, slots:[{slot, char, state:'open'|'job'|'flight'|'set', sub}], t0, planner, ...}
    var planner = null, planWanted = false, retryAt = Infinity;

    function inTote(rec) {
      var p = rec.body.position, ox = L.BIN.x, oz = -L.BIN.y;
      return Math.abs(p.x - ox) < BINF.halfX + 0.02 && Math.abs(p.z - oz) < BINF.halfZ + 0.02 && p.y > BINF.floorY - 0.05 && p.y < BINF.floorY + BINF.wallH + 0.35;
    }
    function reservedIds() {
      var r = {};
      hub.armList.forEach(function (a) {
        if (a.job) r[a.job.glyphId] = 1;
        a.queue.forEach(function (j) { r[j.glyphId] = 1; });
        a.parked.forEach(function (j) { r[j.glyphId] = 1; });
      });
      return r;
    }
    function binCalm() {
      if (bin.isVibrating() || pending.length || filling) return false;
      return bin.glyphs.every(function (g) {
        var v = g.body.velocity; return g.body.sleepState === C.Body.SLEEPING || v.x * v.x + v.y * v.y + v.z * v.z < 0.0025;
      });
    }

    function order_(word, meta) {
      if (order) return false;
      var w = String(word).toUpperCase().slice(0, 12);
      var start = Math.floor((12 - w.length) / 2);
      lastProgress = simTime;
      order = { id: meta && meta.id != null ? meta.id : word, word: w, t0: hub.time, slots: [], meta: meta || {}, subs: 0, crooked: 0, replans: 0 };
      for (var i = 0; i < w.length; i++) {
        if (w[i] === ' ') continue;
        var s = slots[start + i];
        s.state = 'order'; s.char = w[i]; s.glyph = null;
        order.slots.push({ slot: s, char: w[i], state: 'open', sub: false, fails: 0 });
      }
      planWanted = true;
      emit('order', { order: order });
      return true;
    }

    function plannerInput() {
      var res = reservedIds();
      var occl = bin.occlusionMap();
      var gl = [];
      bin.glyphs.forEach(function (g) {
        var rec = glyphs[g.id];
        if (!rec || rec.state !== 'bin' || res[g.id] || grasp.isAttached(g.body) || !inTote(rec)) return;
        var p = g.body.position;
        var up = g.body.quaternion.vmult(new C.Vec3(0, 0, 1)).y;      // glyph thickness axis, world up component
        // Grasp rules shared with RobotMotion: the vacuum cup only takes a face-UP glyph within 20 deg of flat (a
        // face-down one would be set mirror-reversed), the jaws close across the thickness so top-pinch needs the
        // glyph standing within 30 deg of upright. Clear jobs (lift an occluder off) may vacuum either face.
        var grasps = [];
        var glyphUp = g.body.quaternion.vmult(new C.Vec3(0, 1, 0)).y;  // letter's own "up" (baseline -> cap)
        if (up > 0.9) grasps.push('vacuum');
        if (Math.abs(up) < 0.5 && glyphUp > 0.85) grasps.push('top-pinch');
        var clearGrasps = grasps.slice();
        if (Math.abs(up) > 0.5 && grasps.indexOf('vacuum') < 0) clearGrasps.push('vacuum');
        var om = occl[g.id] || { occludedBy: [], visibleFraction: 1, topClear: true };
        gl.push({ id: g.id, char: g.ch, pose: { x: p.x * 1000, y: -p.z * 1000, z: p.y * 1000, gid: g.id, grasps: clearGrasps }, upright: Math.abs(up) < 0.5, flatUp: up > 0.8,
          grasps: grasps, clearGrasps: clearGrasps,
          halfWidth: 0.25 * scale * 1000, occludedBy: om.occludedBy, visibleFraction: om.visibleFraction, topClear: om.topClear });
      });
      var open = order.slots.filter(function (s) { return s.state === 'open'; });
      var slotIn = open.map(function (s) {
        var c = s.slot.center;
        return { id: String(s.slot.id), char: s.char, pose: { x: c[0] * 1000, y: c[1] * 1000, z: c[2] * 1000, slot: s.slot.id } };
      });
      var live = arms.filter(function (a) { return !a.faulted; });
      return {
        glyphs: gl, slots: slotIn,
        arms: live.map(function (a) {
          return { id: a.id, basePose: { x: a.chain.base[3] * 1000, y: a.chain.base[7] * 1000, z: a.chain.base[11] * 1000 },
            reachable: reachAny(a), toolType: a.tool, tools: ['vacuum', 'pinch'], speed: 700 * speed,
            discardPose: { x: a.discard.x * 1000, y: -(-a.discard.y) * 1000, z: a.discard.z * 1000 } };
        }),
        zones: [
          { id: 'bin-mid', min: { x: (L.BIN.x - 0.22) * 1000, y: (L.BIN.y - 0.5) * 1000, z: 0 }, max: { x: (L.BIN.x + 0.22) * 1000, y: (L.BIN.y + 0.5) * 1000, z: 3000 } },
          { id: 'tray-mid', min: { x: -450, y: (L.TRAY.y - 0.2) * 1000, z: 0 }, max: { x: 450, y: (L.TRAY.y + 0.2) * 1000, z: 3000 } }
        ],
        options: { seed: seed + stats.plans, maxIterations: o.maxIterations || 220, patience: 90, pickTime: 1.0, placeTime: 1.0, toolChangeTime: 1.5,
          zoneApproach: 0.5, armSpeed: 700, substitutePenalty: 8, sliceMs: 6 }
      };
    }

    function startPlan() {
      var input = plannerInput();
      if (!input.arms.length || !input.slots.length) return false;
      // planner wants slot poses for reach: tag them so reachAny uses the place test
      planner = P.createPlanner(input);
      planner.input = input;
      stats.plans++;
      emit('planStart', { input: input });
      return true;
    }

    function applyPlan(res) {
      var input = planner.input;
      planner = null;
      order.lastPlan = res; order.lastInput = input;
      var t0 = hub.time + 0.2;
      var bySlotId = {};
      order.slots.forEach(function (s) { bySlotId[String(s.slot.id)] = s; });
      var jobs = [];
      (res.schedule || []).forEach(function (it) {
        var job = Object.assign({}, it, { tPick: it.tPick + t0, tPlace: it.tPlace + t0, tEnd: it.tEnd + t0, retries: 0 });
        if (it.kind === 'place') {
          var os = bySlotId[String(it.slot)];
          if (!os || os.state !== 'open') return;
          os.state = 'job'; os.sub = !!it.substitute; os.job = job; job.orderSlot = os;
        }
        jobs.push(job);
      });
      hub.load(jobs);
      if (res.status !== 'solved') { stats.unsat++; if (!jobs.length) retryAt = simTime + 6; }
      emit('plan', { result: res, input: input, jobs: jobs, unsat: res.status !== 'solved', reasons: res.reasons || [] });
    }

    // ---------------------------------------------------------------- hub callbacks
    function resolve(job, arm) {
      var rec = glyphs[job.glyphId];
      if (!rec || rec.state !== 'bin') return null;
      var base = arm.chain.base;
      if (job.kind === 'place') {
        var os = job.orderSlot, tool = job.grasp === 'vacuum' ? 'vacuum' : 'pinch';
        // placeTcp is read by RobotMotion right after the grasp, when the real grasp offset exists
        return {
          body: rec.body, grasp: job.grasp, slot: os.slot,
          get placeTcp() { var h = arm.handle; return h && h.body === rec.body ? placeTcpFor(arm, rec, os.slot, tool, h.offset) : null; }
        };
      }
      // clear job: lift the occluder off and drop it on top of the pile at this arm's end of the tote
      var pick = M.graspPose(rec.body, job.grasp, hub.opts, FRAME_INV, base);
      if (!pick) return null;
      var place = pick.slice(); place[3] = arm.discard.x; place[7] = arm.discard.y; place[11] = arm.discard.z + (pick[11] - rec.body.position.y);
      return { body: rec.body, grasp: job.grasp, pickTcp: pick, placeTcp: place, slot: null };
    }
    /**
     * Place TCP for a held glyph: the tool keeps its canonical place attitude (vacuum: horizontal, cup facing +Y into
     * the groove; pinch: straight down) and only rolls about its own axis — the roll is chosen so the letter ends up
     * as upright (and as front-facing) as the grasp allows, then the TCP is positioned so the glyph's COM lands over
     * the slot at drop height (vacuum drops from above the 70 mm groove wall it slid over). Any residual tilt from a
     * slightly tilted pick is what the groove straightens out (or a crooked letter, reported 'mis-set' but kept).
     */
    function placeTcpFor(arm, rec, slot, tool, offset) {
      var e = glyphEntry(rec.ch) || { bbox: { min: [0, 0, 0] }, com: [0, 0.45, 0] };
      var hC = (e.com[1] - e.bbox.min[1]) * scale + (tool === 'vacuum' ? 0.085 : 0.015);
      var c = slot.center, target = [c[0], c[1], c[2] + hC];
      var B = tool === 'vacuum' ? [[1, 0, 0], [0, 0, -1], [0, 1, 0]] : [[1, 0, 0], [0, -1, 0], [0, 0, -1]];   // tool x, y, z axes (world)
      var R0 = [offset[0], offset[1], offset[2], offset[4], offset[5], offset[6], offset[8], offset[9], offset[10]], ot = [offset[3], offset[7], offset[11]];
      var cands = [];
      for (var k = 0; k < 72; k++) {
        var ph = k * 5 * DEG, cs = Math.cos(ph), sn = Math.sin(ph);
        var X = [B[0][0] * cs + B[1][0] * sn, B[0][1] * cs + B[1][1] * sn, B[0][2] * cs + B[1][2] * sn];
        var Y = [-B[0][0] * sn + B[1][0] * cs, -B[0][1] * sn + B[1][1] * cs, -B[0][2] * sn + B[1][2] * cs], Z = B[2];
        function w(v) { return [X[0] * v[0] + Y[0] * v[1] + Z[0] * v[2], X[1] * v[0] + Y[1] * v[1] + Z[1] * v[2], X[2] * v[0] + Y[2] * v[1] + Z[2] * v[2]]; }
        var gUp = w([R0[1], R0[4], R0[7]]), gZ = w([R0[2], R0[5], R0[8]]), off = w(ot);
        var T = [X[0], Y[0], Z[0], target[0] - off[0], X[1], Y[1], Z[1], target[1] - off[1], X[2], Y[2], Z[2], target[2] - off[2], 0, 0, 0, 1];
        cands.push({ T: T, score: gUp[2] - 0.4 * gZ[1] });
      }
      cands.sort(function (a, b) { return b.score - a.score; });
      var ch = arm.chains[tool];
      for (var i = 0; i < cands.length && i < 24; i++) {
        var T2 = cands[i].T;
        if (K.ik(T2, arm.home, {}, ch) && K.ik(M.alongZ(T2, -hub.opts.approach), arm.home, {}, ch)) return T2;
      }
      return cands[0].T;
    }
    function repick(job, why) {
      var os = job.orderSlot;
      if (job.kind === 'place' && os) {
        if (why === 'mis-set') return null;          // handled in onHubEvent (crooked letters stay)
        os.fails++;
        os.state = 'open'; os.job = null;            // let the planner choose again (another glyph / arm)
        planWanted = true;
      }
      return null;
    }
    function settleInside(rec, slot) {
      var st = M.settleState(rec.body, slot, hub.opts, FRAME_INV);
      return st.inside;
    }
    function onHubEvent(type, info) {
      var job = info.job || {}, rec = info.body ? recOf(info.body) : glyphs[job.glyphId];
      var os = job.orderSlot;
      var arm = hub.arms[info.arm];
      if (type === 'grasp' && rec) {
        rec.state = 'held'; stats.picks++;
        toHulls(rec);
        var bi = bin.glyphs.indexOf(rec); if (bi >= 0) bin.glyphs.splice(bi, 1);
        if (os) os.state = 'flight';
        if (job.kind === 'clear') stats.clears++;
        wakeAround(rec.body.position, 0.35);
      } else if (type === 'release' && rec) {
        if (job.kind === 'place') { rec.state = 'tray'; rec.slot = os ? os.slot : null; }
        else { rec.state = 'bin'; if (bin.glyphs.indexOf(rec) < 0) bin.glyphs.push(rec); }
      } else if (type === 'set' || type === 'mis-set') {
        if (os && rec) {
          var inside = type === 'set' || settleInside(rec, os.slot);
          if (inside) {
            os.state = 'set'; os.glyph = rec; os.slot.glyph = rec; stats.placed++;
            if (os.sub) { stats.substitutes++; order.subs++; }
            if (type === 'mis-set') { stats.crooked++; order.crooked++; }
            emit('placed', { order: order, orderSlot: os, glyph: rec, crooked: type === 'mis-set' });
            if (order.slots.every(function (s) { return s.state === 'set'; })) { order.done = true; order.tDone = hub.time; emit('orderDone', { order: order }); }
          } else {
            stats.faults++; rec.state = 'loose';
            os.state = 'open'; os.fails++; planWanted = true;
            emit('fault', { kind: 'mis-set', arm: info.arm, char: rec.ch });
          }
        }
      } else if (type === 'jam') {
        stats.jams++; stats.faults++;
        if (rec) { rec.state = inTote(rec) ? 'bin' : 'loose'; if (rec.state === 'bin' && bin.glyphs.indexOf(rec) < 0) bin.glyphs.push(rec); }
        if (os) { os.state = 'open'; os.job = null; }
        if (arm) { arm.faulted = true; arm.parked = arm.parked.concat(arm.queue.splice(0)); }
        emit('fault', { kind: 'jam', arm: info.arm, char: rec && rec.ch });
      } else if (type === 'miss') {
        stats.misses++;
        emit('fault', { kind: 'miss', arm: info.arm, reason: info.reason, soft: true });
      } else if (type === 'fail' || type === 'giveup') {
        if (type === 'giveup') stats.giveups++;
        if (arm && arm.handle) { grasp.release(arm.handle, null, null); var hr = recOf(arm.handle.body); arm.handle = null; if (hr) hr.state = 'loose'; }
        if (os && os.state !== 'set') { os.state = 'open'; os.job = null; os.fails++; planWanted = true; }
        emit('fault', { kind: type, arm: info.arm, reason: info.reason, soft: true });
      } else if (type === 'done' && job.kind === 'park') {
        return;
      } else if (type === 'done') {
        if (order && !order.done && !planner && order.slots.some(function (s) { return s.state === 'open'; }) &&
            !hub.armList.some(function (a) { return a.path || a.queue.length; })) planWanted = true;
      } else if (type === 'toolChange') {
        emit('toolChange', { arm: info.arm, tool: info.tool });
      }
      if (type === 'grasp' || type === 'set' || type === 'release' || type === 'start') lastProgress = simTime;
      emit('hub', { type: type, info: info });
    }
    var lastProgress = 0;
    function recOf(body) { for (var id in glyphs) if (glyphs[id].body === body) return glyphs[id]; return null; }
    function wakeAround(p, r) {
      bin.glyphs.forEach(function (g) {
        var q = g.body.position, dx = q.x - p.x, dz = q.z - p.z;
        if (dx * dx + dz * dz < r * r) g.body.wakeUp();
      });
    }

    // ---------------------------------------------------------------- fill / hopper
    var filling = false, fillQueue = [], fillAcc = 0;
    var pending = [], hopperOpen = 0, hopperAcc = 0;
    // Starting stock is poured layer by layer like tiles tipped from a tray: a 5 x 3 grid, then a half-pitch
    // offset 4 x 3 grid on top, and so on — jittered and yawed, mostly face-up, overlapping their neighbours
    // (that overlap is the occlusion the planner digs through). Each layer drops together, 0.3 s apart.
    function startFill(counts) {
      var chars = expand(counts);
      for (var i = chars.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = chars[i]; chars[i] = chars[j]; chars[j] = t; }
      fillQueue = [];
      var layer = 0, ox = L.BIN.x, oz = -L.BIN.y;
      while (chars.length) {
        var odd = layer % 2, cols = odd ? 4 : 5;
        for (var cx = 0; cx < cols && chars.length; cx++) for (var cz = 0; cz < 3 && chars.length; cz++) {
          fillQueue.push({ ch: chars.shift(), layer: layer,
            x: ox + (cx - (cols - 1) / 2) * 0.205 + (rng() - 0.5) * 0.05,
            z: oz + (cz - 1) * 0.19 + (odd ? 0.05 : 0) + (rng() - 0.5) * 0.04,
            y: BINF.floorY + 0.07 + layer * 0.085 });
        }
        layer++;
      }
      filling = true; fillAcc = 0.3; fillSettle = 0; layerI = 0;
      return fillQueue.length;
    }
    var fillSettle = 0, layerI = 0;
    function yawLimit(body, f) {   // keep the grid tiles roughly aligned with the tote (+-25 deg, either way round)
      var qf = new C.Quaternion(), qy = new C.Quaternion(), qt = new C.Quaternion();
      qf.setFromAxisAngle(new C.Vec3(1, 0, 0), -Math.PI / 2);
      qy.setFromAxisAngle(new C.Vec3(0, 1, 0), (rng() - 0.5) * 0.9 + (rng() < 0.5 ? Math.PI : 0));
      qt.setFromEuler((rng() - 0.5) * 0.1, 0, (rng() - 0.5) * 0.1, 'XYZ');
      var q = qt.mult(qy.mult(qf));
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0);
    }
    // Tiles pour out of a tipped tote mostly face-up: random yaw, a few degrees of tilt (RobotBin's own drop tilts +-28 deg).
    function flatten(body, tilt) {
      var qf = new C.Quaternion(), qy = new C.Quaternion(), qt = new C.Quaternion();
      qf.setFromAxisAngle(new C.Vec3(1, 0, 0), -Math.PI / 2);
      qy.setFromAxisAngle(new C.Vec3(0, 1, 0), rng() * Math.PI * 2);
      qt.setFromEuler((rng() - 0.5) * tilt * 2, 0, (rng() - 0.5) * tilt * 2, 'XYZ');
      var q = qt.mult(qy.mult(qf));
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.angularVelocity.set((rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6);
    }
    function fillStep(dt) {
      if (fillQueue.length) {
        fillAcc += dt;
        if (fillAcc >= 0.3) {
          fillAcc = 0;
          var ly = fillQueue[0].layer;
          while (fillQueue.length && fillQueue[0].layer === ly) {
            var f = fillQueue.shift();
            var rec = track(bin.add(f.ch, f.x, f.y, f.z));
            if (rec) { flatten(rec.body, 0.06); yawLimit(rec.body, f); }
          }
        }
        return;
      }
      fillSettle += dt;
      var asleep = bin.glyphs.every(function (g) { return g.body.sleepState === C.Body.SLEEPING; });
      if (asleep || fillSettle > 2.2) {
        bin.cull();
        Object.keys(glyphs).forEach(function (id) { if (glyphs[id].state === 'bin' && bin.glyphs.indexOf(glyphs[id]) < 0) delete glyphs[id]; });
        bin.glyphs.forEach(function (g) { g.body.sleep(); });
        filling = false;
        emit('filled', { count: bin.glyphs.length });
      }
    }
    function refill(counts) {
      expand(counts).forEach(function (c) { pending.push(c); });
      holdUntil = Math.max(holdUntil, hub.time + 0.8 + pending.length * 0.06 + 1.6);
      emit('refill', { count: pending.length });
      return pending.length;
    }
    function hopperStep(dt) {
      hopperOpen += ((pending.length ? 1 : 0) - hopperOpen) * Math.min(1, dt / 0.35);
      if (!pending.length || hopperOpen < 0.7) return;
      hopperAcc += dt;
      while (hopperAcc >= 0.06 && pending.length) {
        hopperAcc -= 0.06;
        var ox = L.BIN.x, oz = -L.BIN.y;
        var hr = track(bin.add(pending.shift(), ox + (rng() - 0.5) * 0.5, CHUTE_Y - 0.12, oz + (rng() - 0.5) * 0.3));
        if (hr) flatten(hr.body, 0.2);
      }
      if (!pending.length) { settleTimer = 1.6; }
    }
    var settleTimer = 0;

    function shake(seconds) {
      bin.vibrate(seconds || 2.5);
      holdUntil = Math.max(holdUntil, hub.time + (seconds || 2.5) + 0.6);
      settleTimer = (seconds || 2.5) + 1.2;
      return true;
    }

    // ---------------------------------------------------------------- control words
    function cancelQueued() {
      // pull every not-yet-started job back (its slot re-opens) — used before a replan after SHAKE / REFILL
      hub.armList.forEach(function (a) {
        a.queue.concat(a.parked).forEach(function (j) { if (j.orderSlot && j.orderSlot.state === 'job') { j.orderSlot.state = 'open'; j.orderSlot.job = null; } });
        a.queue.length = 0; a.parked.length = 0;
      });
      if (order) planWanted = true;
      planner = null;
    }
    function reset() {
      var cleared = 0;
      arms.forEach(function (a) { if (a.faulted) { a.faulted = false; cleared++; } });
      var wasStopped = estopped; estopped = false;
      if (cleared) cancelQueued();
      emit('reset', { cleared: cleared, estop: wasStopped });
      return cleared || wasStopped;
    }
    function forceToolSwap() {
      arms.forEach(function (a) {
        if (a.path) return;      // busy arms swap at their next job
        a.tool = a.tool === 'vacuum' ? 'pinch' : 'vacuum'; a.chain = a.chains[a.tool];
        emit('toolChange', { arm: a.id, tool: a.tool, forced: true });
      });
      holdUntil = Math.max(holdUntil, hub.time + 1.2);
      if (order) { cancelQueued(); }
    }

    // ---------------------------------------------------------------- shipping
    function ship() {
      if (!order || !order.done) return null;
      var out = [];
      order.slots.forEach(function (s) {
        var rec = s.glyph;
        if (rec) {
          world.removeBody(rec.body); rec.state = 'gone';
          delete glyphs[rec.id];
          out.push({ ch: rec.ch, mesh: rec.mesh, slot: s.slot.id, body: rec.body });
        }
        s.slot.state = 'free'; s.slot.char = null; s.slot.glyph = null;
      });
      var done = order; order = null; planWanted = false; planner = null;
      emit('shipped', { order: done, glyphs: out });
      return { order: done, glyphs: out };
    }
    function abandon() {
      if (!order) return;
      cancelQueued();
      order.slots.forEach(function (s) { s.slot.state = 'free'; s.slot.char = null; });
      order = null; planWanted = false; planner = null;
    }

    // ---------------------------------------------------------------- loose glyph sweeper
    var sweepAcc = 0;
    function sweep(dt) {
      sweepAcc += dt; if (sweepAcc < 1) return; sweepAcc = 0;
      Object.keys(glyphs).forEach(function (id) {
        var r = glyphs[id];
        if (r.state === 'bin' && !inTote(r) && !grasp.isAttached(r.body)) { r.state = 'loose'; r.looseT = 0; var bi = bin.glyphs.indexOf(r); if (bi >= 0) bin.glyphs.splice(bi, 1); }
        if (r.state === 'loose') {
          r.looseT = (r.looseT || 0) + 1;
          if (r.looseT > 4) { world.removeBody(r.body); r.state = 'gone'; if (r.mesh && r.mesh.parent) r.mesh.parent.remove(r.mesh); delete glyphs[id]; emit('swept', { ch: r.ch }); }
        }
      });
    }

    // ---------------------------------------------------------------- main step
    var simTime = 0;
    function sub(dt) {
      simTime += dt;
      if (filling) fillStep(dt);
      hopperStep(dt);
      if (settleTimer > 0) { settleTimer -= dt; if (settleTimer <= 0) { bin.glyphs.forEach(function (g) { var v = g.body.velocity; if (v.x * v.x + v.y * v.y + v.z * v.z < 0.01) g.body.sleep(); }); } }
      if (!estopped) {
        // arms with a path finish it (a held glyph must not hang mid-air during a SHAKE); idle arms wait out
        // the hold / their fault: their queue is hidden from the hub for this step (late jobs report a delay)
        breakDeadlock(dt);
        parkIdle(dt);
        var save = [];
        hub.armList.forEach(function (a) { if ((a.faulted || hub.time < holdUntil || a.yieldUntil > hub.time || a.show) && !a.path) { save.push([a, a.queue]); a.queue = []; } });
        hub.update(dt * speed);
        save.forEach(function (s) { s[0].queue = s[1].concat(s[0].queue); });
      } else { grasp.sync(0); }
      bin.update(dt);
      world.step(dt);
      sweep(dt);
    }
    // An arm with nothing to do drives back to its home pose (joint quintic, capsule-guarded), so an idle or
    // faulted arm never parks in the other arm's corridor (the hub's hold would otherwise wait on it forever).
    function parkIdle(dt) {
      arms.forEach(function (a) {
        var yielding = a.yieldUntil > hub.time;
        if (a.path || (a.queue.length && !yielding) || a.show) { a.idleT = 0; return; }
        a.idleT = (a.idleT || 0) + dt;
        var d = 0; for (var i = 0; i < 6; i++) d = Math.max(d, Math.abs(a.q[i] - a.home[i]));
        if (d < 0.02 || a.idleT < 0.35) return;
        // straight up first (out of the tote / away from the other arm's wrist), then a joint move home. Unguarded:
        // parking only ever retreats from the shared space, and the guard is what deadlocked the two arms.
        var segs = [], q0 = a.q;
        try {
          var T = K.fk(a.q, a.chain);
          if (T[11] < 1.25) {
            var U = T.slice(); U[11] = 1.3;
            var up = M.cartesianSegment(T, U, a.q, a.chain, hub.opts); up.phase = 'park';
            segs.push(up); q0 = M.segEndQ(up);
          }
        } catch (e) { segs = []; q0 = a.q; }
        var seg = M.jointSegment(q0, null, a.home, null, a.chain, hub.opts);
        seg.phase = 'park'; segs.push(seg);
        var path = { t0: hub.time, segments: [], job: { kind: 'park', armId: a.id }, res: {} };
        M.appendSegs(path, segs);
        a.path = path; a.job = path.job; a.seg = -1;
      });
    }
    // Two arms can each hold for the other (A waits for B's parked pose, B waits for A's): the hub's capsule guard
    // is per-arm. After 1.2 s of mutual holding the arm that is NOT carrying a glyph yields: its job goes back
    // to the front of its queue and it drives home (clearing the corridor) before trying again.
    function breakDeadlock(dt) {
      arms.forEach(function (a) { a.holdT = a.holding && a.path ? (a.holdT || 0) + dt : 0; });
      if (!(arms[0].holdT > 1.2 && arms[1].holdT > 1.2)) return;
      var cand = arms.filter(function (a) { return !a.handle; });
      if (!cand.length) {   // both carrying: let the one that has waited longest go through its guard
        var go = arms[0].holdT >= arms[1].holdT ? arms[0] : arms[1];
        var nx = go.path.segments[go.seg + 1]; if (nx) nx.cleared = true;
        go.holding = false; go.holdT = 0; return;
      }
      var y = cand.sort(function (a, b) { return a.holdT - b.holdT; })[0];
      var job = y.job;
      y.path = null; y.job = null; y.holding = false; y.held = 0; y.holdT = 0;
      if (job && job.kind !== 'park') y.queue.unshift(Object.assign({}, job, { tPick: null, tPlace: null }));
      y.yieldUntil = hub.time + 2.5;
      emit('yield', { arm: y.id });
    }
    function step(dt) {
      dt = Math.min(Math.max(+dt || 0, 0), MAX_FRAME);
      // 60 Hz sub-steps; a slow frame (software GL runs 0.5-1.5 s frames) is caught up in at most 12 coarser steps
      var n = Math.max(1, Math.min(12, Math.round(dt / SUB_DT))), h = dt / n;
      for (var i = 0; i < n; i++) sub(h);
      // planning: sliced, only when the tote is calm and the arms may move
      if (order && !order.done && !filling) {
        // watchdog: jobs pending but nothing has moved for 14 s (a stuck guard, an unreachable pose the planner
        // could not foresee) -> pull the queue back and re-plan from the tote as it is now
        if (!estopped && hub.time >= holdUntil && simTime - lastProgress > 14 && order.slots.some(function (s) { return s.state === 'job' || s.state === 'open'; })) {
          lastProgress = simTime; arms.forEach(function (a) {
            if (a.path && a.job && a.job.kind !== 'park' && !a.handle) {
              if (a.job.orderSlot && a.job.orderSlot.state === 'job') { a.job.orderSlot.state = 'open'; a.job.orderSlot.job = null; }
              a.path = null; a.job = null; a.holding = false;
            }
          });
          cancelQueued(); emit('watchdog', {});
        }
        if (simTime > retryAt) { retryAt = Infinity; if (!hub.armList.some(function (a) { return a.path && a.job && a.job.kind !== 'park' || a.queue.length; })) planWanted = true; }
        if (planner) {
          var r = planner.step(o.planSliceMs || 6);
          if (r.status !== 'running') applyPlan(r);
        } else if (planWanted && !estopped && binCalm() && hub.time >= holdUntil) {
          if (order.slots.some(function (s) { return s.state === 'open'; })) {
            planWanted = false;
            if (!startPlan()) planWanted = true;
          } else planWanted = false;
        }
      }
      syncMeshes();
    }
    var tmpQ = null;
    function syncMeshes() {
      for (var id in glyphs) {
        var r = glyphs[id];
        if (!r.mesh || r.state === 'gone') continue;
        r.mesh.position.set(r.body.position.x, r.body.position.y, r.body.position.z);
        r.mesh.quaternion.set(r.body.quaternion.x, r.body.quaternion.y, r.body.quaternion.z, r.body.quaternion.w);
      }
    }

    function availability() {
      // letters a planner could reach right now (in the tote, not reserved)
      var counts = {};
      bin.glyphs.forEach(function (g) { var r = glyphs[g.id]; if (r && r.state === 'bin' && inTote(r)) counts[g.ch] = (counts[g.ch] || 0) + 1; });
      return counts;
    }

    function dispose() {
      M.removeHub(hub);
      Object.keys(glyphs).forEach(function (id) { var r = glyphs[id]; if (r.mesh && r.mesh.parent) r.mesh.parent.remove(r.mesh); });
    }

    var cell = {
      world: world, bin: bin, hub: hub, arms: arms, slots: slots, grasp: grasp, glyphs: glyphs, stats: stats, scale: scale,
      FRAME: FRAME, layout: L,
      startFill: startFill, refill: refill, shake: shake, order: order_, ship: ship, abandon: abandon, step: step,
      reset: reset, forceToolSwap: forceToolSwap, cancelQueued: cancelQueued, availability: availability, dispose: dispose,
      estop: function (on) { estopped = on !== false; if (estopped) emit('estop', {}); return estopped; },
      setSpeed: function (s) { speed = Math.max(0.5, Math.min(1.5, s)); dropChance = 0.02 * Math.pow(speed, 4); return speed; },
      get speed() { return speed; }, get estopped() { return estopped; }, get filling() { return filling; },
      get current() { return order; }, get planner() { return planner; }, get hopperDoor() { return hopperOpen; },
      get pendingHopper() { return pending.length; }, get holding() { return hub.time < holdUntil; }, get time() { return simTime; },
      get calm() { return binCalm(); }, replan: function () { if (order) { cancelQueued(); } }
    };
    return cell;
  }

  return { create: create, scrabbleStock: scrabbleStock, mergeCounts: mergeCounts, expand: expand, SUB_DT: SUB_DT };
});
