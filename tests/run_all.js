// LLF-67: `npm test` runner — the same loop as
//   for f in tests/test_*.js; do node $f || exit 1; done
// written in node so it also works under Windows cmd.exe (npm's default script shell there).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname).filter(f => /^test_.*\.js$/.test(f)).sort();
for (const f of files) {
    const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
    if (r.status !== 0) {
        console.error(`\nFAILED: tests/${f} (exit ${r.status})`);
        process.exit(1);
    }
}
console.log(`\nAll ${files.length} test files passed.`);
