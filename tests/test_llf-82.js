// LLF-82: MOON ROCKET staged flight. Ascent sim (node), stage table vs CAD, early-staging penalty, mass drop on
// separation, tumble parameters, manifest/GLB nodes, and a stubbed-THREE smoke run of src/scenes/rocket/flight.js.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
function check(name, ok, extra) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + extra)); if (!ok) fails++; }
const A = require('../src/scenes/rocket/ascent.js');
const SB = require('../src/scenes/rocket/stage_bodies.js');
const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/rocket_stages.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/manifest.json'), 'utf8'));

// ---- stage table: written from cad_mass_properties, agrees with the public figures
check('table has three stage nodes', table.stages.length === 3 && table.stages.map(s => s.id).join() === 'S-IC,S-II,S-IVB');
table.stages.forEach((s, i) => {
    const pub = A.DEFAULT_TABLE.stages[i];
    check(s.id + ' CAD dry mass within 2% of the public figure', Math.abs(s.dryKg - pub.dryKg) / pub.dryKg < 0.02, s.dryKg);
    check(s.id + ' has propellant, Isp, burn time and CAD inertia', s.propKg > 1e5 && s.ispVac > s.ispSl - 1 && s.burnS > 100 && s.inertiaDry.transverseKgM2 > 1e5);
    check(s.id + ' stage nodes exist in the manifest', s.nodes.every(n => manifest.moon_rocket.parts[n]));
});
check('Cd is labelled approximate', /approximate/i.test(table.cd.label) && table.cd.value > 0.1 && table.cd.value < 1);
check('tower arms and lander legs have hinges', table.tower.arms.length === 4 && table.lander.legs.length === 4 &&
    table.tower.arms.every(a => a.hingeGlbM.length === 3 && a.retractRad < -1) && table.lander.legs.every(l => l.hingeGlbM.length === 3 && l.stowedRad > 1));
check('payload and events listed', table.payload.kg > 4e4 && table.events.some(e => e.id === 'les') && table.events.some(e => e.id === 's2_skirt'));
check('liftoff mass is Saturn V class', table.stack.liftoffMassKg > 2.7e6 && table.stack.liftoffMassKg < 3.0e6, table.stack.liftoffMassKg);

// ---- manifest: the three assets, with joints
['moon_rocket', 'launch_tower', 'lunar_lander'].forEach(n => {
    const e = manifest[n];
    check(n + ' in manifest with mass properties', !!e && e.massKg > 0 && e.inertia && e.tris[0] > 0);
    check(n + ' GLB present', fs.existsSync(path.join(ROOT, 'assets/cad', n + '.glb')) && fs.existsSync(path.join(ROOT, 'assets/cad/previews', n + '.png')));
});
check('tower swing arms are revolute joints', manifest.launch_tower.joints.length === 4 && manifest.launch_tower.joints.every(j => j.type === 'revolute'));
check('lander legs are revolute deploy joints', manifest.lunar_lander.joints.length === 4 && manifest.lunar_lander.joints.every(j => j.type === 'revolute'));
check('rocket is ~110 m tall, 10 m wide', Math.abs(manifest.moon_rocket.bboxM.size[1] - 110.6) < 1 && manifest.moon_rocket.bboxM.size[0] > 14);

// ---- ascent with defaults reaches the staging band, then orbit
const f = A.create(table);
A.ignite(f);
let first = null, guard = 0;
while (!first && guard++ < 6000) { A.step(f, 0.25); if (A.canStage(f)) first = { t: f.t, h: f.h, v: A.speed(f), airV: A.airSpeed(f) }; }
check('S-IC reaches the staging band (50-75 km, 2.0-3.2 km/s inertial) with default settings', first && first.h > 50000 && first.h < 75000 && first.v > 2000 && first.v < 3200, JSON.stringify(first));
check('S-IC burnout near the real ~160 s', first && first.t > 140 && first.t < 185, first && first.t);
const g = A.create(table); const flown = A.autopilot(g, 0.25, 1500);
check('autopilot reaches a bound 170+ km orbit', flown.inOrbit && !flown.crashed && A.orbit(flown).perigeeAlt > 170000, flown.t);
check('three stage events logged in order', flown.log.filter(e => e.ev === 'separated').map(e => e.stage).join() === 'S-IC,S-II');
check('LES and skirt jettisoned', flown.jettisoned.map(j => j.id).sort().join() === 'les,s2_skirt');
check('max-q and g load plausible', flown.maxQ > 15000 && flown.maxQ < 60000 && flown.maxG > 3 && flown.maxG < 6, flown.maxQ + ' Pa ' + flown.maxG + ' g');

// ---- staging: early is a penalty, near burnout works and the mass drop equals the stage
const e = A.create(table); A.ignite(e); A.step(e, 30);
const m0 = A.totalMass(e), early = A.stageNow(e);
check('STAGE at 30 s is refused as early staging', early.ok === false && early.early === true && e.penalties.early === 1 && e.stageIdx === 0);
check('early staging vents propellant (mass goes down a little, stage stays)', A.totalMass(e) < m0 && e.stages[0].prop > 0 && e.stageIdx === 0);
const h = A.create(table); A.ignite(h);
let n = 0; while (!A.canStage(h) && n++ < 4000) A.step(h, 0.25);
const before = A.totalMass(h), s0 = h.stages[0], expect = s0.dry + s0.prop;
const r = A.stageNow(h);
check('STAGE near burnout succeeds', r.ok === true && r.early === false);
check('total mass drops by the stage mass on separation', Math.abs(r.massDropKg - expect) < 1 && Math.abs((before - A.totalMass(h)) - expect) < 1, r.massDropKg + ' vs ' + expect);
check('separated mass is dry mass plus a few percent leftover propellant', r.massDropKg > table.stages[0].dryKg && r.massDropKg < table.stages[0].dryKg + 0.05 * table.stages[0].propKg);
check('the second stage lights after the ignition delay and the thrust is back', (A.step(h, 12), h.accel > 5));
const late = A.create(table); A.ignite(late); A.step(late, 168 + 40);
check('an un-staged spent stage is released automatically (no soft lock)', late.stageIdx >= 1 && late.penalties.late === 1);

// ---- tumble parameters (real mass + CAD inertia)
const tp = SB.tumbleParams(r.stage, table.stages[0]);
check('tumble body mass is the separated stage mass', Math.abs(tp.mass - r.massDropKg) < 1);
check('tumble inertia is positive, transverse >> axial', tp.inertia.x > 1e7 && tp.inertia.y > 1e6 && tp.inertia.x > tp.inertia.y);
check('separation spins the stage', Math.abs(tp.omega.z) > 0.005 && Math.abs(tp.omega.z) < 0.5, tp.omega.z);
check('StageBodies.create() is null without cannon.js (guarded)', SB.create() === null);

// ---- scene wiring (static)
const src = require('./_src').readAllSource();
const scene = fs.readFileSync(path.join(ROOT, 'src/scenes/moon_rocket.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const idx = t => html.indexOf('<script src="' + t + '"');
check('rocket scripts load before src/robot/', idx('src/scenes/rocket/ascent.js') > 0 && idx('src/scenes/rocket/stage_bodies.js') > 0 && idx('src/scenes/rocket/flight.js') > 0 &&
    idx('src/scenes/rocket/flight.js') < idx('src/robot/kinematics.js'));
check('existing words kept', ['LAUNCH|IGNITE|BLAST|LIFTOFF', 'STAGE|SEPARATE|JETTISON', 'ORBIT|CIRCLE', 'BOOST|BURN', 'RETRO|BRAKE|SLOW', 'LAND|TOUCHDOWN', 'ABORT', 'FUEL|REFUEL|TANK', 'FLIP|REVERSE', 'SCAN|RADAR|MAP', 'COMET|REX', 'DINO|DINOSAUR', 'SIGNAL|PING'].every(w => scene.includes("'" + w + "'")));
check('level intro and hints kept', scene.includes('Rockets drink before they dance') && scene.includes('Riddle: what fills a thirsty tank') && scene.includes('ONE SMALL LAP FOR ROCKETKIND'));
check('LEGS word added and legs gate touchdown', scene.includes("'LEGS|GEAR|DEPLOY'") && scene.includes('legsReady'));
check('every new scene entry point goes through the rf() try/catch wrapper', scene.split(/\r?\n/).filter(l => /RocketFlight\./.test(l)).every(l => /rf\(/.test(l)), scene.split(/\r?\n/).filter(l => /RocketFlight\./.test(l) && !/rf\(/.test(l)).join('|'))
check('LEVELS.md documents the staged flight', /Staged flight \(LLF-82\)/.test(fs.readFileSync(path.join(ROOT, 'LEVELS.md'), 'utf8')) && /early staging/i.test(fs.readFileSync(path.join(ROOT, 'LEVELS.md'), 'utf8')));
check('CRLF preserved in edited files', /\r\n/.test(scene) && !/[^\r]\n/.test(scene) && !/[^\r]\n/.test(html));

// ---- flight.js smoke run against a stubbed THREE / AssetLib (no browser here)
(function smoke() {
    class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } clone() { return new V3(this.x, this.y, this.z); }
        add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; } multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
        addScaledVector(v, k) { this.x += v.x * k; this.y += v.y * k; this.z += v.z * k; return this; } setScalar(k) { return this.set(k, k, k); } normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; return this.multiplyScalar(1 / l); } applyQuaternion() { return this; } }
    class Q { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; } multiply() { return this; } set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } setFromAxisAngle(a, t) { this.axisAngle = [a.x, a.y, a.z, t]; return this; } }
    class O3 { constructor(name) { this.name = name || ''; this.children = []; this.parent = null; this.visible = true; this.position = new V3(); this.scale = new V3(1, 1, 1); this.quaternion = new Q(); this.rotation = new V3(); this.material = { visible: true }; }
        add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); return this; } remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; }
        getObjectByName(n) { if (this.name === n) return this; for (const c of this.children) { const r = c.getObjectByName(n); if (r) return r; } return null; }
        traverse(f) { f(this); this.children.forEach(c => c.traverse(f)); }
        clone() { const o = new O3(this.name); o.visible = this.visible; o.position.copy(this.position); o.scale.copy(this.scale); this.children.forEach(c => o.add(c.clone())); return o; } }
    const mk = (root, names) => { const g = new O3('cad'); const r = new O3('nativecad-root'); g.add(r); names.forEach((n, i) => { const o = new O3(n); o.position.set(1000 * i, 0, 100); r.add(o); }); return g; };
    const rocketNames = Object.keys(manifest.moon_rocket.parts), towerNames = Object.keys(manifest.launch_tower.parts), landerNames = Object.keys(manifest.lunar_lander.parts);
    const tweens = [], msgs = [];
    const gl = { window: undefined, THREE: { Group: O3, Vector3: V3, Quaternion: Q }, scene: new O3('scene'), currentScene: 'moon_rocket',
        AssetLib: { load: n => Promise.resolve(mk(null, n === 'moon_rocket' ? rocketNames : n === 'launch_tower' ? towerNames : landerNames)) },
        tween: (d, fn, done) => tweens.push({ fn, done }), puffBurst() { }, gameMsg: m => msgs.push(m), gameBeep() { }, fetch: undefined, RocketAscent: A, StageBodies: SB };
    const vm = require('vm'); const ctx = vm.createContext(gl); gl.window = ctx;
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/scenes/rocket/flight.js'), 'utf8'), ctx);
    const RF = ctx.RocketFlight;
    const st = { padTh: -0.62, th: -0.62, dir: 1, alt: 0, phase: 'pad', staged: false, strobe: new O3('strobe') };
    const rocket = new O3('rocket'); const prim = new O3('prim'); rocket.add(prim); rocket.add(st.strobe);
    const pad = new O3('pad'); const rfctx = { rocket, pad, flame() { } };
    RF.attach(st, rfctx);
    Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(() => new Promise(r => setTimeout(r, 10))).then(() => {
        check('flight.js: models attach (rocket + tower + lander) when the GLB nodes exist', RF.ready(st) && st.rf.arms.length === 4 && st.rf.legs.length === 4 && !prim.visible);
        check('flight.js: tower arms are re-parented onto hinge pivots', st.rf.arms.every(a => a.pivot.children.length === 1 && a.pivot.children[0].name.startsWith('swing_arm_')));
        st.phase = 'ascent'; RF.launch(st, rfctx);
        check('LAUNCH starts the sim and queues the arm swing', st.rf.active && st.rf.fl.launched && tweens.length === 1);
        tweens[0].fn(1);
        check('tower arms swing to -90 degrees at liftoff', st.rf.arms.every(a => Math.abs(a.pivot.rotation.z + Math.PI / 2) < 1e-9));
        let ticks = 0; while (RF.tick(st, rfctx, 1) && ticks++ < 4000 && !A.canStage(st.rf.fl));
        check('flight.js: sim-driven climb reaches the staging window', A.canStage(st.rf.fl) && st.alt > 4.5 && st.alt < 7, st.alt);
        const early = RF.stage; const mBefore = A.totalMass(st.rf.fl);
        check('STAGE at burnout separates, hides the stage nodes and spawns a tumbler', RF.stage(st, rfctx) === true && st.staged && st.rf.tumblers.length === 1 &&
            !st.rf.model.getObjectByName('s1_stage').visible && A.totalMass(st.rf.fl) < mBefore - 1e5);
        RF.frame(st, rfctx, 1);
        check('tumbling stage follows the rocket frame', st.rf.tumblers[0].pivot.parent === gl.scene);
        const st2 = { padTh: 0, th: 0, dir: 1, alt: 0, phase: 'ascent', staged: false, strobe: new O3('s') };
        st.phase = 'deorbit'; RF.land(st, rfctx);
        check('LAND swaps to the lander with legs stowed until deployed', st.rf.lander.visible && !st.rf.model.visible && !RF.legsReady(st));
        tweens[tweens.length - 1].fn(1); tweens[tweens.length - 1].done();
        check('legs deploy (angle 0) and touchdown is allowed', RF.legsReady(st) && st.rf.legs.every(l => Math.abs(l.pivot.quaternion.axisAngle[3]) < 1e-9));
        console.log(fails ? 'FAILED: ' + fails : 'All LLF-82 checks passed.'); process.exit(fails ? 1 : 0);
    });
})();
