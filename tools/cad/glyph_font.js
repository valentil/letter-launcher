#!/usr/bin/env node
/*
 * tools/cad/glyph_font.js — LLF-70: turn the vendored OFL font into (1) a three.js typeface JSON
 * the game loads locally (no more Helvetiker from threejs.org) and (2) the glyphs.json CAD recipe
 * (each glyph's flattened outline -> cad_extrude_profile -> 40 mm rim bevel).
 *
 *   npm install            # devDependencies: opentype.js
 *   node tools/cad/glyph_font.js
 *
 * Inputs : assets/fonts/ArchivoBlack-Regular-latin.woff (SIL OFL 1.1, see assets/fonts/OFL-ArchivoBlack.txt)
 * Outputs: assets/fonts/archivo_black.typeface.json   (three.js FontLoader format, facetype.js scaling)
 *          tools/cad/glyph_outlines.json              (per-glyph contours in mm, cap height = 1000 mm)
 *          tools/cad/recipes/glyphs.json              (the NativeCAD recipe; ops are regenerated here)
 * Deterministic: re-running on the same font gives byte-identical files (so recipeHash is stable).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const FONT = path.join(ROOT, 'assets', 'fonts', 'ArchivoBlack-Regular-latin.woff');

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const CAP_MM = 1000, DEPTH = 0.4 * CAP_MM, BEVEL = 0.04 * CAP_MM, FLAT_TOL = 3, MIN_EDGE = 25, MIN_ANGLE = 25, CORNER_EDGE = 45;
const COLS = 9, PITCH_X = 1400, PITCH_Y = 1000;
const r1 = v => Math.round(v * 10) / 10;

function loadFont() {
    const ot = require('opentype.js');
    const b = fs.readFileSync(FONT);
    return ot.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

// three.js typeface JSON, same scaling as facetype.js (resolution 1000, 'q' = end point then control).
function typeface(font) {
    const scale = (1000 * 100) / ((font.unitsPerEm || 2048) * 72);
    const R = v => Math.round(v * scale);
    const glyphs = {};
    for (let code = 32; code <= 126; code++) {
        const ch = String.fromCharCode(code);
        const g = font.charToGlyph(ch);
        if (!g || (g.index === 0 && code !== 32)) continue;
        let o = '';
        g.path.commands.forEach(c => {
            if (c.type === 'M') o += `m ${R(c.x)} ${R(c.y)} `;
            else if (c.type === 'L') o += `l ${R(c.x)} ${R(c.y)} `;
            else if (c.type === 'Q') o += `q ${R(c.x)} ${R(c.y)} ${R(c.x1)} ${R(c.y1)} `;
            else if (c.type === 'C') o += `b ${R(c.x)} ${R(c.y)} ${R(c.x1)} ${R(c.y1)} ${R(c.x2)} ${R(c.y2)} `;
        });
        const bb = g.getBoundingBox();
        glyphs[ch] = { ha: R(g.advanceWidth), x_min: R(bb.x1), x_max: R(bb.x2), o: o.trim() };
    }
    const fbb = font.tables.head;
    return {
        glyphs, familyName: 'Archivo Black', ascender: R(font.ascender), descender: R(font.descender),
        underlinePosition: R(font.tables.post.underlinePosition), underlineThickness: R(font.tables.post.underlineThickness),
        boundingBox: { xMin: R(fbb.xMin), yMin: R(fbb.yMin), xMax: R(fbb.xMax), yMax: R(fbb.yMax) },
        resolution: 1000,
        original_font_information: { format: 0, fontFamily: 'Archivo Black', fontSubfamily: 'Regular',
            copyright: 'Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack)',
            license: 'SIL Open Font License 1.1 (assets/fonts/OFL-ArchivoBlack.txt)', generator: 'tools/cad/glyph_font.js (LLF-70)' },
        cssFontWeight: 'bold', cssFontStyle: 'normal',
    };
}

// Contours as segment lists in mm (u = pen x, v = up from baseline). Zero-length segments dropped.
// A run of quadratic segments whose shared on-curve points are the midpoints of the neighbouring
// controls (TrueType's implied points) is exactly ONE uniform quadratic B-spline with controls
// [p0, c1..cn, pn] and knots [0,0,0,1..n-1,n,n,n]; we emit it as one tangent-continuous entity
// ('S'), which keeps glyph_outlines.json compact and exact. Others stay single Beziers.
function outlines(font) {
    const capUnits = font.tables.os2.sCapHeight || font.charToGlyph('H').getBoundingBox().y2;
    const s = CAP_MM / capUnits;
    const P = p => [r1(p[0] * s), r1(p[1] * s)];
    const out = {};
    CHARS.forEach(ch => {
        const g = font.charToGlyph(ch);
        const raw = []; let cur = null, start = null, pen = null;
        const same = (a, b) => a[0] === b[0] && a[1] === b[1];
        g.path.commands.forEach(c => {
            if (c.type === 'M') { cur = []; raw.push(cur); start = pen = [c.x, c.y]; }
            else if (c.type === 'L') { const p = [c.x, c.y]; if (!same(p, pen)) cur.push({ t: 'L', p0: pen, p1: p }); pen = p; }
            else if (c.type === 'Q') { const p = [c.x, c.y]; if (!same(p, pen)) cur.push({ t: 'Q', p0: pen, c: [c.x1, c.y1], p1: p }); pen = p; }
            else if (c.type === 'Z') { if (!same(pen, start)) cur.push({ t: 'L', p0: pen, p1: start }); pen = start; }
        });
        const contours = raw.filter(k => k.length >= 2).map(cont => {
            const segs = [];
            cont.forEach(sg => {
                const last = segs[segs.length - 1];
                if (sg.t === 'Q' && last && last.t === 'S') {
                    const cPrev = last.ctrl[last.ctrl.length - 2];
                    const mid = [(cPrev[0] + sg.c[0]) / 2, (cPrev[1] + sg.c[1]) / 2];
                    if (Math.abs(mid[0] - sg.p0[0]) <= 0.5 && Math.abs(mid[1] - sg.p0[1]) <= 0.5) {
                        last.ctrl.splice(last.ctrl.length - 1, 1, sg.c, sg.p1); return;
                    }
                }
                if (sg.t === 'Q') segs.push({ t: 'S', ctrl: [sg.p0, sg.c, sg.p1] });
                else segs.push(sg);
            });
            return segs.map(sg => sg.t === 'L' ? { t: 'L', p0: P(sg.p0), p1: P(sg.p1) } : { t: 'S', ctrl: sg.ctrl.map(P) });
        });
        const bb = g.getBoundingBox();
        out[ch] = { advanceMm: r1(g.advanceWidth * s), bboxMm: [r1(bb.x1 * s), r1(bb.y1 * s), r1(bb.x2 * s), r1(bb.y2 * s)], contours };
    });
    return { capUnits, mmPerUnit: s, chars: out };
}
// Flatten one contour (segment list in mm) to a polygon: each quadratic span of a B-spline gets
// enough chords for a sagitta <= tolMm. Returns [[u,v],...] without the closing duplicate.
function flatten(contour, tolMm) {
    const pts = [];
    const push = p => { const l = pts[pts.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-6) pts.push(p); };
    contour.forEach(sg => {
        if (sg.t === 'L') { push(sg.p0); return; }
        const c = sg.ctrl, n = c.length - 2;           // n quadratic spans
        for (let i = 0; i < n; i++) {
            const a = i === 0 ? c[0] : [(c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2];
            const m = c[i + 1];
            const b = i === n - 1 ? c[n + 1] : [(c[i + 1][0] + c[i + 2][0]) / 2, (c[i + 1][1] + c[i + 2][1]) / 2];
            // sagitta of a quadratic ~ |a - 2m + b| / 4 for one chord; k chords -> / k^2
            const dev = Math.hypot(a[0] - 2 * m[0] + b[0], a[1] - 2 * m[1] + b[1]) / 4;
            const k = Math.max(1, Math.ceil(Math.sqrt(dev / tolMm)));
            for (let j = 0; j < k; j++) {
                const t = j / k, u = 1 - t;
                push([u * u * a[0] + 2 * u * t * m[0] + t * t * b[0], u * u * a[1] + 2 * u * t * m[1] + t * t * b[1]]);
            }
        }
    });
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) pts.pop();
    // Collapse edges shorter than MIN_EDGE to their midpoint: a 12 mm step next to a square corner
    // (the J terminal) is narrower than the 40 mm bevel's setback and the chamfer refuses it
    // (chamfer-sel-setback-exceeds-face). Visually nil at cap 1000 mm.
    for (let again = true; again && pts.length > 3;) {
        again = false;
        for (let i = 0; i < pts.length && pts.length > 3; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) < MIN_EDGE) {
                pts[i] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                pts.splice((i + 1) % pts.length, 1);
                again = true;
            }
        }
    }
    // A short edge (< CORNER_EDGE) that ends in a real corner (turn > 30 deg) leaves the 40 mm bevel
    // no room for its rails (chamfer-sel-setback-too-large on the 2's 32 mm curve-to-shelf step):
    // drop its other, non-corner end so the curve runs straight into the corner.
    const turn = (a, b, d) => { const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - b[0], d[1] - b[1]];
        return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])))); };
    for (let again = true; again && pts.length > 3;) {
        again = false;
        for (let i = 0; i < pts.length && pts.length > 3; i++) {
            const n = pts.length, p0 = pts[(i - 1 + n) % n], a = pts[i], b = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= CORNER_EDGE) continue;
            const ca = turn(p0, a, b) > Math.PI / 6, cb = turn(a, b, p3) > Math.PI / 6;
            if (ca && cb) continue;              // a deliberate short step between two corners
            if (cb) { pts.splice(i, 1); again = true; } else if (ca) { pts.splice((i + 1) % n, 1); again = true; }
        }
    }
    // Needle-sharp corners (< MIN_ANGLE: the slits beside the M's stems) make the two bevels cross
    // and the kernel builds a self-crossing spike 120 mm above the cap. Truncate such a slit where it
    // is SLIT_W wide (2 x bevel + 10 mm): walk down the shorter side until both sides are long enough,
    // then replace the tip by a flat end of width SLIT_W.
    const SLIT_W = 2 * BEVEL + 10;
    for (let guard = 0; guard < 400 && pts.length > 3; guard++) {
        let hit = -1, ang = 0;
        for (let i = 0; i < pts.length; i++) {
            const n = pts.length, a = pts[(i - 1 + n) % n], b = pts[i], d = pts[(i + 1) % n];
            const u = [a[0] - b[0], a[1] - b[1]], v = [d[0] - b[0], d[1] - b[1]];
            const t = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1]))));
            if (t < MIN_ANGLE * Math.PI / 180) { hit = i; ang = t; break; }
        }
        if (hit < 0) break;
        const n = pts.length, ia = (hit - 1 + n) % n, id = (hit + 1) % n, a = pts[ia], b = pts[hit], d = pts[id];
        const la = Math.hypot(a[0] - b[0], a[1] - b[1]), ld = Math.hypot(d[0] - b[0], d[1] - b[1]);
        const L = SLIT_W / (2 * Math.sin(ang / 2));
        if (L <= Math.min(la, ld)) {
            pts.splice(hit, 1, [b[0] + (a[0] - b[0]) / la * L, b[1] + (a[1] - b[1]) / la * L], [b[0] + (d[0] - b[0]) / ld * L, b[1] + (d[1] - b[1]) / ld * L]);
        } else {
            pts.splice(la < ld ? ia : id, 1);   // walk the shorter side one vertex further
        }
    }
    return pts.map(p => [r1(p[0]), r1(p[1])]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
}
function area(l) { let a = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function knots(nCtrl) { const n = nCtrl - 2, k = [0, 0, 0]; for (let i = 1; i < n; i++) k.push(i); k.push(n, n, n); return k; }

// Grid slot of glyph i in the kernel frame (mm, +Z up). Sketch plane: u -> +X, v -> +Z, so the
// plane normal is -Y and the extrude runs from y = oy to y = oy - DEPTH (glTF +Z = toward camera).
function slot(i) { return { ox: (i % COLS) * PITCH_X, oy: -Math.floor(i / COLS) * PITCH_Y }; }
const nodeName = ch => 'glyph_' + ch;

function recipe(ol) {
    const ops = [], parts = [];
    CHARS.forEach((ch, i) => {
        const { ox, oy } = slot(i), k = ch;
        // Closed polygons (chord sagitta <= FLAT_TOL), outer CCW + holes CW, extruded inline. The
        // kernel's edge treatments need planar side walls (rolling-ball blends refuse B-spline
        // extrusion walls; CADSF-943 refuses rim fillets on closed polygon loops), so the rim bevel
        // is a 40 mm chamfer that mitres at every vertex.
        const loops = ol.chars[ch].contours.map(cont => flatten(cont, FLAT_TOL));
        const outer = loops.reduce((best, l) => Math.abs(area(l)) > Math.abs(area(best)) ? l : best, loops[0]);
        const holes = loops.filter(l => l !== outer).map(l => area(l) > 0 ? l.slice().reverse() : l);
        const args = { plane: { origin: [ox, oy, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] }, outer: area(outer) < 0 ? outer.slice().reverse() : outer, depth: DEPTH };
        if (holes.length) args.holes = holes;
        ops.push({ tool: 'cad_extrude_profile', args, as: `$x${k}` });
        const slab = y => ({ bbox: { min: [ox - 600, y - 1, -600], max: [ox + 1800, y + 1, 1600] }, all: true });
        ops.push({ tool: 'cad_chamfer_edges', args: { of: `$x${k}.handle`, distance: BEVEL, edges: [slab(oy), slab(oy - DEPTH)] }, as: `$g${k}` });
        parts.push({ of: `$g${k}.handle`, material: 'letter-foam', nodeName: nodeName(ch) });
    });
    return {
        name: 'glyphs',
        prompt: 'The 36 game letters A-Z and 0-9 as real solids: Archivo Black glyph outlines (exact quadratic B-splines from the font), cap height 1000 mm, extruded 0.4 x cap = 400 mm deep, 0.04 x cap = 40 mm bevel (chamfer) on the front and back rims; outlines flattened to closed polylines with <= 3 mm chord sagitta. One node per glyph, laid out on a 9 x 4 grid (1400 mm x 1000 mm pitch) standing on z = 0.',
        kind: 'hero',
        budget: { lod0Tris: 12000, why: '36 independent beveled glyphs in one file (~260 tris each, 9.5k total); a scene shows at most a few dozen letters, all sharing these geometries' },
        sources: [
            'https://github.com/Omnibus-Type/ArchivoBlack',
            'https://www.npmjs.com/package/@fontsource/archivo-black',
            'https://openfontlicense.org/open-font-license-official-text/'
        ],
        dimensions: {
            'cap height': '1000 mm = font OS/2 sCapHeight ' + ol.capUnits + ' units (source 1); runtime scales per letter',
            'depth': '400 mm = 0.4 x cap (LLF-70 spec)',
            'rim bevel': '40 mm = 0.04 x cap on front + back rims (LLF-70 spec; chamfer, because the kernel fillet refuses closed polygon rims and non-planar walls)', 'chord tolerance': '3 mm sagitta when flattening the quadratic outline (0.3% of cap height)',
            'outline': 'font quadratic contours (implied-point runs merged into one uniform quadratic B-spline each), mm = units x ' + ol.mmPerUnit.toFixed(6) + ', rounded to 0.1 mm (tools/cad/glyph_font.js)',
            'material': 'letter-foam: physics/runtime density is chosen per letter material in src/core/glyphs.js (assumed: unit density 1000 kg/m^3 for the manifest)'
        },
        units: 'mm',
        batchSize: 4,
        floor: 'baseline',
        runNote: 'ops are 2 per glyph (extrude, chamfer). The NativeCAD session is shared with other lanes that reset it, so the recipe runs as 9 self-contained cad_batch calls of 4 glyphs (node tools/cad/glyph_font.js --chunk <0..8> <worktree windows path> prints one): the first op takes document "new", the rest "$<first>.document", then the 12 cad_set_part ops and one cad_export_body (the export block below; strict:false because the glyphs are 36 independent parts, not an assembly) to assets/cad/glyphs_part<n>.glb. node tools/cad/glb_merge.js joins them into glyphs.glb.',
        ops, parts,
        export: {
            lods: [{ tolerance: 2 }, { tolerance: 6 }, { tolerance: 20 }],
            compression: { quantize: true, instance: true },
            creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false, uv: 'normalized', strict: false
        },
        joints: []
    };
}

// One self-contained cad_batch for glyphs [n*size, n*size+size): own document, set_part, export.
function chunk(n, winRoot, size) {
    size = size || 4;
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes', 'glyphs.json'), 'utf8'));
    const mats = require('./materials_lib.js').loadMaterials();
    const a = n * size, b = Math.min(a + size, r.parts.length), per = r.ops.length / r.parts.length;
    const ops = r.ops.slice(a * per, b * per).map((o, i) => ({ tool: o.tool, args: Object.assign({ document: i === 0 ? 'new' : r.ops[a * per].as + '.document' }, o.args), as: o.as }));
    const doc = r.ops[a * per].as + '.document';
    r.parts.slice(a, b).forEach(p => ops.push({ tool: 'cad_set_part', args: { document: doc, of: p.of, part: p.nodeName, material: p.material } }));
    const ex = Object.assign({}, r.export); delete ex.upAxis;
    const mat = r.parts[a].material;
    ops.push({ tool: 'cad_export_body', args: Object.assign({ document: doc, format: 'glb', lodMode: 'single',
        path: winRoot.replace(/[\\/]+$/, '') + '\\assets\\cad\\glyphs_part' + n + '.glb',
        material: { name: mat, pbrMetallicRoughness: mats[mat].pbr } }, ex) });
    return ops;
}

function main() {
    const ci = process.argv.indexOf('--chunk');
    if (ci > 0) { console.log(JSON.stringify(chunk(Number(process.argv[ci + 1]), process.argv[ci + 2] || 'C:\\clawds\\main_bot_dev\\clawd-workspace\\showcase\\letter-launcher'))); return; }
    const font = loadFont();
    const tf = typeface(font);
    fs.writeFileSync(path.join(ROOT, 'assets', 'fonts', 'archivo_black.typeface.json'), JSON.stringify(tf) + '\n');
    const ol = outlines(font);
    ol.layout = { cols: COLS, pitchXmm: PITCH_X, pitchYmm: PITCH_Y, depthMm: DEPTH, bevelMm: BEVEL, flatTolMm: FLAT_TOL,
        slots: Object.fromEntries(CHARS.map((c, i) => [c, slot(i)])) };
    fs.writeFileSync(path.join(__dirname, 'glyph_outlines.json'), JSON.stringify(ol) + '\n');
    fs.writeFileSync(path.join(__dirname, 'recipes', 'glyphs.json'), JSON.stringify(recipe(ol), null, 1) + '\n');
    console.log(`typeface: ${Object.keys(tf.glyphs).length} glyphs; outlines: ${CHARS.length}; segments: ` +
        CHARS.reduce((n, c) => n + ol.chars[c].contours.reduce((m, k) => m + k.length, 0), 0) + `; recipe bytes ${fs.statSync(path.join(__dirname, 'recipes', 'glyphs.json')).size}`);
}
module.exports = { flatten, CHARS, slot, nodeName, CAP_MM, DEPTH, BEVEL };
if (require.main === module) main();
