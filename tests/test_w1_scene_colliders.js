/**
 * Test Suite for W1 — Letters collide with real scene geometry
 * Verifies that each scene's ground collider matches the VISIBLE surface via a
 * Cannon.js Heightfield (Box-vs-Trimesh does not collide in cannon 0.6.2, so the
 * abstract flat "box" grounds were replaced with sampled heightfields), and that
 * SPACE gained a real visible moon surface.
 *
 * Static source check (no browser available in CI/sandbox).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for W1 (scene colliders)...');

try {
    const htmlPath = path.join(__dirname, '..', 'index.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Heightfield helper exists and is used
    assert.ok(content.includes('function addHeightfieldCollider('),
        'Should define addHeightfieldCollider helper');
    assert.ok(content.includes('new CANNON.Heightfield('),
        'Should build Cannon Heightfield colliders');
    assert.ok(content.includes('colliderBodies.push(body)'),
        'Heightfield colliders should be registered in colliderBodies');

    // Each sculpted / previously-abstract scene now uses a heightfield collider
    assert.ok(content.includes("addHeightfieldCollider(-160, -200, 240, 200, 6, coastHeight"),
        'coastal_city should use a heightfield matching the coast (ramp/plateau)');
    assert.ok(content.includes("desertHeight") && content.includes("'desert_ground'"),
        'desert should use a heightfield matching the dunes');
    assert.ok(content.includes("'wild_west_ground'") && content.includes('scene.userData.wwHeight'),
        'wild_west should use a heightfield and expose wwHeight');
    assert.ok(content.includes("'moon_surface'"),
        'space should use a heightfield moon surface collider');

    // SPACE must now have a VISIBLE moon surface mesh (was an invisible plane before)
    assert.ok(content.includes('moonHeight') && content.includes('moonSurface'),
        'space should add a visible cratered moon surface mesh');
    assert.ok(content.includes('moonCraters'),
        'moon surface should have crater depressions');

    // The old abstract flat "box" ground colliders must be gone
    assert.ok(!content.includes('CANNON.Box(new CANNON.Vec3(500, 1, 500))'),
        'Old flat 500x1x500 box grounds (space/wild_west) should be removed');
    assert.ok(!content.includes('CANNON.Box(new CANNON.Vec3(400, 10, 400))'),
        'Old flat coastal box ground should be removed');
    assert.ok(!content.includes('CANNON.Box(new CANNON.Vec3(100, 2, 100))'),
        'Old flat desert box ground should be removed');

    // Documented rationale for choosing Heightfield over Trimesh
    assert.ok(/Trimesh/i.test(content) && /Heightfield/i.test(content),
        'Should document the Trimesh-vs-Heightfield collision rationale');

    console.log('✅ W1 tests passed.');
} catch (err) {
    console.error('❌ W1 test failed:', err.message);
    process.exit(1);
}
