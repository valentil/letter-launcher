/**
 * Test Suite for LLB-2
 * Title: dictionary words not working now
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running tests for LLB-2...');

try {
    // Check if dictionary.txt exists in the public folder
    const dictPath = path.join('C:\\clawds\\main_bot_dev\\clawd-workspace\\switcher\\public\\LetterLauncher\\dictionary.txt');
    console.log('Testing path:', dictPath);
    assert.strictEqual(fs.existsSync(dictPath), true, 'dictionary.txt should exist in public/LetterLauncher/');
    
    const content = fs.readFileSync(dictPath, 'utf8');
    assert.strictEqual(content.length > 0, true, 'dictionary.txt should not be empty');
    
    // Check for some common words
    const words = content.split('\n').map(w => w.trim().toUpperCase());
    assert.strictEqual(words.includes('APPLE'), true, 'Dictionary should include APPLE');
    assert.strictEqual(words.includes('SKY'), true, 'Dictionary should include SKY');

    console.log('✅ LLB-2 dictionary file check passed.');
} catch (err) {
    console.error('❌ LLB-2 test failed:', err.message);
    process.exit(1);
}
