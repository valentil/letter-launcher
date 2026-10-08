// LLF-11: Keystroke velocity projectiles. Browsers expose no key pressure, so "force" is
// derived from (a) typing speed (interval since the previous key), (b) hold duration
// keydown->keyup (short sharp tap = punchy) and (c) repeats of the same key.
// Pure functions are exported on window.KeyForce (and module.exports for node tests).
const KF_MIN_SCALE = 0.8;
const KF_MAX_SCALE = 1.6;
const KF_HARD = 0.8;          // force at/above this gets shake + louder tone
const KF_TAP_MS = 140;        // holds shorter than this count as a sharp tap
const KF_state = { lastTime: 0, lastKey: '', repeat: 0, downAt: {}, lastBody: {}, shake: 0 };

function kfClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Speed term: 0 for >=600ms gaps (or first key), 1 for <=60ms gaps.
function kfSpeedForce(intervalMs) {
    if (!(intervalMs > 0)) return 0;
    return kfClamp((600 - intervalMs) / 540, 0, 1);
}
// Repeat term: each consecutive repeat of the same key adds 0.2, capped at 1.
function kfRepeatForce(repeat) { return kfClamp((repeat - 1) * 0.2, 0, 1); }
// Hold term (applied on keyup): 1 for instant taps, 0 once held >= 400ms.
function kfHoldForce(holdMs) {
    if (!(holdMs >= 0)) return 0;
    return kfClamp((400 - holdMs) / (400 - 40), 0, 1);
}
// Combine terms into a 0..1 force.
function kfCombine(speed, repeat, hold) {
    return kfClamp(0.6 * speed + 0.25 * repeat + 0.15 * (hold || 0), 0, 1);
}
function kfScaleFor(force) { return KF_MIN_SCALE + kfClamp(force, 0, 1) * (KF_MAX_SCALE - KF_MIN_SCALE); }
function kfMassFor(scale) { return scale * scale * scale; }
// Impulse components, before mass: pulls toward scene centre and up.
function kfImpulseFor(force) {
    const f = kfClamp(force, 0, 1);
    return { toCentre: 1 + 7 * f, up: 1 + 9 * f };
}

// Called on keydown; returns spawn opts {scale, impulse, force, hard} for spawnLetter.
function keyForceOnDown(key, now) {
    const t = now || Date.now();
    const k = String(key).toUpperCase();
    const interval = KF_state.lastTime ? t - KF_state.lastTime : 0;
    KF_state.repeat = (k === KF_state.lastKey && interval > 0 && interval < 500) ? KF_state.repeat + 1 : 1;
    KF_state.lastKey = k; KF_state.lastTime = t;
    KF_state.downAt[k] = t;
    const force = kfCombine(kfSpeedForce(interval), kfRepeatForce(KF_state.repeat), 0);
    const hard = force >= KF_HARD;
    if (hard) KF_state.shake = Math.max(KF_state.shake, 0.15 + 0.25 * force);
    return { scale: kfScaleFor(force), impulse: kfImpulseFor(force), force: force, hard: hard };
}
// Remember the body spawned for a key so keyup can punch it if the tap was sharp.
function keyForceRegister(key, obj) { if (obj && obj.body) KF_state.lastBody[String(key).toUpperCase()] = obj; }
// Called on keyup: a sharp tap adds a small extra kick to the still-fresh body.
function keyForceOnUp(key, now) {
    try {
        const k = String(key).toUpperCase();
        const t = now || Date.now();
        const down = KF_state.downAt[k];
        const obj = KF_state.lastBody[k];
        delete KF_state.downAt[k]; delete KF_state.lastBody[k];
        if (down == null) return 0;
        const hold = t - down;
        if (hold > KF_TAP_MS || !obj || !obj.body || typeof CANNON === 'undefined') return 0;
        const bonus = kfHoldForce(hold) * 3 * obj.body.mass;
        obj.body.applyImpulse(new CANNON.Vec3(0, bonus, 0), obj.body.position);
        return bonus;
    } catch (e) { return 0; }
}
// Per-frame: jitter the camera by the decaying shake amount. Camera lerps back on its own.
function keyForceApplyShake(cam) {
    if (!cam || KF_state.shake < 0.005) { KF_state.shake = 0; return; }
    const s = KF_state.shake;
    cam.position.x += (Math.random() - 0.5) * s;
    cam.position.y += (Math.random() - 0.5) * s;
    KF_state.shake *= 0.85;
}

if (typeof window !== 'undefined') {
    window.KeyForce = { speedForce: kfSpeedForce, repeatForce: kfRepeatForce, holdForce: kfHoldForce,
        combine: kfCombine, scaleFor: kfScaleFor, massFor: kfMassFor, impulseFor: kfImpulseFor,
        state: KF_state, MIN_SCALE: KF_MIN_SCALE, MAX_SCALE: KF_MAX_SCALE, HARD: KF_HARD };
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { kfSpeedForce, kfRepeatForce, kfHoldForce, kfCombine, kfScaleFor, kfMassFor,
        kfImpulseFor, keyForceOnDown, keyForceOnUp, keyForceRegister, keyForceApplyShake, KF_state, KF_HARD };
}

// LLF-91 hook bus: registered here instead of one-liners in menu.js / engine.js.
if (typeof LLHooks !== 'undefined') {
    LLHooks.on('letterKey', function (char, now, opts) {
        const kf = keyForceOnDown(char, now);
        opts.scale = kf.scale; opts.impulse = kf.impulse; opts.force = kf.force; opts.hard = kf.hard;
        if (kf.hard) opts.toneGain = Math.max(opts.toneGain || 1, 1.8);   // louder tone on hard hits
    });
    LLHooks.on('letterSpawned', function (char, obj) { keyForceRegister(char, obj); });
    LLHooks.on('keyup', function (e) { keyForceOnUp(e.key); });
    LLHooks.on('frame', function () { if (typeof camera !== 'undefined') keyForceApplyShake(camera); });
}
