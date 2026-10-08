#!/usr/bin/env node
// tools/cad/gen/kyoto_track.js (LLF-83) — KYOTO TRAIN permanent way. The outer and inner loops of
// src/scenes/kyoto_train.js (THREE.CatmullRomCurve3, closed, 'catmullrom', tension 0.5) are re-sampled here at even
// arc length and swept with cad_sweep_profile: a ballast shoulder and two JIS 50N-profile rails per loop. Each loop is
// swept in two halves that meet at straight segment midpoints, so the end faces touch flat (a closed sweep would
// collide with itself). World -> kernel: x = X / S * 1000, y = -Z / S * 1000 (S = 0.3 diorama scale).
// Also writes the sleeper recipe (one creosoted timber sleeper, instanced in the scene).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const S = 0.3, N = 48, GAUGE = 1067, BALLAST_H = 300, RAIL_H = 153;
const LOOPS = {
    outer: [[-18, -12], [0, -16], [18, -12], [21, 2], [13, 14], [0, 16], [-13, 14], [-21, 2]],
    inner: [[-21, 2], [-13, -3], [0, -6], [13, -3], [21, 2], [13, 14], [0, 16], [-13, 14]]
};
// THREE.CatmullRomCurve3 getPoint for closed 'catmullrom' with tension 0.5 (CubicPoly.initCatmullRom)
function crPoint(pts, t, tension) {
    const l = pts.length, p = l * t;
    let i = Math.floor(p); const w = p - i;
    i = ((i % l) + l) % l;
    const P = k => pts[((k % l) + l) % l];
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    return [0, 1].map(c => {
        const x0 = p1[c], x1 = p2[c], t0 = tension * (p2[c] - p0[c]), t1 = tension * (p3[c] - p1[c]);
        const c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1, c3 = 2 * x0 - 2 * x1 + t0 + t1;
        return x0 + t0 * w + c2 * w * w + c3 * w * w * w;
    });
}
function spaced(pts, n) {
    const M = 4000, dense = [];
    for (let k = 0; k <= M; k++) dense.push(crPoint(pts, k / M, 0.5));
    const cum = [0];
    for (let k = 1; k <= M; k++) cum.push(cum[k - 1] + Math.hypot(dense[k][0] - dense[k - 1][0], dense[k][1] - dense[k - 1][1]));
    const L = cum[M], out = [];
    for (let j = 0; j < n; j++) {
        const s = L * j / n; let k = 1; while (cum[k] < s) k++;
        const f = (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
        out.push([dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * f, dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * f]);
    }
    return { pts: out, length: L };
}
const K = p => [Math.round(p[0] / S * 1000), Math.round(-p[1] / S * 1000), 0];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function halves(pts) {
    const n = pts.length, h = n / 2;
    const A = [mid(pts[0], pts[1])], B = [mid(pts[h], pts[h + 1])];
    for (let i = 1; i <= h; i++) A.push(pts[i]);
    A.push(mid(pts[h], pts[h + 1]));
    for (let i = h + 1; i <= n; i++) B.push(pts[i % n]);
    B.push(mid(pts[0], pts[1]));
    return [A.map(K), B.map(K)];
}
// Corner fillets: 12 m, or less where the loop pinches (inner loop at its west switch) so each corner's setback
// r * tan(turn / 2) stays within 45 % of its shorter neighbouring leg (and the whole of an end leg).
function fillets(P) {
    const R = [];
    for (let i = 1; i < P.length - 1; i++) {
        const a = [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]], b = [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]];
        const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
        const turn = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))));
        const room = Math.min(i === 1 ? la * 0.9 : la * 0.45, i === P.length - 2 ? lb * 0.9 : lb * 0.45);
        R.push(Math.min(12000, Math.floor(room / Math.max(Math.tan(turn / 2), 1e-6))));
    }
    return R.every(r => r === 12000) ? 12000 : R;
}
function railSection(c) {
    const p = [[-63.5, 0], [63.5, 0], [63.5, 12], [7.5, 30], [7.5, 104], [32.5, 115], [32.5, 153], [-32.5, 153], [-32.5, 115], [-7.5, 104], [-7.5, 30], [-63.5, 12]]
        .map(q => [c + q[0], BALLAST_H + q[1]]);
    return { start: p[0], segments: p.slice(1).concat([p[0]]).map(q => ({ to: q })) };
}
const BALLAST = { start: [-1500, 0], segments: [{ to: [1500, 0] }, { to: [1100, BALLAST_H] }, { to: [-1100, BALLAST_H] }, { to: [-1500, 0] }] };
function trackRecipe(name) {
    const sp = spaced(LOOPS[name], N), [A, B] = halves(sp.pts);
    const ops = [], parts = [];
    [['a', A], ['b', B]].forEach(([h, P]) => {
        const pathArg = { points: P, fillets: fillets(P), up: [0, 0, 1] };
        ops.push({ tool: 'cad_sweep_profile', args: { section: BALLAST, path: pathArg }, as: `$ballast_${h}` });
        parts.push({ of: `$ballast_${h}.handle`, material: 'ballast-granite', nodeName: `ballast_${h}` });
        [['l', GAUGE / 2], ['r', -GAUGE / 2]].forEach(([s, c]) => {
            ops.push({ tool: 'cad_sweep_profile', args: { section: railSection(c), path: pathArg }, as: `$rail_${s}_${h}` });
            parts.push({ of: `$rail_${s}_${h}.handle`, material: 'rail-steel', nodeName: `rail_${s}_${h}` });
        });
    });
    return {
        name: 'kyoto_track_' + name,
        prompt: `KYOTO TRAIN ${name} loop: 1067 mm gauge track swept along the level's CatmullRom curve (${N} even-arc-length stations, 12 m fillets) — granite ballast shoulder 3000/2200 x 300 mm and two JIS 50N rails.`,
        kind: 'hero', budget: { lod0Tris: 30000, why: `six sweeps along a ${Math.round(sp.length / S)} m loop (the whole level's track in one asset)` },
        sources: ['https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?toGnrJISStandardDetailList&jisStdNo=E1101', 'https://en.wikipedia.org/wiki/Rail_profile', 'https://en.wikipedia.org/wiki/JNR_Class_C57'],
        dimensions: {
            'gauge': '1067 mm (JNR narrow gauge, source 3)',
            'rail': 'JIS E 1101 50N: height 153 mm, head 65 mm, foot 127 mm, web ~15 mm (sources 1, 2; profile simplified to straight facets)',
            'ballast': '300 mm deep, 2200 mm crown, 1:1.33 shoulders (assumed, typical JR narrow-gauge ballast)',
            'path': `the scene's ${name} CatmullRom loop, world units / ${S} (diorama scale) -> mm; loop length ${Math.round(sp.length / S * 1000)} mm`
        },
        units: 'mm', ops, parts,
        export: { lods: [{ tolerance: 4 }, { tolerance: 30 }, { tolerance: 120 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false },
        rig: { worldScale: S, railTopMm: BALLAST_H + RAIL_H, loopWorldLength: sp.length }
    };
}
function sleeperRecipe() {
    return {
        name: 'kyoto_sleeper',
        prompt: 'Creosoted timber sleeper for 1067 mm gauge, 2100 x 200 x 140 mm; instanced along both KYOTO TRAIN loops with its top 20 mm proud of the ballast.',
        kind: 'prop', sources: ['https://en.wikipedia.org/wiki/Railroad_tie', 'https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?toGnrJISStandardDetailList&jisStdNo=E1101'],
        dimensions: { 'sleeper': '2100 x 200 x 140 mm (JNR narrow-gauge wooden sleeper, source 1: 2100 mm for 1067 mm gauge)', 'spacing': '~600 mm centres in the scene (assumed: 39 per 25 m rail)' },
        units: 'mm',
        ops: [{ tool: 'cad_box', args: { origin: [-100, -1050, 0], dx: 200, dy: 2100, dz: 140 }, as: '$tie' }],
        parts: [{ of: '$tie.handle', material: 'creosoted-timber', nodeName: 'sleeper' }],
        export: { lods: [{ tolerance: 1 }, { tolerance: 4 }, { tolerance: 12 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false },
        rig: { spacingMm: 600, topAboveBallastMm: 20 }
    };
}
function write(rc) {
    const n = rc.ops.length + rc.parts.length;
    if (n > 64) throw new Error(`${rc.name}: ops+parts ${n} > 64`);
    fs.writeFileSync(path.join(ROOT, 'tools/cad/recipes', rc.name + '.json'), JSON.stringify(rc, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    console.log(`${rc.name}: ${rc.ops.length} ops + ${rc.parts.length} parts`);
}
module.exports = { crPoint, spaced, LOOPS };
if (require.main === module) { write(trackRecipe('outer')); write(trackRecipe('inner')); write(sleeperRecipe()); }
