#!/usr/bin/env node
/*
 * tools/cad/rig_glb.js — turn a flat NativeCAD GLB into a jointed hierarchy (LLF-74).
 *
 *   node tools/cad/rig_glb.js robot_arm          # rewrites assets/cad/robot_arm.glb in place
 *
 * cad_export_body writes every part as a flat child of `nativecad-root`, whose rotation turns the
 * kernel's Z-up into glTF Y-up and whose scale turns mm into m. A part node's origin is its
 * quantisation centre, not a joint axis, so rotating it spins the part about the wrong point and
 * drags nothing downstream. This step reads recipe.rig.links (parent first, child after):
 *
 *   { node: "J2_upper_arm", pivotMm: [150, 0, 450], parts: ["upper_arm", "dress_pack"] }
 *
 * and rebuilds the node tree as  nativecad-root (identity) > J0_base > J1_... > ... > J6_..., one
 * empty pivot node per link placed ON its joint axis (glTF frame, metres, no rotation, so the
 * node-local axis equals the recipe/manifest joints[].axis), with that link's part meshes as
 * children. Each part node keeps its exact world placement: the root rotation and mm scale move
 * onto the part node (T R S), the translation becomes part-minus-pivot. MSFT_lod level nodes get
 * the same local transform as their LOD0 node, since lower levels inherit the LOD0 node's parent.
 * Pivot nodes carry extras {axis, joint:{type,axis,min,max}, jointName} from recipe.joints, which
 * three's GLTFLoader exposes as userData (RobotRig.bind reads userData.axis, AssetLib.joints reads
 * userData.joint). The BIN chunk is untouched. Running it twice is a no-op.
 * Plain Node, no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const glb = require('./glb');

const ROOT = path.join(__dirname, '..', '..');
// kernel frame (mm, Z up) -> glTF frame (m, Y up)
const toGltf = c => [c[0] / 1000, c[2] / 1000, -c[1] / 1000];

function quatRotate(q, v) {
    const [x, y, z, w] = q;
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const r9 = v => Math.round(v * 1e9) / 1e9;

function writeGlb(json, bin) {
    let js = Buffer.from(JSON.stringify(json), 'utf8');
    if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
    let b = bin || Buffer.alloc(0);
    if (b.length % 4) b = Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), 0)]);
    const total = 12 + 8 + js.length + (b.length ? 8 + b.length : 0);
    const out = Buffer.alloc(total);
    out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
    out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4E4F534A, 16); js.copy(out, 20);
    if (b.length) {
        const o = 20 + js.length;
        out.writeUInt32LE(b.length, o); out.writeUInt32LE(0x004E4942, o + 4); b.copy(out, o + 8);
    }
    return out;
}

function rig(name, opts) {
    opts = opts || {};
    const recipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'cad', 'recipes', name + '.json'), 'utf8'));
    if (!recipe.rig || !Array.isArray(recipe.rig.links) || !recipe.rig.links.length) throw new Error(name + ': recipe has no rig.links');
    const file = opts.file || path.join(ROOT, 'assets', 'cad', name + '.glb');
    const g = glb.readGlb(fs.readFileSync(file));
    const nodes = g.json.nodes;
    const links = recipe.rig.links;
    if (nodes.some(n => n.name === links[0].node)) return { name, changed: false, note: 'already rigged' };

    const rootIdx = nodes.findIndex(n => n.name === 'nativecad-root');
    if (rootIdx < 0) throw new Error(name + ': no nativecad-root node');
    const root = nodes[rootIdx];
    const R = root.rotation || [0, 0, 0, 1];
    const s = (root.scale || [1, 1, 1])[0];
    if (root.scale && (Math.abs(root.scale[1] - s) > 1e-12 || Math.abs(root.scale[2] - s) > 1e-12)) throw new Error('non-uniform root scale');

    const jointBy = {};
    (recipe.joints || []).forEach(j => { jointBy[j.node] = j; });
    const byName = {};
    nodes.forEach((n, i) => { if (n.name) byName[n.name] = i; });

    // Convert one part node (and its LOD level nodes) to be local to `pivot` (glTF metres).
    function reparent(partName, pivot) {
        const i = byName[partName];
        if (i === undefined) throw new Error(`${name}: part ${partName} not in GLB`);
        const ids = [i].concat((nodes[i].extensions && nodes[i].extensions.MSFT_lod && nodes[i].extensions.MSFT_lod.ids) || []);
        ids.forEach(k => {
            const n = nodes[k];
            const t = n.translation || [0, 0, 0], q = n.scale || [1, 1, 1];
            if (n.rotation && n.rotation.some((v, c) => Math.abs(v - [0, 0, 0, 1][c]) > 1e-12)) throw new Error(`${partName}: part node already rotated`);
            const w = quatRotate(R, [t[0] * s, t[1] * s, t[2] * s]);
            n.translation = [r9(w[0] - pivot[0]), r9(w[1] - pivot[1]), r9(w[2] - pivot[2])];
            n.rotation = R.slice();
            n.scale = [q[0] * s, q[1] * s, q[2] * s];
        });
        return i;
    }

    const used = new Set();
    let parentIdx = rootIdx, parentPivot = [0, 0, 0];
    const pivotIdx = [];
    links.forEach(L => {
        const pv = toGltf(L.pivotMm);
        const node = { name: L.node, translation: [r9(pv[0] - parentPivot[0]), r9(pv[1] - parentPivot[1]), r9(pv[2] - parentPivot[2])], children: [] };
        const j = jointBy[L.node];
        if (j) node.extras = { jointName: j.name || null, axis: j.axis, joint: { type: j.type || 'revolute', axis: j.axis, min: j.min, max: j.max } };
        L.parts.forEach(p => { node.children.push(reparent(p, pv)); used.add(p); });
        nodes.push(node);
        const idx = nodes.length - 1;
        pivotIdx.push(idx);
        if (parentIdx === rootIdx) parentIdx = null;
        else nodes[parentIdx].children.push(idx);
        parentIdx = idx; parentPivot = pv;
    });
    const leftover = (root.children || []).filter(c => !used.has(nodes[c].name));
    if (leftover.length) throw new Error(`${name}: parts not assigned to any rig link: ${leftover.map(c => nodes[c].name).join(', ')}`);
    root.children = [pivotIdx[0]];
    delete root.rotation; delete root.scale;
    fs.writeFileSync(file, writeGlb(g.json, g.bin));
    return { name, changed: true, links: links.map(l => l.node) };
}

module.exports = { rig, writeGlb, toGltf };
if (require.main === module) {
    const n = process.argv[2];
    if (!n) { console.error('usage: node tools/cad/rig_glb.js <name>'); process.exit(2); }
    try { console.log(JSON.stringify(rig(n))); } catch (e) { console.error('FAIL ' + e.message); process.exit(1); }
}
