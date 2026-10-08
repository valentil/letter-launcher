#!/usr/bin/env node
// tools/cad/gen/kyoto_dressing.js (LLF-83) — KYOTO TRAIN set dressing recipes: myojin torii, five-storey pagoda
// (the palace landmark), palace gate with hinged door leaves, station platform + canopy, kasuga stone lantern and a
// generic school bus. Kernel frame: mm, +Z up, standing on z = 0, origin at the footprint centre.
//   node tools/cad/gen/kyoto_dressing.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const HALF_PI = Math.PI / 2;
const EXPORT = (t0) => ({ lods: [{ tolerance: t0 }, { tolerance: t0 * 4 }, { tolerance: t0 * 12 }], compression: { quantize: true, instance: true },
    creaseAngleDeg: 30, upAxis: 'Y', units: 'm', bakeTransforms: false });
const box = (as, x0, y0, z0, dx, dy, dz) => ({ tool: 'cad_box', args: { origin: [x0, y0, z0], dx, dy, dz }, as });
const cboxC = (as, cx, cy, z0, dx, dy, dz) => box(as, cx - dx / 2, cy - dy / 2, z0, dx, dy, dz);
const cyl = (as, x, y, z0, r, h) => ({ tool: 'cad_cylinder', args: { r, h, origin: [x, y, z0] }, as });
const sq = h => [[-h, -h], [h, -h], [h, h], [-h, h]];
const hex = r => [0, 1, 2, 3, 4, 5].map(k => [Math.round(r * Math.cos(k * Math.PI / 3)), Math.round(r * Math.sin(k * Math.PI / 3))]);
const loft = (as, A, B, zA, zB) => ({ tool: 'cad_loft_profiles', args: { profileA: A, profileB: B, zA, zB }, as });
const prism = (as, outer, z0, h) => ({ tool: 'cad_extrude_profile', args: { profile: { outer }, depth: h, plane: { origin: [0, 0, z0] } }, as });
// side-plane extrusion: profile in (x, z), from y = y1 toward -y by depth
const sidePlate = (as, outer, y1, depth) => ({ tool: 'cad_extrude_profile', args: { profile: { outer }, depth, plane: { origin: [0, y1, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] } }, as });
// end-plane extrusion: profile in (y, z), from x = x0 toward +x by depth
const endPlate = (as, outer, x0, depth) => ({ tool: 'cad_extrude_profile', args: { profile: { outer }, depth, plane: { origin: [x0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] } }, as });
const part = (parts, as, material, nodeName) => parts.push({ of: as + '.handle', material, nodeName });

function torii() {
    const ops = [], parts = [], X = 3000, R = 380;
    [['l', -X], ['r', X]].forEach(([s, x]) => {
        ops.push(cyl(`$base_${s}`, x, 0, 0, 520, 600)); part(parts, `$base_${s}`, 'lacquer-black', `kamebara_${s}`);
        ops.push(cyl(`$post_${s}`, x, 0, 600, R, 7000)); part(parts, `$post_${s}`, 'hinoki-vermilion', `hashira_${s}`);
    });
    // nuki: 20 mm clear of each round post, hung from the gakuzuka
    ops.push(cboxC('$nuki', 0, 0, 5200, 2 * (X - R) - 40, 400, 500)); part(parts, '$nuki', 'hinoki-vermilion', 'nuki');
    ops.push(cboxC('$gaku', 0, 0, 5700, 600, 300, 1900)); part(parts, '$gaku', 'hinoki-vermilion', 'gakuzuka');
    ops.push(cboxC('$shimaki', 0, 0, 7600, 7200, 600, 400)); part(parts, '$shimaki', 'hinoki-vermilion', 'shimaki');
    ops.push(sidePlate('$kasagi', [[-3600, 8000], [3600, 8000], [4300, 8120], [4750, 8350], [4700, 8750], [3800, 8550], [0, 8500], [-3800, 8550], [-4700, 8750], [-4750, 8350], [-4300, 8120]], 350, 700));
    part(parts, '$kasagi', 'lacquer-black', 'kasagi');
    return { name: 'kyoto_torii', kind: 'prop', budget: { lod0Tris: 3000, why: 'two posts + bases at 3 mm chord' },
        prompt: 'Myojin torii in vermilion-lacquered hinoki: two 760 mm round hashira on black kamebara bases, nuki tie beam, gakuzuka, shimaki and the black upswept kasagi; 6 m between post centres, 8.75 m tall.',
        sources: ['https://en.wikipedia.org/wiki/Torii', 'https://www.japan-guide.com/e/e2059.html'],
        dimensions: { 'type': 'myojin torii (source 1)', 'span': '6000 mm post centres (assumed, mid-size shrine torii)', 'height': '8750 mm to kasagi tips (assumed)', 'posts': '760 mm diameter (assumed, ~1/8 of the span as in source 1 drawings)', 'colour': 'vermilion (shu) lacquer, black kasagi and bases (source 2: Fushimi Inari)' },
        units: 'mm', ops, parts, export: EXPORT(3) };
}

function pagoda() {
    const ops = [], parts = [];
    const bodies = [6400, 5900, 5400, 4900, 4400], eaves = [12800, 12000, 11200, 10400, 9600], BH = 3800, RH = 1500;
    ops.push(cboxC('$kidan', 0, 0, 0, 9000, 9000, 1000)); part(parts, '$kidan', 'granite', 'kidan');
    let z = 1000;
    bodies.forEach((w, i) => {
        ops.push(cboxC(`$body${i}`, 0, 0, z, w, w, BH)); part(parts, `$body${i}`, 'effective-pagoda-body', `storey_${i + 1}`);
        z += BH;
        const top = i < 4 ? bodies[i + 1] + 400 : 1200;
        ops.push(loft(`$roof${i}`, sq(eaves[i] / 2), sq(top / 2), z, z + RH)); part(parts, `$roof${i}`, 'kawara-roof', `roof_${i + 1}`);
        z += RH;
    });
    ops.push(cboxC('$roban', 0, 0, z, 1200, 1200, 600)); part(parts, '$roban', 'bronze', 'roban');
    ops.push(cyl('$sorin', 0, 0, z + 600, 260, 13500)); part(parts, '$sorin', 'bronze', 'sorin');
    return { name: 'kyoto_pagoda', kind: 'hero', budget: { lod0Tris: 14000, why: 'five lofted (B-spline) roofs and the 13.5 m sorin at 4 mm chord; the level landmark' },
        prompt: 'Five-storey pagoda after Yasaka-no-to (Hokan-ji, Kyoto): stone kidan, five diminishing storeys under wide tiled roofs, bronze roban and sorin finial; 41.6 m tall.',
        sources: ['https://en.wikipedia.org/wiki/H%C5%8Dkan-ji', 'https://en.wikipedia.org/wiki/Pagoda#Japan'],
        dimensions: { 'height': '41.6 m to the finial (source 1 gives 46 m for Yasaka-no-to; finial shortened, assumed)', 'storeys': '5, bodies 6.4 -> 4.4 m square, 3.8 m tall (assumed proportions)', 'eaves': '12.8 -> 9.6 m square, 1.5 m roof depth (assumed: eaves roughly twice the body, source 2)', 'finial': 'sorin 13.5 m on a 1.2 m roban (assumed ~1/3 of the height, source 2)', 'mass': 'effective densities for solid-modelled timber framing and tile roofs (materials.json)' },
        units: 'mm', ops, parts, export: EXPORT(4) };
}

function palaceGate() {
    const ops = [], parts = [], W = 2600, P = 700;
    [['l', -1], ['r', 1]].forEach(([s, k]) => {
        ops.push(cboxC(`$post_${s}`, k * (W + P / 2), 0, 0, P, P, 6500)); part(parts, `$post_${s}`, 'hinoki-vermilion', `post_${s}`);
    });
    ops.push(box('$door_l', -W, -90, 0, W, 180, 5200)); part(parts, '$door_l', 'keyaki-door', 'door_l');
    ops.push(box('$door_r', 0, -90, 0, W, 180, 5200)); part(parts, '$door_r', 'keyaki-door', 'door_r');
    ops.push(cboxC('$lintel', 0, 0, 6500, 2 * (W + P), 900, 700)); part(parts, '$lintel', 'hinoki-vermilion', 'kashiranuki');
    ops.push(endPlate('$roof', [[-2400, 7200], [2400, 7200], [2400, 7500], [0, 8900], [-2400, 7500]], -(W + P + 900), 2 * (W + P + 900)));
    part(parts, '$roof', 'kawara-roof', 'roof');
    return { name: 'kyoto_palace_gate', kind: 'prop', budget: { lod0Tris: 1000, why: 'boxes and one gable' },
        prompt: 'Palace gate in the Kyoto Gosho manner: two vermilion posts, kashiranuki lintel and a tiled gable, with two 2.6 m keyaki door leaves hinged on the posts (revolute joints) so PALACE / OPEN swings them.',
        sources: ['https://en.wikipedia.org/wiki/Kyoto_Imperial_Palace', 'https://sankan.kunaicho.go.jp/english/guide/kyoto.html'],
        dimensions: { 'opening': '5200 mm wide x 5200 mm tall, two 2600 mm leaves (assumed, Gosho gate proportions, source 2)', 'posts': '700 mm square x 6500 mm (assumed)', 'roof': 'gable, ridge at 8900 mm (assumed)' },
        units: 'mm', ops, parts, export: EXPORT(2),
        joints: [{ node: 'door_l', type: 'revolute', axis: [0, 1, 0], min: 0, max: 1.75, hingeMm: [-W, 0], note: 'positive = swings in (toward kernel +y, away from the approach)' },
            { node: 'door_r', type: 'revolute', axis: [0, 1, 0], min: -1.75, max: 0, hingeMm: [W, 0] }],
        rig: { hinges: { door_l: [-W, -90], door_r: [W, -90] }, open: { door_l: 1.45, door_r: -1.45 } } };
}

function station() {
    const ops = [], parts = [];
    ops.push(cboxC('$platform', 0, 0, 0, 23000, 6000, 1100)); part(parts, '$platform', 'concrete', 'platform');
    [[-8000, -1800], [8000, -1800], [-8000, 1800], [8000, 1800]].forEach(([x, y], i) => {
        ops.push(cboxC(`$post${i}`, x, y, 1100, 200, 200, 3200)); part(parts, `$post${i}`, 'steel-black-enamel', `canopy_post_${i + 1}`);
    });
    ops.push(endPlate('$roof', [[-3000, 4300], [3000, 4300], [3000, 4500], [0, 5100], [-3000, 4500]], -11000, 22000));
    part(parts, '$roof', 'roof-sheet-green', 'canopy_roof');
    [-1000, 1000].forEach((x, i) => { ops.push(cboxC(`$spost${i}`, x, -2700, 1100, 100, 100, 1900)); part(parts, `$spost${i}`, 'steel-black-enamel', `sign_post_${i + 1}`); });
    ops.push(cboxC('$sign', 0, -2700, 3000, 2400, 120, 600)); part(parts, '$sign', 'sign-white', 'station_sign');
    return { name: 'kyoto_station', kind: 'prop', budget: { lod0Tris: 800, why: 'boxes and one gable' },
        prompt: 'Country station for the KYOTO TRAIN: 23 m concrete side platform 1.1 m above rail level, four-post canopy with a green steel gable roof, and the white station-name board.',
        sources: ['https://en.wikipedia.org/wiki/Railway_platform_height#Japan', 'https://en.wikipedia.org/wiki/JNR_Class_C57'],
        dimensions: { 'platform': '23000 x 6000 mm, 1100 mm above the ballast base (JR conventional platforms 760-1100 mm above rail, source 1)', 'canopy': '4 posts on 16 m x 3.6 m centres, eaves 4300 mm (assumed)', 'sign': '2400 x 600 mm station-name board (assumed)' },
        units: 'mm', ops, parts, export: EXPORT(2) };
}

function lantern() {
    const ops = [], parts = [];
    ops.push(prism('$kiso', hex(380), 0, 200)); part(parts, '$kiso', 'granite', 'kiso');
    ops.push(cyl('$sao', 0, 0, 200, 120, 800)); part(parts, '$sao', 'granite', 'sao');
    ops.push(prism('$chudai', hex(330), 1000, 200)); part(parts, '$chudai', 'granite', 'chudai');
    ops.push(prism('$hibukuro', hex(250), 1200, 420)); part(parts, '$hibukuro', 'lantern-firebox', 'hibukuro');
    ops.push(loft('$kasa', hex(480), hex(140), 1620, 1920)); part(parts, '$kasa', 'granite', 'kasa');
    ops.push({ tool: 'cad_frustum', args: { r0: 130, r1: 40, h: 240, origin: [0, 0, 1920] }, as: '$hoju' }); part(parts, '$hoju', 'granite', 'hoju');
    return { name: 'kyoto_lantern', kind: 'prop', budget: { lod0Tris: 2500, why: 'hex prisms plus the lofted (B-spline) kasa roof at 1 mm chord' },
        prompt: 'Kasuga-doro stone lantern: hexagonal kiso, round sao pole, chudai, hibukuro fire box (lights up at NIGHT / LANTERN), hexagonal kasa roof and hoju finial; 2.16 m tall.',
        sources: ['https://en.wikipedia.org/wiki/T%C5%8Dr%C5%8D', 'https://www.japan-guide.com/e/e2054.html'],
        dimensions: { 'type': 'kasuga-doro (source 1)', 'height': '2160 mm (assumed; kasuga lanterns run 1.5-3 m, source 1)', 'parts': 'kiso, sao, chudai, hibukuro, kasa, hoju from the standard six-part breakdown (source 1)' },
        units: 'mm', ops, parts, export: EXPORT(1) };
}

function schoolBus() {
    const ops = [], parts = [];
    // wheels: revolved like the rail wheels (profile z -> +y after rx = -pi/2) with their inner faces on a chassis
    // block at |y| = 800; the block's contact band (z 550..800) matches the band that passes the strict check.
    [['l', 1], ['r', -1]].forEach(([s, k]) => {
        let prof = [[0, 800], [400, 800], [400, 1030], [0, 1030]];
        if (k < 0) prof = prof.map(q => [q[0], -q[1]]).reverse();
        ops.push({ tool: 'cad_revolve_profile', args: { profile: prof }, as: `$w${s}` });
        [[2300, 'f', true], [-2300, 'b', false]].forEach(([x, e, copy]) => {
            const as = `$w_${e}${s}`;
            ops.push({ tool: 'cad_transform', args: Object.assign({ of: `$w${s}.handle`, rotate: { rx: -HALF_PI }, translate: [x, 0, 400] }, copy ? { copy: true } : {}), as });
            part(parts, as, 'rubber', `wheel_${e}${s}`);
        });
    });
    ops.push(cboxC('$chassis', 0, 0, 550, 6000, 1600, 250)); part(parts, '$chassis', 'effective-underframe', 'chassis');
    ops.push(cboxC('$body', 0, 0, 800, 7000, 2060, 2200)); part(parts, '$body', 'effective-bus-body', 'body');
    [['l', 1030], ['r', -1040]].forEach(([s, y]) => { ops.push(box(`$win_${s}`, -3000, y, 1900, 5600, 10, 800)); part(parts, `$win_${s}`, 'window-glass-dark', `windows_${s}`); });
    ops.push(box('$screen', 3500, -900, 1900, 10, 1800, 900)); part(parts, '$screen', 'window-glass-dark', 'windscreen');
    ops.push(box('$bumper', 3500, -1000, 800, 120, 2000, 300)); part(parts, '$bumper', 'steel-black-enamel', 'bumper');
    return { name: 'kyoto_school_bus', kind: 'prop', budget: { lod0Tris: 1500, why: 'four wheels at 2 mm chord' },
        prompt: 'Generic Japanese small school bus (7 m class, kindergarten-yellow): body on four 800 mm wheels, window bands, windscreen and bumper.',
        sources: ['https://en.wikipedia.org/wiki/Isuzu_Journey', 'https://en.wikipedia.org/wiki/School_bus#Japan'],
        dimensions: { 'length': '7000 mm, width 2060 mm, height 3000 mm (source 1: 7 m class small bus)', 'wheels': '800 mm diameter, 4600 mm wheelbase (assumed)', 'mass': '~7 t kerb (source 1 class figure) via effective-bus-body' },
        units: 'mm', ops, parts, export: EXPORT(2) };
}

function machiya() {
    const ops = [], parts = [];
    ops.push(cboxC('$ground', 0, 0, 0, 5400, 9000, 3000)); part(parts, '$ground', 'effective-machiya-body', 'ground_floor');
    ops.push(box('$upper', -2700, -3500, 3000, 5400, 8000, 2400)); part(parts, '$upper', 'effective-machiya-body', 'upper_floor');
    ops.push(endPlate('$hisashi', [[-4900, 3000], [-3500, 3000], [-3500, 3600], [-4900, 3150]], -2900, 5800)); part(parts, '$hisashi', 'kawara-roof', 'hisashi');
    ops.push(endPlate('$roof', [[-3900, 5400], [4900, 5400], [4900, 5550], [500, 6900], [-3900, 5550]], -2900, 5800)); part(parts, '$roof', 'kawara-roof', 'roof');
    ops.push(box('$koshi', -2400, -4510, 300, 4800, 10, 2100)); part(parts, '$koshi', 'koshi-lattice', 'koshi');
    ops.push(box('$mushiko', -1800, -3510, 3900, 3600, 10, 900)); part(parts, '$mushiko', 'koshi-lattice', 'mushiko_mado');
    return { name: 'kyoto_machiya', kind: 'prop', budget: { lod0Tris: 400, why: 'boxes and two extruded roofs' },
        prompt: 'Kyo-machiya townhouse: 5.4 m frontage, 9 m deep, two storeys with the upper floor set back under a tiled hisashi, tiled gable roof parallel to the street, koshi lattice front and mushiko-mado slit windows.',
        sources: ['https://en.wikipedia.org/wiki/Machiya', 'https://www.japan-guide.com/e/e2368.html'],
        dimensions: { 'frontage': '5400 mm (source 1: narrow street frontage, "unagi no nedoko")', 'depth': '9000 mm (assumed; real machiya run deeper, shortened for the diorama)', 'storeys': 'ground 3000 mm, low upper floor 2400 mm with mushiko-mado (source 1)', 'roof': 'kawara gable, ridge parallel to the street at 6900 mm (assumed)' },
        units: 'mm', ops, parts, export: EXPORT(2) };
}

function write(rc) {
    const n = rc.ops.length + rc.parts.length;
    if (n > 64) throw new Error(`${rc.name}: ops+parts ${n} > 64`);
    fs.writeFileSync(path.join(ROOT, 'tools/cad/recipes', rc.name + '.json'), JSON.stringify(rc, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    console.log(`${rc.name}: ${rc.ops.length} ops + ${rc.parts.length} parts`);
}
if (require.main === module) [torii(), pagoda(), palaceGate(), station(), lantern(), schoolBus(), machiya()].forEach(write);
