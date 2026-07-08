/**
 * Test Suite for LLF-44
 * Title: graphical upgrade on existing scenes
 * Description: add lighting, shadows, bump mapping, make things look good and visceral
 * Generated: 2026-03-09T05:16:17.316Z
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for LLF-44...');

try {
    const launcherPath = path.join(__dirname, '../launcher.html');
    const content = fs.readFileSync(launcherPath, 'utf8');

    // Check for shadowMap enabled
    assert.ok(content.includes('renderer.shadowMap.enabled = true'), 'Shadow maps should be enabled');
    
    // Check for castShadow on letters
    assert.ok(content.includes('mesh.castShadow = true'), 'Meshes should cast shadows');
    
    // Check for receiveShadow on ground
    assert.ok(content.includes('ground.receiveShadow = true'), 'Ground should receive shadows');

    // Check for lighting upgrades
    assert.ok(content.includes('THREE.DirectionalLight'), 'Directional light should be used for shadows');

    console.log('✅ LLF-44 graphical upgrade tests passed.');
} catch (err) {
    console.error('❌ LLF-44 test failed:', err.message);
    process.exit(1);
}
