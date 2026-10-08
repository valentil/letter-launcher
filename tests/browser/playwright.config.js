// LLF-68: Playwright config. Uses a preinstalled Chromium (/opt/pw-browsers) when present, else Playwright's own.
const fs = require('fs'), path = require('path');
function findChromium() {
  if (process.env.LL_CHROMIUM) return process.env.LL_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const c = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(c)) return c;
    }
  } catch (e) {}
  return undefined;
}
const executablePath = findChromium();
const launchOptions = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };
if (executablePath && !process.env.LL_DEFAULT_BROWSER) launchOptions.executablePath = executablePath;
module.exports = {
  testDir: __dirname,
  testMatch: /scenes\.spec\.js/,
  timeout: 300000,
  workers: 1,
  reporter: [['list']],
  use: { headless: true, launchOptions },
  projects: [
    { name: 'desktop', use: { viewport: { width: 800, height: 450 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' } },
  ],
};
module.exports.globalTeardown = require.resolve('./summary.js');
