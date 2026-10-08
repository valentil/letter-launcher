#!/usr/bin/env node
// tools/cad/gen/multi_batch.js (LLF-83) — several small recipes in ONE cad_batch: each gets its own "new" document and
// its $refs are prefixed with the recipe index, so build + set_part + strict export of all of them is one call.
//   node tools/cad/gen/multi_batch.js <WT-windows-path> name1 name2 ...
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const [wt, ...names] = process.argv.slice(2);
const mats = require(path.join(ROOT, 'tools/cad/materials_lib.js')).loadMaterials();
let all = [];
names.forEach((name, n) => {
    const rc = require(path.join(ROOT, 'tools/cad/recipes', name + '.json'));
    const pre = s => s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, `$r${n}_$1`);
    const fix = v => JSON.parse(pre(JSON.stringify(v)));
    const first = pre(rc.ops[0].as || '$op0'), DOC = first + '.document';
    rc.ops.forEach((o, i) => all.push(fix(Object.assign({}, o, { as: o.as || (i === 0 ? '$op0' : undefined), args: Object.assign({}, o.args, { document: i === 0 ? 'new' : '__DOC__' }) }))));
    rc.parts.forEach(p => all.push({ tool: 'cad_set_part', args: { of: pre(p.of), part: p.nodeName, material: p.material, document: '__DOC__' } }));
    const e = rc.export;
    all.push({ tool: 'cad_export_body', args: { document: '__DOC__', format: 'glb', path: wt + '\\assets\\cad\\' + name + '.glb', lods: e.lods, lodMode: 'single',
        compression: e.compression, creaseAngleDeg: e.creaseAngleDeg, units: 'm', bakeTransforms: false, strict: true,
        materialsOverride: rc.parts.map(p => ({ name: p.material, pbrMetallicRoughness: mats[p.material].pbr })) } });
    all = JSON.parse(JSON.stringify(all).split('"__DOC__"').join(JSON.stringify(DOC)));
});
if (all.length > 64) { console.error('too many ops: ' + all.length); process.exit(1); }
console.log(JSON.stringify(all));
