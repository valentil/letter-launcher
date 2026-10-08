// LLF-102: FLIGHT SIM airfield props, all real CAD assets (tools/cad/recipes/{control_tower,windsock,approach_lights}.json).
//  - control tower: AssetLib.place('control_tower'); the glazed cab node 'cab' glows on the TOWER word
//    (st.towerTop is a thin proxy so the scene's TOWER handler is unchanged).
//  - windsock at both ends of every runway: the 'J_swivel' joint swings the sock downwind. WIND/TURBULENCE
//    picks a new gust direction and the socks swing round to it, then ease back to the prevailing wind.
//  - approach lights: five barrette stations before each threshold run a sequenced "rabbit"; they flash
//    fast on the LAND word and while the aircraft is landing.
// Per-frame work is registered with LLHooks (docs/HOOKS.md), nothing is added to the core files.
(function () {
    'use strict';
    const TOWER_SCALE = 0.55, SOCK_SCALE = 0.55, LIGHT_SCALE = 1.5;   // 1 m = 0.55 world units for the buildings (same as the aircraft); lights are drawn larger so they read from the air
    let cur = null;

    function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

    // Clone each lamp's / the cab's material once so instances sharing a cached GLB don't flash together.
    function bindLamps(slot, out) {
        slot.traverse(function (o) {
            if (!/^lamp_\d$/.test(o.name || '')) return;
            const meshes = [];
            if (o.isMesh) meshes.push(o); else o.traverse(function (c) { if (c.isMesh) meshes.push(c); });
            meshes.forEach(function (m) { if (m.material && m.material.clone) { m.material = m.material.clone(); out.push(m.material); } });
        });
    }

    function build(scene, st, F, runways) {
        const a = { st: st, F: F, tower: null, cabMats: [], glow: 0, socks: [], stations: [], t: 0,
            windBase: 0.6, wind: 0.6, windTarget: 0.6, gustT: 0, flashT: 0, legacy: [] };
        cur = a;
        st.airfield = a;
        // st.towerTop keeps the old contract: material.emissive.setScalar(v) -> the CAD cab glows.
        const legacyTop = st.towerTop;   // primitive cab: still glows when the GLB is missing (offline)
        st.towerTop = { material: { emissive: { setScalar: function (v) { a.glow = v; if (legacyTop && legacyTop.material) legacyTop.material.emissive.setScalar(v); } } } };
        try {
            a.tower = AssetLib.place('control_tower', { x: 7, y: F, z: 4, scale: TOWER_SCALE, lod: false });
            a.tower.rotation.y = -0.5;   // cab faces the runway
        } catch (e) { a.tower = null; }
        (runways || []).forEach(function (rw) {
            const sy = Math.sin(rw.yaw), cy = Math.cos(rw.yaw);       // runway axis (along +z at yaw 0)
            [-1, 1].forEach(function (end) {
                const ex = rw.x + sy * 13 * end, ez = rw.z + cy * 13 * end;
                try {
                    const slot = AssetLib.place('windsock', { x: ex + cy * 5.5, y: F, z: ez - sy * 5.5, scale: SOCK_SCALE, lod: false });
                    a.socks.push({ slot: slot, joint: null, phase: Math.random() * 6 });
                } catch (e) { }
                // lights only on the approach side: home runway both ends, a city runway the end that faces home
                const toward = rw.approachBoth || (end * (rw.x * sy + rw.z * cy) <= 0);
                if (!toward) return;
                for (let i = 0; i < 5; i++) {
                    const d = 13 + 3 + i * 4;
                    try {
                        const slot = AssetLib.place('approach_lights', { x: rw.x + sy * d * end, y: F, z: rw.z + cy * d * end, rotY: rw.yaw, scale: LIGHT_SCALE });
                        a.stations.push({ slot: slot, mats: [], bound: false, idx: i });
                    } catch (e) { }
                }
            });
        });
        return a;
    }

    function ready(slot) { return slot && slot.children.length > 0 && !(slot.children[0].userData && slot.children[0].userData.cadFallback); }

    function frame(dt) {
        const a = cur;
        if (!a || !a.st || typeof currentScene === 'undefined' || currentScene !== 'flight_sim') return;
        a.t += dt;
        // tower cab glow
        if (a.tower && ready(a.tower)) {
            if (!a.cabMats.length) {
                a.tower.traverse(function (o) {
                    if (o.name === 'cab') o.traverse(function (c) { if (c.isMesh && c.material && c.material.clone) { c.material = c.material.clone(); a.cabMats.push(c.material); } });
                });
                a.cabMats.forEach(function (m) { if (m.emissive) m.emissive.setRGB(0.9, 0.85, 0.5); m.emissiveIntensity = 0; });
            }
            a.cabMats.forEach(function (m) { m.emissiveIntensity = a.glow * 2 + 0.05; });
        }
        // wind: prevailing direction wanders slowly; a gust (WIND word) pulls the socks to a new heading
        a.gustT = Math.max(0, a.gustT - dt);
        if (a.gustT === 0) a.windTarget = a.windBase + Math.sin(a.t * 0.05) * 0.5;
        a.wind += wrapAngle(a.windTarget - a.wind) * Math.min(1, dt * 1.5);
        const flutter = a.gustT > 0 ? 0.16 : 0.05;
        a.socks.forEach(function (s) {
            if (!s.joint && ready(s.slot)) {
                try { const j = AssetLib.joints(s.slot); if (j && j.J_swivel) s.joint = j.J_swivel.object; } catch (e) { }
            }
            if (s.joint) s.joint.rotation.y = a.wind + Math.sin(a.t * 2.3 + s.phase) * flutter;
        });
        // approach lights: sequenced rabbit; fast flash on LAND
        const landing = a.st.phase === 'landing';
        if (a.flashT > 0) a.flashT = Math.max(0, a.flashT - dt);
        const fast = landing || a.flashT > 0;
        const period = fast ? 0.35 : 1.2;
        a.stations.forEach(function (s) {
            if (!s.bound && ready(s.slot)) { bindLamps(s.slot, s.mats); s.bound = true; }
            if (!s.bound) return;
            const ph = ((a.t / period) - s.idx * 0.18) % 1;
            const on = (ph < 0 ? ph + 1 : ph) < (fast ? 0.5 : 0.22) ? 1 : 0.08;
            s.mats.forEach(function (m) { if (m.emissive) { m.emissive.setRGB(1, 0.95, 0.8); m.emissiveIntensity = on * 2.2; } });
        });
    }

    function word(w) {
        const a = cur;
        if (!a || typeof currentScene === 'undefined' || currentScene !== 'flight_sim') return;
        w = String(w || '').toUpperCase();
        if (w === 'WIND' || w === 'TURBULENCE') {
            a.windTarget = wrapAngle(a.wind + (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.6));
            a.gustT = 14;
        } else if (w === 'LAND' || w === 'LANDING') {
            a.flashT = 8;
        }
    }

    const Airfield = { build: build, frame: frame, word: word, TOWER_SCALE: TOWER_SCALE, state: function () { return cur; }, reset: function () { cur = null; } };
    if (typeof window !== 'undefined') window.Airfield = Airfield;
    if (typeof module !== 'undefined' && module.exports) module.exports = Airfield;
    if (typeof LLHooks !== 'undefined') {
        LLHooks.on('frame', function (dt) { frame(dt); });
        LLHooks.on('word', function (w) { word(w); });
        LLHooks.on('beforeSceneSwap', function () { cur = null; });
    }
})();
