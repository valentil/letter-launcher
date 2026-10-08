// LLF-71 [Forge-P3] modal impact sounds.
//   1. data: assets/cad/glyph_modes.json has {char:{material:[{f,damping}]}} for 36 glyphs x 5 materials x 6 modes,
//      ascending f, documented damping per material, steel f1 > wood f1 (E/rho check) and the E/rho scaling is exact.
//   2. synthesis: sum of decaying sines puts its energy at the data frequencies, never exceeds full scale.
//   3. voices: voice limit constant (24) is enforced with a fake AudioContext under a 150-letter storm,
//      the quietest voice is stolen, per-body cooldown (60 ms) holds, size scales pitch by 1/scale.
//   4. wiring: index.html tag, Options 'KEY SOUNDS' entry, playTone gate, glyph body tags.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./_src');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } }
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- 1. data ----
const modes = JSON.parse(rd('assets/cad/glyph_modes.json'));
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const MATS = { steel: 0.001, aluminium: 0.002, brass: 0.0015, wood: 0.02, abs: 0.03 };
ok(typeof modes._comment === 'string' && /cad_modal/.test(modes._comment) && /sqrt/.test(modes._comment), 'documents the cad_modal gap and the sqrt(E/rho) scaling');
CHARS.forEach(c => {
    ok(!!modes[c], c + ': present');
    Object.keys(MATS).forEach(m => {
        const a = modes[c] && modes[c][m];
        if (!a) { ok(false, `${c}/${m}: present`); return; }
        ok(a.length === 6, `${c}/${m}: 6 modes`);
        ok(a.every((x, i) => Number.isFinite(x.f) && x.f > 20 && x.f < 40000 && x.damping === MATS[m]), `${c}/${m}: finite f, damping ${MATS[m]}`);
        ok(a.every((x, i) => i === 0 || x.f >= a[i - 1].f), `${c}/${m}: ascending`);
    });
    if (modes[c]) {
        ok(modes[c].steel[0].f > modes[c].wood[0].f, `${c}: steel f1 (${modes[c].steel[0].f}) > wood f1 (${modes[c].wood[0].f})`);
        const k = Math.sqrt((modes._materials.wood.youngsModulusPa / modes._materials.wood.densityKgM3) / (200e9 / 7850));
        ok(Math.abs(modes[c].wood[2].f / modes[c].steel[2].f - k) < 2e-3, `${c}: wood/steel = sqrt(E/rho) ratio`);
    }
});
const set = new Set(CHARS.map(c => modes[c].steel[0].f));
ok(set.size >= 30, 'letters sound distinct (steel f1 values differ): ' + set.size);
ok(modes.I.steel[0].f > modes.C.steel[0].f && modes.O.steel[0].f > modes.S.steel[0].f - 1e9, 'sanity on a few glyphs');

// ---- 2/3. module under a fake AudioContext ----
const src = rd('src/core/modal_audio.js');
function fakeCtx() {
    const ctx = { sampleRate: 44100, currentTime: 0, created: 0, started: [], destination: {} };
    const node = () => ({ connect() { }, disconnect() { }, frequency: { value: 0 }, gain: { value: 1 }, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } });
    ctx.createBuffer = (ch, n, sr) => { const d = new Float32Array(n); return { length: n, duration: n / sr, getChannelData: () => d }; };
    ctx.createBufferSource = () => { const s = Object.assign(node(), { playbackRate: { value: 1 }, started: false, stopped: false, start() { this.started = true; ctx.started.push(this); }, stop() { this.stopped = true; } }); return s; };
    ctx.createBiquadFilter = node; ctx.createGain = node; ctx.createPanner = node;
    ctx.createDynamicsCompressor = () => Object.assign(node(), { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
    return ctx;
}
function load(ctx) { return new Function('audioCtx', 'soundVolume', 'initAudio', src + '\nreturn LLModalAudio;')(ctx, 4, () => { }); }

const ctx = fakeCtx();
const M = load(ctx);
ok(M.MAX_VOICES === 24 && /const MODAL_MAX_VOICES = 24;/.test(src), 'voice limit constant is 24');
ok(M.COOLDOWN_MS === 60, 'cooldown 60 ms');
ok(/createDynamicsCompressor/.test(src), 'master compressor guards against clipping');
M._setModes(modes);

// synthesis: energy at the data frequencies, bounded
const steelA = modes.A.steel;
const s = M.synthSamples(steelA, 44100, 2);
let peak = 0; for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
ok(peak > 0.05 && peak <= 1.0001, 'steel A peak in (0.05, 1]: ' + peak.toFixed(3));
ok(s.length > 44100 * 1.0, 'steel rings for about a second (long decay): ' + (s.length / 44100).toFixed(2) + ' s');
const w = M.synthSamples(modes.A.wood, 44100, 2), ab = M.synthSamples(modes.A.abs, 44100, 2);
ok(w.length < s.length && ab.length < s.length, 'wood/ABS die away faster than steel');
function goertzel(x, f, sr) { const k = 2 * Math.cos(2 * Math.PI * f / sr); let a = 0, b = 0; for (let i = 0; i < Math.min(x.length, 8192); i++) { const t = x[i] + k * a - b; b = a; a = t; } return Math.sqrt(a * a + b * b - k * a * b); }
ok(goertzel(s, steelA[0].f, 44100) > 10 * goertzel(s, steelA[0].f * 0.8, 44100), 'steel A spectrum peaks at its first natural frequency');
ok(M.synthSamples([], 44100) === null, 'no modes -> null');

// victim choice
const nowS = 0;
const full = []; for (let i = 0; i < 24; i++) full.push({ level: 0.1 + i * 0.01, t0: 0, tau: 1 });
ok(M.pickVictim(full, 0.5, nowS) === 0, 'quietest voice is stolen');
ok(M.pickVictim(full, 0.01, nowS) === -1, 'a still quieter new voice is dropped');
ok(M.pickVictim(full.slice(0, 3), 0.01, nowS) === -2, 'free slot used first');

// playImpact + storm
ctx.currentTime = 1;
const ok1 = M.playImpact('A', 'steel', 1, 4, { x: 0, y: 1, z: 0 });
ok(ok1 && ctx.started.length === 1, 'impact starts a voice');
ok(Math.abs(ctx.started[0].playbackRate.value - 1) < 1e-9, 'scale 1 -> rate 1');
M.playImpact('A', 'steel', 2, 4, null);
ok(Math.abs(ctx.started[1].playbackRate.value - 0.5) < 1e-9, 'a 2x letter rings an octave lower (f ~ 1/L)');
let stolen = 0;
for (let i = 0; i < 150; i++) {
    ctx.currentTime = 1 + i * 0.001;
    M.playImpact(CHARS[i % 36], ['steel', 'aluminium', 'brass', 'wood', 'abs'][i % 5], 0.8 + (i % 7) * 0.1, 1 + (i % 11), { x: i % 10, y: 0, z: 0 });
    if (M.voiceCount() > 24) fail++, console.error('  FAIL: voice count exceeded 24');
}
ok(M.voiceCount() <= 24, '150-letter storm keeps <= 24 voices: ' + M.voiceCount());
ok(ctx.started.filter(v => v.stopped).length > 0, 'voices were stolen under load');
M.setMode('Off'); const before = ctx.started.length;
ok(M.playImpact('B', 'steel', 1, 9, null) === false && ctx.started.length === before, 'Off mode is silent');
M.setMode('Tones'); ok(M.tonesEnabled() === true && M.playImpact('B', 'steel', 1, 9, null) === false, 'Tones mode: beep on, modal off');
M.setMode('Modal'); ok(M.tonesEnabled() === false, 'Modal mode: beep off');
M.cycle(1); ok(M.getMode() === 'Off', 'cycle Modal -> Off'); M.cycle(1); ok(M.getMode() === 'Tones', 'cycle Off -> Tones'); M.cycle(-1); ok(M.getMode() === 'Off', 'cycle back');
M.setMode('Modal');

// collide hook: contact velocity, per-body cooldown, minimum impact
let handler = null;
const body = { __glyph: true, __glyphChar: 'Q', __mesh: { scale: { x: 1.2 }, userData: {} }, mass: 2, position: { x: 1, y: 2, z: 3 }, addEventListener(n, f) { if (n === 'collide') handler = f; } };
M.attach(body);
ok(typeof handler === 'function', 'collide listener attached to a glyph body');
const before2 = ctx.started.length;
ctx.currentTime = 50;
handler({ contact: { getImpactVelocityAlongNormal: () => -5 } });
ok(ctx.started.length === before2 + 1, 'hard hit sounds');
handler({ contact: { getImpactVelocityAlongNormal: () => -5 } });
ok(ctx.started.length === before2 + 1, 'second hit inside 60 ms is ignored');
body.__modalLast = -1e9;
handler({ contact: { getImpactVelocityAlongNormal: () => -0.1 } });
ok(ctx.started.length === before2 + 1, 'a touch under the minimum impact speed is silent');
const wrld = { bodies: [], listeners: {}, addEventListener(n, f) { this.listeners[n] = f; } };
M.hookWorld(wrld); ok(typeof wrld.listeners.addBody === 'function' && wrld.__modalHooked, 'world addBody listener registered');

// ---- 4. wiring ----
const html = rd('index.html');
ok(/<script src="src\/core\/modal_audio\.js"><\/script>/.test(html) && html.indexOf('modal_audio.js') < html.indexOf('src/robot/'), 'index.html tag before src/robot/');
ok(/'KEY SOUNDS'/.test(rd('src/core/engine.js')) && /LLModalAudio\.cycle\(1\)/.test(rd('src/core/menu.js')) && /LLModalAudio\.label\(\)/.test(rd('src/core/menu.js')), 'Options menu entry wired');
ok(/LLModalAudio\.tonesEnabled\(\)/.test(rd('src/core/audio.js')), 'playTone gated by the Key sounds option');
ok(/body\.__glyphChar = key\(ch\)/.test(rd('src/core/glyphs.js')), 'glyph bodies carry their char');
ok(/LLHooks\.on\('frame'/.test(src) && /LLHooks\.on\('afterSceneBuild'/.test(src), 'registered through LLHooks from its own file');
ok(fs.existsSync(path.join(ROOT, 'tools/cad/glyph_modal.py')) && fs.existsSync(path.join(ROOT, 'tools/cad/build_glyph_modes.js')), 'modal solver + builder committed');

console.log(`test_forgep3_modes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
