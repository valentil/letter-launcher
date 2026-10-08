#!/usr/bin/env node
// tools/cad/gen/kyoto_c57_sketch.js (LLF-83) — the cad_sketch_solve request for the C57 valve gear at one crank
// angle. Inputs (crank pin P, return-crank pin Q, axle A, link pivot L0) are fixed; the solver must close the
// main-rod slider-crank, the expansion-link / eccentric-rod 4-bar and the radius-rod / combination-lever 4-bar.
// The rough start geometry is deliberately 20-40 mm off so the fixture is a real solve, not an echo.
//   node tools/cad/gen/kyoto_c57_sketch.js <k>      # theta = k * 45 deg, gear = +1 (full forward)
'use strict';
const path = require('path');
const VG = require(path.join(__dirname, '..', '..', '..', 'src/scenes/kyoto/valve_gear.js'));
const G = VG.GEOM;
function request(theta, gear) {
    const s = VG.solve(theta, gear);
    const j = (p, d) => [Math.round(p[0] + d), Math.round(p[1] - d)];
    const ents = [
        { id: 'A', kind: 'point', p: G.A }, { id: 'P', kind: 'point', p: s.P }, { id: 'Q', kind: 'point', p: s.Q },
        { id: 'L0', kind: 'point', p: G.L0 },
        { id: 'MR', kind: 'line', p0: s.P, p1: j(s.C, 30) },                 // main rod P -> C
        { id: 'CL', kind: 'line', p0: G.A, p1: j(s.C, 30), construction: true }, // cylinder centreline A -> C
        { id: 'LF', kind: 'line', p0: G.L0, p1: j(s.F, 25) },               // link pivot -> foot
        { id: 'ER', kind: 'line', p0: s.Q, p1: j(s.F, 25) },                // eccentric rod Q -> F
        { id: 'LD', kind: 'line', p0: G.L0, p1: j(s.Die, -20) },            // link pivot -> die block
        { id: 'CD', kind: 'line', p0: j(s.C, 30), p1: j(s.D, 30) },         // crosshead arm C -> D
        { id: 'DE', kind: 'line', p0: j(s.D, 30), p1: j(s.E, -35) },        // combination lever D -> E
        { id: 'RR', kind: 'line', p0: j(s.Die, -20), p1: j(s.E, -35) },     // radius rod Die -> E
        { id: 'DV', kind: 'line', p0: j(s.D, 30), p1: j(s.V, 40) }          // lever D -> valve pin V
    ];
    const c = (kind, entities, value) => (value == null ? { kind, entities } : { kind, entities, value });
    const cons = [
        c('fix', ['A']), c('fix', ['P']), c('fix', ['Q']), c('fix', ['L0']),
        c('coincident', ['MR.p0', 'P']), c('coincident', ['CL.p0', 'A']), c('coincident', ['CL.p1', 'MR.p1']), c('horizontal', ['CL']),
        c('distance', ['MR.p0', 'MR.p1'], G.mainRod),
        c('coincident', ['LF.p0', 'L0']), c('distance', ['LF.p0', 'LF.p1'], G.linkFoot),
        c('coincident', ['ER.p0', 'Q']), c('coincident', ['ER.p1', 'LF.p1']), c('distance', ['ER.p0', 'ER.p1'], G.eccRod),
        c('coincident', ['LD.p0', 'L0']), c('collinear', ['LD', 'LF']), c('distance', ['LD.p0', 'LD.p1'], gear * G.dieMax),
        c('coincident', ['CD.p0', 'MR.p1']), c('vertical', ['CD']), c('distance', ['CD.p0', 'CD.p1'], G.leverDrop),
        c('coincident', ['DE.p0', 'CD.p1']), c('distance', ['DE.p0', 'DE.p1'], G.leverDE),
        c('coincident', ['RR.p0', 'LD.p1']), c('coincident', ['RR.p1', 'DE.p1']), c('distance', ['RR.p0', 'RR.p1'], G.radiusRod),
        c('coincident', ['DV.p0', 'DE.p0']), c('collinear', ['DV', 'DE']), c('distance', ['DV.p0', 'DV.p1'], G.leverDV)
    ];
    return { entities: ents, constraints: cons };
}
module.exports = { request };
if (require.main === module) {
    const k = +process.argv[2];
    console.log(JSON.stringify(request(k * Math.PI / 4, 1)));
}
