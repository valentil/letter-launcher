const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running tests for LLF-34...');

const launcherPath = path.join('C:', 'clawds', 'main_bot_dev', 'clawd-workspace', 'switcher', 'public', 'LetterLauncher', 'launcher.html');

try {
    const content = require('../_src').readAllSource();
    
    // Check if maxLetters variable is defined
    assert.ok(content.includes('let maxLetters = 50;'), 'maxLetters variable not defined with default 50');
    
    // Check if MAX LETTERS is in optionsItems
    assert.ok(content.includes("'MAX LETTERS'"), 'MAX LETTERS not added to optionsItems');
    
    // Check if maxLetters logic is in spawnLetter
    assert.ok(content.includes('while (physicsBodies.length > maxLetters)'), 'maxLetters removal logic not found in spawnLetter/spawnShape');
    
    // Check if options menu shows MAX LETTERS
    assert.ok(content.includes('mesh.name = `MAX LETTERS: ${maxLetters}`;'), 'MAX LETTERS display logic not found in updateOptionsSelection');

    console.log('✅ LLF-34 implementation verification passed.');
} catch (err) {
    console.error('❌ LLF-34 test failed:', err.message);
    process.exit(1);
}
