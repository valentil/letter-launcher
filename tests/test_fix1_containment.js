// LLF-Fix1 — Spawn/containment predicate test (pure logic, no browser).
//
// Mirrors the geometry used by computePlayBounds()/isWithinPlayBounds() in index.html:
// the gameplay camera sits at (0,5,15) looking at the origin with a 75deg vertical FOV.
// We reimplement the THREE perspective projection here and prove that the floor rectangle
// derived the same way computePlayBounds() derives it lands fully inside the camera
// frustum (all spawn corners project to NDC within +/-1) across a range of aspect ratios,
// and that isWithinPlayBounds() accepts inside points and rejects out-of-view ones.

const assert = require('assert');

// --- minimal vector helpers ---
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm = a => { const l = Math.hypot(a[0],a[1],a[2]); return [a[0]/l,a[1]/l,a[2]/l]; };

const EYE = [0, 5, 15];
const ZB = norm(sub(EYE, [0,0,0]));         // camera basis (points from target to eye)
const XB = norm(cross([0,1,0], ZB));
const YB = cross(ZB, XB);
const TANV = Math.tan(75 * Math.PI / 360);  // tan(FOV/2), vertical

function ndc(p, aspect) {
  const d = sub(p, EYE);
  const c = [dot(d, XB), dot(d, YB), dot(d, ZB)];
  const zc = -c[2];
  if (zc <= 0) return null;                  // behind camera
  return [c[0] / (TANV * aspect * zc), c[1] / (TANV * zc)];
}
function inView(p, aspect, margin) {
  const n = ndc(p, aspect);
  if (!n) return false;
  return Math.abs(n[0]) <= 1 - margin && Math.abs(n[1]) <= 1 - margin;
}

// Reimplementation of computePlayBounds() (same math as index.html: unproject the
// lower screen band onto the floor plane, take the inner rectangle, inset 12%).
const SPAWN_STACK_H = 5;
function computePlayBounds(aspect, floorY) {
  floorY = (floorY == null) ? -5.1 : floorY;
  function floorPt(nx, ny) {
    const dir = [
      nx*TANV*aspect*XB[0] + ny*TANV*YB[0] - ZB[0],
      nx*TANV*aspect*XB[1] + ny*TANV*YB[1] - ZB[1],
      nx*TANV*aspect*XB[2] + ny*TANV*YB[2] - ZB[2],
    ];
    if (dir[1] >= -1e-4) return null;
    const t = (floorY - EYE[1]) / dir[1];
    if (t <= 0) return null;
    return [EYE[0]+dir[0]*t, floorY, EYE[2]+dir[2]*t];
  }
  const band = [[-0.82,-0.82],[0.82,-0.82],[0.82,-0.08],[-0.82,-0.08]];
  const pts = band.map(([nx,ny]) => floorPt(nx,ny));
  assert.ok(pts.every(p => p), 'floor band should intersect the floor plane');
  let minX = Math.max(pts[0][0], pts[3][0]);
  let maxX = Math.min(pts[1][0], pts[2][0]);
  let minZ = Math.min(...pts.map(p=>p[2]));
  let maxZ = Math.max(...pts.map(p=>p[2]));
  const f = 0.88, cx = (minX+maxX)/2, cz = (minZ+maxZ)/2;
  minX = cx+(minX-cx)*f; maxX = cx+(maxX-cx)*f;
  minZ = cz+(minZ-cz)*f; maxZ = cz+(maxZ-cz)*f;
  return { minX, maxX, minZ, maxZ, floorY, ceilY: floorY + SPAWN_STACK_H };
}

// isWithinPlayBounds() as in index.html.
function isWithinPlayBounds(pos, b, tol) {
  tol = tol || 0;
  return pos.x >= b.minX - tol && pos.x <= b.maxX + tol &&
         pos.z >= b.minZ - tol && pos.z <= b.maxZ + tol &&
         pos.y >= b.floorY - 2 && pos.y <= b.ceilY + 6;
}

let passed = 0;

// 1) Across common aspect ratios, EVERY corner of the spawn box (floor..floor+5) is
//    on-screen with a comfortable 3% margin -> letters can't spawn off-view.
for (const aspect of [1.0, 1.2, 1.333, 1.6, 1.777, 2.2]) {
  const b = computePlayBounds(aspect);
  for (const X of [b.minX, b.maxX])
    for (const Y of [b.floorY, b.ceilY])
      for (const Z of [b.minZ, b.maxZ]) {
        assert.ok(inView([X, Y, Z], aspect, 0.03),
          `corner (${X.toFixed(1)},${Y.toFixed(1)},${Z.toFixed(1)}) off-screen at aspect ${aspect}`);
      }
  // Box must be non-degenerate and in front of the camera (negative-ish z, below eye).
  assert.ok(b.maxX > b.minX && b.maxZ > b.minZ, 'bounds non-degenerate');
  assert.ok(b.maxZ < EYE[2], 'play box is in front of the camera');
  passed++;
}
console.log(`ok - spawn box fully inside frustum for ${passed} aspect ratios`);

// 2) The staggered spawn formula (golden-ratio spread used in spawnLetter) always lands
//    inside the bounds -> no spawn escapes the containment walls.
{
  const b = computePlayBounds(1.777);
  for (let idx = 0; idx < 500; idx++) {
    const fx = (idx * 0.618033988749895) % 1;
    const fz = ((idx * 7 + 3) * 0.618033988749895) % 1;
    const pos = {
      x: b.minX + (b.maxX - b.minX) * (0.08 + 0.84 * fx),
      y: b.floorY + 2.5 + (idx % 6) * 0.4,
      z: b.minZ + (b.maxZ - b.minZ) * (0.18 + 0.64 * fz),
    };
    assert.ok(isWithinPlayBounds(pos, b, 0.6), `spawn ${idx} escaped bounds`);
    assert.ok(inView([pos.x, pos.y, pos.z], 1.777, 0.0), `spawn ${idx} off-screen`);
  }
  console.log('ok - 500 staggered spawns all inside bounds and on-screen');
}

// 3) isWithinPlayBounds rejects points outside the walls (off to the side / clipping past).
{
  const b = computePlayBounds(1.777);
  assert.strictEqual(isWithinPlayBounds({ x: b.maxX + 5, y: -4, z: 0 }, b), false, 'far right rejected');
  assert.strictEqual(isWithinPlayBounds({ x: 0, y: -4, z: b.minZ - 5 }, b), false, 'far back rejected');
  assert.strictEqual(isWithinPlayBounds({ x: 0, y: -4.5, z: (b.minZ+b.maxZ)/2 }, b), true, 'center accepted');
  console.log('ok - containment predicate rejects out-of-bounds points');
}

console.log('PASS test_fix1_containment');
