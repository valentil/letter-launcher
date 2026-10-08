// Letter Launcher - src/scenes/tower/sim.js
// LLF-85 TOWER BUILD: block loads, cracking and the STRESS overlay. Every 0.25 s the blocks are turned into a contact
// graph (Cannon contacts + footprint overlap), the weight above each block is summed down the graph (TowerCapacity),
// and a block whose stress passes its capacity cracks: it is swapped for six shards and the welds above it let go.
// A landing block adds an impact force from its fall speed (F = v * sqrt(k m)), so a high drop onto an overhang is
// what breaks things. The STRESS word tints every block green -> red by utilisation.
// Registers its own hooks (docs/HOOKS.md). Needs src/scenes/tower/capacity.js and crane.js loaded first.
var TowerSim = (function () {
    'use strict';
    var api = { EVAL_S: 0.25 }, ctx = null, tAcc = 0, lastInfo = {};

    function assetFor(type) { return type === 'STEEL' ? 'tower_beam' : 'tower_block'; }
    function bodyId(rec) { return rec.id; }

    function recBlocks() {
        return ctx.st.blocks.filter(function (r) { return !r.cracked; }).map(function (r) {
            var p = r.body.position;
            return { id: r.id, type: r.blockType || 'CONCRETE', x: p.x, y: p.y, z: p.z, w: r.w || 2, h: (r.half || 0.65) * 2, impactN: r.impactN || 0, rec: r };
        });
    }
    function groundList() {
        var F = ctx.F, S = ctx.SITE, g = [{ top: F + 0.4, x0: S.x - 2.1, x1: S.x + 2.1, z0: S.z - 2.1, z1: S.z + 2.1 }];
        if (ctx.st.cemented) g.push({ top: F + 1.2, x0: S.x - 2.7, x1: S.x + 2.7, z0: S.z - 2.7, z1: S.z + 2.7 });
        g.push({ top: F, x0: -60, x1: 60, z0: -60, z1: 60 });
        return g;
    }
    function contactPairs() {
        var set = {}, cs = (typeof world !== 'undefined' && world.contacts) || [];
        for (var i = 0; i < cs.length; i++) {
            var a = cs[i].bi, b = cs[i].bj;
            if (a && b && a.towerId != null && b.towerId != null) { set[a.towerId + '|' + b.towerId] = 1; set[b.towerId + '|' + a.towerId] = 1; }
        }
        return set;
    }

    api.evaluate = function (dt) {
        if (!ctx) return null;
        var blocks = recBlocks(), pairs = contactPairs();
        var res = TowerCapacity.utilisation(blocks, {
            ground: groundList(),
            linked: function (a, b) { return a.rec.welded && b.rec.welded ? true : !!pairs[a.id + '|' + b.id]; }
        });
        lastInfo = res.byId;
        var worst = 0;
        blocks.forEach(function (b) {
            var r = b.rec, info = res.byId[b.id];
            if (!info) return;
            r.util = info.util;
            r.peak = Math.max(info.util, (r.peak || 0) * Math.pow(0.5, dt / 3));   // the overlay holds a spike for a few seconds
            worst = Math.max(worst, r.peak);
            if (r.impactN) { r.impactT = (r.impactT || 0) - dt; if (r.impactT <= 0) { r.impactN = 0; } }
        });
        ctx.st.worstUtil = worst;
        blocks.forEach(function (b) { var info = res.byId[b.id]; if (info && info.util >= 1 && !b.rec.cracked) api.crack(b.rec, info, res.byId); });
        return res;
    };

    function removeRec(r) {
        var st = ctx.st;
        st.blocks = st.blocks.filter(function (x) { return x !== r; });
        physicsBodies = physicsBodies.filter(function (x) { return x !== r; });
        scene.remove(r.mesh); world.removeBody(r.body);
    }
    api.crack = function (r, info, byId) {
        if (!ctx || r.cracked) return;
        r.cracked = true;
        var st = ctx.st, p = r.body.position, w = r.w || 2, h = (r.half || 0.65) * 2;
        var col = r.baseColor != null ? r.baseColor : 0x9e9e9e, vel = r.body.velocity;
        removeRec(r);
        // the welds above let go: everything that rested on this block (transitively) comes loose
        var gone = {}; gone[r.id] = 1; var changed = true;
        while (changed) {
            changed = false;
            st.blocks.forEach(function (o) {
                var oi = byId && byId[o.id];
                if (!oi || gone[o.id]) return;
                if (oi.supporters.some(function (s) { return gone[s]; })) {
                    gone[o.id] = 1; changed = true;
                    if (o.welded) {
                        o.welded = false; o.body.mass = o.mass || 2; o.body.updateMassProperties();
                        o.body.wakeUp && o.body.wakeUp();
                        if (o.mesh.material && o.mesh.material.emissive) o.mesh.material.emissive.setHex(0x000000);
                    }
                }
            });
        }
        // fractured mesh: 3 x 2 shards of the block
        st.shards = st.shards || [];
        var sw = w / 3, sd = w / 2;
        for (var i = 0; i < 3; i++) for (var k = 0; k < 2; k++) {
            var ox = (i - 1) * sw, oz = (k - 0.5) * sd;
            var m = new THREE.Mesh(new THREE.BoxGeometry(sw * 0.96, h * 0.9, sd * 0.96),
                new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }));
            m.position.set(p.x + ox, p.y, p.z + oz); scene.add(m);
            var b = new CANNON.Body({ mass: 0.4, material: physicsMaterial });
            b.addShape(new CANNON.Box(new CANNON.Vec3(sw * 0.48, h * 0.45, sd * 0.48)));
            b.position.set(p.x + ox, p.y, p.z + oz);
            b.velocity.set(vel.x + ox * 1.2 + (Math.random() - 0.5), vel.y + 1 + Math.random() * 1.5, vel.z + oz * 1.2 + (Math.random() - 0.5));
            b.angularVelocity.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
            world.addBody(b);
            st.shards.push({ mesh: m, body: b, t: 30 });
        }
        while (st.shards.length > 36) { var o = st.shards.shift(); scene.remove(o.mesh); world.removeBody(o.body); }
        try { puffBurst(new THREE.Vector3(p.x, p.y, p.z), 0xbbbbbb, 22, 2.2, { decay: 0.03, size: 0.12 }); } catch (e) { }
        try { beeps([[120, 0.25, 0, 'sawtooth', 0.2], [70, 0.4, 120, 'square', 0.18]]); } catch (e) { }
        var why = info.impactN > 0.5 * info.capacityN ? 'the landing hit it with ' + (info.impactN / 1e6).toFixed(1) + ' MN' : 'the stack above weighs ' + (info.loadN / 1e6).toFixed(1) + ' MN';
        gameMsg('CRACK! The ' + (r.blockType || 'CONCRETE').toLowerCase() + ' block at ' + (p.y - ctx.F).toFixed(1) + ' up carried ' + Math.round(info.util * 100) +
            '% of its capacity (' + Math.round(info.areaFrac * 100) + '% of its face loaded): ' + why + '. Centre the stack, lower the hook (DOWN) for gentler landings.', 9000);
    };

    // the visual: the CAD block clone inside the placeholder box (whose material is hidden)
    function attachVisual(r) {
        r._vis = true;
        if (typeof AssetLib === 'undefined') return;
        var base = { CONCRETE: null, BRICK: [0.71, 0.33, 0.24], STEEL: null }[r.blockType || 'CONCRETE'];
        AssetLib.load(assetFor(r.blockType)).then(function (g) {
            if (r.cracked || !r.mesh || !r.mesh.parent) return;
            g.position.y = -(r.half || 0.65);
            r.visMats = [];
            g.traverse(function (o) {
                if (!o.isMesh) return;
                o.material = o.material.clone();
                if (base) o.material.color.setRGB(base[0], base[1], base[2]);
                o.castShadow = true;
                r.visMats.push({ m: o.material, c: o.material.color.clone(), e: o.material.emissive ? o.material.emissive.clone() : null });
            });
            r.mesh.add(g);
            if (r.mesh.material) r.mesh.material.visible = false;
        }).catch(function () { /* keeps the plain box */ });
    }
    function paint(r) {
        if (!r.visMats) return;
        var on = ctx.st.stressOn, c = on ? TowerCapacity.colour(r.peak || 0) : null;
        r.visMats.forEach(function (v) {
            if (on) { v.m.color.setRGB(c[0], c[1], c[2]); if (v.m.emissive) v.m.emissive.setRGB(c[0] * 0.25, c[1] * 0.25, c[2] * 0.25); }
            else { v.m.color.copy(v.c); if (v.m.emissive) v.m.emissive.copy(r.welded ? new THREE.Color(0x331a00) : v.e); }
        });
        // placeholder box (no CAD asset yet): tint it as well
        if (!r.visMats.length && r.mesh.material && r.mesh.material.color && on) r.mesh.material.color.setRGB(c[0], c[1], c[2]);
    }

    api.toggle = function () {
        if (!ctx) return;
        var st = ctx.st; st.stressOn = !st.stressOn;
        gameMsg(st.stressOn
            ? 'STRESS overlay ON: green = loafing, yellow = working, red = about to crack. Weight is shared by the face that touches, so overhangs and high drops turn red first.'
            : 'STRESS overlay off.', 7000);
        try { gameBeep(st.stressOn ? 700 : 450, 0.2, 'triangle', 0.12); } catch (e) { }
    };
    api.statusText = function () {
        if (!ctx) return '';
        return (ctx.st.stressOn ? ' · STRESS worst ' + Math.round((ctx.st.worstUtil || 0) * 100) + '%' : '');
    };
    api.info = function () { return lastInfo; };

    api.attach = function (c) {
        ctx = c; tAcc = 0; lastInfo = {};
        c.st.stressOn = false; c.st.shards = [];
        try { TowerCapacity.load(); } catch (e) { }
    };
    api.detach = function () { ctx = null; };

    api.frame = function (dt) {
        if (!ctx) return;
        var st = ctx.st, i, r;
        // track fall speed; a sharp deceleration after a real fall is a landing
        for (i = 0; i < st.blocks.length; i++) {
            r = st.blocks[i];
            if (r.id == null) { r.id = 'blk' + (++api._n); r.body.towerId = r.id; }
            if (!r._vis) attachVisual(r);
            var vy = r.body.velocity.y;
            if (r.prevVy != null && r.prevVy < -1.0 && vy > r.prevVy * 0.4 && !r.welded) {
                r.impactV = -r.prevVy;
                r.impactN = TowerCapacity.impactN(r.blockType || 'CONCRETE', r.impactV);
                r.impactT = 0.5;
                tAcc = 1;                                  // evaluate now
            }
            r.prevVy = vy;
            paint(r);
        }
        tAcc += dt;
        if (tAcc >= api.EVAL_S) { var d = tAcc; tAcc = 0; api.evaluate(d); }
        // shards: sync + expire
        if (st.shards) for (i = st.shards.length - 1; i >= 0; i--) {
            var s = st.shards[i]; s.mesh.position.copy(s.body.position); s.mesh.quaternion.copy(s.body.quaternion);
            s.t -= dt;
            if (s.t <= 0) { scene.remove(s.mesh); world.removeBody(s.body); st.shards.splice(i, 1); }
        }
        TowerCrane.frame(dt);
    };
    api._n = 0;
    return api;
})();
if (typeof window !== 'undefined') window.TowerSim = TowerSim;
if (typeof module !== 'undefined' && module.exports) module.exports = TowerSim;

if (typeof LLHooks !== 'undefined') {
    LLHooks.on('afterSceneBuild', function () {
        var c = window.TowerBuildCtx;
        if (!c || c.attached) return;
        c.attached = true;
        TowerCrane.attach(c);
        TowerSim.attach(c);
    });
    LLHooks.on('beforeSceneSwap', function () {
        if (window.TowerBuildCtx) { TowerCrane.detach(); TowerSim.detach(); window.TowerBuildCtx = null; }
    });
    LLHooks.on('frame', function (dt) { TowerSim.frame(dt); });
}
