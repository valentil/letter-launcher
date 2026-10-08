/**
 * RobotBin - the letter tote the robots pick from, with a believable jumble (LLF-79).
 *
 * Exposed as window.RobotBin in the browser and module.exports in node. Physics is cannon
 * (injected, so node tests run it headless); glyph bodies come from a factory (default
 * LetterGlyphs.create, i.e. the CAD convex-hull glyph bodies from LLF-70).
 *
 *   fill(counts, opts)       drop glyphs from staggered heights, sub-stepped settle
 *   occlusionMap()           per-glyph {visibleFraction, topClear, occludedBy[]} from downward
 *                            world.raycastAll over a 5x5 grid on each glyph's bbox
 *   toPlannerGlyphs()        the exact glyph list RobotPlanner expects (mm, z = height)
 *   vibrate(seconds)/shake() 8 Hz, 4 mm sinusoidal kinematic motion of the whole tote
 *   hopperRefill(counts)     queue of new glyphs released through an overhead hopper door
 *   update(dt)               advance vibration + hopper (the world itself is stepped by the host)
 *
 * Units: metres, y up (world). Glyph geometry is 1 m cap height, so default scale 0.18 = 180 mm caps (98 glyphs at 0.25 would pile ~0.6 m deep in a 0.49 m tote).
 * Bin glyph bodies carry body.__binGlyph = true; engine.retireExcessBodies exempts the sleeping
 * ones (up to 160) from the body cap.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RobotBin = api;
  else if (root && typeof module === 'undefined') root.RobotBin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Standard English Scrabble distribution: 98 lettered tiles (+ 2 blanks, which have no glyph).
  var SCRABBLE_COUNTS = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
    N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, _: 2
  };

  // Real inner dimensions of assets/cad/letter_bin.glb (recipe: 3 mm sheet, 1050 x 650 floor,
  // 490 mm walls at 84 deg bends = 6 deg draft outward, floor at 600 mm on the stand).
  var BIN = {
    floorY: 0.603,          // top of tote floor in bin-local metres (stand 0.6 + 3 mm sheet)
    halfX: 0.522, halfZ: 0.322,   // inner floor half extents
    wallH: 0.49,
    draft: 6 * Math.PI / 180,
    wallT: 0.05   // collision slab thickness (the real sheet is 3 mm, but thin slabs let falling glyphs tunnel)
  };
  var SIM_DT = 1 / 60;      // settle sub-step (cannon convex-hull pairs are the cost; 60 Hz is stable at these speeds)
  var HOPPER_H = 1.0;       // hopper door height above the floor, m

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function expand(counts) {
    var out = [];
    Object.keys(counts).sort().forEach(function (ch) {
      if (!/^[A-Z0-9]$/.test(ch)) return;     // blanks ('_') have no glyph: skipped
      for (var i = 0; i < counts[ch]; i++) out.push(ch);
    });
    return out;
  }
  function total(counts) { return expand(counts).length; }

  /**
   * create({CANNON, world, makeGlyph, origin, scale, seed, scene, registry, onDoor})
   *  makeGlyph(ch, scale) -> {body, mesh?}  (default: window.LetterGlyphs.create)
   *  registry: optional array (the engine's physicsBodies) glyph {mesh, body, type:'binGlyph'} are pushed to
   */
  function create(o) {
    var CANNON = o.CANNON || (typeof window !== 'undefined' ? window.CANNON : require('cannon'));
    var world = o.world;
    var scale = o.scale || 0.18;
    var rng = mulberry32((o.seed == null ? 1 : o.seed) >>> 0 || 1);
    var origin = o.origin || { x: 0, y: 0, z: 0 };
    var makeGlyph = o.makeGlyph || function (ch, s) { return window.LetterGlyphs.create(ch, { scale: s }); };
    var glyphs = [];          // {id, ch, body, mesh}
    var nextId = 0;
    var pending = [];         // hopper queue of chars
    var hopper = { door: 0, open: false, timer: 0, rate: 0.07, x: origin.x, z: origin.z };
    var vib = { left: 0, t: 0, amp: o.shakeAmp || 0.004, hz: 8 };

    world.allowSleep = true;

    // ---- tote collider: one kinematic compound body (floor + 4 draft walls)
    var tote = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    var fy = BIN.floorY, T = BIN.wallT;
    tote.addShape(new CANNON.Box(new CANNON.Vec3(BIN.halfX + 0.05, T, BIN.halfZ + 0.05)), new CANNON.Vec3(0, fy - T, 0));
    function wall(hx, hz, nx, nz, tilt) {
      var q = new CANNON.Quaternion();
      // wall plane normal points inward; tilt outward by the draft angle about the horizontal axis
      var half = BIN.wallH / 2 / Math.cos(BIN.draft);
      var shape = new CANNON.Box(new CANNON.Vec3(hx, half, hz));
      var off = new CANNON.Vec3(
        nx * (BIN.halfX + Math.sin(BIN.draft) * BIN.wallH / 2 + T),
        fy + BIN.wallH / 2, nz * (BIN.halfZ + Math.sin(BIN.draft) * BIN.wallH / 2 + T));
      if (nx) { q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -nx * BIN.draft); off.z = 0; }
      else { q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), nz * BIN.draft); off.x = 0; }
      tote.addShape(shape, off, q);
    }
    wall(T, BIN.halfZ + 0.05, 1, 0); wall(T, BIN.halfZ + 0.05, -1, 0);
    wall(BIN.halfX + 0.05, T, 0, 1); wall(BIN.halfX + 0.05, T, 0, -1);
    // NB: boxes above are thin in x (side walls) / z (end walls); swap so the thin axis is the normal
    tote.position.set(origin.x, origin.y, origin.z);
    tote.allowSleep = false;
    world.addBody(tote);

    function sleeps(b) { return b.sleepState === CANNON.Body.SLEEPING; }

    function drop(ch, x, y, z) {
      var g = makeGlyph(ch, scale);
      if (!g || !g.body) return null;
      var b = g.body;
      b.__binGlyph = true; b.allowSleep = true;
      b.linearDamping = 0.2; b.angularDamping = 0.7;   // foam tiles in a tote: air + contact losses so the jumble settles and sleeps
      b.sleepSpeedLimit = 0.8; b.sleepTimeLimit = 0.5;
      b.position.set(x, y, z);
      // glyph lies in its local xy plane; local +z -> world +y is "flat". Random yaw + a little tilt.
      var qFlat = new CANNON.Quaternion(); qFlat.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      var qYaw = new CANNON.Quaternion(); qYaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rng() * Math.PI * 2);
      var qTilt = new CANNON.Quaternion();
      qTilt.setFromEuler((rng() - 0.5) * 1.0, 0, (rng() - 0.5) * 1.0, 'XYZ');
      var q = qTilt.mult(qYaw.mult(qFlat));
      b.quaternion.set(q.x, q.y, q.z, q.w);
      b.velocity.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3);
      b.angularVelocity.set((rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2);
      b.wakeUp();
      world.addBody(b);
      var rec = { id: 'g' + (nextId++), ch: ch, body: b, mesh: g.mesh || null };
      if (rec.mesh && o.scene) o.scene.add(rec.mesh);
      if (o.registry) o.registry.push({ mesh: rec.mesh, body: b, type: 'binGlyph' });
      glyphs.push(rec);
      return rec;
    }
    function randomXZ(margin) {
      return {
        x: origin.x + (rng() * 2 - 1) * (BIN.halfX - margin),
        z: origin.z + (rng() * 2 - 1) * (BIN.halfZ - margin)
      };
    }

    function step(seconds, dt) {
      dt = dt || SIM_DT;
      var n = Math.round(seconds / dt);
      for (var i = 0; i < n; i++) { api2.update(dt); world.step(dt); }
    }
    function syncMeshes() {
      glyphs.forEach(function (g) {
        if (!g.mesh) return;
        g.mesh.position.copy(g.body.position); g.mesh.quaternion.copy(g.body.quaternion);
      });
    }

    var api2 = {
      glyphs: glyphs, tote: tote, BIN: BIN, hopper: hopper, scale: scale,

      /** Drop every glyph of `counts` from staggered heights, then settle with sub-stepped physics. */
      fill: function (counts, opts) {
        opts = opts || {};
        var list = expand(counts || SCRABBLE_COUNTS);
        // shuffle (seeded) so the jumble is not alphabetical
        for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = list[i]; list[i] = list[j]; list[j] = t; }
        var gap = opts.dropInterval || 0.1;   // s between drops: staggered in time AND in height
        for (var idx = 0; idx < list.length; idx++) {
          var top = origin.y + BIN.floorY;
          glyphs.forEach(function (g) { if (g.body.position.y > top && g.body.position.y < origin.y + BIN.floorY + BIN.wallH + 0.3) top = g.body.position.y; });
          var p = randomXZ(0.15);
          drop(list[idx], p.x, top + 0.3 + rng() * 0.15, p.z);
          step(gap);
        }
        api2.settle(opts.settleSeconds == null ? 4 : opts.settleSeconds);
        return glyphs.length;
      },

      /** Step until everything sleeps or `maxSeconds` pass (sub-stepped). Returns seconds used. */
      settle: function (maxSeconds) {
        var dt = SIM_DT, t = 0;
        while (t < maxSeconds) {
          api2.update(dt); world.step(dt); t += dt;
          if (!vib.left && !pending.length && glyphs.every(function (g) { return sleeps(g.body); })) break;
        }
        syncMeshes();
        return t;
      },

      /** Remove glyphs that left the tote (fell over the rim). Returns how many. */
      cull: function () {
        var out = [];
        glyphs.forEach(function (g) {
          var p = g.body.position;
          var rimY = origin.y + BIN.floorY + BIN.wallH;
          var outside = Math.abs(p.x - origin.x) > BIN.halfX + 0.1 || Math.abs(p.z - origin.z) > BIN.halfZ + 0.1 ||
            p.y < origin.y + BIN.floorY - 0.1 || p.y > rimY + 0.4 && sleeps(g.body);
          if (outside) out.push(g);
        });
        out.forEach(function (g) { api2.remove(g); });
        return out.length;
      },
      remove: function (g) {
        var i = glyphs.indexOf(g); if (i < 0) return;
        glyphs.splice(i, 1);
        world.removeBody(g.body);
        if (g.mesh && g.mesh.parent) g.mesh.parent.remove(g.mesh);
        if (o.registry) { var r = o.registry.findIndex(function (e) { return e.body === g.body; }); if (r >= 0) o.registry.splice(r, 1); }
      },

      /**
       * Per-glyph occlusion via downward raycasts from a 5x5 grid over each glyph's bbox.
       * A grid point counts for glyph G when G is hit by that ray; it is "covered" when the
       * first (highest) hit is a different glyph. visibleFraction = uncovered / hit points.
       */
      occlusionMap: function () {
        var map = {};
        var ray = new CANNON.Ray();
        var skyY = origin.y + BIN.floorY + BIN.wallH + 1.0, floorY = origin.y + BIN.floorY - 0.05;
        var bodyToId = new Map();
        glyphs.forEach(function (g) { bodyToId.set(g.body, g.id); });
        glyphs.forEach(function (g) {
          var bb = g.body.aabb;
          g.body.computeAABB();
          var lo = bb.lowerBound, hi = bb.upperBound;
          var hit = 0, vis = 0, occ = {};
          for (var ix = 0; ix < 5; ix++) for (var iz = 0; iz < 5; iz++) {
            var x = lo.x + (hi.x - lo.x) * (ix + 0.5) / 5, z = lo.z + (hi.z - lo.z) * (iz + 0.5) / 5;
            var hits = [];
            world.raycastAll(new CANNON.Vec3(x, skyY, z), new CANNON.Vec3(x, floorY, z), {}, function (r) {
              if (r.body && bodyToId.has(r.body)) hits.push({ id: bodyToId.get(r.body), y: r.hitPointWorld.y });
            });
            if (!hits.length) continue;
            hits.sort(function (a, b) { return b.y - a.y; });
            var mine = -1;
            for (var h = 0; h < hits.length; h++) if (hits[h].id === g.id) { mine = h; break; }
            if (mine < 0) continue;
            for (h = 0; h < mine; h++) occ[hits[h].id] = (occ[hits[h].id] || 0) + 1;
            hit++;
            if (mine === 0) vis++;
          }
          // a sliver of overlap (one grid ray) is not a blocker for a pick; two or more rays are
          map[g.id] = { visibleFraction: hit ? vis / hit : 0, topClear: false, occludedBy: Object.keys(occ).filter(function (k) { return occ[k] >= 2; }) };
        });
        // topClear: nothing covers any sampled point of the glyph
        Object.keys(map).forEach(function (id) { map[id].topClear = map[id].occludedBy.length === 0; });
        return map;
      },

      /** Glyph list in exactly the RobotPlanner input format (mm; planner z is height). */
      toPlannerGlyphs: function () {
        var om = api2.occlusionMap();
        return glyphs.map(function (g) {
          var p = g.body.position;
          // glyph local +z axis in world: flat when it points up
          var up = g.body.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
          var flat = Math.abs(up.y) > 0.8;
          return {
            id: g.id, char: g.ch,
            pose: { x: (p.x - origin.x) * 1000, y: (p.z - origin.z) * 1000, z: (p.y - origin.y) * 1000 },
            upright: !flat, flatUp: flat && up.y > 0,
            halfWidth: 0.45 * scale * 1000 * 0.5,
            occludedBy: om[g.id].occludedBy,
            visibleFraction: om[g.id].visibleFraction, topClear: om[g.id].topClear
          };
        });
      },

      /** Shake the tote: 8 Hz, 4 mm sinusoid for `seconds` (host keeps calling update/world.step). */
      vibrate: function (seconds) {
        vib.left = Math.max(vib.left, seconds || 0);
        glyphs.forEach(function (g) { g.body.allowSleep = false; g.body.wakeUp(); });   // no napping while the floor shakes
      },
      shake: function () { api2.vibrate(2.5); },
      isVibrating: function () { return vib.left > 0; },

      /** Queue new glyphs; the hopper door opens and releases them above the bin. */
      hopperRefill: function (counts) {
        expand(counts || {}).forEach(function (c) { pending.push(c); });
        hopper.open = pending.length > 0;
        return pending.length;
      },
      pendingCount: function () { return pending.length; },

      update: function (dt) {
        // vibration: drive the kinematic tote with the sinusoid's exact velocity
        if (vib.left > 0) {
          vib.t += dt; vib.left -= dt;
          var w = 2 * Math.PI * vib.hz;
          // 8 Hz carrier, 4 mm; the horizontal shake direction slowly rotates (0.7 Hz) so the pile
          // is worked in every direction instead of just sliding back and forth along x.
          var c = vib.amp * w * Math.cos(w * vib.t), th = 2 * Math.PI * 0.7 * vib.t;
          tote.velocity.set(c * Math.cos(th), vib.amp * w * Math.cos(w * vib.t + Math.PI / 2), c * Math.sin(th));
          if (vib.left <= 0) { vib.left = 0; glyphs.forEach(function (g) { g.body.allowSleep = true; }); tote.velocity.set(0, 0, 0); tote.position.set(origin.x, origin.y, origin.z); }
        }
        // hopper door
        var target = hopper.open ? 1 : 0;
        hopper.door += Math.max(-1, Math.min(1, target - hopper.door)) * Math.min(1, dt / 0.4);
        if (o.onDoor) o.onDoor(hopper.door);
        if (pending.length && hopper.door > 0.7) {
          hopper.timer += dt;
          while (hopper.timer >= hopper.rate && pending.length) {
            hopper.timer -= hopper.rate;
            var ch = pending.shift();
            var p = randomXZ(0.2);
            drop(ch, origin.x + (p.x - origin.x) * 0.4, origin.y + BIN.floorY + HOPPER_H, origin.z + (p.z - origin.z) * 0.4);
          }
          if (!pending.length) hopper.open = false;
        }
        if (o.scene) syncMeshes();
      },
      add: drop, step: step
    };
    return api2;
  }

  return { create: create, SCRABBLE_COUNTS: SCRABBLE_COUNTS, expand: expand, total: total, BIN: BIN };
});
