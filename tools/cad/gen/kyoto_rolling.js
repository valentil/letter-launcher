#!/usr/bin/env node
// tools/cad/gen/kyoto_rolling.js (LLF-83) — C57 tender and a JNR steel passenger coach, both on two 2-axle
// bogies with 860 mm wheels. Kernel frame: mm, x along the car (+x toward the locomotive), y left, z up, rail top 0.
//   node tools/cad/gen/kyoto_rolling.js     # rewrites tools/cad/recipes/kyoto_{c57_tender,coach}.json
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const HALF_PI = Math.PI / 2;
const EXPORT = { lods: [{ tolerance: 2 }, { tolerance: 8 }, { tolerance: 25 }], compression: { quantize: true, instance: true },
    creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false };
// 860 mm wheel, inner face against the bogie frame side at |y| = 470 (same casting as the C57 carrying wheels)
function wheelProfile(side) {
    let p = [[0, 470], [120, 470], [120, 509], [370, 509], [370, 470], [430, 470], [430, 600], [370, 600], [370, 561], [120, 561], [120, 600], [0, 600]];
    if (side === 'R') p = p.map(q => [q[0], -q[1]]).reverse();
    return p;
}
function bogies(ops, parts, centres, mat) {
    ['L', 'R'].forEach(S => {
        const axles = []; centres.forEach(c => { axles.push(c + 1225, c - 1225); });   // TR23: 2450 mm wheelbase
        ops.push({ tool: 'cad_revolve_profile', args: { profile: wheelProfile(S) }, as: `$w${S}` });
        axles.forEach((x, i) => {
            const last = i === axles.length - 1;
            ops.push({ tool: 'cad_transform', args: Object.assign({ of: `$w${S}.handle`, rotate: { rx: -HALF_PI }, translate: [x, 0, 430] }, last ? {} : { copy: true }), as: `$w${S}${i}` });
        });
    });
    ['L', 'R'].forEach(S => [0, 1, 2, 3].forEach(i => parts.push({ of: `$w${S}${i}.handle`, material: 'steel-black-enamel', nodeName: `wheel_${i + 1}_${S.toLowerCase()}` })));
    centres.forEach((c, i) => {
        // bogie frame: side faces in contact with the wheel inner faces over z 600..860 (see kyoto_c57.js strict note)
        ops.push({ tool: 'cad_box', args: { origin: [c - 1600, -470, 600], dx: 3200, dy: 940, dz: 270 }, as: `$bogie${i}` });
        parts.push({ of: `$bogie${i}.handle`, material: mat, nodeName: `bogie_${i + 1}` });
    });
}
function roof(len, halfW, z0, rise, as) {
    // arched roof: chord 2*halfW at z0, rise above it; extruded along +x (plane x-axis = +Y, y-axis = +Z, normal +X)
    const R = (halfW * halfW + rise * rise) / (2 * rise);
    return { tool: 'cad_extrude_profile', args: { profile: { outer: { start: [-halfW, z0], segments: [{ to: [halfW, z0] }, { to: [-halfW, z0], center: [0, Math.round((z0 + rise - R) * 10) / 10], ccw: true }] } },
        depth: len, plane: { origin: [-len / 2, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] } }, as };
}

function tender() {
    const ops = [], parts = [];
    bogies(ops, parts, [2000, -2000], 'effective-bogie-frame');
    ops.push({ tool: 'cad_box', args: { origin: [-3660, -1300, 870], dx: 7320, dy: 2600, dz: 200 }, as: '$under' });
    parts.push({ of: '$under.handle', material: 'effective-underframe', nodeName: 'underframe' });
    ops.push({ tool: 'cad_box', args: { origin: [-3600, -1350, 1070], dx: 7200, dy: 2700, dz: 1830 }, as: '$tank' });
    parts.push({ of: '$tank.handle', material: 'effective-c57-tender', nodeName: 'water_tank' });
    ops.push({ tool: 'cad_box', args: { origin: [400, -1150, 2900], dx: 3100, dy: 2300, dz: 420 }, as: '$coal' });
    parts.push({ of: '$coal.handle', material: 'coal', nodeName: 'coal' });
    return {
        name: 'kyoto_c57_tender',
        prompt: 'JNR C57 tender: 7320 mm long, two 2-axle bogies with 860 mm wheels, water tank with the coal space at the cab end; coupled behind kyoto_c57_chassis.',
        kind: 'prop', budget: { lod0Tris: 6000, why: 'eight 860 mm wheels at 2 mm chord dominate (~5.8k); the bodywork is boxes' },
        sources: ['https://www.kurogane-rail.jp/kurogane-doc/sl/elococ57.html', 'https://en.wikipedia.org/wiki/JNR_Class_C57', 'https://www.weblio.jp/content/TR23'],
        dimensions: {
            'tender length': '7320 mm (source 1)', 'width': '2700 mm (assumed, JNR loading gauge 2800-3000 mm)',
            'height': '3320 mm over the coal (assumed; below the 3945 mm cab roof, source 1)',
            'bogies': '2 x 2-axle at 4000 mm centres, 2450 mm wheelbase and 860 mm wheels like the JNR TR23 (source 3; tender bogie assumed equal)',
            'mass': 'effective-c57-tender density = 48 t working-order tender (115.5 t total minus 67.5 t engine, source 2) less steel parts and coal, over the modelled tank volume'
        },
        units: 'mm', ops, parts, export: EXPORT,
        joints: ['l', 'r'].flatMap(s => [1, 2, 3, 4].map(i => ({ node: `wheel_${i}_${s}`, type: 'revolute', axis: [0, 0, -1], min: -1e9, max: 1e9 }))),
        rig: { wheelR: 430, axlesX: [3225, 775, -775, -3225], lengthMm: 7320 }
    };
}

function coach() {
    const ops = [], parts = [];
    bogies(ops, parts, [7000, -7000], 'effective-bogie-frame');
    ops.push({ tool: 'cad_box', args: { origin: [-10000, -1350, 870], dx: 20000, dy: 2700, dz: 230 }, as: '$under' });
    parts.push({ of: '$under.handle', material: 'effective-underframe', nodeName: 'underframe' });
    ops.push({ tool: 'cad_box', args: { origin: [-10000, -1450, 1100], dx: 20000, dy: 2900, dz: 1900 }, as: '$body' });
    parts.push({ of: '$body.handle', material: 'effective-coach-body', nodeName: 'body' });
    ops.push(roof(20000, 1450, 3000, 380, '$roof'));
    parts.push({ of: '$roof.handle', material: 'effective-coach-roof', nodeName: 'roof' });
    [['l', 1], ['r', -1]].forEach(([s, k]) => {
        ops.push({ tool: 'cad_box', args: { origin: [-9200, k > 0 ? 1450 : -1460, 1800], dx: 18400, dy: 10, dz: 800 }, as: `$win_${s}` });
        parts.push({ of: `$win_${s}.handle`, material: 'window-glass-dark', nodeName: `window_band_${s}` });
    });
    return {
        name: 'kyoto_coach',
        prompt: 'JNR steel passenger coach (Suha 43 family): 20 m body in JNR grape-brown, arched canvas roof, window band, two 2-axle bogies with 860 mm wheels.',
        kind: 'prop', budget: { lod0Tris: 6500, why: 'eight 860 mm wheels (~5.8k at 2 mm chord) + arched roof; two coaches on screen' },
        sources: ['https://www.weblio.jp/content/TR23', 'https://en.wikipedia.org/wiki/JNR_Class_C57'],
        dimensions: {
            'body length': '20000 mm (assumed: JNR 20 m standard steel coach, Suha 43 family)', 'width': '2900 mm (assumed, JNR loading gauge)',
            'height': '3380 mm to roof crown (assumed: 3000 mm eaves + 380 mm roof rise)',
            'bogies': 'TR23 (fitted to the Suha 43, source 1): 2450 mm wheelbase, 860 mm wheels; 14000 mm bogie centres (assumed)',
            'mass': 'effective-coach-body density = 33 t tare (assumed, Suha 43 class figure) less the steel underframe/bogies/wheels, over the modelled body box'
        },
        units: 'mm', ops, parts, export: EXPORT,
        joints: ['l', 'r'].flatMap(s => [1, 2, 3, 4].map(i => ({ node: `wheel_${i}_${s}`, type: 'revolute', axis: [0, 0, -1], min: -1e9, max: 1e9 }))),
        rig: { wheelR: 430, axlesX: [8225, 5775, -5775, -8225], lengthMm: 20000 }
    };
}
function write(rc) {
    const n = rc.ops.length + rc.parts.length;
    if (n > 64) throw new Error(`${rc.name}: ops+parts ${n} > 64`);
    fs.writeFileSync(path.join(ROOT, 'tools/cad/recipes', rc.name + '.json'), JSON.stringify(rc, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    console.log(`${rc.name}: ${rc.ops.length} ops + ${rc.parts.length} parts`);
}
if (require.main === module) { write(tender()); write(coach()); }
