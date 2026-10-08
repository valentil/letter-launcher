// LLF-79 [Robot-6] bin realism: Scrabble fill, settle/sleep, occlusion map, vibrator, hopper refill.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./_src');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL: ' + msg); } }

const RobotBin = require(path.join(ROOT, 'src/robot/bin.js'));
const SC = RobotBin.SCRABBLE_COUNTS;
const letters = Object.keys(SC).filter(k => k !== '_').reduce((a, k) => a + SC[k], 0);
ok(letters === 98 && SC._ === 2 && letters + SC._ === 100, 'SCRABBLE_COUNTS = 98 letters + 2 blanks');
ok(RobotBin.total(SC) === 98, 'blanks are skipped when expanding');
const eng = fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');
ok(/__binGlyph/.test(eng), 'engine.retireExcessBodies exempts sleeping bin glyphs');
ok(/robot\/bin\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'index.html loads src/robot/bin.js');

let CANNON;
try { CANNON = require('cannon'); } catch (e) { console.log('  SKIP physics: run `npm install`'); }
if (CANNON) {
    const phys = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/glyph_physics.json'), 'utf8'));
    const ctx = { console, CANNON, window: {}, Math };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/glyphs.js'), 'utf8'), ctx, { filename: 'glyphs.js' });
    const LG = ctx.window.LetterGlyphs; LG._setPhysics(phys);
    function makeGlyph(ch, scale) {
        const e = phys.glyphs[ch], body = new CANNON.Body({ mass: LG.massFor(ch, scale, LG.DENSITY.foam) });
        LG.buildHullShapes(e, scale).forEach(sh => body.addShape(sh.shape, sh.offset));
        const f = LG.DENSITY.foam / 1000 * Math.pow(scale, 5);
        body.inertia.set(e.inertia[0][0] * f, e.inertia[1][1] * f, e.inertia[2][2] * f);
        body.invInertia.set(1 / body.inertia.x, 1 / body.inertia.y, 1 / body.inertia.z);
        body.updateInertiaWorld(true);
        return { body };
    }
    function newBin(seed) {
        const world = new CANNON.World();
        world.gravity.set(0, -9.82, 0);
        world.broadphase = new CANNON.SAPBroadphase(world);
        world.solver.iterations = 8;
        world.allowSleep = true;
        const m = new CANNON.Material('m'); world.defaultContactMaterial.friction = 0.4; world.defaultContactMaterial.restitution = 0.1;
        return { world, bin: RobotBin.create({ CANNON, world, makeGlyph, seed }) };
    }

    // ---- occlusion: a glyph placed under another reports occluded
    {
        const { bin } = newBin(3);
        const fy = bin.BIN.floorY;
        const low = bin.add('E', 0, fy + 0.06, 0);
        const high = bin.add('E', 0, fy + 0.30, 0);
        high.body.quaternion.copy(low.body.quaternion); high.body.angularVelocity.set(0, 0, 0); low.body.angularVelocity.set(0, 0, 0);
        low.body.velocity.set(0, 0, 0); high.body.velocity.set(0, 0, 0);
        bin.settle(3);
        const om = bin.occlusionMap();
        ok(om[low.id].occludedBy.indexOf(high.id) >= 0 && !om[low.id].topClear, 'glyph under another reports occluded (' + JSON.stringify(om[low.id]) + ')');
        ok(om[high.id].topClear && om[high.id].visibleFraction > 0.9, 'glyph on top is clear and fully visible');
        ok(om[low.id].visibleFraction < om[high.id].visibleFraction, 'covered glyph has lower visibleFraction');
        const pg = bin.toPlannerGlyphs();
        const lg = pg.find(g => g.id === low.id);
        ok(lg.char === 'E' && typeof lg.pose.x === 'number' && typeof lg.pose.z === 'number' && Array.isArray(lg.occludedBy) && lg.occludedBy.indexOf(high.id) >= 0, 'toPlannerGlyphs matches RobotPlanner input format');
        const RobotPlanner = require(path.join(ROOT, 'src/robot/planner.js'));
        const pl = RobotPlanner.create ? null : null;
        ok(!!RobotPlanner, 'planner loads alongside');
    }

    // ---- full fill, sleep, hopper refill
    {
        const { world, bin } = newBin(7);
        const n = bin.fill(SC, { settleSeconds: 4 });
        ok(n === 98, 'fill drops 98 glyphs (blanks skipped), got ' + n);
        const culled = bin.cull();
        ok(culled === 0, 'at most a handful spill over the rim (' + culled + ')');
        const asleep = bin.glyphs.filter(g => g.body.sleepState === CANNON.Body.SLEEPING).length;
        ok(asleep >= bin.glyphs.length * 0.7, 'settled glyphs sleep (' + asleep + '/' + bin.glyphs.length + ')');
        const inside = bin.glyphs.every(g => Math.abs(g.body.position.x) < 0.6 && Math.abs(g.body.position.z) < 0.4 && g.body.position.y > bin.BIN.floorY - 0.05);
        ok(inside, 'all glyphs inside the tote');
        const om = bin.occlusionMap();
        const hidden = Object.values(om).filter(m => !m.topClear).length;
        ok(hidden > 10 && hidden < bin.glyphs.length, 'a real jumble: some glyphs buried, some on top (' + hidden + ' covered of ' + bin.glyphs.length + ')');
        const before = bin.glyphs.length;
        ok(bin.hopperRefill({ A: 2, B: 1, _: 1 }) === 3, 'hopperRefill queues 3 glyphs (blank skipped)');
        bin.step(2.0);
        ok(bin.glyphs.length === before + 3 && bin.pendingCount() === 0, 'hopper released the queued glyphs through the door');
        ok(bin.hopper.door >= 0, 'hopper door state exposed');
    }
}

// ---- vibrator: seeded sim, SHAKE uncovers letters (flattens the pile)
if (CANNON) {
    const phys2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/glyph_physics.json'), 'utf8'));
    const ctx2 = { console, CANNON, window: {}, Math }; vm.createContext(ctx2);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/glyphs.js'), 'utf8'), ctx2, { filename: 'glyphs.js' });
    const LG2 = ctx2.window.LetterGlyphs; LG2._setPhysics(phys2);
    const mk = (ch, scale) => {
        const e = phys2.glyphs[ch], body = new CANNON.Body({ mass: LG2.massFor(ch, scale, LG2.DENSITY.foam) });
        LG2.buildHullShapes(e, scale).forEach(sh => body.addShape(sh.shape, sh.offset));
        const f = LG2.DENSITY.foam / 1000 * Math.pow(scale, 5);
        body.inertia.set(e.inertia[0][0] * f, e.inertia[1][1] * f, e.inertia[2][2] * f);
        body.invInertia.set(1 / body.inertia.x, 1 / body.inertia.y, 1 / body.inertia.z);
        body.updateInertiaWorld(true);
        return { body };
    };
    const world = new CANNON.World(); world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.SAPBroadphase(world); world.solver.iterations = 8;
    world.defaultContactMaterial.restitution = 0.05;
    const bin = RobotBin.create({ CANNON, world, makeGlyph: mk, seed: 3 });
    const counts = {}; 'ABCDEFGHIJKLMNOPQRST'.split('').forEach(c => counts[c] = 2);
    bin.fill(counts, { settleSeconds: 5 });
    const clear = () => Object.values(bin.occlusionMap()).filter(m => m.topClear).length;
    const c0 = clear();
    bin.vibrate(3);
    ok(bin.isVibrating(), 'vibrate flags the tote as vibrating');
    bin.step(3);
    bin.settle(5);
    bin.cull();
    const c1 = clear();
    console.log('  topClear before/after vibrate: ' + c0 + ' -> ' + c1 + ' of ' + bin.glyphs.length);
    ok(c1 > c0, 'vibrate increases topClear count (' + c0 + ' -> ' + c1 + ')');
    ok(Math.abs(bin.tote.position.x) < 1e-6 && !bin.isVibrating(), 'tote returns to rest after vibration');
}
console.log(`test_robot6_bin: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
