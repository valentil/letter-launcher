#!/usr/bin/env node
// tools/cad/gen/batch.js (LLF-83) — print the cad_batch op lists for a recipe, so build + export (+ preview)
// run in ONE batch and build + cad_mass_properties in a second one. Other lanes share the NativeCAD server
// and may cad_session_reset between separate calls, so nothing relies on a document surviving a call.
//   node tools/cad/gen/batch.js <name> export <WT-windows-path>   -> ops + set_part + export + preview
//   node tools/cad/gen/batch.js <name> mass                       -> ops + mass_properties per part
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const [name, mode, wt] = process.argv.slice(2);
const rc = require(path.join(ROOT, 'tools/cad/recipes', name + '.json'));
const mats = require(path.join(ROOT, 'tools/cad/materials.json'));
// Own document: ops[0] opens document "new", every later op names it, so concurrent lanes on the shared
// session (whose active-document switches and resets would otherwise land in the middle of this batch) can't interleave.
const DOC = '$op0.document';
const DOCREF = (rc.ops[0].as || '$op0') + '.document';
let ops = rc.ops.map((o, i) => Object.assign({}, o, { args: Object.assign({}, o.args, { document: i === 0 ? 'new' : DOC }), as: i === 0 ? (o.as || '$op0') : o.as }));
if (rc.ops[0].as && rc.ops[0].as !== '$op0') ops.forEach(o => { if (o.args.document === DOC) o.args.document = rc.ops[0].as + '.document'; });
if (mode === 'export') {
    ops = ops.concat(rc.parts.map(p => ({ tool: 'cad_set_part', args: { of: p.of, part: p.nodeName, material: p.material, document: DOCREF } })));
    const e = rc.export;
    ops.push({ tool: 'cad_export_body', args: { document: DOCREF, format: 'glb', path: wt + '\\assets\\cad\\' + name + '.glb', lods: e.lods, lodMode: 'single',
        compression: e.compression, creaseAngleDeg: e.creaseAngleDeg, units: 'm', bakeTransforms: false, strict: true,
        materialsOverride: rc.parts.map(p => ({ name: p.material, pbrMetallicRoughness: mats[p.material].pbr })) } });
    if (process.argv.includes('--preview')) ops.push({ tool: 'cad_preview_body', args: { document: DOCREF, views: ['front', 'iso'], tile: 256 } });
} else {
    ops = ops.concat(rc.parts.map(p => ({ tool: 'cad_mass_properties', args: { solid: p.of } })));
}
if (ops.length > 64) { console.error('too many ops: ' + ops.length); process.exit(1); }
console.log(JSON.stringify(ops));
