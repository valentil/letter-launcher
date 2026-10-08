#!/usr/bin/env node
/*
 * tools/cad/build_rocket_stages.js — write assets/cad/rocket_stages.json (LLF-82).
 *
 *   node tools/cad/build_rocket_stages.js          # regenerate
 *   node tools/cad/build_rocket_stages.js --check  # exit 1 when the file is stale
 *
 * Dry mass, centre of mass (along the stack) and a thin-shell inertia estimate per stage come from the
 * CAD mass properties (assets/cad/manifest.d/<name>.json part masses x tools/cad/massprops centroids, which
 * build_manifest.js cross-checks against the exported GLB). Propellant load, Isp, burn time and
 * diameter are the public Saturn V figures kept in src/scenes/rocket/ascent.js DEFAULT_TABLE
 * (NASA SP-4206 / Saturn V Flight Manual SA-506). Tower swing-arm hinges and lander leg hinges come
 * from the manifest joints. Plain Node, no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const manifest = require('./manifest_store').readAll();   // LLF-104: one assets/cad/manifest.d/<name>.json per asset
const mp = n => require(path.join(__dirname, 'massprops', n + '.json'));
const A = require(path.join(ROOT, 'src', 'scenes', 'rocket', 'ascent.js'));
const r3 = v => Math.round(v * 1000) / 1000;

const rocket = manifest.moon_rocket, rmp = mp('moon_rocket');
const nodeKg = n => { if (!rocket.parts[n]) throw new Error('moon_rocket has no node ' + n); return rocket.parts[n].massKg; };
const nodeZm = n => rmp[n].centroidMm[2] / 1000;

let bottom = 0;
const stages = A.DEFAULT_TABLE.stages.map(s => {
    const kg = s.nodes.reduce((a, n) => a + nodeKg(n), 0);
    const comAbs = s.nodes.reduce((a, n) => a + nodeKg(n) * nodeZm(n), 0) / kg;
    const r = s.diameterM / 2, L = s.lengthM;
    // thin cylindrical shell about its own COM: axial m r^2, transverse m (r^2/2 + L^2/12)
    const Iax = kg * r * r, Itr = kg * (r * r / 2 + L * L / 12);
    const out = Object.assign({}, s, {
        dryKg: r3(kg), stackBottomM: r3(bottom), comZm: r3(comAbs - bottom), comStackZm: r3(comAbs),
        inertiaDry: { axialKgM2: Math.round(Iax), transverseKgM2: Math.round(Itr), basis: 'thin cylindrical shell on the CAD dry mass, about the stage dry COM (approximate)' },
        massSource: 'sum of manifest part masses: ' + s.nodes.join(', ')
    });
    bottom += s.lengthM;
    return out;
});

const payloadNodes = ['sla', 'csm_sm', 'csm_cm', 'les'];
const payloadHardwareKg = payloadNodes.reduce((a, n) => a + nodeKg(n), 0);

const tm = manifest.launch_tower, tmp = mp('launch_tower');
const platformTopM = 14.7;
const arms = tm.joints.map(j => {
    const c = tmp[j.node].centroidMm;           // kernel mm, +Z up
    return { node: j.node, type: 'revolute', axisGlb: j.axis, hingeGlbM: [10, r3(c[2] / 1000), -1.2], engagedRad: 0, retractRad: j.min, centroidGlbM: [r3(c[0] / 1000), r3(c[2] / 1000), r3(-c[1] / 1000)], massKg: tm.parts[j.node].massKg };
});

const lm = manifest.lunar_lander;
const dirs = [[1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, 0, 1]];     // radial direction d: axis = d x Y
const legs = lm.joints.map((j, i) => {
    const d = dirs[i];
    return { node: j.node, type: 'revolute', axisGlb: j.axis, radialGlb: d, hingeGlbM: [d[0] * 2.1, 1.5, d[2] * 2.1], deployedRad: 0, stowedRad: j.max, massKg: lm.parts[j.node].massKg };
});

const total = stages.reduce((a, s) => a + s.dryKg + s.propKg, 0) + A.DEFAULT_TABLE.payload.kg;
const doc = {
    version: 1,
    generatedBy: 'tools/cad/build_rocket_stages.js',
    frame: 'metres, kg; comZm is along the stack from each stage\'s own bottom, comStackZm from the pad-side bottom of the S-IC; glTF +Y is the rocket axis',
    body: 'earth',
    cd: { value: 0.35, label: 'approximate: Mach-independent drag coefficient for a slender launcher. A cad_wind_tunnel quick-look solve (laminar, 15 steps, 0.06 flow-throughs, NOT converged) returned Cd 0.94 on a blunt cylinder+cone stand-in, so it was not used.' },
    stages,
    events: A.DEFAULT_TABLE.events,
    payload: Object.assign({}, A.DEFAULT_TABLE.payload, { cadHardwareKg: r3(payloadHardwareKg), cadNodes: payloadNodes, note: 'payload total is the public figure (propellant in the SM and the LM are not modelled); cadHardwareKg is the modelled SLA/CSM/LES mass' }),
    guidance: A.DEFAULT_TABLE.guidance,
    stack: { liftoffMassKg: Math.round(total), cadDryMassKg: r3(rocket.massKg), cadComStackM: rocket.comM[1], heightM: rocket.bboxM.size[1], propellantKg: stages.reduce((a, s) => a + s.propKg, 0) },
    tower: { asset: 'launch_tower', platformTopM, scaleHint: 0.035, arms },
    lander: { asset: 'lunar_lander', dryKg: lm.massKg, comGlbM: lm.comM, legs },
    references: ['https://en.wikipedia.org/wiki/Saturn_V', 'https://en.wikipedia.org/wiki/Apollo_Lunar_Module', 'https://en.wikipedia.org/wiki/Launch_Umbilical_Tower', 'NASA SP-4206 Stages to Saturn', 'Saturn V Flight Manual SA-506']
};
const text = JSON.stringify(doc, null, 2) + '\n';
const out = path.join(ROOT, 'assets', 'cad', 'rocket_stages.json');
if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur.replace(/\r\n/g, '\n') !== text) { console.error('rocket_stages.json is stale — run node tools/cad/build_rocket_stages.js'); process.exit(1); }
    console.log('rocket_stages.json up to date'); process.exit(0);
}
fs.writeFileSync(out, text);
console.log('wrote', path.relative(ROOT, out), '— stages', stages.map(s => s.id + ' ' + s.dryKg + ' kg dry').join(', '));
