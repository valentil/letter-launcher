/**
 * LLF-8: Zoo Stampede Mode. Static wiring checks + a vm run of src/core/stampede.js
 * against stubbed THREE/CANNON globals.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readAllSource } = require('./_src');
const ROOT = path.join(__dirname, '..');
const src = readAllSource();
const code = fs.readFileSync(path.join(ROOT, 'src/core/stampede.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

try {
    // wiring
    assert(html.indexOf('src/core/stampede.js') > 0 && html.indexOf('src/core/stampede.js') < html.indexOf('src/robot/kinematics.js'), 'stampede.js tag before robot tags');
    // LLF-91: wired through the LLHooks bus from stampede.js, not core-file one-liners
    assert(/LLHooks\.on\('typed',[^\n]*return stampedeCheck\(buffer\)/.test(code), 'word trigger registered on typed (consumes)');
    assert(/LLHooks\.on\('frame',[^\n]*updateStampede\(\)/.test(code), 'per-frame update registered on frame');
    assert(html.indexOf('src/core/stampede.js') > html.indexOf('src/core/hooks.js'), 'stampede.js loads after hooks.js');
    assert(!/stampedeCheck\(|updateStampede\(/.test(fs.readFileSync(path.join(ROOT, 'src/core/menu.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8')), 'no stampede one-liners in core files');
    assert(/LLHooks\.emit\('typed', inputBuffer\)\) \{ inputBuffer = ""/.test(src), 'menu clears the buffer when typed is consumed');
    assert(/'STAMPEDE'/.test(code) && /'ZOOZOO'/.test(code), 'both trigger words');
    assert(/spawnZooAnimal\(kind\)/.test(code), 'uses existing spawnZooAnimal');

    // behaviour
    const mkVec = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }, setScalar(s) { this.x = this.y = this.z = s; }, multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; } });
    const sceneObjs = new Set();
    const removed = [];
    const ctx = {
        console, Math, Date,
        font: {}, DEFAULT_FLOOR_Y: -5.1, playBounds: null, soundVolume: 1, audioCtx: null,
        initAudio() {},
        physicsBodies: [],
        scene: { add: m => sceneObjs.add(m), remove: m => sceneObjs.delete(m) },
        world: { removeBody: b => removed.push(b) },
        camera: { position: mkVec() },
        CANNON: { Vec3: function (x, y, z) { return mkVec(x, y, z); }, Body: { KINEMATIC: 4 } },
        THREE: {
            SphereGeometry: function () { this.dispose = () => {}; },
            MeshBasicMaterial: function () { this.opacity = 1; this.dispose = () => {}; },
            Mesh: function (g, m) { this.geometry = g; this.material = m; this.position = mkVec(); this.scale = mkVec(1, 1, 1); }
        }
    };
    ctx.spawnZooAnimal = function (kind) {
        const mesh = { position: mkVec(), geometry: { dispose() {} }, material: { dispose() {} } };
        const body = { shapes: [{ halfExtents: mkVec(2, 1, 1) }], position: mkVec(), velocity: mkVec(), angularVelocity: mkVec(), mass: 5, updateMassProperties() {}, applyImpulse(i) { this.imp = i; } };
        sceneObjs.add(mesh);
        ctx.physicsBodies.push({ mesh, body, type: 'zoo_animal', animal: kind });
    };
    vm.createContext(ctx);
    vm.runInContext(code + '\nthis.__api = { stampedeCheck, startStampede, updateStampede, stampedeCount, getState: () => stampedeState };', ctx);
    const api = ctx.__api;

    assert.strictEqual(api.stampedeCheck('HELLO'), false);
    for (let i = 0; i < 50; i++) { const n = api.stampedeCount(i / 50); assert(n >= 8 && n <= 14, 'count in 8..14'); }

    // letters near the herd's path
    const letters = [];
    for (let i = 0; i < 5; i++) {
        const mesh = { position: mkVec(), geometry: { dispose() {} }, material: { dispose() {} } };
        const body = { position: mkVec(-8 + i, -4.5, -2 + i), applyImpulse(imp) { this.imp = imp; }, angularVelocity: mkVec() };
        const pb = { mesh, body };
        letters.push(pb); ctx.physicsBodies.push(pb); sceneObjs.add(mesh);
    }
    assert.strictEqual(api.stampedeCheck('XSTAMPEDE'), true, 'STAMPEDE triggers');
    const st = api.getState();
    assert(st && st.animals.length >= 8 && st.animals.length <= 14, 'herd size 8..14, got ' + (st && st.animals.length));
    assert(st.animals.every(a => a.body.position.x < -8), 'herd starts off the left edge');
    assert.strictEqual(api.stampedeCheck('ZOOZOO'), true);
    assert.strictEqual(api.getState(), st, 'no double start while active');

    // run frames with fake time until done
    let t = Date.now(); const realNow = Date.now;
    let frames = 0, flung = 0;
    ctx.Date = { now: () => t };
    vm.runInContext('Date = this.Date', ctx);
    while (api.getState() && frames++ < 5000) {
        t += 33; api.updateStampede();
        flung = Math.max(flung, letters.filter(l => l.body.imp).length);
    }
    assert(frames < 5000, 'stampede terminates');
    assert(flung > 0, 'at least one letter flung by impulse');
    assert.strictEqual(api.getState(), null, 'state cleared');
    assert.strictEqual(ctx.physicsBodies.length, 0, 'scene is clear: no letters or animals remain');
    assert.strictEqual([...sceneObjs].length, 0, 'no meshes (animals, letters, dust) left in the scene');
    console.log('✅ LLF-8 stampede tests passed (' + frames + ' frames, herd ' + st.animals.length + ').');
} catch (err) {
    console.error('❌ LLF-8 test failed:', err.message);
    process.exit(1);
}
