#!/usr/bin/env node
/*
 * tools/cad/manifest_store.js — the CAD asset manifest, one file per asset (LLF-104).
 *
 *   assets/cad/manifest.d/<name>.json   one asset's metadata (what build_manifest.js writes)
 *
 * There is deliberately NO shared index file: parallel lanes each add their own
 * manifest.d/<name>.json, so two branches that add different assets never touch the same file
 * and always merge cleanly. The directory listing IS the index.
 *
 *   const store = require('./manifest_store');
 *   store.names()          -> ['fire_hydrant', ...]  (sorted)
 *   store.read(name)       -> entry object or null
 *   store.readAll()        -> { name: entry, ... }   (sorted keys)
 *   store.write(name, e)   -> writes manifest.d/<name>.json (2-space JSON, CRLF like the rest of the repo)
 *   store.file(name)       -> absolute path of the per-asset file
 * Plain Node, no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CAD_DIR = path.join(ROOT, 'assets', 'cad');
const DIR = path.join(CAD_DIR, 'manifest.d');

function file(name) { return path.join(DIR, name + '.json'); }
function names() {
    if (!fs.existsSync(DIR)) return [];
    return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}
function read(name) {
    const f = file(name);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
function readAll() {
    const out = {};
    names().forEach(n => { out[n] = read(n); });
    return out;
}
function write(name, entry) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file(name), (JSON.stringify(entry, null, 2) + '\n').replace(/\n/g, '\r\n'));
}

module.exports = { ROOT, CAD_DIR, DIR, file, names, read, readAll, write };
