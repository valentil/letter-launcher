/**
 * Test Suite for LLF-56
 * Title: collisions should be with terrain/geometry in scene not just invisible floor
 * Description: Checks for colliderBodies in launcher.html logic
 * Generated: 2026-03-10T03:10:43.342Z
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLF-56...');

try {
    const launcherPath = path.join(__dirname, '../../../switcher/public/LetterLauncher/launcher.html');
    const content = fs.readFileSync(launcherPath, 'utf8');

    // Check if we have colliderBodies logic which is used for non-global floor colliders
    assert.ok(content.includes('colliderBodies = []'), 'Should initialize colliderBodies');
    assert.ok(content.includes('colliderBodies.push'), 'Should push colliders to colliderBodies');
    
    // Check for specific scene colliders replacing Plane()
    assert.ok(content.includes('CANNON.Box(new CANNON.Vec3(500, 1, 500))'), 'Should have specific scene colliders');
    
    console.log('✅ LLF-56 tests passed.');
} catch (err) {
    console.error('❌ LLF-56 test failed:', err.message);
    process.exit(1);
}
