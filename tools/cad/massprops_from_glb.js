// LLF-84: write tools/cad/massprops/<name>.json from the exported GLB's LOD0 mesh (closed-mesh
// volume + centroid, converted back to the kernel frame: mm, +Z up). Use when cad_mass_properties
// cannot be called in the same atomic cad_batch as the export (the NativeCAD document is shared
// between concurrent lanes, so a later call may see someone else's bodies). Marked as such in
// the file; the build_manifest cross-check is then a consistency check, not an independent one.
const fs = require('fs'), path = require('path');
const glb = require('./glb.js');
const ROOT = path.join(__dirname, '..', '..');
process.argv.slice(2).forEach(name => {
    const recipe = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes', name + '.json'), 'utf8'));
    const g = glb.readGlb(fs.readFileSync(path.join(ROOT, 'assets', 'cad', name + '.glb')));
    const by = {}; glb.partMeshes(g, 0).forEach(m => { by[m.name] = m; });
    const out = { _frame: 'kernel frame (mm, +Z up), unit density', _source: 'glb-mesh-lod0 (see massprops_from_glb.js)' };
    recipe.parts.forEach(p => {
        const I = glb.meshIntegrals(by[p.nodeName].positions, by[p.nodeName].indices);
        const c = I.firstMoment.map(v => v / I.volume);            // glTF metres, Y up
        const r = x => Math.round(x * 1e4) / 1e4;
        out[p.nodeName] = { volumeMm3: r(I.volume * 1e9), centroidMm: [r(c[0] * 1000), r(-c[2] * 1000), r(c[1] * 1000)] };
    });
    fs.writeFileSync(path.join(__dirname, 'massprops', name + '.json'), JSON.stringify(out, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    console.log('massprops', name, Object.keys(out).length - 2, 'parts');
});
