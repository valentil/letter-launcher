// Letter Launcher — src/scenes/rocket/flight.js (LLF-82)
// Visual + game glue between the MOON ROCKET scene and the staged-flight model. Classic <script>: exposes
// window.RocketFlight. Every entry point is called from src/scenes/moon_rocket.js inside try/catch and does
// nothing until the three CAD models (moon_rocket, launch_tower, lunar_lander) have loaded, so the original
// arcade rocket keeps working offline or when a GLB fails.
//
//   attach(st, ctx)        load assets/cad/rocket_stages.json + the three GLBs, split the rocket into stage nodes,
//                          put the umbilical tower on the pad (swing arms get pivot groups at their hinges)
//   launch(st, ctx)        LAUNCH: fresh RocketAscent flight, tower arms swing away
//   tick(st, ctx, ts)      per frame while ascending: step the ascent sim (true = the sim is driving the climb)
//   stage(st, ctx)         STAGE: RocketAscent.stageNow -> separate + tumbling stage, or the early-staging penalty
//   land(st, ctx)          LAND / LEGS: swap to the lander and deploy the legs (touchdown waits for them)
//   frame(st, ctx, ts)     per frame: advance the tumbling stages (cannon.js bodies)
//
// Scale: the CAD rocket is 110 m tall; the scene shows it at 0.035 (3.9 units), standing on the 14.7 m launch platform.
(function (root) {
    'use strict';
    var SCALE = 0.035, BASE_Y = -0.6855, LSCALE = 0.14;
    var WARP = 20, SLOW = 3, WINDOW = 0.10, ARM_MS = 1500, LEG_MS = 1200, VISUAL_T = 3, LIFE_S = 5;
    var STOW_LEG = 2.0;

    function RA() { return root.RocketAscent; }
    function warn(m, e) { try { console.warn('[RocketFlight] ' + m, e && e.message ? e.message : (e || '')); } catch (_) { } }
    function say(m, ms) { try { if (typeof gameMsg === 'function') gameMsg(m, ms); } catch (_) { } }
    function beep(f, d, t, v) { try { if (typeof gameBeep === 'function') gameBeep(f, d, t || 'sine', v || 0.15); } catch (_) { } }

    // Scene altitude from real altitude (m): 1 unit = 28.6 m up to the tower top, then logarithmic up to 7 units at 185 km.
    function altScene(h) {
        if (h <= 130) return Math.max(0, h) * 0.035;
        return Math.min(7, 4.55 + 2.45 * Math.log(h / 130) / Math.log(185000 / 130));
    }

    function attach(st, ctx) {
        var rf = st.rf = { ready: false, table: null, active: false, fl: null, model: null, lander: null, tower: null, arms: [], legs: [], prim: [],
                           names: {}, gone: {}, tumblers: [], seenSep: 0, seenJet: 0, announced: {}, inserted: false, legsDeployed: false, landerOn: false, sb: null };
        try {
            if (!RA() || typeof AssetLib === 'undefined' || typeof THREE === 'undefined') return;
            rf.table = RA().DEFAULT_TABLE;
            if (typeof fetch === 'function') {
                fetch('assets/cad/rocket_stages.json').then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (j) { if (j && j.stages && j.stages.length === 3) rf.table = j; }).catch(function () { });
            }
            Promise.all([AssetLib.load('moon_rocket'), AssetLib.load('launch_tower'), AssetLib.load('lunar_lander')]).then(function (m) {
                if (st.rf !== rf || (typeof currentScene !== 'undefined' && currentScene !== 'moon_rocket')) return;
                try { build(st, ctx, rf, m[0], m[1], m[2]); } catch (e) { warn('model build failed; keeping the arcade rocket', e); }
            });
        } catch (e) { warn('attach failed', e); }
    }

    function build(st, ctx, rf, rocket, tower, lander) {
        if (!(rocket.getObjectByName('s1_stage') && tower.getObjectByName('swing_arm_1') && lander.getObjectByName('leg_1'))) {
            warn('CAD models unavailable (fallback props); keeping the arcade rocket'); return;
        }
        var table = rf.table;
        // ---- rocket: hide the arcade primitives, keep the strobe
        ctx.rocket.children.slice().forEach(function (c) { if (c !== st.strobe) { c.visible = false; rf.prim.push(c); } });
        rocket.scale.setScalar(SCALE); rocket.position.y = BASE_Y;
        ctx.rocket.add(rocket); rf.model = rocket;
        st.strobe.position.y = 3.3; st.flameDrop = 0.75;
        table.stages.forEach(function (s) { s.nodes.forEach(function (n) { rf.names[n] = true; }); });
        (table.events || []).forEach(function (e) { (e.nodes || []).forEach(function (n) { rf.names[n] = true; }); });
        ((table.payload && table.payload.cadNodes) || []).forEach(function (n) { rf.names[n] = true; });
        // ---- tower on the pad (child of the pad so it shares its radial orientation); arms get hinge pivots
        tower.scale.setScalar(SCALE); tower.position.y = 0.25; ctx.pad.add(tower); ctx.pad.material.visible = false; rf.tower = tower;
        var armDefs = (table.tower && table.tower.arms) || [1, 2, 3, 4].map(function (i) { return { node: 'swing_arm_' + i, hingeGlbM: [10, 30 + 25 * i, -1.2], retractRad: -Math.PI / 2 }; });
        armDefs.forEach(function (a) {
            var obj = tower.getObjectByName(a.node); if (!obj || !obj.parent) return;
            var pv = new THREE.Group(), h = a.hingeGlbM;                                  // GLB (x, y, z) m -> kernel mm (x, -z, y)
            pv.position.set(h[0] * 1000, -h[2] * 1000, h[1] * 1000);
            var parent = obj.parent; parent.add(pv);
            obj.position.sub(pv.position); pv.add(obj);
            rf.arms.push({ pivot: pv, retract: a.retractRad });
        });
        // ---- lander (hidden until LAND): legs pivot on their hinges, stowed by default
        lander.scale.setScalar(LSCALE); lander.position.y = BASE_Y; lander.visible = false; ctx.rocket.add(lander); rf.lander = lander;
        // fallback (JSON not fetched): the four hinges from the manifest joints, 2.1 m out and 1.5 m up, axis = radial x Y
        var legDefs = (table.lander && table.lander.legs) || [[1, 0, 0, 0, 0, 1], [0, 0, -1, 1, 0, 0], [-1, 0, 0, 0, 0, -1], [0, 0, 1, -1, 0, 0]].map(function (d, i) {
            return { node: 'leg_' + (i + 1), hingeGlbM: [d[0] * 2.1, 1.5, d[2] * 2.1], axisGlb: [d[3], d[4], d[5]], stowedRad: STOW_LEG };
        });
        legDefs.forEach(function (lg) {
            var obj = lander.getObjectByName(lg.node); if (!obj || !obj.parent) return;
            var h = lg.hingeGlbM, ax = lg.axisGlb;
            var pv = new THREE.Group(); pv.position.set(h[0] * 1000, -h[2] * 1000, h[1] * 1000);
            var axis = new THREE.Vector3(ax[0], -ax[2], ax[1]).normalize();
            var parent = obj.parent; parent.add(pv); obj.position.sub(pv.position); pv.add(obj);
            rf.legs.push({ pivot: pv, axis: axis, stow: lg.stowedRad != null ? lg.stowedRad : STOW_LEG });
        });
        setLegs(rf, 1);
        setArms(rf, 0);
        rf.ready = true;
    }

    function setArms(rf, k) { rf.arms.forEach(function (a) { a.pivot.rotation.z = a.retract * k; }); }
    function setLegs(rf, stowK) { rf.legs.forEach(function (l) { l.pivot.quaternion.setFromAxisAngle(l.axis, l.stow * stowK); }); }
    function ease(k) { return k * k * (3 - 2 * k); }
    function ready(st) { return !!(st.rf && st.rf.ready); }

    function showRocket(rf, on) {
        rf.model.visible = on; rf.lander.visible = !on; rf.landerOn = !on;
    }

    function launch(st, ctx) {
        var rf = st.rf; if (!ready(st)) return;
        clearTumblers(rf);
        showRocket(rf, true);
        rf.model.traverse(function (o) { if (rf.names[o.name]) o.visible = true; });
        rf.gone = {}; rf.announced = {}; rf.inserted = false; rf.legsDeployed = false; setLegs(rf, 1);
        rf.fl = RA().create(rf.table, { stageWindow: WINDOW }); RA().ignite(rf.fl);
        rf.seenSep = 0; rf.seenJet = 0; rf.active = true; st.staged = false;
        tween(ARM_MS, function (k) { setArms(rf, ease(k)); });
        say('IGNITION. Hold-downs release — the tower arms swing clear…');
    }

    function handleSeparation(st, ctx, rec, auto) {
        var rf = st.rf, fl = rf.fl;
        spawnTumbler(st, ctx, rec, rec.nodes, 'stage');
        rec.nodes.forEach(function (n) { hide(rf, n); });
        if (auto) { say(rec.id + ' timed out and the interlock released it (late staging).'); st.staged = true; }
        try { puffBurst(ctx.rocket.position.clone(), 0xffffff, 14, 1.2, { decay: 0.03 }); } catch (_) { }
    }
    function hide(rf, name) { rf.gone[name] = true; var o = rf.model.getObjectByName(name); if (o) o.visible = false; }

    function spawnTumbler(st, ctx, rec, nodes, tag) {
        var rf = st.rf, fl = rf.fl, SB = root.StageBodies;
        var keep = {}; nodes.forEach(function (n) { if (!rf.gone[n]) keep[n] = true; });
        var chunk = rf.model.clone(true);
        chunk.traverse(function (o) { if (rf.names[o.name]) o.visible = !!keep[o.name]; });
        var tbl = null; rf.table.stages.forEach(function (s) { if (s.id === rec.id) tbl = s; });
        var comY = rec.comStackZm != null ? rec.comStackZm : (tbl && tbl.comStackZm != null ? tbl.comStackZm : 20);
        chunk.position.set(0, -comY * SCALE, 0);
        var pivot = new THREE.Group(); pivot.add(chunk);
        pivot.scale.setScalar(1);
        scene.add(pivot);
        var T = { pivot: pivot, item: null, age: 0, comY: comY, y0: 0, tag: tag, ang: 0, omega: 0, accel: fl.accel || 15 };
        var rho = 1.225 * Math.exp(-fl.h / 7200);
        var recP = { dryKg: rec.dryKg, leftoverPropKg: rec.leftoverPropKg || 0, lengthM: rec.lengthM || 4, diameterM: rec.diameterM || 5, comZm: rec.comZm || (rec.lengthM || 4) / 2 };
        if (SB) {
            var p = SB.tumbleParams(recP, tbl, tag === 'stage' ? {} : { offsetM: 0.4, separationDv: 3 });
            T.omega = p.omega.z; T.params = p;
            if (!rf.sb) rf.sb = SB.create();
            if (rf.sb) T.item = rf.sb.spawn(recP, tbl, { pos: { x: 0, y: comY, z: 0 }, rho: rho, accel: Math.min(40, fl.accel || 15) }, tag);
        }
        rf.tumblers.push(T);
        return T;
    }

    function clearTumblers(rf) {
        rf.tumblers.forEach(function (T) { try { scene.remove(T.pivot); } catch (_) { } });
        rf.tumblers = [];
        if (rf.sb) { try { rf.sb.clear(); } catch (_) { } }
    }

    function frame(st, ctx, ts) {
        var rf = st.rf; if (!rf || !rf.tumblers.length) return;
        var dt = (1 / 60) * (ts || 1) * VISUAL_T;
        if (rf.sb) rf.sb.step(dt);
        var rq = ctx.rocket.quaternion, rp = ctx.rocket.position, keep = [];
        rf.tumblers.forEach(function (T) {
            T.age += dt;
            var local = new THREE.Vector3(0, BASE_Y, 0), q = new THREE.Quaternion();
            if (T.item) {
                var b = T.item.body;
                local.x += b.position.x * SCALE; local.y += b.position.y * SCALE; local.z += b.position.z * SCALE;
                q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
            } else {
                local.y += T.comY * SCALE - 0.5 * Math.min(40, T.accel) * T.age * T.age * SCALE;
                q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), T.omega * T.age);
            }
            T.pivot.position.copy(local.applyQuaternion(rq).add(rp));
            T.pivot.quaternion.copy(rq).multiply(q);
            if (T.age > LIFE_S) {
                scene.remove(T.pivot); if (T.item && rf.sb) rf.sb.remove(T.item);
                try { puffBurst(T.pivot.position.clone(), 0xaaaaaa, 6, 0.8, { decay: 0.04 }); } catch (_) { }
            } else keep.push(T);
        });
        rf.tumblers = keep;
    }

    function tick(st, ctx, ts) {
        var rf = st.rf;
        if (!rf || !rf.ready || !rf.active || !rf.fl) return false;
        var fl = rf.fl, A = RA();
        if (fl.inOrbit) {
            if (!rf.inserted) { rf.inserted = true; st.alt = 7; st.phase = 'coast';
                var o = A.orbit(fl);
                say('ORBITAL INSERTION: ' + Math.round(o.perigeeAlt / 1000) + ' x ' + Math.round(o.apogeeAlt / 1000) + ' km. Type ORBIT to circle the moon.', 6000); beep(660, 0.4, 'triangle'); }
            return false;
        }
        var s = A.currentStage(fl), frac = s ? s.prop / s.prop0 : 1, last = fl.stageIdx === fl.stages.length - 1;
        var slow = s && !last && frac <= WINDOW * 1.6;
        var dtSim = (slow ? SLOW : WARP) * (1 / 60) * (ts || 1);
        A.step(fl, dtSim);
        while (rf.seenSep < fl.separated.length) handleSeparation(st, ctx, fl.separated[rf.seenSep++], true);
        while (rf.seenJet < fl.jettisoned.length) {
            var j = fl.jettisoned[rf.seenJet++], nodes = j.nodes || [];
            var rec = { id: j.id, dryKg: j.kg, leftoverPropKg: 0, lengthM: j.id === 'les' ? 9 : 3.9, diameterM: j.id === 'les' ? 1.4 : 10.1, comZm: j.id === 'les' ? 4.5 : 2 };
            rec.comStackZm = j.id === 'les' ? 108 : 44;
            spawnTumbler(st, ctx, rec, nodes, 'part');
            nodes.forEach(function (n) { hide(rf, n); });
            say(j.id === 'les' ? 'Launch escape tower jettisoned.' : 'Interstage skirt jettisoned.');
        }
        if (s && !last && frac <= WINDOW && !rf.announced[fl.stageIdx]) { rf.announced[fl.stageIdx] = true; say(s.id + ' is nearly dry — STAGE now!', 4000); beep(880, 0.15, 'square', 0.12); }
        if (fl.crashed) { rf.active = false; st.phase = 'landing'; say('The stack fell back to the moon — auto-return engaged.'); return true; }
        st.alt = altScene(fl.h);
        // downrange drift: the arc the rocket flies, from the inertial position
        var ang = Math.atan2(fl.x, fl.y);
        st.th = st.padTh + st.dir * ang * 1.0;
        if (fl.thrustN > 0) { ctx.flame(0.16); ctx.flame(0.12); }
        return true;
    }

    function stage(st, ctx) {
        var rf = st.rf; if (!ready(st) || !rf.active || !rf.fl) return false;
        var fl = rf.fl, A = RA();
        if (!A.currentStage(fl)) { say('Every stage is already away.'); return true; }
        var r = A.stageNow(fl);
        if (r.ok) {
            rf.seenSep = fl.separated.length;
            handleSeparation(st, ctx, r.stage, false);
            st.staged = true;
            beep(300, 0.3, 'square');
            say(r.stage.id + ' away! Mass down ' + Math.round(r.massDropKg / 1000) + ' t to ' + Math.round(r.massAfter / 1000) + ' t' + (A.currentStage(fl) ? ' — ' + A.currentStage(fl).id + ' lights in a few seconds.' : '.'));
            return true;
        }
        if (r.early) {
            beep(150, 0.4, 'sawtooth', 0.2);
            say('EARLY STAGING! ' + r.stage + ' still has ' + Math.round(r.propFraction * 100) + '% propellant — interlock refused, ' + Math.round(r.lostPropKg / 1000) + ' t vented. Wait for burnout. (penalty ' + fl.penalties.early + ')', 5000);
            return true;
        }
        return false;
    }

    function land(st, ctx) {
        var rf = st.rf; if (!ready(st) || rf.landerOn) return;
        rf.active = false;
        showRocket(rf, false); rf.legsDeployed = false; setLegs(rf, 1);
        say('Lander on the pad approach — legs deploying…');
        tween(LEG_MS, function (k) { setLegs(rf, 1 - ease(k)); }, function () { rf.legsDeployed = true; say('Legs down and locked.'); beep(520, 0.2, 'triangle', 0.12); });
    }
    function legsReady(st) { var rf = st.rf; return !ready(st) || !rf.landerOn || rf.legsDeployed; }

    function attitude(st, rad, tan) {
        var rf = st.rf; if (!rf || !rf.active || !rf.fl || rf.fl.inOrbit || st.phase !== 'ascent') return null;
        var p = Math.max(0, Math.min(90, rf.fl.pitchDeg)) * Math.PI / 180;
        return rad.clone().multiplyScalar(Math.sin(p)).addScaledVector(tan, Math.cos(p)).normalize();
    }

    function status(st) {
        var rf = st.rf; if (!rf || !rf.active || !rf.fl) return '';
        var fl = rf.fl, s = RA().currentStage(fl);
        return ' · ' + (s ? s.id + ' ' + Math.round(100 * s.prop / s.prop0) + '%' : 'coast') + ' · ' + (fl.h / 1000).toFixed(1) + ' km · ' + (RA().speed(fl) / 1000).toFixed(2) + ' km/s · ' + Math.round(RA().totalMass(fl) / 1000) + ' t';
    }

    root.RocketFlight = { attach: attach, launch: launch, tick: tick, stage: stage, land: land, frame: frame, attitude: attitude, status: status, legsReady: legsReady, ready: ready, altScene: altScene,
                          constants: { SCALE: SCALE, BASE_Y: BASE_Y, WARP: WARP, SLOW: SLOW, WINDOW: WINDOW } };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.RocketFlight;
})(typeof window !== 'undefined' ? window : this);
