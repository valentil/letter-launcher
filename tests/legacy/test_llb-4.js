/**
 * Test Suite for LLB-4
 * Title: longest word is getting to REBOARD
 * Description: longest word is only getting to REBOARD when i type in FEATUREBOARD
 * Generated: 2026-03-09T04:15:07.425Z
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Simulate the logic in launcher.html to verify why REBOARD might be picked over FEATUREBOARD
console.log('Running tests for LLB-4...');

try {
    const dictPath = path.join('C:\\clawds\\main_bot_dev\\clawd-workspace\\switcher\\public\\LetterLauncher\\dictionary.txt');
    if (!fs.existsSync(dictPath)) {
        console.error('❌ Dictionary file not found at:', dictPath);
        process.exit(1);
    }

    const text = fs.readFileSync(dictPath, 'utf8');
    const DICTIONARY = text.split('\n')
        .map(w => w.trim().toUpperCase())
        .filter(w => w.length > 2);

    console.log(`Loaded ${DICTIONARY.length} words.`);

    const inputBuffer = "FEATUREBOARD";
    
    let foundWords = [];
    for (const word of DICTIONARY) {
        if (inputBuffer.endsWith(word)) {
            foundWords.push(word);
        }
    }

    console.log('Words found in "FEATUREBOARD":', foundWords);

    if (foundWords.length > 0) {
        foundWords.sort((a, b) => b.length - a.length);
        const longestWord = foundWords[0];
        console.log('Longest word found:', longestWord);
        
        assert.strictEqual(longestWord, "FEATUREBOARD", 'Longest word should be FEATUREBOARD');
    } else {
        console.error('❌ No words found in "FEATUREBOARD"');
        process.exit(1);
    }

    console.log('✅ LLB-4 logic test passed.');
} catch (err) {
    console.error('❌ LLB-4 test failed:', err.message);
    process.exit(1);
}
