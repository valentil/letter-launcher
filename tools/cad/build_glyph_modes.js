// LLF-71: builds assets/cad/glyph_modes.json from tools/cad/modal_steel.json (the free-free steel
// modes of the 36 glyph solids, written by tools/cad/glyph_modal.py) and the material table below.
//   node tools/cad/build_glyph_modes.js
// A geometrically identical free body has frequencies f ~ sqrt(E / rho) (mode shapes depend only on
// geometry and Poisson's ratio), so each material's modes are the steel modes times
// sqrt((E/rho) / (E_steel/rho_steel)). Poisson's ratio differences (0.30-0.40) are second order.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const MATERIALS = {
    steel:     { label: 'steel',                 E: 200e9,  rho: 7850, damping: 0.001,  source: 'AISI steel E=200 GPa, rho=7850 (cad_modal preset "steel")' },
    aluminium: { label: 'aluminium 6061-T6',     E: 68.9e9, rho: 2700, damping: 0.002,  source: 'ASM 6061-T6: E=68.9 GPa, rho=2.70 g/cc' },
    brass:     { label: 'brass C360',            E: 97e9,   rho: 8500, damping: 0.0015, source: 'C36000 free-cutting brass: E=97 GPa, rho=8.50 g/cc' },
    wood:      { label: 'wood (custom)',         E: 11e9,   rho: 600,  damping: 0.02,   source: 'ticket spec: E=11 GPa, rho=600 kg/m3 (along-grain softwood/hardwood mix)' },
    abs:       { label: 'ABS',                   E: 2.3e9,  rho: 1050, damping: 0.03,   source: 'ABS E=2.3 GPa, rho=1050 (cad_modal preset "abs" class)' },
};
const steel = fs.readFileSync(path.join(__dirname, 'modal_steel.json'), 'utf8');
const base = JSON.parse(steel);
const out = {
    _comment: 'LLF-71 modal data for the 36 glyph solids at cap height 1 m: first 6 elastic free-free modes per material, {f: Hz, damping: modal damping ratio}. ' +
        'Steel modes were solved with tools/cad/glyph_modal.py (C3D10 quadratic tets, free-free, 4 layers x 0.06 m, converged to 0.3% vs a 0.04 m mesh, bar self-test within 1% of Euler-Bernoulli) because the shared NativeCAD cad_modal had no FEA solver installed (capability_missing "fea"). ' +
        'Other materials are the steel modes scaled by sqrt((E/rho)/(E_steel/rho_steel)) (free-body frequencies scale with the material wave speed). ' +
        'Runtime scales every frequency by 1/size (f ~ 1/L). Regenerate: python3 tools/cad/glyph_modal.py && node tools/cad/build_glyph_modes.js',
    _materials: {},
};
const cs = Math.sqrt(MATERIALS.steel.E / MATERIALS.steel.rho);
for (const [k, m] of Object.entries(MATERIALS)) {
    out._materials[k] = { label: m.label, youngsModulusPa: m.E, densityKgM3: m.rho, damping: m.damping, speedScaleVsSteel: +(Math.sqrt(m.E / m.rho) / cs).toFixed(4), source: m.source };
}
for (const ch of Object.keys(base)) {
    out[ch] = {};
    for (const [k, m] of Object.entries(MATERIALS)) {
        const s = Math.sqrt(m.E / m.rho) / cs;
        out[ch][k] = base[ch].map(f => ({ f: +(f * s).toFixed(1), damping: m.damping }));
    }
}
fs.writeFileSync(path.join(ROOT, 'assets', 'cad', 'glyph_modes.json'), JSON.stringify(out) + '\n');
console.log('wrote assets/cad/glyph_modes.json for ' + Object.keys(base).length + ' glyphs');
