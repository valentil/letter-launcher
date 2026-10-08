// LLF-86 [Fidelity-Kit] sandbox scenes asset kit: layout tables, bbox overlap == 0, scene wiring.
//   1. src/scenes/kit.js loads before the scene files and its LLF_KIT_DIMS match assets/cad/manifest.json.
//   2. Every layout item names a manifest asset with a recipe, and the dev-mode overlap count is 0 per scene.
//   3. Each kit scene calls llfKitPlace(<KEY>) inside try/catch, and its non-fixed assets go through AssetLib.
//   4. Heavy props (col:true) get static colliders from the manifest bbox (offline vm run with stub CANNON/AssetLib).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } }

const kitSrc = fs.readFileSync(path.join(ROOT, 'src/scenes/kit.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(html.indexOf('src/scenes/kit.js') > html.indexOf('src/core/assetlib.js'), 'kit.js loads after assetlib.js');
ok(html.indexOf('src/scenes/kit.js') < html.indexOf('src/scenes/city.js'), 'kit.js loads before the scene files');

const placed = [];
const bodies = [];
const ctx = {
    window: {}, console: { warn() { } }, location: { search: '?dev', hostname: 'localhost' },
    AssetLib: { place(n, o) { placed.push({ n, o }); return {}; } },
    CANNON: { Body: function (o) { this.shapes = []; this.mass = o.mass; this.position = { set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } }; this.quaternion = { setFromAxisAngle() { } }; this.addShape = s => this.shapes.push(s); }, Box: function (v) { this.v = v; }, Vec3: function (x, y, z) { this.x = x; this.y = y; this.z = z; } },
    world: { addBody(b) { bodies.push(b); } }, colliderBodies: [], physicsMaterial: {}
};
ctx.window.AssetLib = ctx.AssetLib;
vm.createContext(ctx);
vm.runInContext(kitSrc + '\nthis.KIT = { DIMS: LLF_KIT_DIMS, LAYOUT: LLF_KIT_LAYOUT, overlaps: llfKitOverlaps, place: llfKitPlace };', ctx);
const K = ctx.KIT;

// ---- 1. dims vs manifest ----
Object.keys(K.DIMS).forEach(n => {
    const m = manifest[n];
    ok(!!m, `${n} has a manifest entry`);
    if (!m) return;
    ['min', 'max'].forEach(k => m.bboxM[k].forEach((v, i) => ok(Math.abs(v - K.DIMS[n][k][i]) < 0.002, `${n} bbox ${k}[${i}] matches manifest`)));
});

// ---- 2. layouts ----
const sceneFile = { CITY: 'city.js', 'COASTAL CITY': 'coastal_city.js', DESERT: 'desert.js', 'WILD WEST': 'wild_west.js', SPACE: 'space.js', FOREST: 'forest.js' };
Object.keys(K.LAYOUT).forEach(key => {
    const list = K.LAYOUT[key];
    list.forEach(it => {
        ok(K.DIMS[it.n] && manifest[it.n], `${key}: ${it.n} is a manifest asset with dims`);
        ok(fs.existsSync(path.join(ROOT, 'tools/cad/recipes', it.n + '.json')), `${key}: recipe for ${it.n}`);
    });
    const ov = K.overlaps(list);
    ok(ov.length === 0, `${key}: dev-mode bbox overlap count == 0 (got ${ov.length}: ${ov.map(p => list[p[0]].n + '/' + list[p[1]].n).join(', ')})`);
    const kitAssets = new Set(list.filter(i => !i.fixed).map(i => i.n));
    ok(kitAssets.size >= 2, `${key}: at least two kit asset types (${[...kitAssets].join(', ')})`);
    // offline place run
    placed.length = 0; bodies.length = 0;
    const n = K.place(key, () => -5.1);
    ok(n === list.filter(i => !i.fixed).length && placed.length === n, `${key}: every non-fixed item goes through AssetLib.place`);
    ok(bodies.length === list.filter(i => i.col && !i.fixed).length, `${key}: heavy props get static colliders (${bodies.length})`);
    ok(bodies.every(b => b.mass === 0), `${key}: colliders are static`);
    ok(ctx.window.__llfKit && ctx.window.__llfKit.overlaps[key] === 0, `${key}: test hook window.__llfKit.overlaps reports 0`);
    // ---- 3. scene wiring ----
    const f = sceneFile[key];
    ok(!!f, `${key}: scene file mapped in the test`);
    if (f) {
        const s = fs.readFileSync(path.join(ROOT, 'src/scenes', f), 'utf8');
        ok(new RegExp("llfKitPlace\\('" + key + "'").test(s), `${f} calls llfKitPlace('${key}')`);
        ok(/try\s*\{[^]*llfKitPlace[^]*\}\s*catch/.test(s), `${f}: kit placement wrapped in try/catch`);
    }
});

console.log(`test_llf86_assetkit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
