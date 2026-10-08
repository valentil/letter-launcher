// Letter Launcher - src/scenes/tower/crane.js
// LLF-85 TOWER BUILD: the CAD crane (tower_crane.glb: lattice mast, slewing ring, jib, counter-jib, cab) and the
// hook block (tower_hook.glb: forged J hook, two sheaves). The hook gets a collider so a letter can be threaded
// on it (the O proves it in tests/test_llf-85.js). Registers its own hooks (docs/HOOKS.md); no core edits.
//
//   TowerCrane.hookShapes()   -> [{ half:[x,y,z], offset:[x,y,z] }]  boxes of the hook collider in the hook frame
//                                (origin = hook tip bottom, +Y up, metres, already scaled by HOOK_SCALE)
//   TowerCrane.HOOK_SCALE     visual and collider scale of the hook asset (1: a 1.4 m hook block, a 0.7 m wide J with a 0.5 m throat, sized for 0.5-1 m letters)
//   TowerCrane.HOOK_H         hook height after scaling
//   TowerCrane.attach(ctx)    place both assets, hide the primitive crane, add the kinematic hook body
var TowerCrane = (function () {
    'use strict';
    var api = { HOOK_SCALE: 1, HOOK_H: 1.4 };
    var S = api.HOOK_SCALE;
    // mm in the recipe (tools/cad/gen/tower.js): J plate x[-50,650] z[0,900], y +-60; cheeks + crossbar x +-250 z[700,1400], y +-120
    function mm(v) { return v * S / 1000; }
    api.hookShapes = function () {
        function bx(x0, x1, z0, z1, yh) { return { half: [mm((x1 - x0) / 2), mm((z1 - z0) / 2), mm(yh)], offset: [mm((x0 + x1) / 2), mm((z0 + z1) / 2), 0] }; }
        return [
            bx(-50, 50, 100, 900, 60),       // shank
            bx(-50, 650, 0, 100, 60),        // bottom bar of the J
            bx(550, 650, 100, 500, 60),      // tip (the part a letter slips over)
            bx(-250, 250, 700, 1400, 120)    // block: cheeks, sheaves, crossbar
        ];
    };

    var ctx = null;
    function sheaves(group) {
        var out = [];
        group.traverse(function (o) { if (o.name === 'sheave_a_pivot' || o.name === 'sheave_b_pivot') out.push(o); });
        return out;
    }
    api.attach = function (c) {
        ctx = c; var st = c.st, F = c.F, SITE = c.SITE;
        try { (st.oldCrane || []).forEach(function (m) { m.visible = false; }); if (st.hook) st.hook.visible = false; } catch (e) { }
        try {
            ctx.crane = AssetLib.place('tower_crane', { x: 8.5, y: F, z: SITE.z, rotY: 0, lod: false });
            ctx.hookVis = AssetLib.place('tower_hook', { x: 0, y: F + 8, z: SITE.z, rotY: 0, scale: S, lod: false });
        } catch (e) { try { console.warn('[TowerCrane] asset place failed', e); } catch (_) { } }
        // kinematic compound collider that follows the hook
        if (typeof CANNON !== 'undefined' && typeof world !== 'undefined') {
            var b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: typeof physicsMaterial !== 'undefined' ? physicsMaterial : undefined });
            api.hookShapes().forEach(function (s) {
                b.addShape(new CANNON.Box(new CANNON.Vec3(s.half[0], s.half[1], s.half[2])), new CANNON.Vec3(s.offset[0], s.offset[1], s.offset[2]));
            });
            b.position.set(st.hookX, st.hookY - api.HOOK_H, SITE.z);
            world.addBody(b);
            ctx.hookBody = b; ctx.lastY = st.hookY; ctx.spin = 0;
        }
    };
    api.detach = function () {
        if (ctx && ctx.hookBody && typeof world !== 'undefined') { try { world.removeBody(ctx.hookBody); } catch (e) { } }
        ctx = null;
    };
    api.frame = function (dt) {
        if (!ctx) return;
        var st = ctx.st, y = st.hookY - api.HOOK_H;
        if (ctx.hookVis) ctx.hookVis.position.set(st.hookX, y, ctx.SITE.z);
        if (ctx.hookBody) {
            var p = ctx.hookBody.position;
            if (dt > 0) ctx.hookBody.velocity.set((st.hookX - p.x) / dt, (y - p.y) / dt, 0);
            p.set(st.hookX, y, ctx.SITE.z);
        }
        // sheaves turn with cable payout: arc length = rise of the hook, sheave radius 0.1 m x scale
        var dy = st.hookY - ctx.lastY; ctx.lastY = st.hookY;
        if (dy !== 0 && ctx.hookVis) {
            ctx.spin += dy / (0.1 * S);
            sheaves(ctx.hookVis).forEach(function (n) { n.rotation.z = ctx.spin; });
        }
    };
    return api;
})();
if (typeof window !== 'undefined') window.TowerCrane = TowerCrane;
if (typeof module !== 'undefined' && module.exports) module.exports = TowerCrane;
