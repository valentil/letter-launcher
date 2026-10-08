// LLF-14 Letter Sculpting Tool: alt+drag a letter, drop it touching another letter and the two
// fuse with a CANNON.LockConstraint (weld spark + clink). Fused groups move as one (the
// constraints carry the rest of the group). Type UNWELD or BREAK to separate the most recent fuse.
// Plain left-drag stays the impulse tool and shift+click stays constellations; this file only
// consumes alt+left-drag. Wired through LLHooks at the end of the file (docs/HOOKS.md).

const SCULPT_MAX_FUSES = 40;      // cap: further fuses are refused with a dull clink
const SCULPT_MAX_SPARKS = 12;     // concurrent spark bursts
const SCULPT_TOUCH_MARGIN = 0.06; // AABB slack (m) that still counts as touching
const SCULPT_LOCK_FORCE = 1e6;
let sculptFuses = [];             // { a: pb, b: pb, constraint }, oldest first
let sculptDrag = null;            // { pb, plane, offset, anchor }
let sculptSparks = [];

function sculptIsLetter(pb) { return !!(pb && pb.char && pb.body && pb.type !== 'npc' && pb.type !== 'zoo_animal'); }

function sculptGroupOf(pb) {
    const group = [pb];
    for (let i = 0; i < group.length; i++) {
        sculptFuses.forEach(f => {
            if (f.a === group[i] && group.indexOf(f.b) < 0) group.push(f.b);
            if (f.b === group[i] && group.indexOf(f.a) < 0) group.push(f.a);
        });
    }
    return group;
}

function sculptPick() {
    raycaster.setFromCamera(mouse, camera);
    const meshes = physicsBodies.filter(sculptIsLetter).filter(pb => pb.mesh).map(pb => pb.mesh);
    const hits = raycaster.intersectObjects(meshes, true);
    for (let h = 0; h < hits.length; h++) {
        let o = hits[h].object;
        while (o) {
            const pb = physicsBodies.find(p => p.mesh === o);
            if (pb && sculptIsLetter(pb)) return { pb: pb, point: hits[h].point };
            o = o.parent;
        }
    }
    return null;
}

function sculptMouseDown(e) {
    if (e.button !== 0 || !e.altKey || menuScreen !== 'PLAYING') return false;
    const hit = sculptPick();
    if (!hit) return false;
    const n = new THREE.Vector3();
    camera.getWorldDirection(n);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point);
    const p = hit.point;
    sculptDrag = { pb: hit.pb, plane: plane, offset: new THREE.Vector3(hit.pb.body.position.x - p.x, hit.pb.body.position.y - p.y, hit.pb.body.position.z - p.z) };
    sculptGroupOf(hit.pb).forEach(g => { if (g.body.wakeUp) g.body.wakeUp(); });
    return true; // consumed: no impulse / constellation
}

function sculptCarry() {
    const d = sculptDrag;
    if (!d) return;
    if (physicsBodies.indexOf(d.pb) < 0) { sculptDrag = null; return; }
    raycaster.setFromCamera(mouse, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(d.plane, pt)) return;
    const b = d.pb.body;
    const vx = (pt.x + d.offset.x - b.position.x) * 12, vy = (pt.y + d.offset.y - b.position.y) * 12, vz = (pt.z + d.offset.z - b.position.z) * 12;
    const m = Math.sqrt(vx * vx + vy * vy + vz * vz), k = m > 30 ? 30 / m : 1;
    // every member gets the carry velocity so the fused group translates rigidly (the locks keep the shape)
    sculptGroupOf(d.pb).forEach(g => {
        if (g.body.wakeUp) g.body.wakeUp();
        g.body.velocity.set(vx * k, vy * k, vz * k);
        g.body.angularVelocity.set(0, 0, 0);
    });
}

// A letter (not in `group`) touching any member of the group: solver contacts first, AABB overlap second.
function sculptFindTouch(group) {
    const inGroup = body => group.some(g => g.body === body);
    const pbOf = body => physicsBodies.find(p => p.body === body && sculptIsLetter(p));
    const contacts = (typeof world !== 'undefined' && world.contacts) || [];
    for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i];
        const ai = inGroup(c.bi), bi = inGroup(c.bj);
        if (ai === bi) continue;
        const mine = pbOf(ai ? c.bi : c.bj), other = pbOf(ai ? c.bj : c.bi);
        if (mine && other) return { a: mine, b: other };
    }
    const mAabb = (b) => { if (b.computeAABB) b.computeAABB(); return b.aabb; };
    for (let i = 0; i < group.length; i++) {
        const A = mAabb(group[i].body);
        if (!A) continue;
        for (let j = 0; j < physicsBodies.length; j++) {
            const o = physicsBodies[j];
            if (!sculptIsLetter(o) || group.indexOf(o) >= 0) continue;
            const B = mAabb(o.body);
            if (!B) continue;
            const m = SCULPT_TOUCH_MARGIN;
            if (A.lowerBound.x - m <= B.upperBound.x && A.upperBound.x + m >= B.lowerBound.x &&
                A.lowerBound.y - m <= B.upperBound.y && A.upperBound.y + m >= B.lowerBound.y &&
                A.lowerBound.z - m <= B.upperBound.z && A.upperBound.z + m >= B.lowerBound.z) return { a: group[i], b: o };
        }
    }
    return null;
}

function sculptFuse(a, b) {
    if (!sculptIsLetter(a) || !sculptIsLetter(b) || a === b) return null;
    if (sculptGroupOf(a).indexOf(b) >= 0) return null;           // already one rigid group
    if (sculptFuses.length >= SCULPT_MAX_FUSES) return null;     // cap
    const c = new CANNON.LockConstraint(a.body, b.body, { maxForce: SCULPT_LOCK_FORCE });
    c.collideConnected = false;
    world.addConstraint(c);
    const f = { a: a, b: b, constraint: c };
    sculptFuses.push(f);
    sculptSpark(a.body.position, b.body.position);
    sculptClink(true);
    return f;
}

function sculptUnweld() {
    const f = sculptFuses.pop();
    if (!f) return false;
    try { world.removeConstraint(f.constraint); } catch (err) { /* world already rebuilt */ }
    [f.a, f.b].forEach(p => { if (p.body && p.body.wakeUp) p.body.wakeUp(); });
    sculptClink(false);
    return true;
}

function sculptMouseUp(e) {
    if (!sculptDrag) return false;
    const pb = sculptDrag.pb;
    sculptDrag = null;
    if (physicsBodies.indexOf(pb) < 0) return true;
    pb.body.velocity.set(0, 0, 0);
    const group = sculptGroupOf(pb);
    const t = sculptFindTouch(group);
    if (t) {
        if (!sculptFuse(t.a, t.b)) sculptClink(false);
    }
    return true;
}

function sculptSpark(p, q) {
    if (typeof scene === 'undefined' || typeof THREE === 'undefined') return;
    if (sculptSparks.length >= SCULPT_MAX_SPARKS) sculptDisposeSpark(sculptSparks.shift());
    const N = 24, cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2, cz = (p.z + q.z) / 2;
    const pos = new Float32Array(N * 3), vel = [];
    for (let i = 0; i < N; i++) {
        pos[i * 3] = cx; pos[i * 3 + 1] = cy; pos[i * 3 + 2] = cz;
        const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = 2 + Math.random() * 3;
        vel.push([s * Math.sin(ph) * Math.cos(th), s * Math.cos(ph), s * Math.sin(ph) * Math.sin(th)]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffd27a, size: 0.12, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    sculptSparks.push({ pts: pts, geo: geo, mat: mat, vel: vel, age: 0 });
}

function sculptDisposeSpark(s) {
    if (!s) return;
    if (typeof scene !== 'undefined') scene.remove(s.pts);
    s.geo.dispose(); s.mat.dispose();
}

function sculptUpdateSparks(dt) {
    sculptSparks = sculptSparks.filter(s => {
        s.age += dt;
        if (s.age >= 0.5) { sculptDisposeSpark(s); return false; }
        const a = s.geo.attributes.position.array;
        for (let i = 0; i < s.vel.length; i++) {
            s.vel[i][1] -= 9 * dt;
            a[i * 3] += s.vel[i][0] * dt; a[i * 3 + 1] += s.vel[i][1] * dt; a[i * 3 + 2] += s.vel[i][2] * dt;
        }
        s.geo.attributes.position.needsUpdate = true;
        s.mat.opacity = 1 - s.age / 0.5;
        return true;
    });
}

function sculptClink(good) {
    try {
        if (typeof initAudio === 'function') initAudio();
        if (typeof audioCtx === 'undefined' || !audioCtx) return;
        const t = audioCtx.currentTime, vol = (typeof soundVolume === 'number' ? soundVolume : 1);
        (good ? [1760, 2637] : [220]).forEach((f, i) => {
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.15 * vol, t + 0.005 + i * 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(t); o.stop(t + 0.4);
        });
    } catch (err) { /* audio is optional */ }
}

// Drop fuses whose letters were retired by the body cap, so no constraint outlives its bodies.
function sculptPrune() {
    sculptFuses = sculptFuses.filter(f => {
        if (physicsBodies.indexOf(f.a) >= 0 && physicsBodies.indexOf(f.b) >= 0) return true;
        try { world.removeConstraint(f.constraint); } catch (err) { /* ignore */ }
        return false;
    });
}

function sculptFrame(dt) {
    if (sculptFuses.length) sculptPrune();
    sculptCarry();
    sculptUpdateSparks(dt || 0.016);
}

function sculptBuffer(buf) {
    if (!sculptFuses.length || !/(UNWELD|BREAK)$/i.test(buf)) return false;
    return sculptUnweld(); // true consumes the buffer so BREAK doesn't also fire its word
}

function sculptWord(word) {
    if (/^(UNWELD|BREAK)$/i.test(word)) sculptUnweld();
}

function sculptReset() {
    sculptFuses.forEach(f => { try { world.removeConstraint(f.constraint); } catch (err) { /* ignore */ } });
    sculptFuses = [];
    sculptDrag = null;
    sculptSparks.forEach(sculptDisposeSpark);
    sculptSparks = [];
}

if (typeof LLHooks !== 'undefined') {
    LLHooks.on('mousedown', function (e) { return sculptMouseDown(e); });   // alt+left only; true = consumed
    LLHooks.on('mouseup', function (e) { return sculptMouseUp(e); });
    LLHooks.on('frame', function (dt) { sculptFrame(dt); });
    LLHooks.on('typed', function (buf) { return sculptBuffer(buf); });      // UNWELD / BREAK
    LLHooks.on('word', function (w) { sculptWord(w); });
    LLHooks.on('beforeSceneSwap', function () { sculptReset(); });
}
