// Letter Launcher — src/core/autotest.js (LLF-68: browser smoke-test hook)
// Only active with ?autotest=1[&scene=NAME]; inert otherwise. engine.js calls autotestBoot()
// once the font has loaded; it builds the named scene, enters PLAYING and flags
// window.__llReady for tests/browser/scenes.spec.js. Frame times are sampled from the
// LLHooks 'frame' event into window.__llFrameTimes (ring buffer of 600).
// Moved out of menu.js and onto the hook bus by LLF-91.

        function autotestBoot() {
            let q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
            if (q.get('autotest') !== '1') return;
            window.__llAutotest = true;
            window.__llFrameTimes = [];
            try {
                const n = q.get('scene');
                if (n && SCENES[n] && SCENES[n].build) { buildScene(SCENES[n].build); setMenuScreen('PLAYING'); }
            } catch (err) { console.error('autotest scene build failed:', err && (err.stack || err.message || err)); }
            window.__llReady = true;
        }

        function autotestFrame() {
            const now = performance.now(), last = window.__llLastFrame;
            window.__llLastFrame = now;
            if (last === undefined) return;
            const a = window.__llFrameTimes; a.push(now - last);
            if (a.length > 600) a.shift();
        }

        if (typeof LLHooks !== 'undefined') {
            LLHooks.on('frame', function () { if (window.__llAutotest) autotestFrame(); });
        }
