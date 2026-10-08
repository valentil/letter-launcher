// LLF-105: materials are one file per stock in tools/cad/materials.d/; a single materials.json must not come back
// (two branches adding stocks to it conflict on every rebase).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL: ' + m); } };
ok(!fs.existsSync(path.join(ROOT, 'tools/cad/materials.json')), 'tools/cad/materials.json must not exist; use tools/cad/materials.d/<key>.json');
const { loadMaterials, DIR } = require(path.join(ROOT, 'tools/cad/materials_lib.js'));
const m = loadMaterials();
const keys = Object.keys(m).filter(k => k !== '_comment');
ok(keys.length >= 100, 'materials.d has stocks (' + keys.length + ')');
keys.forEach(k => { const v = m[k]; ok(v && v.densityKgM3 > 0 && v.pbr && Array.isArray(v.pbr.baseColorFactor) && v.source, 'stock ' + k + ' has densityKgM3, pbr, source'); });
fs.readdirSync(DIR).forEach(f => ok(/\.json$/.test(f), 'materials.d/' + f + ' must be .json'));
if (fails) process.exit(1);
console.log('test_materials_split: ' + keys.length + ' stocks OK');
