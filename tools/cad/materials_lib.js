// Stock materials live one-per-file in tools/cad/materials.d/<key>.json (merge-proof: two branches that add
// different stocks never touch the same file). "_comment.json" holds the file-level note. Do NOT recreate
// tools/cad/materials.json -- tests/test_materials_split.js fails if it comes back.
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'materials.d');
function loadMaterials() {
    const out = {};
    fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort().forEach(f => { out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); });
    return out;
}
function writeMaterial(key, value) {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('bad material key ' + key);
    fs.writeFileSync(path.join(DIR, key + '.json'), JSON.stringify(value, null, 2).replace(/\n/g, '\r\n') + '\r\n');
}
module.exports = { loadMaterials, writeMaterial, DIR };
