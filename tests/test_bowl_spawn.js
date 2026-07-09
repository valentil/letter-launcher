// Test: bowl container + centered spawns.
// Reimplements buildBowl()'s sizing and bowlSpawnPos()'s placement (both in
// index.html) and proves that every spawned piece:
//   (a) drops inside the bowl's rim radius (so it falls INTO the bowl, centered),
//   (b) drops ABOVE the bowl (y > topY), and
//   (c) stays within the on-screen play box (never off to the side).
// Also confirms the bowl is centered on the play-box center and fits inside it.

const assert = require('assert');

// --- Mirror of buildBowl() geometry ---
function bowlFromBounds(b) {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const floorY = b.floorY;
  const halfSpan = Math.min((b.maxX - b.minX), (b.maxZ - b.minZ)) / 2;
  const rTop = Math.max(4, Math.min(6.5, halfSpan * 0.82));
  const rBottom = rTop * 0.42;
  const height = Math.min(5.5, rTop * 0.95);
  const topY = floorY + height;
  return { cx, cz, floorY, rTop, rBottom, height, topY };
}

// --- Mirror of bowlSpawnPos() (bowl branch) ---
function bowlSpawnPos(bowl, idx, sizeY) {
  sizeY = sizeY || 1;
  const ang = idx * 2.399963229728653;                 // golden angle
  const rad = Math.sqrt((idx % 13) / 13) * bowl.rTop * 0.5;
  return {
    x: bowl.cx + Math.cos(ang) * rad,
    y: bowl.topY + 1.5 + (idx % 5) * 0.5 + sizeY * 0.5,
    z: bowl.cz + Math.sin(ang) * rad
  };
}

// Representative play boxes (empirical 16:9 box + a couple of aspect variants).
const boxes = [
  { minX: -11, maxX: 11, minZ: -9, maxZ: 6, floorY: -5.1 },   // ~16:9
  { minX: -8,  maxX: 8,  minZ: -9, maxZ: 5, floorY: -5.1 },   // fallback box
  { minX: -14, maxX: 14, minZ: -10, maxZ: 7, floorY: -5.1 },  // ultrawide
  { minX: -7,  maxX: 7,  minZ: -8, maxZ: 4, floorY: -6.0 }    // taller floor
];

let checks = 0;
for (const box of boxes) {
  const bowl = bowlFromBounds(box);

  // Bowl centered on the play box and fully inside it.
  assert.ok(Math.abs(bowl.cx - (box.minX + box.maxX) / 2) < 1e-9, 'bowl cx centered');
  assert.ok(Math.abs(bowl.cz - (box.minZ + box.maxZ) / 2) < 1e-9, 'bowl cz centered');
  assert.ok(bowl.cx - bowl.rTop >= box.minX - 1e-6 && bowl.cx + bowl.rTop <= box.maxX + 1e-6,
    'bowl rim fits within play box in X');
  assert.ok(bowl.cz - bowl.rTop >= box.minZ - 1e-6 && bowl.cz + bowl.rTop <= box.maxZ + 1e-6,
    'bowl rim fits within play box in Z');
  assert.ok(bowl.rBottom < bowl.rTop, 'funnel: narrow base < wide rim');
  checks += 5;

  // 600 staggered spawns all land inside the rim, above the bowl, and on-screen.
  const sizes = [1, 1.5, 3, 6]; // letter, spelled letter, animal, giraffe
  for (let i = 0; i < 600; i++) {
    const p = bowlSpawnPos(bowl, i, sizes[i % sizes.length]);
    const r = Math.hypot(p.x - bowl.cx, p.z - bowl.cz);
    assert.ok(r <= bowl.rTop - 1e-9, `spawn ${i} inside rim (r=${r.toFixed(2)} <= ${bowl.rTop.toFixed(2)})`);
    assert.ok(p.y > bowl.topY, `spawn ${i} above bowl rim`);
    assert.ok(p.x >= box.minX && p.x <= box.maxX, `spawn ${i} x on-screen`);
    assert.ok(p.z >= box.minZ && p.z <= box.maxZ, `spawn ${i} z on-screen`);
  }
  checks += 600 * 4;
}

// Spawns must spread out (golden-angle) rather than stacking on one point.
{
  const bowl = bowlFromBounds(boxes[0]);
  const pts = [];
  for (let i = 0; i < 20; i++) pts.push(bowlSpawnPos(bowl, i, 1));
  let minGap = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      minGap = Math.min(minGap, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z, pts[i].y - pts[j].y));
  assert.ok(minGap > 0.15, `consecutive spawns are separated (minGap=${minGap.toFixed(3)})`);
  checks++;
}

console.log('test_bowl_spawn: PASS (' + checks + ' checks)');
