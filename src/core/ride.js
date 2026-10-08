// Letter Launcher — src/core/ride.js (LLF-10: Animal Ride Mechanic)
// Click-and-hold (>350 ms) a zoo animal, or type RIDE, to ride it in first person.
// Mouse steers the heading (within limits); letters ahead get shoved; release / Escape /
// typing DISMOUNT eases the camera back to its pre-ride pose. While riding, the engine's
// camera lerp, mouse-parallax offset and letter-pile framing are overridden (the camera is
// written last each frame by rideFrame) and restored on dismount. Classic script: top-level
// code only declares, plus the LLHooks registration at the end (LLF-91 hook bus).

const RIDE_HOLD_MS = 350;
const RIDE_BLEND_SEC = 0.8;
const RIDE_STEER_LIMIT = Math.PI / 3;   // +-60 degrees from the mount heading
const RIDE_SPEED = 6;
const RIDE_PUSH_RANGE = 2.5;
const rideState = {
    phase: 'idle',        // idle | mounting | riding | dismounting
    pb: null, k: 0, baseHeading: 0, heading: 0, bobT: 0,
    savedPos: null, savedQuat: null, savedLookAt: null, savedFixedRot: false,
    holdTimer: null
};

function rideIsActive() { return rideState.phase !== 'idle'; }
function rideDrives(pb) { return rideState.pb === pb && rideState.phase !== 'idle'; }

function rideHeadingOf(body) {
    const q = body.quaternion;
    return 2 * Math.atan2(q.y, q.w);
}

function rideFindZoo() {
    const list = (typeof physicsBodies !== 'undefined' ? physicsBodies : []).filter(p => p.type === 'zoo_animal');
    return list.length ? list[list.length - 1] : null;
}

function rideMount(pb) {
    if (rideState.phase !== 'idle' || !pb || !pb.body) return false;
    const s = rideState;
    s.pb = pb; s.phase = 'mounting'; s.k = 0; s.bobT = 0;
    s.savedPos = camera.position.clone();
    s.savedQuat = camera.quaternion.clone();
    s.savedLookAt = currentCameraLookAt.clone();
    s.savedFixedRot = !!pb.body.fixedRotation;
    s.baseHeading = s.heading = rideHeadingOf(pb.body);
    pb.body.fixedRotation = true;
    pb.hookDriven = true;                 // engine skips its zoo wander for this body (LLF-91)
    pb.body.angularVelocity.set(0, 0, 0);
    pb.body.updateMassProperties();
    cameraMouseOffset.set(0, 0, 0);       // suspend mouse parallax
    return true;
}

function rideDismount() {
    const s = rideState;
    if (s.phase === 'idle' || s.phase === 'dismounting') return;
    s.phase = 'dismounting';
}

function rideFinish(restoreCamera) {
    const s = rideState;
    if (s.holdTimer) { clearTimeout(s.holdTimer); s.holdTimer = null; }
    if (s.pb) delete s.pb.hookDriven;
    if (s.pb && s.pb.body) {
        s.pb.body.fixedRotation = s.savedFixedRot;
        s.pb.body.updateMassProperties();
    }
    if (restoreCamera && s.savedPos) {
        camera.position.copy(s.savedPos);
        camera.quaternion.copy(s.savedQuat);
        currentCameraLookAt.copy(s.savedLookAt);
    }
    // Restore mouse parallax from the last known pointer position.
    if (typeof mouse !== 'undefined') {
        cameraMouseOffset.x = mouse.x * 2.0;
        cameraMouseOffset.y = mouse.y * 1.5;
    }
    s.phase = 'idle'; s.pb = null; s.k = 0;
    s.savedPos = s.savedQuat = s.savedLookAt = null;
}

// Scene swap: drop the ride without any camera snap (the new scene sets its own targets).
function rideReset() { rideFinish(false); }

function rideRidePose(s, out) {
    const body = s.pb.body;
    const half = body.shapes && body.shapes[0] && body.shapes[0].halfExtents;
    const headY = half ? half.y : 1;
    const bob = Math.sin(s.bobT * 6) * 0.08;
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    out.pos.set(body.position.x + fx * 0.5, body.position.y + headY + 0.5 + bob, body.position.z + fz * 0.5);
    out.look.set(out.pos.x + fx * 10, out.pos.y - 0.4 + Math.sin(s.bobT * 3) * 0.05, out.pos.z + fz * 10);
}

const _rideTmp = { pos: null, look: null };

// Called every frame from animate(), after the engine's own camera lerp (so it wins).
function rideFrame(dt) {
    const s = rideState;
    if (s.phase === 'idle') return;
    if (!s.pb || !physicsBodies.includes(s.pb)) { rideFinish(true); return; }
    if (!_rideTmp.pos) { _rideTmp.pos = new THREE.Vector3(); _rideTmp.look = new THREE.Vector3(); }
    dt = Math.min(dt || 1 / 60, 0.1);
    s.bobT += dt;
    cameraMouseOffset.set(0, 0, 0);

    // Steering: mouse x maps to heading offset within limits, smoothed.
    const want = s.baseHeading - Math.max(-1, Math.min(1, mouse.x)) * RIDE_STEER_LIMIT;
    s.heading += (want - s.heading) * Math.min(1, dt * 4);
    const body = s.pb.body;
    if (s.phase !== 'dismounting') {
        body.velocity.x = Math.sin(s.heading) * RIDE_SPEED;
        body.velocity.z = Math.cos(s.heading) * RIDE_SPEED;
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), s.heading);
        ridePushLetters(s);
    } else {
        body.velocity.x *= 0.9; body.velocity.z *= 0.9;
    }

    const step = dt / RIDE_BLEND_SEC;
    if (s.phase === 'mounting') { s.k = Math.min(1, s.k + step); if (s.k >= 1) s.phase = 'riding'; }
    else if (s.phase === 'dismounting') { s.k = Math.max(0, s.k - step); }

    rideRidePose(s, _rideTmp);
    const e = s.k * s.k * (3 - 2 * s.k);
    const rideQuatHolder = new THREE.Object3D();
    rideQuatHolder.position.copy(_rideTmp.pos);
    rideQuatHolder.lookAt(_rideTmp.look);
    camera.position.copy(s.savedPos).lerp(_rideTmp.pos, e);
    camera.quaternion.copy(s.savedQuat).slerp(rideQuatHolder.quaternion, e);
    if (s.phase === 'dismounting' && s.k <= 0) rideFinish(true);
}

function ridePushLetters(s) {
    const body = s.pb.body;
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    const half = body.shapes[0].halfExtents;
    const reach = Math.max(half.x, half.z) + RIDE_PUSH_RANGE;
    for (const pb of physicsBodies) {
        if (pb === s.pb || pb.type === 'zoo_animal' || pb.type === 'npc' || !pb.body) continue;
        const dx = pb.body.position.x - body.position.x, dz = pb.body.position.z - body.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > reach || dist < 1e-3) continue;
        if ((dx * fx + dz * fz) / dist < 0.3) continue;       // only things ahead
        if (Math.abs(pb.body.position.y - body.position.y) > half.y + 2) continue;
        pb.body.applyImpulse(new CANNON.Vec3(fx * 3, 1, fz * 3), pb.body.position);
    }
}

// Mouse hooks (menu.js). Returns nothing; failures are swallowed by the caller.
function rideMouseDown(e) {
    if (e.button !== 0 || menuScreen !== 'PLAYING' || rideState.phase !== 'idle') return;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(physicsBodies.filter(p => p.type === 'zoo_animal').map(p => p.mesh));
    if (!hits.length) return;
    const pb = physicsBodies.find(p => p.mesh === hits[0].object);
    if (rideState.holdTimer) clearTimeout(rideState.holdTimer);
    rideState.holdTimer = setTimeout(() => {
        rideState.holdTimer = null;
        try { rideMount(pb); } catch (err) { console.error('ride mount', err); }
    }, RIDE_HOLD_MS);
}

function rideMouseUp(e) {
    if (rideState.holdTimer) { clearTimeout(rideState.holdTimer); rideState.holdTimer = null; }
    if (e.button === 0) rideDismount();
}

// Keyboard hooks. rideKey returns true when it consumed the key (Escape while riding).
function rideKey(e) {
    if (e.key === 'Escape' && rideState.phase !== 'idle') { rideDismount(); return true; }
    return false;
}

function rideCheckBuffer(buf) {
    if (buf.endsWith('DISMOUNT')) { rideDismount(); return; }
    if (buf.endsWith('RIDE')) { const pb = rideFindZoo(); if (pb) rideMount(pb); }
}

// LLF-91 hook bus: registered here instead of one-liners in engine.js / menu.js / scene_swap.js.
// 'frame' is emitted after the engine's camera lerp, just before render, so the ride camera wins.
if (typeof LLHooks !== 'undefined') {
    LLHooks.on('frame', function (dt) { rideFrame(dt); });
    LLHooks.on('keydown', function (e) { return rideKey(e); });      // true = Escape consumed while riding
    LLHooks.on('typed', function (buf) { rideCheckBuffer(buf); });  // RIDE / DISMOUNT
    LLHooks.on('mousedown', function (e) { rideMouseDown(e); });
    LLHooks.on('mouseup', function (e) { rideMouseUp(e); });
    LLHooks.on('beforeSceneSwap', function () { rideReset(); });
}
