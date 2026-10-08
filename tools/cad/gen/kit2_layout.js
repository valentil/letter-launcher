#!/usr/bin/env node
// tools/cad/gen/kit2_layout.js (LLF-103): refresh LLF_KIT_DIMS in src/scenes/kit.js from manifest.d and append layout entries.
//   node tools/cad/gen/kit2_layout.js '<SCENE>' "{ n: 'x', x: 1, z: 2, rotY: 0 }" "{ ... }"
// Idempotent per exact entry text. Keeps CRLF. With no entries it only refreshes DIMS for every asset already named in the file.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const f = path.join(ROOT, 'src/scenes/kit.js');
let t = fs.readFileSync(f, 'utf8');
const [scene, ...entries] = process.argv.slice(2);
const man = require('../manifest_store').readAll();
const r = a => a.map(v => Math.round(v * 1000) / 1000);
const dm = /(const LLF_KIT_DIMS = )(\{.*\})(;)/.exec(t);
const dims = JSON.parse(dm[2]);
if (scene) {
    const key = scene === 'CITY' ? 'CITY: [' : "LLF_KIT_LAYOUT['" + scene + "'] = [";
    const i = t.indexOf(key); if (i < 0) throw new Error('no layout for ' + scene);
    const j = t.indexOf(']', t.indexOf('\n', i) > 0 ? i + key.length : i);
    // end of this scene's array: first line that is only whitespace + ']' (+ ';' or none) after i
    const m = /\r?\n\s*\](;?)\r?\n/.exec(t.slice(i)); const end = i + m.index;
    let body = t.slice(i, end);
    entries.forEach(e => {
        const nm = /n: '([^']+)'/.exec(e)[1];
        if (!dims[nm]) { if (!man[nm]) throw new Error('no manifest for ' + nm); dims[nm] = { min: r(man[nm].bboxM.min), max: r(man[nm].bboxM.max) }; }
        if (body.indexOf(e) < 0) body += ',\r\n                ' + e;
    });
    t = t.slice(0, i) + body + t.slice(end);
}
Object.keys(dims).forEach(n => { if (man[n]) dims[n] = { min: r(man[n].bboxM.min), max: r(man[n].bboxM.max) }; });
t = t.replace(/(const LLF_KIT_DIMS = )\{.*\}(;)/, (_, a, b) => a + JSON.stringify(dims) + b);
fs.writeFileSync(f, t);
console.log('kit.js updated' + (scene ? ' (' + scene + ' +' + entries.length + ')' : ''));
