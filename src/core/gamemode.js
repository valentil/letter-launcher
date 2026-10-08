// Letter Launcher — src/core/gamemode.js
// Word-quest game mode: HUD, objectives, banners, word matching, handleGameKey, tween/flyby/puffBurst/weather/sky helpers, shared level props, gameFrame().
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // ==================================================================
        // ==== WORD-QUEST GAME FRAMEWORK ===================================
        // Gamified levels: the simulation reacts to whole TYPED WORDS.
        // A level is a normal scene builder PLUS a gameMode definition:
        //   setGameMode({
        //     name,                       // level name
        //     words: { WORD: fn, ... },   // typed word -> action. Two kinds:
        //                                 //   state advancers (move toward the win)
        //                                 //   doodads (reactive flavor, no progress)
        //     update(),                   // per-frame sim + camera targets
        //   })
        // Discovering the words IS the puzzle: the objective HUD gives the
        // goal plus riddle-ish hints, and found words collect on screen.
        // ==================================================================
        let gameMode = null;
        let bufferHeat = 0;          // 0 (ready/green) .. 1 (hot/orange)
        let hudFlashUntil = 0;       // blue success-flash deadline (ms epoch)

        function hudEl(id) { return document.getElementById(id); }
        function setWordHudVisible(v) { const el = hudEl('wordHud'); if (el) el.style.display = v ? 'block' : 'none'; }
        function setObjectiveVisible(v) { const el = hudEl('objectiveHud'); if (el) el.style.display = v ? 'block' : 'none'; }
        function showBanner(title, sub) {
            const el = hudEl('gameBanner'); if (!el) return;
            el.innerHTML = title + (sub ? '<div style="font-size:15px;color:#fff;margin-top:8px;font-weight:400;letter-spacing:0.5px">' + sub + '</div>' : '');
            el.style.display = 'block';
        }
        function hideBanner() { const el = hudEl('gameBanner'); if (el) el.style.display = 'none'; }

        function updateWordHud() {
            const el = hudEl('wordHud'); if (!el) return;
            const buf = inputBuffer.slice(-14);
            el.innerHTML = buf.length ? buf : '<span class="ph">type a word…</span>';
        }
        function bumpHeat() { bufferHeat = Math.min(1, bufferHeat + 0.16); }
        function hudFlashSuccess(word) {
            hudFlashUntil = Date.now() + 700;
            const el = hudEl('wordHud');
            if (el) { el.innerHTML = '<span style="color:#7fd7ff">' + word + '</span>'; el._flashed = true; }
            bufferHeat = 0;
        }
        // Called every frame: decays heat and drives the border green->orange,
        // holds blue during a success flash, then settles back to green.
        function updateWordHudFrame() {
            const el = hudEl('wordHud');
            if (!el || el.style.display === 'none') return;
            bufferHeat = Math.max(0, bufferHeat - 0.006);
            let border, glow;
            if (Date.now() < hudFlashUntil) {
                border = '#4da6ff'; glow = 'rgba(77,166,255,0.8)';
            } else {
                const h = Math.round(135 - 110 * bufferHeat); // 135=green -> 25=orange
                border = 'hsl(' + h + ',75%,55%)';
                glow = 'hsla(' + h + ',75%,55%,0.55)';
                if (el._flashed) { el._flashed = false; updateWordHud(); }
            }
            if (el._b !== border) {
                el._b = border;
                el.style.borderColor = border;
                el.style.boxShadow = '0 0 18px ' + glow;
            }
        }

        function setObjective(title, goalHtml) {
            const el = hudEl('objectiveHud'); if (!el) return;
            el.innerHTML = '<h3>' + title + '</h3><div class="goal">' + goalHtml +
                '</div><div class="status"></div><div class="msg"></div><div class="found"></div>';
            el.style.display = 'block';
        }
        let _gameMsgTimer = null;
        function gameMsg(text, ms) {
            const el = hudEl('objectiveHud'); if (!el) return;
            const m = el.querySelector('.msg'); if (!m) return;
            m.textContent = text;
            if (_gameMsgTimer) clearTimeout(_gameMsgTimer);
            _gameMsgTimer = setTimeout(() => { m.textContent = ''; }, ms || 4500);
        }
        function gameStatus(text) {
            const el = hudEl('objectiveHud'); if (!el) return;
            const s = el.querySelector('.status');
            if (s && s.textContent !== text) s.textContent = text;
        }
        function markFound(word) {
            if (!gameMode) return;
            gameMode.found.add(word);
            const el = hudEl('objectiveHud'); if (!el) return;
            const f = el.querySelector('.found');
            if (f) f.textContent = 'Words found: ' + Array.from(gameMode.found).join(' · ');
        }

        function setGameMode(def) {
            gameMode = Object.assign({
                found: new Set(), won: false,
                tweens: [], flybys: [], weather: null, skyTarget: null
            }, def);
            inputBuffer = ''; bufferHeat = 0;
            updateWordHud();
        }

        function gameWin(text) {
            if (!gameMode || gameMode.won) return;
            gameMode.won = true;
            showBanner('★ ' + text + ' ★', 'Esc for the menu — or keep typing words to play with the scene');
            for (let i = 0; i < 8; i++) {
                setTimeout(() => {
                    if (scene && gameMode) detonateFirework(new THREE.Vector3(
                        (Math.random() - 0.5) * 26, 8 + Math.random() * 9, (Math.random() - 0.5) * 12 - 4));
                }, i * 240);
            }
            [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
                setTimeout(() => gameBeep(f, 0.5, 'triangle', 0.22), i * 110));
        }

        // Expand { 'GO|START|CHOO': fn } into { GO: fn, START: fn, CHOO: fn }.
        function expandWords(map) {
            const out = {};
            for (const k in map) k.split('|').forEach(a => { out[a] = map[k]; });
            return out;
        }

        // Longest matching level word at the END of the input buffer wins.
        function tryGameWords() {
            if (!gameMode || !gameMode.words) return false;
            let best = null;
            for (const w in gameMode.words) {
                if (w.length >= 2 && inputBuffer.endsWith(w) && (!best || w.length > best.length)) best = w;
            }
            if (!best) return false;
            hudFlashSuccess(best);
            markFound(best);
            inputBuffer = '';
            try { gameMode.words[best](); } catch (err) { console.warn('word action failed:', best, err); }
            return true;
        }

        function handleGameKey(key) {
            if (/^[a-zA-Z]$/.test(key)) {
                const char = key.toUpperCase();
                playTone(char, null);
                inputBuffer += char;
                if (inputBuffer.length > 24) inputBuffer = inputBuffer.slice(-24);
                bumpHeat();
                updateWordHud();
                tryGameWords();
            } else if (key === ' ') {
                inputBuffer = '';
                updateWordHud();
            }
        }

        // --- Shared doodad toolkit -----------------------------------------
        function gameBeep(freq, dur, type, vol) {
            initAudio();
            if (!audioCtx || soundVolume <= 0) return;
            const now = audioCtx.currentTime;
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = type || 'sine';
            o.frequency.setValueAtTime(freq, now);
            g.gain.setValueAtTime((vol || 0.15) * soundVolume, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + (dur || 0.2));
            o.connect(g); g.connect(audioCtx.destination);
            o.start(now); o.stop(now + (dur || 0.2) + 0.05);
        }
        function beeps(seq) { // [[freq, dur, delayMs, type, vol], ...]
            seq.forEach(s => setTimeout(() => gameBeep(s[0], s[1], s[3], s[4]), s[2] || 0));
        }
        function tween(dur, fn, onDone) { if (gameMode) gameMode.tweens.push({ t: 0, dur, fn, onDone }); }
        function flyby(mesh, from, to, dur, opts) {
            if (!gameMode || !scene) return;
            mesh.position.copy(from); scene.add(mesh);
            gameMode.flybys.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, opts: opts || {} });
        }
        function puffBurst(pos, color, n, spread, opts) {
            for (let i = 0; i < (n || 14); i++) {
                const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.7 + 0.15, (Math.random() - 0.5))
                    .multiplyScalar((spread || 1) * 0.12);
                fwParticle(
                    pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * (spread || 1), 0, (Math.random() - 0.5) * (spread || 1))),
                    v, new THREE.Color(typeof color === 'function' ? color() : color),
                    Object.assign({ gravity: 0.001, decay: 0.02 }, opts || {}));
            }
        }
        function setWeather(kind) { if (gameMode) gameMode.weather = kind; }
        function skyTo(hex, fogHex) {
            if (gameMode) gameMode.skyTarget = { c: new THREE.Color(hex), f: fogHex != null ? new THREE.Color(fogHex) : null };
        }
        function nearestU(curve, pos, samples) {
            samples = samples || 220;
            let bu = 0, bd = Infinity;
            for (let i = 0; i < samples; i++) {
                const u = i / samples;
                const p = curve.getPointAt(u);
                const dx = p.x - pos.x, dz = p.z - pos.z;
                const d = dx * dx + dz * dz;
                if (d < bd) { bd = d; bu = u; }
            }
            return bu;
        }
        function angDiff(a, b) {
            let d = (a - b) % (Math.PI * 2);
            if (d > Math.PI) d -= Math.PI * 2;
            if (d < -Math.PI) d += Math.PI * 2;
            return d;
        }
        function makeTextLabel(str, size, colorHex) {
            if (!font) return new THREE.Group();
            const g = new THREE.TextGeometry(str, { font: font, size: size, height: size * 0.15 });
            g.computeBoundingBox();
            g.translate(-(g.boundingBox.max.x - g.boundingBox.min.x) / 2, 0, 0);
            return new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: colorHex }));
        }
        // Tiny person: torso + head (+ optional hat cone). Used for workers,
        // shogun, monks, ninjas, schoolkids.
        function makeBoxMan(bodyHex, hatHex) {
            const g = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.0, 8),
                new THREE.MeshPhongMaterial({ color: bodyHex }));
            torso.position.y = 0.5; g.add(torso);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6),
                new THREE.MeshPhongMaterial({ color: 0xf0c8a0 }));
            head.position.y = 1.2; g.add(head);
            if (hatHex != null) {
                const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.28, 10),
                    new THREE.MeshPhongMaterial({ color: hatHex }));
                hat.position.y = 1.44; g.add(hat);
            }
            return g;
        }
        // Seasons doodad: typing TREE cycles every registered tree through
        // spring -> summer -> autumn -> winter (a pure doodad, no progress).
        const SEASONS = [
            { name: 'spring', leaf: 0xffb7d5 },
            { name: 'summer', leaf: 0x2e8b57 },
            { name: 'autumn', leaf: 0xe07b39 },
            { name: 'winter', leaf: 0xf4f7fb }
        ];
        function makeGameTree(pos, leafHex, st) {
            const g = new THREE.Group();
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 2.2, 6),
                new THREE.MeshPhongMaterial({ color: 0x6b4a2f }));
            trunk.position.y = 1.1; g.add(trunk);
            const leafMat = new THREE.MeshPhongMaterial({ color: leafHex });
            for (let i = 0; i < 3; i++) {
                const puff = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.5, 8, 6), leafMat);
                puff.position.set((Math.random() - 0.5) * 1.2, 2.2 + Math.random() * 0.9, (Math.random() - 0.5) * 1.2);
                g.add(puff);
            }
            g.position.copy(pos);
            scene.add(g);
            if (st) { st.trees = st.trees || []; st.trees.push({ group: g, mat: leafMat }); }
            return g;
        }
        function cycleSeason(st) {
            st.season = ((st.season == null ? 0 : st.season) + 1) % SEASONS.length;
            const s = SEASONS[st.season];
            (st.trees || []).forEach(t => {
                t.mat.color.setHex(s.leaf);
                // Trees may be individual groups OR entries baked into one mesh
                // (then only a position is stored per tree).
                const p = t.group ? t.group.position : t.pos;
                puffBurst(p.clone().add(new THREE.Vector3(0, 2.6, 0)), s.leaf, 8, 1.6,
                    { gravity: 0.0006, decay: 0.015, size: 0.07 });
            });
            gameMsg('The trees turn to ' + s.name + '.');
            return s;
        }
        function birdsAcross(y, color) {
            for (let i = 0; i < 6; i++) {
                const bird = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 4),
                    new THREE.MeshPhongMaterial({ color: color || 0x333333 }));
                bird.rotation.z = -Math.PI / 2;
                const z = -6 - Math.random() * 8;
                flyby(bird,
                    new THREE.Vector3(-32 - i * 2, (y || 8) + Math.random() * 3, z),
                    new THREE.Vector3(34, (y || 8) + 4 + Math.random() * 3, z),
                    5200 + i * 260, { bob: true });
            }
            beeps([[1550, 0.12, 0, 'sine', 0.08], [1750, 0.1, 160, 'sine', 0.07]]);
        }

        // --- Static-geometry baking (performance) ---------------------------
        // Collect many small primitives and merge them into ONE mesh per
        // material via BufferGeometryUtils, collapsing hundreds of draw calls
        // into a handful. Falls back to a plain Group if the util is missing.
        function makeBaker() {
            return {
                list: [],
                add(geo, x, y, z, ry) {
                    const m = new THREE.Matrix4();
                    if (ry) m.makeRotationY(ry);
                    m.setPosition(x, y, z);
                    geo.applyMatrix4(m);
                    this.list.push(geo);
                    return this;
                },
                bake(material, opts) {
                    if (!this.list.length) return null;
                    let mesh;
                    if (THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries) {
                        const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(this.list, false);
                        mesh = new THREE.Mesh(merged, material);
                    } else {
                        mesh = new THREE.Group();
                        this.list.forEach(g => mesh.add(new THREE.Mesh(g, material)));
                    }
                    if (!opts || opts.shadow !== false) {
                        mesh.traverse ? mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } })
                                      : (mesh.castShadow = mesh.receiveShadow = true);
                        if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
                    }
                    scene.add(mesh);
                    this.list = [];
                    return mesh;
                }
            };
        }
        // Inject a cheap wind sway into a material's vertex shader
        // (onBeforeCompile). Vertices above `baseY` bob with time; the `store`
        // object receives the compiled shader so a level can drive uTime/uWind.
        function makeWindyMaterial(mat, baseY, store) {
            mat.onBeforeCompile = shader => {
                shader.uniforms.uTime = { value: 0 };
                shader.uniforms.uWind = { value: 1.0 };
                shader.uniforms.uBaseY = { value: baseY };
                shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uBaseY;\n' +
                    shader.vertexShader.replace('#include <begin_vertex>',
                        '#include <begin_vertex>\n' +
                        'float windPhase = position.x * 0.35 + position.z * 0.27;\n' +
                        'float windAmp = 0.09 * uWind * smoothstep(uBaseY, uBaseY + 2.5, position.y);\n' +
                        'transformed.x += sin(uTime * 1.7 + windPhase) * windAmp;\n' +
                        'transformed.z += cos(uTime * 1.3 + windPhase * 1.6) * windAmp * 0.7;\n' +
                        'transformed.y += sin(uTime * 2.1 + windPhase * 2.3) * windAmp * 0.3;\n');
                if (store) store.shader = shader;
            };
            return mat;
        }

        // Per-frame processing for the active game level: tweens, flybys,
        // ambient weather particles, sky lerp, then the level's own update()
        // (which also sets targetCameraPos / targetCameraLookAt).
        function gameFrame() {
            if (!gameMode) return;
            gameMode.tweens = gameMode.tweens.filter(tw => {
                tw.t += 16.7 * timeScale;
                const k = Math.min(1, tw.t / tw.dur);
                try { tw.fn(k); } catch (err) {}
                if (k >= 1) { if (tw.onDone) try { tw.onDone(); } catch (err) {} return false; }
                return true;
            });
            gameMode.flybys = gameMode.flybys.filter(f => {
                f.t += 16.7 * timeScale;
                const k = Math.min(1, f.t / f.dur);
                f.mesh.position.lerpVectors(f.from, f.to, k);
                if (f.opts.bob) f.mesh.position.y += Math.sin(k * 20) * 0.4;
                if (f.opts.arc) f.mesh.position.y += Math.sin(k * Math.PI) * f.opts.arc;
                if (f.opts.spin) { f.mesh.rotation.y += 0.1 * timeScale; f.mesh.rotation.x += 0.06 * timeScale; }
                if (f.opts.face) f.mesh.lookAt(f.to);
                if (k >= 1) {
                    scene.remove(f.mesh);
                    if (f.opts.onDone) try { f.opts.onDone(); } catch (err) {}
                    return false;
                }
                return true;
            });
            if (gameMode.weather === 'rain') {
                for (let i = 0; i < 3; i++) fwParticle(
                    new THREE.Vector3((Math.random() - 0.5) * 52, 14, (Math.random() - 0.5) * 32 - 4),
                    new THREE.Vector3(0, -0.5, 0), new THREE.Color(0x66aaff),
                    { gravity: 0.004, decay: 0.03, size: 0.05 });
            } else if (gameMode.weather === 'snow') {
                for (let i = 0; i < 2; i++) fwParticle(
                    new THREE.Vector3((Math.random() - 0.5) * 52, 14, (Math.random() - 0.5) * 32 - 4),
                    new THREE.Vector3((Math.random() - 0.5) * 0.03, -0.06, 0), new THREE.Color(0xffffff),
                    { gravity: 0.0002, decay: 0.008, size: 0.09 });
            } else if (gameMode.weather === 'petals') {
                if (Math.random() < 0.6) fwParticle(
                    new THREE.Vector3((Math.random() - 0.5) * 46, 12, (Math.random() - 0.5) * 32),
                    new THREE.Vector3((Math.random() - 0.5) * 0.04, -0.04, 0), new THREE.Color(0xffb7d5),
                    { gravity: 0.0003, decay: 0.006, size: 0.08 });
            }
            if (gameMode.skyTarget && scene.background && scene.background.isColor) {
                scene.background.lerp(gameMode.skyTarget.c, 0.04);
                if (gameMode.skyTarget.f && scene.fog) scene.fog.color.lerp(gameMode.skyTarget.f, 0.04);
            }
            if (gameMode.update) {
                try { gameMode.update(); } catch (err) { console.warn('game update error', err); }
            }
        }
