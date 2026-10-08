/**
 * RobotPlanner — pick-and-place job planner for the Robot Factory map (LLF-76).
 *
 * Pure module: no DOM, no three.js, no physics. Exposed as window.RobotPlanner in
 * the browser and module.exports in node.
 *
 * Problem: fill an ordered row of type-tray slots (a word / phrase) with glyph
 * bodies lying in a bin, using several robot arms that share airspace zones.
 *
 * CSP variables per slot s: (glyphId, armId, grasp, tStart)
 *   - glyph char must match the slot char, or be a substitute (0<->O, 1<->I,
 *     5<->S, 2<->Z, 8<->B) at a score penalty;
 *   - glyph must be graspable: top-most in its column (occlusion precedence —
 *     whatever sits on top is picked first, either because it is needed in
 *     another slot or by an extra 'clear' job that drops it at a discard pose),
 *     vacuum needs a flat face up, pinch needs jaw clearance to neighbours;
 *   - the arm must reach both the pick and the place pose (injected reach fn,
 *     plus optional ik fn);
 *   - no two arms inside the same zone in overlapping time windows;
 *   - tool changes cost time + score when the grasp needs the other tool;
 *   - optional left-to-right placing precedence (puzzle variants).
 *
 * Solver: greedy construction -> augmenting-path (min-conflicts) repair of
 * unassigned slots -> seeded min-conflicts / hill-climbing local search over
 * glyph/arm/grasp choices and job priority order. Timing is produced by a list
 * scheduler that delays jobs until arm, occlusion, precedence and zone
 * constraints all hold, so zone intervals never overlap by construction.
 *
 * The search is a generator; planner.step(budgetMs) runs it in time slices
 * (default 8 ms) so the game loop never hitches. Termination is iteration based
 * (maxIterations / patience), never wall-clock based, so the result is
 * identical however it is sliced — fully deterministic for a given seed.
 *
 * Units: poses in mm ({x, y, z}), times in seconds, speeds in mm/s.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RobotPlanner = api;
  else if (root && typeof module === 'undefined') root.RobotPlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SUBSTITUTES = { '0': 'O', 'O': '0', '1': 'I', 'I': '1', '5': 'S', 'S': '5', '2': 'Z', 'Z': '2', '8': 'B', 'B': '8' };
  var GRASP_TOOL = { 'top-pinch': 'pinch', 'side-pinch': 'pinch', 'vacuum': 'vacuum' };
  var GRASPS = ['top-pinch', 'side-pinch', 'vacuum'];
  var BIG = 1000;

  var DEFAULTS = {
    seed: 1,
    sliceMs: 8,              // default per-frame budget for step()
    maxIterations: 600,      // local-search iterations (deterministic stop)
    patience: 250,           // stop after this many non-improving iterations
    substitutePenalty: 5,    // objective weight per substitute glyph
    toolChangeWeight: 1,     // objective weight per tool change
    toolChangeTime: 2.0,     // s added to an arm's timeline per tool change
    armSpeed: 500,           // mm/s default when an arm has no speed
    pickTime: 0.6,           // s dwell at pick
    placeTime: 0.6,          // s dwell at place
    zoneApproach: 0.25,      // s an arm occupies a zone before/after a dwell
    jawClearance: 30,        // mm needed between glyph and neighbours for pinch
    glyphHalfWidth: 20,      // mm default glyph half footprint
    occlusionRadius: 30,     // mm xy radius used by computeOcclusion
    leftToRight: false,      // place slots strictly left -> right
    discardPose: null,       // where 'clear' jobs drop occluders (arm.discardPose overrides)
    now: null                // clock for slicing (ms); defaults to performance.now / Date.now
  };

  // ---------------------------------------------------------------- helpers
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  function distXY(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function inZone(p, z) {
    return p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y &&
      (p.z || 0) >= z.min.z && (p.z || 0) <= z.max.z;
  }
  function defaultNow() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }
  function upper(c) { return String(c).toUpperCase(); }
  function charMatch(want, have) {
    if (want === have) return 0;            // exact
    if (SUBSTITUTES[want] === have) return 1; // substitute
    return -1;
  }

  /** Default reach model: a spherical shell around the arm base. */
  function sphereShellReach(basePose, rMin, rMax) {
    var lo = rMin == null ? 0 : rMin, hi = rMax == null ? 600 : rMax;
    return function (pose) { var d = dist(pose, basePose); return d >= lo && d <= hi; };
  }

  /**
   * Fill occludedBy[] from bin physics state: a glyph is occluded by any other
   * glyph whose centre is above it and within `radius` mm in plan view (the
   * equivalent of a downward raycast column test). Returns new glyph objects.
   */
  function computeOcclusion(glyphs, opts) {
    var r = (opts && opts.radius) || DEFAULTS.occlusionRadius;
    return glyphs.map(function (g) {
      var occ = [];
      glyphs.forEach(function (o) {
        if (o.id !== g.id && (o.pose.z || 0) > (g.pose.z || 0) + 1e-6 && distXY(o.pose, g.pose) < r) occ.push(o.id);
      });
      var c = {}; for (var k in g) c[k] = g[k];
      c.occludedBy = occ;
      return c;
    });
  }

  /**
   * Lay words out as type-tray slots: one row per word, spaces leave a gap.
   * words: string or string[]; returns [{id, char, pose, row, col}].
   */
  function layoutSlots(words, opts) {
    opts = opts || {};
    var origin = opts.origin || { x: 0, y: 420, z: 0 };
    var pitch = opts.pitch || 50, rowPitch = opts.rowPitch || 60;
    var list = Array.isArray(words) ? words : [words];
    var out = [];
    list.forEach(function (w, row) {
      String(w).split('').forEach(function (ch, col) {
        if (ch === ' ') return;
        out.push({ id: row + ':' + col, char: upper(ch), row: row, col: col,
          pose: { x: origin.x + col * pitch, y: origin.y + row * rowPitch, z: origin.z } });
      });
    });
    return out;
  }

  // ---------------------------------------------------------------- planner
  function createPlanner(input) {
    if (!input) throw new Error('RobotPlanner: input required');
    var opt = {};
    var k;
    for (k in DEFAULTS) opt[k] = DEFAULTS[k];
    var o2 = input.options || {};
    for (k in o2) opt[k] = o2[k];
    var now = opt.now || defaultNow;
    var rng = mulberry32(opt.seed >>> 0 || 1);

    var slots = input.slots ? input.slots.map(function (s, i) {
      return { id: s.id != null ? s.id : String(i), char: upper(s.char), pose: s.pose };
    }) : layoutSlots(input.words || '', input.layout);
    var glyphs = (input.glyphs || []).map(function (g) {
      return {
        id: g.id, char: upper(g.char), pose: g.pose, upright: !!g.upright,
        flatUp: g.flatUp != null ? !!g.flatUp : !g.upright,
        occludedBy: (g.occludedBy || []).slice(),
        halfWidth: g.halfWidth || opt.glyphHalfWidth,
        grasps: g.grasps || null, clearGrasps: g.clearGrasps || null   // LLF-78: optional per-glyph grasp whitelists (place / clear)
      };
    });
    var arms = (input.arms || []).map(function (a) {
      return {
        id: a.id, basePose: a.basePose,
        reachable: a.reachable || a.reachFn || sphereShellReach(a.basePose, 0, 600),
        ik: a.ik || a.ikAnalytic || null,
        toolType: a.toolType || 'pinch',
        tools: (a.tools || [a.toolType || 'pinch']).slice(),
        speed: a.speed || opt.armSpeed,
        discardPose: a.discardPose || opt.discardPose || null
      };
    });
    var zones = (input.zones || []).map(function (z, i) { return { id: z.id != null ? z.id : 'zone' + i, min: z.min, max: z.max }; });
    if (!arms.length) throw new Error('RobotPlanner: at least one arm required');

    var NS = slots.length, NG = glyphs.length, NA = arms.length;
    var gIndex = {}; glyphs.forEach(function (g, i) { gIndex[g.id] = i; });

    // occluder index lists (direct) and transitive closure
    var occ = glyphs.map(function (g) {
      return g.occludedBy.map(function (id) { return gIndex[id]; }).filter(function (i) { return i != null; });
    });
    var occAll = glyphs.map(function (g, i) {
      var seen = {}, stack = occ[i].slice(), out = [];
      while (stack.length) { var j = stack.pop(); if (seen[j] || j === i) continue; seen[j] = 1; out.push(j); stack = stack.concat(occ[j]); }
      return out.sort(function (a, b) { return a - b; });
    });

    function canReach(arm, pose) {
      if (!pose) return false;
      try { return !!arm.reachable(pose) && (!arm.ik || !!arm.ik(pose)); } catch (e) { return false; }
    }
    var pickReach = glyphs.map(function (g) { return arms.map(function (a) { return canReach(a, g.pose); }); });
    var placeReach = slots.map(function (s) { return arms.map(function (a) { return canReach(a, s.pose); }); });
    var discardReach = arms.map(function (a) { return canReach(a, a.discardPose); });

    // physical graspability per glyph (static, vs all neighbours at plan start)
    var clearance = glyphs.map(function (g, i) {
      var m = Infinity;
      glyphs.forEach(function (o, j) {
        if (i === j || occAll[i].indexOf(j) >= 0) return; // things on top are removed first
        if (Math.abs((o.pose.z || 0) - (g.pose.z || 0)) > 2 * g.halfWidth) return;
        m = Math.min(m, distXY(o.pose, g.pose) - g.halfWidth - o.halfWidth);
      });
      return m;
    });
    function graspTable(list) {
      return glyphs.map(function (g, i) {
        var pinch = clearance[i] > opt.jawClearance;
        var ok = { 'top-pinch': pinch, 'side-pinch': pinch && g.upright, 'vacuum': g.flatUp };
        var w = list(g);   // LLF-78: a caller whitelist narrows pinch, and may allow vacuum on a face-down glyph (clear jobs)
        if (w) GRASPS.forEach(function (gr) { ok[gr] = w.indexOf(gr) >= 0 && (gr === 'vacuum' || ok[gr]); });
        return ok;
      });
    }
    var graspOk = graspTable(function (g) { return g.grasps; });
    var clearGraspOk = graspTable(function (g) { return g.clearGrasps || g.grasps; });
    function armGrasps(ai, gi, forClear) {
      var out = [], tbl = forClear ? clearGraspOk : graspOk;
      GRASPS.forEach(function (gr) { if (tbl[gi][gr] && arms[ai].tools.indexOf(GRASP_TOOL[gr]) >= 0) out.push(gr); });
      return out;
    }

    // clear-job options for each glyph (pick it and drop it at the arm's discard pose)
    var clearOpts = glyphs.map(function (g, gi) {
      var out = [];
      for (var a = 0; a < NA; a++) {
        if (!pickReach[gi][a] || !discardReach[a]) continue;
        armGrasps(a, gi, true).forEach(function (gr) { out.push({ arm: a, grasp: gr }); });
      }
      return out;
    });

    // slot domains: options[s][gi] = [{arm, grasp}], plus sub flag
    var domain = slots.map(function (s) {
      var cands = [];
      glyphs.forEach(function (g, gi) {
        var m = charMatch(s.char, g.char);
        if (m < 0) return;
        var opts = [];
        for (var a = 0; a < NA; a++) {
          if (!pickReach[gi][a] || !placeReach[slots.indexOf(s)][a]) continue;
          armGrasps(a, gi).forEach(function (gr) { opts.push({ arm: a, grasp: gr }); });
        }
        if (!opts.length) return;
        // buried glyph whose occluders can neither be cleared nor used elsewhere is out
        var buriedOk = occAll[gi].every(function (j) { return clearOpts[j].length > 0; });
        cands.push({ g: gi, sub: m === 1, opts: opts, buriedOk: buriedOk });
      });
      return cands;
    });
    function candFor(s, gi) {
      var d = domain[s];
      for (var i = 0; i < d.length; i++) if (d[i].g === gi) return d[i];
      return null;
    }

    // ------------------------------------------------------------ state
    var state = {
      assign: new Array(NS).fill(null), // {g, arm, grasp, sub}
      order: slots.map(function (_, i) { return i; }),
      clearChoice: clearOpts.map(function () { return 0; })
    };
    // default clear choice: nearest capable arm
    clearOpts.forEach(function (list, gi) {
      var best = 0, bd = Infinity;
      list.forEach(function (c, i) { var d = dist(arms[c.arm].basePose, glyphs[gi].pose); if (d < bd) { bd = d; best = i; } });
      state.clearChoice[gi] = best;
    });
    function cloneState(st) {
      return { assign: st.assign.slice(), order: st.order.slice(), clearChoice: st.clearChoice.slice() };
    }
    function usedMap(st) {
      var u = new Array(NG).fill(-1);
      st.assign.forEach(function (a, s) { if (a) u[a.g] = s; });
      return u;
    }

    // ------------------------------------------------------------ scheduler
    function zonesOf(p) {
      var out = [];
      for (var i = 0; i < zones.length; i++) if (inZone(p, zones[i])) out.push(i);
      return out;
    }
    var glyphZones = glyphs.map(function (g) { return zonesOf(g.pose); });
    var slotZones = slots.map(function (s) { return zonesOf(s.pose); });
    var discardZones = arms.map(function (a) { return a.discardPose ? zonesOf(a.discardPose) : []; });

    function evaluate(st) {
      var tasks = [], taskOfGlyph = new Array(NG).fill(-1), conflicts = 0, deadlock = false, reasons = [];
      var assignedSlots = [];
      st.assign.forEach(function (a, s) {
        if (!a) { conflicts++; return; }
        taskOfGlyph[a.g] = tasks.length;
        tasks.push({ kind: 'place', slot: s, g: a.g, arm: a.arm, grasp: a.grasp, sub: a.sub, prio: st.order.indexOf(s) });
        assignedSlots.push(s);
      });
      // clear jobs for occluders that are not used in any slot
      var placeCount = tasks.length;
      for (var t = 0; t < placeCount; t++) {
        occAll[tasks[t].g].forEach(function (j) {
          if (taskOfGlyph[j] >= 0) return;
          var co = clearOpts[j];
          if (!co.length) { conflicts++; return; }
          var c = co[st.clearChoice[j] % co.length];
          taskOfGlyph[j] = tasks.length;
          tasks.push({ kind: 'clear', slot: -1, g: j, arm: c.arm, grasp: c.grasp, sub: false, prio: Infinity });
        });
      }
      // clear jobs inherit priority just ahead of what they unblock (relax over chains)
      for (var pass = 0; pass < NG + 1; pass++) {
        var changed = false;
        tasks.forEach(function (tk) {
          occ[tk.g].forEach(function (j) {
            var ti = taskOfGlyph[j];
            if (ti >= 0 && tasks[ti].kind === 'clear' && tasks[ti].prio > tk.prio - 0.5) { tasks[ti].prio = tk.prio - 0.5; changed = true; }
          });
        });
        if (!changed) break;
      }
      var byPrio = tasks.map(function (_, i) { return i; }).sort(function (a, b) {
        return tasks[a].prio - tasks[b].prio || tasks[a].g - tasks[b].g;
      });
      // precedence: previous assigned slot (by index) must be placed first
      var prevSlotTask = {};
      if (opt.leftToRight) {
        var prev = -1;
        for (var s2 = 0; s2 < NS; s2++) {
          if (!st.assign[s2]) continue;
          if (prev >= 0) prevSlotTask[taskOfGlyph[st.assign[s2].g]] = taskOfGlyph[st.assign[prev].g];
          prev = s2;
        }
      }

      var armState = arms.map(function (a) { return { pos: a.basePose, t: 0, tool: a.toolType }; });
      var zoneLog = zones.map(function () { return []; });
      var done = new Array(tasks.length).fill(null);
      var schedule = [], toolChanges = 0, subs = 0, makespan = 0;

      function fit(zs, tt, dur, armId) {
        var moved = true, guard = 0;
        while (moved && guard++ < 1000) {
          moved = false;
          var lo = tt - opt.zoneApproach, hi = tt + dur + opt.zoneApproach;
          for (var zi = 0; zi < zs.length; zi++) {
            var L = zoneLog[zs[zi]];
            for (var q = 0; q < L.length; q++) {
              var iv = L[q];
              if (iv.arm !== armId && iv.t0 < hi - 1e-9 && lo < iv.t1 - 1e-9) {
                tt = iv.t1 + opt.zoneApproach; moved = true;
                lo = tt - opt.zoneApproach; hi = tt + dur + opt.zoneApproach;
              }
            }
          }
        }
        return tt;
      }
      function reserve(zs, tt, dur, armId, label) {
        zs.forEach(function (zi) {
          zoneLog[zi].push({ arm: armId, t0: tt - opt.zoneApproach, t1: tt + dur + opt.zoneApproach, what: label });
        });
      }

      var remaining = byPrio.slice();
      while (remaining.length) {
        var pickIdx = -1;
        for (var r = 0; r < remaining.length; r++) {
          var ti = remaining[r], tk = tasks[ti], ready = true;
          for (var q = 0; q < occ[tk.g].length; q++) {
            var dep = taskOfGlyph[occ[tk.g][q]];
            if (dep >= 0 && !done[dep]) { ready = false; break; }
          }
          if (ready && prevSlotTask[ti] != null && !done[prevSlotTask[ti]]) ready = false;
          if (ready) { pickIdx = r; break; }
        }
        if (pickIdx < 0) { deadlock = true; conflicts += remaining.length; break; }
        var ti2 = remaining.splice(pickIdx, 1)[0], T = tasks[ti2], A = arms[T.arm], AS = armState[T.arm];
        var g = glyphs[T.g];
        var placePose = T.kind === 'place' ? slots[T.slot].pose : A.discardPose;
        var needTool = GRASP_TOOL[T.grasp], tc = AS.tool !== needTool;
        var depReady = 0;
        occ[T.g].forEach(function (j) { var d = taskOfGlyph[j]; if (d >= 0 && done[d]) depReady = Math.max(depReady, done[d].tPick + opt.pickTime); });
        var tPick = Math.max(AS.t + (tc ? opt.toolChangeTime : 0) + dist(AS.pos, g.pose) / A.speed, depReady);
        tPick = fit(glyphZones[T.g], tPick, opt.pickTime, T.arm);
        reserve(glyphZones[T.g], tPick, opt.pickTime, T.arm, 'pick ' + g.id);
        var tPlace = tPick + opt.pickTime + dist(g.pose, placePose) / A.speed;
        if (prevSlotTask[ti2] != null) tPlace = Math.max(tPlace, done[prevSlotTask[ti2]].tPlace + opt.placeTime);
        var pz = T.kind === 'place' ? slotZones[T.slot] : discardZones[T.arm];
        tPlace = fit(pz, tPlace, opt.placeTime, T.arm);
        reserve(pz, tPlace, opt.placeTime, T.arm, (T.kind === 'place' ? 'place ' : 'discard ') + g.id);
        AS.pos = placePose; AS.t = tPlace + opt.placeTime; AS.tool = needTool;
        if (tc) toolChanges++;
        if (T.sub) subs++;
        makespan = Math.max(makespan, AS.t);
        done[ti2] = { tPick: tPick, tPlace: tPlace };
        schedule.push({
          kind: T.kind, armId: A.id, glyphId: g.id, char: g.char,
          slot: T.kind === 'place' ? slots[T.slot].id : null, slotIndex: T.kind === 'place' ? T.slot : -1,
          slotChar: T.kind === 'place' ? slots[T.slot].char : null,
          grasp: T.grasp, tPick: tPick, tPlace: tPlace, tEnd: tPlace + opt.placeTime,
          substitute: !!T.sub, toolChange: tc
        });
      }
      if (deadlock) reasons.push('placing order and stacking order contradict each other (a needed letter is buried under one that must be placed later)');
      schedule.sort(function (a, b) { return a.tPick - b.tPick || (a.armId < b.armId ? -1 : 1); });
      var objective = makespan + opt.substitutePenalty * subs + opt.toolChangeWeight * toolChanges + BIG * conflicts;
      return {
        objective: objective, makespan: makespan, substitutes: subs, toolChanges: toolChanges,
        conflicts: conflicts, deadlock: deadlock, schedule: schedule, reasons: reasons,
        zoneLog: zoneLog.map(function (L, i) { return { zone: zones[i].id, intervals: L.map(function (iv) { return { armId: arms[iv.arm].id, t0: iv.t0, t1: iv.t1, what: iv.what }; }) }; })
      };
    }

    // ------------------------------------------------------------ construction
    function optCost(s, c, o, armT, armPos) {
      var g = glyphs[c.g], A = arms[o.arm];
      return armT[o.arm] + dist(armPos[o.arm], g.pose) / A.speed + dist(g.pose, slots[s].pose) / A.speed +
        (c.sub ? opt.substitutePenalty : 0) + occAll[c.g].length * (opt.pickTime + opt.placeTime + 1) +
        (A.toolType !== GRASP_TOOL[o.grasp] ? opt.toolChangeTime : 0);
    }
    function bestOpt(s, c) {
      var best = null, bc = Infinity;
      c.opts.forEach(function (o) {
        var A = arms[o.arm];
        var cost = dist(A.basePose, glyphs[c.g].pose) + dist(A.basePose, slots[s].pose) + (A.toolType !== GRASP_TOOL[o.grasp] ? 1e3 : 0);
        if (cost < bc) { bc = cost; best = o; }
      });
      return best;
    }
    function greedy() {
      var used = new Array(NG).fill(false);
      var armT = arms.map(function () { return 0; }), armPos = arms.map(function (a) { return a.basePose; });
      for (var s = 0; s < NS; s++) {
        var best = null, bc = Infinity;
        domain[s].forEach(function (c) {
          if (used[c.g] || !c.buriedOk) return;
          c.opts.forEach(function (o) {
            var cost = optCost(s, c, o, armT, armPos);
            if (cost < bc) { bc = cost; best = { c: c, o: o }; }
          });
        });
        if (!best) continue;
        used[best.c.g] = true;
        state.assign[s] = { g: best.c.g, arm: best.o.arm, grasp: best.o.grasp, sub: best.c.sub };
        var A = arms[best.o.arm];
        armT[best.o.arm] += dist(armPos[best.o.arm], glyphs[best.c.g].pose) / A.speed + opt.pickTime +
          dist(glyphs[best.c.g].pose, slots[s].pose) / A.speed + opt.placeTime;
        armPos[best.o.arm] = slots[s].pose;
      }
    }
    // augmenting-path repair (Kuhn): steal a glyph from a slot that has an alternative
    function repair() {
      var fixed = 0;
      for (var s = 0; s < NS; s++) {
        if (state.assign[s]) continue;
        var used = usedMap(state), seen = {};
        if (augment(s, used, seen, 0)) fixed++;
      }
      return fixed;
    }
    function augment(s, used, seen, depth) {
      if (depth > NS) return false;
      var d = domain[s];
      // exact matches first, then substitutes (domain order is glyph order; sort stable)
      var order = d.filter(function (c) { return c.buriedOk && !c.sub; }).concat(d.filter(function (c) { return c.buriedOk && c.sub; }));
      for (var i = 0; i < order.length; i++) {
        var c = order[i];
        if (seen[c.g]) continue;
        seen[c.g] = true;
        var holder = used[c.g];
        if (holder < 0 || augment(holder, used, seen, depth + 1)) {
          var o = bestOpt(s, c);
          state.assign[s] = { g: c.g, arm: o.arm, grasp: o.grasp, sub: c.sub };
          used[c.g] = s;
          return true;
        }
      }
      return false;
    }

    // ------------------------------------------------------------ local search moves
    function randInt(n) { return Math.floor(rng() * n); }
    function randomMove(st) {
      var kind = rng();
      var assigned = []; st.assign.forEach(function (a, s) { if (a) assigned.push(s); });
      if (!assigned.length) return false;
      var s = assigned[randInt(assigned.length)], a = st.assign[s];
      if (kind < 0.3) { // change arm / grasp
        var c = candFor(s, a.g); if (!c || c.opts.length < 2) return false;
        var o = c.opts[randInt(c.opts.length)];
        if (o.arm === a.arm && o.grasp === a.grasp) return false;
        st.assign[s] = { g: a.g, arm: o.arm, grasp: o.grasp, sub: a.sub };
        return true;
      }
      if (kind < 0.6) { // change glyph (take free one or swap with another slot)
        var d = domain[s].filter(function (c2) { return c2.buriedOk && c2.g !== a.g; });
        if (!d.length) return false;
        var nc = d[randInt(d.length)];
        var used = usedMap(st), holder = used[nc.g];
        if (holder >= 0) {
          var back = candFor(holder, a.g);
          if (!back || !back.buriedOk) return false;
          var bo = back.opts[randInt(back.opts.length)];
          st.assign[holder] = { g: a.g, arm: bo.arm, grasp: bo.grasp, sub: back.sub };
        }
        var no = nc.opts[randInt(nc.opts.length)];
        st.assign[s] = { g: nc.g, arm: no.arm, grasp: no.grasp, sub: nc.sub };
        return true;
      }
      if (kind < 0.9) { // swap priority order
        if (NS < 2) return false;
        var i = randInt(NS), j = randInt(NS); if (i === j) return false;
        var tmp = st.order[i]; st.order[i] = st.order[j]; st.order[j] = tmp;
        return true;
      }
      // change who clears an occluder
      var cands = [];
      clearOpts.forEach(function (l, gi) { if (l.length > 1) cands.push(gi); });
      if (!cands.length) return false;
      var gi2 = cands[randInt(cands.length)];
      st.clearChoice[gi2] = (st.clearChoice[gi2] + 1 + randInt(clearOpts[gi2].length - 1)) % clearOpts[gi2].length;
      return true;
    }

    // ------------------------------------------------------------ unsat reasons
    function slotLabel(s) { return 'slot ' + (s + 1) + ' (' + slots[s].char + ')'; }
    function explain(s) {
      var ch = slots[s].char, sub = SUBSTITUTES[ch];
      var matching = []; glyphs.forEach(function (g, gi) { if (charMatch(ch, g.char) >= 0) matching.push(gi); });
      if (!matching.length) return 'bin empty of ' + ch + (sub ? ' (and no ' + sub + ' to stand in for it)' : '');
      if (!arms.some(function (_, a) { return placeReach[s][a]; })) return slotLabel(s) + ' is out of reach of every arm';
      var reach = matching.filter(function (gi) { return arms.some(function (_, a) { return pickReach[gi][a] && placeReach[s][a]; }); });
      if (!reach.length) return 'no ' + ch + ' reachable — every ' + ch + ' in the bin is outside the arms that can reach ' + slotLabel(s);
      var grasp = reach.filter(function (gi) { return arms.some(function (_, a) { return pickReach[gi][a] && placeReach[s][a] && armGrasps(a, gi).length; }); });
      if (!grasp.length) return 'no ' + ch + ' can be gripped — standing on edge with no room for the jaws (needs ' + opt.jawClearance + ' mm) and no flat face up for the vacuum cup';
      var dig = grasp.filter(function (gi) { return occAll[gi].every(function (j) { return clearOpts[j].length > 0; }); });
      if (!dig.length) return 'every ' + ch + ' is buried and no arm can lift off what is on top of it' + (arms.some(function (a) { return a.discardPose; }) ? '' : ' (no discard spot set)');
      var need = slots.filter(function (x) { return x.char === ch; }).length;
      return 'need ' + need + ' × ' + ch + ' but only ' + dig.length + ' usable in the bin';
    }

    // ------------------------------------------------------------ search generator
    var stats = { phase: 'idle', iterations: 0, evaluations: 0, conflicts: 0, makespan: 0, substitutes: 0, toolChanges: 0, objective: Infinity, slices: 0, elapsedMs: 0, done: false };
    var cur = null, best = null, bestState = null;

    function record(e) {
      stats.evaluations++;
      stats.conflicts = e.conflicts; stats.makespan = e.makespan; stats.substitutes = e.substitutes;
      stats.toolChanges = e.toolChanges;
    }
    function* search() {
      stats.phase = 'construct'; greedy(); yield;
      stats.phase = 'repair'; repair(); yield;
      cur = evaluate(state); record(cur);
      best = cur; bestState = cloneState(state);
      stats.phase = 'improve';
      var since = 0;
      while (stats.iterations < opt.maxIterations && since < opt.patience) {
        stats.iterations++;
        var snap = cloneState(state);
        if (!randomMove(state)) { since++; yield; continue; }
        var e = evaluate(state); record(e);
        if (e.objective <= cur.objective + 1e-9) {
          cur = e;
          if (e.objective < best.objective - 1e-9) { best = e; bestState = cloneState(state); since = 0; } else since++;
        } else {
          state = snap; since++;
        }
        yield;
      }
      state = bestState;
      var fin = best;
      stats.conflicts = fin.conflicts; stats.makespan = fin.makespan; stats.substitutes = fin.substitutes;
      stats.toolChanges = fin.toolChanges; stats.objective = fin.objective;
      stats.phase = 'done'; stats.done = true;
    }
    var gen = search();

    function result() {
      if (!stats.done) return { status: 'running', stats: copyStats() };
      var reasons = [], seen = {};
      state.assign.forEach(function (a, s) {
        if (a) return;
        var r = explain(s);
        if (!seen[r]) { seen[r] = 1; reasons.push(r); }
      });
      best.reasons.forEach(function (r) { if (!seen[r]) { seen[r] = 1; reasons.push(r); } });
      return {
        status: reasons.length ? 'unsat' : 'solved',
        schedule: best.schedule,
        reasons: reasons,
        unfilled: state.assign.map(function (a, s) { return a ? null : slots[s].id; }).filter(function (x) { return x != null; }),
        zones: best.zoneLog,
        stats: copyStats()
      };
    }
    function copyStats() { var o = {}; for (var kk in stats) o[kk] = stats[kk]; return o; }

    return {
      /** Run the solver for up to budgetMs (default options.sliceMs). Resumable. */
      step: function (budgetMs) {
        var budget = budgetMs == null ? opt.sliceMs : budgetMs;
        var t0 = now();
        if (!stats.done) {
          stats.slices++;
          var r;
          do { r = gen.next(); } while (!r.done && now() - t0 < budget);
        }
        stats.elapsedMs += now() - t0;
        return result();
      },
      /** Run to completion synchronously (tests / offline). */
      solve: function () {
        var t0 = now();
        while (!stats.done) gen.next();
        stats.elapsedMs += now() - t0;
        return result();
      },
      stats: copyStats,
      get done() { return stats.done; },
      slots: slots,
      result: result
    };
  }

  /** Convenience: plan in one call. */
  function plan(input) { return createPlanner(input).solve(); }

  /** Check a schedule against zone exclusivity; returns list of violations (empty = ok). */
  function zoneViolations(res) {
    var out = [];
    (res.zones || []).forEach(function (z) {
      var L = z.intervals;
      for (var i = 0; i < L.length; i++) for (var j = i + 1; j < L.length; j++) {
        if (L[i].armId !== L[j].armId && L[i].t0 < L[j].t1 - 1e-9 && L[j].t0 < L[i].t1 - 1e-9) {
          out.push(z.zone + ': ' + L[i].armId + ' ' + L[i].what + ' overlaps ' + L[j].armId + ' ' + L[j].what);
        }
      }
    });
    return out;
  }

  return {
    createPlanner: createPlanner,
    plan: plan,
    layoutSlots: layoutSlots,
    computeOcclusion: computeOcclusion,
    sphereShellReach: sphereShellReach,
    zoneViolations: zoneViolations,
    SUBSTITUTES: SUBSTITUTES,
    GRASP_TOOL: GRASP_TOOL,
    DEFAULTS: DEFAULTS,
    _mulberry32: mulberry32
  };
});
