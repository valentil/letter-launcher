// LLF-11: Keystroke Velocity Projectiles - force mapping + wiring
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const kf = require('../src/core/keyforce.js');
console.log('Running tests for LLF-11...');
// speed term
assert.strictEqual(kf.kfSpeedForce(0), 0);
assert.strictEqual(kf.kfSpeedForce(1000), 0);
assert.strictEqual(kf.kfSpeedForce(40), 1);
assert(kf.kfSpeedForce(100) > kf.kfSpeedForce(300));
// hold term: sharp tap > long hold
assert(kf.kfHoldForce(30) === 1 && kf.kfHoldForce(500) === 0 && kf.kfHoldForce(100) > kf.kfHoldForce(250));
// scale bounds and monotonic
assert.strictEqual(kf.kfScaleFor(0), 0.8);
assert(Math.abs(kf.kfScaleFor(1) - 1.6) < 1e-9);
assert.strictEqual(kf.kfScaleFor(5), kf.kfScaleFor(1));
assert.strictEqual(kf.kfScaleFor(-3), 0.8);
assert(kf.kfMassFor(1.6) > kf.kfMassFor(0.8));
assert(kf.kfImpulseFor(1).up > kf.kfImpulseFor(0).up);
// combine capped
assert(kf.kfCombine(1, 1, 1) <= 1 && kf.kfCombine(0, 0, 0) === 0);
// sequence: slow first key soft, rapid repeats hard
let r = kf.keyForceOnDown('a', 10000);
assert(r.force === 0 && !r.hard && r.scale === 0.8);
let t = 10000;
for (let i = 0; i < 8; i++) { t += 50; r = kf.keyForceOnDown('a', t); }
assert(r.hard && r.scale > 1.4, 'rapid repeated key should be hard: ' + JSON.stringify(r));
assert(kf.KF_state.shake > 0);
// different key resets repeat
const r2 = kf.keyForceOnDown('b', t + 50);
assert(r2.force < r.force);
// wiring
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('src/core/keyforce.js') > 0 && html.indexOf('src/core/keyforce.js') < html.indexOf('src/robot/'));
assert(/function spawnLetter\(char, opts\)/.test(fs.readFileSync(path.join(root, 'src/core/letters.js'), 'utf8')));
// LLF-91: wired through the LLHooks bus from keyforce.js, not core-file one-liners
const own = fs.readFileSync(path.join(root, 'src/core/keyforce.js'), 'utf8');
assert(/LLHooks\.on\('letterKey'[\s\S]{0,80}keyForceOnDown\(char, now\)/.test(own), 'letterKey registration feeds spawn opts');
assert(/LLHooks\.on\('letterSpawned'[^\n]*keyForceRegister\(/.test(own), 'letterSpawned registration');
assert(/LLHooks\.on\('keyup'[^\n]*keyForceOnUp\(e\.key\)/.test(own), 'keyup registration');
assert(/LLHooks\.on\('frame'[^\n]*keyForceApplyShake\(camera\)/.test(own), 'frame registration');
assert(html.indexOf('src/core/keyforce.js') > html.indexOf('src/core/hooks.js'), 'keyforce.js loads after hooks.js');
const menuSrc = fs.readFileSync(path.join(root, 'src/core/menu.js'), 'utf8');
assert(/spawnLetter\(char, spawnOpts\)/.test(menuSrc) && /playTone\(char, letterObj\.mesh\.position, spawnOpts\.toneGain\)/.test(menuSrc), 'menu passes hook-tuned opts');
assert(!/keyForce(OnDown|OnUp|Register|ApplyShake)\(/.test(menuSrc + fs.readFileSync(path.join(root, 'src/core/engine.js'), 'utf8')), 'no keyforce one-liners in core files');
assert(/function playTone\(char, position, gainMul\)/.test(fs.readFileSync(path.join(root, 'src/core/audio.js'), 'utf8')), 'playTone gain multiplier');
// hook behaviour through the real bus
const H = require('../src/core/hooks.js');
global.LLHooks = H;
delete require.cache[require.resolve('../src/core/keyforce.js')];
const kf2 = require('../src/core/keyforce.js');
const opts = { scale: 1, toneGain: 1 };
let tt = 50000; H.emit('letterKey', 'Q', tt, opts);
for (let i = 0; i < 8; i++) { tt += 50; H.emit('letterKey', 'Q', tt, opts); }
assert(opts.hard && opts.scale > 1.4 && opts.toneGain === 1.8 && opts.impulse.up > 1, 'letterKey hook sets hard-hit opts: ' + JSON.stringify(opts));
delete global.LLHooks;
console.log('✅ LLF-11 tests passed.');
