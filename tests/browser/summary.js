// LLF-68: merges out/<scene>.<project>.json into out/summary.json; LL_WRITE_BASELINE=1 also writes baseline.json.
const fs = require('fs'), path = require('path');
module.exports = async () => {
  const out = path.join(__dirname, 'out');
  if (!fs.existsSync(out)) return;
  const rows = fs.readdirSync(out).filter(f => /\.(desktop|mobile)\.json$/.test(f)).sort()
    .map(f => ({ project: f.match(/\.(desktop|mobile)\.json$/)[1], ...JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) }));
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(rows, null, 1));
  if (process.env.LL_WRITE_BASELINE === '1') {
    const bp = path.join(__dirname, 'baseline.json');
    let known = {}; try { known = JSON.parse(fs.readFileSync(bp, 'utf8')).knownFailures || {}; } catch (e) {}
    fs.writeFileSync(bp, JSON.stringify({ note: 'Software-GL (swiftshader) numbers; use for relative comparison only.', knownFailures: known, scenes: rows.filter(r => r.project === 'desktop').map(({ project, ...r }) => r) }, null, 1) + '\n');
  }
};
