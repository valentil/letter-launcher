#!/usr/bin/env node
/*
 * tools/cad/sweep_check.js — joint-sweep interference check for a rigged GLB (LLF-74).
 *
 *   node tools/cad/sweep_check.js robot_arm [--samples 13]
 *
 * For each joint in manifest[name].joints, sweeps that joint across its full [min, max] range
 * (others held at zero, the DH home pose) and reports any NON-adjacent pair of links whose meshes
 * interpenetrate: a vertex of link A strictly inside link B's closed mesh (ray-parity test on the
 * coarsest LOD). Adjacent links share their joint faces by design and are skipped.
 * Prints a JSON report; exit 1 when any interference is found. Plain Node, no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const glb = require('./glb');
const ROOT = path.join(__dirname, '..', '..');

function mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(t, q, s) {
  t = t || [0, 0, 0]; q = q || [0, 0, 0, 1]; s = s || [1, 1, 1];
  const [x, y, z, w] = q;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1];
  for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[c * 4 + k] *= s[c];
  return m;
}
function qAxis(a, ang) { const n = Math.hypot(a[0], a[1], a[2]), s = Math.sin(ang / 2) / n; return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)]; }
function qMul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
function apply(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }

// ray along a fixed skew direction; Moller-Trumbore parity count
const DIR = [0.5773, 0.5774, 0.5775];
function inside(p, tris, bb) {
  if (p[0] <= bb[0] || p[1] <= bb[1] || p[2] <= bb[2] || p[0] >= bb[3] || p[1] >= bb[4] || p[2] >= bb[5]) return false;
  let n = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const e1 = [tris[t + 3] - tris[t], tris[t + 4] - tris[t + 1], tris[t + 5] - tris[t + 2]];
    const e2 = [tris[t + 6] - tris[t], tris[t + 7] - tris[t + 1], tris[t + 8] - tris[t + 2]];
    const h = [DIR[1] * e2[2] - DIR[2] * e2[1], DIR[2] * e2[0] - DIR[0] * e2[2], DIR[0] * e2[1] - DIR[1] * e2[0]];
    const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(a) < 1e-12) continue;
    const f = 1 / a, s = [p[0] - tris[t], p[1] - tris[t + 1], p[2] - tris[t + 2]];
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]); if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = f * (DIR[0] * q[0] + DIR[1] * q[1] + DIR[2] * q[2]); if (v < 0 || u + v > 1) continue;
    const d = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]); if (d > 1e-9) n++;
  }
  return (n & 1) === 1;
}

function check(name, opts) {
  opts = opts || {};
  const samples = opts.samples || 13, margin = opts.marginM == null ? 0.002 : opts.marginM;
  const e = require('./manifest_store').read(name);   // assets/cad/manifest.d/<name>.json (LLF-104)
  if (!e) throw new Error(`no assets/cad/manifest.d/${name}.json`);
  const g = glb.readGlb(fs.readFileSync(path.join(ROOT, 'assets', 'cad', e.file)));
  const nodes = g.json.nodes, idx = {}; nodes.forEach((n, i) => { idx[n.name] = i; });
  const recipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'cad', 'recipes', name + '.json'), 'utf8'));
  const links = recipe.rig.links.map((l) => l.node);
  const linkOfPart = {}; recipe.rig.links.forEach((l, li) => l.parts.forEach((p) => { linkOfPart[p] = li; }));
  // local (pivot-relative) coarse-LOD vertices + triangles per link
  const L = links.map(() => ({ v: [], t: [] }));
  const lvl = glb.lodLevelCount(g) - 1;
  glb.partNodes(g).forEach((p) => {
    const li = linkOfPart[p.name]; if (li === undefined) return;
    const id = lvl && p.lodIds.length ? p.lodIds[Math.min(lvl, p.lodIds.length) - 1] : p.index;
    const local = trs(nodes[id].translation, nodes[id].rotation, nodes[id].scale);
    g.json.meshes[nodes[id].mesh].primitives.forEach((pr) => {
      const P = glb.readAccessor(g, pr.attributes.POSITION), I = glb.readAccessor(g, pr.indices), base = L[li].v.length / 3;
      for (let i = 0; i < P.length; i += 3) L[li].v.push(...apply(local, [P[i], P[i + 1], P[i + 2]]));
      I.forEach((k) => L[li].t.push(base + k));
    });
  });
  const jointOf = {}; e.joints.forEach((j) => { jointOf[j.node] = j; });
  const findings = []; let poses = 0;
  e.joints.forEach((jt) => {
    for (let s = 0; s < samples; s++) {
      const ang = jt.min + (jt.max - jt.min) * s / (samples - 1);
      poses++;
      // world matrix per link
      const W = []; let parent = trs();
      links.forEach((ln, li) => {
        const n = nodes[idx[ln]];
        let q = n.rotation || [0, 0, 0, 1];
        if (ln === jt.node) q = qMul(q, qAxis(jt.axis, ang));
        parent = mul(parent, trs(n.translation, q, n.scale));
        W[li] = parent;
      });
      const world = L.map((l, li) => {
        const v = []; for (let i = 0; i < l.v.length; i += 3) v.push(...apply(W[li], [l.v[i], l.v[i + 1], l.v[i + 2]]));
        const tris = []; l.t.forEach((k) => tris.push(v[k * 3], v[k * 3 + 1], v[k * 3 + 2]));
        const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], v[i + k] + margin); bb[k + 3] = Math.max(bb[k + 3], v[i + k] - margin); }
        return { v, tris, bb };
      });
      for (let a = 0; a < links.length; a++) for (let b = 0; b < links.length; b++) {
        if (Math.abs(a - b) < 2) continue;
        let hits = 0;
        for (let i = 0; i < world[a].v.length; i += 3) if (inside([world[a].v[i], world[a].v[i + 1], world[a].v[i + 2]], world[b].tris, world[b].bb)) hits++;
        if (hits) findings.push({ joint: jt.name || jt.node, angleDeg: +(ang * 180 / Math.PI).toFixed(1), a: links[a], b: links[b], vertsInside: hits });
      }
    }
  });
  return { name, poses, samplesPerJoint: samples, interferences: findings.length, findings };
}

module.exports = { check };
if (require.main === module) {
  const n = process.argv[2] || 'robot_arm';
  const si = process.argv.indexOf('--samples');
  const r = check(n, { samples: si > 0 ? +process.argv[si + 1] : 13 });
  console.log(JSON.stringify(Object.assign({}, r, { findings: r.findings.slice(0, 40) }), null, 2));
  process.exit(r.interferences ? 1 : 0);
}
