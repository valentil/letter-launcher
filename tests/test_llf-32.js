/**
 * Test Suite for LLF-32
 * Title: expand dictionary to include websters
 * Description: Verify dictionary.txt exists and has content
 * Generated: 2026-03-09T03:48:44.824Z
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLF-32...');

try {
    const dictPath = path.join(__dirname, '..', 'dictionary.txt');
    assert.strictEqual(fs.existsSync(dictPath), true, 'dictionary.txt should exist');
    
    const content = fs.readFileSync(dictPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    
    assert.ok(lines.length > 1000, 'Dictionary should have many words');
    assert.ok(lines.map(l => l.trim().toLowerCase()).includes('apple'), 'Dictionary should contain common words');
    
    console.log(`✅ LLF-32 test passed: Found ${lines.length} words.`);
} catch (err) {
    console.error('❌ LLF-32 test failed:', err.message);
    process.exit(1);
}
