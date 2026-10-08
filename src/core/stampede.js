// LLF-8: Zoo Stampede Mode. Type STAMPEDE (or ZOOZOO) and a herd of the existing zoo
// animals charges across the play area, flinging every letter body they touch and
// retiring it. Classic script: top-level code only declares. Hooks live in
// menu.js (word trigger) and engine.js (per-frame update), both wrapped in try/catch.
const STAMPEDE_WORDS = ['STAMPEDE', 'ZOOZOO'];
const STAMPEDE_KINDS = ['LION', 'ELEPHANT', 'MONKEY', 'ZEBRA', 'GIRAFFE'];
const STAMPEDE_MIN = 8, STAMPEDE_MAX = 14;
const STAMPEDE_SPEED = 14;          // world units / second
const STAMPEDE_MAX_MS = 25000;      // hard safety: herd is always cleaned up by then
const STAMPEDE_MAX_PUFFS = 60;
let stampedeState = null;           // { animals:[], puffs:[], start, lastT, dir, rumble, shake }

function stampedeMatches(buffer) {
    if (!buffer) return false;
    for (const w of STAMPEDE_WORDS) if (buffer.endsWith(w)) return true;
    return false;
}

function stampedeCount(rnd) {
    return STAMPEDE_MIN + Math.floor((rnd == null ? Math.random() : rnd) * (STAMPEDE_MAX - STAMPEDE_MIN + 1));
}

// Called from the key handler. Returns true when the buffer completed a trigger word
// (caller then clears its buffer).
function stampedeCheck(buffer) {
    if (!stampedeMatches(buffer)) return false;
    if (!stampedeState) startStampede();
    return true;
}

function stampedeRumble(seconds) {
    try {
        initAudio();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(38, now);
        osc.frequency.linearRampToValueAtTime(55, now + seconds * 0.5);
        osc.frequency.linearRampToValueAtTime(30, now + seconds);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12 * soundVolume, now + 0.4);
        gain.gain.linearRampToValueAtTime(0.01, now + seconds);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + seconds);
    } catch (e) { /* audio is optional */ }
}

function startStampede() {
    if (!font) return;
    const b = (typeof playBounds !== 'undefined' && playBounds) ? playBounds
        : { minX: -8, maxX: 8, minZ: -9, maxZ: 5, floorY: DEFAULT_FLOOR_Y };
    const n = stampedeCount();
    const animals = [];
    for (let i = 0; i < n; i++) {
        const kind = STAMPEDE_KINDS[i % STAMPEDE_KINDS.length];
        spawnZooAnimal(kind);              // existing mesh/body/sound path (also enforces body cap)
        // newest un-tagged zoo animal of that kind
        let mine = null;
        for (let k = physicsBodies.length - 1; k >= 0; k--) {
            const p = physicsBodies[k];
            if (p.type === 'zoo_animal' && p.animal === kind && !p.stampede) { mine = p; break; }
        }
        if (!mine) continue;
        mine.type = 'stampede_animal';     // keeps the wander + click logic off the herd
        mine.stampede = true;
        const half = mine.body.shapes[0].halfExtents;
        const body = mine.body;
        body.mass = 0;
        body.type = CANNON.Body.KINEMATIC;
        body.updateMassProperties();
        body.fixedRotation = true;
        body.angularVelocity.set(0, 0, 0);
        const zSpan = (b.maxZ - b.minZ);
        const lane = (i + Math.random() * 0.6) / n;                 // spread across the depth
        const x = b.minX - 3 - half.x - Math.random() * 8;          // staggered behind the left edge
        const z = b.minZ + lane * zSpan;
        const y = b.floorY + half.y + 0.05;
        body.position.set(x, y, z);
        body.velocity.set(STAMPEDE_SPEED * (0.85 + Math.random() * 0.3), 0, 0);
        body.collisionResponse = false;    // we handle the fling ourselves, no solver fights
        mine.mesh.position.copy(body.position);
        animals.push(mine);
    }
    stampedeState = {
        animals, puffs: [], start: Date.now(), lastT: Date.now(), exitX: b.maxX + 6,
        puffGeo: new THREE.SphereGeometry(0.35, 6, 6), shake: 0
    };
    stampedeRumble(6);
}

function stampedeDust(st, pos, size) {
    if (st.puffs.length >= STAMPEDE_MAX_PUFFS) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0xc8b48c, transparent: true, opacity: 0.6, depthWrite: false });
    const m = new THREE.Mesh(st.puffGeo, mat);
    m.position.set(pos.x - size.x * 0.5, pos.y - size.y + 0.2, pos.z + (Math.random() - 0.5) * size.z);
    m.scale.setScalar(0.6 + Math.random() * 0.8);
    scene.add(m);
    st.puffs.push({ mesh: m, life: 1, vy: 0.8 + Math.random() * 1.2 });
}

function stampedeRemove(pb) {
    const i = physicsBodies.indexOf(pb);
    if (i !== -1) physicsBodies.splice(i, 1);
    scene.remove(pb.mesh);
    world.removeBody(pb.body);
    if (pb.mesh.geometry) pb.mesh.geometry.dispose();
    if (pb.mesh.material) pb.mesh.material.dispose();
}

function stampedeFinish(st) {
    for (const a of st.animals) stampedeRemove(a);
    for (const p of st.puffs) { scene.remove(p.mesh); p.mesh.material.dispose(); }
    st.puffGeo.dispose();
    // Scene must end clear: retire any remaining letter bodies (untyped bodies)
    const letters = physicsBodies.filter(p => !p.type && p.mesh && p.body);
    for (const l of letters) stampedeRemove(l);
    stampedeState = null;
}

// Per-frame update, called from animate() before render (wrapped in try/catch there).
function updateStampede() {
    const st = stampedeState;
    if (!st) return;
    const now = Date.now();
    const dt = Math.min(0.05, (now - st.lastT) / 1000);
    st.lastT = now;

    // Herd advance (kinematic velocity is also set so the world agrees)
    let alive = 0;
    for (const a of st.animals) {
        if (a.done) continue;
        const bd = a.body;
        bd.position.x += bd.velocity.x * dt;
        a.mesh.position.copy(bd.position);
        const half = bd.shapes[0].halfExtents;
        if (bd.position.x - half.x > st.exitX) { a.done = true; continue; }
        alive++;
        if (Math.random() < 0.35) stampedeDust(st, bd.position, half);

        // Fling every letter body we overlap
        for (const l of physicsBodies) {
            if (l.type || l.stampedeDie || !l.body || !l.mesh) continue;
            const lp = l.body.position;
            if (Math.abs(lp.x - bd.position.x) <= half.x + 0.8 &&
                Math.abs(lp.z - bd.position.z) <= half.z + 1.5 &&
                Math.abs(lp.y - bd.position.y) <= half.y + 2) {
                const imp = new CANNON.Vec3(8 + Math.random() * 6, 4 + Math.random() * 5, (Math.random() - 0.5) * 8);
                l.body.applyImpulse(imp, l.body.position);
                l.body.angularVelocity.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
                l.stampedeDie = now + 900 + Math.random() * 500;   // retired after being flung
            }
        }
    }

    // Retire flung letters
    for (const l of physicsBodies.slice()) {
        if (l.stampedeDie && now >= l.stampedeDie) stampedeRemove(l);
    }

    // Dust puffs
    st.puffs = st.puffs.filter(p => {
        p.life -= dt * 1.2;
        p.mesh.position.y += p.vy * dt;
        p.mesh.scale.multiplyScalar(1 + dt * 1.5);
        p.mesh.material.opacity = Math.max(0, p.life * 0.6);
        if (p.life <= 0) { scene.remove(p.mesh); p.mesh.material.dispose(); return false; }
        return true;
    });

    // Camera shake (animate re-lerps the camera each frame, so this offset never accumulates)
    if (alive > 0) {
        camera.position.x += (Math.random() - 0.5) * 0.5;
        camera.position.y += (Math.random() - 0.5) * 0.5;
    }

    if (alive === 0 || now - st.start > STAMPEDE_MAX_MS) stampedeFinish(st);
}
