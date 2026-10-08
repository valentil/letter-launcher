#!/usr/bin/env node
// LLF-102: generates the three FLIGHT SIM airfield recipes (control_tower, windsock, approach_lights).
//   node tools/cad/gen/airfield_gen.js      -> tools/cad/recipes/{control_tower,windsock,approach_lights}.json
// Run them with: node tools/cad/gen/multi_batch.js <WT> control_tower windsock approach_lights
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const EXPORT = { lods: [{ tolerance: 1 }, { tolerance: 6 }, { tolerance: 25 }], compression: { quantize: true, instance: true }, creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false };
const box = (id, dx, dy, dz, o) => ({ tool: 'cad_box', args: { dx, dy, dz, origin: o }, as: '$' + id });
const cyl = (id, r, h, o, rotate) => ({ tool: 'cad_cylinder', args: Object.assign({ r, h, origin: o }, rotate ? { rotate } : {}), as: '$' + id });
const fru = (id, r0, r1, h, o, rotate) => ({ tool: 'cad_frustum', args: Object.assign({ r0, r1, h, origin: o }, rotate ? { rotate } : {}), as: '$' + id });
const part = (id, material, nodeName) => ({ of: '$' + id + '.handle', material, nodeName: nodeName || id });
const RY = { ry: Math.PI / 2 };
const recipes = {};

recipes.control_tower = {
    name: 'control_tower',
    prompt: 'Small general-aviation airport traffic control tower: 3 m square masonry shaft 8 m high, 6.2 m square catwalk deck, 5 m square glazed cab 2.4 m high, 5.6 m square roof, rotating beacon and a comms mast. About 11.5 m to the beacon top.',
    kind: 'prop', budget: { lod0Tris: 3000, why: 'default prop budget' },
    sources: [
        'https://www.faa.gov/documentLibrary/media/Order/Order_6480.4C.pdf',
        'https://skybrary.aero/articles/aerodrome-control-tower'
    ],
    dimensions: {
        'shaft': '3000 x 3000 x 8000 mm (assumed: low-rise contract-tower class, 25-35 ft eye height for a small GA field, FAA siting order sources 1-2)',
        'cab': '5000 x 5000 x 2400 mm (assumed: cabs of 4.5-6 m across, floor-to-ceiling glazing, source 2)',
        'catwalk deck': '6200 x 6200 x 200 mm (assumed: 600 mm walkway all round the cab)',
        'roof': '5600 x 5600 x 300 mm (assumed: 300 mm eaves overhang)',
        'beacon': 'r 200 x 600 mm on the roof centre (rotating white/green light, assumed size)',
        'mast': 'r 30 x 2000 mm comms antenna (assumed)'
    },
    units: 'mm',
    ops: [
        box('shaft', 3000, 3000, 8000, [-1500, -1500, 0]),
        box('catwalk', 6200, 6200, 200, [-3100, -3100, 8000]),
        box('cab', 5000, 5000, 2400, [-2500, -2500, 8200]),
        box('roof', 5600, 5600, 300, [-2800, -2800, 10600]),
        cyl('beacon', 200, 600, [0, 0, 10900]),
        cyl('mast', 30, 2000, [2000, 0, 10900])
    ],
    parts: [
        part('shaft', 'effective-tower-white'), part('catwalk', 'effective-lattice-steel'),
        part('cab', 'effective-atct-cab-glazing'), part('roof', 'effective-tower-red'),
        part('beacon', 'signal-green'), part('mast', 'ss-304')
    ],
    export: EXPORT, joints: []
};

recipes.windsock = {
    name: 'windsock',
    prompt: 'FAA size 2 (12 ft x 36 in throat) airport windsock on a 4.9 m (16 ft) support with a swivel arm: the sock swings about the vertical pole to point downwind. Two bands: orange mouth half, white tail half.',
    kind: 'prop', budget: { lod0Tris: 3500, why: 'two tessellated frustums + tube at 1 mm tolerance (3100 tris); smooth cone silhouette matters for the sock' },
    sources: [
        'https://www.faa.gov/documentLibrary/media/Advisory_Circular/150_5345_27e.pdf',
        'https://skybrary.aero/articles/windsock'
    ],
    dimensions: {
        'sock length / throat': '3658 mm (12 ft) / 914 mm (36 in) diameter, source 1 (size 2)',
        'tail end diameter': '450 mm (assumed: taper lets the sock extend fully in a 15 kt wind, source 1)',
        'support height': '4900 mm (16 ft, the L-807 load-test height in source 1)',
        'pole': 'OD 120 mm (assumed)', 'base plate': '500 x 500 x 20 mm (assumed)',
        'swivel arm': '900 x 160 x 100 mm (assumed)', 'colour': 'orange support finish, orange/white fabric (source 1: fabric white/yellow/orange)'
    },
    units: 'mm',
    ops: [
        box('base_plate', 500, 500, 20, [-250, -250, 0]),
        cyl('pole', 60, 4880, [0, 0, 20]),
        box('swivel_arm', 900, 160, 100, [-100, -80, 4900]),
        fru('sock_orange', 457, 341, 1829, [800, 0, 4950], RY),
        fru('sock_white', 341, 225, 1829, [2629, 0, 4950], RY)
    ],
    parts: [
        part('base_plate', 'safety-yellow-steel'), part('pole', 'safety-yellow-steel'), part('swivel_arm', 'safety-yellow-steel'),
        part('sock_orange', 'effective-windsock-orange'), part('sock_white', 'effective-windsock-white')
    ],
    export: EXPORT,
    rig: { links: [{ node: 'J_base', pivotMm: [0, 0, 0], parts: ['base_plate', 'pole'] }, { node: 'J_swivel', pivotMm: [0, 0, 4900], parts: ['swivel_arm', 'sock_orange', 'sock_white'] }] },
    joints: [{ node: 'J_swivel', type: 'continuous', axis: [0, 1, 0], pivotMm: [0, 0, 4900] }]
};

const lampX = [-1200, -600, 0, 600, 1200];
recipes.approach_lights = {
    name: 'approach_lights',
    prompt: 'One approach-light station (MALSR/ALSF style): a 1.5 m frangible mast carrying a 3 m crossbar barrette with five white lamp heads. Stations are repeated along the extended centreline.',
    kind: 'prop', budget: { lod0Tris: 3000, why: 'default prop budget' },
    sources: [
        'https://www.faa.gov/documentLibrary/media/Advisory_Circular/150_5340_30g.pdf',
        'https://www.icao.int/safety/airnavigation/AIG/Pages/Annex-14.aspx',
        'https://skybrary.aero/articles/approach-lighting-systems'
    ],
    dimensions: {
        'station spacing in a real system': '100 ft (30.5 m) between centreline stations out to 2400 ft (MALSR) or 3000 ft (ALSF-2), source 1; the game places a compressed run',
        'mast height': '1500 mm (frangible, below the ICAO Annex 14 mounting limit of a few metres at the threshold end; assumed)',
        'crossbar': '3000 x 120 x 120 mm (assumed: ICAO crossbar/barrette 3-4 m wide)',
        'lamps': 'five heads, r 80 x 60 mm, 600 mm centres (assumed)'
    },
    units: 'mm',
    ops: [
        cyl('mast', 40, 1500, [0, 0, 0]),
        box('crossbar', 3000, 120, 120, [-1500, -60, 1500])
    ].concat(lampX.map((x, i) => cyl('lamp_' + (i + 1), 80, 60, [x, 0, 1620]))),
    parts: [part('mast', 'safety-yellow'), part('crossbar', 'safety-yellow')].concat(lampX.map((x, i) => part('lamp_' + (i + 1), 'sign-white'))),
    export: EXPORT, joints: []
};

Object.keys(recipes).forEach(n => {
    fs.writeFileSync(path.join(ROOT, 'tools/cad/recipes', n + '.json'), JSON.stringify(recipes[n], null, 2).replace(/\n/g, '\r\n') + '\r\n');
    console.log('wrote', n, recipes[n].ops.length, 'ops');
});
