// Letter Launcher — src/scenes/waterworks/station.js (LLF-84)
// The WATERWORKS pump station: CAD pipes / elbows / flange joints / gate valves (WaterParts, one
// InstancedMesh per part type) wired to the hydraulic solver (WaterNet). Levels 2 and 3 of the scene
// use it: the Hardy-Cross network is re-solved when a valve or the motor toggles (never per frame);
// flow drives the particle density in the pipes, the gauge needle and the fountain height.
// Classic <script>: window.WaterStation. plan()/layouts() are pure and exported for node tests.
(function (root) {
    'use strict';
    var WP = root.WaterParts || (typeof require !== 'undefined' ? require('./parts.js') : null);
    var WN = root.WaterNet || (typeof require !== 'undefined' ? require('./network.js') : null);
    var PER_RUN = 36, PER_JET = 40, PMAX = 24;

    // ---- layouts: polylines per hydraulic edge (scene units), valves, jets -------------------
    function layouts(F) {
        var yb = F + 0.9, Z = 2.5;
        function p(x, y) { return [x, y, Z]; }
        return [
            { // LEVEL 2: header tank -> two parallel mains (each with a gate valve) -> fountain
                runs: [
                    { edge: 'feed', pts: [p(-11, F + 5.2), p(-11, yb), p(-7, yb)] },
                    { edge: 'mainA', pts: [p(-7, yb), p(-7, yb + 2.8), p(2, yb + 2.8), p(2, yb)], valves: [{ id: 'mainA', seg: 1, at: 0.45 }] },
                    { edge: 'mainB', pts: [p(-7, yb), p(2, yb)], valves: [{ id: 'mainB', seg: 0, at: 0.45 }] },
                    { edge: 'nozzle', pts: [p(2, yb), p(6, yb), p(6, yb + 2.6)] }
                ],
                jets: [{ node: 'FOUNT', at: p(6, yb + 2.6) }],
                junctions: [p(-7, yb), p(2, yb)], gaugeAt: p(2, yb), gaugeNode: 'J2',
                tank: p(-11, F + 6.4), pump: null
            },
            { // LEVEL 3: sump -> pump -> trunk -> two fountain branches + a return bypass
                runs: [
                    { edge: 'pump', pts: [p(-10, yb), p(-6.5, yb)] },
                    { edge: 'trunk', pts: [p(-6.5, yb), p(-2, yb)] },
                    { edge: 'br1', pts: [p(-2, yb), p(-2, yb + 2.6), p(4, yb + 2.6), p(4, yb + 3.4)], valves: [{ id: 'br1', seg: 1, at: 0.5 }] },
                    { edge: 'br2', pts: [p(-2, yb), p(8, yb), p(8, yb + 1.4)], valves: [{ id: 'br2', seg: 0, at: 0.55 }] },
                    { edge: 'bypass', pts: [p(-6.5, yb), p(-6.5, yb + 4.2), p(-10, yb + 4.2), p(-10, yb + 1.4)], valves: [{ id: 'bypass', seg: 1, at: 0.5 }] }
                ],
                jets: [{ node: 'FOUNT1', at: p(4, yb + 3.4) }, { node: 'FOUNT2', at: p(8, yb + 1.4) }],
                junctions: [p(-6.5, yb), p(-2, yb)], gaugeAt: p(-2, yb), gaugeNode: 'J2',
                tank: null, pump: p(-8.2, yb)
            }
        ];
    }
    function plan(layout) {
        var P = { spools: [], elbows: [], joints: [], valves: [] };
        layout.runs.forEach(function (run) {
            var L = WP.layout(run.pts);
            L.elbows.forEach(function (e) { P.elbows.push(e); });
            L.segs.forEach(function (seg, si) {
                var gaps = [];
                (run.valves || []).forEach(function (v) {
                    if (v.seg === si) gaps.push({ at: seg.length * v.at, len: WP.VALVE_LEN * WP.S, kind: 'valve', id: v.id });
                });
                WP.autoJoints(seg, gaps, 3).forEach(function (g) { gaps.push(g); });
                var cut = WP.cutRun(seg, gaps);
                cut.pieces.forEach(function (pc) { P.spools.push({ a: pc.a, b: pc.b, edge: run.edge }); });
                cut.items.forEach(function (it) { (it.kind === 'valve' ? P.valves : P.joints).push(it); });
            });
        });
        return P;
    }
    function runLength(pts) { var L = 0; for (var i = 0; i < pts.length - 1; i++) L += WP.len(WP.sub(pts[i + 1], pts[i])); return L; }
    function pointAt(pts, d) {
        for (var i = 0; i < pts.length - 1; i++) {
            var l = WP.len(WP.sub(pts[i + 1], pts[i]));
            if (d <= l || i === pts.length - 2) { var t = l ? Math.min(1, d / l) : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t]; }
            d -= l;
        }
        return pts[pts.length - 1];
    }
    function jetHeight(lps) { return lps < 0.3 ? 0 : 6 * Math.sqrt(lps / PMAX); }

    var api = { layouts: layouts, plan: plan, runLength: runLength, pointAt: pointAt, jetHeight: jetHeight, PMAX: PMAX };

    // ---- THREE side ---------------------------------------------------------------------------
    api.create = function (o) {
        var T = THREE, scene = o.scene, F = o.F;
        var lays = layouts(F), plans = lays.map(plan);
        function cap(k) { return Math.max(1, Math.max.apply(null, plans.map(function (p) { return p[k].length; }))); }
        var group = new T.Group(); group.visible = false; scene.add(group);
        var H = {
            spool: WP.instanced('pipe_spool', cap('spools'), group), elbow: WP.instanced('elbow_90', cap('elbows'), group),
            joint: WP.instanced('flange_joint', cap('joints'), group), body: WP.instanced('gate_valve_body', cap('valves'), group),
            stem: WP.instanced('gate_valve_stem', cap('valves'), group)
        };
        var hide = new T.Matrix4().makeScale(0, 0, 0);
        var maxRuns = Math.max.apply(null, lays.map(function (l) { return l.runs.length; }));
        var nPart = PER_RUN * maxRuns + PER_JET * 2;
        var pm = new T.InstancedMesh(new T.SphereGeometry(0.09, 6, 5), new T.MeshBasicMaterial({ color: 0x59b7ff }), nPart);
        pm.frustumCulled = false; group.add(pm);
        var tmpM = new T.Matrix4();
        for (var i = 0; i < nPart; i++) pm.setMatrixAt(i, hide);

        // static decor, one group per stage
        var iron = new T.MeshStandardMaterial({ color: 0x1a478c, metalness: 0.3, roughness: 0.5 });
        var steel = new T.MeshStandardMaterial({ color: 0x8c93a0, metalness: 0.8, roughness: 0.35 });
        var decor = lays.map(function (lay) {
            var g = new T.Group(); g.visible = false; group.add(g);
            lay.junctions.forEach(function (j) { var s = new T.Mesh(new T.SphereGeometry(0.42, 12, 10), iron); s.position.set(j[0], j[1], j[2]); g.add(s); });
            if (lay.tank) {
                var t = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 2.2, 16), new T.MeshStandardMaterial({ color: 0x6e8291, metalness: 0.5, roughness: 0.5 }));
                t.position.set(lay.tank[0], lay.tank[1], lay.tank[2]); g.add(t);
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) {
                    var leg = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 5.3, 6), steel);
                    leg.position.set(lay.tank[0] + q[0] * 1.1, F + 2.65, lay.tank[2] + q[1] * 1.1); g.add(leg);
                });
            }
            if (lay.pump) {
                var base = new T.Mesh(new T.BoxGeometry(2.6, 0.3, 1.4), steel); base.position.set(lay.pump[0], F + 0.15, lay.pump[2]); g.add(base);
                var volute = new T.Mesh(new T.CylinderGeometry(0.75, 0.75, 0.9, 16), iron);
                volute.rotation.x = Math.PI / 2; volute.position.set(lay.pump[0] - 0.5, lay.pump[1], lay.pump[2]); g.add(volute);
                var motor = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 1.5, 14), new T.MeshStandardMaterial({ color: 0xb03a2e, metalness: 0.4, roughness: 0.5 }));
                motor.rotation.z = Math.PI / 2; motor.position.set(lay.pump[0] + 0.9, lay.pump[1], lay.pump[2]); g.add(motor);
                var sump = new T.Mesh(new T.BoxGeometry(2.4, 1.4, 2.2), new T.MeshStandardMaterial({ color: 0x4a6a80, transparent: true, opacity: 0.85 }));
                sump.position.set(-10.9, F + 0.7, lay.pump[2]); g.add(sump);
                g.userData.lamp = new T.Mesh(new T.SphereGeometry(0.16, 8, 6), new T.MeshBasicMaterial({ color: 0x334433 }));
                g.userData.lamp.position.set(lay.pump[0] + 0.9, lay.pump[1] + 0.75, lay.pump[2]); g.add(g.userData.lamp);
            }
            // pressure gauge on a stub toward the camera
            var gp = lay.gaugeAt;
            var stub = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 1.4, 8), steel);
            stub.rotation.x = Math.PI / 2; stub.position.set(gp[0], gp[1], gp[2] + 0.7); g.add(stub);
            var dial = new T.Mesh(new T.CylinderGeometry(0.75, 0.75, 0.16, 28), new T.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }));
            dial.rotation.x = Math.PI / 2; dial.position.set(gp[0], gp[1], gp[2] + 1.5); g.add(dial);
            for (var k = 0; k <= 6; k++) {
                var a = (-135 + 45 * k) * Math.PI / 180, tick = new T.Mesh(new T.BoxGeometry(0.05, 0.16, 0.04), new T.MeshBasicMaterial({ color: k >= 5 ? 0xc0392b : 0x222222 }));
                tick.position.set(gp[0] + Math.sin(a) * 0.6, gp[1] + Math.cos(a) * 0.6, gp[2] + 1.6); tick.rotation.z = -a; g.add(tick);
            }
            var piv = new T.Group(); piv.position.set(gp[0], gp[1], gp[2] + 1.64); g.add(piv);
            var needle = new T.Mesh(new T.BoxGeometry(0.06, 0.6, 0.04), new T.MeshBasicMaterial({ color: 0xd62d20 })); needle.position.y = 0.26; piv.add(needle);
            g.userData.needle = piv;
            return g;
        });

        var S = { stage: -1, net: null, valves: [], phase: [], dispQ: {}, jetPhase: [0, 0], needle: -135 * Math.PI / 180, needleTarget: 0, motor: false, solves: 0 };

        function placeAll(si) {
            Object.keys(H).forEach(function (k) { for (var i = 0; i < H[k].count; i++) H[k].mats[i].copy(hide); });
            var P = plans[si];
            P.spools.forEach(function (s, i) { H.spool.mats[i].copy(WP.matSpool(s.a, s.b)); });
            P.elbows.forEach(function (e, i) { H.elbow.mats[i].copy(WP.matElbow(e.corner, e.din, e.dout)); });
            P.joints.forEach(function (j, i) { H.joint.mats[i].copy(WP.matJoint(j.centre, j.dir)); });
            S.valves = P.valves.map(function (v, i) {
                var vv = { id: v.id, centre: v.centre, dir: v.dir, index: i, vis: 0, target: 0 };
                H.body.mats[i].copy(WP.matValve(v.centre, v.dir, 0, 0, false));
                H.stem.mats[i].copy(WP.matValve(v.centre, v.dir, 0, 0, true));
                return vv;
            });
            Object.keys(H).forEach(function (k) { H[k].flush(); });
        }
        function setValveVisual(v) {
            H.stem.place(v.index, WP.matValve(v.centre, v.dir, v.vis, v.vis * 4 * Math.PI, true));
        }
        function applyOpenings() {
            S.valves.forEach(function (v) { var e = S.net.edge(v.id); v.target = e ? (e.opening || 0) : 0; });
        }
        function solve() { S.net.solve(); S.solves++; S.stats = S.net.result(); }

        S.setStage = function (si) {
            si = Math.max(0, Math.min(1, si | 0));
            S.stage = si; S.def = WN.STAGES[si]; S.net = WN.build(S.def); S.motor = false;
            S.def.valves.forEach(function (id) { var e = S.net.edge(id); if (e && id !== 'bypass') S.net.setOpening(id, 0); });
            if (S.def.pump) S.net.setPump(S.def.pump, false);
            group.visible = true; decor.forEach(function (d, i) { d.visible = i === si; });
            S.phase = lays[si].runs.map(function () { return 0; }); S.dispQ = {};
            placeAll(si); solve(); applyOpenings();
            S.valves.forEach(function (v) { v.vis = v.target; setValveVisual(v); });
        };
        S.hide = function () { group.visible = false; S.stage = -1; };
        S.valveIds = function () { return S.def ? S.def.valves.slice() : []; };
        // Step a valve to its next gate position; returns {id, opening}. Solves once.
        S.cycle = function (n) {
            var id = S.valveIds()[n]; if (!id) return null;
            var cur = S.net.edge(id).opening || 0, steps = WN.STEPS, ix = 0;
            for (var i = 0; i < steps.length; i++) if (Math.abs(steps[i] - cur) < 1e-6) ix = i;
            var nxt = steps[(ix + 1) % steps.length];
            S.net.setOpening(id, nxt); solve(); applyOpenings();
            return { id: id, opening: nxt };
        };
        S.setOpening = function (id, o) { S.net.setOpening(id, o); solve(); applyOpenings(); };
        S.toggleMotor = function () {
            if (!S.def || !S.def.pump) return null;
            S.motor = !S.motor; S.net.setPump(S.def.pump, S.motor); solve();
            var lamp = decor[S.stage].userData.lamp; if (lamp) lamp.material.color.setHex(S.motor ? 0x44ff66 : 0x334433);
            return S.motor;
        };
        S.deliveredLps = function (node) { return S.net.delivered(node) * 1000; };
        S.pressure = function () { return S.net.pressure(S.def.gauge); };
        S.goals = function () {
            return S.def.goals.map(function (g) { return { label: g.label, lps: S.deliveredLps(g.node), need: g.minLps, ok: S.deliveredLps(g.node) >= g.minLps }; });
        };
        S.goalsMet = function () { return !!S.net && WN.goalsMet(S.net, S.def); };
        S.openings = function () { return S.valveIds().map(function (id) { return S.net.edge(id).opening || 0; }); };

        S.update = function (dt) {
            if (S.stage < 0 || !group.visible) return;
            dt = Math.min(0.1, dt || 0.016);
            S.valves.forEach(function (v) {
                if (Math.abs(v.target - v.vis) > 1e-3) { v.vis += (v.target - v.vis) * Math.min(1, dt * 4); setValveVisual(v); }
            });
            var res = S.net.result(), lay = lays[S.stage], slot = 0;
            lay.runs.forEach(function (run, ri) {
                var q = res.flows[run.edge] || 0, d = S.dispQ[run.edge] || 0;
                d += (q - d) * Math.min(1, dt * 3); S.dispQ[run.edge] = d;
                var lps = Math.abs(d) * 1000, n = Math.min(PER_RUN, Math.round(lps * 1.4));
                var L = runLength(run.pts) || 1;
                S.phase[ri] = (S.phase[ri] + dt * (1.5 + lps * 0.3) / L * (d >= 0 ? 1 : -1) + 1) % 1;
                for (var k = 0; k < PER_RUN; k++) {
                    if (k < n) {
                        var t = (S.phase[ri] + k / n) % 1, pt = pointAt(run.pts, t * L);
                        tmpM.makeTranslation(pt[0], pt[1], pt[2]); pm.setMatrixAt(ri * PER_RUN + k, tmpM);
                    } else pm.setMatrixAt(ri * PER_RUN + k, hide);
                }
            });
            for (var r = lay.runs.length; r < maxRuns; r++) for (var kk = 0; kk < PER_RUN; kk++) pm.setMatrixAt(r * PER_RUN + kk, hide);
            lay.jets.forEach(function (jet, ji) {
                var lps = S.deliveredLps(jet.node), h = jetHeight(lps), base = PER_RUN * maxRuns + ji * PER_JET;
                S.jetPhase[ji] = (S.jetPhase[ji] + dt * 0.8) % 1;
                for (var k = 0; k < PER_JET; k++) {
                    if (h <= 0) { pm.setMatrixAt(base + k, hide); continue; }
                    var t = (S.jetPhase[ji] + k / PER_JET) % 1, ang = k * 2.399, rr = (0.15 + 0.12 * h) * t * (0.4 + 0.6 * ((k * 0.618) % 1));
                    tmpM.makeTranslation(jet.at[0] + Math.cos(ang) * rr, jet.at[1] + h * 4 * t * (1 - t) + 0.2, jet.at[2] + Math.sin(ang) * rr * 0.6);
                    pm.setMatrixAt(base + k, tmpM);
                }
            });
            for (var j = lay.jets.length; j < 2; j++) for (var k2 = 0; k2 < PER_JET; k2++) pm.setMatrixAt(PER_RUN * maxRuns + j * PER_JET + k2, hide);
            pm.instanceMatrix.needsUpdate = true;
            var target = (-135 + 270 * Math.min(1, S.pressure() / PMAX)) * Math.PI / 180;
            S.needle += (target - S.needle) * Math.min(1, dt * 5);
            decor[S.stage].userData.needle.rotation.z = -S.needle;
        };
        S.parts = H;
        return S;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.WaterStation = api;
    else if (root) root.WaterStation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
