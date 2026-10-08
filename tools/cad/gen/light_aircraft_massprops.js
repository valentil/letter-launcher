// LLF-81: exact volume + centroid for each light_aircraft part, from the recipe's own primitives
// (polygon-prism / box / cylinder / cone closed forms; the tailcone intersection is integrated in
// 0.5 mm slices). The NativeCAD session is shared with other lanes, so cad_mass_properties replies
// could not be pinned to this document; build_manifest.js cross-checks these numbers against the
// exported GLB mesh (3 % volume / 5 mm centroid), which is what catches a wrong figure.
const fs = require('fs'), path = require('path');
const { recipe } = require('./light_aircraft_gen.js');
const byAs = {}; recipe.ops.forEach(o => { if (o.as) byAs[o.as] = o; });
function poly(pts) {
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], c = x0 * y1 - x1 * y0;
        A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    A /= 2; return { A: Math.abs(A), cx: cx / (6 * A), cy: cy / (6 * A) };
}
function solid(as) {
    const o = byAs[as], a = o.args;
    if (o.tool === 'cad_box') return { V: a.dx * a.dy * a.dz, c: [a.origin[0] + a.dx / 2, a.origin[1] + a.dy / 2, a.origin[2] + a.dz / 2] };
    if (o.tool === 'cad_cylinder') {      // rotated +-90 deg about Y -> axis along +-X
        const s = a.rotate && a.rotate.ry < 0 ? -1 : 1;
        return { V: Math.PI * a.r * a.r * a.h, c: [a.origin[0] + s * a.h / 2, a.origin[1], a.origin[2]] };
    }
    if (o.tool === 'cad_cone')            // rx +90 deg -> apex toward -Y
        return { V: Math.PI * a.r * a.r * a.h / 3, c: [a.origin[0], a.origin[1] - a.h / 4, a.origin[2]] };
    if (o.tool === 'cad_extrude_profile') {
        const p = poly(a.outer), pl = a.plane, n = cross(pl.xAxis, pl.yAxis);
        const c = [0, 1, 2].map(k => pl.origin[k] + pl.xAxis[k] * p.cx + pl.yAxis[k] * p.cy + n[k] * a.depth / 2);
        return { V: p.A * a.depth, c };
    }
    if (o.tool === 'cad_boolean_intersect') {   // tailcone: planform trapezoid n side profile
        let V = 0, my = 0, mz = 0; const dy = 0.5;
        for (let y = 600 + dy / 2; y < 4400; y += dy) {
            const t = (y - 600) / 3800, w = 1100 - 860 * t, zb = 700 + 700 * t, zt = 1650, dv = w * (zt - zb) * dy;
            V += dv; my += y * dv; mz += (zb + zt) / 2 * dv;
        }
        return { V, c: [0, my / V, mz / V] };
    }
    throw new Error('no closed form for ' + o.tool);
}
function cross(u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; }
const out = { _frame: 'kernel frame (mm, +Z up), unit density; closed-form from the recipe primitives (see tools/cad/gen/light_aircraft_massprops.js)' };
const byMat = {};
recipe.parts.forEach(p => {
    const s = solid(p.of.replace('.handle', ''));
    out[p.nodeName] = { volumeMm3: Math.round(s.V), centroidMm: s.c.map(v => Math.round(v * 100) / 100) };
    byMat[p.material] = (byMat[p.material] || 0) + s.V;
});
fs.writeFileSync(path.join(__dirname, '..', 'massprops', 'light_aircraft.json'), JSON.stringify(out, null, 2).replace(/\n/g, '\r\n') + '\r\n');
console.log(JSON.stringify(byMat));
