// LLF-86: prints the LLF_KIT_DIMS table for src/scenes/kit.js from assets/cad/manifest.d/<name>.json.
// Usage: node tools/cad/kit_dims.js park_bench traffic_light ...   (tests/test_llf86_assetkit.js checks kit.js against the manifest)
const m = require('./manifest_store').readAll();   // LLF-104: one manifest.d/<name>.json per asset
const names = process.argv.slice(2);
const r = (a) => a.map(v => Math.round(v * 1000) / 1000);
const out = {};
names.forEach(n => { if (!m[n]) throw new Error('no manifest entry ' + n); out[n] = { min: r(m[n].bboxM.min), max: r(m[n].bboxM.max) }; });
console.log(JSON.stringify(out));
