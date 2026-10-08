/**
 * Test Suite for W2 — Fixed the train set-piece
 * Verifies the reworked wild-west train: a smooth CatmullRom track loop, an
 * articulated train built from clean primitives, per-car physics colliders so
 * letters can land on / bounce off it, and smooth arc-length path motion.
 * Also verifies the old janky per-frame path integration was removed.
 *
 * Static source check (no browser available in CI/sandbox).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running tests for W2 (train)...');

try {
    const htmlPath = path.join(__dirname, '..', 'index.html');
    const content = require('./_src').readAllSource();

    // Smooth spline track
    assert.ok(content.includes('new THREE.CatmullRomCurve3('),
        'Train track should be a smooth CatmullRom curve');
    assert.ok(content.includes('scene.userData.trackCurve') &&
              content.includes('scene.userData.trackLength'),
        'Track curve + arc length should be stored for motion');

    // Clean assembled train geometry
    assert.ok(content.includes('function buildCarUnit('),
        'Train cars should be built by a buildCarUnit helper');
    assert.ok(content.includes('const trainCars = [')  ||
              content.includes('const trainCars=['),
        'Should assemble an articulated trainCars list');

    // Physics interaction: each car has its own collider registered as a collider body
    assert.ok(content.includes('trainCars.push({ group: unit.group, body: body'),
        'Each train car should carry a Cannon body collider');
    assert.ok(/carDefs\.forEach[\s\S]{0,400}new CANNON\.Body/.test(content),
        'Train car colliders should be created from car definitions');

    // Smooth arc-length motion + collider teleport in the animate loop
    assert.ok(content.includes('getPointAt(u)') && content.includes('getTangentAt(u)'),
        'Train should move along the curve using arc-length point/tangent lookups');
    assert.ok(content.includes('car.body.position.set(') &&
              content.includes('car.body.quaternion.setFromAxisAngle'),
        'Train car colliders should be updated each frame to match the visual cars');
    assert.ok(content.includes("currentScene === 'wild_west' && scene.userData.trainCars"),
        'Animate loop should drive the new trainCars');

    // Old janky implementation removed
    assert.ok(!content.includes('trainProgress'),
        'Old per-frame trainProgress path integration should be removed');
    assert.ok(!content.includes('createCurvedTrack'),
        'Old hand-integrated curved-track builder should be removed');
    assert.ok(!content.includes('scene.userData.train ='),
        'Old single-group train reference should be removed');

    console.log('✅ W2 tests passed.');
} catch (err) {
    console.error('❌ W2 test failed:', err.message);
    process.exit(1);
}
