/**
 * Test Suite for LLB-15
 * Title: train backwards
 * Description: Verify train progress decrements and wheels rotate backwards.
 * Generated: 2026-03-10T04:13:07.587Z
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLB-15...');

try {
    const htmlPath = path.join(__dirname, '../../../switcher/public/LetterLauncher/launcher.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Check for negative increment in progress
    assert.ok(content.includes('scene.userData.trainProgress || 0) - 0.0005'), 'Train progress should decrement');
    
    // Check for negative increment in wheel rotation
    assert.ok(content.includes('w.rotation.x -= 0.1'), 'Wheels should rotate backwards');

    console.log('✅ LLB-15 logic verification passed.');
} catch (err) {
    console.error('❌ LLB-15 test failed:', err.message);
    process.exit(1);
}
