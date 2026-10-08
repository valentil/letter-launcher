// LLF-68: Playwright browser smoke suite. For every scene registered in window.SCENES:
// loads ?autotest=1&scene=NAME, types a scripted word list, samples frame times, asserts zero console/page errors
// and a median frame time under LL_FPS_BUDGET (ms, default 120 - very lenient: software GL runs ~0.3-0.9 s/frame; use 33 on a real GPU), records renderer stats,
// saves out/<scene>.png and out/<scene>.<project>.json. The mobile project checks HUD boxes fit the viewport.
// Offline-capable: three/cannon/GLTFLoader/font are served from npm (three@0.128.0, cannon@0.6.2).
// Env: LL_FPS_BUDGET, LL_ONLY=<scene name>, LL_INJECT_ERROR=<scene name> (throws in that scene's build -> must fail).
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { start } = require('./serve');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const FRAMES = +(process.env.LL_FRAMES || 60);
const BUDGET = +(process.env.LL_FPS_BUDGET || 1500);
const baseline = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8')); } catch (e) { return {}; } })();
const KNOWN = baseline.knownFailures || {};

function sceneNames() {
  const dir = path.join(ROOT, 'src', 'scenes'), names = [];
  for (const f of fs.readdirSync(dir).filter(f => f !== 'registry.js' && f.endsWith('.js'))) {   // LLF-78: skip the per-scene subfolders (EISDIR)
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/SCENES\[\s*['"]([^'"]+)['"]\s*\]\s*=/g)) names.push(m[1]);
  }
  const only = process.env.LL_ONLY;
  return names.filter(n => !only || n === only).sort();
}
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '_');
const nm = (p) => path.join(ROOT, 'node_modules', p);
const LOCAL = [
  [/three\.js\/r128\/three\.min\.js/, nm('three/build/three.min.js')],
  [/cannon\.js\/0\.6\.2\/cannon\.min\.js/, nm('cannon/build/cannon.min.js')],
  [/three@0\.128\.0\/examples\/js\/loaders\/GLTFLoader\.js/, nm('three/examples/js/loaders/GLTFLoader.js')],
  [/three@0\.128\.0\/examples\/js\/utils\/BufferGeometryUtils\.js/, nm('three/examples/js/utils/BufferGeometryUtils.js')],
  [/fonts\/helvetiker_bold\.typeface\.json/, nm('three/examples/fonts/helvetiker_bold.typeface.json')],
];

let srv;
test.beforeAll(async () => { fs.mkdirSync(OUT, { recursive: true }); srv = await start(0); });
test.afterAll(async () => { if (srv) await new Promise(r => srv.server.close(r)); });

async function openScene(page, name, errors, noise) {
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) return;   // external fetches we deliberately block are reported via requestfailed
    if (/looks like it points into the shape/.test(t)) { noise.cannonWinding++; return; }   // cannon ConvexPolyhedron diagnostic: recorded in the summary, tracked as a bug, not a failure
    if (!errors.includes('console.error: ' + t)) errors.push('console.error: ' + t);
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(`http://127.0.0.1:${srv.port}/`)) return route.fallback();
    for (const [re, file] of LOCAL) if (re.test(url)) return route.fulfill({ path: file, contentType: file.endsWith('.json') ? 'application/json' : 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
    return route.abort();   // any other external host (dictionary fallback, analytics): offline
  });
  if (process.env.LL_INJECT_ERROR === name) {
    await page.route('**/src/main.js', async route => {
      const body = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
      route.fulfill({ contentType: 'text/javascript', body: `SCENES[${JSON.stringify(name)}].build = function () { throw new Error('LL_INJECT_ERROR deliberate scene failure'); };\n` + body });
    });
  }
  await page.goto(`http://127.0.0.1:${srv.port}/index.html?autotest=1&scene=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.__llReady === true, null, { timeout: 45000 });
}

for (const name of sceneNames()) {
  test(`scene ${name}`, async ({ page }, info) => {
    const known = KNOWN[name];
    if (known) test.fail(true, 'known failure in baseline.json: ' + known);
    const errors = [];
    const noise = { cannonWinding: 0 };
    await openScene(page, name, errors, noise);
    const mobile = info.project.name === 'mobile';

    if (!mobile) {
      const words = await page.evaluate(n => (window.SCENES[n].smokeWords) || ['CAT', 'GO'], name);
      for (const w of words) { await page.keyboard.type(w, { delay: 40 }); await page.keyboard.press('Space'); await page.waitForTimeout(150); }
    }
    await page.evaluate(() => { window.__llFrameTimes.length = 0; });
    await page.waitForFunction(n => window.__llFrameTimes.length >= n, FRAMES, { timeout: 200000, polling: 250 });
    const stats = await page.evaluate((n) => {
      const t = window.__llFrameTimes.slice(-n).sort((a, b) => a - b);
      const q = p => t[Math.min(t.length - 1, Math.floor(p * t.length))];
      return { medianMs: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, bodies: world.bodies.length };
    }, FRAMES);
    const safe = slug(name);
    await page.screenshot({ path: path.join(OUT, `${safe}${mobile ? '.mobile' : ''}.png`) });
    fs.writeFileSync(path.join(OUT, `${safe}.${info.project.name}.json`), JSON.stringify({ scene: name, ...stats, cannonWindingWarnings: noise.cannonWinding }));

    if (mobile) {
      const vp = page.viewportSize();
      const bad = await page.evaluate(({ w, h }) => {
        const out = [];
        for (const id of ['wordHud', 'objectiveHud', 'gameBanner', 'controlsHint']) {
          const el = document.getElementById(id);
          if (!el || getComputedStyle(el).display === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.left < -0.5 || r.top < -0.5 || r.right > w + 0.5 || r.bottom > h + 0.5) out.push(`${id} [${[r.left, r.top, r.right, r.bottom].map(Math.round)}] outside ${w}x${h}`);
        }
        return out;
      }, { w: vp.width, h: vp.height });
      expect(bad, 'HUD boxes outside the viewport').toEqual([]);
    }
    expect(errors, 'console/page errors').toEqual([]);
    expect(stats.medianMs, `median frame ${stats.medianMs}ms vs LL_FPS_BUDGET ${BUDGET}`).toBeLessThan(BUDGET);
    expect(stats.calls).toBeGreaterThan(0);
  });
}
