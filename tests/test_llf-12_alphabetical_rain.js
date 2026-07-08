/**
 * Test Suite for LLF-12 — Alphabetical Rain Mode (W4).
 * Repeating one letter quickly (e.g. holding the key, which auto-repeats) triggers
 * a heavy rain of that specific letter from the top of the scene. Verifies the
 * rain helper, the keydown detection hook, that the rain reuses spawnLetter (so
 * the W5 body cap still applies), and — via a pure-logic simulation using the
 * real thresholds — that a same-letter streak triggers while a mixed streak does not.
 *
 * Static + logic check (no browser in the sandbox). Anchors are early, within the
 * mount's 138232-byte read cap.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLF-12 (alphabetical rain)...');

try {
    const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    // Feature wiring
    assert.ok(content.includes('function startLetterRain('),
        'startLetterRain() helper should exist');
    assert.ok(content.includes('startLetterRain(char);'),
        'The rain should be triggered from the keydown handler');
    assert.ok(/startLetterRain[\s\S]{0,600}spawnLetter\(char\)/.test(content),
        'Rain should reuse spawnLetter (keeps the W5 body cap in force)');
    assert.ok(/rainActive/.test(content),
        'A rainActive guard should prevent overlapping showers');
    assert.ok(/16 \+ Math\.random\(\) \* 6/.test(content),
        'Rain letters should spawn from high above the scene');

    // Parse the real thresholds from source.
    const trig = parseInt(/RAIN_TRIGGER_COUNT\s*=\s*(\d+)/.exec(content)[1], 10);
    const win = parseInt(/RAIN_WINDOW_MS\s*=\s*(\d+)/.exec(content)[1], 10);
    assert.ok(trig >= 2 && trig <= 10, 'rain trigger streak should be sane');
    assert.ok(win >= 100 && win <= 3000, 'rain window should be sane');

    // Reproduce the exact streak-detection predicate from the handler.
    let rainLastChar = null, rainLastTime = 0, rainRepeat = 0, rainActive = false, starts = 0;
    function key(char, now) {
        if (char === rainLastChar && (now - rainLastTime) < win) rainRepeat++;
        else rainRepeat = 1;
        rainLastChar = char; rainLastTime = now;
        if (rainRepeat >= trig && !rainActive) { rainRepeat = 0; rainActive = true; starts++; }
    }

    // Mixed letters (never the same one in a row) -> no rain.
    const alpha = 'ABCDEFGH';
    for (let i = 0; i < trig * 3; i++) key(alpha[i % alpha.length], i * 50);
    assert.strictEqual(starts, 0, 'Typing different letters must not start a rain');

    // Same letter, fast streak -> starts a rain.
    rainLastChar = null; rainLastTime = 0; rainRepeat = 0; rainActive = false; starts = 0;
    const step = Math.floor(win / 2);
    for (let i = 0; i < trig; i++) key('Q', 1e6 + i * step);
    assert.strictEqual(starts, 1, 'A same-letter fast streak should start exactly one rain');

    // A too-slow same-letter streak (gaps exceed the window) -> no rain.
    rainLastChar = null; rainLastTime = 0; rainRepeat = 0; rainActive = false; starts = 0;
    for (let i = 0; i < trig; i++) key('Q', 2e6 + i * (win + 50));
    assert.strictEqual(starts, 0, 'A slow same-letter streak should not rain');

    console.log('✅ LLF-12 tests passed.');
} catch (err) {
    console.error('❌ LLF-12 test failed:', err.message);
    process.exit(1);
}
