// LLF-6: Chroma-Key Typing. Typing rhythm drives the hue + emissive glow of newly spawned
// letters: slow = cool blue, fast = hot red/magenta; steadier rhythm = brighter glow.
// Sporadic typing (long gaps / too few keys) keeps the per-letter random colour.
// Classic script: declarations only at top level. No per-frame allocations (scratch objects
// are created once, lazily).
const RHYTHM = {
    ema: 600,        // EMA of inter-key interval (ms)
    dev: 0,          // EMA of |interval - ema| (ms)
    count: 0,        // consecutive "flowing" keys
    last: 0,         // timestamp of last key (ms)
    speed: 0,        // 0 (slow) .. 1 (fast)
    steady: 0,       // 0 (erratic) .. 1 (metronomic)
    conf: 0,         // 0 (sporadic: random colour) .. 1 (full rhythm colour)
    FLOW_GAP: 1200,  // gap above this resets the streak
    SLOW_MS: 900,    // interval mapping to speed 0
    FAST_MS: 90,     // interval mapping to speed 1
    ALPHA: 0.35,
    scratch: null, hud: null, hudDot: null, hudBar: null, hudKey: -1
};

function rhythmClamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// Pure: speed 0..1 -> hue 0..1 (blue 0.62 -> green -> yellow -> red 0 -> magenta 0.88).
function rhythmHue(speed) {
    const h = 0.62 - 0.74 * rhythmClamp01(speed);
    return h < 0 ? h + 1 : h;
}

// Pure: glow intensity from speed + steadiness.
function rhythmGlow(speed, steady) {
    return 0.15 + 1.05 * (0.6 * rhythmClamp01(speed) + 0.4 * rhythmClamp01(steady));
}

// Feed one keystroke timestamp (ms). Updates the tracker state in place.
function rhythmKey(now) {
    const R = RHYTHM;
    const dt = R.last ? now - R.last : Infinity;
    R.last = now;
    if (!(dt < R.FLOW_GAP)) { R.count = 1; R.conf = 0; R.speed = 0; R.steady = 0; R.ema = 600; R.dev = 0; return; }
    const d = dt < 30 ? 30 : dt;
    R.dev += R.ALPHA * (Math.abs(d - R.ema) - R.dev);
    R.ema += R.ALPHA * (d - R.ema);
    R.count++;
    R.speed = rhythmClamp01((R.SLOW_MS - R.ema) / (R.SLOW_MS - R.FAST_MS));
    R.steady = rhythmClamp01(1 - R.dev / R.ema);
    R.conf = rhythmClamp01((R.count - 2) / 3);
}

// Tint a freshly created material (keeps its random colour when typing is sporadic).
function rhythmTint(material) {
    const R = RHYTHM;
    if (!material || R.conf <= 0 || (Date.now() - R.last) > R.FLOW_GAP) return;
    if (!R.scratch) R.scratch = new THREE.Color();
    R.scratch.setHSL(rhythmHue(R.speed), 0.9, 0.55);
    material.color.lerp(R.scratch, R.conf);
    if (material.emissive) {
        material.emissive.copy(R.scratch);
        material.emissiveIntensity = rhythmGlow(R.speed, R.steady) * R.conf;
    }
}

// Subtle HUD indicator; touches the DOM only when the quantised state changes.
function rhythmFrame() {
    const R = RHYTHM;
    if (typeof document === 'undefined') return;
    const live = R.last && (Date.now() - R.last) <= R.FLOW_GAP && R.conf > 0;
    const level = live ? Math.round(R.speed * 10) + 1 : 0;
    const key = level * 4 + Math.round(R.steady * 3);
    if (key === R.hudKey) return;
    R.hudKey = key;
    if (!R.hud) {
        const el = document.createElement('div');
        el.id = 'rhythmHud';
        el.style.cssText = 'position:absolute;right:14px;bottom:14px;width:64px;height:6px;border-radius:3px;' +
            'background:rgba(255,255,255,0.12);pointer-events:none;opacity:0.7;transition:opacity .4s;z-index:50;';
        const bar = document.createElement('div');
        bar.style.cssText = 'height:100%;width:0;border-radius:3px;transition:width .15s,background .15s,box-shadow .15s;';
        el.appendChild(bar);
        document.body.appendChild(el);
        R.hud = el; R.hudBar = bar;
    }
    if (!live) { R.hud.style.opacity = '0.25'; R.hudBar.style.width = '0'; return; }
    const col = 'hsl(' + Math.round(rhythmHue(R.speed) * 360) + ',90%,55%)';
    R.hud.style.opacity = '0.9';
    R.hudBar.style.width = (20 + R.speed * 80).toFixed(0) + '%';
    R.hudBar.style.background = col;
    R.hudBar.style.boxShadow = '0 0 ' + (3 + R.steady * 8).toFixed(0) + 'px ' + col;
}
