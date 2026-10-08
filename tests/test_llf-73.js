// LLF-73 [Forge-R2] letter materials: table, wiring, docs, and a cannon drop test (rubber bounces higher than steel).
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./_src');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } }
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const { LLMaterials, LL_MATERIALS } = require(path.join(ROOT, 'src/core/materials.js'));
const M = LL_MATERIALS;

// ---- table ----
['chrome', 'steel', 'brass', 'aluminium', 'wood', 'rubber', 'glass'].forEach(k => ok(M[k], 'material ' + k));
ok(M.steel.density === 7850 && M.brass.density === 8500 && M.aluminium.density === 2700, 'metal densities');
ok(M.wood.density === 600 && M.rubber.density === 1100 && M.glass.density === 2500, 'wood/rubber/glass densities');
ok(M.rubber.restitution === 0.8 && M.rubber.friction === 0.9 && M.steel.restitution === 0.25 && M.steel.friction === 0.4 && M.wood.restitution === 0.4, 'restitution/friction');
const modalNames = Object.keys(JSON.parse(rd('assets/cad/glyph_modes.json'))._materials);
Object.keys(M).forEach(k => ok(modalNames.indexOf(M[k].modal) >= 0, k + ' maps to a modal material with data (' + M[k].modal + ')'));
ok(M.glass.glass && M.glass.shatterSpeed > 0, 'glass shatters');
['STEEL', 'WOOD', 'RUBBER', 'GLASS', 'BRASS', 'CHROME'].forEach(w => ok(LLMaterials.WORDS[w], 'word ' + w));
const dict = new Set(rd('dictionary.txt').split(/\r?\n/));
['steel', 'wood', 'rubber', 'glass', 'brass', 'chrome'].forEach(w => ok(dict.has(w), w + ' is a dictionary word'));
ok(LLMaterials.sceneDefault('kyoto_train') === 'wood' && LLMaterials.sceneDefault('KYOTO TRAIN') === 'wood', 'Kyoto = wood');
ok(LLMaterials.sceneDefault('space') === 'aluminium' && LLMaterials.sceneDefault('robot_factory') === 'steel' && LLMaterials.sceneDefault('city') === null, 'Space/Robot/other defaults');

// ---- wiring ----
const src = rd('src/core/materials.js'), html = rd('index.html');
['word', 'letterSpawned', 'afterSceneBuild', 'frame'].forEach(e => ok(src.indexOf("LLHooks.on('" + e + "'") >= 0, 'hook ' + e));
ok(/src\/core\/materials\.js/.test(html) && html.indexOf('src/core/materials.js') < html.indexOf('src/robot/'), 'script tag before src/robot/');
ok(/MeshPhysicalMaterial/.test(src) && /transmission/.test(src) && /highTier/.test(src), 'glass transmission only on high tiers');
ok(/explodeLetter/.test(src), 'glass shatter uses explodeLetter');
const lv = rd('LEVELS.md');
ok(/STEEL/.test(lv) && /RUBBER/.test(lv) && /GLASS/.test(lv) && /materials\.js/.test(lv), 'LEVELS.md documents the words');

// ---- physics: rubber bounces higher than steel; bodies inherit contact materials ----
let CN = null;
try { CN = require('cannon'); } catch (_) { }
ok(!!CN, 'cannon available (npm install)');
if (CN) {
    function rebound(name) {
        const w = new CN.World(); w.gravity.set(0, -9.82, 0);
        const ground = new CN.Material('g');
        LLMaterials.installContacts(CN, w, ground);
        const gb = new CN.Body({ mass: 0, material: ground }); gb.addShape(new CN.Plane());
        gb.quaternion.setFromAxisAngle(new CN.Vec3(1, 0, 0), -Math.PI / 2); w.addBody(gb);
        const r = 0.25, m = M[name].density * 4 / 3 * Math.PI * r * r * r;
        const b = new CN.Body({ mass: m, material: LLMaterials.cannonMaterial(CN, name) });
        b.addShape(new CN.Sphere(r)); b.position.set(0, 3 + r, 0); w.addBody(b);
        let hit = false, peak = 0;
        for (let i = 0; i < 60 * 4; i++) {
            w.step(1 / 60);
            if (!hit && b.velocity.y > 0.1) hit = true;
            if (hit) peak = Math.max(peak, b.position.y - r);
        }
        return peak;
    }
    const hs = rebound('steel'), hr = rebound('rubber'), hw = rebound('wood'), hg = rebound('glass');
    ok(hr > hs * 2, `rubber (${hr.toFixed(2)} m) bounces much higher than steel (${hs.toFixed(2)} m)`);
    ok(hw > hs && hr > hw && hg < hw, `ordering rubber > wood > steel, glass dead (${hw.toFixed(2)}/${hg.toFixed(2)})`);
    ok(hr > 0.5 && hr < 3, 'rubber rebound is physical (below the 3 m drop)');
    // apply(): density -> mass, inertia scales with it, modal tag set
    const body = new CN.Body({ mass: 1 }); body.inertia.set(1, 2, 3); body.__glyph = true; body.__glyphChar = 'A';
    global.LetterGlyphs = { massFor: (c, s, d) => 0.1 * s * s * s * d };
    global.CANNON = CN;
    const mesh = { scale: { x: 2 }, material: null };
    ok(LLMaterials.apply({ body, mesh }, 'steel'), 'apply steel');
    ok(Math.abs(body.mass - 0.1 * 8 * 7850) < 1e-6 && Math.abs(body.invMass * body.mass - 1) < 1e-9, 'mass = volume x density x scale^3');
    ok(Math.abs(body.inertia.y - 2 * body.mass) < 1e-6, 'inertia scales with mass');
    ok(body.__modalMaterial === 'steel' && body.material && body.material.name === 'll_steel', 'modal + contact material tagged');
    ok(!LLMaterials.apply({ body: new CN.Body({ mass: 1 }), mesh }, 'steel'), 'non-glyph bodies are left alone');
    // glass shatter queue
    const gbod = new CN.Body({ mass: 1 }); gbod.inertia.set(1, 1, 1); gbod.__glyph = true; gbod.__glyphChar = 'A';
    LLMaterials.apply({ body: gbod, mesh }, 'glass');
    gbod.__matBornT = 0;
    gbod.dispatchEvent({ type: 'collide', contact: { getImpactVelocityAlongNormal: () => 9 } });
    ok(LLMaterials.pendingShatter.indexOf(gbod) >= 0, 'hard impact queues a glass shatter');
    const soft = new CN.Body({ mass: 1 }); soft.inertia.set(1, 1, 1); soft.__glyph = true; soft.__glyphChar = 'A';
    LLMaterials.apply({ body: soft, mesh }, 'glass'); soft.__matBornT = 0;
    soft.dispatchEvent({ type: 'collide', contact: { getImpactVelocityAlongNormal: () => 2 } });
    ok(LLMaterials.pendingShatter.indexOf(soft) < 0, 'soft impact does not shatter');
    // word switch
    LLMaterials.onWord('RUBBER'); ok(LLMaterials.getCurrent() === 'rubber', 'word RUBBER switches material');
}
console.log(`LLF-73 materials: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
