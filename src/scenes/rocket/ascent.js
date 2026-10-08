// Letter Launcher — src/scenes/rocket/ascent.js (LLF-82)
// Pure 2D ascent simulation for the MOON ROCKET three-stage vehicle. No THREE, no DOM: it runs in
// the browser (window.RocketAscent) and under node (module.exports) so tests/test_llf-82.js can fly it.
//
//   const f = RocketAscent.create(table, opts);   // table = assets/cad/rocket_stages.json (or DEFAULT_TABLE)
//   RocketAscent.ignite(f);                        // release the hold-downs
//   RocketAscent.step(f, dt);                      // advance dt seconds of flight (sub-stepped inside)
//   RocketAscent.stageNow(f);                      // the STAGE word: ok only near burnout, else an early-staging penalty
//
// Physics: inertial polar frame about the planet centre. Thrust from mass flow x Isp (Isp blends from
// sea-level to vacuum with the density ratio), drag 0.5 rho v^2 Cd A against the rotating atmosphere,
// point-mass gravity. Guidance: vertical rise, a small pitch kick, then a gravity turn through the
// atmosphere; above it a closed-loop altitude hold (thrust steers to null vertical speed) while the
// stages build orbital velocity. Everything is driven by the stage table, whose dry masses and COM
// come from cad_mass_properties via tools/cad/build_rocket_stages.js. Numbers: public Apollo/Saturn V
// references listed in tools/cad/recipes/moon_rocket.json (NASA SP-4206, Saturn V Flight Manual).
// Cd is APPROXIMATE (Mach-independent low-speed value), see table.cd.label.
(function (root) {
    'use strict';
    var G0 = 9.80665;
    var BODIES = {
        earth: { mu: 3.986004418e14, R: 6371000, rho0: 1.225, H: 7200, omega: 7.2921159e-5, targetAlt: 185000, minPerigee: 170000 },
        moon: { mu: 4.9028e12, R: 1737400, rho0: 0, H: 1, omega: 2.6617e-6, targetAlt: 100000, minPerigee: 80000 }
    };

    // Public-reference fallback used until (or without) assets/cad/rocket_stages.json. The JSON, built from
    // the CAD mass properties, overrides every dry mass; tests assert the two agree within a few percent.
    var DEFAULT_TABLE = {
        version: 1,
        body: 'earth',
        cd: { value: 0.35, label: 'approximate: Mach-independent low-speed drag coefficient for a slender launcher' },
        stages: [
            { id: 'S-IC', nodes: ['s1_stage', 's1_f1_c', 's1_f1_1', 's1_f1_2', 's1_f1_3', 's1_f1_4', 's1_fin_1', 's1_fin_2', 's1_fin_3', 's1_fin_4'],
              dryKg: 137000, propKg: 2077000, ispSl: 263, ispVac: 304, burnS: 168, diameterM: 10.1, lengthM: 42.1, comZm: 20, accelLimitG: 4.0, ignitionDelayS: 0 },
            { id: 'S-II', nodes: ['s2_skirt', 's2_j2_c', 's2_j2_1', 's2_j2_2', 's2_j2_3', 's2_j2_4', 's2_stage', 's2_cone'],
              dryKg: 43000, propKg: 427000, ispSl: 395, ispVac: 421, burnS: 395, diameterM: 10.1, lengthM: 24.87, comZm: 12, accelLimitG: 0, ignitionDelayS: 4 },
            { id: 'S-IVB', nodes: ['s3_j2', 's3_stage', 'iu'], dryKg: 17200, propKg: 105300, ispSl: 390, ispVac: 421, burnS: 427, diameterM: 6.6, lengthM: 18.8, comZm: 9, accelLimitG: 0, ignitionDelayS: 4 }
        ],
        events: [
            { id: 's2_skirt', afterStage: 0, delayS: 8, kg: 5000, owner: 1, nodes: ['s2_skirt'] },
            { id: 'les', afterStage: 0, delayS: 30, kg: 4200, owner: 'payload', nodes: ['les'] }
        ],
        payload: { kg: 49160, label: 'SLA + CSM (dry+SPS prop) + LM + LES, Apollo 11 class' },
        guidance: { pitchTable: [[0, 90], [12, 90], [20, 87], [40, 76], [70, 58], [100, 42], [135, 30], [170, 22]], altTargetM: 185000 }
    };

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function body(f) { return f.body; }

    function create(table, opts) {
        table = table || DEFAULT_TABLE; opts = opts || {};
        var B = BODIES[opts.body || table.body || 'earth'];
        var gd = table.guidance || DEFAULT_TABLE.guidance;
        var f = {
            table: table, body: B, t: 0, launched: false, crashed: false, inOrbit: false, cutoff: false,
            x: 0, y: B.R, vx: 0, vy: 0, h: 0, pitchDeg: 90,
            stageIdx: 0, stageWindow: opts.stageWindow != null ? opts.stageWindow : 0.04, autoStageAfterS: opts.autoStageAfterS != null ? opts.autoStageAfterS : 25,
            pitchTable: gd.pitchTable, pitchScale: opts.pitchScale != null ? opts.pitchScale : 0.9, altTargetM: opts.altTargetM || gd.altTargetM || B.targetAlt,
            cd: opts.cd != null ? opts.cd : (table.cd && table.cd.value != null ? table.cd.value : 0.35),
            stages: table.stages.map(function (s) {
                return { id: s.id, nodes: s.nodes || [], dry: s.dryKg, prop0: s.propKg, prop: s.propKg, mdot: s.propKg / s.burnS, ispSl: s.ispSl, ispVac: s.ispVac,
                         diameter: s.diameterM, accelLimitG: s.accelLimitG || 0, ignitionDelay: s.ignitionDelayS || 0, comZm: s.comZm, lengthM: s.lengthM,
                         inertia: s.inertia || null, throttle: 1, burnedOut: false, emptyAt: null };
            }),
            payloadKg: table.payload.kg, pending: (table.events || []).map(function (e) { return Object.assign({ done: false }, e); }),
            sepTimes: {}, separated: [], jettisoned: [], penalties: { early: 0, late: 0, lostPropKg: 0 }, log: [], ignitionAt: 0, accel: 0, thrustN: 0, maxQ: 0, qPa: 0, maxG: 0
        };
        var om = B.omega; f.vx = om * f.y; f.vy = -om * f.x;   // eastward launch-site speed
        return f;
    }

    function logEv(f, ev, extra) { var e = Object.assign({ t: +f.t.toFixed(2), ev: ev, h: Math.round(f.h) }, extra || {}); f.log.push(e); return e; }

    function totalMass(f) {
        var m = f.payloadKg;
        for (var i = f.stageIdx; i < f.stages.length; i++) m += f.stages[i].dry + f.stages[i].prop;
        return m;
    }
    function currentStage(f) { return f.stages[f.stageIdx] || null; }
    function stageMass(f, i) { var s = f.stages[i]; return s ? s.dry + s.prop : 0; }

    function orbit(f) {
        var B = f.body, r = Math.hypot(f.x, f.y), v2 = f.vx * f.vx + f.vy * f.vy, mu = B.mu;
        var eps = v2 / 2 - mu / r, hh = f.x * f.vy - f.y * f.vx;
        if (eps >= 0) return { bound: false, rp: null, ra: null, e: null, a: null };
        var a = -mu / (2 * eps), e = Math.sqrt(Math.max(0, 1 + 2 * eps * hh * hh / (mu * mu)));
        return { bound: true, a: a, e: e, rp: a * (1 - e), ra: a * (1 + e), perigeeAlt: a * (1 - e) - B.R, apogeeAlt: a * (1 + e) - B.R };
    }

    function ignite(f) { if (!f.launched) { f.launched = true; f.ignitionAt = f.t; logEv(f, 'ignite'); } return f; }

    function canStage(f) {
        var s = currentStage(f); if (!s) return false;
        return s.prop <= s.prop0 * f.stageWindow;
    }

    // The STAGE / SEPARATE word. Returns {ok, early, ...}. ok:true only near burnout (propellant <= window of the
    // stage load) or after a cutoff; otherwise the interlock refuses, a little propellant is vented and an early-staging penalty is counted.
    function stageNow(f) {
        var s = currentStage(f);
        if (!s) return { ok: false, reason: 'nothing-to-stage' };
        if (!f.launched) return { ok: false, reason: 'on-pad' };
        var frac = s.prop / s.prop0, last = f.stageIdx === f.stages.length - 1;
        var ready = frac <= f.stageWindow || (last && (f.inOrbit || f.cutoff));
        if (!ready) {
            var lost = s.prop * 0.015; s.prop -= lost;
            f.penalties.early++; f.penalties.lostPropKg += lost;
            logEv(f, 'early-staging', { stage: s.id, propFrac: +frac.toFixed(3), lostPropKg: Math.round(lost) });
            return { ok: false, early: true, reason: 'early-staging', stage: s.id, propFraction: frac, lostPropKg: lost };
        }
        return doSeparate(f, false);
    }

    function doSeparate(f, late) {
        var s = currentStage(f), m0 = totalMass(f);
        var rec = { id: s.id, index: f.stageIdx, t: f.t, dryKg: s.dry, leftoverPropKg: s.prop, massKg: s.dry + s.prop, nodes: s.nodes.slice(), comZm: s.comZm, lengthM: s.lengthM,
                    diameterM: s.diameter, inertia: s.inertia, x: f.x, y: f.y, vx: f.vx, vy: f.vy, late: !!late };
        f.separated.push(rec); f.sepTimes[f.stageIdx] = f.t; f.stageIdx++;
        var nxt = currentStage(f);
        if (nxt) f.ignitionAt = f.t + nxt.ignitionDelay;
        if (late) f.penalties.late++;
        logEv(f, late ? 'auto-staged-late' : 'separated', { stage: s.id, massDropKg: Math.round(m0 - totalMass(f)) });
        return { ok: true, early: false, late: !!late, stage: rec, massBefore: m0, massAfter: totalMass(f), massDropKg: m0 - totalMass(f) };
    }

    function runEvents(f) {
        for (var i = 0; i < f.pending.length; i++) {
            var e = f.pending[i]; if (e.done) continue;
            var ts = f.sepTimes[e.afterStage];
            if (ts == null || f.t < ts + e.delayS) continue;
            e.done = true;
            if (e.owner === 'payload') f.payloadKg -= e.kg;
            else if (f.stages[e.owner] && e.owner >= f.stageIdx) f.stages[e.owner].dry -= e.kg;
            f.jettisoned.push({ id: e.id, t: f.t, kg: e.kg, nodes: e.nodes || [] });
            logEv(f, 'jettison', { id: e.id, kg: e.kg });
        }
    }

    function pitchAt(f, t) {
        var tab = f.pitchTable, k = f.pitchScale;
        if (t <= tab[0][0]) return 90;
        for (var i = 1; i < tab.length; i++) if (t <= tab[i][0]) {
            var a = tab[i - 1], b = tab[i], u = (t - a[0]) / (b[0] - a[0]);
            return 90 - (90 - (a[1] + (b[1] - a[1]) * u)) * k;
        }
        return 90 - (90 - tab[tab.length - 1][1]) * k;
    }

    function stepOnce(f, dt) {
        var B = f.body, r = Math.hypot(f.x, f.y), rx = f.x / r, ry = f.y / r;
        var tx = ry, ty = -rx;                       // eastward tangent
        f.h = r - B.R;
        var vr = f.vx * rx + f.vy * ry, vt = f.vx * tx + f.vy * ty;
        var m = totalMass(f), s = currentStage(f);
        // ---- thrust
        var thrust = 0, mdotNow = 0, dirx = rx, diry = ry;
        var burning = f.launched && s && !f.cutoff && f.t >= f.ignitionAt && s.prop > 0;
        var airx = B.omega * f.y, airy = -B.omega * f.x;
        var vrelx = f.vx - airx, vrely = f.vy - airy, vrel = Math.hypot(vrelx, vrely);
        var rho = B.rho0 * Math.exp(-Math.max(0, f.h) / B.H);
        if (burning) {
            var dens = B.rho0 > 0 ? Math.min(1, rho / B.rho0) : 0;
            var isp = s.ispSl + (s.ispVac - s.ispSl) * (1 - dens);
            var level = 1;
            if (s.accelLimitG > 0) { var aFull = s.mdot * isp * G0 / m; if (aFull > s.accelLimitG * G0) level = 0.8; }
            mdotNow = s.mdot * level;
            if (mdotNow * dt > s.prop) mdotNow = s.prop / dt;
            thrust = mdotNow * isp * G0;
            // steering
            var up = f.stageIdx === 0;
            if (up) {
                // programmed pitch (degrees above the local horizon) against time since ignition: vertical rise, kick, long pitch-over
                var pa = pitchAt(f, f.t - f.ignitionAt) * Math.PI / 180;
                dirx = rx * Math.sin(pa) + tx * Math.cos(pa); diry = ry * Math.sin(pa) + ty * Math.cos(pa);
            } else {
                var aT = thrust / m, g = B.mu / (r * r);
                var vzDes = clamp((f.altTargetM - f.h) / 60, -60, 220);
                var arReq = (vzDes - vr) / 25 + g - vt * vt / r;
                var sinT = clamp(arReq / Math.max(aT, 1e-6), -0.97, 0.97), cosT = Math.sqrt(1 - sinT * sinT);
                dirx = rx * sinT + tx * cosT; diry = ry * sinT + ty * cosT;
            }
            f.pitchDeg = Math.asin(clamp(dirx * rx + diry * ry, -1, 1)) * 180 / Math.PI;
        }
        // ---- drag
        var ax = -B.mu * rx / (r * r), ay = -B.mu * ry / (r * r);
        if (rho > 1e-9 && vrel > 0) {
            var A = Math.PI * Math.pow((s ? s.diameter : 6.6) / 2, 2), q = 0.5 * rho * vrel * vrel;
            var drag = q * f.cd * A; f.qPa = q; if (q > f.maxQ) f.maxQ = q;
            ax -= drag / m * vrelx / vrel; ay -= drag / m * vrely / vrel;
        }
        ax += thrust / m * dirx; ay += thrust / m * diry;
        f.accel = thrust / m; f.thrustN = thrust; var gl = Math.hypot(ax + B.mu * rx / (r * r), ay + B.mu * ry / (r * r)) / G0; if (gl > f.maxG) f.maxG = gl;
        // ---- integrate (semi-implicit Euler)
        f.vx += ax * dt; f.vy += ay * dt; f.x += f.vx * dt; f.y += f.vy * dt;
        if (burning) {
            s.prop = Math.max(0, s.prop - mdotNow * dt);
            if (s.prop <= 0 && !s.burnedOut) { s.burnedOut = true; s.emptyAt = f.t; logEv(f, 'burnout', { stage: s.id }); }
        }
        f.t += dt;
        f.h = Math.hypot(f.x, f.y) - B.R;
        if (f.launched && f.t > 10 && f.h < 0) { f.crashed = true; logEv(f, 'crash'); }
        // S-IVB cutoff on stable perigee
        if (f.stageIdx === f.stages.length - 1 && !f.cutoff && f.launched) {
            var o = orbit(f);
            if (o.bound && o.perigeeAlt >= B.minPerigee && f.h > 100000) { f.cutoff = true; f.inOrbit = true; logEv(f, 'orbit-insertion', { perigeeKm: Math.round(o.perigeeAlt / 1000), apogeeKm: Math.round(o.apogeeAlt / 1000) }); }
        }
        // a spent stage that nobody separated: auto-stage so the flight can never soft-lock
        var cs = currentStage(f);
        if (cs && cs.burnedOut && f.stageIdx < f.stages.length - 1 && f.t - cs.emptyAt >= f.autoStageAfterS) doSeparate(f, true);
        runEvents(f);
    }

    function step(f, dt) {
        var n = Math.max(1, Math.ceil(dt / 0.1)), h = dt / n;
        for (var i = 0; i < n; i++) { stepOnce(f, h); if (f.crashed) break; }
        return f;
    }

    // Simple autopilot for tests/demos: types STAGE the moment it is allowed.
    function autopilot(f, dt, maxT) {
        dt = dt || 0.25; maxT = maxT || 1500;
        ignite(f);
        while (f.t < maxT && !f.crashed && !f.inOrbit) {
            step(f, dt);
            if (canStage(f) && f.stageIdx < f.stages.length - 1) stageNow(f);
        }
        return f;
    }

    var api = { G0: G0, BODIES: BODIES, DEFAULT_TABLE: DEFAULT_TABLE, create: create, ignite: ignite, step: step, stageNow: stageNow, canStage: canStage,
                totalMass: totalMass, stageMass: stageMass, currentStage: currentStage, orbit: orbit, autopilot: autopilot, speed: function (f) { return Math.hypot(f.vx, f.vy); },
                airSpeed: function (f) { return Math.hypot(f.vx - f.body.omega * f.y, f.vy + f.body.omega * f.x); } };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RocketAscent = api;
})(typeof window !== 'undefined' ? window : this);
