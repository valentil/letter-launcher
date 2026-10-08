// LLF-83 KYOTO TRAIN: CAD C57 locomotive with a working Walschaerts valve gear.
//   1. valve_gear.js (pure) matches the 8 cad_sketch_solve fixtures in the manifest within 2 mm, keeps every
//      rod length closed over a full revolution, both reverser settings, and its rigid poses carry the CAD rest
//      pose onto the solved linkage.
//   2. the motion/chassis GLBs carry a node for every part the rig drives.
//   3. loco_rig.js, run in a vm with a stub THREE, poses the nodes exactly as the solver says.
//   4. static: the scene builds the loco through KyotoLocoRig -> AssetLib.place, kyoto scripts load before src/robot/,
//      and every KYOTO TRAIN word is still there.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./_src');
const glb = require('../tools/cad/glb');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + msg); } }
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const VG = require('../src/scenes/kyoto/valve_gear.js');
const G = VG.GEOM;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/manifest.json'), 'utf8'));
const motion = manifest.kyoto_c57_motion, chassis = manifest.kyoto_c57_chassis;

// ---- 1. solver vs fixtures ----
ok(motion && chassis, 'manifest has kyoto_c57_motion and kyoto_c57_chassis');
const fx = motion && motion.fixtures;
ok(fx && fx.angles && fx.angles.length === 8, 'manifest carries 8 cad_sketch_solve fixtures');
ok(fx && /cad_sketch_solve/.test(fx.source), 'fixtures cite cad_sketch_solve');
let worst = 0;
(fx ? fx.angles : []).forEach(a => {
    const s = VG.solve(a.thetaDeg * Math.PI / 180, fx.gear);
    ['C', 'F', 'Die', 'D', 'E', 'V'].forEach(k => {
        const e = d(s[k], a[k]); worst = Math.max(worst, e);
        ok(e <= 2, `theta ${a.thetaDeg}: ${k} within 2 mm of the sketch solve (off ${e.toFixed(3)} mm)`);
    });
});
console.log(`  worst fixture deviation ${worst.toFixed(4)} mm`);
[1, -1, 0.4].forEach(gear => {
    for (let k = 0; k < 72; k++) {
        const s = VG.solve(k * Math.PI / 36, gear);
        if (!s) { ok(false, `linkage closes at ${k * 5} deg gear ${gear}`); continue; }
        const lens = [d(s.P, s.C) - G.mainRod, d(s.Q, s.F) - G.eccRod, d(s.F, G.L0) - G.linkFoot,
            d(s.Die, s.E) - G.radiusRod, d(s.D, s.E) - G.leverDE, d(s.D, s.V) - G.leverDV, d(s.P, G.A) - G.r];
        ok(lens.every(x => Math.abs(x) < 1e-6) && Math.abs(s.C[1] - G.zc) < 1e-9, `rod lengths closed at ${k * 5} deg gear ${gear}`);
    }
});
const st0 = VG.solve(0, 1), st1 = VG.solve(0, -1);
ok(st0.Die[1] > G.L0[1] && st1.Die[1] < G.L0[1], 'reverser moves the die block across the link pivot');
const stroke = [0, Math.PI].map(t => VG.solve(t, 1).C[0]);
ok(Math.abs(Math.abs(stroke[0] - stroke[1]) - 2 * G.r) < 1e-6, 'crosshead stroke = 660 mm (C57 cylinder 500 x 660)');
// rigid poses carry the rest geometry onto the solved points
function apply(q, pt) {
    const c = Math.cos(q.rot), s = Math.sin(q.rot), dx = pt[0] - q.p0[0], dz = pt[1] - q.p0[1];
    return [q.p1[0] + dx * c - dz * s, q.p1[1] + dx * s + dz * c];
}
['l', 'r'].forEach(side => {
    const qr = side === 'r' ? G.quarter : 0;
    [0.7, 2.1, 4.4].forEach(t => {
        const P = VG.poses(t, 1, side), s = VG.solve(t + qr, 1), r = VG.solve(G.theta0 + qr, 1);
        const checks = [['main_rod', r.C, s.C], ['eccentric_rod', r.F, s.F], ['expansion_link', r.F, s.F],
            ['radius_rod', r.E, s.E], ['combination_lever', r.E, s.E], ['return_crank', r.Q, s.Q], ['coupling_rod', r.P, s.P]];
        checks.forEach(([part, from, to]) => ok(d(apply(P.parts[part], from), to) < 1e-6, `${side} ${part} pose lands on the solved linkage (theta ${t})`));
    });
});

// ---- 2. GLB nodes ----
const nodesOf = n => new Set(glb.partNodes(glb.readGlb(fs.readFileSync(path.join(ROOT, 'assets/cad', n + '.glb')))).map(p => p.name));
const mNodes = nodesOf('kyoto_c57_motion'), cNodes = nodesOf('kyoto_c57_chassis');
const rigSrc = fs.readFileSync(path.join(ROOT, 'src/scenes/kyoto/loco_rig.js'), 'utf8');
['l', 'r'].forEach(s => {
    [1, 2, 3].forEach(i => ok(mNodes.has(`driver_${i}_${s}`), `motion GLB has driver_${i}_${s}`));
    ['coupling_rod', 'main_rod', 'crosshead', 'return_crank', 'eccentric_rod', 'expansion_link', 'radius_rod', 'combination_lever', 'valve_spindle']
        .forEach(p => ok(mNodes.has(`${p}_${s}`), `motion GLB has ${p}_${s}`));
    ['lead_1', 'lead_2', 'trail'].forEach(p => ok(cNodes.has(`${p}_${s}`), `chassis GLB has ${p}_${s}`));
});
ok(motion.kind === 'hero' && motion.tris[0] <= motion.budgetTris, 'motion set within its hero budget');
ok(Math.abs(motion.massKg + chassis.massKg - 67500) < 50, 'engine mass = 67.5 t (C57 spec) within 50 kg');

// ---- 3. rig in a vm ----
class V3 { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } setScalar(v) { this.x = this.y = this.z = v; } }
class Q4 { setFromAxisAngle(ax, a) { this.angle = a; this.axis = ax; return this; } }
class Obj { constructor() { this.children = []; this.userData = {}; this.name = ''; this.position = new V3(); this.scale = new V3(1, 1, 1); this.rotation = new V3(); this.quaternion = new Q4(); this.visible = true; }
    add(o) { this.children.push(o); o.parent = this; return this; } traverse(f) { f(this); this.children.forEach(c => c.traverse(f)); } }
const placed = {};
const ctx = { THREE: { Group: Obj, Vector3: V3 }, Math, console,
    AssetLib: { place(name, o) { const h = new Obj(); placed[name] = h; o.parent.add(h); return h; } } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/scenes/kyoto/valve_gear.js'), 'utf8'), ctx);
vm.runInContext(rigSrc + '\nthis.KyotoLocoRig = KyotoLocoRig;', ctx);
const parent = new Obj();
const rig = ctx.KyotoLocoRig.attach(parent, { scale: 0.3, y: 0.1 });
ok(placed.kyoto_c57_chassis && placed.kyoto_c57_motion, 'rig places chassis + motion through AssetLib.place');
ok(!rig.loaded(), 'rig waits for the GLB before rigging');
rig.update(0.01, 1);   // no model yet: must not throw
// fake the swapped-in model: nodes at their quantization origin (main rod: bbox centre of the rest slot)
const sR = VG.solve(G.theta0 + G.quarter, 1), sL = VG.solve(G.theta0, 1);
const model = new Obj(), root = new Obj(); model.add(root);
const mk = (name, x, y, z) => { const o = new Obj(); o.name = name; o.position.set(x, y, z); root.add(o); return o; };
const mainL = mk('main_rod_l', (sL.P[0] + sL.C[0]) / 2, 665, sL.C[1]);
const xhR = mk('crosshead_r', sR.C[0], -740, sR.C[1]);
const drv = mk('driver_2_l', -1000, 535, 875);
placed.kyoto_c57_motion.add(model);
const distWorld = 0.5;   // world units rolled
rig.update(distWorld, 1);
ok(rig.loaded(), 'rig picks up the swapped-in motion model');
const theta = G.theta0 + VG.thetaFromDistance((0.01 + distWorld) * 1000 / 0.3);   // both updates accumulate
const sNowR = VG.solve(theta + G.quarter, 1);
ok(Math.abs(xhR.position.x - sNowR.C[0]) < 1e-6 && Math.abs(xhR.position.z - 875) < 1e-6, 'right crosshead follows the slider-crank');
ok(Math.abs(drv.quaternion.angle + (theta - G.theta0)) < 1e-9 && drv.position.x === -1000, 'driver wheel turns about its own axle');
const PL = VG.poses(theta, 1, 'l').parts.main_rod;
const exp = apply(PL, [mainL.userData.rest.x, mainL.userData.rest.z]);
ok(Math.abs(mainL.position.x - exp[0]) < 1e-6 && Math.abs(mainL.position.z - exp[1]) < 1e-6 && mainL.position.y === 665, 'main rod posed rigidly from crank pin to crosshead');

// ---- 4. static ----
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const iVG = html.indexOf('src/scenes/kyoto/valve_gear.js'), iRig = html.indexOf('src/scenes/kyoto/loco_rig.js'), iRobot = html.indexOf('src/robot/');
ok(iVG > 0 && iRig > iVG && iRobot > iRig, 'kyoto scripts load (valve_gear, then loco_rig) before src/robot/');
const scene = fs.readFileSync(path.join(ROOT, 'src/scenes/kyoto_train.js'), 'utf8');
ok(/KyotoLocoRig\.attach\(/.test(scene), 'KYOTO TRAIN builds its engine through KyotoLocoRig');
ok(/AssetLib\.place\('kyoto_c57_chassis'/.test(rigSrc) && /AssetLib\.place\('kyoto_c57_motion'/.test(rigSrc), 'loco uses AssetLib for both GLBs');
ok(/st\.loco\.update\(/.test(scene), 'the valve gear is driven every frame from the train motion');
["GO|START|CHOO|DEPART|ONWARD", "STOP|HALT|BRAKE", "FAST|HURRY|EXPRESS", "SLOW|EASY|GENTLE", "SWITCH|POINTS|TRACKS", "REVERSE|BACK",
    "'SHOGUN'", "PALACE|GATES|OPEN", "'BUS'", "WHISTLE|HORN", "STOKE|COAL|FIRE", "TREE|TREES|SAKURA", "TORII", "LANTERN|LANTERNS|LIGHT", "FUJI|MOUNTAIN", "QUAKE|EARTHQUAKE|RUMBLE"]
    .forEach(w => ok(scene.includes(w), `word ${w} still wired`));
ok(/hints:\s*\[/.test(scene) && /intro:\s*\[/.test(scene), 'level keeps its intro and hints');

// ---- 5. rolling stock + permanent way ----
const tender = manifest.kyoto_c57_tender, coach = manifest.kyoto_coach;
ok(tender && coach, 'manifest has the tender and the coach');
ok(tender && Math.abs(tender.massKg + motion.massKg + chassis.massKg - 115500) < 100, 'engine + tender = 115.5 t (C57 spec)');
ok(coach && coach.massKg > 30000 && coach.massKg < 36000, 'coach mass in the Suha 43 range');
const tNodes = nodesOf('kyoto_c57_tender'), cNodes2 = nodesOf('kyoto_coach');
[1, 2, 3, 4].forEach(i => ['l', 'r'].forEach(s => ok(tNodes.has(`wheel_${i}_${s}`) && cNodes2.has(`wheel_${i}_${s}`), `tender + coach wheel_${i}_${s} nodes`)));
['outer', 'inner'].forEach(n => {
    const e = manifest['kyoto_track_' + n];
    ok(e && e.parts.rail_l_a && e.parts.rail_r_b && e.parts.ballast_a, `kyoto_track_${n}: ballast + rails`);
    const rc = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/cad/recipes/kyoto_track_' + n + '.json'), 'utf8'));
    ok(rc.ops.every(o => o.tool === 'cad_sweep_profile'), `kyoto_track_${n} is cad_sweep_profile sweeps`);
    // the swept path is the scene's CatmullRom curve: every station lies on the curve sampled by the generator
    const gen = require('../tools/cad/gen/kyoto_track.js');
    const sp = gen.spaced(gen.LOOPS[n], 2000).pts;
    const P = rc.ops[0].args.path.points.slice(1, -1);
    const worst = Math.max(...P.map(p => Math.min(...sp.map(q => Math.hypot(p[0] / 1000 * 0.3 - q[0], -p[1] / 1000 * 0.3 - q[1])))));
    ok(worst < 0.05, `kyoto_track_${n} stations sit on the scene curve (worst ${worst.toFixed(3)} world units)`);
    // and that curve is the one the scene builds
    const pts = gen.LOOPS[n].map(p => `new THREE.Vector3(${p[0]}, 0, ${p[1]})`);
    ok(pts.every(t => scene.includes(t)), `kyoto_track_${n} control points match kyoto_train.js`);
});
const setSrc = fs.readFileSync(path.join(ROOT, 'src/scenes/kyoto/kyoto_set.js'), 'utf8');
ok(/InstancedMesh/.test(setSrc) && /kyoto_sleeper/.test(setSrc), 'sleepers are instanced from the kyoto_sleeper GLB');
ok(/KyotoSet\.track\(/.test(scene), 'KYOTO TRAIN lays the CAD track');
ok(html.indexOf('src/scenes/kyoto/kyoto_set.js') > iRig && html.indexOf('src/scenes/kyoto/kyoto_set.js') < iRobot, 'kyoto_set.js loads before src/robot/');
ok(/carOffsets/.test(scene) && /kyoto_coach/.test(scene) && /kyoto_c57_tender/.test(scene), 'consist: C57 + tender + coaches with coupled offsets');

console.log(`LLF-83 kyoto CAD: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
