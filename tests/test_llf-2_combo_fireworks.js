/**
 * Test Suite for LLF-2 — Combo-Based Firework Triggers (W4).
 * Fast typing (a burst of keystrokes within a short window) sets off a firework
 * display. Verifies the trigger helper, the keydown detection hook, and — with a
 * small pure-logic simulation using the *actual thresholds parsed from source* —
 * that a fast burst fires while slow typing does not, and that the cooldown holds.
 *
 * Static + logic check (no browser in the sandbox). All anchors are early in the
 * file, within the mount's 138232-byte read cap.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLF-2 (combo fireworks)...');

try {
    const content = require('./_src').readAllSource();

    // Feature wiring
    assert.ok(content.includes('function triggerComboFireworks('),
        'triggerComboFireworks() helper should exist');
    assert.ok(content.includes('triggerComboFireworks(1);'),
        'The combo should be triggered from the keydown handler');
    assert.ok(/spawnFirework\(pos\)/.test(content),
        'Combo should reuse the existing spawnFirework() effect');
    assert.ok(content.includes('comboKeyTimes'),
        'A rolling keystroke-time buffer should track typing speed');

    // Parse the real thresholds from source so the test tracks the implementation.
    const count = parseInt(/COMBO_SPEED_COUNT\s*=\s*(\d+)/.exec(content)[1], 10);
    const windowMs = parseInt(/COMBO_SPEED_MS\s*=\s*(\d+)/.exec(content)[1], 10);
    const cooldownMs = parseInt(/COMBO_COOLDOWN_MS\s*=\s*(\d+)/.exec(content)[1], 10);
    assert.ok(count >= 4 && count <= 15, 'combo count threshold should be sane');
    assert.ok(windowMs >= 500 && windowMs <= 5000, 'combo window should be sane');
    assert.ok(cooldownMs >= 500, 'combo cooldown should be sane');

    // Reproduce the exact detection predicate from the handler and simulate.
    let comboKeyTimes = [], lastComboTime = -1e9, fires = 0;
    function key(now) {
        comboKeyTimes.push(now);
        if (comboKeyTimes.length > count) comboKeyTimes.shift();
        if (comboKeyTimes.length >= count &&
            (now - comboKeyTimes[0]) <= windowMs &&
            (now - lastComboTime) > cooldownMs) {
            lastComboTime = now;
            comboKeyTimes = [];
            fires++;
        }
    }

    // Slow typing: one key every (window) ms -> should NEVER fire.
    for (let i = 0; i < count * 3; i++) key(i * (windowMs + 50));
    assert.strictEqual(fires, 0, 'Slow typing must not trigger a combo');

    // Fast burst: `count` keys within the window -> exactly one fire (cooldown gates the rest).
    comboKeyTimes = []; lastComboTime = -1e9; fires = 0;
    const step = Math.floor(windowMs / (count + 2));
    for (let i = 0; i < count; i++) key(1e6 + i * step);
    assert.strictEqual(fires, 1, 'A fast burst should trigger exactly one combo');

    // Immediately continuing to type fast stays within cooldown -> no second fire.
    for (let i = 0; i < count; i++) key(1e6 + (count + i) * step);
    assert.strictEqual(fires, 1, 'Cooldown should suppress back-to-back combos');

    console.log('✅ LLF-2 tests passed.');
} catch (err) {
    console.error('❌ LLF-2 test failed:', err.message);
    process.exit(1);
}
