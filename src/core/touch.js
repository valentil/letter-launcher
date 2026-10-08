// Letter Launcher — src/core/touch.js (LLF-89)
// Phone + touch play: hidden <input> that raises the on-screen keyboard and forwards typing into
// onKeyDown, a floating keyboard button, one-finger orbit / two-finger pinch zoom (clamped to the
// existing camera-offset limits), long-press = right-click rocket, double-tap = middle-click explode,
// and the responsive-HUD CSS. Classic script: top level only declares; TouchPlay.init() is called
// from src/main.js inside try/catch.

const TOUCH_LIMITS = { x: 2.0, y: 1.5, zMin: -6, zMax: 6 };   // x/y match onMouseMove's mouse*2.0 / mouse*1.5
const TOUCH_LONG_PRESS_MS = 450;
const TOUCH_DOUBLE_TAP_MS = 300;
const TOUCH_TAP_SLOP_PX = 10;

const TOUCH_CSS = `
#kbCapture { position: fixed; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0.01; border: 0; padding: 0;
  font-size: 16px; /* >=16px stops iOS zooming on focus */ background: transparent; color: transparent; caret-color: transparent; z-index: 1; }
#kbButton { display: none; position: fixed; right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom));
  min-width: 48px; min-height: 48px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.35); background: rgba(0,0,0,0.6);
  color: #fff; font-size: 22px; z-index: 400; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
body.touch-play #kbButton { display: block; }
body.touch-play canvas { touch-action: none; -webkit-user-select: none; user-select: none; }
#controlsHint { font-size: clamp(11px, 3.2vw, 13px); max-width: 92vw; bottom: max(14px, env(safe-area-inset-bottom)); }
#wordHud { font-size: clamp(16px, 5.5vw, 24px); letter-spacing: clamp(1px, 0.8vw, 4px); min-width: min(240px, 80vw); max-width: 92vw;
  box-sizing: border-box; white-space: normal; overflow-wrap: anywhere; bottom: calc(54px + env(safe-area-inset-bottom)); }
#objectiveHud { max-width: min(350px, 92vw); box-sizing: border-box; font-size: clamp(11px, 3.2vw, 13px);
  top: max(14px, env(safe-area-inset-top)); left: max(14px, env(safe-area-inset-left)); overflow-wrap: anywhere; }
#gameBanner { font-size: clamp(20px, 7vw, 34px); padding: 14px clamp(16px, 6vw, 46px); max-width: 92vw; box-sizing: border-box; }
@media (pointer: coarse) { #objectiveHud { max-height: 40vh; overflow: hidden; } }
`;

const TouchPlay = {
    state: { active: false, kbOpen: false, lastKeydown: 0, lastKeyWasReal: false, composing: false },
    clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
    // Convert a one-finger drag (px) into an orbit offset change, clamped to the existing limits.
    orbit(off, dxPx, dyPx, w, h) {
        off.x = TouchPlay.clamp(off.x + (dxPx / Math.max(1, w)) * 2 * TOUCH_LIMITS.x, -TOUCH_LIMITS.x, TOUCH_LIMITS.x);
        off.y = TouchPlay.clamp(off.y - (dyPx / Math.max(1, h)) * 2 * TOUCH_LIMITS.y, -TOUCH_LIMITS.y, TOUCH_LIMITS.y);
        return off;
    },
    // Pinch: spreading fingers (ratio > 1) moves the camera closer (negative z offset).
    pinch(off, prevDist, dist) {
        if (prevDist > 0 && dist > 0) off.z = TouchPlay.clamp(off.z - (dist - prevDist) * 0.03, TOUCH_LIMITS.zMin, TOUCH_LIMITS.zMax);
        return off;
    },
    // Characters (or Backspace/Enter) to forward for an <input> 'input' event.
    keysFromInput(inputType, data) {
        if (inputType === 'deleteContentBackward' || inputType === 'deleteWordBackward') return ['Backspace'];
        if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') return ['Enter'];
        return Array.from(data || '').filter(c => /\S/.test(c)).map(c => c.length === 1 ? c.toLowerCase() : c);
    },
    forwardKey(key) {
        try { onKeyDown({ key: key, code: '', preventDefault() {}, stopPropagation() {}, synthetic: true }); } catch (err) { console.log('touch key', err); }
    },
    focusKeyboard() {
        const el = document.getElementById('kbCapture');
        if (el) { el.value = ''; el.focus({ preventScroll: true }); TouchPlay.state.kbOpen = true; }
    },
    blurKeyboard() {
        const el = document.getElementById('kbCapture');
        if (el) el.blur();
        TouchPlay.state.kbOpen = false;
    },
    isCoarse() {
        try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window; } catch (e) { return false; }
    },
    init() {
        const st = TouchPlay.state;
        const style = document.createElement('style');
        style.id = 'touchPlayStyle';
        style.textContent = TOUCH_CSS;
        document.head.appendChild(style);

        const input = document.createElement('input');
        input.id = 'kbCapture';
        input.type = 'text';
        input.setAttribute('autocapitalize', 'characters');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('enterkeyhint', 'go');
        input.setAttribute('aria-label', 'Type letters');
        document.body.appendChild(input);

        // Real keydown on the input bubbles to window's onKeyDown already; remember it so the
        // matching 'input' event isn't typed twice. iOS soft keyboards often report 'Unidentified'/'Process'.
        input.addEventListener('keydown', (e) => {
            st.lastKeydown = Date.now();
            st.lastKeyWasReal = !!e.key && e.key !== 'Unidentified' && e.key !== 'Process' && e.key !== 'Dead';
        });
        input.addEventListener('compositionstart', () => { st.composing = true; });
        input.addEventListener('compositionend', (e) => {
            st.composing = false;
            TouchPlay.keysFromInput('insertText', e.data).forEach(TouchPlay.forwardKey);
            input.value = '';
        });
        input.addEventListener('input', (e) => {
            if (st.composing || e.isComposing) return;   // wait for compositionend
            const fresh = Date.now() - st.lastKeydown < 60;
            if (!(fresh && st.lastKeyWasReal)) {
                TouchPlay.keysFromInput(e.inputType, e.data).forEach(TouchPlay.forwardKey);
            }
            input.value = '';
        });
        input.addEventListener('blur', () => { st.kbOpen = false; });

        const btn = document.createElement('button');
        btn.id = 'kbButton';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Toggle keyboard');
        btn.textContent = '⌨';
        btn.addEventListener('click', (e) => { e.preventDefault(); st.kbOpen ? TouchPlay.blurKeyboard() : TouchPlay.focusKeyboard(); });
        document.body.appendChild(btn);

        if (!TouchPlay.isCoarse()) return;
        st.active = true;
        document.body.classList.add('touch-play');
        try { if (window.Quality && Quality.setTier) Quality.setTier('low'); } catch (e) { console.log('quality', e); }
        TouchPlay.bindGestures(btn);
    },
    bindGestures(btn) {
        const st = TouchPlay.state;
        let g = null, lastTapAt = 0, lastTapX = 0, lastTapY = 0, longTimer = 0;
        const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const fire = (button, kind, t) => {
            try {
                if (t) { mouse.x = (t.clientX / window.innerWidth) * 2 - 1; mouse.y = -(t.clientY / window.innerHeight) * 2 + 1; }
                (kind === 'down' ? onMouseDown : onMouseUp)({ button: button, clientX: t ? t.clientX : 0, clientY: t ? t.clientY : 0 });
            } catch (err) { console.log('touch fire', err); }
        };
        const off = () => cameraMouseOffset;

        document.addEventListener('touchstart', (e) => {
            if (e.target === btn || e.target.id === 'kbCapture') return;
            if (e.touches.length >= 2) {
                clearTimeout(longTimer);
                g = { mode: 'pinch', prev: dist(e.touches[0], e.touches[1]), consumed: true };
                e.preventDefault();
                return;
            }
            const t = e.touches[0];
            g = { mode: 'tap', x: t.clientX, y: t.clientY, px: t.clientX, py: t.clientY, consumed: false, longFired: false };
            clearTimeout(longTimer);
            longTimer = setTimeout(() => {
                if (g && g.mode === 'tap' && menuScreen === 'PLAYING') {
                    g.longFired = g.consumed = true;
                    fire(2, 'down', { clientX: g.x, clientY: g.y });
                }
            }, TOUCH_LONG_PRESS_MS);
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!g) return;
            if (g.mode === 'pinch' && e.touches.length >= 2) {
                const d = dist(e.touches[0], e.touches[1]);
                TouchPlay.pinch(off(), g.prev, d); g.prev = d;
                e.preventDefault(); return;
            }
            const t = e.touches[0];
            if (g.longFired) {                                   // dragging while rocket held = fuse path
                try { onMouseMove({ clientX: t.clientX, clientY: t.clientY }); } catch (err) {}
                e.preventDefault(); return;
            }
            if (g.mode === 'tap' && Math.hypot(t.clientX - g.x, t.clientY - g.y) > TOUCH_TAP_SLOP_PX) { g.mode = 'orbit'; g.consumed = true; clearTimeout(longTimer); }
            if (g.mode === 'orbit') {
                TouchPlay.orbit(off(), t.clientX - g.px, t.clientY - g.py, window.innerWidth, window.innerHeight);
                g.px = t.clientX; g.py = t.clientY;
                e.preventDefault();
            }
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            clearTimeout(longTimer);
            if (!g) return;
            const t = e.changedTouches[0];
            const cur = g; 
            if (e.touches.length === 0) g = null;
            if (cur.longFired) { fire(2, 'up', t); e.preventDefault(); return; }
            if (cur.mode === 'pinch' || cur.mode === 'orbit') { e.preventDefault(); return; }
            // plain tap
            const now = Date.now();
            if (menuScreen === 'PLAYING') {
                if (now - lastTapAt < TOUCH_DOUBLE_TAP_MS && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 40) {
                    lastTapAt = 0;
                    fire(1, 'down', t); fire(1, 'up', t);
                    e.preventDefault();
                    return;
                }
                lastTapAt = now; lastTapX = t.clientX; lastTapY = t.clientY;
                if (!st.kbOpen) TouchPlay.focusKeyboard();      // inside the user gesture so iOS raises the keyboard
            }
            // otherwise let the compatibility mouse events through (menus, spigots, etc.)
        }, { passive: false });
        document.addEventListener('touchcancel', () => { clearTimeout(longTimer); g = null; });
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }
};
