/**
 * LLF-12 — Alphabetical Rain Mode. Hold a letter >1s (or type RAIN + letter) -> that
 * letter rains from above the camera for ~4s, via spawnLetter (body cap applies),
 * with a rain audio bed; keyup stops it; key auto-repeat mid-rain does not spawn.
 * Static source checks plus a stubbed-timer behavioural run of startLetterRain.
 */
const assert = require('assert');
const vm = require('vm');
const content = require('./_src').readAllSource();
console.log('Running tests for LLF-12 (alphabetical rain)...');
try {
    const num = n => parseInt(new RegExp(n + '\\s*=\\s*(\\d+)').exec(content)[1], 10);
    assert.ok(num('RAIN_HOLD_MS') >= 1000, 'hold threshold must be >= 1s');
    assert.ok(Math.abs(num('RAIN_DURATION_MS') - 4000) <= 1000, 'rain lasts ~4s');
    assert.ok(/addEventListener\('keyup', onKeyUp\)/.test(content), 'keyup listener registered');
    assert.ok(/function onKeyUp\([\s\S]{0,200}stopLetterRain/.test(content), 'release stops the rain');
    assert.ok(/e\.repeat[\s\S]{0,120}rainActive\) return/.test(content), 'repeat is swallowed while raining');
    assert.ok(/RAIN\$\/\.test\(inputBuffer\)/.test(content), 'RAIN + letter trigger exists');
    assert.ok(/createBiquadFilter[\s\S]{0,400}rainBed|startRainBed/.test(content), 'rain audio bed exists');

    // Behavioural: extract the rain functions and run them with fake timers.
    const a = content.indexOf('function startLetterRain('), b = content.indexOf('function spawnScreenLetter');
    const src = content.slice(a, b);
    const sb = { spawned: [], timers: [], cleared: 0, rainActive: false, rainByHold: false, rainTimer: null, rainEndTimer: null, rainBed: null,
        font: {}, gameStarted: true, audioCtx: null, soundVolume: 1, RAIN_DURATION_MS: 4000, RAIN_INTERVAL_MS: 90,
        camera: { fov: 75, position: { y: 5, length: () => 20 } }, Math, console };
    sb.spawnLetter = c => { const o = { body: { position: { set: (x, y, z) => { o.y = y; } }, velocity: { set() {} } } }; sb.spawned.push([c, o]); return o; };
    sb.setInterval = (f, ms) => { sb.timers.push({ f, ms }); return 1; };
    sb.clearInterval = () => { sb.cleared++; };
    sb.setTimeout = (f, ms) => { sb.end = { f, ms }; return 2; };
    sb.clearTimeout = () => {};
    vm.createContext(sb);
    vm.runInContext(src + ';this.start=startLetterRain;this.stop=stopLetterRain;', sb);
    sb.start('Q', true);
    sb.start('Z', true); // overlapping start ignored
    assert.strictEqual(sb.timers.length, 1, 'only one shower at a time');
    for (let i = 0; i < 40; i++) sb.timers[0].f();
    assert.ok(sb.spawned.length === 40 && sb.spawned.every(s => s[0] === 'Q'), 'rains the requested letter');
    const topOfView = 5 + Math.tan(75 * Math.PI / 360) * 20;
    assert.ok(sb.spawned.every(s => s[1].y > topOfView), 'spawns above the camera frustum');
    assert.strictEqual(sb.end.ms, 4000);
    sb.stop();
    assert.strictEqual(sb.rainActive, false, 'stop clears rainActive');
    console.log('✅ LLF-12 tests passed.');
} catch (err) {
    console.error('❌ LLF-12 test failed:', err.message);
    process.exit(1);
}
