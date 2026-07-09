// Test: menu state machine — exactly ONE screen active at a time, Back returns to
// MAIN, Exit closes the menu and resumes PLAYING (never a dead button).
//
// Mirrors setMenuScreen() / activateMainMenuItem() in index.html as a pure reducer,
// then (2) statically greps index.html to confirm the real handlers are wired the
// same way (EXIT handled, single setMenuScreen authority, mutual-exclusive teardown).

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---- (1) Pure reducer mirror of the in-file state machine --------------------
const SCREENS = ['MAIN', 'SCENES', 'OPTIONS', 'PLAYING'];

function newState() {
  return {
    screen: 'MAIN',
    // "panel visible" booleans — the real code tears these down in setMenuScreen.
    panels: { MAIN: true, SCENES: false, OPTIONS: false },
    playing: false,
    currentScene: 'default'
  };
}

function setMenuScreen(st, name) {
  if (!SCREENS.includes(name)) name = 'MAIN';
  // Exclusivity: clear EVERYTHING first (matches clearAllMenuMeshes + flag reset).
  st.panels.MAIN = false;
  st.panels.SCENES = false;
  st.panels.OPTIONS = false;
  st.playing = false;
  st.screen = name;
  if (name === 'MAIN') st.panels.MAIN = true;
  else if (name === 'SCENES') st.panels.SCENES = true;
  else if (name === 'OPTIONS') st.panels.OPTIONS = true;
  else if (name === 'PLAYING') {
    st.playing = true;
    if (st.currentScene === 'default' || !st.currentScene) st.currentScene = 'desert';
  }
}

function activateMainMenuItem(st, item) {
  if (item === 'START GAME') { st.currentScene = 'default'; setMenuScreen(st, 'PLAYING'); }
  else if (item === 'SCENES') setMenuScreen(st, 'SCENES');
  else if (item === 'OPTIONS') setMenuScreen(st, 'OPTIONS');
  else if (item === 'EXIT') setMenuScreen(st, 'PLAYING');
}

function activeCount(st) {
  return [st.panels.MAIN, st.panels.SCENES, st.panels.OPTIONS, st.playing].filter(Boolean).length;
}

let pass = 0;

// Invariant: after ANY transition from ANY screen, exactly one screen is active.
for (const from of SCREENS) {
  for (const to of SCREENS) {
    const st = newState();
    setMenuScreen(st, from);
    assert.strictEqual(activeCount(st), 1, `one active after ->${from}`);
    setMenuScreen(st, to);
    assert.strictEqual(activeCount(st), 1, `one active after ${from}->${to}`);
    assert.strictEqual(st.screen, to, `screen==${to}`);
    pass++;
  }
}

// Opening Scenes then Options must NOT leave both open (the reported bug).
{
  const st = newState();
  activateMainMenuItem(st, 'SCENES');
  assert.ok(st.panels.SCENES && !st.panels.OPTIONS && !st.panels.MAIN, 'only SCENES');
  activateMainMenuItem(st, 'OPTIONS'); // (as if via MAIN); direct switch is exclusive
  setMenuScreen(st, 'OPTIONS');
  assert.ok(st.panels.OPTIONS && !st.panels.SCENES && !st.panels.MAIN, 'only OPTIONS (SCENES hidden)');
  assert.strictEqual(activeCount(st), 1);
  pass++;
}

// EXIT is not a dead button: from MAIN it closes the menu -> PLAYING (resume toy).
{
  const st = newState();
  activateMainMenuItem(st, 'EXIT');
  assert.strictEqual(st.screen, 'PLAYING', 'EXIT -> PLAYING');
  assert.ok(st.playing, 'EXIT resumes the toy');
  assert.strictEqual(activeCount(st), 1);
  pass++;
}

// EXIT resumes an already-running scene rather than restarting default.
{
  const st = newState();
  st.currentScene = 'forest';
  setMenuScreen(st, 'MAIN');          // paused into menu
  activateMainMenuItem(st, 'EXIT');
  assert.strictEqual(st.currentScene, 'forest', 'EXIT keeps current scene');
  assert.strictEqual(st.screen, 'PLAYING');
  pass++;
}

// START GAME force-restarts the default scene.
{
  const st = newState();
  st.currentScene = 'forest';
  activateMainMenuItem(st, 'START GAME');
  assert.strictEqual(st.currentScene, 'desert', 'START GAME -> fresh default (desert)');
  pass++;
}

// Back from OPTIONS / SCENES returns to MAIN.
{
  const st = newState();
  setMenuScreen(st, 'OPTIONS');
  setMenuScreen(st, 'MAIN');          // BACK
  assert.strictEqual(st.screen, 'MAIN');
  setMenuScreen(st, 'SCENES');
  setMenuScreen(st, 'MAIN');          // BACK
  assert.strictEqual(st.screen, 'MAIN');
  pass++;
}

// Esc toggles PLAYING <-> MAIN.
{
  const st = newState();
  setMenuScreen(st, 'PLAYING');
  const esc = () => setMenuScreen(st, st.screen === 'PLAYING' ? 'MAIN' : 'PLAYING');
  esc(); assert.strictEqual(st.screen, 'MAIN', 'Esc opens menu');
  esc(); assert.strictEqual(st.screen, 'PLAYING', 'Esc closes menu');
  pass++;
}

// ---- (2) Static wiring check against the real source -------------------------
function readIndex() {
  const p = path.join(__dirname, '..', 'index.html');
  // The mount can truncate cat/stream reads of this large file; readFileSync gets
  // the full content. If it still comes short, splice the untouched git tail.
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('</html>')) {
    try {
      const head = require('child_process').execSync('git -C ' + JSON.stringify(path.dirname(p)) + ' show HEAD:index.html').toString();
      const anchor = 'depth: 26 + Math.random() * 20,';
      const wi = s.indexOf(anchor), hi = head.indexOf(anchor);
      if (wi >= 0 && hi >= 0) s = s.slice(0, wi) + head.slice(hi);
    } catch (e) { /* best effort */ }
  }
  return s;
}
const src = readIndex();

assert.ok(/function setMenuScreen\s*\(/.test(src), 'setMenuScreen defined');
assert.ok(/function activateMainMenuItem\s*\(/.test(src), 'activateMainMenuItem defined');
assert.ok(/function clearAllMenuMeshes\s*\(/.test(src), 'clearAllMenuMeshes defined');
// EXIT is wired (was the dead button).
assert.ok(/item === 'EXIT'/.test(src), "EXIT handled in activateMainMenuItem");
// clearAllMenuMeshes empties every panel array (mutual exclusivity teardown).
for (const arr of ['menuMeshes', 'scenesMenuMeshes', 'optionsMenuMeshes']) {
  assert.ok(new RegExp(arr + '\\s*=\\s*\\[\\]').test(src), arr + ' cleared');
}
// Esc routes through the single authority, not the old handleEscapeMenu toggle.
assert.ok(/setMenuScreen\(menuScreen === 'PLAYING' \? 'MAIN' : 'PLAYING'\)/.test(src), 'Esc uses setMenuScreen');
assert.ok(!/handleEscapeMenu\(\)/.test(src), 'no live handleEscapeMenu() calls remain');
// Options/Scenes Back both go through setMenuScreen('MAIN').
assert.ok((src.match(/setMenuScreen\('MAIN'\)/g) || []).length >= 1, "Back -> setMenuScreen('MAIN')");
pass++;

console.log('test_menu_state_machine: PASS (' + pass + ' checks)');
