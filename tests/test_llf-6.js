// LLF-6 Chroma-Key Typing: rhythm tracker -> hue/glow mapping
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/core/rhythm.js'), 'utf8');
function mkColor() { return { h: 0, setHSL(h) { this.h = h; return this; }, lerp(o, t) { this.lerped = t; return this; }, copy(o) { this.h = o.h; return this; } }; }
const ctx = { THREE: { Color: function () { return mkColor(); } }, Date: { now: () => ctx.__now } };
vm.createContext(ctx);
vm.runInContext(src + '\n;this.api={RHYTHM,rhythmKey,rhythmTint,rhythmHue,rhythmGlow};', ctx);
const A = ctx.api;
const deg = h => h * 360;
function type(interval, n, jitter) {
    let t = 100000;
    for (let i = 0; i < n; i++) { t += interval + (jitter ? (i % 2 ? jitter : -jitter) : 0); ctx.__now = t; A.rhythmKey(t); }
    return t;
}
function mat() { return { color: mkColor(), emissive: mkColor(), emissiveIntensity: 0 }; }

// pure mapping
assert(Math.abs(deg(A.rhythmHue(0)) - 223) < 2, 'slow = blue');
assert(deg(A.rhythmHue(1)) > 300 && deg(A.rhythmHue(1)) < 340, 'fast = magenta');
assert(deg(A.rhythmHue(0.84)) < 5 || deg(A.rhythmHue(0.84)) > 355, 'fast-ish = red');
assert(A.rhythmGlow(1, 1) > A.rhythmGlow(0, 0));

// sporadic: single key / long gap keeps random colour
let m = mat(); A.rhythmKey(1000); ctx.__now = 1000; A.rhythmTint(m);
assert.strictEqual(m.emissiveIntensity, 0, 'sporadic untouched');
A.rhythmKey(9000); ctx.__now = 9000; A.rhythmTint(m); assert.strictEqual(m.emissiveIntensity, 0);

// slow steady typing -> blue-ish, low speed
type(800, 8); m = mat(); A.rhythmTint(m);
assert(A.RHYTHM.speed < 0.2 && deg(m.emissive.h) > 170 && deg(m.emissive.h) < 230, 'slow blue');
const slowGlow = m.emissiveIntensity;

// fast steady typing -> hot, brighter
type(100, 14); m = mat(); A.rhythmTint(m);
assert(A.RHYTHM.speed > 0.9 && (deg(m.emissive.h) > 300 || deg(m.emissive.h) < 20), 'fast hot');
assert(m.emissiveIntensity > slowGlow, 'faster glows more');

// erratic is less steady than metronomic
type(300, 10); const steadyV = A.RHYTHM.steady;
type(300, 10, 200); assert(A.RHYTHM.steady < steadyV, 'jitter lowers steadiness');

// LLF-91: wired through the hook bus, not core-file one-liners
const _root = path.join(__dirname, '..');
assert(/LLHooks\.on\('letterKey'[^\n]*rhythmKey\(now\)/.test(src), 'letterKey registration');
assert(/LLHooks\.on\('letterSpawned'[^\n]*rhythmTint\(/.test(src), 'letterSpawned registration');
assert(/LLHooks\.on\('frame'[^\n]*rhythmFrame\(\)/.test(src), 'frame registration');
const _html = fs.readFileSync(path.join(_root, 'index.html'), 'utf8');
assert(_html.indexOf('src/core/rhythm.js') > _html.indexOf('src/core/hooks.js'), 'rhythm.js loads after hooks.js');
for (const f of ['engine.js', 'menu.js', 'letters.js']) assert(!/rhythm(Key|Tint|Frame)\(/.test(fs.readFileSync(path.join(_root, 'src/core', f), 'utf8')), 'no rhythm one-liner in ' + f);

// idle gap resets
ctx.__now += 5000; m = mat(); A.rhythmTint(m); assert.strictEqual(m.emissiveIntensity, 0);
console.log('✅ LLF-6 rhythm mapping tests passed.');
