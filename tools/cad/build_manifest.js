#!/usr/bin/env node
/*
 * tools/cad/build_manifest.js — write/refresh assets/cad/manifest.json entries (LLF-69).
 *
 *   node tools/cad/build_manifest.js street_lamp            # one asset
 *   node tools/cad/build_manifest.js --all                  # every recipe that has a GLB
 *
 * Inputs per asset <name>:
 *   tools/cad/recipes/<name>.json     the recipe (contract: tools/cad/README.md)
 *   assets/cad/<name>.glb             what cad_export_body wrote
 *   tools/cad/massprops/<name>.json   per-part {volumeMm3, centroidMm} copied from cad_mass_properties
 *   tools/cad/materials.json          stock -> density + PBR
 *
 * Mass = density x CAD volume (exact B-rep). Centre of mass and inertia come from the GLB's LOD0
 * mesh (closed-mesh integrals), so nobody has to transcribe 3x3 tensors; the CAD volume and
 * centroid are cross-checked against the mesh and the build FAILS when they disagree (wrong part
 * mapping, missing body, stale GLB). Output frame is the GLB's: metres, +Y up.
 * Plain Node, no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const glb = require('./glb');

const ROOT = path.join(__dirname, '..', '..');
const P = {
    recipe: n => path.join(ROOT, 'tools', 'cad', 'recipes', n + '.json'),
    massprops: n => path.join(ROOT, 'tools', 'cad', 'massprops', n + '.json'),
    glb: n => path.join(ROOT, 'assets', 'cad', n + '.glb'),
    preview: n => path.join(ROOT, 'assets', 'cad', 'previews', n + '.png'),
    materials: path.join(ROOT, 'tools', 'cad', 'materials.json'),
    manifest: path.join(ROOT, 'assets', 'cad', 'manifest.json'),
};
const DEFAULT_BUDGET = { hero: 20000, prop: 3000 };

function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
}
// Hash of the recipe's canonical JSON (key order and whitespace do not matter).
function recipeHash(recipe) { return crypto.createHash('sha256').update(stable(recipe)).digest('hex').slice(0, 16); }
function budgetFor(recipe) {
    return (recipe.budget && recipe.budget.lod0Tris) || DEFAULT_BUDGET[recipe.kind === 'hero' ? 'hero' : 'prop'];
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const r6 = v => Math.round(v * 1e6) / 1e6;
// kernel frame (mm, Z up) -> glTF frame (m, Y up): (x, y, z) -> (x, z, -y) / 1000
const toGltf = c => [c[0] / 1000, c[2] / 1000, -c[1] / 1000];

function buildEntry(name) {
    const recipe = readJson(P.recipe(name));
    if (recipe.name !== name) throw new Error(`recipe name "${recipe.name}" != file name "${name}"`);
    const materials = readJson(P.materials);
    const massprops = fs.existsSync(P.massprops(name)) ? readJson(P.massprops(name)) : null;
    if (!massprops) throw new Error(`missing tools/cad/massprops/${name}.json (run cad_mass_properties per part)`);
    const g = glb.readGlb(fs.readFileSync(P.glb(name)));
    const meshes = glb.partMeshes(g, 0);
    const byName = {}; meshes.forEach(m => { byName[m.name] = m; });

    let M = 0; const F = [0, 0, 0]; const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const parts = {};
    const problems = [];
    recipe.parts.forEach(p => {
        const mat = materials[p.material];
        if (!mat) { problems.push(`part ${p.nodeName}: unknown material "${p.material}" (add it to tools/cad/materials.json)`); return; }
        const mesh = byName[p.nodeName];
        if (!mesh) { problems.push(`part ${p.nodeName}: no node of that name in ${name}.glb (has: ${Object.keys(byName).join(', ')})`); return; }
        const mp = massprops[p.nodeName];
        if (!mp) { problems.push(`part ${p.nodeName}: missing from massprops/${name}.json`); return; }
        if (mesh.materials.length && mesh.materials.some(n => n !== p.material)) {
            problems.push(`part ${p.nodeName}: GLB material "${mesh.materials.join(',')}" != recipe "${p.material}" (materialsOverride order must follow the GLB node order)`);
        }
        const I = glb.meshIntegrals(mesh.positions, mesh.indices);
        const cadV = mp.volumeMm3 * 1e-9;
        if (!(I.volume > 0)) { problems.push(`part ${p.nodeName}: mesh volume ${I.volume} <= 0 (open or inverted mesh)`); return; }
        const dv = Math.abs(I.volume - cadV) / cadV;
        if (dv > 0.03) problems.push(`part ${p.nodeName}: mesh volume ${I.volume.toExponential(4)} m^3 vs CAD ${cadV.toExponential(4)} m^3 (${(dv * 100).toFixed(1)}% > 3%)`);
        const meshC = I.firstMoment.map(v => v / I.volume), cadC = toGltf(mp.centroidMm);
        const dc = Math.hypot(meshC[0] - cadC[0], meshC[1] - cadC[1], meshC[2] - cadC[2]);
        if (dc > 0.005) problems.push(`part ${p.nodeName}: mesh centroid off CAD centroid by ${(dc * 1000).toFixed(1)} mm (> 5 mm)`);
        const k = mat.densityKgM3 * cadV / I.volume; // scale mesh integrals to the exact CAD mass
        const m = mat.densityKgM3 * cadV;
        M += m;
        for (let i = 0; i < 3; i++) { F[i] += k * I.firstMoment[i]; for (let j = 0; j < 3; j++) C[i][j] += k * I.second[i][j]; }
        parts[p.nodeName] = { material: p.material, massKg: r6(m) };
    });
    if (problems.length) throw new Error(`${name}:\n  - ` + problems.join('\n  - '));

    const com = F.map(v => v / M);
    const Cc = C.map((row, i) => row.map((v, j) => v - M * com[i] * com[j]));
    const tr = Cc[0][0] + Cc[1][1] + Cc[2][2];
    const inertia = Cc.map((row, i) => row.map((v, j) => r6((i === j ? tr : 0) - v)));
    const s = glb.summary(g);
    return {
        file: name + '.glb',
        preview: fs.existsSync(P.preview(name)) ? 'previews/' + name + '.png' : null,
        kind: recipe.kind || 'prop',
        tris: s.tris,
        budgetTris: budgetFor(recipe),
        bboxM: { min: s.bboxM.min.map(r6), max: s.bboxM.max.map(r6), size: s.bboxM.size.map(r6) },
        massKg: r6(M),
        comM: com.map(r6),
        inertia,
        inertiaFrame: 'kg*m^2 about comM, glTF axes (m, +Y up)',
        parts,
        joints: recipe.joints || [],
        // LLF-74: strict:true export result copied into massprops/<name>.json "_export" ({strict, floating, interferingPairs})
        assemblyOk: massprops._export ? (massprops._export.strict === true && massprops._export.floating === 0 && massprops._export.interferingPairs === 0) : undefined,
        materials: Array.from(new Set(recipe.parts.map(p => p.material))).sort(),
        recipeHash: recipeHash(recipe),
        sources: recipe.sources || [],
    };
}

function sortKeys(o) { const out = {}; Object.keys(o).sort().forEach(k => { out[k] = o[k]; }); return out; }

function main(argv) {
    let names = argv.filter(a => !a.startsWith('--'));
    if (argv.includes('--all')) {
        names = fs.readdirSync(path.join(ROOT, 'tools', 'cad', 'recipes')).filter(f => f.endsWith('.json'))
            .map(f => f.slice(0, -5)).filter(n => fs.existsSync(P.glb(n)));
    }
    if (!names.length) { console.error('usage: node tools/cad/build_manifest.js <name>... | --all'); return 2; }
    const manifest = fs.existsSync(P.manifest) ? readJson(P.manifest) : {};
    let failed = 0;
    names.forEach(n => {
        try { manifest[n] = buildEntry(n); console.log(`ok   ${n}: ${manifest[n].tris.join('/')} tris, ${manifest[n].massKg.toFixed(2)} kg`); }
        catch (e) { failed++; console.error('FAIL ' + e.message); }
    });
    fs.writeFileSync(P.manifest, JSON.stringify(sortKeys(manifest), null, 2) + '\n');
    return failed ? 1 : 0;
}

module.exports = { recipeHash, budgetFor, buildEntry, stable, P, DEFAULT_BUDGET };
if (require.main === module) process.exit(main(process.argv.slice(2)));
