// LLF-91: core hook bus (src/core/hooks.js) — bus behaviour + one emit per core event.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
try {
    // bus behaviour
    delete require.cache[require.resolve('../src/core/hooks.js')];
    const H = require('../src/core/hooks.js');
    const seen = [];
    const a = H.on('frame', (dt, now) => { seen.push(['a', dt, now]); });
    H.on('frame', () => { throw new Error('boom'); });
    H.on('frame', () => { seen.push(['c']); });
    const origErr = console.error; let errs = 0; console.error = () => { errs++; };
    assert.strictEqual(H.emit('frame', 0.016, 5), false, 'nothing consumed');
    H.emit('frame', 0.016, 6);
    console.error = origErr;
    assert.strictEqual(seen.length, 4, 'throwing handler does not stop the others');
    assert.deepStrictEqual(seen[0], ['a', 0.016, 5], 'args passed through');
    assert.strictEqual(errs, 1, 'error logged once per handler');
    H.off('frame', a); seen.length = 0; console.error = () => {}; H.emit('frame'); console.error = origErr;
    assert.strictEqual(seen.length, 1, 'off removes the handler');
    H.on('keydown', () => undefined); H.on('keydown', e => e.key === 'Escape');
    assert.strictEqual(H.emit('keydown', { key: 'Escape' }), true, 'any true = consumed');
    assert.strictEqual(H.emit('keydown', { key: 'a' }), false);
    assert.strictEqual(H.emit('nobody'), false, 'unknown event is a no-op');

    // wiring: exactly one emit per event in the core files
    const html = read('index.html');
    const iEngine = html.indexOf('src/core/engine.js'), iHooks = html.indexOf('src/core/hooks.js');
    assert(iHooks > iEngine, 'hooks.js tag right after engine.js');
    const tags = [...html.matchAll(/<script\s+src="(src\/[^"]+)"/g)].map(m => m[1]);
    assert.strictEqual(tags[tags.indexOf('src/core/engine.js') + 1], 'src/core/hooks.js', 'hooks.js is the 2nd src tag');
    const core = ['src/core/engine.js', 'src/core/menu.js', 'src/core/scene_swap.js'].map(read).join('\n');
    const count = evt => (core.match(new RegExp("LLHooks\\.emit\\('" + evt + "'", 'g')) || []).length;
    for (const evt of ['frame', 'keydown', 'keyup', 'mousedown', 'mousemove', 'mouseup', 'letterKey', 'letterSpawned', 'typed', 'word', 'beforeSceneSwap', 'afterSceneBuild'])
        assert.strictEqual(count(evt), 1, 'exactly one emit for ' + evt + ' (got ' + count(evt) + ')');
    assert(/frame', 0\.016, Date\.now\(\)\);[^\n]*\n\s*qualityRender\(\)/.test(read('src/core/engine.js')), 'frame emitted just before render');
    assert(/!pb\.hookDriven/.test(read('src/core/engine.js')), 'hook-driven bodies skip wander');
    assert(fs.existsSync(path.join(ROOT, 'docs/HOOKS.md')), 'docs/HOOKS.md');
    console.log('LLF-91 hook bus tests passed.');
} catch (err) { console.error('LLF-91 test failed:', err.message); process.exit(1); }
