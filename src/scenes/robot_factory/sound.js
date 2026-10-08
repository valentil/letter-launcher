/**
 * src/scenes/robot_factory/sound.js — LLF-80 [Robot-7] ROBOT FACTORY cell sounds (Web Audio, no samples).
 * Browser: window.RFSound.  Node: require('./src/scenes/robot_factory/sound.js') (pure helpers only).
 *
 *   servo whine   one voice per arm: sawtooth + square at a pitch proportional to the arm's fastest joint
 *                 (rad/s, smoothed), through a resonant low-pass; silent when the arm is still
 *   pneumatic     filtered white-noise bursts: a long vacuum hiss when the cup grabs, a short exhaust puff on
 *                 release, a sharp double "tsst" when the gripper jaws close/open
 *   clunk         the placed glyph rings with its own modal frequencies (LLModalAudio, LLF-71 Forge-P3) plus a
 *                 low wooden thump from the tray; falls back to the thump alone in Tones / Off modes
 *   conveyor hum  50 Hz mains hum + 100/150 Hz harmonics + rumble noise, louder while a sign rides the belt
 *   fault buzzer  pulsed 180 Hz square while an arm is jammed or the cell is e-stopped by a safety trip
 *
 * All voices hang off one bus gain scaled by the game's soundVolume, so OPTIONS -> VOLUME applies. The graph is
 * built lazily on the first frame where audioCtx exists (after a user gesture) and torn down with the scene.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RFSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SERVO = { fMin: 140, fMax: 820, wMax: 2.4, gainMax: 0.05, smooth: 0.12, deadband: 0.03 };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Fastest joint speed (rad/s) between two joint vectors over dt. */
  function jointSpeed(q0, q1, dt) {
    if (!q0 || !q1 || !(dt > 0)) return 0;
    var m = 0;
    for (var i = 0; i < Math.min(q0.length, q1.length); i++) m = Math.max(m, Math.abs(q1[i] - q0[i]));
    return m / dt;
  }
  /** Servo whine pitch (Hz) and level (0..gainMax) for a joint speed (rad/s): pitch rises with speed. */
  function servoVoice(w) {
    w = Math.max(0, +w || 0);
    var u = clamp(w / SERVO.wMax, 0, 1);
    return { freq: SERVO.fMin + (SERVO.fMax - SERVO.fMin) * Math.sqrt(u), gain: w < SERVO.deadband ? 0 : SERVO.gainMax * Math.min(1, 0.25 + u) };
  }
  /** One-pole low-pass toward x (time constant tau s). */
  function smooth(prev, x, dt, tau) { var k = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-3, tau)); return prev + (x - prev) * k; }

  // ------------------------------------------------------------------ browser graph
  function ctx() { return typeof audioCtx !== 'undefined' && audioCtx ? audioCtx : null; }
  function vol() { return typeof soundVolume === 'number' ? soundVolume : 1; }

  function create(opts) {
    opts = opts || {};
    var A = null, bus = null, noiseBuf = null, arms = [], hum = null, buzz = null, nodes = [];
    var st = { built: false, servo: [], buzzing: false, belt: 0, dead: false };

    function noise() {
      if (noiseBuf) return noiseBuf;
      var n = Math.floor(A.sampleRate * 1.5), b = A.createBuffer(1, n, A.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return (noiseBuf = b);
    }
    function keep(n) { nodes.push(n); return n; }
    function build() {
      if (st.built || st.dead) return st.built;
      A = ctx(); if (!A) return false;
      try {
        bus = keep(A.createGain()); bus.gain.value = 0.9 * clamp(vol(), 0, 4) / 2;
        var comp = keep(A.createDynamicsCompressor()); comp.threshold.value = -20; comp.ratio.value = 4;
        bus.connect(comp); comp.connect(A.destination);
        // servo voices
        for (var i = 0; i < (opts.arms || 2); i++) {
          var o1 = keep(A.createOscillator()), o2 = keep(A.createOscillator()), lp = keep(A.createBiquadFilter()), g = keep(A.createGain());
          o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 700 + i * 37;   // a fifth up, slightly apart per arm
          var g2 = keep(A.createGain()); g2.gain.value = 0.35;
          lp.type = 'lowpass'; lp.Q.value = 6; lp.frequency.value = 900;
          g.gain.value = 0;
          o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(bus);
          o1.frequency.value = SERVO.fMin; o2.frequency.value = SERVO.fMin;
          o1.start(); o2.start();
          arms.push({ o1: o1, o2: o2, lp: lp, g: g, w: 0, q: null });
        }
        // conveyor hum
        var hg = keep(A.createGain()); hg.gain.value = 0.012; hg.connect(bus);
        [50, 100, 150].forEach(function (f, k) {
          var o = keep(A.createOscillator()); o.type = k ? 'sine' : 'triangle'; o.frequency.value = f;
          var og = keep(A.createGain()); og.gain.value = [1, 0.5, 0.2][k]; o.connect(og); og.connect(hg); o.start();
        });
        var rn = keep(A.createBufferSource()); rn.buffer = noise(); rn.loop = true;
        var rlp = keep(A.createBiquadFilter()); rlp.type = 'lowpass'; rlp.frequency.value = 180;
        var rg = keep(A.createGain()); rg.gain.value = 0.6; rn.connect(rlp); rlp.connect(rg); rg.connect(hg); rn.start();
        hum = { g: hg };
        // fault buzzer (gated by an LFO-free envelope from update())
        var bo = keep(A.createOscillator()); bo.type = 'square'; bo.frequency.value = 180;
        var blp = keep(A.createBiquadFilter()); blp.type = 'lowpass'; blp.frequency.value = 1400;
        var bg = keep(A.createGain()); bg.gain.value = 0; bo.connect(blp); blp.connect(bg); bg.connect(bus); bo.start();
        buzz = { g: bg };
        st.built = true;
      } catch (e) { st.dead = true; }
      return st.built;
    }

    function burst(dur, f0, f1, q, level, type) {   // filtered-noise pneumatic burst with a quick attack
      if (!build()) return;
      var t = A.currentTime, s = A.createBufferSource(); s.buffer = noise();
      var f = A.createBiquadFilter(); f.type = type || 'bandpass'; f.Q.value = q || 0.8;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      var g = A.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
      s.onended = function () { try { g.disconnect(); } catch (e) { /* ignore */ } };
    }
    function thump(level) {      // tray thump: a pitched-down sine knock + a click of noise
      if (!build()) return;
      var t = A.currentTime, o = A.createOscillator(), g = A.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
      g.gain.setValueAtTime(level || 0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.2);
      burst(0.04, 2500, 1200, 1.2, (level || 0.12) * 0.5, 'bandpass');
    }

    var api = {
      state: st,
      hiss: function (kind) {
        if (kind === 'vacuum-on') burst(0.55, 5200, 2600, 0.7, 0.045, 'highpass');
        else if (kind === 'vacuum-off') burst(0.28, 3000, 900, 0.9, 0.06, 'bandpass');
        else { burst(0.07, 4200, 3000, 1.5, 0.05, 'bandpass'); setTimeout(function () { burst(0.09, 3600, 2200, 1.5, 0.04, 'bandpass'); }, 70); }
      },
      clunk: function (ch, position, impulse) {
        var M = typeof LLModalAudio !== 'undefined' ? LLModalAudio : null, rang = false;
        try { if (M && M.playImpact) rang = M.playImpact(ch, null, 0.5, impulse || 1.6, position || null); } catch (e) { /* ignore */ }
        thump(rang ? 0.08 : 0.13);
        return rang;
      },
      /**
       * Per-frame: arms = [{q:[6], moving:bool}], belt 0..1 (a sign on the conveyor), fault = buzzer on.
       */
      update: function (dt, arms_, belt, fault) {
        if (!build()) return;
        var t = A.currentTime;
        bus.gain.setTargetAtTime(0.9 * clamp(vol(), 0, 4) / 2, t, 0.1);
        (arms_ || []).forEach(function (a, i) {
          var v = arms[i]; if (!v || !a || !a.q) return;
          var w = jointSpeed(v.q, a.q, dt); v.q = a.q.slice();
          v.w = smooth(v.w, w, dt, SERVO.smooth);
          var sv = servoVoice(v.w);
          st.servo[i] = { w: v.w, freq: sv.freq, gain: sv.gain };
          v.o1.frequency.setTargetAtTime(sv.freq, t, 0.03); v.o2.frequency.setTargetAtTime(sv.freq, t, 0.03);
          v.lp.frequency.setTargetAtTime(500 + sv.freq * 2.2, t, 0.05);
          v.g.gain.setTargetAtTime(sv.gain, t, 0.04);
        });
        st.belt = smooth(st.belt, belt ? 1 : 0, dt, 0.4);
        hum.g.gain.setTargetAtTime(0.010 + 0.022 * st.belt, t, 0.1);
        st.buzzing = !!fault;
        var on = fault && Math.floor(t * 2.5) % 2 === 0;
        buzz.g.gain.setTargetAtTime(on ? 0.035 : 0, t, 0.01);
      },
      dispose: function () {
        st.dead = true;
        nodes.forEach(function (n) { try { if (n.stop) n.stop(); } catch (e) { /* ignore */ } try { n.disconnect(); } catch (e) { /* ignore */ } });
        nodes = []; arms = [];
      }
    };
    return api;
  }

  return { create: create, servoVoice: servoVoice, jointSpeed: jointSpeed, smooth: smooth, SERVO: SERVO };
});
