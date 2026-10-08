#!/usr/bin/env node
/*
 * tools/cad/glb.js — tiny dependency-free GLB reader for the CAD asset pipeline (LLF-69).
 *
 * Reads what NativeCAD's cad_export_body(format:"glb") writes: a glTF 2.0 binary with
 * KHR_mesh_quantization (positions stored as SHORT, dequantised by the node scale) and an
 * MSFT_lod chain hanging off each part node. Used by build_manifest.js and check_manifest.js.
 *
 *   node tools/cad/glb.js assets/cad/street_lamp.glb      # prints a JSON summary
 *
 * Library:
 *   const glb = require('./glb');
 *   const g = glb.readGlb(buffer)           // {json, bin}  (throws on a bad header)
 *   glb.summary(g) -> {parts:[name], tris:[lod0, lod1, ...], bboxM:{min,max,size}}
 *   glb.partMeshes(g, level) -> [{name, positions:Float64Array (world, metres, Y-up), indices, materials:[name]}]
 *   glb.meshIntegrals(positions, indices) -> {volume, firstMoment:[x,y,z], second:[[...]]}
 *
 * Everything returned is in the glTF world frame: metres, +Y up (the exporter's root node
 * carries the mm->m scale and the Z-up->Y-up rotation; we apply it).
 */
'use strict';
const fs = require('fs');

const COMPONENT = {
    5120: { size: 1, read: 'readInt8', max: 127 },
    5121: { size: 1, read: 'readUInt8', max: 255 },
    5122: { size: 2, read: 'readInt16LE', max: 32767 },
    5123: { size: 2, read: 'readUInt16LE', max: 65535 },
    5125: { size: 4, read: 'readUInt32LE', max: 4294967295 },
    5126: { size: 4, read: 'readFloatLE', max: 1 },
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readGlb(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 20) throw new Error('GLB too short');
    if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('bad GLB magic (not "glTF")');
    const version = buf.readUInt32LE(4);
    if (version !== 2) throw new Error('unsupported GLB version ' + version);
    const length = buf.readUInt32LE(8);
    if (length !== buf.length) throw new Error(`GLB header length ${length} != file size ${buf.length}`);
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.length) {
        const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off + 4);
        const chunk = buf.slice(off + 8, off + 8 + clen);
        if (ctype === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8'));
        else if (ctype === 0x004E4942) bin = chunk;
        off += 8 + clen;
    }
    if (!json) throw new Error('GLB has no JSON chunk');
    if (!json.asset || json.asset.version !== '2.0') throw new Error('glTF asset.version is not 2.0');
    return { json, bin };
}

function readAccessor(g, idx) {
    const a = g.json.accessors[idx];
    const n = NCOMP[a.type], c = COMPONENT[a.componentType];
    const out = new Float64Array(a.count * n);
    if (a.bufferView === undefined) return out;
    const bv = g.json.bufferViews[a.bufferView];
    const stride = bv.byteStride || n * c.size;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    for (let i = 0; i < a.count; i++) {
        for (let k = 0; k < n; k++) {
            let v = g.bin[c.read](base + i * stride + k * c.size);
            if (a.normalized) v = Math.max(v / c.max, -1);
            out[i * n + k] = v;
        }
    }
    return out;
}

// --- 4x4 column-major matrices (glTF convention) ---
function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
    }
    return o;
}
function nodeMatrix(node) {
    if (node.matrix) return node.matrix.slice();
    const t = node.translation || [0, 0, 0], q = node.rotation || [0, 0, 0, 1], s = node.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const r = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1];
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) r[c * 4 + k] *= s[c];
    r[12] = t[0]; r[13] = t[1]; r[14] = t[2];
    return r;
}
function apply(m, x, y, z) {
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

// World matrix of every node reachable from the scene, plus parent world matrix lookup.
function walkScene(g) {
    const nodes = g.json.nodes || [];
    const world = {}, parentWorld = {};
    const sceneIdx = g.json.scene || 0;
    const roots = (g.json.scenes && g.json.scenes[sceneIdx]) ? g.json.scenes[sceneIdx].nodes : [];
    (function visit(list, pm) {
        (list || []).forEach(i => {
            parentWorld[i] = pm;
            world[i] = mul(pm, nodeMatrix(nodes[i]));
            visit(nodes[i].children, world[i]);
        });
    })(roots, identity());
    return { world, parentWorld };
}

// Part nodes = scene nodes that carry a mesh (the LOD0 bodies). Each may name lower levels
// through extensions.MSFT_lod.ids (finest first); those nodes are NOT in the scene graph and
// inherit the LOD0 node's parent transform.
function partNodes(g) {
    const { world, parentWorld } = walkScene(g);
    const nodes = g.json.nodes || [];
    return Object.keys(world).map(Number).filter(i => nodes[i].mesh !== undefined).map(i => ({
        index: i,
        name: nodes[i].name || ('node' + i),
        lodIds: (nodes[i].extensions && nodes[i].extensions.MSFT_lod && nodes[i].extensions.MSFT_lod.ids) || [],
        world: world[i],
        parentWorld: parentWorld[i],
    }));
}

function lodLevelCount(g) {
    return 1 + Math.max(0, ...partNodes(g).map(p => p.lodIds.length));
}

function meshTriangles(g, meshIdx) {
    let t = 0;
    g.json.meshes[meshIdx].primitives.forEach(p => {
        const mode = p.mode === undefined ? 4 : p.mode;
        if (mode !== 4) return;
        const cnt = p.indices !== undefined ? g.json.accessors[p.indices].count : g.json.accessors[p.attributes.POSITION].count;
        t += cnt / 3;
    });
    return t;
}

// The node used for `part` at `level` (falls back to the coarsest level it has).
function levelNode(p, level) {
    if (level === 0 || !p.lodIds.length) return { index: p.index, matrix: p.world };
    const id = p.lodIds[Math.min(level, p.lodIds.length) - 1];
    return { index: id, matrix: null };
}

function partMeshes(g, level) {
    level = level || 0;
    const nodes = g.json.nodes;
    return partNodes(g).map(p => {
        const ln = levelNode(p, level);
        const m = ln.matrix || mul(p.parentWorld, nodeMatrix(nodes[ln.index]));
        const pos = [], idx = [], mats = [];
        g.json.meshes[nodes[ln.index].mesh].primitives.forEach(pr => {
            if ((pr.mode === undefined ? 4 : pr.mode) !== 4) return;
            if (pr.material !== undefined && g.json.materials) mats.push(g.json.materials[pr.material].name || null);
            const P = readAccessor(g, pr.attributes.POSITION);
            const base = pos.length / 3;
            for (let i = 0; i < P.length; i += 3) pos.push(...apply(m, P[i], P[i + 1], P[i + 2]));
            if (pr.indices !== undefined) readAccessor(g, pr.indices).forEach(v => idx.push(v + base));
            else for (let i = 0; i < P.length / 3; i++) idx.push(base + i);
        });
        return { name: p.name, positions: Float64Array.from(pos), indices: idx, materials: mats };
    });
}

function trisPerLevel(g) {
    const nodes = g.json.nodes, parts = partNodes(g), L = lodLevelCount(g), out = [];
    for (let l = 0; l < L; l++) out.push(parts.reduce((s, p) => s + meshTriangles(g, nodes[levelNode(p, l).index].mesh), 0));
    return out;
}

// Signed-tetrahedron integrals of a closed triangle mesh (unit density):
//   volume, first moment  ∫x dV, second moment C = ∫ x xᵀ dV.
function meshIntegrals(P, I) {
    let V = 0; const F = [0, 0, 0]; const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let t = 0; t < I.length; t += 3) {
        const a = [P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]];
        const b = [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]];
        const c = [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]];
        const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        V += v;
        const s = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
        for (let i = 0; i < 3; i++) {
            F[i] += v * s[i] / 4;
            for (let j = 0; j < 3; j++) C[i][j] += v / 20 * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j] + s[i] * s[j]);
        }
    }
    return { volume: V, firstMoment: F, second: C };
}

function bbox(meshes) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    meshes.forEach(m => { for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], m.positions[i + k]); max[k] = Math.max(max[k], m.positions[i + k]);
    } });
    return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function summary(g) {
    const meshes = partMeshes(g, 0);
    return { parts: meshes.map(m => m.name), tris: trisPerLevel(g), bboxM: bbox(meshes),
        extensionsUsed: g.json.extensionsUsed || [], extensionsRequired: g.json.extensionsRequired || [] };
}

module.exports = { readGlb, readAccessor, partNodes, partMeshes, trisPerLevel, lodLevelCount, meshIntegrals, bbox, summary };

if (require.main === module) {
    const f = process.argv[2];
    if (!f) { console.error('usage: node tools/cad/glb.js <file.glb>'); process.exit(2); }
    console.log(JSON.stringify(summary(readGlb(fs.readFileSync(f))), null, 2));
}
