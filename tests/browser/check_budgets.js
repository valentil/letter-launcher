// LLF-90: per-scene perf budget gate. Reads the browser suite's summary JSON
// (tests/browser/out/summary.json: array of {project, scene, medianMs, calls, tris}, or a
// baseline.json-style {scenes:[...]}) and fails when a scene exceeds tests/browser/budgets.json.
// Usage: node tests/browser/check_budgets.js [summary.json] [budgets.json]
// Missing summary => skipped (exit 0) since the browser suite is slow and runs in CI only.
const fs = require('fs');
const path = require('path');

function check(rows, budgets) {
    const problems = [];
    const seen = new Set();
    for (const r of rows) {
        if (r.project && r.project !== 'desktop') continue;
        const b = budgets.scenes[r.scene];
        if (!b) { problems.push(`${r.scene}: no budget entry in budgets.json`); continue; }
        seen.add(r.scene);
        if (r.calls > b.maxCalls) problems.push(`${r.scene}: draw calls ${r.calls} > budget ${b.maxCalls}`);
        if (r.tris > b.maxTris) problems.push(`${r.scene}: triangles ${r.tris} > budget ${b.maxTris}`);
        if (b.maxMedianMs && r.medianMs > b.maxMedianMs) problems.push(`${r.scene}: median ${r.medianMs} ms > budget ${b.maxMedianMs} ms`);
    }
    return { problems, seen };
}

function load(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

if (require.main === module) {
    const sumPath = process.argv[2] || path.join(__dirname, 'out', 'summary.json');
    const budPath = process.argv[3] || path.join(__dirname, 'budgets.json');
    if (!fs.existsSync(sumPath)) { console.log(`check_budgets: no summary at ${sumPath} (browser suite not run) - skipped`); process.exit(0); }
    const sum = load(sumPath);
    const rows = Array.isArray(sum) ? sum : sum.scenes;
    const { problems, seen } = check(rows, load(budPath));
    if (problems.length) { console.error('PERF BUDGET BREACH:\n  ' + problems.join('\n  ')); process.exit(1); }
    console.log(`check_budgets: ${seen.size} scenes within budget`);
}
module.exports = { check };
