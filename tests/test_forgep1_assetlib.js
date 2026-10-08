// LLF-69 [Forge-P1] CAD asset pipeline: AssetLib API + loader safety + manifest gate.
//   1. static: src/core/assetlib.js exposes window.AssetLib {load, lod, joints, fallback, place},
//      wraps the loader in try/catch, reads MSFT_lod by hand, and is loaded before src/robot/.
//   2. vm: with no GLTFLoader (offline) load()/lod()/place() still resolve to the fallback and
//      never throw; joints() maps manifest joints by node name.
//   3. tools: check_manifest.js passes, every recipe follows the README contract, and the GLB
//      reader agrees with the manifest (LOD tri counts, Y-up bbox, positive mass).
//   4. scenes: CITY and COASTAL CITY place all three assets through AssetLib.place.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { readAllSource, ROOT } = require('./_src');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + msg); } }

const libPath = path.join(ROOT, 'src/core/assetlib.js');
ok(fs.existsSync(libPath), 'src/core/assetlib.js exists');
const lib = fs.readFileSync(libPath, 'utf8');

// ---- 1. static ----
ok(/window\.AssetLib\s*=\s*AssetLib/.test(lib), 'window.AssetLib assigned');
['load', 'lod', 'joints', 'fallback', 'place'].forEach(fn =>
    ok(new RegExp('\\bapi\\.' + fn + '\\s*=\\s*' + fn + '\\b').test(lib), `AssetLib.${fn} exported`));
ok(/THREE\.GLTFLoader/.test(lib), 'uses THREE.GLTFLoader');
ok(/try\s*\{[^]*?new THREE\.GLTFLoader\(\)\.load[^]*?\}\s*catch/.test(lib), 'GLTFLoader call wrapped in try/catch');
ok(/MSFT_lod/.test(lib) && /getDependency\('node'/.test(lib), 'reads MSFT_lod ids and fetches lower-level nodes');
ok(/makeProp\(name\)/.test(lib), 'fallback goes through makeProp(name)');
ok(!/\bawait\b/.test(lib), 'AssetLib never awaits (scene builds must not block)');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const iLib = html.indexOf('src/core/assetlib.js'), iRobot = html.indexOf('src/robot/');
ok(iLib > 0 && iRobot > iLib, 'assetlib.js <script> tag sits before the src/robot/ tags');
ok(html.indexOf('GLTFLoader.js') < iLib, 'GLTFLoader script loads before assetlib.js');

// ---- 2. vm behaviour (offline: no GLTFLoader) ----
class Obj {
    constructor() { this.children = []; this.userData = {}; this.name = ''; this.parent = null;
        this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.rotation = { y: 0 }; this.scale = { setScalar() {} }; }
    add(o) { o.parent = this; this.children.push(o); return this; }
    traverse(f) { f(this); this.children.forEach(c => c.traverse(f)); }
    clone() { return this; }
}
// LLF-104: one assets/cad/manifest.d/<name>.json per asset, no shared index
const store = require(path.join(ROOT, 'tools/cad/manifest_store.js'));
const manifest = store.readAll();
const fetched = [];
const added = [];
const THREE = {
    Group: class extends Obj {}, Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
    LOD: class extends Obj { constructor() { super(); this.levels = []; } addLevel(o, d) { this.levels.push({ o, d }); this.add(o); } },
    BoxGeometry: class { constructor(x, y, z) { this.size = [x, y, z]; } },
    MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } },
    Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; } },
    PropertyBinding: { sanitizeNodeName: s => s },
};
const ctx = { console: { warn() {}, log() {}, error() {} }, Math, Promise, THREE, setTimeout,
    scene: { add: o => added.push(o) },
    fetch: url => { fetched.push(url); const m = /manifest\.d\/([^/]+)\.json$/.exec(url), e = m && manifest[decodeURIComponent(m[1])];
        return Promise.resolve(e ? { ok: true, json: () => Promise.resolve(e) } : { ok: false, json: () => Promise.resolve(null) }); },
    makeProp: n => (n === 'rock' ? { getAttribute: () => null } : null) };
ctx.window = ctx;
vm.createContext(ctx);
let vmErr = null;
try { vm.runInContext(lib, ctx, { filename: 'assetlib.js' }); } catch (e) { vmErr = e; }
ok(!vmErr, 'assetlib.js runs in a bare vm: ' + (vmErr && vmErr.message));
const A = ctx.window.AssetLib;
ok(A && typeof A.load === 'function', 'AssetLib defined after load');

(async () => {
    if (A) {
        const fbProp = A.fallback('rock');
        ok(fbProp.userData.cadFallback && fbProp.children[0] instanceof THREE.Mesh, 'fallback(name) wraps makeProp(name)');
        ok(A.info('fire_hydrant') === null, 'info() is null before the asset meta is fetched');
        const meta = await A.meta('fire_hydrant');
        ok(meta && meta.file === 'fire_hydrant.glb' && A.info('fire_hydrant') === meta, 'meta(name) fetches manifest.d/<name>.json and info() serves it');
        ok(fetched.every(u => !/manifest\.json$/.test(u)), 'AssetLib never fetches a shared manifest.json');
        ok((await A.meta('no_such_asset')) === null, 'meta() of an unknown asset resolves null');
        const two = await A.manifest(['street_lamp', 'wooden_crate']);
        ok(Object.keys(two).join() === 'street_lamp,wooden_crate', 'manifest(names) loads just those entries');
        const fbBox = A.fallback('fire_hydrant');
        ok(fbBox.children[0].geometry.size[1] === manifest.fire_hydrant.bboxM.size[1], 'fallback without a baked prop is a bbox-sized box');
        const g = await A.load('fire_hydrant');
        ok(g && g.userData.cadFallback && g.userData.cad.name === 'fire_hydrant', 'load() resolves to the fallback when GLTFLoader is missing');
        const l = await A.lod('street_lamp');
        ok(l instanceof THREE.LOD && l.levels.length === 1, 'lod() resolves to a 1-level fallback LOD offline');
        let threw = false, slot;
        try { slot = A.place('wooden_crate', { x: 1, y: 2, z: 3, rotY: 0.5 }); } catch (e) { threw = true; }
        ok(!threw && added.includes(slot), 'place() adds a placeholder to the scene synchronously');
        ok(slot.position.x === 1 && slot.position.z === 3 && slot.children.length === 0, 'placeholder is empty until the model arrives');
        await new Promise(r => setTimeout(r, 10));
        ok(slot.children.length === 1, 'placeholder receives the (fallback) model asynchronously');
        const j = A.joints(Object.assign(new THREE.Group(), { userData: { cad: { name: 'fire_hydrant' } } }).add(Object.assign(new THREE.Group(), { name: 'operating_nut' })));
        ok(j.operating_nut && j.operating_nut.type === 'revolute' && Math.abs(j.operating_nut.axis.y - 1) < 1e-9, 'joints() maps manifest joints by node name');
    }

    // ---- 3. tools: check_manifest + recipe contract + GLB reader ----
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/cad/check_manifest.js')], { encoding: 'utf8' });
    ok(r.status === 0, 'tools/cad/check_manifest.js passes:\n' + r.stdout + r.stderr);
    const glb = require(path.join(ROOT, 'tools/cad/glb.js'));
    const materials = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/cad/materials.json'), 'utf8'));
    const recipesDir = path.join(ROOT, 'tools/cad/recipes');
    const recipes = fs.readdirSync(recipesDir).filter(f => f.endsWith('.json'));
    ['street_lamp', 'wooden_crate', 'fire_hydrant'].forEach(n => ok(recipes.includes(n + '.json'), `recipe ${n}.json present`));
    recipes.forEach(f => {
        const rc = JSON.parse(fs.readFileSync(path.join(recipesDir, f), 'utf8'));
        const n = f.slice(0, -5);
        ok(rc.name === n && typeof rc.prompt === 'string' && rc.prompt.length > 20, `${n}: name + prompt`);
        ok(rc.units === 'mm' && Array.isArray(rc.sources) && rc.sources.every(u => /^https?:\/\//.test(u)) && rc.sources.length > 0, `${n}: units mm + cited source urls`);
        ok(Array.isArray(rc.ops) && rc.ops.length > 0 && rc.ops.every(o => /^cad_/.test(o.tool) && o.args), `${n}: ops are NativeCAD calls`);
        // LLF-70: a big part catalogue (glyphs) declares batchSize: it runs as self-contained batches of that many parts
        const perBatch = rc.batchSize ? rc.batchSize * (rc.ops.length / rc.parts.length + 1) + 1 : rc.ops.length + rc.parts.length;
        ok(perBatch <= 64, `${n}: ops + set_part fit one cad_batch (<= 64)`);
        ok(rc.parts.every(p => p.of && p.nodeName && materials[p.material]), `${n}: parts have of/nodeName/known material`);
        ok(rc.export && rc.export.lods && rc.export.lods.length >= 2 && rc.export.units === 'm' && rc.export.bakeTransforms === false, `${n}: export block`);
        const e = manifest[n];
        if (e) {
            const s = glb.summary(glb.readGlb(fs.readFileSync(path.join(ROOT, 'assets/cad', e.file))));
            ok(JSON.stringify(s.tris) === JSON.stringify(e.tris) && s.tris.length === 3, `${n}: 3 LOD levels, counts match manifest`);
            // LLF-70: floor:'baseline' = type sits on the baseline at y=0; descenders/overshoot may dip below
            const floorOk = rc.floor === 'baseline' ? (s.bboxM.min[1] < 0.002 && s.bboxM.min[1] > -0.25) : Math.abs(s.bboxM.min[1]) < 0.002;
            ok(floorOk && s.bboxM.size[1] > 0.1, `${n}: Y-up, sits on y=0`);
            ok(e.massKg > 0 && e.inertia.length === 3, `${n}: mass + inertia`);
        }
    });
    ok(manifest.street_lamp && manifest.street_lamp.bboxM.size[1] > 6 && manifest.street_lamp.bboxM.size[1] < 6.5, 'street lamp is ~6.2 m tall (20 ft pole)');
    ok(manifest.fire_hydrant && manifest.fire_hydrant.joints.some(j => j.node === 'operating_nut'), 'hydrant declares its operating-nut joint');
    ['README.md', 'run_recipe.md'].forEach(f => ok(fs.existsSync(path.join(ROOT, 'tools/cad', f)), `tools/cad/${f} exists`));

    // ---- 4. scenes ----
    const src = readAllSource();
    ['city.js', 'coastal_city.js'].forEach(f => {
        const s = fs.readFileSync(path.join(ROOT, 'src/scenes', f), 'utf8');
        ['street_lamp', 'fire_hydrant', 'wooden_crate'].forEach(a =>
            ok(new RegExp("AssetLib\\.place\\('" + a + "'").test(s), `${f} places ${a} via AssetLib`));
        ok(/try\s*\{[^]*AssetLib\.place[^]*\}\s*catch/.test(s), `${f}: placement wrapped in try/catch`);
    });
    ok(/window\.AssetLib/.test(src), 'AssetLib reachable from the combined source');

    console.log(`test_forgep1_assetlib: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
