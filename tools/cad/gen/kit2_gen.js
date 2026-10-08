#!/usr/bin/env node
// tools/cad/gen/kit2_gen.js (LLF-103 Fidelity-Kit 2): writes tools/cad/recipes/<name>.json for the sandbox-scene
// kit assets from compact specs, and writes any new stock as tools/cad/materials.d/<key>.json.
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
    'sign-white-alu': { densityKgM3: 2700, pbr: { baseColorFactor: [0.93, 0.93, 0.92, 1], metallicFactor: 0.1, roughnessFactor: 0.4 }, source: 'LLF-103: aluminium sign blank 2.70 g/cc, white sheeting' },
    'effective-habitat-hull': { densityKgM3: 150, pbr: { baseColorFactor: [0.9, 0.9, 0.88, 1], metallicFactor: 0.3, roughnessFactor: 0.45 }, source: 'LLF-103: pressurised aluminium module shell modelled as a solid prism; ~14.5 t for a Destiny-class lab (en.wikipedia.org/wiki/Destiny_(ISS_module)) over the ~90 m3 modelled envelope' },
    'solar-cell-blue': { densityKgM3: 400, pbr: { baseColorFactor: [0.05, 0.1, 0.35, 1], metallicFactor: 0.6, roughnessFactor: 0.25 }, source: 'LLF-103: silicon cell blanket on a flexible substrate (~2 kg/m2, assumed) as a 10 mm sheet' },
    'effective-solar-frame': { densityKgM3: 62, pbr: { baseColorFactor: [0.7, 0.7, 0.72, 1], metallicFactor: 0.8, roughnessFactor: 0.5 }, source: 'LLF-103: aluminium honeycomb sandwich panel (~5 kg/m2 over 80 mm, assumed catalogue figure) modelled solid' },
    'effective-stair-steel': { densityKgM3: 150, pbr: { baseColorFactor: [0.45, 0.46, 0.48, 1], metallicFactor: 0.9, roughnessFactor: 0.55 }, source: 'LLF-103: open-riser steel stair stringers and grating (~300 kg for a 12 m flight, assumed) modelled as a 180 mm sawtooth slab' },
    'effective-plank-ramp': { densityKgM3: 250, pbr: { baseColorFactor: [0.45, 0.32, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.9 }, source: 'LLF-103: plank-over-framing approach ramp modelled as a solid wedge; ~250 kg/m3 effective (pine decking 0.5 g/cc on open framing, assumed)' }
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
    lowProfile: true,
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
    lowProfile: true,
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
// ---------------- SPACE ----------------
const sq = (cx, cy, s) => [[cx + s, cy + s], [cx - s, cy + s], [cx - s, cy - s], [cx + s, cy - s]];
const YZp = (x) => ({ origin: [x, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] });
spec('habitat_module', {
    prompt: 'Pressurised habitat module lying on its support rings: 4.2 m across flats x 6.4 m 24-sided hull, three 300 mm support rings, stepped docking ends and 1.2 m hatches, 8.1 m overall, axis at 2.25 m.',
    sources: ['https://en.wikipedia.org/wiki/Destiny_(ISS_module)', 'https://en.wikipedia.org/wiki/Space_habitat'],
    dimensions: { hull: '4200 mm across flats x 6400 mm (Destiny lab is 4.3 m dia x 8.5 m, source 1; shortened for the sandbox)', rings: '150 mm deep x 300 mm wide external support rings, bottom flush with the ground (assumed)', 'docking ends': 'two 300 mm tiers (3.6 m, 2.4 m across flats) then a 1.2 m hatch collar 250 mm long (assumed, source 2)', mass: 'effective density 150 kg/m3: 14.5 t Destiny class mass (source 1) over the ~90 m3 modelled solid envelope' },
    parts: [extH('hull', 'effective-habitat-hull', poly(24, 2100, 0, 2250), [], 6400, YZp(-3200)),
        extH('ring_0', 'mild-steel', poly(24, 2250, 0, 2250), [poly(24, 2100, 0, 2250).reverse()], 300, YZp(-2350)),
        extH('ring_1', 'mild-steel', poly(24, 2250, 0, 2250), [poly(24, 2100, 0, 2250).reverse()], 300, YZp(-150)),
        extH('ring_2', 'mild-steel', poly(24, 2250, 0, 2250), [poly(24, 2100, 0, 2250).reverse()], 300, YZp(2050)),
        extH('tier1_e', 'effective-habitat-hull', poly(24, 1800, 0, 2250), [], 300, YZp(3200)),
        extH('tier2_e', 'effective-habitat-hull', poly(24, 1200, 0, 2250), [], 300, YZp(3500)),
        extH('hatch_e', 'ss-304', poly(24, 600, 0, 2250), [], 250, YZp(3800)),
        extH('tier1_w', 'effective-habitat-hull', poly(24, 1800, 2250, 0), [], 300, { origin: [-3200, 0, 0], xAxis: [0, 0, 1], yAxis: [0, 1, 0] }),
        extH('tier2_w', 'effective-habitat-hull', poly(24, 1200, 2250, 0), [], 300, { origin: [-3500, 0, 0], xAxis: [0, 0, 1], yAxis: [0, 1, 0] }),
        extH('hatch_w', 'ss-304', poly(24, 600, 2250, 0), [], 250, { origin: [-3800, 0, 0], xAxis: [0, 0, 1], yAxis: [0, 1, 0] })]
});
{
    const parts = [];
    [-4800, -1200, 1200, 4800].forEach((x, i) => { parts.push(box('foot_' + i, 'mild-steel', [x - 200, -200, 0], [400, 400, 60])); parts.push(box('post_' + i, 'mild-steel', [x - 75, -75, 60], [150, 150, 940])); });
    parts.push(box('panel_a', 'effective-solar-frame', [-5900, -40, 1000], [5800, 80, 2500]), box('panel_b', 'effective-solar-frame', [100, -40, 1000], [5800, 80, 2500]),
        box('cells_a', 'solar-cell-blue', [-5800, -50, 1100], [5600, 10, 2300]), box('cells_b', 'solar-cell-blue', [200, -50, 1100], [5600, 10, 2300]));
    spec('solar_array', {
        prompt: 'Vertical lunar solar array: two 5.8 x 2.5 m aluminium-honeycomb wing panels (8 mm cell sheet on the front) held 1.0 m off the regolith on four 150 mm posts and 400 mm foot plates, 12 m wide, 3.5 m tall.',
        sources: ['https://en.wikipedia.org/wiki/Solar_panels_on_spacecraft', 'https://en.wikipedia.org/wiki/Moon#Surface_conditions'],
        dimensions: { panels: '5.8 x 2.5 m x 80 mm each (assumed: ~14.5 m2 per wing, ISS wings are 11.6 x 35 m, source 1)', mounting: 'vertical wall array at 1.0 m (assumed: low sun elevation near the lunar poles favours vertical panels, source 2 surface conditions)', 'cell sheet': '5.6 x 2.3 m x 10 mm on the sun face (assumed)', posts: '150 x 150 mm, 940 mm clear (assumed)' },
        parts
    });
}
// ---------------- FOREST ----------------
// stair flight: 61 risers, sawtooth top on a 180 mm steel stringer slab, 900 mm wide, down the +X side
const stairPoly = () => { const N = 61, rise = 12120 / N, run = 138, x0 = 1950, p = [[x0, 11940], [x0, 12120]];
    for (let i = 0; i < N; i++) { const z = +(12120 - i * rise).toFixed(6), zn = +(12120 - (i + 1) * rise).toFixed(6); p.push([x0 + i * run, z], [x0 + (i + 1) * run, z]); if (i < N - 1) p.push([x0 + (i + 1) * run, zn]); }
    const xe = x0 + N * run, zl = +(12120 - N * rise + rise).toFixed(6); p.push([xe, 0]);
    const xb = x0 + (11940) * run / rise; p.push([+xb.toFixed(6), 0]); return p.filter((q, k) => k === 0 || q[0] !== p[k - 1][0] || q[1] !== p[k - 1][1]); };
spec('fire_tower', {
    prompt: 'Timber fire lookout tower: four 200 mm legs at 3 m centres rising 12 m to a 3.9 m deck, 200 mm girts at 4 m and 8 m, a 2.6 m square cab with four windows under a hip roof, handrails, and a 55 degree stair flight down the +X side; 15 m overall.',
    sources: ['https://en.wikipedia.org/wiki/Fire_lookout', 'https://en.wikipedia.org/wiki/Fire_lookout_tower', 'https://www.fpl.fs.usda.gov/documnts/fplgtr/fpl_gtr190.pdf'],
    dimensions: { height: 'cab floor at 12 m (source 1: US lookout towers ran 10-30 m; 40-100 ft timber and steel towers)', cab: '2600 x 2600 x 2200 mm with 2200 x 900 mm windows (assumed, ~7 ft cab per source 2)', deck: '3900 x 3900 x 120 mm catwalk deck (assumed)', stair: '61 risers of 199 mm, 138 mm treads: a 55.3 degree flight, 900 mm wide, steel grating modelled as a slab (assumed)', timber: 'creosoted timber 0.8 g/cc, pine cab (USDA Wood Handbook, source 3)' },
    parts: [].concat(
        [[-1500, -1500], [1500, -1500], [-1500, 1500], [1500, 1500]].map((p, i) => box('leg_' + i, 'creosoted-timber', [p[0] - 100, p[1] - 100, 0], [200, 200, 12000])),
        [4000, 8000].reduce((a, z) => a.concat([
            box('girt_x_n_' + z, 'creosoted-timber', [-1400, -1560, z], [2800, 120, 200]), box('girt_x_s_' + z, 'creosoted-timber', [-1400, 1440, z], [2800, 120, 200]),
            box('girt_y_w_' + z, 'creosoted-timber', [-1560, -1400, z + 250], [120, 2800, 200]), box('girt_y_e_' + z, 'creosoted-timber', [1440, -1400, z + 250], [120, 2800, 200])]), []),
        [box('deck', 'creosoted-timber', [-1950, -1950, 12000], [3900, 3900, 120]),
            box('cab', 'pine', [-1300, -1300, 12120], [2600, 2600, 2200]),
            box('win_n', 'glass-tinted', [-1100, -1320, 13020], [2200, 20, 900]), box('win_s', 'glass-tinted', [-1100, 1300, 13020], [2200, 20, 900]),
            box('win_w', 'glass-tinted', [-1320, -1100, 13020], [20, 2200, 900]), box('win_e', 'glass-tinted', [1300, -1100, 13020], [20, 2200, 900]),
            { name: 'roof', mat: 'roof-sheet-green', op: { tool: 'cad_loft_profiles', args: { profileA: sq(0, 0, 1600), profileB: sq(0, 0, 250), zA: 14320, zB: 14920 } } },
            box('post_0', 'creosoted-timber', [-1920, -1920, 12120], [60, 60, 1050]), box('post_1', 'creosoted-timber', [1860, -1920, 12120], [60, 60, 1050]),
            box('post_2', 'creosoted-timber', [-1920, 1860, 12120], [60, 60, 1050]), box('post_3', 'creosoted-timber', [1860, 1860, 12120], [60, 60, 1050]),
            box('rail_n', 'creosoted-timber', [-1860, -1920, 13090], [3720, 60, 80]), box('rail_s', 'creosoted-timber', [-1860, 1860, 13090], [3720, 60, 80]),
            ext('stair', 'effective-stair-steel', stairPoly(), 900, XZ(450))]
    )
});
// ---------------- FOREST bridge ----------------
{
    const parts = [];
    [-2700, 0, 2700].forEach((x, i) => {
        parts.push(box('cap_' + i, 'creosoted-timber', [x - 150, -1050, 500], [300, 2100, 150]));
        [-900, 900].forEach((y, j) => parts.push(box('bent_' + i + '_' + j, 'creosoted-timber', [x - 125, y - 125, 0], [250, 250, 500])));
    });
    [-900, 900].forEach((y, j) => parts.push(box('stringer_' + j, 'creosoted-timber', [-3000, y - 75, 650], [6000, 150, 250])));
    parts.push(box('deck', 'oak', [-3000, -1200, 900], [6000, 2400, 80]));
    [-2900, -1450, 0, 1450, 2900].forEach((x, i) => { parts.push(box('rpost_n_' + i, 'creosoted-timber', [x - 50, -1200, 980], [100, 80, 1000])); parts.push(box('rpost_s_' + i, 'creosoted-timber', [x - 50, 1120, 980], [100, 80, 1000])); });
    [1850, 1400].forEach((z, k) => { parts.push(box('rail_n_' + k, 'oak', [-2950, -1120, z], [5900, 80, 80])); parts.push(box('rail_s_' + k, 'oak', [-2950, 1040, z], [5900, 80, 80])); });
    parts.push(ext('ramp_e', 'effective-plank-ramp', [[3000, 0], [5000, 0], [3000, 980]], 2400, XZ(1200)), ext('ramp_w', 'effective-plank-ramp', [[-3000, 0], [-3000, 980], [-5000, 0]], 2400, XZ(1200)));
    spec('wooden_bridge', {
        prompt: 'Timber footbridge: 6.0 m span x 2.4 m wide, 80 mm plank deck 0.98 m above the bed on two 150 x 250 mm stringers and three posted bents, 1.0 m handrails with a mid rail, and a 2.0 m plank approach ramp at each end; 10 m overall.',
        sources: ['https://en.wikipedia.org/wiki/Beam_bridge', 'https://en.wikipedia.org/wiki/Footbridge', 'https://www.fpl.fs.usda.gov/documnts/fplgtr/fpl_gtr190.pdf'],
        dimensions: { span: '6000 mm stringer span, 2400 mm wide (assumed; trail footbridges are 1.2-3 m wide, source 2)', stringers: '150 x 250 mm timber beams at 1.8 m centres (assumed catalogue timber size, source 1 beam bridge)', deck: '80 mm planks (assumed)', rails: 'top rail 1.0 m above the deck on 100 mm posts at 1450 mm centres plus a mid rail (assumed footbridge guard norm)', ramps: '2000 mm run x 980 mm rise plank approaches, about 26 degrees (assumed)', timber: 'creosoted timber and oak densities from the USDA Wood Handbook (source 3)' },
        parts
    });
}
// ---------------- rocks (ruled-loft boulders) ----------------
function rockSpec(name, seed, R, H, lean, prompt) {
    let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const N = 16, prof = [0.82, 1.0, 0.78, 0.38], hs = [0, 0.32, 0.68, 1.0];
    const nk = []; for (let k = 0; k < N; k++) nk.push(0.78 + 0.44 * rnd());
    const secs = hs.map((h, i) => { const p = []; for (let k = 0; k < N; k++) { const a = (k + 0.3 * (rnd() - 0.5)) * 2 * Math.PI / N; const r = R * prof[i] * nk[k] * (1 + 0.1 * (rnd() - 0.5)); p.push([+(r * Math.cos(a) + lean * h).toFixed(3), +(r * Math.sin(a)).toFixed(3)]); } return p; });
    const z = hs.map(h => +(h * H).toFixed(3)), parts = [];
    ['lo', 'mid', 'top'].forEach((nm, i) => parts.push({ name: 'rock_' + nm, mat: 'granite', op: { tool: 'cad_loft_profiles', args: { profileA: secs[i], profileB: secs[i + 1], zA: z[i], zB: z[i + 1] } } }));
    spec(name, {
        prompt, sources: ['https://en.wikipedia.org/wiki/Granite', 'https://en.wikipedia.org/wiki/Boulder'],
        dimensions: { size: (2 * R) + ' mm across x ' + H + ' mm tall faceted boulder, 16-sided sections lofted in three ruled stages (assumed: Boulder article lists >256 mm as boulder class, source 2)', rock: 'granite 2.7 g/cc (source 1)' },
        export: Object.assign({}, EXPORT, { lods: [{ tolerance: 3 }, { tolerance: 10 }, { tolerance: 30 }] }),
        parts
    });
}
rockSpec('rock_a', 11, 650, 800, 120, 'Faceted granite boulder, about 1.3 m across and 0.8 m tall, built as three ruled lofts through four irregular 16-sided sections.');
rockSpec('rock_b', 29, 1100, 1350, -200, 'Large faceted granite boulder, about 2.2 m across and 1.35 m tall, built as three ruled lofts through four irregular 16-sided sections.');
rockSpec('rock_c', 47, 380, 420, 40, 'Small faceted granite boulder, about 0.76 m across and 0.42 m tall, built as three ruled lofts through four irregular 16-sided sections.');
function addMaterial(key) {
    const lib = require('../materials_lib.js');
    if (fs.existsSync(path.join(lib.DIR, key + '.json'))) return;
    lib.writeMaterial(key, MATS[key]);
}
function write(name) {
    const s = SPECS[name]; if (!s) throw new Error('no spec ' + name);
    const ops = [], parts = [];
    s.parts.forEach((p, i) => { if (p.ops) { p.ops.forEach(o => ops.push(o)); parts.push({ of: p.of, material: p.mat, nodeName: p.name }); if (MATS[p.mat]) addMaterial(p.mat); return; } const as = '$p' + (i + 1); ops.push(Object.assign({}, p.op, { as })); parts.push({ of: as + '.handle', material: p.mat, nodeName: p.name }); if (MATS[p.mat]) addMaterial(p.mat); });
    const rc = { name, prompt: s.prompt, kind: s.kind || 'prop' };
    if (s.budget) rc.budget = s.budget;
    if (s.lowProfile) rc.lowProfile = true; // LLF-103: flat ground-level kit pieces (manhole 54 mm, cleat 72 mm) are under the 100 mm height floor of test_forgep1_assetlib
    Object.assign(rc, { sources: s.sources, dimensions: s.dimensions, units: 'mm', ops, parts, export: s.export || EXPORT, joints: s.joints || [] });
    fs.writeFileSync(path.join(ROOT, 'tools/cad/recipes', name + '.json'), JSON.stringify(rc, null, 2).replace(/\n/g, EOL) + EOL);
    console.log('wrote ' + name + ' (' + ops.length + ' ops)');
}
(process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SPECS)).forEach(write);
