/**
 * Test Suite for LLF-35
 * Title: prioritize longer words over shorter words
 * Description: give us 5 seconds on a shorter word before it registers for us to continue typing a longer word, so I can type out featureboard for example
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const launcherPath = 'C:\\clawds\\main_bot_dev\\clawd-workspace\\switcher\\public\\LetterLauncher\\launcher.html';
const content = require('./_src').readAllSource();

console.log('Running tests for LLF-35...');

try {
    // Check if wordPending was added
    assert.ok(content.includes('let wordPending = null;'), 'wordPending variable should be defined');

    // Check if the timer logic exists
    assert.ok(content.includes('setTimeout'), 'setTimeout should be used for the 5-second delay');
    assert.ok(content.includes('5000'), '5000ms delay should be present');

    // Check if longer word priority logic exists
    assert.ok(content.includes('b.length - a.length'), 'Should sort words by length');
    assert.ok(content.includes('clearTimeout'), 'Should clear previous timers for shorter words');

    console.log('✅ LLF-35 code implementation verification passed.');
} catch (err) {
    console.error('❌ LLF-35 test failed:', err.message);
    process.exit(1);
}
