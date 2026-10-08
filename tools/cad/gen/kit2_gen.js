#!/usr/bin/env node
// tools/cad/gen/kit2_gen.js (LLF-103 Fidelity-Kit 2): writes tools/cad/recipes/<name>.json for the sandbox-scene
// kit assets from compact specs, and appends any new stock to tools/cad/materials.json (text insert, CRLF).
//   node tools/cad/gen/kit2_gen.js [name ...]      (no names = every spec)
// Then per asset: node tools/cad/gen/batch.js <name> export <WT> -> cad_batch, node tools/cad/massprops_from_glb.js <name>,
// node tools/cad/build_manifest.js <name>.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const EOL = '\r\n';
let n = 0;
const box = (name, mat, o, d) => ({ name, mat, op: { tool: 'cad_box', args: { dx: d[0], dy: d[1], dz: d[2], origin: o } } });
const rev = (name, mat, profile) => ({ name, mat, op: { tool: 'cad_revolve_profile', args: { profile } } });
const ext = (name, mat, outer, depth, plane) => ({ name, mat, op: { tool: 'cad_extrude_profile', args: { profile: { outer }, depth, plane } } });
// plane facing -Y (XZ plane, normal = x cross y = -Y): origin is the +Y face of the plate, extrusion grows toward -Y
const XZ = (y) => ({ origin: [0, y, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] });
const octagon = (cx, cz, flats) => { const r = flats / 2 / Math.cos(Math.PI / 8); const p = []; for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; p.push([+(cx + r * Math.cos(a)).toFixed(2), +(cz + r * Math.sin(a)).toFixed(2)]); } return p; };
const ring = (ri, ro, z0, z1) => [[ri, z0], [ro, z0], [ro, z1], [ri, z1]];
const disc = (r, z0, z1) => [[0, z0], [r, z0], [r, z1], [0, z1]];

const MATS = {
    'effective-shelter-frame': { densityKgM3: 650, pbr: { baseColorFactor: [0.7, 0.72, 0.74, 1], metallicFactor: 0.9, roughnessFactor: 0.45 }, source: 'LLF-103: extruded-aluminium posts and a sheet roof on purlins modelled as solid boxes; ~6 kg per 60 mm post and ~150 kg roof (assumed catalogue norms) over the modelled volume' },
    'sign-red-alu': { densityKgM3: 2700, pbr: { baseColorFactor: [0.78, 0.05, 0.05, 1], metallicFactor: 0.1, roughnessFactor: 0.4 }, source: 'LLF-103: 3003 aluminium sign blank 2.70 g/cc (ASM), red retroreflective sheeting finish' },
    'sign-white-alu': { densityKgM3: 2700, pbr: { baseColorFactor: [0.93, 0.93, 0.92, 1], metallicFactor: 0.1, roughnessFactor: 0.4 }, source: 'LLF-103: aluminium sign blank 2.70 g/cc, white sheeting' }
};

const EXPORT = { lods: [{ tolerance: 0.5 }, { tolerance: 3 }, { tolerance: 12 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false };
const SPECS = {};
function spec(name, o) { SPECS[name] = o; }

// ---------------- CITY ----------------
spec('parking_meter', {
    prompt: 'Single-space parking meter: 50 mm dia steel pole, 1050 mm to the head, 150 x 110 x 180 mm die-cast head with a 100 x 10 x 100 mm display window, 120 mm dia dome cap, 1290 mm overall.',
    sources: ['https://en.wikipedia.org/wiki/Parking_meter', 'https://en.wikipedia.org/wiki/Die_casting'],
    dimensions: { pole: '60 mm dia x 1050 mm (assumed: catalogue single-space meter, typical 1.2-1.4 m overall, source 1)', head: '150 x 110 x 180 mm cast housing (assumed: source 1 photos / catalogue norm)', cap: '120 mm dia dome, 60 mm tall (assumed)', window: '90 x 10 x 100 mm display glazing (assumed)' },
    parts: [rev('pole', 'mild-steel', disc(30, 0, 1050)), box('head', 'a380-diecast-grey', [-75, -55, 1050], [150, 110, 180]),
        rev('cap', 'a380-diecast-grey', [[0, 1230], [60, 1230], [60, 1250], [40, 1290], [0, 1290]]), box('window', 'glass-tinted', [-45, -65, 1090], [90, 10, 100])]
});
spec('street_sign', {
    prompt: 'Regulatory stop sign: 750 mm (30 in) octagon on a 50 x 50 mm steel post, 3000 mm tall, sign centre at 2550 mm so the bottom edge clears 2.1 m, white border face with a red field.',
    sources: ['https://en.wikipedia.org/wiki/Stop_sign', 'https://mutcd.fhwa.dot.gov/pdfs/2009r1r2/pdf_index.htm'],
    dimensions: { sign: 'R1-1 stop sign 30 in (750 mm) across flats, conventional-road size (source 1, MUTCD Table 2B-1 in source 2)', post: '50 x 50 mm square steel tube, 3000 mm (assumed: catalogue norm)', mounting: 'bottom of sign 2.13+ m above ground in a pedestrian area (MUTCD 2A.18, source 2)', blank: '3 mm aluminium blank, 2 mm red face on a 3 mm white backing (assumed)' },
    parts: [box('post', 'steel-zinc-8.8', [-25, -25, 0], [50, 50, 3000]),
        ext('sign_white', 'sign-white-alu', octagon(0, 2550, 750), 3, XZ(-25)),
        ext('sign_red', 'sign-red-alu', octagon(0, 2550, 690), 2, XZ(-28))]
});
spec('manhole', {
    prompt: 'Cast-iron manhole cover and frame: 610 mm (24 in) cover on an 840 mm OD frame ring, 54 mm tall, raised concentric anti-skid ribs.',
    sources: ['https://en.wikipedia.org/wiki/Manhole_cover', 'https://en.wikipedia.org/wiki/Cast_iron'],
    dimensions: { cover: '660 mm dia x 25 mm (24 in clear opening is the industry norm, source 1)', frame: '600 mm bore, 840 mm OD x 25 mm (assumed: catalogue norm)', ribs: '30 mm wide x 4 mm anti-skid ridges at r 200 and r 100 (assumed)' },
    parts: [rev('frame', 'cast-iron-black', ring(300, 420, 0, 25)), rev('cover', 'cast-iron-black', disc(330, 25, 50)),
        rev('rib_outer', 'cast-iron-black', ring(200, 230, 50, 54)), rev('rib_inner', 'cast-iron-black', ring(100, 130, 50, 54))]
});
spec('bus_shelter', {
    prompt: 'Bus stop shelter: 3000 mm wide x 1500 mm deep, four 60 mm aluminium posts to a 2350 mm eave, 3200 x 1800 x 80 mm roof, glazed back and right side panels, 1400 x 360 mm timber bench seat at 450 mm.',
    sources: ['https://en.wikipedia.org/wiki/Bus_stop', 'https://www.fpl.fs.usda.gov/documnts/fplgtr/fpl_gtr190.pdf'],
    dimensions: { footprint: '3000 x 1500 mm (assumed: single-bay catalogue shelter, source 1)', eave: '2350 mm posts + 80 mm roof (assumed)', glass: '10 mm toughened panels, 2000 mm tall from 150 mm (assumed)', bench: '1400 x 360 x 40 mm oak seat at 450 mm (ADA 17-19 in seat band; oak per source 2)' },
    parts: [box('post_fl', 'effective-shelter-frame', [-1500, -800, 0], [60, 60, 2350]), box('post_fr', 'effective-shelter-frame', [1440, -800, 0], [60, 60, 2350]),
        box('post_rl', 'effective-shelter-frame', [-1500, 740, 0], [60, 60, 2350]), box('post_rr', 'effective-shelter-frame', [1440, 740, 0], [60, 60, 2350]),
        box('roof', 'effective-shelter-frame', [-1600, -900, 2350], [3200, 1800, 80]),
        box('glass_back', 'glass-tinted', [-1440, 765, 150], [2880, 10, 2000]),
        box('glass_side', 'glass-tinted', [1465, -740, 150], [10, 1480, 2000]),
        box('bench_seat', 'oak', [-700, 405, 450], [1400, 360, 40]),
        box('bench_leg_l', 'powder-black-steel', [-650, 450, 0], [50, 260, 450]), box('bench_leg_r', 'powder-black-steel', [600, 450, 0], [50, 260, 450])]
});

function addMaterial(key) {
    const f = path.join(ROOT, 'tools/cad/materials.json');
    let t = fs.readFileSync(f, 'utf8');
    if (t.indexOf('"' + key + '"') >= 0) return;
    const m = MATS[key], pbr = m.pbr;
    const blk = '  "' + key + '": {' + EOL + '    "densityKgM3": ' + m.densityKgM3 + ',' + EOL + '    "pbr": { "baseColorFactor": [' + pbr.baseColorFactor.join(', ') + '], "metallicFactor": ' + pbr.metallicFactor + ', "roughnessFactor": ' + pbr.roughnessFactor + ' },' + EOL + '    "source": ' + JSON.stringify(m.source) + EOL + '  }';
    const i = t.lastIndexOf('}'); const head = t.slice(0, i).replace(/\s+$/, '');
    fs.writeFileSync(f, head + ',' + EOL + blk + EOL + '}' + EOL);
}
function write(name) {
    const s = SPECS[name]; if (!s) throw new Error('no spec ' + name);
    const ops = [], parts = [];
    s.parts.forEach((p, i) => { const as = '$p' + (i + 1); ops.push(Object.assign({}, p.op, { as })); parts.push({ of: as + '.handle', material: p.mat, nodeName: p.name }); if (MATS[p.mat]) addMaterial(p.mat); });
    const rc = { name, prompt: s.prompt, kind: 'prop' };
    if (s.budget) rc.budget = s.budget;
    Object.assign(rc, { sources: s.sources, dimensions: s.dimensions, units: 'mm', ops, parts, export: s.export || EXPORT, joints: s.joints || [] });
    fs.writeFileSync(path.join(ROOT, 'tools/cad/recipes', name + '.json'), JSON.stringify(rc, null, 2).replace(/\n/g, EOL) + EOL);
    console.log('wrote ' + name + ' (' + ops.length + ' ops)');
}
(process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SPECS)).forEach(write);
