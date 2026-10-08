#!/usr/bin/env node
/*
 * tools/cad/glb_merge.js - join several NativeCAD GLB exports into one file (LLF-70).
 *
 *   node tools/cad/glb_merge.js assets/cad/glyphs.glb assets/cad/glyphs_part0.glb ... [--rm]
 *
 * Why: the NativeCAD MCP session is shared by every lane and other lanes reset it, so the 36-glyph
 * recipe runs as 9 short self-contained batches, each exporting its own GLB. This stitches them:
 * every input's scene roots (the exporter's mm->m / Z-up->Y-up root node) become roots of one scene;
 * nodes, meshes, accessors, bufferViews and the binary chunk are concatenated with their indices
 * shifted (MSFT_lod ids included); materials are shared by name. --rm deletes the inputs after.
 * Plain Node, no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const glb = require('./glb');

function merge(parts) {
    const out = { asset: Object.assign({}, parts[0].json.asset, { generator: (parts[0].json.asset.generator || 'NativeCAD') + ' + tools/cad/glb_merge.js' }),
        scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
    const used = new Set(), required = new Set(), matByName = {}, bins = [];
    let binLen = 0;
    parts.forEach(({ json, bin }) => {
        const nOff = out.nodes.length, mOff = out.meshes.length, aOff = out.accessors.length, vOff = out.bufferViews.length;
        const pad = (4 - (binLen % 4)) % 4;
        if (pad) { bins.push(Buffer.alloc(pad)); binLen += pad; }
        const bOff = binLen;
        bins.push(bin); binLen += bin.length;
        (json.extensionsUsed || []).forEach(e => used.add(e));
        (json.extensionsRequired || []).forEach(e => required.add(e));
        const matMap = (json.materials || []).map(m => {
            if (matByName[m.name] === undefined) { matByName[m.name] = out.materials.length; out.materials.push(m); }
            return matByName[m.name];
        });
        (json.bufferViews || []).forEach(v => out.bufferViews.push(Object.assign({}, v, { buffer: 0, byteOffset: (v.byteOffset || 0) + bOff })));
        (json.accessors || []).forEach(a => {
            if (a.sparse) throw new Error('sparse accessors are not supported');
            out.accessors.push(Object.assign({}, a, a.bufferView !== undefined ? { bufferView: a.bufferView + vOff } : {}));
        });
        (json.meshes || []).forEach(m => out.meshes.push(Object.assign({}, m, { primitives: m.primitives.map(p => {
            const q = Object.assign({}, p, { attributes: {} });
            Object.keys(p.attributes).forEach(k => { q.attributes[k] = p.attributes[k] + aOff; });
            if (p.indices !== undefined) q.indices = p.indices + aOff;
            if (p.material !== undefined) q.material = matMap[p.material];
            if (p.targets) throw new Error('morph targets are not supported');
            return q;
        }) })));
        (json.nodes || []).forEach(n => {
            const q = Object.assign({}, n);
            if (n.mesh !== undefined) q.mesh = n.mesh + mOff;
            if (n.children) q.children = n.children.map(c => c + nOff);
            if (n.extensions && n.extensions.MSFT_lod) q.extensions = Object.assign({}, n.extensions, { MSFT_lod: Object.assign({}, n.extensions.MSFT_lod, { ids: n.extensions.MSFT_lod.ids.map(i => i + nOff) }) });
            out.nodes.push(q);
        });
        const sc = json.scenes[json.scene || 0];
        sc.nodes.forEach(r => out.scenes[0].nodes.push(r + nOff));
    });
    if (used.size) out.extensionsUsed = Array.from(used);
    if (required.size) out.extensionsRequired = Array.from(required);
    const bin = Buffer.concat(bins.concat([Buffer.alloc((4 - (binLen % 4)) % 4)]));
    out.buffers = [{ byteLength: bin.length }];
    return write(out, bin);
}

function write(json, bin) {
    let js = Buffer.from(JSON.stringify(json), 'utf8');
    js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
    const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
    head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
    jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
    bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
    return Buffer.concat([head, jh, js, bh, bin]);
}

module.exports = { merge };
if (require.main === module) {
    const args = process.argv.slice(2), rm = args.includes('--rm'), files = args.filter(a => a !== '--rm');
    if (files.length < 2) { console.error('usage: node tools/cad/glb_merge.js <out.glb> <in.glb>... [--rm]'); process.exit(2); }
    const [outFile, ...ins] = files;
    const buf = merge(ins.map(f => glb.readGlb(fs.readFileSync(f))));
    fs.writeFileSync(outFile, buf);
    const s = glb.summary(glb.readGlb(buf));
    console.log(`${path.basename(outFile)}: ${s.parts.length} parts, tris ${s.tris.join('/')}, ${buf.length} bytes`);
    if (rm) ins.forEach(f => { try { fs.unlinkSync(f); } catch (e) { console.warn('could not delete ' + f + ': ' + e.message); } });
}
