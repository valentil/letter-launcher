/*
 * bake_props.js — ONE-TIME static-asset baker for Letter Launcher.
 *
 * Builds detailed low-poly props by merging primitives, then writes a single
 * static file assets/props_data.js (window.PROP_ASSETS = { name: {position,
 * normal, color?, index} }). The game loads that file and builds a geometry in
 * two trivial lines (see makeProp) — no procedural geometry scattered through
 * the scene code. Re-run only when you want to change an asset:
 *
 *     node tools/bake_props.js
 *
 * Plain Node, no dependencies.
 */
const fs = require('fs');
const path = require('path');

// ---- tiny geometry kit ----------------------------------------------------
function rot(axis, ang, v) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const [x, y, z] = v;
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z]; // z
}
function Builder() {
  return { P: [], N: [], C: [], I: [] };
}
// merge a primitive {pos,nrm,idx} into b, with transform + rgb color
function add(b, prim, xf, rgb) {
  xf = xf || {}; rgb = rgb || [1, 1, 1];
  const t = xf.t || [0, 0, 0];
  const s = xf.s != null ? (Array.isArray(xf.s) ? xf.s : [xf.s, xf.s, xf.s]) : [1, 1, 1];
  const r = xf.r; // {axis, ang}
  const base = b.P.length / 3;
  for (let i = 0; i < prim.pos.length; i += 3) {
    let p = [prim.pos[i], prim.pos[i + 1], prim.pos[i + 2]];
    let n = [prim.nrm[i], prim.nrm[i + 1], prim.nrm[i + 2]];
    p = [p[0] * s[0], p[1] * s[1], p[2] * s[2]];
    if (r) { p = rot(r.axis, r.ang, p); n = rot(r.axis, r.ang, n); }
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    b.P.push(p[0] + t[0], p[1] + t[1], p[2] + t[2]);
    b.N.push(n[0] / nl, n[1] / nl, n[2] / nl);
    b.C.push(rgb[0], rgb[1], rgb[2]);
  }
  for (let i = 0; i < prim.idx.length; i++) b.I.push(prim.idx[i] + base);
}
function finish(b, colored) {
  const round = (a) => a.map((v) => Math.round(v * 1000) / 1000);
  const o = { position: round(b.P), normal: round(b.N), index: b.I };
  if (colored) o.color = round(b.C);
  return o;
}

// primitives (local space) -------------------------------------------------
function cylinder(rt, rb, h, seg) {
  const P = [], N = [], I = [], half = h / 2, slope = (rb - rt) / h;
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
    P.push(rt * cx, half, rt * sz, rb * cx, -half, rb * sz);
    let nx = cx, ny = slope, nz = sz; const l = Math.hypot(nx, ny, nz) || 1;
    N.push(nx / l, ny / l, nz / l, nx / l, ny / l, nz / l);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const cap = (r, y, ny, flip) => {
    const ci = P.length / 3; P.push(0, y, 0); N.push(0, ny, 0);
    const st = P.length / 3;
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; P.push(r * Math.cos(a), y, r * Math.sin(a)); N.push(0, ny, 0); }
    for (let i = 0; i < seg; i++) { if (flip) I.push(ci, st + i, st + i + 1); else I.push(ci, st + i + 1, st + i); }
  };
  if (rt > 1e-6) cap(rt, half, 1, false);
  if (rb > 1e-6) cap(rb, -half, -1, true);
  return { pos: P, nrm: N, idx: I };
}
const cone = (r, h, seg) => cylinder(0, r, h, seg || 7);
function box(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const faces = [
    [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z], [1, 0, 0]],
    [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z], [-1, 0, 0]],
    [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z], [0, 1, 0]],
    [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z], [0, -1, 0]],
    [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1]],
    [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1]]
  ];
  const P = [], N = [], I = [];
  faces.forEach((f) => { const b = P.length / 3; for (let k = 0; k < 4; k++) { P.push(...f[k]); N.push(...f[4]); } I.push(b, b + 1, b + 2, b, b + 2, b + 3); });
  return { pos: P, nrm: N, idx: I };
}
// faceted icosahedron (flat normals), unit radius
function ico(jitter, seed) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  let s = seed || 1; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  if (jitter) v = v.map((p) => { const f = 1 + (rnd() - 0.5) * jitter; return [p[0] * f, p[1] * f, p[2] * f]; });
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const P = [], N = [], I = [];
  F.forEach((f) => {
    const a = v[f[0]], b = v[f[1]], c = v[f[2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1;
    const base = P.length / 3;
    [a, b, c].forEach((p) => { P.push(...p); N.push(nx / l, ny / l, nz / l); });
    I.push(base, base + 1, base + 2);
  });
  return { pos: P, nrm: N, idx: I };
}

// ---- prop assembly --------------------------------------------------------
const BROWN = [0.42, 0.29, 0.17], GREEN = [0.18, 0.55, 0.31], GREEN2 = [0.24, 0.66, 0.36], DARKGREEN = [0.13, 0.42, 0.26], ROCK = [0.5, 0.48, 0.45];
const ASSETS = {};

// leafy tree: trunk + 3 rounded canopies
(() => { const b = Builder();
  add(b, cylinder(0.16, 0.22, 1.4, 6), { t: [0, 0.7, 0] }, BROWN);
  add(b, ico(0.35, 7), { t: [0, 1.7, 0], s: 1.05 }, GREEN);
  add(b, ico(0.35, 13), { t: [0.5, 1.4, 0.2], s: 0.7 }, GREEN2);
  add(b, ico(0.35, 21), { t: [-0.45, 1.5, -0.2], s: 0.75 }, DARKGREEN);
  ASSETS.tree = finish(b, true);
})();
// pine: trunk + 3 stacked cones
(() => { const b = Builder();
  add(b, cylinder(0.12, 0.16, 1.0, 6), { t: [0, 0.5, 0] }, BROWN);
  add(b, cone(0.85, 1.2, 7), { t: [0, 1.2, 0] }, DARKGREEN);
  add(b, cone(0.68, 1.0, 7), { t: [0, 1.75, 0] }, GREEN);
  add(b, cone(0.5, 0.85, 7), { t: [0, 2.25, 0] }, GREEN2);
  ASSETS.pine = finish(b, true);
})();
// rock: two overlapping faceted icos
(() => { const b = Builder();
  add(b, ico(0.5, 3), { s: [0.62, 0.5, 0.58] }, ROCK);
  add(b, ico(0.5, 9), { t: [0.28, -0.05, 0.15], s: [0.32, 0.28, 0.34] }, [0.44, 0.42, 0.4]);
  ASSETS.rock = finish(b, true);
})();
// bush: cluster of small green icos
(() => { const b = Builder();
  add(b, ico(0.4, 5), { t: [0, 0.3, 0], s: 0.5 }, GREEN);
  add(b, ico(0.4, 11), { t: [0.32, 0.22, 0.1], s: 0.38 }, DARKGREEN);
  add(b, ico(0.4, 17), { t: [-0.3, 0.22, -0.08], s: 0.4 }, GREEN2);
  ASSETS.bush = finish(b, true);
})();

// ---- pipe fittings (uncolored; the game tints them by fill state) ---------
// Modelled in the XY wall plane: a hub + arms toward N(+Y) E(+X) S(-Y) W(-X).
// Cell size ~1 unit; arm reaches to the cell edge (0.5). Radius 0.13.
function pipePiece(dirs) {
  const b = Builder(); const R = 0.13, ARM = 0.5;
  add(b, ico(0, 1), { s: 0.2 }); // hub
  const arm = () => cylinder(R, R, ARM, 8);
  dirs.forEach((d) => {
    if (d === 'N') add(b, arm(), { t: [0, ARM / 2, 0] });
    if (d === 'S') add(b, arm(), { t: [0, -ARM / 2, 0] });
    if (d === 'E') add(b, arm(), { t: [ARM / 2, 0, 0], r: { axis: 'z', ang: Math.PI / 2 } });
    if (d === 'W') add(b, arm(), { t: [-ARM / 2, 0, 0], r: { axis: 'z', ang: Math.PI / 2 } });
  });
  return finish(b, false);
}
ASSETS.pipe_straight = pipePiece(['N', 'S']); // base orientation vertical
ASSETS.pipe_elbow = pipePiece(['N', 'E']);
ASSETS.pipe_tee = pipePiece(['N', 'E', 'S']);
ASSETS.pipe_cross = pipePiece(['N', 'E', 'S', 'W']);
ASSETS.pipe_end = pipePiece(['N']);

// ---- write ---------------------------------------------------------------
const outDir = path.resolve(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const out = 'window.PROP_ASSETS = ' + JSON.stringify(ASSETS) + ';\n';
fs.writeFileSync(path.join(outDir, 'props_data.js'), out);
let tris = 0, verts = 0;
for (const k in ASSETS) { tris += ASSETS[k].index.length / 3; verts += ASSETS[k].position.length / 3; }
console.log('baked ' + Object.keys(ASSETS).length + ' props -> assets/props_data.js  (' +
  verts + ' verts, ' + tris + ' tris, ' + (out.length / 1024).toFixed(1) + ' KB)');
