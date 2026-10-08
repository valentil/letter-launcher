// LLF-90: budgets.json is complete and check_budgets.js fails on a doubled-draw-call summary.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { check } = require('./browser/check_budgets.js');

let fails = 0;
function ok(c, m) { if (!c) { fails++; console.error('FAIL: ' + m); } }

const budgets = JSON.parse(fs.readFileSync(path.join(__dirname, 'browser', 'budgets.json'), 'utf8'));
const names = Object.keys(budgets.scenes);
ok(names.length >= 1, 'budgets.json has scenes');
for (const n of names) {
    const b = budgets.scenes[n];
    ok(b.maxCalls > 0 && b.maxTris > 0 && b.maxMedianMs > 0, n + ' has numeric maxCalls/maxTris/maxMedianMs');
}
// summary at exactly 80% of budget passes; 2x calls fails
const good = names.map(n => ({ project: 'desktop', scene: n, calls: Math.floor(budgets.scenes[n].maxCalls / 1.25), tris: Math.floor(budgets.scenes[n].maxTris / 1.25), medianMs: 100 }));
ok(check(good, budgets).problems.length === 0, 'baseline-level summary passes');
const bad = good.map((r, i) => i === 0 ? { ...r, calls: r.calls * 2 } : r);
const res = check(bad, budgets);
ok(res.problems.length === 1 && /draw calls/.test(res.problems[0]), 'doubled draw calls in one scene is flagged');
// CLI exit codes
const tmp = path.join(require('os').tmpdir(), 'llf90_summary_' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(bad));
ok(spawnSync(process.execPath, [path.join(__dirname, 'browser', 'check_budgets.js'), tmp], { stdio: 'pipe' }).status === 1, 'CLI exits 1 on breach');
fs.writeFileSync(tmp, JSON.stringify(good));
ok(spawnSync(process.execPath, [path.join(__dirname, 'browser', 'check_budgets.js'), tmp], { stdio: 'pipe' }).status === 0, 'CLI exits 0 within budget');
fs.unlinkSync(tmp);
if (fails) process.exit(1);
console.log('test_llf90_perf_gates: ok');
