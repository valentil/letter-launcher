// Letter Launcher — src/scenes/flight/flight_model.js
// LLF-81: the FLIGHT SIM flight model. Pure (no THREE, no DOM): 3-DOF point mass in the
// vertical plane (lift, drag, thrust, weight) plus a pitch degree of freedom, flying on the
// aero tables in assets/cad/aircraft_aero.json (built from the CAD light_aircraft). The scene
// steers heading itself; this file owns airspeed, flight-path angle, pitch, altitude, stall,
// flaps, gear drag, the altitude-hold / autothrottle autopilot and the touchdown verdict.
// Classic <script>: declares window.FlightModel only; also require()-able from node tests.

        const FlightModel = (function () {
            // Embedded copy of assets/cad/aircraft_aero.json (minus prose) so the sim flies before
            // the fetch lands and in node. tests/test_llf-81.js asserts it matches the JSON file.
            const DEFAULT_AERO = {"model":"light_aircraft","geometry":{"spanM":11,"chordM":1.5,"areaM2":16.5,"aspectRatio":7.3333,"incidenceDeg":1.5,"macM":1.5,"massKg":1043,"emptyKg":767,"mtowKg":1111,"iyyKgM2":1825},"aoaDeg":[-4,-2,0,2,4,6,8,10,12,14,16,18],"flaps":{"0":{"CL":[-0.0317,0.1267,0.285,0.4433,0.6016,0.7599,0.9183,1.0766,1.2349,1.4304,1.3489,1.1137],"CD":[0.0271,0.0279,0.0314,0.0377,0.0466,0.0583,0.0728,0.0899,0.1097,0.138,0.1618,0.2003],"Cm":[0.073,0.054,0.035,0.016,-0.003,-0.022,-0.041,-0.06,-0.079,-0.098,-0.1894,-0.2324],"stallAoA":15,"CLmax":1.47},"10":{"CL":[0.2183,0.3767,0.535,0.6933,0.8516,1.0099,1.1683,1.3266,1.5152,1.582,1.3228,1.1016],"CD":[0.0376,0.0427,0.0505,0.0611,0.0744,0.0903,0.1091,0.1305,0.1596,0.1811,0.2102,0.2511],"Cm":[0.043,0.024,0.005,-0.014,-0.033,-0.052,-0.071,-0.09,-0.109,-0.1915,-0.2345,-0.2775],"stallAoA":13.7,"CLmax":1.62},"20":{"CL":[0.4183,0.5767,0.735,0.8933,1.0516,1.2099,1.3683,1.534,1.7127,1.5058,1.2306,1.1696],"CD":[0.0585,0.067,0.0783,0.0923,0.109,0.1284,0.1506,0.1767,0.2082,0.2265,0.2557,0.3177],"Cm":[0.013,-0.006,-0.025,-0.044,-0.063,-0.082,-0.101,-0.12,-0.139,-0.2367,-0.2797,-0.3227],"stallAoA":12.4,"CLmax":1.72},"30":{"CL":[0.5683,0.7267,0.885,1.0433,1.2016,1.3599,1.5183,1.7187,1.7365,1.4485,1.224,1.224],"CD":[0.0865,0.0976,0.1115,0.1281,0.1473,0.1693,0.1941,0.2293,0.248,0.2683,0.3057,0.3757],"Cm":[-0.012,-0.031,-0.05,-0.069,-0.088,-0.107,-0.126,-0.145,-0.2293,-0.2723,-0.3153,-0.3583],"stallAoA":11.6,"CLmax":1.8}},"cd0":{"clean":0.027,"gearDown":0.007},"inducedK":0.0543,"liftSlopePerDeg":0.0792,"controls":{"elevatorCmPerDeg":-0.022,"pitchServoHz":0.9,"pitchDamping":0.85},"propulsion":{"maxPowerW":134000,"propEfficiency":0.78,"staticThrustN":2400}};
            const G = 9.81, RHO = 1.225, D2R = Math.PI / 180, KT = 0.514444;

            function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
            function interp(xs, ys, x) {
                if (x <= xs[0]) return ys[0] + (ys[1] - ys[0]) / (xs[1] - xs[0]) * (x - xs[0]);
                const n = xs.length - 1;
                if (x >= xs[n]) return ys[n];
                let i = 0; while (x > xs[i + 1]) i++;
                return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
            }
            // flaps between detents interpolate between the two neighbouring tables
            function flapPair(aero, flaps) {
                const keys = Object.keys(aero.flaps).map(Number).sort((a, b) => a - b);
                const f = clamp(flaps, keys[0], keys[keys.length - 1]);
                let lo = keys[0], hi = keys[keys.length - 1];
                keys.forEach(k => { if (k <= f) lo = k; if (k >= f && hi >= k) hi = k; });
                return { a: aero.flaps[lo], b: aero.flaps[hi], t: hi === lo ? 0 : (f - lo) / (hi - lo) };
            }
            function mix(p, fn) { return fn(p.a) * (1 - p.t) + fn(p.b) * p.t; }

            function coeffs(aero, alphaDeg, flaps, gearDown) {
                const p = flapPair(aero, flaps), A = aero.aoaDeg;
                const CL = mix(p, t => interp(A, t.CL, alphaDeg));
                const CD = mix(p, t => interp(A, t.CD, alphaDeg)) + (gearDown ? aero.cd0.gearDown : 0);
                const Cm = mix(p, t => interp(A, t.Cm, alphaDeg));
                // the linear (pre-stall) moment line, extrapolated from the first two table points
                const CmLin = mix(p, t => t.Cm[0] + (t.Cm[1] - t.Cm[0]) / (A[1] - A[0]) * (alphaDeg - A[0]));
                const stallAoA = mix(p, t => t.stallAoA), CLmax = mix(p, t => t.CLmax);
                return { CL, CD, Cm, cmBreak: Math.min(0, Cm - CmLin), stallAoA, CLmax };
            }
            function vStall(aero, massKg, flaps) {
                const c = coeffs(aero, 0, flaps, false);
                return Math.sqrt(2 * massKg * G / (RHO * aero.geometry.areaM2 * c.CLmax));
            }
            // alpha that gives CL on the linear part of the curve (what the autopilot believes it needs)
            function alphaFor(aero, CL, flaps) {
                const c0 = coeffs(aero, 0, flaps, false);
                return (CL - c0.CL) / aero.liftSlopePerDeg;
            }
            function thrust(aero, throttle, V) {
                const pr = aero.propulsion;
                return clamp(throttle, 0, 1) * Math.min(pr.staticThrustN, pr.propEfficiency * pr.maxPowerW / Math.max(V, 1));
            }

            // Touchdown verdict: speed must be below 1.3 x Vstall for the current flaps, sink below 3 m/s.
            function judgeTouchdown(aero, massKg, flaps, V, sink) {
                const vs = vStall(aero, massKg, flaps), vmax = 1.3 * vs;
                if (sink >= 3) return { ok: false, verdict: 'crash', vs, vmax, V, sink, reason: 'hit at ' + sink.toFixed(1) + ' m/s sink (limit 3)' };
                if (V >= vmax) return { ok: false, verdict: 'bounce', vs, vmax, V, sink, reason: Math.round(V / KT) + ' kt is over 1.3 x Vs = ' + Math.round(vmax / KT) + ' kt' };
                return { ok: true, verdict: 'landed', vs, vmax, V, sink, reason: Math.round(V / KT) + ' kt, ' + sink.toFixed(1) + ' m/s sink' };
            }

            function create(opts) {
                opts = opts || {};
                const aero = opts.aero || DEFAULT_AERO;
                const s = {
                    aero, mass: opts.massKg || aero.geometry.massKg,
                    V: opts.V != null ? opts.V : 0, gamma: 0, theta: 0, q: 0, h: opts.h || 0, x: 0,
                    alpha: 0, flaps: opts.flaps || 0, gear: opts.gear != null ? !!opts.gear : true,
                    throttle: opts.throttle != null ? opts.throttle : 0,
                    onGround: !(opts.h > 0), stalled: false, gustW: 0, buffet: 0, stallCount: 0,
                    // autopilot: altHold (m) | null, speedHold (m/s) | null (manual throttle),
                    // mode 'cruise' | 'takeoff' | 'approach'; approachThrottle for the landing.
                    ap: { altHold: opts.h || 0, speedHold: null, mode: 'cruise', iAlt: 0, iSpd: 0, approachThrottle: 0.05 },
                    touchdown: null, t: 0
                };
                s.coeffs = (alphaDeg) => coeffs(aero, alphaDeg, s.flaps, s.gear);
                s.vStall = () => vStall(aero, s.mass, s.flaps);
                s.trim = function (V, h) { trim(s, V, h); return s; };
                s.step = function (dt) { let n = Math.max(1, Math.ceil(dt / 0.02)); const h = dt / n; while (n--) sub(s, h); return s; };
                s.hdot = () => s.V * Math.sin(s.gamma);
                return s;
            }

            // Level, unaccelerated flight at V: alpha from lift = weight, throttle from thrust = drag.
            function trim(s, V, h) {
                s.V = V; s.h = h; s.gamma = 0; s.q = 0; s.onGround = false;
                let a = 4;
                for (let i = 0; i < 40; i++) {
                    const c = s.coeffs(a), qS = 0.5 * RHO * V * V * s.aero.geometry.areaM2;
                    a += (s.mass * G - qS * c.CL) / (qS * s.aero.liftSlopePerDeg) * 0.8;
                }
                s.alpha = a; s.theta = a * D2R;
                const c = s.coeffs(a), D = 0.5 * RHO * V * V * s.aero.geometry.areaM2 * c.CD;
                const Tmax = thrust(s.aero, 1, V);
                s.throttle = clamp(D / Math.cos(a * D2R) / Tmax, 0, 1);
                s.ap.altHold = h; s.ap.iAlt = 0; s.ap.iSpd = 0;
            }

            function autopilot(s, dt) {
                const ap = s.ap, aero = s.aero, V = Math.max(s.V, 1), hdot = s.V * Math.sin(s.gamma);
                let hdotCmd;
                if (ap.mode === 'approach') {
                    // descend, then flare: sink command eases from -3.2 m/s to -0.6 m/s over the last 8 m
                    hdotCmd = s.h > 60 ? -4 : s.h > 8 ? -3 : -0.5 - 2.5 * (s.h / 8);
                } else if (ap.mode === 'takeoff' && s.onGround) {
                    hdotCmd = 0;
                } else {
                    hdotCmd = clamp(0.22 * ((ap.altHold || 0) - s.h), -6, 5);
                }
                // pitch = flight path the climb rate needs + the alpha the linear lift curve says carries the weight
                const gammaCmd = Math.asin(clamp(hdotCmd / V, -0.35, 0.35));
                const qS = 0.5 * RHO * V * V * aero.geometry.areaM2;
                const alphaNeed = alphaFor(aero, s.mass * G * Math.cos(gammaCmd) / qS, s.flaps);
                ap.iAlt = clamp(ap.iAlt + (hdotCmd - hdot) * dt * 0.004, -0.08, 0.08);
                let thetaCmd = gammaCmd + clamp(alphaNeed, -6, 30) * D2R + ap.iAlt;
                if (ap.mode === 'takeoff' && s.onGround) thetaCmd = s.V > 28 ? 9 * D2R : 0;   // rotate at 55 kt
                // stall break: the wing lets go and the nose drops through the horizon-ish (to just under the
                // stall alpha on the current flight path) for ~1.5 s, then the autopilot pulls again
                if (s.stalled) ap.stallT = 1.5;
                if (ap.stallT > 0) { ap.stallT -= dt; thetaCmd = s.gamma + (s.coeffs(0).stallAoA - 6) * D2R; ap.iAlt = 0; }
                ap.thetaCmd = clamp(thetaCmd, -15 * D2R, 22 * D2R);
                // throttle: autothrottle on a speed target, the approach setting, or whatever was set
                if (ap.mode === 'takeoff') s.throttle = 1;
                else if (ap.mode === 'approach') s.throttle = ap.firewall ? 1 : ap.approachThrottle;
                else if (ap.speedHold != null) {
                    ap.iSpd = clamp(ap.iSpd + (ap.speedHold - s.V) * dt * 0.02, -0.6, 0.6);
                    s.throttle = clamp(0.55 + 0.08 * (ap.speedHold - s.V) + ap.iSpd, 0, 1);
                }
            }

            function sub(s, dt) {
                const aero = s.aero, geo = aero.geometry, m = s.mass;
                autopilot(s, dt);
                const V = Math.max(s.V, 0.5);
                s.alpha = (s.theta - s.gamma) / D2R;
                // a vertical gust (WIND / TURBULENCE) changes the angle the wing meets the air at
                const aEff = s.alpha + Math.atan2(s.gustW || 0, V) / D2R;
                const c = coeffs(aero, aEff, s.flaps, s.gear);
                const qbar = 0.5 * RHO * V * V, S = geo.areaM2;
                const L = qbar * S * c.CL, D = qbar * S * c.CD, T = thrust(aero, s.throttle, V);
                const a = s.alpha * D2R;
                let dV = (T * Math.cos(a) - D) / m - G * Math.sin(s.gamma);
                let dGamma = (L + T * Math.sin(a) - m * G * Math.cos(s.gamma)) / (m * V);
                if (s.onGround) {
                    const N = Math.max(0, m * G - L - T * Math.sin(a));
                    dV -= 0.03 * N / m;                       // rolling friction
                    if (dGamma <= 0) { dGamma = 0; s.gamma = 0; } else s.onGround = false;
                }
                // pitch: attitude servo (elevator + static stability) plus the stall break's nose-down moment
                const ctl = aero.controls, w = 2 * Math.PI * ctl.pitchServoHz;
                const dq = w * w * (s.ap.thetaCmd - s.theta) - 2 * ctl.pitchDamping * w * s.q
                    + c.cmBreak * qbar * S * geo.macM / geo.iyyKgM2;
                s.q += dq * dt; s.theta += s.q * dt;
                s.V = Math.max(0, s.V + dV * dt);
                s.gamma += dGamma * dt;
                const hdot = s.V * Math.sin(s.gamma);
                s.h += hdot * dt; s.x += s.V * Math.cos(s.gamma) * dt; s.t += dt;
                if (s.onGround && s.theta < 0) { s.theta = 0; s.q = Math.max(0, s.q); }
                // stall + buffet
                const was = s.stalled;
                s.stalled = aEff > c.stallAoA;
                if (s.stalled && !was) s.stallCount++;
                s.buffet = clamp((aEff - (c.stallAoA - 2)) / 3, 0, 1);
                // touchdown
                if (s.h <= 0) {
                    if (!s.onGround) s.touchdown = { V: s.V, sink: -hdot, t: s.t, flaps: s.flaps, gear: s.gear };
                    s.h = 0; s.onGround = true; if (s.gamma < 0) s.gamma = 0;
                }
            }

            const api = { DEFAULT_AERO, create, coeffs, vStall, judgeTouchdown, thrust, interp, KT, G, RHO };
            return api;
        })();
        if (typeof window !== 'undefined') window.FlightModel = FlightModel;
        if (typeof module !== 'undefined' && module.exports) module.exports = FlightModel;
