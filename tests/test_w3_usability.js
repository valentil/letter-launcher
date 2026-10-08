/**
 * Test Suite for W3 — Usability pass.
 * Verifies: (1) an on-screen controls hint element + context-aware updater that
 * mentions keys, middle-click and spacebar; (2) the scene selector is made
 * discoverable from the hint; (3) the AudioContext is gated behind a real user
 * gesture and resumed (no autoplay warnings).
 *
 * Static source check — no browser is available in the sandbox. All W3 anchors
 * live early in the file, well within the mount's 138232-byte read cap.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for W3 (usability)...');

try {
    const content = require('./_src').readAllSource();

    // (1) Controls hint element + styling + updater
    assert.ok(content.includes('id="controlsHint"'),
        'A #controlsHint element should exist in the DOM');
    assert.ok(content.includes('#controlsHint {'),
        'The hint should be styled');
    assert.ok(content.includes('function updateControlsHint('),
        'There should be an updateControlsHint() helper');
    assert.ok(content.includes('updateControlsHint()'),
        'updateControlsHint should be invoked (init + animate)');

    // Hint content must mention the core controls (keys, middle-click, spacebar)
    assert.ok(/Middle-click/i.test(content), 'Hint should mention middle-click');
    assert.ok(/Space/.test(content) && /slow-mo/i.test(content),
        'Hint should mention the Space slow-mo control');
    assert.ok(/launch letters/i.test(content), 'Hint should explain typing launches letters');

    // (2) Scene selector discoverability
    assert.ok(/SCENES<\/b> to pick a map/i.test(content) || /choose <b>SCENES<\/b>/i.test(content),
        'The menu hint should point the player at the SCENES selector');
    assert.ok(/Scene selector/i.test(content),
        'The scenes menu should announce itself as the scene selector');

    // (3) AudioContext gated behind a user gesture and resumed
    assert.ok(content.includes('function unlockAudio('),
        'There should be an unlockAudio() gesture handler');
    assert.ok(content.includes("audioCtx.resume()"),
        'A suspended AudioContext should be resumed (removes autoplay warnings)');
    assert.ok(/addEventListener\('pointerdown', audioGesture\)/.test(content) &&
              /addEventListener\('keydown', audioGesture\)/.test(content),
        'Audio should be unlocked on the first pointerdown/keydown gesture');
    assert.ok(/removeEventListener\('pointerdown', audioGesture\)/.test(content),
        'The one-shot gesture listener should remove itself after unlocking');

    console.log('✅ W3 tests passed.');
} catch (err) {
    console.error('❌ W3 test failed:', err.message);
    process.exit(1);
}
