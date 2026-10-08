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
const cyl = (name, mat, r, h, origin, rotate) => ({ name, mat, op: { tool: 'cad_cylinder', args: Object.assign({ r, h, origin }, rotate ? { rotate } : {}) } });
const rev = (name, mat, profile) => ({ name, mat, op: { tool: 'cad_revolve_profile', args: { profile } } });
const ext = (name, mat, outer, depth, plane) => ({ name, mat, op: { tool: 'cad_extrude_profile', args: { profile: { outer }, depth, plane } } });
// plane facing -Y (XZ plane, normal = x cross y = -Y): origin is the +Y face of the plate, extrusion grows toward -Y
const XZ = (y) => ({ origin: [0, y, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] });
const octagon = (cx, cz, flats) => { const r = flats / 2 / Math.cos(Math.PI / 8); const p = []; for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; p.push([+(cx + r * Math.cos(a)).toFixed(9), +(cz + r * Math.sin(a)).toFixed(9)]); } return p; };
const ring = (ri, ro, z0, z1) => [[ri, z0], [ro, z0], [ro, z1], [ri, z1]];
const disc = (r, z0, z1) => [[0, z0], [r, z0], [r, z1], [0, z1]];

const MATS = {
    'effective-shelter-frame': { densityKgM3: 650, pbr: { baseColorFactor: [0.7, 0.72, 0.74, 1], metallicFactor: 0.9, roughnessFactor: 0.45 }, source: 'LLF-103: extruded-aluminium posts and a sheet roof on purlins modelled as solid boxes; ~6 kg per 60 mm post and ~150 kg roof (assumed catalogue norms) over the modelled volume' },
    'sign-red-alu': { densityKgM3: 2700, pbr: { baseColorFactor: [0.78, 0.05, 0.05, 1], metallicFactor: 0.1, roughnessFactor: 0.4 }, source: 'LLF-103: 3003 aluminium sign blank 2.70 g/cc (ASM), red retroreflective sheeting finish' },
    'effective-buoy-red': { densityKgM3: 400, pbr: { baseColorFactor: [0.75, 0.08, 0.06, 1], metallicFactor: 0.1, roughnessFactor: 0.45 }, source: 'LLF-103: foam-filled rotomoulded polyethylene navigation buoy modelled as a solid hull; ~250 kg for a 0.9 m dia x 1.3 m body (assumed catalogue figure) over the modelled volume' },
    'effective-buoy-white': { densityKgM3: 400, pbr: { baseColorFactor: [0.92, 0.92, 0.9, 1], metallicFactor: 0.1, roughnessFactor: 0.45 }, source: 'LLF-103: same effective density as effective-buoy-red; white lower band' },
    'effective-gfrp-hull': { densityKgM3: 150, pbr: { baseColorFactor: [0.93, 0.93, 0.9, 1], metallicFactor: 0.05, roughnessFactor: 0.3 }, source: 'LLF-103: glass-fibre sailboat hull and deck skin modelled as a solid loft; ~450 kg hull + deck for a 6.7 m day boat (assumed from class weights, en.wikipedia.org/wiki/Catalina_22) over the modelled hull volume' },
    'effective-alu-spar': { densityKgM3: 300, pbr: { baseColorFactor: [0.78, 0.79, 0.8, 1], metallicFactor: 1, roughnessFactor: 0.4 }, source: 'LLF-103: hollow anodised aluminium mast/boom extrusion (6061, ~11% wall fill of 2.7 g/cc) modelled solid' },
    'sail-dacron': { densityKgM3: 140, pbr: { baseColorFactor: [0.95, 0.94, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.85 }, source: 'LLF-103: Dacron sailcloth (~1.4 g/cc woven, ~200 g/m2) modelled as a 10 mm slab: effective 140 kg/m3 gives ~10 kg for a 7 m2 main (assumed)' },
    'cactus-flesh': { densityKgM3: 950, pbr: { baseColorFactor: [0.2, 0.42, 0.22, 1], metallicFactor: 0, roughnessFactor: 0.8 }, source: 'LLF-103: saguaro stem tissue is mostly water (~75-90%, nps.gov saguaro page), so ~0.95 g/cc effective' },
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

// ---------------- COASTAL CITY ----------------
spec('cleat', {
    prompt: 'Dock horn cleat: 305 mm (12 in) stainless horn cleat on a 340 x 76 x 10 mm galvanised base plate, 82 mm overall height.',
    sources: ['https://en.wikipedia.org/wiki/Cleat_(nautical)', 'https://en.wikipedia.org/wiki/Mooring_(watercraft)'],
    dimensions: { 'horn cleat': '12 in (305 mm) cleat for 1/2-5/8 in line, a standard dock size (source 1)', 'base plate': '340 x 76 x 10 mm (assumed: bolt-down plate for a 12 in cleat)', height: '72 mm horn profile over a 10 mm plate (assumed)' },
    parts: [box('base_plate', 'steel-zinc-8.8', [-170, -38, 0], [340, 76, 10]),
        ext('cleat', 'ss-304', [[-50, 10], [50, 10], [50, 28], [95, 36], [150, 52], [152, 66], [140, 72], [90, 62], [40, 52], [0, 50], [-40, 52], [-90, 62], [-140, 72], [-152, 66], [-150, 52], [-95, 36], [-50, 28]], 38, XZ(19))]
});
spec('buoy', {
    prompt: 'Lateral can buoy: 900 mm dia x 1300 mm hull (500 mm white lower band, red upper), 1100 mm mast and a 500 mm dia x 500 mm conical topmark, 2900 mm overall; floats with the lower 600 mm submerged.',
    sources: ['https://en.wikipedia.org/wiki/Buoy', 'https://en.wikipedia.org/wiki/IALA_Maritime_Buoyage_System'],
    dimensions: { hull: '900 mm dia x 1300 mm (assumed: small harbour navigation buoy, source 1)', colours: 'red lateral mark with a white band (IALA convention, source 2)', mast: '80 mm dia x 1100 mm (assumed)', topmark: 'cone 500 mm dia x 500 mm (assumed)', waterline: '600 mm below the keel-up datum (assumed)' },
    parts: [rev('hull_low', 'effective-buoy-white', [[0, 0], [380, 0], [450, 200], [450, 500], [0, 500]]),
        rev('hull_up', 'effective-buoy-red', [[0, 500], [450, 500], [450, 1000], [300, 1300], [0, 1300]]),
        rev('mast', 'safety-yellow', disc(40, 1300, 2400)), rev('topmark', 'effective-buoy-red', [[0, 2400], [250, 2400], [0, 2900]])]
});
{
    const pp = [], caps = [];
    [-7200, -3600, 0, 3600, 7200].forEach((x, i) => {
        [-1000, 1000].forEach((y, k) => pp.push(cyl('piling_' + i + (k ? 'b' : 'a'), 'creosoted-timber', 200, 7000, [x, y, 0])));
        caps.push(box('cap_' + i, 'creosoted-timber', [x - 250, -1400, 7000], [500, 2800, 300]));
    });
    spec('pier_pilings', {
        prompt: 'Timber pier section: 16 m x 2.8 m deck on five pile bents, ten 400 mm dia creosoted piles 7 m long at 3.6 m centres, 500 x 300 mm cap beams, 120 mm plank deck.',
        sources: ['https://en.wikipedia.org/wiki/Pier', 'https://www.fpl.fs.usda.gov/documnts/fplgtr/fpl_gtr190.pdf'],
        dimensions: { piles: '400 mm dia x 7000 mm round timber piles, 2 per bent 2.0 m apart, bents at 3.6 m (assumed: light-duty timber pier practice, source 1)', 'cap beams': '500 x 2800 x 300 mm (assumed)', deck: '16000 x 2800 x 120 mm planking (assumed)', density: 'creosoted pine/hardwood ~0.8 g/cc (USDA Wood Handbook, source 2)' },
        budget: { lod0Tris: 16000, why: 'ten round 400 mm piles plus five cap beams and a deck: the piles alone are ~1.4k tris each at 0.5 mm chord tolerance' },
        parts: pp.concat(caps, [box('deck', 'pine', [-8000, -1400, 7300], [16000, 2800, 120])])
    });
}
// 6.7 m (22 ft) catboat day-sailer: plan-outline loft hull (stations are horizontal sections), fin keel, deck house, mast, boom, main
const hullSec = (Ls, Bs) => { const L = 3350 * Ls, B = 1150 * Bs, f = (a, b) => [+(L * a).toFixed(1), +(B * b).toFixed(1)]; const R = [f(1, 0), f(0.7, 0.55), f(0.3, 0.95), f(-0.2, 1), f(-0.7, 0.9), f(-1, 0.7)]; const Lf = R.slice(1, -1).reverse().map(p => [p[0], -p[1]]); return R.concat([[R[5][0], -R[5][1]]], Lf); };
spec('sailboat', {
    prompt: 'Catboat day-sailer: 6.7 m (22 ft) overall, 2.3 m beam, 1.25 m draft to the waterline datum, lofted glass-fibre hull with 650 mm freeboard, fin keel, deck house, 5.6 m aluminium mast, 2.9 m boom and a 7 m2 mainsail.',
    sources: ['https://en.wikipedia.org/wiki/Catalina_22', 'https://en.wikipedia.org/wiki/Catboat', 'https://en.wikipedia.org/wiki/Mast_(sailing)'],
    dimensions: { LOA: '6.7 m = 22 ft (source 1 class length)', beam: '2.3 m (assumed: Catalina 22 is about 7.5 ft = 2.3 m, source 1)', 'hull sections': 'four plan outlines at 0.9 / 1.2 / 1.55 / 1.9 m above the keel base, cubic loft (assumed hull form)', rig: 'cat rig, mast forward at x +2000 mm (source 2 catboat layout), 5.6 m spar (assumed)', boom: '2.95 m long (assumed)', mainsail: 'triangle 2.9 m foot x 4.95 m luff = 7.2 m2 (assumed)', keel: '700 x 100 x 900 mm cast-iron fin (assumed)' },
    kind: 'hero',
    parts: [
        box('keel', 'cast-iron-black', [-350, -50, 0], [700, 100, 900]),
        { name: 'hull', mat: 'effective-gfrp-hull', op: { tool: 'cad_loft_profiles', args: { profiles: [hullSec(0.45, 0.17), hullSec(0.75, 0.62), hullSec(0.92, 0.9), hullSec(1, 1)], zs: [900, 1200, 1550, 1900] } } },
        box('cabin', 'effective-gfrp-hull', [-300, -400, 1900], [1200, 800, 300]),
        box('mast', 'effective-alu-spar', [1945, -40, 1900], [110, 80, 5600]),
        box('boom', 'effective-alu-spar', [-1000, -35, 2850], [2945, 70, 100]),
        ext('mainsail', 'sail-dacron', [[1945, 2950], [1945, 7400], [-1000, 2950]], 10, XZ(5))
    ]
});

// ---------------- DESERT / WILD WEST ----------------
const poly = (n, apothem, cx, cz) => { const R = apothem / Math.cos(Math.PI / n), p = []; for (let k = 0; k < n; k++) { const a = Math.PI / n + k * 2 * Math.PI / n; p.push([+(cx + R * Math.cos(a)).toFixed(9), +(cz + R * Math.sin(a)).toFixed(9)]); } return p; };
const extH = (name, mat, outer, holes, depth, plane) => ({ name, mat, op: { tool: 'cad_extrude_profile', args: { profile: { outer, holes }, depth, plane } } });
spec('hitching_post', {
    prompt: 'Hitching rail: two 150 x 150 mm oak posts 1350 mm tall at 2000 mm centres with two 100 x 100 mm rails fixed to the street face at 1000 mm and 600 mm, 2150 mm long.',
    sources: ['https://en.wikipedia.org/wiki/Hitch', 'https://www.fpl.fs.usda.gov/documnts/fplgtr/fpl_gtr190.pdf'],
    dimensions: { posts: '150 x 150 x 1350 mm hardwood (assumed: frontier hitching rail, rail at saddle-horn height ~1.0 m)', rails: '100 x 100 x 2150 mm at z 1000 and 600 (assumed)', timber: 'oak 0.75 g/cc (USDA Wood Handbook, source 2)' },
    parts: [box('post_l', 'oak', [-1075, -75, 0], [150, 150, 1350]), box('post_r', 'oak', [925, -75, 0], [150, 150, 1350]),
        box('rail_top', 'oak', [-1075, -175, 1000], [2150, 100, 100]), box('rail_low', 'oak', [-1075, -175, 600], [2150, 100, 100])]
});
{
    const cz = 610, parts = [];
    parts.push(extH('hub', 'oak', poly(12, 120, 0, cz), [{ circle: { cx: 0, cy: cz, r: 35 } }], 250, XZ(125)));
    for (let k = 0; k < 12; k++) {
        const th = k * Math.PI / 6, u = [Math.cos(th), Math.sin(th)], nn = [-Math.sin(th), Math.cos(th)], r0 = 120, r1 = 536, w = 22.5;
        const pt = (r, s) => [+(r * u[0] + s * w * nn[0]).toFixed(9), +(cz + r * u[1] + s * w * nn[1]).toFixed(9)];
        parts.push(ext('spoke_' + k, 'oak', [pt(r0, -1), pt(r1, -1), pt(r1, 1), pt(r0, 1)], 45, XZ(22.5)));
    }
    parts.push(extH('felloe', 'oak', poly(24, 598, 0, cz), [poly(24, 536, 0, cz).reverse()], 65, XZ(32.5)));
    parts.push(extH('tire', 'mild-steel', poly(24, 610, 0, cz), [poly(24, 598, 0, cz).reverse()], 70, XZ(35)));
    spec('wagon_wheel', {
        prompt: 'Farm-wagon wheel: 1220 mm (48 in) overall, 12 oak spokes of 45 x 45 mm into a 240 mm hub, 62 x 65 mm oak felloe ring and a 12 x 70 mm iron tire, standing on its rim.',
        sources: ['https://en.wikipedia.org/wiki/Wagon', 'https://en.wikipedia.org/wiki/Wheelwright', 'https://www.fpl.fs.usda.gov/documnts/fplgtr/fpl_gtr190.pdf'],
        dimensions: { diameter: '48 in = 1220 mm rear wheel (assumed: farm and freight wagon rear wheels ran 4 to 5 ft, source 1)', hub: '240 mm across flats x 250 mm long with a 70 mm axle bore (assumed)', spokes: '12 x 45 x 45 mm radial (assumed: 12-14 spokes typical, source 2)', felloe: '24-sided ring 62 mm radial x 65 mm wide (assumed)', tire: '12 mm x 70 mm wrought iron band (assumed)', timber: 'oak per USDA Wood Handbook (source 3)' },
        parts
    });
}
{
    // saguaro: ribbed 16-pleat prisms so every joint is a planar contact (no curved booleans): trunk, crown loft, two elbowed arms
    const gon = (a, cx, cy) => poly(16, a, cx, cy), sec = (a, cx, cy) => gon(a, cx, cy);
    const crown = (name, a, cx, cy, z0) => ({ name, mat: 'cactus-flesh', op: { tool: 'cad_loft_profiles', args: { profiles: [[1, 0], [0.93, 60], [0.7, 130], [0.35, 190]].map(s => gon(a * s[0], cx, cy)), zs: [[1, 0], [0.93, 60], [0.7, 130], [0.35, 190]].map(s => z0 + (a < 200 ? s[1] / 2 : s[1])) } } });
    const YZ_R = (x) => ({ origin: [x, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] }), ZY_L = (x) => ({ origin: [x, 0, 0], xAxis: [0, 0, 1], yAxis: [0, 1, 0] });
    spec('cactus', {
        prompt: 'Saguaro cactus: 16-pleat trunk 600 mm across flats and 4.6 m tall with a domed crown, a right arm elbowing out 1050 mm at 2300 mm and rising to 3.6 m, a shorter left arm elbowing out at 3000 mm to 3.96 m, arms 300 mm across flats; 4.8 m overall.',
        sources: ['https://en.wikipedia.org/wiki/Saguaro', 'https://www.nps.gov/sagu/learn/nature/saguaro-cactus.htm'],
        dimensions: { height: '4.8 m (source 1: saguaros typically reach 4-12 m, arms start at ~2-3 m)', trunk: '600 mm across flats (source 1: trunk diameter up to ~0.75 m), 16 pleats (assumed: real stems have 12-30 pleats)', arms: '300 mm across flats, elbow-then-vertical (source 1), lengths assumed', density: 'water-rich succulent flesh ~0.95 g/cc (assumed: saguaro is ~75-90% water, source 2)' },
        budget: { lod0Tris: 9000, why: 'three cubic-loft dome crowns tessellate to ~2.6k tris each regardless of chord tolerance (LOD ladder is flat); the prisms are 64 tris' },
        export: Object.assign({}, EXPORT, { lods: [{ tolerance: 8 }, { tolerance: 30 }, { tolerance: 120 }] }),
        parts: [
            ext('trunk', 'cactus-flesh', gon(300, 0, 0), 4600, { origin: [0, 0, 0] }),
            crown('crown', 300, 0, 0, 4600),
            ext('arm_r_h', 'cactus-flesh', gon(140, 0, 2300), 750, YZ_R(300)),
            ext('arm_r_v', 'cactus-flesh', gon(150, 900, 0), 1160, { origin: [0, 0, 2440] }),
            crown('arm_r_top', 150, 900, 0, 3600),
            ext('arm_l_h', 'cactus-flesh', gon(140, 3000, 0), 750, ZY_L(-300)),
            ext('arm_l_v', 'cactus-flesh', gon(150, -900, 0), 820, { origin: [0, 0, 3140] }),
            crown('arm_l_top', 150, -900, 0, 3960)
        ]
    });
}
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
    s.parts.forEach((p, i) => { if (p.ops) { p.ops.forEach(o => ops.push(o)); parts.push({ of: p.of, material: p.mat, nodeName: p.name }); if (MATS[p.mat]) addMaterial(p.mat); return; } const as = '$p' + (i + 1); ops.push(Object.assign({}, p.op, { as })); parts.push({ of: as + '.handle', material: p.mat, nodeName: p.name }); if (MATS[p.mat]) addMaterial(p.mat); });
    const rc = { name, prompt: s.prompt, kind: s.kind || 'prop' };
    if (s.budget) rc.budget = s.budget;
    Object.assign(rc, { sources: s.sources, dimensions: s.dimensions, units: 'mm', ops, parts, export: s.export || EXPORT, joints: s.joints || [] });
    fs.writeFileSync(path.join(ROOT, 'tools/cad/recipes', name + '.json'), JSON.stringify(rc, null, 2).replace(/\n/g, EOL) + EOL);
    console.log('wrote ' + name + ' (' + ops.length + ' ops)');
}
(process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SPECS)).forEach(write);
