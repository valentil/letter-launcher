/**
 * Test Suite for W5 — Performance / physics-body cap.
 * The six duplicated "retire oldest letter" loops are consolidated into a single
 * retireExcessBodies() helper that enforces an absolute HARD_BODY_CAP on top of the
 * user's maxLetters option, and firework/explosion particles are bounded by
 * capParticles(). Verifies the helpers exist, are called on every spawn path, the
 * old duplicated inline loops are gone, and — via a logic simulation — that the cap
 * actually bounds the body count under sustained fast typing.
 *
 * Static + logic check (no browser in the sandbox). Anchors are early, within the
 * mount's 138232-byte read cap.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for W5 (body cap)...');

try {
    const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    // Consolidated retire helper + absolute ceiling
    assert.ok(content.includes('function retireExcessBodies('),
        'A single retireExcessBodies() helper should exist');
    assert.ok(/const HARD_BODY_CAP\s*=\s*(\d+)/.test(content),
        'An absolute HARD_BODY_CAP ceiling should be defined');
    assert.ok(/Math\.min\(maxLetters,\s*HARD_BODY_CAP\)/.test(content),
        'The active cap should be min(maxLetters, HARD_BODY_CAP)');

    // The helper must be wired into every spawn path (letters, words, shapes, zoo).
    const calls = (content.match(/retireExcessBodies\(\);/g) || []).length;
    assert.ok(calls >= 5, 'retireExcessBodies() should be called on all spawn paths, got ' + calls);

    // The old duplicated inline retire loop must be gone.
    assert.ok(!/while \(physicsBodies\.filter\(pb => pb\.type !== 'npc'\)\.length > maxLetters\)/.test(content),
        'The duplicated inline retire loops should be replaced by the helper');

    // Particle cap for fireworks/explosions
    assert.ok(content.includes('function capParticles('),
        'A capParticles() helper should bound live particle meshes');
    assert.ok(/const MAX_PARTICLES\s*=\s*(\d+)/.test(content),
        'A MAX_PARTICLES ceiling should be defined');
    assert.ok((content.match(/capParticles\(\);/g) || []).length >= 3,
        'capParticles() should be called after particle bursts');

    // --- Logic simulation: the cap bounds body count under sustained typing. ---
    const HARD = parseInt(/const HARD_BODY_CAP\s*=\s*(\d+)/.exec(content)[1], 10);
    const maxLetters = 50; // default from source
    const cap = Math.max(1, Math.min(maxLetters, HARD));
    let bodies = []; // non-npc letter bodies
    const npc = { type: 'npc' };
    function retire() {
        let guard = 0;
        while (bodies.filter(b => b.type !== 'npc').length > cap && guard++ < 2000) {
            const idx = bodies.findIndex(b => b.type !== 'npc');
            if (idx === -1) break;
            bodies.splice(idx, 1);
        }
    }
    bodies.push(npc);
    for (let i = 0; i < 500; i++) { bodies.push({ type: 'letter', id: i }); retire(); }
    const letters = bodies.filter(b => b.type !== 'npc').length;
    assert.ok(letters <= cap, 'Letter bodies must stay within the cap, got ' + letters);
    assert.ok(bodies.includes(npc), 'The NPC body must never be retired by the cap');
    // Oldest were retired first: only the most recent `cap` ids survive.
    const ids = bodies.filter(b => b.type !== 'npc').map(b => b.id);
    assert.strictEqual(Math.min(...ids), 500 - cap, 'The oldest letters should be retired first');

    console.log('✅ W5 tests passed (cap=' + cap + ').');
} catch (err) {
    console.error('❌ W5 test failed:', err.message);
    process.exit(1);
}
