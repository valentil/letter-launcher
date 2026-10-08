// LLF-81: generates tools/cad/recipes/light_aircraft.json (the NACA 2412 wing sections are
// computed, not typed). Run: node tools/cad/gen/light_aircraft_gen.js  -> rewrites the recipe.
// Kernel frame: mm, +Z up, nose toward -Y, span along X, wheels on z = 0.
const fs = require('fs');
const path = require('path');

const C = 1500;            // wing chord (constant-chord simplification of the class's 1.63/1.12 m taper)
const LE_Y = -1700;        // leading edge station
const Z_SEAT = 1950;       // cabin roof the wing sits on
const FLAT = -0.040;       // lower surface clamped to -4.0 %c (max NACA 2412 dip is -4.25 %c) -> flat seat
const CUT = 0.75;          // flap / aileron hinge at 75 % chord

function naca2412(x) {     // x in [0,1] -> {xu,yu,xl,yl}
    const m = 0.02, p = 0.4, t = 0.12;
    const yt = t / 0.2 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    const yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x);
    const dyc = x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) ** 2) * (p - x);
    const th = Math.atan(dyc);
    return { xu: x - yt * Math.sin(th), yu: yc + yt * Math.cos(th), xl: x + yt * Math.sin(th), yl: Math.max(FLAT, yc - yt * Math.cos(th)) };
}
const ZC = Z_SEAT - FLAT * C;   // chord-line height so the flat seat lands exactly on the roof
const r1 = v => Math.round(v * 10) / 10;
const toUV = (x, y) => [r1(LE_Y + x * C), r1(ZC + y * C)];
function section(x0, x1, n) {
    const xs = [];
    for (let i = 0; i <= n; i++) { const b = i / n * Math.PI; xs.push(x0 + (x1 - x0) * (1 - Math.cos(b)) / 2); }
    return xs;
}
// main wing: lower surface LE -> cut, cut face up, upper surface cut -> LE (CCW in (y,z))
function mainProfile() {
    const xs = section(0, CUT, 22);
    const lower = xs.map(x => { const a = naca2412(x); return toUV(a.xl, a.yl); });
    const upper = xs.slice(1).reverse().map(x => { const a = naca2412(x); return toUV(x === CUT ? CUT : a.xu, a.yu); });
    // force the cut face vertical at exactly CUT
    lower[lower.length - 1][0] = r1(LE_Y + CUT * C);
    upper.unshift(toUV(CUT, naca2412(CUT).yu));
    return dedupe(lower.concat(upper.slice(0, -1)));
}
function aftProfile() {
    const xs = section(CUT, 1, 8);
    const lower = xs.map(x => { const a = naca2412(x); return toUV(a.xl, a.yl); });
    lower[0][0] = r1(LE_Y + CUT * C);
    const upper = xs.slice(0).reverse().map(x => { const a = naca2412(x); return toUV(a.xu, a.yu); });
    upper[upper.length - 1][0] = r1(LE_Y + CUT * C);
    // trailing edge: merge the TE pair into one point (finite TE 0.25 %t is below export tolerance)
    const te = lower.pop(); upper[0] = [te[0], r1((te[1] + upper[0][1]) / 2)];
    return dedupe(lower.concat(upper));
}
function dedupe(p) { return p.filter((q, i) => i === 0 || q[0] !== p[i - 1][0] || q[1] !== p[i - 1][1]); }

const YZ = o => ({ origin: o, xAxis: [0, 1, 0], yAxis: [0, 0, 1] });
const HP = Math.PI / 2;
const mainP = mainProfile(), aftP = aftProfile();
const ops = [
    { tool: 'cad_extrude_profile', as: '$cabin', args: { depth: 1100, plane: YZ([-550, 0, 0]),
        outer: [[-3300, 900], [-3000, 700], [600, 700], [600, 1650], [-200, 1950], [-1700, 1950], [-2600, 1550], [-3300, 1450]] } },
    // tailcone = planform prism (tapers 1100 -> 240 mm wide) intersected with side-profile prism (belly rises 700 -> 1400)
    { tool: 'cad_extrude_profile', as: '$tcp', args: { depth: 950, plane: { origin: [0, 0, 700], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
        outer: [[-550, 600], [550, 600], [120, 4400], [-120, 4400]] } },
    { tool: 'cad_extrude_profile', as: '$tcs', args: { depth: 1200, plane: YZ([-600, 0, 0]),
        outer: [[600, 700], [4400, 1400], [4400, 1650], [600, 1650]] } },
    { tool: 'cad_boolean_intersect', as: '$tailcone', args: { of: '$tcp.handle', tool: '$tcs.handle' } },
    { tool: 'cad_extrude_profile', as: '$wing', args: { depth: 11000, plane: YZ([-5500, 0, 0]), outer: mainP } },
    { tool: 'cad_extrude_profile', as: '$flap_r', args: { depth: 2350, plane: YZ([550, 0, 0]), outer: aftP } },
    { tool: 'cad_extrude_profile', as: '$flap_l', args: { depth: 2350, plane: YZ([-2900, 0, 0]), outer: aftP } },
    { tool: 'cad_extrude_profile', as: '$aileron_r', args: { depth: 2600, plane: YZ([2900, 0, 0]), outer: aftP } },
    { tool: 'cad_extrude_profile', as: '$aileron_l', args: { depth: 2600, plane: YZ([-5500, 0, 0]), outer: aftP } },
    { tool: 'cad_extrude_profile', as: '$stab', args: { depth: 80, plane: { origin: [0, 0, 1650], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
        outer: [[-400, 3300], [400, 3300], [1730, 3600], [1730, 3950], [-1730, 3950], [-1730, 3600]] } },
    { tool: 'cad_box', as: '$elev_r', args: { dx: 1670, dy: 450, dz: 80, origin: [60, 3950, 1650] } },
    { tool: 'cad_box', as: '$elev_l', args: { dx: 1670, dy: 450, dz: 80, origin: [-1730, 3950, 1650] } },
    { tool: 'cad_extrude_profile', as: '$fin', args: { depth: 80, plane: YZ([-40, 0, 0]),
        outer: [[3300, 1730], [3950, 1730], [3950, 2730], [3650, 2730]] } },
    { tool: 'cad_box', as: '$rudder', args: { dx: 80, dy: 450, dz: 1000, origin: [-40, 3950, 1730] } },
    { tool: 'cad_box', as: '$prop', args: { dx: 1900, dy: 60, dz: 120, origin: [-950, -3360, 1115] } },
    { tool: 'cad_cone', as: '$spinner', args: { r: 180, h: 400, origin: [0, -3360, 1175], rotate: { rx: HP, center: [0, -3360, 1175] } } },
    { tool: 'cad_box', as: '$leg_r', args: { dx: 1025, dy: 150, dz: 320, origin: [300, -1000, 380] } },
    { tool: 'cad_box', as: '$leg_l', args: { dx: 1025, dy: 150, dz: 320, origin: [-1325, -1000, 380] } },
    { tool: 'cad_cylinder', as: '$wheel_r', args: { r: 190, h: 150, origin: [1175, -925, 190], rotate: { ry: HP, center: [1175, -925, 190] } } },
    { tool: 'cad_cylinder', as: '$wheel_l', args: { r: 190, h: 150, origin: [-1175, -925, 190], rotate: { ry: -HP, center: [-1175, -925, 190] } } },
    { tool: 'cad_box', as: '$leg_n', args: { dx: 80, dy: 100, dz: 380, origin: [-40, -2980, 320] } },
    { tool: 'cad_cylinder', as: '$wheel_n', args: { r: 160, h: 110, origin: [-55, -2930, 160], rotate: { ry: HP, center: [-55, -2930, 160] } } }
];
const AF = 'effective-light-aircraft-airframe', CS = 'effective-light-aircraft-controls';
// _l / _r are the PILOT's left and right. The nose points to kernel -Y, so the pilot's left is kernel +X.
const parts = [
    ['$cabin', AF, 'fuselage_cabin'], ['$tailcone', AF, 'fuselage_tailcone'], ['$wing', AF, 'wing'],
    ['$flap_r', CS, 'flap_l'], ['$flap_l', CS, 'flap_r'], ['$aileron_r', CS, 'aileron_l'], ['$aileron_l', CS, 'aileron_r'],
    ['$stab', AF, 'stabilizer'], ['$elev_r', CS, 'elevator_l'], ['$elev_l', CS, 'elevator_r'],
    ['$fin', AF, 'fin'], ['$rudder', CS, 'rudder'], ['$prop', 'effective-fixed-pitch-prop', 'prop'],
    ['$spinner', AF, 'spinner'],
    ['$leg_r', 'effective-spring-steel-gear', 'gear_main_l'], ['$leg_l', 'effective-spring-steel-gear', 'gear_main_r'],
    ['$leg_n', 'effective-spring-steel-gear', 'gear_nose'],
    ['$wheel_r', 'effective-aircraft-tire', 'wheel_main_l'], ['$wheel_l', 'effective-aircraft-tire', 'wheel_main_r'],
    ['$wheel_n', 'effective-aircraft-tire', 'wheel_nose']
].map(([of, material, nodeName]) => ({ of: of + '.handle', material, nodeName }))
    // GLB node order = op (creation) order, and materialsOverride follows it: keep parts[] in op order
    .sort((a, b) => ops.findIndex(o => o.as + '.handle' === a.of) - ops.findIndex(o => o.as + '.handle' === b.of));
const d2r = d => Math.round(d * Math.PI / 180 * 10000) / 10000;
// joint axes in the GLB frame (kernel +X -> +X, +Z -> +Y, +Y -> -Z); hinge pivots in kernel mm for the rig
const hingeY = r1(LE_Y + CUT * C), hingeZ = r1(ZC + (naca2412(CUT).yu + naca2412(CUT).yl) / 2 * C);
// Signs for the rig (kernel frame, right-handed about +X): +angle lifts a trailing edge.
// Flaps hinge on their lower front corner so a deflected flap never cuts into the wing box.
const loZ = r1(ZC + naca2412(CUT).yl * C);
const joints = [
    { node: 'aileron_l', type: 'revolute', axis: [1, 0, 0], min: d2r(-15), max: d2r(20), pivotMm: [0, hingeY, hingeZ] },
    { node: 'aileron_r', type: 'revolute', axis: [1, 0, 0], min: d2r(-15), max: d2r(20), pivotMm: [0, hingeY, hingeZ] },
    { node: 'flap_l', type: 'revolute', axis: [1, 0, 0], min: d2r(-30), max: 0, detentsDeg: [0, 10, 20, 30], pivotMm: [0, hingeY, loZ] },
    { node: 'flap_r', type: 'revolute', axis: [1, 0, 0], min: d2r(-30), max: 0, detentsDeg: [0, 10, 20, 30], pivotMm: [0, hingeY, loZ] },
    { node: 'elevator_l', type: 'revolute', axis: [1, 0, 0], min: d2r(-23), max: d2r(28), pivotMm: [0, 3950, 1690] },
    { node: 'elevator_r', type: 'revolute', axis: [1, 0, 0], min: d2r(-23), max: d2r(28), pivotMm: [0, 3950, 1690] },
    { node: 'rudder', type: 'revolute', axis: [0, 1, 0], min: d2r(-24), max: d2r(24), pivotMm: [0, 3950, 0] },
    { node: 'prop', type: 'continuous', axis: [0, 0, 1], min: null, max: null, pivotMm: [0, 0, 1175] },
    // retractable-gear variant: legs (and their wheels) draw up into the belly wells
    { node: 'gear_main_l', type: 'prismatic', axis: [0, 1, 0], min: 0, max: 0.32, carries: 'wheel_main_l', pivotMm: [812.5, -925, 700] },
    { node: 'gear_main_r', type: 'prismatic', axis: [0, 1, 0], min: 0, max: 0.32, carries: 'wheel_main_r', pivotMm: [-812.5, -925, 700] },
    { node: 'gear_nose', type: 'prismatic', axis: [0, 1, 0], min: 0, max: 0.38, carries: 'wheel_nose', pivotMm: [0, -2930, 700] }
];
const recipe = {
    name: 'light_aircraft',
    prompt: 'Generic high-wing four-seat light trainer (no brand marks): 11.0 m span constant-chord NACA 2412 wing on the cabin roof, 8.3 m long, ~2.7 m tall, tricycle gear modelled as the class\'s retractable-gear variant so the GEAR word keeps its meaning. Separate nodes for ailerons, 4-detent flaps (0/10/20/30), split elevator, rudder, prop + spinner, legs and wheels.',
    kind: 'hero',
    budget: { lod0Tris: 20000 },
    sources: [
        'https://en.wikipedia.org/wiki/Cessna_172',
        'https://en.wikipedia.org/wiki/Cessna_172#Variants',
        'http://airfoiltools.com/airfoil/details?airfoil=naca2412-il',
        'https://m-selig.ae.illinois.edu/ads/aircraft.html'
    ],
    dimensions: {
        'wingspan': '11000 mm (class figure 11.0 m, source 1)',
        'length': '8.26 m spinner tip to rudder trailing edge (class figure 8.28 m, source 1)',
        'height': '2.73 m to fin tip (class figure 2.72 m, source 1)',
        'wing area / chord': '16.5 m^2 with a 1500 mm constant chord (assumed: class has 16.2 m^2 on a 1.63 m root / 1.12 m tip; constant chord keeps the wing one extrusion)',
        'airfoil': 'NACA 2412 computed from the 4-digit equations (source 3, wing section listed for the class in source 4); lower surface clamped to -4.0 %c between ~12-33 %c (<=4 mm) to give a flat seat on the cabin roof',
        'flaps / ailerons': 'aft 25 % chord; flaps 550-2900 mm from centreline, ailerons 2900-5500 mm (assumed: typical high-wing trainer split); flap detents 0/10/20/30 deg (class flaps go to 30 or 40, source 1)',
        'horizontal tail': '3460 mm span, 650 mm stabiliser + 450 mm elevator (assumed from class 3-view proportions)',
        'propeller': '1900 mm (75 in) fixed pitch (class figure, source 1); thrust line 1175 mm',
        'gear': 'main track 2.5 m, 380 mm main tyres (15x6.00), 320 mm nose tyre (assumed typical); retract geometry as the class\'s RG variant (source 2)',
        'masses': 'see tools/cad/materials.json effective-* stocks: airframe density = (empty ~767 kg - prop - gear - tyres) / modelled volume'
    },
    units: 'mm',
    ops,
    parts,
    export: {
        lods: [{ tolerance: 1 }, { tolerance: 6 }, { tolerance: 25 }],
        compression: { quantize: true, instance: true },
        creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false
    },
    joints
};
const out = path.join(__dirname, '..', 'recipes', 'light_aircraft.json');
// cad_batch op list for the export run: every op pinned to one fresh document (the NativeCAD
// session is shared with other lanes), then set_part per part, then the strict GLB export.
function batchOps(exportArgs) {
    const D = '$cabin.document';
    const o = ops.map((op, i) => ({ tool: op.tool, as: op.as, args: Object.assign({ document: i === 0 ? 'new' : D }, op.args) }));
    parts.forEach(p => o.push({ tool: 'cad_set_part', args: { document: D, of: p.of, part: p.nodeName, material: p.material } }));
    if (exportArgs) o.push({ tool: 'cad_export_body', args: Object.assign({ document: D }, exportArgs) });
    return o;
}
if (require.main === module) {
    fs.writeFileSync(out, JSON.stringify(recipe, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    console.log('wrote', out, 'ops', ops.length, 'parts', parts.length, 'mainP', mainP.length, 'aftP', aftP.length, 'hinge', hingeY, hingeZ, 'ZC', ZC);
}
module.exports = { recipe, naca2412, batchOps };
