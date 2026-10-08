// LLF-85 [Sim-Tower] TOWER BUILD: CAD crane + I-beam/concrete assets, load capacity, cracking, STRESS overlay, hook collider.
//   1. data: assets/cad/block_capacity.json has CONCRETE / BRICK / STEEL with capacity, mass (matching the CAD manifest) and
//      stiffness; TowerCapacity.DEFAULTS agree with it.
//   2. utilisation calc on a 3-block stack (bottom block works hardest, an offset stack is worse, impact adds), and the
//      impact rule: a full-face landing survives, a corner landing cracks.
//   3. assets: tower_crane / tower_hook / tower_block / tower_beam GLBs + manifest entries + rig (sheaves spin).
//   4. wiring: scripts load before src/robot/, the level keeps its words and hints, STRESS word, hooks registered.
//   5. sim (node + cannon): TowerSim cracks an overhung block under a high drop, swaps it for shards and lets go of the
//      welds above it; and an O dropped over the hook tip threads on (an I cannot).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./_src');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + msg); } }
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- 1. data ----
const cap = JSON.parse(rd('assets/cad/block_capacity.json'));
const TC = require(path.join(ROOT, 'src/scenes/tower/capacity.js'));
['CONCRETE', 'BRICK', 'STEEL'].forEach(t => {
    const e = cap.types[t];
    ok(e && e.capacityN > 1e6 && e.massKg > 1000 && e.axialStiffnessNPerM > 1e9 && e.footprintM2 > 2, `block_capacity.json has a sane ${t} entry`);
    const d = TC.DEFAULTS.types[t];
    ok(Math.abs(d.capacityN / e.capacityN - 1) < 0.01 && Math.abs(d.massKg / e.massKg - 1) < 0.01 && Math.abs(d.axialStiffnessNPerM / e.axialStiffnessNPerM - 1) < 0.01,
        `TowerCapacity.DEFAULTS.${t} matches block_capacity.json`);
});
const mBlock = JSON.parse(rd('assets/cad/manifest.d/tower_block.json')), mBeam = JSON.parse(rd('assets/cad/manifest.d/tower_beam.json'));
ok(Math.abs(cap.types.CONCRETE.massKg / mBlock.massKg - 1) < 0.001, 'CONCRETE mass is the CAD mass of tower_block');
ok(Math.abs(cap.types.STEEL.massKg / mBeam.massKg - 1) < 0.001, 'STEEL mass is the CAD mass of tower_beam');
ok(/analytic/.test(cap.method) && cap.fea && cap.fea.available === false, 'capacity method is recorded (analytic: FEA solver unavailable)');
ok(cap.types.STEEL.capacityN < cap.types.BRICK.capacityN && cap.types.BRICK.capacityN < cap.types.CONCRETE.capacityN, 'steel column < brick < concrete in allowable load');
TC.data = cap;

// ---- 2. utilisation ----
const ground = { top: 0.4, x0: -2.1, x1: 2.1, z0: -2.1, z1: 2.1 };
const blk = (id, level, x, extra) => Object.assign({ id, type: 'CONCRETE', x: x || 0, y: 0.4 + 0.65 + level * 1.3, z: 0, w: 2, h: 1.3 }, extra || {});
const stack = TC.utilisation([blk('a', 0), blk('b', 1), blk('c', 2)], { ground });
ok(stack.byId.a.util > stack.byId.b.util && stack.byId.b.util > stack.byId.c.util && stack.byId.c.util > 0, 'a 3-block stack loads the bottom block hardest');
ok(stack.byId.a.supporters[0] === 'GROUND' && stack.byId.b.supporters[0] === 'a' && stack.byId.c.supporters[0] === 'b', 'the contact graph is ground <- a <- b <- c');
const wN = TC.weightN('CONCRETE');
ok(Math.abs(stack.groundN - 3 * wN) / (3 * wN) < 1e-6, 'the ground carries exactly the weight of the three blocks');
ok(Math.abs(stack.byId.a.loadN - 3 * wN) / (3 * wN) < 1e-6 && Math.abs(stack.byId.c.loadN - wN) / wN < 1e-6, 'load through a block = its weight + the weight above');
ok(stack.byId.a.util < 0.05, 'a tidy 3-stack is nowhere near cracking');
const off = TC.utilisation([blk('a', 0), blk('b', 1, 1.5), blk('c', 2, 3)], { ground });
ok(off.byId.a.areaFrac < 0.3 && off.byId.a.util > stack.byId.a.util * 3, 'a half-overhanging stack concentrates stress in the loaded face');
const v = 8.6, F = TC.impactN('CONCRETE', v);
ok(F > 5e6 && F < TC.data.types.CONCRETE.capacityN, 'a concrete block landing at 8.6 m/s on a full face survives');
const full = TC.utilisation([blk('a', 0), blk('b', 1, 0, { impactN: F })], { ground }).byId.b.util;
const corner = TC.utilisation([blk('a', 0), blk('b', 1, 1.8, { impactN: F })], { ground }).byId.a.util;
ok(full < 0.6, `full-face landing: ${(full * 100).toFixed(0)}% used`);
ok(corner >= 1, `corner landing (10% of the face): ${(corner * 100).toFixed(0)}% used -> cracks`);
ok(TC.impactN('CONCRETE', 3) < TC.impactN('CONCRETE', 9), 'a lower hook means a gentler landing (impact grows with fall speed)');
const c0 = TC.colour(0), c1 = TC.colour(1);
ok(c0[1] > c0[0] && c1[0] > c1[1], 'overlay colour runs green -> red');

// ---- 3. assets ----
const glb = require(path.join(ROOT, 'tools/cad/glb.js'));
['tower_crane', 'tower_hook', 'tower_block', 'tower_beam'].forEach(n => {
    const m = JSON.parse(rd('assets/cad/manifest.d/' + n + '.json'));
    ok(m.file === n + '.glb' && m.tris.length === 3 && m.massKg > 100 && m.assemblyOk !== false, `${n}: manifest entry with 3 LODs and mass`);
    ok(fs.existsSync(path.join(ROOT, 'assets/cad/' + n + '.glb')), `${n}.glb exists`);
});
const sCrane = glb.summary(glb.readGlb(fs.readFileSync(path.join(ROOT, 'assets/cad/tower_crane.glb'))));
['slewing_ring', 'jib_deck', 'jib_truss_s', 'counter_deck', 'operator_cab', 'mast0_s', 'mast3_e'].forEach(p => ok(sCrane.parts.includes(p), `tower_crane has ${p}`));
ok(sCrane.parts.filter(p => /^mast\d_/.test(p)).length === 16, 'tower_crane mast is 4 sections of 4 lattice panels');
const hookRecipe = JSON.parse(rd('tools/cad/recipes/tower_hook.json'));
ok(hookRecipe.joints.length === 2 && hookRecipe.joints.every(j => j.type === 'continuous'), 'tower_hook declares two continuous sheave joints');
const hookGlb = fs.readFileSync(path.join(ROOT, 'assets/cad/tower_hook.glb'));
ok(hookGlb.includes('sheave_a_pivot') && hookGlb.includes('sheave_b_pivot'), 'tower_hook.glb carries the sheave pivot nodes');
ok(mBeam.parts.w_section && /W14x90/.test(rd('tools/cad/recipes/tower_beam.json')), 'tower_beam is a W14x90 section');

// ---- 4. wiring ----
const html = rd('index.html'), ri = html.indexOf('src/robot/');
['capacity', 'crane', 'sim'].forEach(n => {
    const i = html.indexOf('src/scenes/tower/' + n + '.js');
    ok(i > 0 && (ri < 0 || i < ri), `index.html loads src/scenes/tower/${n}.js before src/robot/`);
});
ok(html.indexOf('tower/capacity.js') < html.indexOf('tower/crane.js') && html.indexOf('tower/crane.js') < html.indexOf('tower/sim.js'), 'tower scripts load capacity, crane, sim in that order');
const tb = rd('src/scenes/tower_build.js');
['LOAD|BLOCK|CONCRETE', 'BRICK|BRICKS', 'STEEL|GIRDER', 'DROP|PLACE|RELEASE', 'WELD|FUSE|FIX', 'CEMENT|SLAB|FOUNDATION', 'SCAFFOLD|SUPPORT|BRACE', 'MAGNET'].forEach(w => ok(tb.includes("'" + w + "'"), `tower_build keeps the ${w} word`));
ok(/Riddle: what do you ask the crane for when you want something heavy\?/.test(tb) && /after: 90/.test(tb), 'tower_build keeps its hints');
ok(/'STRESS\|STRAIN'/.test(tb) && /TowerSim\.toggle/.test(tb), 'STRESS word toggles the overlay');
ok(/blockType: typeName/.test(tb) && /window\.TowerBuildCtx/.test(tb), 'tower_build hands its state to the tower sim');
ok(fs.readFileSync(path.join(ROOT, 'dictionary.txt'), 'utf8').split(/\r?\n/).includes('stress'), 'STRESS is a dictionary word');
const simSrc = rd('src/scenes/tower/sim.js');
ok(/LLHooks\.on\('frame'/.test(simSrc) && /LLHooks\.on\('afterSceneBuild'/.test(simSrc) && /LLHooks\.on\('beforeSceneSwap'/.test(simSrc), 'sim registers its own hooks');

// ---- 5. physics ----
let CANNON = null;
try { CANNON = require('cannon'); } catch (e) { /* devDependency missing */ }
if (!CANNON) {
    console.log('  SKIP physics: run `npm install` (cannon is a devDependency)');
} else {
    const Crane = require(path.join(ROOT, 'src/scenes/tower/crane.js'));
    const gctx = { console, CANNON, window: {}, Math };
    vm.createContext(gctx);
    vm.runInContext(rd('src/core/glyphs.js'), gctx, { filename: 'glyphs.js' });
    const LG = gctx.window.LetterGlyphs;
    const phys = JSON.parse(rd('assets/cad/glyph_physics.json'));
    LG._setPhysics(phys);
    const G = phys.glyphs;
    function dropOnHook(ch, scale, aimX) {
        const world = new CANNON.World();
        world.gravity.set(0, -9.82, 0);
        world.broadphase = new CANNON.NaiveBroadphase();
        world.solver.iterations = 20;
        const ground = new CANNON.Body({ mass: 0 });
        ground.addShape(new CANNON.Plane());
        ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        ground.position.y = -2;
        world.addBody(ground);
        const hook = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
        Crane.hookShapes().forEach(s => hook.addShape(new CANNON.Box(new CANNON.Vec3(s.half[0], s.half[1], s.half[2])), new CANNON.Vec3(s.offset[0], s.offset[1], s.offset[2])));
        world.addBody(hook);
        const e = G[ch], body = new CANNON.Body({ mass: LG.massFor(ch, scale, LG.DENSITY.foam) });
        LG.buildHullShapes(e, scale).forEach(sh => body.addShape(sh.shape, sh.offset));
        const f = LG.DENSITY.foam / 1000 * Math.pow(scale, 5);
        body.inertia.set(e.inertia[0][0] * f, e.inertia[1][1] * f, e.inertia[2][2] * f);
        body.invInertia.set(1 / body.inertia.x, 1 / body.inertia.y, 1 / body.inertia.z);
        body.updateInertiaWorld(true);
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);          // lie flat: glyph z -> world up
        const a = ch === 'O' ? [0.6047, 0.5] : e.com;
        const hw = body.quaternion.vmult(new CANNON.Vec3((a[0] - e.com[0]) * scale, (a[1] - e.com[1]) * scale, 0));
        body.position.set(aimX - hw.x, 1.4, -hw.z);
        world.addBody(body);
        for (let i = 0; i < 240; i++) world.step(1 / 60);
        return body.position;
    }
    const tipX = (550 + 650) / 2 / 1000;
    const o = dropOnHook('O', 0.5, tipX);
    ok(o.y > 0.1 && o.y < 0.35 && Math.abs(o.x - tipX) < 0.15, `an O dropped flat over the hook tip threads on and sits on the bar (x=${o.x.toFixed(2)} y=${o.y.toFixed(2)})`);
    const i1 = dropOnHook('I', 0.5, tipX);
    ok(i1.y > 0.45, `an I cannot thread: it perches on top of the tip instead of sitting on the bar (y=${i1.y.toFixed(2)})`);
    ok(Crane.hookShapes().length === 4, 'hook collider is 4 boxes (shank, bar, tip, block)');

    // TowerSim: crack + unweld, with a stub THREE and the real cannon
    const log = { removed: 0, msgs: [] };
    const stubMat = function () { this.color = { setRGB() { }, copy() { }, clone() { return this; }, setHex() { } }; this.emissive = { setRGB() { }, copy() { }, setHex() { } }; this.visible = true; };
    const sctx = {
        console, CANNON, Math, window: {},
        THREE: {
            Mesh: function () { this.position = { set() { }, copy() { } }; this.quaternion = { copy() { } }; this.parent = {}; this.material = new stubMat(); },
            BoxGeometry: function () { }, MeshStandardMaterial: stubMat, Vector3: function (x, y, z) { this.x = x; this.y = y; this.z = z; }, Color: function () { }
        },
        scene: { add() { }, remove() { log.removed++; } }, world: new CANNON.World(), physicsMaterial: undefined, physicsBodies: [],
        gameMsg: m => log.msgs.push(m), gameBeep() { }, beeps() { }, puffBurst() { }, AssetLib: undefined, LLHooks: undefined
    };
    vm.createContext(sctx);
    vm.runInContext('var TowerCapacity = (function(){ return window.TowerCapacity; })();', sctx);
    sctx.window.TowerCapacity = TC; sctx.TowerCapacity = TC;
    sctx.TowerCrane = { frame() { }, attach() { }, detach() { } };
    vm.runInContext(rd('src/scenes/tower/sim.js') + '\nthis.__sim = TowerSim;', sctx, { filename: 'sim.js' });
    const Sim = sctx.__sim;
    const Fh = -5.1, SITE = { x: 0, y: Fh, z: -2 };
    function mkRec(id, level, x, welded, imp) {
        const body = new CANNON.Body({ mass: welded ? 0 : 2 });
        body.position.set(x, Fh + 0.4 + 0.65 + level * 1.3, SITE.z);
        sctx.world.addBody(body);
        const mesh = new sctx.THREE.Mesh();
        const rec = { id, mesh, body, type: 'gameBlock', welded, half: 0.65, blockType: 'CONCRETE', w: 2, mass: 2, baseColor: 0x999999, _vis: true, impactN: imp || 0, impactT: 5 };
        body.towerId = id;
        return rec;
    }
    const st = { blocks: [], hookX: 0, hookY: 0 };
    const a = mkRec('a', 0, 0, true), b = mkRec('b', 1, 1.8, false, TC.impactN('CONCRETE', 9)), c = mkRec('c', 2, 1.8, true);
    st.blocks = [a, b, c];
    sctx.world.contacts = [{ bi: a.body, bj: b.body }, { bi: b.body, bj: c.body }];       // what cannon would report for the resting stack
    Sim.attach({ st, F: Fh, SITE });
    const res = Sim.evaluate(0.25);
    ok(res.byId.a.util >= 1 && res.byId.a.areaFrac < 0.2, `the overhung bottom block is overloaded (${(res.byId.a.util * 100).toFixed(0)}% used, ${(res.byId.a.areaFrac * 100).toFixed(0)}% of its face loaded)`);
    ok(a.cracked && !st.blocks.includes(a), 'the overloaded block cracks and leaves the block list');
    ok(st.shards.length >= 6 && st.shards.length % 6 === 0, 'each cracked block becomes six shards (' + st.shards.length + ')');
    ok(c.welded === false && b.welded === false, 'cracking lets go of the welds above it');
    ok(log.msgs.some(m => /CRACK/.test(m) && /capacity/.test(m)), 'the crack message teaches why');
    Sim.attach({ st: { blocks: [], hookX: 0, hookY: 0 }, F: Fh, SITE });
    Sim.toggle();
    ok(sctx.window.TowerCapacity && /ON/.test(log.msgs[log.msgs.length - 1]), 'STRESS toggle announces the overlay');
}

console.log(`test_llf-85: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
