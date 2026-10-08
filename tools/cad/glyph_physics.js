#!/usr/bin/env node
/*
 * tools/cad/glyph_physics.js - LLF-70: per-glyph physics data for the CAD letters.
 *
 *   npm install                      # devDependencies: earcut
 *   node tools/cad/glyph_physics.js  # -> assets/cad/glyph_physics.json
 *
 * Inputs: tools/cad/glyph_outlines.json + the SAME flattening the recipe used (glyph_font.flatten),
 *         tools/cad/massprops/glyphs.json (cad_mass_properties per glyph: volume, centroid, inertia).
 * Output, per char, in the glyph's local frame (metres, +Y up, x = pen position, y = up from the
 * baseline, z = depth centred on the glyph; a GLB node's geometry maps into it by subtracting
 * `origin`):
 *   { origin:[x,y,z] (local origin in glyphs.glb, m), com:[x,y,z], volume (m^3),
 *     inertia: 3x3 kg*m^2 about com at 1000 kg/m^3, principal:[I1,I2,I3], bbox:{min,max},
 *     hulls: [[[x,y,z]...]...]  (relative to com; <= 8 convex hulls of <= 24 verts each) }
 * Runtime scales mass by density/1000 * s^3 and inertia by density/1000 * s^5.
 *
 * Convex decomposition is done on the glyph's own sketch, not by guessing: earcut triangulates the
 * flattened outline (holes included), adjacent triangles merge while the union stays convex
 * (Hertel-Mehlhorn), then the cheapest neighbouring pairs merge (least convex-hull area added)
 * until <= MAX_HULLS remain. Pieces only merge across a shared edge, so an O stays a ring of arc
 * segments with its counter open. Each 2D piece is simplified to <= 12 vertices (dropping the
 * vertex that removes the least area) and extruded through the glyph depth -> <= 24 3D points.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const earcut = require('earcut');
const { flatten, CHARS, nodeName, DEPTH } = require('./glyph_font');

const MAX_HULLS = 8, MAX_2D = 12;
const ROOT = path.join(__dirname, '..', '..');

const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function hull(pts) {   // Andrew's monotone chain, CCW, no collinear points
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 1e-9) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
}
function isConvex(poly) {
    for (let i = 0; i < poly.length; i++) if (cross(poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]) < -1e-6) return false;
    return true;
}
// Merge two CCW index polygons that share the edge (u,v) (u->v in a, v->u in b).
function joinAt(a, b, u, v) {
    const ia = a.indexOf(u), ib = b.indexOf(v);
    const ra = a.slice(ia + 1).concat(a.slice(0, ia + 1));     // starts after u ... ends at u  (v first)
    const rb = b.slice(ib + 1).concat(b.slice(0, ib + 1));     // starts after v ... ends at v  (u first)
    // ra = [v, ..., u]; rb = [u, ..., v]  -> polygon = ra + rb minus duplicated ends
    return ra.concat(rb.slice(1, -1));
}
function sharedEdge(a, b) {
    for (let i = 0; i < a.length; i++) {
        const u = a[i], v = a[(i + 1) % a.length];
        const j = b.indexOf(v);
        if (j >= 0 && b[(j + 1) % b.length] === u) return [u, v];
    }
    return null;
}

function decompose(loops) {
    const outer = loops.reduce((best, l) => Math.abs(area(l)) > Math.abs(area(best)) ? l : best, loops[0]);
    const ordered = [outer.slice()].concat(loops.filter(l => l !== outer));
    const coords = [], holes = [], P = [];
    ordered.forEach((l, k) => { if (k) holes.push(P.length); l.forEach(p => { coords.push(p[0], p[1]); P.push(p); }); });
    const tri = earcut(coords, holes);
    let pieces = [];
    for (let i = 0; i < tri.length; i += 3) {
        let t = [tri[i], tri[i + 1], tri[i + 2]];
        if (area(t.map(k => P[k])) < 0) t = [t[0], t[2], t[1]];
        if (Math.abs(area(t.map(k => P[k]))) > 1e-6) pieces.push(t);
    }
    // 1) exact merges while convex (largest combined area first)
    for (let changed = true; changed;) {
        changed = false;
        let best = null;
        for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
            const e = sharedEdge(pieces[i], pieces[j]);
            if (!e) continue;
            const m = joinAt(pieces[i], pieces[j], e[0], e[1]);
            if (!isConvex(m.map(k => P[k]))) continue;
            const a = area(m.map(k => P[k]));
            if (!best || a > best.a) best = { i, j, m, a };
        }
        if (best) { pieces[best.i] = best.m; pieces.splice(best.j, 1); changed = true; }
    }
    // 2) approximate merges down to MAX_HULLS: least hull area added, neighbours only
    let polys = pieces.map(pc => ({ idx: pc, pts: pc.map(k => P[k]) }));
    while (polys.length > MAX_HULLS) {
        let best = null;
        for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
            const e = sharedEdge(polys[i].idx, polys[j].idx);
            if (!e) continue;
            const h = hull(polys[i].pts.concat(polys[j].pts));
            const cost = area(h) - area(polys[i].pts) - area(polys[j].pts);
            if (!best || cost < best.cost) best = { i, j, e, h, cost };
        }
        if (!best) break;
        const idx = joinAt(polys[best.i].idx, polys[best.j].idx, best.e[0], best.e[1]);
        polys[best.i] = { idx, pts: best.h };
        polys.splice(best.j, 1);
    }
    return polys.map(p => simplify(hull(p.pts)));
}
function simplify(h) {
    h = h.slice();
    while (h.length > MAX_2D) {
        let bi = 0, ba = Infinity;
        for (let i = 0; i < h.length; i++) {
            const a = Math.abs(cross(h[(i - 1 + h.length) % h.length], h[i], h[(i + 1) % h.length]));
            if (a < ba) { ba = a; bi = i; }
        }
        h.splice(bi, 1);
    }
    return h;
}
function jacobiEigen(A) {
    const a = A.map(r => r.slice()); const n = 3;
    for (let sweep = 0; sweep < 50; sweep++) {
        let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
        if (off < 1e-24) break;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
            if (Math.abs(a[p][q]) < 1e-30) continue;
            const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
            const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
            for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
            for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
        }
    }
    return [a[0][0], a[1][1], a[2][2]];
}

const r6 = v => Math.round(v * 1e6) / 1e6;
function build() {
    const ol = JSON.parse(fs.readFileSync(path.join(__dirname, 'glyph_outlines.json'), 'utf8'));
    const mp = JSON.parse(fs.readFileSync(path.join(__dirname, 'massprops', 'glyphs.json'), 'utf8'));
    const out = { _comment: 'LLF-70 glyph physics, generated by tools/cad/glyph_physics.js. Local frame: metres, +Y up, x = pen position, y = up from baseline, z = depth centred. inertia/principal in kg*m^2 about com at 1000 kg/m^3 (scale by density/1000 * s^5); volume m^3; hulls relative to com.', depthM: DEPTH / 1000, capHeightM: 1, glyphs: {} };
    CHARS.forEach(ch => {
        const m = mp[nodeName(ch)]; if (!m) throw new Error('massprops missing ' + nodeName(ch));
        const { ox, oy } = ol.layout.slots[ch];
        const c = m.centroidMm;
        const com = [(c[0] - ox) / 1000, c[2] / 1000, -(c[1] - (oy - DEPTH / 2)) / 1000];
        const K = m.inertiaAboutCentroidMm5, s = 1e-15 * 1000;   // mm^5 (rho=1) -> kg*m^2 at 1000 kg/m^3
        // kernel (x,y,z) -> local (x, z, -y)
        const I = [[K[0][0], K[0][2], -K[0][1]], [K[2][0], K[2][2], -K[2][1]], [-K[1][0], -K[1][2], K[1][1]]].map(r => r.map(v => r6(v * s)));
        const loops = ol.chars[ch].contours.map(k => flatten(k, ol.layout.flatTolMm));
        const pieces = decompose(loops);
        const hz = DEPTH / 2000;
        const hulls = pieces.map(p => [].concat(...[hz, -hz].map(z => p.map(q => [r6(q[0] / 1000 - com[0]), r6(q[1] / 1000 - com[1]), r6(z - com[2])]))));
        const all = [].concat(...loops); const xs = all.map(p => p[0] / 1000), ys = all.map(p => p[1] / 1000);
        out.glyphs[ch] = {
            node: nodeName(ch),
            origin: [r6(ox / 1000), 0, r6(-(oy - DEPTH / 2) / 1000)],
            com: com.map(r6), volume: r6(m.volumeMm3 * 1e-9),
            inertia: I, principal: jacobiEigen(I).map(r6).sort((a, b) => a - b),
            bbox: { min: [r6(Math.min(...xs)), r6(Math.min(...ys)), -hz], max: [r6(Math.max(...xs)), r6(Math.max(...ys)), hz] },
            advance: r6(ol.chars[ch].advanceMm / 1000),
            hulls,
        };
    });
    return out;
}
module.exports = { build, decompose, hull };
if (require.main === module) {
    const out = build();
    fs.writeFileSync(path.join(ROOT, 'assets', 'cad', 'glyph_physics.json'), JSON.stringify(out) + '\n');
    console.log(Object.keys(out.glyphs).map(k => k + ':' + out.glyphs[k].hulls.length).join(' '));
}
