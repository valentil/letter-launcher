#!/usr/bin/env node
/*
 * tools/cad/check_manifest.js — release gate for the CAD asset pipeline (LLF-69).
 *
 *   node tools/cad/check_manifest.js        # exit 0 = every asset is consistent
 *
 * For every assets/cad/manifest.json entry:
 *   - the GLB exists, has a valid glTF 2.0 binary header, and its triangle counts match tris[]
 *   - LOD0 triangles <= the recipe budget (recipe.budget.lod0Tris, else 20k hero / 3k prop)
 *   - tools/cad/recipes/<name>.json exists and its hash equals recipeHash (recipe edited after
 *     the export => re-run it and rebuild the manifest)
 *   - LOD triangle counts never rise level over level; every recipe part is a node in the GLB
 *   - massKg > 0, bboxM/comM/inertia present, sources[] non-empty
 * and every recipe has a manifest entry (a recipe nobody ran is a failure, not a warning).
 * Plain Node, no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const glb = require('./glb');
const { recipeHash, budgetFor, P } = require('./build_manifest');

function check() {
    const errors = [], notes = [];
    if (!fs.existsSync(P.manifest)) return { errors: ['assets/cad/manifest.json is missing'], notes };
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(P.manifest, 'utf8')); } catch (e) { return { errors: ['manifest.json is not valid JSON: ' + e.message], notes }; }

    Object.keys(manifest).forEach(name => {
        const e = manifest[name], err = m => errors.push(`${name}: ${m}`);
        const file = path.join(path.dirname(P.manifest), e.file || '');
        if (!e.file || !fs.existsSync(file)) return err(`file ${e.file} not found in assets/cad/`);
        let g;
        try { g = glb.readGlb(fs.readFileSync(file)); } catch (x) { return err('bad GLB: ' + x.message); }
        const tris = glb.trisPerLevel(g);
        if (JSON.stringify(tris) !== JSON.stringify(e.tris)) err(`manifest tris ${JSON.stringify(e.tris)} != GLB ${JSON.stringify(tris)} (rebuild the manifest)`);
        for (let i = 1; i < tris.length; i++) if (tris[i] > tris[i - 1]) err(`LOD${i} has more triangles than LOD${i - 1} (${tris[i]} > ${tris[i - 1]}); use a coarser tolerance ladder`);
        if (!fs.existsSync(P.recipe(name))) return err(`no recipe tools/cad/recipes/${name}.json`);
        const recipe = JSON.parse(fs.readFileSync(P.recipe(name), 'utf8'));
        const budget = budgetFor(recipe);
        if (tris[0] > budget) err(`LOD0 ${tris[0]} tris > budget ${budget}`);
        if (recipeHash(recipe) !== e.recipeHash) err(`recipeHash ${e.recipeHash} != recipe ${recipeHash(recipe)} (recipe changed since export: re-run it, then build_manifest)`);
        const nodes = new Set(glb.partNodes(g).map(p => p.name));
        (recipe.parts || []).forEach(p => { if (!nodes.has(p.nodeName)) err(`recipe part ${p.nodeName} is not a node in ${e.file}`); });
        if (!(e.massKg > 0)) err('massKg missing or not positive');
        if (!e.bboxM || !Array.isArray(e.comM) || !Array.isArray(e.inertia)) err('bboxM/comM/inertia missing');
        if (!Array.isArray(e.sources) || !e.sources.length) err('sources[] is empty: cite the spec sheets the dimensions came from');
        if (!e.preview || !fs.existsSync(path.join(path.dirname(P.manifest), e.preview))) notes.push(`${name}: no preview PNG`);
        if ((g.json.extensionsRequired || []).some(x => x !== 'KHR_mesh_quantization')) err('GLB requires an extension three r128 cannot decode: ' + g.json.extensionsRequired.join(','));
    });
    const recipesDir = path.join(path.dirname(P.recipe('x')));
    if (fs.existsSync(recipesDir)) fs.readdirSync(recipesDir).filter(f => f.endsWith('.json')).forEach(f => {
        const n = f.slice(0, -5);
        if (!manifest[n]) errors.push(`${n}: recipe has no manifest entry (run it through NativeCAD, then node tools/cad/build_manifest.js ${n})`);
    });
    return { errors, notes, count: Object.keys(manifest).length };
}

module.exports = { check };
if (require.main === module) {
    const r = check();
    r.notes.forEach(n => console.log('note ' + n));
    r.errors.forEach(e => console.error('FAIL ' + e));
    if (r.errors.length) { console.error(`check_manifest: ${r.errors.length} problem(s)`); process.exit(1); }
    console.log(`check_manifest: ${r.count} asset(s) OK`);
}
