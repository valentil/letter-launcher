// LLF-102: FLIGHT SIM airfield props via CAD recipes: control tower, windsock, approach lights.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const glb = require(path.join(ROOT, 'tools/cad/glb.js'));
const src = require('./_src').readAllSource();
let failures = 0;
function check(name, cond, extra) {
    if (cond) console.log('PASS', name);
    else { failures++; console.error('FAIL', name, extra !== undefined ? extra : ''); }
}
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- CAD assets ------------------------------------------------------------------------------
const want = {
    control_tower: { nodes: ['shaft', 'catwalk', 'cab', 'roof', 'beacon', 'mast'], h: [11, 14] },
    windsock: { nodes: ['base_plate', 'pole', 'swivel_arm', 'sock_orange', 'sock_white', 'J_swivel'], h: [5, 6] },
    approach_lights: { nodes: ['mast', 'crossbar', 'lamp_1', 'lamp_2', 'lamp_3', 'lamp_4', 'lamp_5'], h: [1.6, 1.8] }
};
Object.keys(want).forEach(n => {
    const recipe = JSON.parse(rd('tools/cad/recipes/' + n + '.json'));
    const m = JSON.parse(rd('assets/cad/manifest.d/' + n + '.json'));
    check(n + ': recipe cites sources and dimensions', recipe.sources.length >= 2 && Object.keys(recipe.dimensions).length >= 4);
    check(n + ': manifest tris monotonic and in budget', m.tris[0] >= m.tris[1] && m.tris[1] >= m.tris[2] && m.tris[0] <= m.budgetTris, m.tris);
    const g = glb.readGlb(fs.readFileSync(path.join(ROOT, 'assets/cad/' + n + '.glb')));
    const names = (g.json.nodes || []).map(x => x.name);
    want[n].nodes.forEach(nd => check(n + ': GLB has node ' + nd, names.indexOf(nd) >= 0));
    check(n + ': height ' + m.bboxM.size[1].toFixed(2) + ' m is real-world', m.bboxM.size[1] >= want[n].h[0] && m.bboxM.size[1] <= want[n].h[1]);
});
const ws = JSON.parse(rd('assets/cad/manifest.d/windsock.json'));
check('windsock swivel joint is vertical (continuous)', ws.joints.some(j => j.node === 'J_swivel' && j.axis[1] === 1));
check('windsock is FAA size 2: 3.66 m sock, 0.91 m throat', /3658/.test(rd('tools/cad/recipes/windsock.json')) && /914/.test(rd('tools/cad/recipes/windsock.json')));

// ---- scene wiring ----------------------------------------------------------------------------
const fsim = rd('src/scenes/flight_sim.js');
check('scene builds the airfield props', /Airfield\.build\(/.test(fsim));
check('primitive tower kept as offline fallback', /towerFallback/.test(fsim));
check('airfield.js loaded by index.html', /src\/scenes\/flight\/airfield\.js/.test(rd('index.html')));
check('airfield places all three assets', ["'control_tower'", "'windsock'", "'approach_lights'"].every(a => rd('src/scenes/flight/airfield.js').includes('AssetLib.place(' + a)));
check('airfield uses the hook bus, no core edits', /LLHooks\.on\('frame'/.test(rd('src/scenes/flight/airfield.js')) && !/Airfield/.test(rd('src/core/engine.js')));
check('TOWER word still glows st.towerTop', /'TOWER': \(\) => \{[\s\S]{0,200}st\.towerTop\.material\.emissive\.setScalar/.test(fsim));

// ---- behaviour (node, fake AssetLib) ---------------------------------------------------------
const placed = [];
function fakeObj(name, kids) {
    const o = { name: name, children: kids || [], isMesh: false, userData: {}, rotation: { y: 0 }, position: {}, material: null,
        traverse(fn) { fn(o); o.children.forEach(c => c.traverse(fn)); } };
    return o;
}
global.currentScene = 'flight_sim';
const hooks = {};
global.LLHooks = { on(e, f) { (hooks[e] = hooks[e] || []).push(f); } };
global.AssetLib = {
    place(name, opts) {
        const mk = () => { const m = fakeObj('m'); m.isMesh = true; m.material = { emissive: { setRGB(r) { this.r = r; }, setScalar() { } }, emissiveIntensity: 0, clone() { return { emissive: { setRGB(r) { this.r = r; } }, emissiveIntensity: 0, clone() { return this; } }; } }; return m; };
        let kids = [];
        if (name === 'approach_lights') kids = [fakeObj('nativecad-root', [1, 2, 3, 4, 5].map(i => fakeObj('lamp_' + i, [mk()])))];
        if (name === 'control_tower') kids = [fakeObj('nativecad-root', [fakeObj('cab', [mk()])])];
        if (name === 'windsock') kids = [fakeObj('nativecad-root', [fakeObj('J_swivel')])];
        const slot = fakeObj('slot:' + name, kids); slot.opts = opts; placed.push(slot); return slot;
    },
    joints(slot) { let j = null; slot.traverse(o => { if (o.name === 'J_swivel') j = o; }); return { J_swivel: { object: j } }; }
};
const Airfield = require(path.join(ROOT, 'src/scenes/flight/airfield.js'));
const st = { phase: 'parked', towerTop: { material: { emissive: { setScalar() { } } } } };
const a = Airfield.build({}, st, 0, [{ x: 0, z: 0, yaw: 0, approachBoth: true }, { x: 115, z: 0, yaw: Math.atan2(115, 0) }]);
const count = n => placed.filter(p => p.name === 'slot:' + n).length;
check('control tower placed once', count('control_tower') === 1);
check('windsock at both ends of both runways', count('windsock') === 4, count('windsock'));
check('approach lights: 5 each on home both ends + 1 city end', count('approach_lights') === 15, count('approach_lights'));
check('st.towerTop proxy drives the CAD cab', (() => { st.towerTop.material.emissive.setScalar(0.5); return a.glow === 0.5; })());
for (let i = 0; i < 5; i++) Airfield.frame(0.016);
const sock = a.socks[0].joint;
const before = sock.rotation.y;
Airfield.word('WIND');
check('WIND word starts a gust', a.gustT > 10);
for (let i = 0; i < 300; i++) Airfield.frame(0.016);
check('windsock swung toward the gust heading', Math.abs(sock.rotation.y - before) > 0.3, [before, sock.rotation.y]);
const lamp = a.stations[0].mats[0];
Airfield.word('LAND');
check('LAND word starts the fast flash', a.flashT > 5);
const seen = new Set(); for (let i = 0; i < 120; i++) { Airfield.frame(0.016); seen.add(lamp.emissiveIntensity); }
check('approach lamps flash on/off', seen.size >= 2, [...seen]);
check('airfield registered frame/word hooks', hooks.frame && hooks.word && hooks.beforeSceneSwap);
if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('LLF-102 airfield checks passed');
