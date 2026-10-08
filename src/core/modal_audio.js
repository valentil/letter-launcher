// LLF-71 [Forge-P3]: modal impact sounds. A struck glyph rings at the natural frequencies of its
// real solid (assets/cad/glyph_modes.json, first 6 free-free modes per material, see
// tools/cad/glyph_modal.py). Each (char, material) is synthesized once into an AudioBuffer (sum of
// exponentially decaying sines); a hit plays it with playbackRate = 1/size (f ~ 1/L), gain ~ sqrt(impulse)
// and a PannerNode at the letter. Max MODAL_MAX_VOICES at once, the quietest is stolen; every glyph
// body has a 60 ms cooldown. Collisions are hooked from here: a cannon 'addBody' listener attaches a
// 'collide' handler to every glyph body (glyphs.js only tags body.__glyphChar / body.__mesh).
// Options menu 'KEY SOUNDS': Tones (old keystroke beep) / Modal / Off. Classic <script>.
const MODAL_MAX_VOICES = 24;       // voice limit; the quietest voice is stolen
const MODAL_COOLDOWN_MS = 60;      // per-body re-trigger gap
const MODAL_MODES = 6;
const MODAL_MIN_IMPACT = 0.4;      // m/s along the contact normal below which a touch is silent
const MODAL_MAX_BUFFER_S = 2.0;
const MODAL_MAX_CACHED = 48;       // synthesized buffers kept (LRU)
const MODAL_MATERIALS = ['steel', 'aluminium', 'brass', 'wood', 'abs'];
const MODAL_MODES_URL = 'assets/cad/glyph_modes.json';
const MODAL_STORAGE_KEY = 'letterLauncher.keySounds';
const MODAL_SOUND_MODES = ['Tones', 'Modal', 'Off'];

const LLModalAudio = (function () {
    const api = {};
    let modes = null;                 // parsed glyph_modes.json
    let loadState = 'idle';           // idle | loading | ready | failed
    let mode = 'Modal';
    const voices = [];                // {src, gain, level, t0, tau}
    const cache = new Map();          // 'C|material' -> AudioBuffer (insertion order = LRU)
    let master = null;                // shared compressor so 150 letters cannot clip
    const hooked = new WeakSet();

    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(MODAL_STORAGE_KEY); if (MODAL_SOUND_MODES.indexOf(s) >= 0) mode = s; } catch (_) { }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function key(ch) { return String(ch || '').toUpperCase(); }

    // ---- option state ----
    function getMode() { return mode; }
    function setMode(m) {
        if (MODAL_SOUND_MODES.indexOf(m) < 0) return;
        mode = m;
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(MODAL_STORAGE_KEY, m); } catch (_) { }
    }
    function cycle(dir) { setMode(MODAL_SOUND_MODES[(MODAL_SOUND_MODES.indexOf(mode) + (dir < 0 ? -1 : 1) + MODAL_SOUND_MODES.length) % MODAL_SOUND_MODES.length]); }
    function label() { return 'KEY SOUNDS: ' + mode.toUpperCase(); }
    function tonesEnabled() { return mode === 'Tones'; }

    // ---- data ----
    function load() {
        if (loadState !== 'idle' || typeof fetch === 'undefined') return;
        loadState = 'loading';
        fetch(MODAL_MODES_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) { modes = j; loadState = 'ready'; })
            .catch(function (e) { loadState = 'failed'; try { console.warn('[LLModalAudio] glyph_modes.json unavailable, falling back to tones', e && e.message); } catch (_) { } });
    }
    function ready() { return !!modes; }
    function _setModes(j) { modes = j; loadState = 'ready'; }
    function modesFor(ch, material) {
        const e = modes && modes[key(ch)];
        return (e && e[material]) || null;
    }
    // Deterministic default material per glyph so each letter keeps its own voice; a body can override
    // with body.__modalMaterial (or mesh.userData.modalMaterial).
    function materialFor(ch, body, mesh) {
        const o = (body && body.__modalMaterial) || (mesh && mesh.userData && mesh.userData.modalMaterial);
        if (o && MODAL_MATERIALS.indexOf(o) >= 0) return o;
        return MODAL_MATERIALS[key(ch).charCodeAt(0) % MODAL_MATERIALS.length];
    }

    // ---- synthesis (pure: returns Float32Array, tested in node) ----
    // Amplitude per mode falls off with mode number (lowest modes carry most of a strike) and a
    // mode only gets audible energy while below Nyquist/2.
    function synthSamples(modeList, sampleRate, maxSeconds) {
        const list = (modeList || []).slice(0, MODAL_MODES);
        if (!list.length) return null;
        const f1 = list[0].f, z1 = Math.max(list[0].damping, 1e-5);
        const dur = clamp(Math.log(1000) / (2 * Math.PI * f1 * z1), 0.12, maxSeconds || MODAL_MAX_BUFFER_S);
        const n = Math.max(1, Math.floor(dur * sampleRate));
        const out = new Float32Array(n);
        let norm = 0;
        list.forEach(function (m, i) {
            if (m.f >= sampleRate * 0.45) return;
            const a = 1 / (1 + 0.6 * i), w = 2 * Math.PI * m.f, d = w * m.damping;
            norm += a;
            for (let k = 0; k < n; k++) { const t = k / sampleRate; out[k] += a * Math.exp(-d * t) * Math.sin(w * t); }
        });
        const fade = Math.min(n, Math.floor(0.02 * sampleRate)), atk = Math.min(n, Math.floor(0.0008 * sampleRate));
        for (let k = 0; k < n; k++) {
            let g = 1 / Math.max(norm, 1e-6);
            if (k < atk) g *= k / atk;
            if (k >= n - fade) g *= (n - k) / fade;
            out[k] *= g;
        }
        return out;
    }

    function bufferFor(ch, material) {
        const ck = key(ch) + '|' + material;
        if (cache.has(ck)) { const b = cache.get(ck); cache.delete(ck); cache.set(ck, b); return b; }
        const ml = modesFor(ch, material);
        if (!ml || typeof audioCtx === 'undefined' || !audioCtx) return null;
        const data = synthSamples(ml, audioCtx.sampleRate, MODAL_MAX_BUFFER_S);
        if (!data) return null;
        const buf = audioCtx.createBuffer(1, data.length, audioCtx.sampleRate);
        buf.getChannelData(0).set(data);
        cache.set(ck, buf);
        if (cache.size > MODAL_MAX_CACHED) cache.delete(cache.keys().next().value);
        return buf;
    }

    // ---- voices ----
    function voiceLevel(v, nowS) { return v.level * Math.exp(-(nowS - v.t0) / v.tau); }
    // Pure helper (tested): returns index of the voice to steal for a new voice of `level`, or -1 to drop the new one.
    function pickVictim(list, level, nowS) {
        if (list.length < MODAL_MAX_VOICES) return -2;     // free slot
        let qi = 0, ql = Infinity;
        for (let i = 0; i < list.length; i++) { const l = voiceLevel(list[i], nowS); if (l < ql) { ql = l; qi = i; } }
        return level > ql ? qi : -1;
    }
    function getMaster() {
        if (master) return master;
        master = audioCtx.createDynamicsCompressor();
        master.threshold.value = -18; master.knee.value = 12; master.ratio.value = 6;
        master.attack.value = 0.003; master.release.value = 0.2;
        master.connect(audioCtx.destination);
        return master;
    }

    // playImpact(char, material, scale, impulse, position) -> true if a voice started
    function playImpact(ch, material, scale, impulse, position) {
        if (mode !== 'Modal' || !ready()) return false;
        if (typeof initAudio === 'function') initAudio();
        if (typeof audioCtx === 'undefined' || !audioCtx) return false;
        const buf = bufferFor(ch, material || materialFor(ch));
        if (!buf) return false;
        const vol = typeof soundVolume === 'number' ? soundVolume : 1;
        const level = clamp(0.03 * Math.sqrt(Math.max(impulse, 0)), 0, 0.2) * clamp(vol, 0, 4) / 2;   // sqrt(impulse), clamped
        if (level <= 0.001) return false;
        const now = audioCtx.currentTime;
        const victim = pickVictim(voices, level, now);
        if (victim === -1) return false;
        if (victim >= 0) { const v = voices.splice(victim, 1)[0]; try { v.src.stop(); } catch (_) { } }

        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 1 / clamp(scale || 1, 0.25, 4);          // f ~ 1/L
        const lp = audioCtx.createBiquadFilter();                         // soft hits are duller (fewer upper modes)
        lp.type = 'lowpass'; lp.frequency.value = clamp(1500 + 900 * Math.sqrt(Math.max(impulse, 0)), 1500, 14000);
        const gain = audioCtx.createGain(); gain.gain.value = level;
        const panner = audioCtx.createPanner();
        panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse'; panner.refDistance = 8;
        if (position) {
            if (panner.positionX) { panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z; }
            else if (panner.setPosition) panner.setPosition(position.x, position.y, position.z);
        }
        src.connect(lp); lp.connect(gain); gain.connect(panner); panner.connect(getMaster());
        const voice = { src: src, level: level, t0: now, tau: Math.max(0.15, buf.duration / 4) };
        voices.push(voice);
        src.onended = function () { const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1); try { panner.disconnect(); } catch (_) { } };
        src.start(now);
        return true;
    }

    // ---- collision hook ----
    function attach(body) {
        if (!body || !body.__glyph || hooked.has(body) || !body.addEventListener) return;
        hooked.add(body);
        body.__modalLast = -1e9;
        body.addEventListener('collide', function (ev) {
            try {
                if (mode !== 'Modal' || !ready()) return;
                const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                if (nowMs - body.__modalLast < MODAL_COOLDOWN_MS) return;
                const c = ev && ev.contact;
                const v = c && c.getImpactVelocityAlongNormal ? Math.abs(c.getImpactVelocityAlongNormal()) : 0;
                if (v < MODAL_MIN_IMPACT) return;
                body.__modalLast = nowMs;
                const ch = body.__glyphChar;  // set by LetterGlyphs.create (glyphs.js)
                if (!ch) return;
                const mesh = body.__mesh || null;
                const scale = (mesh && mesh.scale && mesh.scale.x) || 1;
                // impulse ~ reduced mass * closing speed; use the body mass (the other side is the floor/pile)
                playImpact(ch, materialFor(ch, body, mesh), scale, (body.mass || 1) * v, body.position);
            } catch (_) { }
        });
    }
    function hookWorld(w) {
        if (!w || w.__modalHooked) return;
        w.__modalHooked = true;
        (w.bodies || []).forEach(attach);
        if (w.addEventListener) w.addEventListener('addBody', function (ev) { attach(ev && ev.body); });
    }
    api.MAX_VOICES = MODAL_MAX_VOICES; api.COOLDOWN_MS = MODAL_COOLDOWN_MS; api.MATERIALS = MODAL_MATERIALS;
    api.getMode = getMode; api.setMode = setMode; api.cycle = cycle; api.label = label; api.tonesEnabled = tonesEnabled;
    api.load = load; api.ready = ready; api._setModes = _setModes; api.modesFor = modesFor; api.materialFor = materialFor;
    api.synthSamples = synthSamples; api.pickVictim = pickVictim; api.playImpact = playImpact;
    api.attach = attach; api.hookWorld = hookWorld; api.voiceCount = function () { return voices.length; };
    return api;
})();

if (typeof window !== 'undefined') window.LLModalAudio = LLModalAudio;
if (typeof module !== 'undefined' && module.exports) module.exports = LLModalAudio;
if (typeof LLHooks !== 'undefined') {
    LLModalAudio.load();
    LLHooks.on('afterSceneBuild', function () { if (typeof world !== 'undefined') LLModalAudio.hookWorld(world); });
    LLHooks.on('frame', function () { if (typeof world !== 'undefined' && world && !world.__modalHooked) LLModalAudio.hookWorld(world); });
}
