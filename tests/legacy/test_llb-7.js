/**
 * Test Suite for LLB-7
 * Title: wild west scene not in scene selection
 * Description: scene selection graphical display isn't showing it
 * Generated: 2026-03-09T05:23:01.655Z
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLB-7...');

try {
    const htmlPath = path.join(__dirname, '../launcher.html');
    const html = require('../_src').readAllSource();
    
    // Check if WILD WEST is in scenesItems
    assert.ok(html.includes("'WILD WEST'"), 'WILD WEST should be in scenesItems');
    
    // Check if duplicate WILD WEST logic in selectCurrentScene was removed
    // The previous regex was too sensitive to indentation/newlines
    const selectCurrentSceneMatch = html.match(/else if[ \t]*\(selected === 'WILD WEST'\)[ \t]*\{/g);
    assert.strictEqual(selectCurrentSceneMatch ? selectCurrentSceneMatch.length : 0, 1, 'Should only have one WILD WEST entry in selectCurrentScene');

    console.log('✅ LLB-7 tests passed.');
} catch (err) {
    console.error('❌ LLB-7 test failed:', err.message);
    process.exit(1);
}
