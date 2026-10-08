// LLF-89: static + unit checks for phone/touch play. Browser (Playwright mobile) tests are owed by LLF-68.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readAllSource, ROOT } = require('./_src');
let failures = 0;
function check(n, c, x) { if (c) console.log('PASS', n); else { failures++; console.error('FAIL', n, x || ''); } }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const src = fs.readFileSync(path.join(ROOT, 'src/core/touch.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
check('touch.js loaded before src/robot tags', html.indexOf('src/core/touch.js') > 0 && html.indexOf('src/core/touch.js') < html.indexOf('src/robot/'));
check('touch.js loaded before main.js', html.indexOf('src/core/touch.js') < html.indexOf('src/main.js'));
check('main.js inits TouchPlay in try/catch', /try\s*\{[^}]*TouchPlay\.init\(\)/.test(main));
check('hidden input autocapitalize=characters autocomplete=off', /autocapitalize', 'characters'/.test(src) && /autocomplete', 'off'/.test(src));
check('input font-size >= 16px (no iOS zoom)', /#kbCapture[^}]*font-size: 16px/.test(src));
check('floating keyboard button >= 44px', /#kbButton[^}]*min-height: 48px/.test(src));
check('HUD uses clamp()', (src.match(/clamp\(/g) || []).length >= 4);
check('objective box max-width 92vw', /#objectiveHud[^}]*92vw/.test(src));
check('safe-area insets used', /env\(safe-area-inset-bottom\)/.test(src) && /env\(safe-area-inset-top\)/.test(src));
check('quality guard present', /window\.Quality && Quality\.setTier/.test(src));
check('long-press -> right click, double tap -> middle click', /fire\(2, 'down'/.test(src) && /fire\(1, 'down'/.test(src));
check('composition handled', /compositionend/.test(src));

const ctx = {}; vm.createContext(ctx);
vm.runInContext(src + '\nthis.TP = TouchPlay; this.L = TOUCH_LIMITS;', ctx);
const TP = ctx.TP, L = ctx.L;
check('keysFromInput letters lowercased', JSON.stringify(TP.keysFromInput('insertText', 'AB')) === '["a","b"]');
check('keysFromInput backspace', TP.keysFromInput('deleteContentBackward', null)[0] === 'Backspace');
check('keysFromInput enter', TP.keysFromInput('insertLineBreak', null)[0] === 'Enter');
check('keysFromInput skips spaces', TP.keysFromInput('insertText', ' ').length === 0);
const o = { x: 0, y: 0, z: 0 };
TP.orbit(o, 5000, -5000, 400, 800);
check('orbit clamps to camera limits', o.x === L.x && o.y === L.y, JSON.stringify(o));
TP.pinch(o, 10, 1000); check('pinch zoom clamped min', o.z === L.zMin, o.z);
TP.pinch(o, 1000, 10); check('pinch zoom clamped max', o.z === L.zMax, o.z);
check('all-source still readable', readAllSource().includes('TouchPlay'));
if (failures) process.exit(1);
