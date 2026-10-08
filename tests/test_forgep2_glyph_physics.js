// LLF-70 [Forge-P2] letters as real CAD solids.
//   1. data: assets/cad/glyph_physics.json has all 36 glyphs, <= 8 hulls of <= 24 verts each, COM
//      inside the bbox, mass/inertia positive, and the O keeps its counter (>= 6 hulls, none
//      covering the centre of the hole).
//   2. assets: glyphs.glb has the 36 glyph_* nodes; the vendored OFL typeface JSON is used and
//      nothing loads Helvetiker from threejs.org any more.
//   3. code: src/core/glyphs.js is wired (index.html before src/robot/, spawnLetter +
//      spellWordInScene use LetterGlyphs.create, retireExcessBodies spares the shared geometry).
//   4. physics (node + cannon 0.6.2 from devDependencies): hull polyhedra build with outward faces
//      (no "faceNormals ... points into the shape" errors); an O dropped flat over a vertical post
//      threads onto it and ends with the post inside its bbox, while an I dropped the same way
//      lands ON the post; a settled pile of 150 letters steps no slower than 1.3x 150 boxes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./_src');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + msg); } }
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- 1. data ----
const phys = JSON.parse(rd('assets/cad/glyph_physics.json'));
const G = phys.glyphs;
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
ok(Object.keys(G).length === 36 && CHARS.every(c => G[c]), 'glyph_physics.json has 36 entries (A-Z, 0-9)');
CHARS.forEach(c => {
    const g = G[c];
    if (!g) return;
    ok(g.hulls.length >= 1 && g.hulls.length <= 8, `${c}: 1..8 hulls (${g.hulls.length})`);
    ok(g.hulls.every(h => h.length >= 6 && h.length <= 24), `${c}: every hull has <= 24 verts`);
    const com = g.com, b = g.bbox;
    ok([0, 1, 2].every(i => com[i] >= b.min[i] - 1e-6 && com[i] <= b.max[i] + 1e-6), `${c}: COM inside bbox`);
    ok(g.volume > 0.05 && g.volume < 0.6, `${c}: CAD volume plausible (${g.volume} m^3)`);
    ok(g.inertia[0][0] > 0 && g.inertia[1][1] > 0 && g.inertia[2][2] > 0 && g.principal.every(v => v > 0), `${c}: positive inertia`);
});
function inHull2(p, ring) {   // ring CCW in xy
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], q = ring[(i + 1) % ring.length];
        if ((q[0] - a[0]) * (p[1] - a[1]) - (q[1] - a[1]) * (p[0] - a[0]) < -1e-9) return false;
    }
    return true;
}
const O = G.O;
ok(O.hulls.length >= 6, `O has >= 6 hulls (hole preserved), has ${O.hulls.length}`);
const holeCentre = [0.6047 - O.com[0], 0.5 - O.com[1]];            // counter centre, glyph frame
ok(!O.hulls.some(h => inHull2(holeCentre, h.slice(0, h.length / 2))), 'no O hull covers the centre of the counter');
['A', 'B', 'D', 'P', 'Q', 'R', '0', '4', '6', '8', '9'].forEach(c =>
    ok(G[c].hulls.length >= 2, `${c}: decomposed into several hulls`));

// ---- 2. assets ----
const glb = require(path.join(ROOT, 'tools/cad/glb.js'));
const s = glb.summary(glb.readGlb(fs.readFileSync(path.join(ROOT, 'assets/cad/glyphs.glb'))));
ok(CHARS.every(c => s.parts.includes('glyph_' + c)) && s.parts.length === 36, 'glyphs.glb has 36 glyph_* nodes');
ok(s.tris.length === 3, 'glyphs.glb carries a 3-level LOD chain');
const manifest = { glyphs: JSON.parse(rd('assets/cad/manifest.d/glyphs.json')) };   // LLF-104: one manifest file per asset
ok(manifest.glyphs && manifest.glyphs.file === 'glyphs.glb', 'manifest.d has the glyphs entry');
const tf = JSON.parse(rd('assets/fonts/archivo_black.typeface.json'));
ok(tf.resolution === 1000 && CHARS.every(c => tf.glyphs[c] && tf.glyphs[c].o), 'vendored typeface JSON has A-Z 0-9 outlines');
ok(fs.existsSync(path.join(ROOT, 'assets/fonts/OFL-ArchivoBlack.txt')) && /Open Font License/.test(rd('assets/fonts/OFL-ArchivoBlack.txt')), 'OFL licence vendored next to the font');
const engine = rd('src/core/engine.js');
ok(/assets\/fonts\/archivo_black\.typeface\.json/.test(engine), 'engine loads the vendored font');
const allSrc = fs.readdirSync(path.join(ROOT, 'src/core')).map(f => rd('src/core/' + f)).join('\n') + rd('index.html');
ok(!/threejs\.org\/examples\/fonts/.test(allSrc), 'no runtime fetch of Helvetiker from threejs.org');

// ---- 3. code wiring ----
const html = rd('index.html');
const gi = html.indexOf('src/core/glyphs.js'), ri = html.indexOf('src/robot/');
ok(gi > 0 && (ri < 0 || gi < ri), 'index.html loads src/core/glyphs.js before src/robot/');
const letters = rd('src/core/letters.js');
const spawnBody = letters.slice(letters.indexOf('function spawnLetter('), letters.indexOf('function spellWordInScene('));
ok(/LetterGlyphs\.create\(char/.test(spawnBody) && /TextGeometry/.test(spawnBody), 'spawnLetter uses LetterGlyphs.create with the TextGeometry fallback kept');
const spellBody = letters.slice(letters.indexOf('function spellWordInScene('), letters.indexOf('function createGravityWell('));
ok(/LetterGlyphs\.create\(char/.test(spellBody), 'spellWordInScene uses LetterGlyphs.create');
ok(/sharedGlyph/.test(engine), 'retireExcessBodies does not dispose the shared glyph geometry');
const glyphsSrc = rd('src/core/glyphs.js');
ok(/window\.LetterGlyphs\s*=\s*LetterGlyphs/.test(glyphsSrc), 'window.LetterGlyphs assigned');
ok(/LetterGlyphs\.preload\(\)/.test(engine), 'engine starts the glyph preload after the font');

// ---- 4. physics ----
let CANNON = null;
try { CANNON = require('cannon'); } catch (e) { /* devDependency missing */ }
if (!CANNON) {
    console.log('  SKIP physics: run `npm install` (cannon is a devDependency)');
} else {
    const errors = [];
    const origErr = console.error, origWarn = console.warn;
    console.error = (...a) => { errors.push(a.join(' ')); };
    console.warn = (...a) => { errors.push(a.join(' ')); };
    const ctx = { console, CANNON, window: {}, Math };
    vm.createContext(ctx);
    vm.runInContext(glyphsSrc, ctx, { filename: 'glyphs.js' });
    const LG = ctx.window.LetterGlyphs;
    LG._setPhysics(phys);
    const all = CHARS.map(c => LG.buildHullShapes(G[c], 0.72));
    console.error = origErr; console.warn = origWarn;
    ok(errors.length === 0, 'hull polyhedra build without console errors (outward CCW faces): ' + errors.slice(0, 2).join(' | '));
    ok(all.every((shapes, i) => shapes.length === G[CHARS[i]].hulls.length), 'one ConvexPolyhedron per hull');
    const mA = LG.massFor('A', 0.72, LG.DENSITY.foam);
    ok(mA > 0.5 && mA < 2, `typed A weighs about the old 1 kg (${mA.toFixed(2)} kg)`);

    function letterBody(ch, scale) {
        const e = G[ch], body = new CANNON.Body({ mass: LG.massFor(ch, scale, LG.DENSITY.foam) });
        LG.buildHullShapes(e, scale).forEach(sh => body.addShape(sh.shape, sh.offset));
        const f = LG.DENSITY.foam / 1000 * Math.pow(scale, 5);
        body.inertia.set(e.inertia[0][0] * f, e.inertia[1][1] * f, e.inertia[2][2] * f);
        body.invInertia.set(1 / body.inertia.x, 1 / body.inertia.y, 1 / body.inertia.z);
        body.updateInertiaWorld(true);
        return body;
    }
    function dropOnPost(ch, aim) {   // aim: glyph-frame point to centre over the post (default COM)
        const world = new CANNON.World();
        world.gravity.set(0, -9.82, 0);
        world.broadphase = new CANNON.NaiveBroadphase();
        world.solver.iterations = 20;
        const ground = new CANNON.Body({ mass: 0 });
        ground.addShape(new CANNON.Plane());
        ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        world.addBody(ground);
        const post = new CANNON.Body({ mass: 0 });           // 2 m tall, 8 cm square crane-hook post
        post.addShape(new CANNON.Box(new CANNON.Vec3(0.04, 1, 0.04)));
        post.position.set(0, 1, 0);
        world.addBody(post);
        const b = letterBody(ch, 0.72);
        // lie the letter flat (glyph z -> world up) with the counter centre over the post
        b.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        const a = aim || G[ch].com, hc = new CANNON.Vec3((a[0] - G[ch].com[0]) * 0.72, (a[1] - G[ch].com[1]) * 0.72, 0);
        const hw = b.quaternion.vmult(hc);
        b.position.set(-hw.x, 2.6, -hw.z);
        world.addBody(b);
        for (let i = 0; i < 60 * 4; i++) world.step(1 / 60);
        // post in the letter's world AABB?
        b.computeAABB();
        const lo = b.aabb.lowerBound, hi = b.aabb.upperBound;
        return { y: b.position.y, postInside: lo.x < -0.04 && hi.x > 0.04 && lo.z < -0.04 && hi.z > 0.04 && lo.y < 1.5, lo, hi };
    }
    const o = dropOnPost('O', [0.6047, 0.5]);   // the counter centre
    ok(o.postInside && o.y < 1.0, `O threads onto the post and slides down it (y=${o.y.toFixed(2)})`);
    const i1 = dropOnPost('I');
    ok(i1.y > 1.8, `an I cannot thread: it lands on top of the post (y=${i1.y.toFixed(2)})`);

    // settled-pile cost: 150 sleeping glyph letters vs 150 awake boxes (the old letters)
    function pile(kind) {
        const world = new CANNON.World();
        world.gravity.set(0, -9.82, 0);
        world.broadphase = new CANNON.SAPBroadphase(world);
        world.allowSleep = kind === 'glyph';
        const ground = new CANNON.Body({ mass: 0 });
        ground.addShape(new CANNON.Plane());
        ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        world.addBody(ground);
        for (let k = 0; k < 150; k++) {
            const ch = CHARS[k % 36];
            let b;
            if (kind === 'glyph') { b = letterBody(ch, 0.72); b.allowSleep = true; b.sleepSpeedLimit = 0.2; b.sleepTimeLimit = 1; }
            else { b = new CANNON.Body({ mass: 1 }); b.addShape(new CANNON.Box(new CANNON.Vec3(0.35, 0.36, 0.2))); }
            b.position.set((k % 10) * 1.2 - 6, 0.6 + Math.floor(k / 10) * 0.05, (Math.floor(k / 10) % 15) * 1.2 - 9);
            world.addBody(b);
        }
        for (let i = 0; i < 60 * 4; i++) world.step(1 / 60);
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < 120; i++) world.step(1 / 60);
        return Number(process.hrtime.bigint() - t0) / 1e6 / 120;
    }
    const tBox = pile('box'), tGlyph = pile('glyph');
    console.log(`  settled 150-letter step: boxes ${tBox.toFixed(3)} ms, CAD glyphs ${tGlyph.toFixed(3)} ms`);
    ok(tGlyph <= tBox * 1.3 + 0.05, `settled glyph pile steps within 1.3x of the box pile (${tGlyph.toFixed(3)} vs ${tBox.toFixed(3)} ms)`);
}

console.log(`test_forgep2_glyph_physics: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
