#!/usr/bin/env node
// tools/cad/gen/tower.js (LLF-85) - writes the four TOWER BUILD recipes:
//   tower_crane (lattice mast + slewing ring + jib + counter-jib + cab), tower_hook (hook block with two
//   sheaves + forged J hook), tower_block (cored concrete block), tower_beam (W14x90 column stub on cap plates).
// Lattice panels are ONE extruded Warren-truss outline each (triangular holes), so a strict export sees
// butt-jointed, non-overlapping parts. Run: node tools/cad/gen/tower.js
'use strict';
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'recipes');
const area = p => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const ccw = p => area(p) < 0 ? p.slice().reverse() : p;
const cw = p => area(p) > 0 ? p.slice().reverse() : p;
const r1 = v => Math.round(v * 10) / 10;
// shrink a triangle toward its centroid so the remaining member is `m` wide
function shrink(t, m) {
    const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const s = (d(t[0], t[1]) + d(t[1], t[2]) + d(t[2], t[0])) / 2, ri = Math.abs(area(t)) / s;
    const k = Math.max(0.2, 1 - m / ri);
    return t.map(p => [r1(c[0] + (p[0] - c[0]) * k), r1(c[1] + (p[1] - c[1]) * k)]);
}
// Warren truss panel, chords run along the LONG axis. Returns {outer, holes} in (long, short) coords.
function warren(L, S, n, m) {
    const tris = [];
    for (let j = 0; j < n; j++) tris.push([[j * L / n, 0], [(j + 1) * L / n, 0], [(j + 0.5) * L / n, S]]);
    for (let j = 0; j < n - 1; j++) tris.push([[(j + 0.5) * L / n, S], [(j + 1.5) * L / n, S], [(j + 1) * L / n, 0]]);
    return { outer: ccw([[0, 0], [L, 0], [L, S], [0, S]]), holes: tris.map(t => cw(shrink(t, m))) };
}
const recipes = {};

// ---------------- tower_crane ----------------
(function () {
    const ops = [], parts = [];
    const add = (tool, args, as, part) => { ops.push({ tool, args, as: '$' + as }); if (part) parts.push({ of: '$' + as + '.handle', material: part[0], nodeName: as }); };
    const W = 1200, T = 100, SEC = 3100, NS = 4, BAL = 600;
    // ballast block under the mast, on z = 0
    add('cad_box', { dx: 3000, dy: 3000, dz: BAL, origin: [-1500, -1500, 0] }, 'ballast_base', ['concrete']);
    for (let s = 0; s < NS; s++) {
        const z0 = BAL + s * SEC, pan = warren(SEC, W, 4, 90);
        // vertical truss: long axis = z. profile (u,v)=(z-ish,...) so swap: we want chords vertical, so use (short, long)
        const sw = { outer: ccw(pan.outer.map(p => [p[1], p[0]])), holes: pan.holes.map(h => cw(h.map(p => [p[1], p[0]]))) };
        // faces perpendicular to Y (XZ plane, normal -Y): profile x -> world x (-W/2..W/2), y -> world z
        const xz = (name, ytop) => add('cad_extrude_profile', { profile: { outer: sw.outer.map(p => [r1(p[0] - W / 2), r1(p[1])]), holes: sw.holes.map(h => h.map(p => [r1(p[0] - W / 2), r1(p[1])])) },
            plane: { origin: [0, ytop, z0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] }, depth: T }, name, ['safety-yellow-steel']);
        // faces perpendicular to X (YZ plane, normal +X); width W-2T so they butt against the XZ panels
        const iw = W - 2 * T, swy = { outer: ccw(warren(SEC, iw, 4, 90).outer.map(p => [p[1], p[0]])), holes: warren(SEC, iw, 4, 90).holes.map(h => cw(h.map(p => [p[1], p[0]]))) };
        const yz = (name, x0) => add('cad_extrude_profile', { profile: { outer: swy.outer.map(p => [r1(p[0] - iw / 2), r1(p[1])]), holes: swy.holes.map(h => h.map(p => [r1(p[0] - iw / 2), r1(p[1])])) },
            plane: { origin: [x0, 0, z0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] }, depth: T }, name, ['safety-yellow-steel']);
        xz('mast' + s + '_s', -W / 2 + T);      // y in [-600,-500]
        xz('mast' + s + '_n', W / 2);           // y in [500,600]
        yz('mast' + s + '_w', -W / 2);          // x in [-600,-500]
        yz('mast' + s + '_e', W / 2 - T);       // x in [500,600]
    }
    const ZT = BAL + NS * SEC;                   // 13000
    add('cad_cylinder', { r: 900, h: 150, origin: [0, 0, ZT] }, 'slewing_ring', ['mild-steel']);
    const ZD = ZT + 150;                         // jib deck underside 13150
    const J0 = -13000, J1 = 600, JH = 900;
    add('cad_box', { dx: J1 - J0, dy: 800, dz: 150, origin: [J0, -400, ZD] }, 'jib_deck', ['mild-steel']);
    const jp = warren(J1 - J0, JH, 13, 80);
    const jprof = { outer: jp.outer.map(p => [r1(p[0] + J0), r1(p[1])]), holes: jp.holes.map(h => h.map(p => [r1(p[0] + J0), r1(p[1])])) };
    add('cad_extrude_profile', { profile: jprof, plane: { origin: [0, -300, ZD + 150], xAxis: [1, 0, 0], yAxis: [0, 0, 1] }, depth: 80 }, 'jib_truss_s', ['safety-yellow-steel']);   // y in [-380,-300]
    add('cad_extrude_profile', { profile: jprof, plane: { origin: [0, 380, ZD + 150], xAxis: [1, 0, 0], yAxis: [0, 0, 1] }, depth: 80 }, 'jib_truss_n', ['safety-yellow-steel']);   // y in [300,380]
    add('cad_box', { dx: J1 - J0, dy: 760, dz: 100, origin: [J0, -380, ZD + 150 + JH] }, 'jib_top_chord', ['safety-yellow-steel']);
    add('cad_box', { dx: 3400, dy: 800, dz: 150, origin: [J1, -400, ZD] }, 'counter_deck', ['mild-steel']);
    add('cad_box', { dx: 1500, dy: 1200, dz: 1200, origin: [J1 + 1700, -600, ZD + 150] }, 'counterweight_a', ['concrete']);
    add('cad_box', { dx: 1500, dy: 1200, dz: 1200, origin: [J1 + 200, -600, ZD + 150] }, 'counterweight_b', ['concrete']);
    add('cad_box', { dx: 1200, dy: 1000, dz: 1400, origin: [-600, -1600, ZT - 1400] }, 'operator_cab', ['glass-tinted']);
    recipes.tower_crane = {
        name: 'tower_crane',
        prompt: 'Flat-top tower crane for the TOWER BUILD level: 3 x 3 m concrete ballast, 1.2 m square lattice mast of four 3.1 m sections (Warren-truss panels), 1.8 m slewing ring, 13.6 m jib with trolley rail and lattice side trusses, counter-jib with two concrete counterweights and an operator cab beside the mast. Jib points along -X; mast axis is the origin.',
        kind: 'hero', budget: { lod0Tris: 20000, why: 'lattice truss panels: 7 triangular cut-outs per mast panel and 25 on each jib side' },
        sources: [
            'https://en.wikipedia.org/wiki/Tower_crane',
            'https://www.liebherr.com/en/int/products/construction-machines/tower-cranes/hammerhead-cranes/hammerhead-cranes.html',
            'https://www.potain.com/en/products/tower-cranes/topless'
        ],
        dimensions: {
            'mast section': '1.2 m x 1.2 m square lattice, 3.1 m tall (real units: 1.2-2.0 m x 3.0-6.0 m, Liebherr/Potain brochures, sources 2 and 3)',
            'mast height': '12.4 m modelled, 4 sections on a 0.6 m ballast base (scaled to the 14 m game site, assumed)',
            'jib': '13.6 m long from the slewing axis with a 0.9 m deep Warren truss, 0.8 m wide trolley deck (assumed from a small flat-top crane, source 3)',
            'counter-jib': '3.4 m with 2 concrete counterweights 1.5 x 1.2 x 1.2 m (assumed)',
            'truss members': 'about 90 mm wide, 100 mm thick flat bar (assumed); panels are single extrusions so the strict assembly check sees butt joints'
        },
        units: 'mm', ops, parts,
        export: { lods: [{ tolerance: 2 }, { tolerance: 8 }, { tolerance: 30 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false }
    };
})();

// ---------------- tower_hook ----------------
(function () {
    const ops = [], parts = [];
    const add = (tool, args, as, part) => { ops.push({ tool, args, as: '$' + as }); if (part) parts.push({ of: '$' + as + '.handle', material: part[0], nodeName: as }); };
    // forged J hook plate (wide throat and a tall tip so a 0.5-1 m letter can be slipped over the tip), XZ plane, y in [-60,60] (plane normal is -Y, so origin y = +60)
    add('cad_extrude_profile', { profile: { outer: [[-50, 0], [650, 0], [650, 500], [550, 500], [550, 100], [50, 100], [50, 900], [-50, 900]] },
        plane: { origin: [0, 60, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] }, depth: 120 }, 'hook_j', ['ductile-iron-red']);
    add('cad_box', { dx: 500, dy: 60, dz: 600, origin: [-250, -120, 700] }, 'cheek_s', ['powder-black-steel']);
    add('cad_box', { dx: 500, dy: 60, dz: 600, origin: [-250, 60, 700] }, 'cheek_n', ['powder-black-steel']);
    // each sheave is ONE revolve (rim 100 mm radius x 100 wide, 40 mm hub through the cheeks), so only the small hub discs touch the cheeks
    [['sheave_a', -120], ['sheave_b', 120]].forEach(function (sh) {
        add('cad_revolve_profile', { profile: [[0, 0], [40, 0], [40, 10], [100, 10], [100, 110], [40, 110], [40, 120], [0, 120]] }, sh[0] + '_rev');
        add('cad_transform', { of: '$' + sh[0] + '_rev.handle', rotate: { rx: -1.5707963267949 }, translate: [sh[1], -60, 1100] }, sh[0], ['mild-steel']);
    });
    add('cad_box', { dx: 500, dy: 240, dz: 100, origin: [-250, -120, 1300] }, 'crossbar', ['safety-yellow-steel']);
    recipes.tower_hook = {
        name: 'tower_hook',
        prompt: 'Crane hook block: forged J hook (100 mm bar, 500 mm throat), two 60 mm side cheeks, two 200 mm sheaves that spin with cable payout and a 500 mm crossbar. Hook tip is the origin; 1.4 m tall. Sheaves are continuous joints about the cable axis.',
        kind: 'prop', budget: { lod0Tris: 3000 },
        sources: ['https://en.wikipedia.org/wiki/Hook_(device)', 'https://www.crosby.com/products/hooks', 'https://en.wikipedia.org/wiki/Block_and_tackle'],
        dimensions: {
            'hook': 'J plate 100 mm bar, 700 mm wide, 500 mm throat, 500 mm tip, forged ductile iron (shape after Crosby S-319 eye hooks, source 2; sizes assumed to suit a 1 m letter)',
            'sheaves': '200 mm diameter, 120 mm wide between two 60 mm cheeks (assumed)'
        },
        units: 'mm', ops, parts,
        export: { lods: [{ tolerance: 0.5 }, { tolerance: 2 }, { tolerance: 8 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false },
        rig: { note: 'post-export: node tools/cad/rig_glb.js tower_hook nests each sheave under a pivot on its axle', links: [
            { node: 'hook_body', pivotMm: [0, 0, 0], parts: ['hook_j', 'cheek_s', 'cheek_n', 'crossbar'] },
            { node: 'sheave_a_pivot', pivotMm: [-120, 0, 1100], parts: ['sheave_a'] }, { node: 'sheave_b_pivot', pivotMm: [120, 0, 1100], parts: ['sheave_b'] }] },
        joints: [
            { node: 'sheave_a_pivot', type: 'continuous', axis: [0, 0, 1], min: null, max: null, pivotMm: [-120, 0, 1100] },
            { node: 'sheave_b_pivot', type: 'continuous', axis: [0, 0, 1], min: null, max: null, pivotMm: [120, 0, 1100] }]
    };
})();

// ---------------- tower_block (cored concrete block) ----------------
(function () {
    const ops = [], parts = [];
    // 2.0 x 2.0 x 1.3 m precast block, four 0.5 x 0.5 m cores through the height (net section 75 %)
    const c = 500, g = 200, o = (2000 - 2 * c - g) / 2;   // wall 150 mm
    const holes = [];
    [[o, o], [o + c + g, o], [o, o + c + g], [o + c + g, o + c + g]].forEach(p => holes.push({ rect: { x: p[0] - 1000, y: p[1] - 1000, w: c, h: c } }));
    ops.push({ tool: 'cad_extrude_profile', args: { profile: { outer: [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]], holes }, depth: 1300 }, as: '$block' });
    parts.push({ of: '$block.handle', material: 'concrete', nodeName: 'block' });
    recipes.tower_block = {
        name: 'tower_block',
        prompt: 'Precast cored concrete block for the TOWER BUILD level: 2.0 x 2.0 x 1.3 m with four 0.5 x 0.5 m through-cores (150 mm walls and webs 200 mm), normal-weight concrete. Origin is the centre of the base; the block stands on z = 0.',
        kind: 'prop', budget: { lod0Tris: 3000 },
        sources: ['https://www.nrmca.org/', 'https://en.wikipedia.org/wiki/Precast_concrete', 'https://www.nist.gov/system/files/documents/2017/05/09/ps20-20.pdf'],
        dimensions: {
            'overall': '2.0 x 2.0 x 1.3 m, the size of the game block (game rule, 1 world unit = 1 m)',
            'cores': 'four 0.5 x 0.5 m cores, wall 150 mm (assumed, hollow-core precast proportions)',
            'material': 'normal-weight concrete 2400 kg/m^3, fc 30 MPa (ACI 318, materials.json)'
        },
        units: 'mm', ops, parts,
        export: { lods: [{ tolerance: 0.5 }, { tolerance: 3 }, { tolerance: 12 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false }
    };
})();

// ---------------- tower_beam (W14x90 column stub on cap plates) ----------------
(function () {
    const ops = [], parts = [];
    // W14x90: d 356 mm, bf 368 mm, tf 18 mm, tw 11.2 mm (AISC Shapes Database v16)
    const d = 356, bf = 368, tf = 18, tw = 11.2, L = 1200, P = 1700, tp = 50;
    const hf = bf / 2, hw = tw / 2, hd = d / 2;
    const I = [[-hf, -hd], [hf, -hd], [hf, -hd + tf], [hw, -hd + tf], [hw, hd - tf], [hf, hd - tf], [hf, hd], [-hf, hd], [-hf, hd - tf], [-hw, hd - tf], [-hw, -hd + tf], [-hf, -hd + tf]];
    ops.push({ tool: 'cad_box', args: { dx: P, dy: P, dz: tp, origin: [-P / 2, -P / 2, 0] }, as: '$base_plate' });
    ops.push({ tool: 'cad_extrude_profile', args: { profile: { outer: I }, plane: { origin: [0, 0, tp] }, depth: L }, as: '$w_placed' });
    ops.push({ tool: 'cad_box', args: { dx: P, dy: P, dz: tp, origin: [-P / 2, -P / 2, tp + L] }, as: '$cap_plate' });
    parts.push({ of: '$base_plate.handle', material: 'mild-steel', nodeName: 'base_plate' }, { of: '$w_placed.handle', material: 'safety-yellow-steel', nodeName: 'w_section' }, { of: '$cap_plate.handle', material: 'mild-steel', nodeName: 'cap_plate' });
    recipes.tower_beam = {
        name: 'tower_beam',
        prompt: 'Steel column block for the TOWER BUILD level: a 1.2 m W14x90 wide-flange section (d 356, bf 368, tf 18, tw 11.2 mm) welded between two 1.7 x 1.7 m x 50 mm cap plates, 1.3 m overall. Origin is the centre of the base.',
        kind: 'prop', budget: { lod0Tris: 3000 },
        sources: ['https://www.aisc.org/publications/steel-construction-manual-resources/16th-ed-v16.0/', 'https://en.wikipedia.org/wiki/I-beam', 'https://en.wikipedia.org/wiki/ASTM_A992'],
        dimensions: {
            'W14x90': 'd 14.0 in = 356 mm, bf 14.5 in = 368 mm, tf 0.710 in = 18 mm, tw 0.440 in = 11.2 mm, 90 lb/ft (AISC Shapes Database, source 1)',
            'cap plates': '1.7 m square x 50 mm so a block is as wide as the game STEEL block (assumed)',
            'grade': 'ASTM A992, Fy 345 MPa (source 3)'
        },
        units: 'mm', ops, parts,
        export: { lods: [{ tolerance: 0.5 }, { tolerance: 3 }, { tolerance: 12 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false }
    };
})();

Object.keys(recipes).forEach(n => fs.writeFileSync(path.join(OUT, n + '.json'), JSON.stringify(recipes[n], null, 2).replace(/\n/g, '\r\n') + '\r\n'));
console.log('wrote', Object.keys(recipes).map(n => n + ' (' + recipes[n].ops.length + ' ops, ' + recipes[n].parts.length + ' parts)').join(', '));
