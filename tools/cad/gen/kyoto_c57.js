#!/usr/bin/env node
// tools/cad/gen/kyoto_c57.js (LLF-83) — writes the C57 locomotive recipes from ONE geometry source:
// src/scenes/kyoto/valve_gear.js GEOM. The motion recipe's rods are posed by the same solver the game
// runs, so the CAD rest pose and the runtime linkage cannot drift apart.
//   node tools/cad/gen/kyoto_c57.js           # rewrites tools/cad/recipes/kyoto_c57_{motion,chassis}.json
// Kernel frame: mm, x forward, y = left side (+y), z up, rail top z = 0, origin mid-locomotive.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const VG = require(path.join(ROOT, 'src/scenes/kyoto/valve_gear.js'));
const G = VG.GEOM;
const r1 = v => Math.round(v * 10) / 10;
const HALF_PI = Math.PI / 2;

const SOURCES = [
    'https://en.wikipedia.org/wiki/JNR_Class_C57',
    'https://www.kurogane-rail.jp/kurogane-doc/sl/elococ57.html',
    'https://www.asterhobby.com/pdf/railwayhistory/1999_JNR_C57_Noble_Lady.pdf'
];
const EXPORT = {
    lods: [{ tolerance: 2 }, { tolerance: 8 }, { tolerance: 25 }],
    compression: { quantize: true, instance: true },
    creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false
};

// A side-plane plate occupying lateral layer [y0, y1] (left side; mirrored for the right).
// cad_extrude_profile on plane {xAxis:+X, yAxis:+Z} extrudes along x × z = -Y from the plane origin.
function plate(side, y0, y1, outer, holes) {
    const yo = side === 'L' ? y1 : -y0;
    const args = { profile: holes ? { outer, holes } : { outer }, depth: y1 - y0,
        plane: { origin: [0, yo, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] } };
    return args;
}
const slot = (a, b, w) => ({ slot: { x1: r1(a[0]), y1: r1(a[1]), x2: r1(b[0]), y2: r1(b[1]), width: w } });
const rect = (cx, cz, w, h) => ({ rect: { x: r1(cx), y: r1(cz), w: r1(w), h: r1(h) } });

// Wheel cross-section in (r, z=lateral) for revolve: rim + recessed web + hub, inner face at yIn.
function wheelProfile(R, yIn, yOut, side) {
    const rim = R - (R > 800 ? 115 : R * 0.14), hub = R > 800 ? 200 : R * 0.28;
    const w = yOut - yIn, webIn = yIn + w * 0.3, webOut = yIn + w * 0.7;
    let p = [[0, yIn], [hub, yIn], [hub, webIn], [rim, webIn], [rim, yIn], [R, yIn], [R, yOut], [rim, yOut], [rim, webOut], [hub, webOut], [hub, yOut], [0, yOut]];
    if (side === 'R') p = p.map(q => [q[0], -q[1]]).reverse();
    return p.map(q => [Math.round(q[0]), Math.round(q[1])]);
}
// revolve about Z, then rx = -pi/2 turns profile-z into +y; translate to the axle.
function wheelOps(prefix, side, R, axlesX, yIn, yOut) {
    const ops = [{ tool: 'cad_revolve_profile', args: { profile: wheelProfile(R, yIn, yOut, side) }, as: `$${prefix}${side}` }];
    axlesX.forEach((x, i) => {
        const last = i === axlesX.length - 1;
        ops.push({ tool: 'cad_transform', args: Object.assign({ of: `$${prefix}${side}.handle`, rotate: { rx: -HALF_PI }, translate: [x, 0, R] }, last ? {} : { copy: true }), as: `$${prefix}${side}${i}` });
    });
    return ops;
}

// ---------------------------------------------------------------- motion (wheels + rods)
const Y = { wheelIn: 470, wheelOut: 600, coupling: [600, 640], main: [640, 690], crosshead: [690, 790], spindle: [760, 790],
    lever: [790, 820], radius: [820, 850], link: [850, 890], ecc: [890, 920], retcrank: [690, 890] };
const STEAM_CHEST_REAR_X = 2900;

function motionRecipe() {
    const ops = [], parts = [];
    ops.push(...wheelOps('drv', 'L', G.driverR, G.coupledAxles, Y.wheelIn, Y.wheelOut));
    ops.push(...wheelOps('drv', 'R', G.driverR, G.coupledAxles, Y.wheelIn, Y.wheelOut));
    ['L', 'R'].forEach(side => G.coupledAxles.forEach((x, i) =>
        parts.push({ of: `$drv${side}${i}.handle`, material: 'steel-black-enamel', nodeName: `driver_${i + 1}_${side.toLowerCase()}` })));
    ['L', 'R'].forEach(side => {
        const s = VG.solve(G.theta0 + (side === 'R' ? G.quarter : 0), G.gear0);
        const dx = G.coupledAxles[0] - G.A[0], dx3 = G.coupledAxles[2] - G.A[0];
        const sfx = '_' + side.toLowerCase();
        const u = [(G.L0[0] - s.F[0]) / G.linkFoot, (G.L0[1] - s.F[1]) / G.linkFoot];
        const along = k => [G.L0[0] + u[0] * k, G.L0[1] + u[1] * k];
        const defs = [
            ['coupling_rod', Y.coupling, slot([s.P[0] + dx, s.P[1]], [s.P[0] + dx3, s.P[1]], 120), null, 'mild-steel'],
            ['main_rod', Y.main, slot(s.P, s.C, 140), null, 'mild-steel'],
            ['crosshead', Y.crosshead, rect(s.C[0], G.zc, 400, 300), null, 'mild-steel'],
            ['return_crank', Y.retcrank, slot(s.P, s.Q, 110), null, 'mild-steel'],
            ['eccentric_rod', Y.ecc, slot(s.Q, s.F, 80), null, 'mild-steel'],
            ['expansion_link', Y.link, slot(s.F, s.LT, 130), [slot(along(-260), along(260), 50)], 'mild-steel'],
            ['radius_rod', Y.radius, slot(s.Die, s.E, 70), null, 'mild-steel'],
            ['combination_lever', Y.lever, slot(s.D, s.E, 90), null, 'mild-steel'],
            ['valve_spindle', Y.spindle, rect((s.V[0] + STEAM_CHEST_REAR_X) / 2, s.V[1], STEAM_CHEST_REAR_X - s.V[0], 50), null, 'mild-steel']
        ];
        defs.forEach(([name, ly, outer, holes, mat]) => {
            const ref = `$${name}${sfx}`;
            ops.push({ tool: 'cad_extrude_profile', args: plate(side, ly[0], ly[1], outer, holes), as: ref });
            parts.push({ of: ref + '.handle', material: mat, nodeName: name + sfx });
        });
    });
    // cad_sketch_solve fixtures (filled by tools/cad/gen/kyoto_c57_fixtures.json when present)
    const fxPath = path.join(__dirname, 'kyoto_c57_fixtures.json');
    const fixtures = fs.existsSync(fxPath) ? JSON.parse(fs.readFileSync(fxPath, 'utf8')) : undefined;
    const rig = {
        frame: 'kernel mm: x forward, z up; node transforms live under nativecad-root (mm), rotate about kernel +Y',
        geom: G,
        layersMm: Y,
        driverAxlesX: G.coupledAxles, driverR: G.driverR,
        sides: { l: { phase: 0 }, r: { phase: G.quarter } }
    };
    return {
        name: 'kyoto_c57_motion',
        prompt: 'JNR Class C57 4-6-2 Pacific: the moving half of the locomotive — six 1750 mm coupled wheels, and per side the Walschaerts valve gear (coupling rod, main rod, crosshead, return crank, eccentric rod, slotted expansion link, radius rod, combination lever, valve spindle), posed by src/scenes/kyoto/valve_gear.js at the rest crank angle (left 0 rad, right +90 deg quartered). Every rod is a separate node so the game solves the linkage from wheel angle at runtime.',
        kind: 'hero',
        budget: { lod0Tris: 9000, why: 'six spoked-profile wheels at 2 mm chord plus 18 slotted rods; the motion set is viewed close up while the train runs' },
        sources: SOURCES,
        dimensions: {
            'driver diameter': '1750 mm (source 1, 2)',
            'gauge': '1067 mm (source 1); wheel tread centre at y = 535 mm',
            'piston stroke': '660 mm (source 2; source 1 lists 600) -> crank radius 330 mm',
            'cylinder': '500 mm bore (sources 1, 2); centreline at axle height 875 mm (assumed horizontal; the real C57 cylinders are near-horizontal)',
            'coupled wheelbase': '2 x 2000 mm (assumed: 1750 mm wheels + 250 mm clearance, typical JNR Pacific practice)',
            'main rod': '3000 mm centres (assumed from side-elevation proportions, source 3)',
            'valve gear': 'Walschaerts (source 1); link, radius rod, lever lengths assumed from side-elevation proportions (source 3): link foot 350, eccentric rod 1500, radius rod 1550, lever 900 (valve pin at 760) mm; return crank 150 mm at -90 deg',
            'layering': 'rods stacked outward from the wheel face (y 600) in face contact so strict export sees one connected assembly'
        },
        units: 'mm', ops, parts, export: EXPORT,
        joints: [
            ...['l', 'r'].flatMap(s => [1, 2, 3].map(i => ({ node: `driver_${i}_${s}`, type: 'revolute', axis: [0, 0, -1], min: -1e9, max: 1e9, note: 'wheel axle = kernel +Y = glTF -Z' })))
        ],
        rig, fixtures
    };
}

// ---------------------------------------------------------------- chassis (static body + carrying wheels)
function chassisRecipe() {
    const ops = [], parts = [];
    const P = (of, material, nodeName) => parts.push({ of: of + '.handle', material, nodeName });
    // carrying wheels: 2-axle leading bogie and trailing truck, 860 mm
    ops.push(...wheelOps('lead', 'L', 430, [4600, 2400], 470, 600));
    ops.push(...wheelOps('lead', 'R', 430, [4600, 2400], 470, 600));
    // trailing wheels share the leading-wheel 860 mm revolve: NativeCAD's strict assembly check flags a false
    // frame interpenetration for any wheel whose face contact with the frame block covers more of the disc
    // (seen at r = 500, 535, 540, 875; r = 430 passes) — reported with cad_report_bug.
    ops.push({ tool: 'cad_transform', args: { of: '$leadL1.handle', translate: [-7400, 0, 0], copy: true }, as: '$trailL0' });
    ops.push({ tool: 'cad_transform', args: { of: '$leadR1.handle', translate: [-7400, 0, 0], copy: true }, as: '$trailR0' });
    [['L', 'l'], ['R', 'r']].forEach(([S, s]) => {
        P(`$lead${S}0`, 'steel-black-enamel', `lead_1_${s}`); P(`$lead${S}1`, 'steel-black-enamel', `lead_2_${s}`);
        P(`$trail${S}0`, 'steel-black-enamel', `trail_${s}`);
    });
    // main frame block between the wheels (bar frame + cross-stretchers, solid-modelled)
    ops.push({ tool: 'cad_box', args: { origin: [-6000, -470, 600], dx: 11900, dy: 940, dz: 1000 }, as: '$frame' });
    P('$frame', 'effective-c57-body', 'frame');
    // boiler barrel + firebox wrapper: revolve about Z then turn onto +X at boiler centre height 2400 (source 2)
    ops.push({ tool: 'cad_revolve_profile', args: { profile: [[0, -3900], [800, -3900], [800, 5300], [0, 5300]] }, as: '$boilerRaw' });
    ops.push({ tool: 'cad_transform', args: { of: '$boilerRaw.handle', rotate: { ry: HALF_PI }, translate: [0, 0, 2400] }, as: '$boiler' });
    P('$boiler', 'effective-c57-body', 'boiler');
    ops.push({ tool: 'cad_cylinder', args: { r: 700, h: 100, origin: [5300, 0, 2400], rotate: { ry: HALF_PI, center: [5300, 0, 2400] } }, as: '$door' });
    P('$door', 'steel-black-enamel', 'smokebox_door');
    ops.push({ tool: 'cad_cylinder', args: { r: 250, h: 480, origin: [4500, 0, 3200] }, as: '$chimney' });
    P('$chimney', 'steel-black-enamel', 'chimney');
    ops.push({ tool: 'cad_box', args: { origin: [600, -330, 3200], dx: 2000, dy: 660, dz: 360 }, as: '$dome' });
    P('$dome', 'steel-black-enamel', 'sand_steam_dome');
    // cab (behind the rear driver, over the trailing truck) — roof height 3945 (sources 1, 2)
    ops.push({ tool: 'cad_box', args: { origin: [-6200, -1400, 1600], dx: 2300, dy: 2800, dz: 2345 }, as: '$cab' });
    P('$cab', 'effective-c57-body', 'cab');
    ops.push({ tool: 'cad_box', args: { origin: [5900, -1350, 800], dx: 300, dy: 2700, dz: 600 }, as: '$beam' });
    P('$beam', 'steel-red-oxide', 'buffer_beam');
    [['L', 'l', 1], ['R', 'r', -1]].forEach(([S, s, k]) => {
        const yy = (a, b) => (k > 0 ? a : -b);          // lateral min corner for a [a,b] band on this side
        ops.push({ tool: 'cad_box', args: { origin: [-3900, yy(600, 1300), 1800], dx: 8700, dy: 700, dz: 40 }, as: `$rb${S}` });
        P(`$rb${S}`, 'steel-black-enamel', `running_board_${s}`);
        ops.push({ tool: 'cad_box', args: { origin: [3300, yy(1260, 1300), 1840], dx: 1600, dy: 40, dz: 1200 }, as: `$defl${S}` });
        P(`$defl${S}`, 'steel-black-enamel', `smoke_deflector_${s}`);
        ops.push({ tool: 'cad_box', args: { origin: [2900, yy(470, 1000), 600], dx: 1200, dy: 530, dz: 550 }, as: `$cyl${S}` });
        P(`$cyl${S}`, 'effective-c57-body', `cylinder_${s}`);
        ops.push({ tool: 'cad_box', args: { origin: [2900, yy(560, 900), 1150], dx: 1200, dy: 340, dz: 300 }, as: `$chest${S}` });
        P(`$chest${S}`, 'effective-c57-body', `steam_chest_${s}`);
        ops.push({ tool: 'cad_box', args: { origin: [1400, yy(690, 790), 685], dx: 1500, dy: 100, dz: 40 }, as: `$gbl${S}` });
        P(`$gbl${S}`, 'mild-steel', `guide_bar_lower_${s}`);
        ops.push({ tool: 'cad_box', args: { origin: [1400, yy(690, 790), 1025], dx: 1500, dy: 100, dz: 40 }, as: `$gbu${S}` });
        P(`$gbu${S}`, 'mild-steel', `guide_bar_upper_${s}`);
        ops.push({ tool: 'cad_box', args: { origin: [G.L0[0] - 60, yy(920, 980), 1200], dx: 120, dy: 60, dz: 600 }, as: `$lb${S}` });
        P(`$lb${S}`, 'steel-black-enamel', `link_bracket_${s}`);
    });
    return {
        name: 'kyoto_c57_chassis',
        prompt: 'JNR Class C57 4-6-2 Pacific: the static half of the locomotive — frame, 800 mm-radius boiler at 2400 mm centre height, smokebox door, chimney, combined sand/steam dome, cab to 3945 mm, buffer beam, running boards, the C57\'s big smoke deflectors, box cylinders with steam chests, guide bars, expansion-link brackets, and the 860 mm leading-bogie and trailing-truck wheels. Pairs with kyoto_c57_motion at the same origin.',
        kind: 'hero',
        budget: { lod0Tris: 9000, why: 'carrying wheels plus boiler/smokebox revolves at 2 mm chord; hero locomotive' },
        sources: SOURCES,
        dimensions: {
            'height': '3945 mm over cab roof (sources 1, 2)',
            'engine length': '12960 mm (source 2): frame -6000..5900 plus buffer beam to 6200 and cab overhang to -6200',
            'boiler centre height': '2400 mm (source 2); barrel radius 800 mm (assumed: ~1600 mm barrel, JNR Pacific practice)',
            'leading wheels': '860 mm (assumed: JNR standard leading wheel), bogie wheelbase 2200 mm (assumed)',
            'trailing wheel': '860 mm (assumed; same casting as the leading wheels — see the strict-check note in tools/cad/gen/kyoto_c57.js)',
            'cylinders': '500 x 660 mm (source 2) in a 1200 x 530 x 550 mm lagged block (assumed envelope), centreline 875 mm',
            'smoke deflectors': '1600 x 1200 mm plates (assumed from photos, source 3)',
            'mass': 'effective-c57-body density = (67.5 t engine weight, source 1, minus the steel motion set) / modelled volume'
        },
        units: 'mm', ops, parts, export: EXPORT,
        joints: [
            ...['l', 'r'].flatMap(s => [`lead_1_${s}`, `lead_2_${s}`, `trail_${s}`].map(n => ({ node: n, type: 'revolute', axis: [0, 0, -1], min: -1e9, max: 1e9 })))
        ],
        rig: { leadAxles: [[4600, 430], [2400, 430]], trailAxles: [[-5000, 430]] }
    };
}

function write(rc) {
    if (rc.fixtures === undefined) delete rc.fixtures;
    const n = rc.ops.length + rc.parts.length;
    if (n > 64) throw new Error(`${rc.name}: ops+parts ${n} > 64`);
    const f = path.join(ROOT, 'tools/cad/recipes', rc.name + '.json');
    fs.writeFileSync(f, JSON.stringify(rc, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    console.log(`${rc.name}: ${rc.ops.length} ops + ${rc.parts.length} parts -> ${path.relative(ROOT, f)}`);
}
if (require.main === module) { write(motionRecipe()); write(chassisRecipe()); }
module.exports = { motionRecipe, chassisRecipe };
