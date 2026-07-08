/**
 * Test Suite for LLF-33
 * Title: make things four times as loud by default
 * Description: check if soundVolume is initialized to 2.0 (four times the previous 0.5)
 * Generated: 2026-03-09T03:50:44.185Z
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLF-33...');

try {
    const launcherPath = path.join('C:', 'clawds', 'main_bot_dev', 'clawd-workspace', 'switcher', 'public', 'LetterLauncher', 'launcher.html');
    const content = fs.readFileSync(launcherPath, 'utf8');

    // Check if soundVolume is initialized to 2.0
    assert.ok(content.includes('let soundVolume = 2.0;'), 'soundVolume should be initialized to 2.0 (4x 0.5)');
    
    console.log('✅ LLF-33: soundVolume is 2.0 by default.');
} catch (err) {
    console.error('❌ LLF-33 test failed:', err.message);
    process.exit(1);
}
