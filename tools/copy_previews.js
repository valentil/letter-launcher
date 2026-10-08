// LLF-88: copy browser smoke-suite screenshots (tests/browser/out/*.png) to assets/previews/.
// Level-select cards load assets/previews/<scene_slug>.png; missing files fall back to a coloured tile.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, 'tests', 'browser', 'out'), dst = path.join(root, 'assets', 'previews');
if (!fs.existsSync(src)) { console.log('no screenshots at ' + src + ' - cards use fallback tiles'); process.exit(0); }
fs.mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
    if (!/\.png$/i.test(f)) continue;
    fs.copyFileSync(path.join(src, f), path.join(dst, f.toLowerCase().replace(/[^a-z0-9.]+/g, '_')));
    n++;
}
console.log('copied ' + n + ' preview(s) to assets/previews/');
