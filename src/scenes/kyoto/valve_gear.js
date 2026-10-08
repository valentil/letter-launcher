// Letter Launcher — src/scenes/kyoto/valve_gear.js
// LLF-83: Walschaerts valve gear + slider-crank solver for the KYOTO TRAIN C57 locomotive.
// PURE (no THREE, no DOM): node-testable; tests/test_llf-83_kyoto_cad.js checks it against the
// cad_sketch_solve fixtures stored in assets/cad/manifest.json (kyoto_c57_motion.fixtures).
//
// Frame: the locomotive's side plane in the CAD kernel frame, millimetres.
//   x = along the loco (+x forward), z = up (rail top = 0). Same numbers as the recipes in
//   tools/cad/recipes/kyoto_c57_*.json, so a solved point IS a CAD point.
// Angles are standard CCW angles in the (x, z) plane. theta = main crank angle (crank pin
// direction from the main axle). Forward running turns the wheels clockwise (theta falls).
// gear in [-1, 1] is the reverser (die block position in the expansion link): +1 full forward.
//
// Linkage (one side; the other side runs the same solve with theta + 90 deg — quartering):
//   A  main axle (fixed)            P  main crank pin       = A + r(cos t, sin t)
//   C  crosshead pin (slider z=zc)   |P-C| = mainRod
//   Q  return-crank pin             = A + rq(cos(t+phiQ), sin(t+phiQ))
//   L0 expansion-link pivot (fixed) F  link foot: |F-L0| = linkFoot, |F-Q| = eccRod
//   Die = L0 + gear*dieMax * unit(L0 - F)            (die block slides in the link)
//   D  combination-lever foot       = C + (0, -leverDrop)   (rigid crosshead arm)
//   E  lever top (radius-rod pin):  |E-D| = leverDE, |E-Die| = radiusRod, E above D
//   V  valve-spindle pin            = D + (E-D) * leverDV/leverDE
        var KyotoValveGear = (function () {
            var GEOM = {
                A: [-1000, 875],            // main (2nd coupled) axle, driver radius 875 (1750 mm wheel)
                coupledAxles: [1000, -1000, -3000],
                driverR: 875,
                r: 330,                     // crank radius = half of the 660 mm stroke
                mainRod: 3000,
                zc: 875,                    // cylinder centreline height (horizontal cylinders)
                rq: 150, phiQ: -Math.PI / 2,
                L0: [500, 1250], linkFoot: 350, linkTop: 350,
                eccRod: 1500,
                dieMax: 200,
                leverDrop: 300, leverDE: 900, leverDV: 760,
                radiusRod: 1550,
                theta0: 0,                  // CAD rest pose: crank pin forward (front dead centre)
                gear0: 1,
                quarter: Math.PI / 2        // right side leads the left by 90 deg
            };

            function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
            function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
            function scl(a, k) { return [a[0] * k, a[1] * k]; }
            function len(a) { return Math.hypot(a[0], a[1]); }
            function ang(a) { return Math.atan2(a[1], a[0]); }

            // Intersections of circle(c0, r0) and circle(c1, r1); returns [p+, p-] or null.
            function circles(c0, r0, c1, r1) {
                var d = sub(c1, c0), dl = len(d);
                if (dl < 1e-9 || dl > r0 + r1 + 1e-9 || dl < Math.abs(r0 - r1) - 1e-9) return null;
                var a = (r0 * r0 - r1 * r1 + dl * dl) / (2 * dl);
                var h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
                var m = add(c0, scl(d, a / dl)), n = [-d[1] / dl, d[0] / dl];
                return [add(m, scl(n, h)), add(m, scl(n, -h))];
            }

            function solve(theta, gear, geom) {
                var G = geom || GEOM;
                if (gear == null) gear = G.gear0;
                var A = G.A;
                var P = add(A, [G.r * Math.cos(theta), G.r * Math.sin(theta)]);
                var dz = G.zc - P[1];
                var C = [P[0] + Math.sqrt(Math.max(0, G.mainRod * G.mainRod - dz * dz)), G.zc];
                var Q = add(A, [G.rq * Math.cos(theta + G.phiQ), G.rq * Math.sin(theta + G.phiQ)]);
                var fs = circles(G.L0, G.linkFoot, Q, G.eccRod);
                if (!fs) return null;
                var F = fs[0][1] < fs[1][1] ? fs[0] : fs[1];          // foot hangs below the pivot
                var u = scl(sub(G.L0, F), 1 / G.linkFoot);
                var Die = add(G.L0, scl(u, gear * G.dieMax));
                var D = [C[0], C[1] - G.leverDrop];
                var es = circles(D, G.leverDE, Die, G.radiusRod);
                if (!es) return null;
                var E = es[0][1] > es[1][1] ? es[0] : es[1];          // lever stands up from D
                var V = add(D, scl(sub(E, D), G.leverDV / G.leverDE));
                var LT = add(G.L0, scl(u, G.linkTop));
                return { theta: theta, gear: gear, A: A, P: P, C: C, Q: Q, F: F, Die: Die, D: D, E: E, V: V, LT: LT,
                    // part angles (CCW, rad) for rigid-body posing
                    mainRodAng: ang(sub(C, P)), eccRodAng: ang(sub(F, Q)), linkAng: ang(sub(F, G.L0)),
                    radiusRodAng: ang(sub(E, Die)), leverAng: ang(sub(E, D)) };
            }

            // Rigid 2-D poses of every moving part relative to the CAD rest pose:
            // { part: { p0:[x,z], p1:[x,z], rot: CCW delta (rad) } } — move p0 to p1 and rotate by rot about it.
            // side 'r' runs the quartered crank (theta + quarter) against the right side's own rest pose.
            function poses(theta, gear, side, geom) {
                var G = geom || GEOM;
                var q = side === 'r' ? G.quarter : 0;
                var s = solve(theta + q, gear, G), s0 = solve(G.theta0 + q, G.gear0, G);
                if (!s || !s0) return null;
                var dT = theta - G.theta0;
                var out = {
                    coupling_rod: { p0: s0.P, p1: s.P, rot: 0 },
                    main_rod: { p0: s0.P, p1: s.P, rot: s.mainRodAng - s0.mainRodAng },
                    crosshead: { p0: s0.C, p1: s.C, rot: 0 },
                    return_crank: { p0: G.A, p1: G.A, rot: dT },
                    eccentric_rod: { p0: s0.Q, p1: s.Q, rot: s.eccRodAng - s0.eccRodAng },
                    expansion_link: { p0: G.L0, p1: G.L0, rot: s.linkAng - s0.linkAng },
                    radius_rod: { p0: s0.Die, p1: s.Die, rot: s.radiusRodAng - s0.radiusRodAng },
                    combination_lever: { p0: s0.D, p1: s.D, rot: s.leverAng - s0.leverAng },
                    valve_spindle: { p0: s0.V, p1: [s.V[0], s0.V[1]], rot: 0 }
                };
                return { solved: s, parts: out };
            }

            // Wheel angle from distance rolled (mm): forward = clockwise = theta decreasing.
            function thetaFromDistance(mm, radius) { return -mm / (radius || GEOM.driverR); }

            return { GEOM: GEOM, solve: solve, poses: poses, circles: circles, thetaFromDistance: thetaFromDistance };
        })();
        if (typeof window !== 'undefined') window.KyotoValveGear = KyotoValveGear;
        if (typeof module !== 'undefined' && module.exports) module.exports = KyotoValveGear;
