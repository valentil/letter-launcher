// LLF-67: shared source reader for the static tests.
// The game used to live entirely in index.html; it is now split into classic
// <script src="src/..."> files. readAllSource() returns index.html followed by every
// src/**/*.js file concatenated in the order index.html loads them (any src file not
// referenced by a <script> tag is appended afterwards, sorted, so nothing is missed).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
    });
}

// Ordered list of src files (repo-relative, forward slashes) in load order.
function srcFiles() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const ordered = [...html.matchAll(/<script\s+src=["'](src\/[^"']+\.js)["']/g)].map(m => m[1]);
    const all = walk(path.join(ROOT, 'src'))
        .map(p => path.relative(ROOT, p).split(path.sep).join('/'))
        .sort();
    return ordered.concat(all.filter(f => !ordered.includes(f)));
}

function readAllSource() {
    const parts = [fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')];
    for (const f of srcFiles()) parts.push(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    return parts.join('\n');
}

module.exports = { readAllSource, srcFiles, ROOT };
