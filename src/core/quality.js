// Letter Launcher — src/core/quality.js  (LLF-72, Forge-R1: renderer fidelity)
// Classic <script>: shares top-level globals with the other src/ files; top level only DECLARES.
// Provides: PMREM/RoomEnvironment image-based lighting, sRGB output + ACES tone mapping,
// per-scene exposure + light retune, EffectComposer (bloom / SAO) and auto quality tiers.
// Entry points called from the engine (each is try/catch-wrapped inside, never throws):
//   qualityInit()              after the WebGLRenderer exists (engine.js init)
//   qualityOnSceneBuilt(name)  after every buildScene() (scene_swap.js)
//   qualityRender()            replaces renderer.render(scene, camera) (engine.js animate)
//   qualityOnResize()          from onWindowResize
//   qualityCycle(dir) / qualityLabel()  options-menu entry 'QUALITY'

        const QUALITY_TIERS = ['low', 'med', 'high', 'ultra'];
        const QUALITY_MODES = ['auto', 'low', 'med', 'high', 'ultra'];
        const QUALITY_STORAGE_KEY = 'letterLauncher.quality';
        const QUALITY_ENV_INTENSITY = 0.4;      // envMapIntensity for every standard material
        // Tier presets. shadow = shadow map size (0 = shadows off); budget scales GPU-instanced
        // enrichment counts (enrichScene); pixelRatio is a cap on devicePixelRatio.
        const QUALITY_PRESETS = {
            low:   { shadow: 0,    bloom: false, sao: false, budget: 0.35, pixelRatio: 1 },
            med:   { shadow: 1024, bloom: false, sao: false, budget: 0.7,  pixelRatio: 1 },
            high:  { shadow: 2048, bloom: true,  sao: false,  budget: 1,    pixelRatio: 1.5 },
            ultra: { shadow: 2048, bloom: true,  sao: true,  budget: 1,    pixelRatio: 2 }
        };
        // Auto-quality thresholds (ticket): median of 90 frames after a scene build.
        const QUALITY_SAMPLE_FRAMES = 90;
        const QUALITY_DOWN_MS = 20;
        const QUALITY_UP_MS = 9;
        const QUALITY_STEP_COOLDOWN_MS = 5000;   // at most one step per 5 s
        const QUALITY_NO_UP_AFTER_DOWN_MS = 30000; // hysteresis: don't climb straight back up
        // Per-scene tone-mapping exposure + light scale. First-pass values: sRGB output + ACES
        // shifts colours, so lights are lifted slightly so nothing reads darker than before.
        // SCENES[name].exposure / .lightScale (registry) override these when a scene sets them.
        const QUALITY_SCENE_TUNING = {
            default:      { exposure: 1.0,  lightScale: 1.0 },
            kyoto_train:  { exposure: 1.0,  lightScale: 1.0 },
            flight_sim:   { exposure: 1.0,  lightScale: 1.0 },
            moon_rocket:  { exposure: 1.15, lightScale: 1.0 },
            waterworks:   { exposure: 1.0,  lightScale: 1.0 },
            tower_build:  { exposure: 1.0,  lightScale: 1.0 },
            coastal_city: { exposure: 0.95, lightScale: 1.0 },
            desert:       { exposure: 0.95, lightScale: 1.0 },
            space:        { exposure: 1.15, lightScale: 1.0 },
            city:         { exposure: 1.2,  lightScale: 1.0 },
            forest:       { exposure: 1.1,  lightScale: 1.0 },
            wild_west:    { exposure: 1.0,  lightScale: 1.0 }
        };

        let QUALITY = {
            mode: 'auto', tier: 'med', ready: false, postBroken: false,
            envTex: null, mainLight: null, composer: null, composerTier: null,
            bloomPass: null, saoPass: null,
            samples: [], lastFrameT: 0, lastStepT: 0, noUpUntil: 0, lastMedianMs: 0
        };

        // ---- pure helpers (unit-tested in tests/test_llf-72.js) ----------------------------
        function qualityMedian(arr) {
            if (!arr || !arr.length) return 0;
            const s = arr.slice().sort(function (a, b) { return a - b; });
            const m = s.length >> 1;
            return (s.length & 1) ? s[m] : (s[m - 1] + s[m]) / 2;
        }

        // Decide the next tier from a frame-time median. Returns the (possibly unchanged) tier.
        function qualityDecide(medianMs, tier, nowMs, lastStepMs, noUpUntilMs) {
            let i = QUALITY_TIERS.indexOf(tier);
            if (i < 0) i = 1;
            if (nowMs - lastStepMs < QUALITY_STEP_COOLDOWN_MS) return QUALITY_TIERS[i];
            if (medianMs > QUALITY_DOWN_MS && i > 0) return QUALITY_TIERS[i - 1];
            if (medianMs < QUALITY_UP_MS && i < QUALITY_TIERS.length - 1 && nowMs >= noUpUntilMs) return QUALITY_TIERS[i + 1];
            return QUALITY_TIERS[i];
        }

        function qualityCycleMode(mode, dir) {
            let i = QUALITY_MODES.indexOf(mode);
            if (i < 0) i = 0;
            return QUALITY_MODES[(i + (dir < 0 ? -1 : 1) + QUALITY_MODES.length) % QUALITY_MODES.length];
        }

        function qualityLabel() {
            return 'QUALITY: ' + (QUALITY.mode === 'auto' ? 'AUTO (' + QUALITY.tier.toUpperCase() + ')' : QUALITY.mode.toUpperCase());
        }

        function qualityTuning(name) {
            const reg = (typeof SCENES !== 'undefined' && SCENES && SCENES[name]) ? SCENES[name] : null;
            const base = QUALITY_SCENE_TUNING[name] || QUALITY_SCENE_TUNING.default;
            return {
                exposure: (reg && typeof reg.exposure === 'number') ? reg.exposure : base.exposure,
                lightScale: (reg && typeof reg.lightScale === 'number') ? reg.lightScale : base.lightScale
            };
        }

        // ---- persistence (localStorage may throw / be empty: always optional) --------------
        function qualityLoadMode() {
            try {
                const v = window.localStorage.getItem(QUALITY_STORAGE_KEY);
                if (QUALITY_MODES.indexOf(v) >= 0) return v;
            } catch (e) { /* ignore */ }
            return 'auto';
        }
        function qualitySaveMode() {
            try { window.localStorage.setItem(QUALITY_STORAGE_KEY, QUALITY.mode); } catch (e) { /* ignore */ }
        }

        // ---- Phong -> Standard so env lighting applies to every prop/ground ------------------
        // Scenes and core code still say `new THREE.MeshPhongMaterial({...})`; from here on that
        // yields a MeshStandardMaterial (shininess -> roughness, specular dropped). This keeps
        // the diff to the scene files at zero while converting every ground/prop material.
        function qualityInstallMaterialShim() {
            if (!window.THREE || THREE.MeshPhongMaterial.__llStandardShim) return;
            const Std = THREE.MeshStandardMaterial;
            const Shim = function (params) {
                const p = Object.assign({}, params || {});
                const sh = p.shininess;
                delete p.shininess; delete p.specular; delete p.reflectivity;
                if (p.roughness === undefined) {
                    p.roughness = (typeof sh === 'number') ? Math.min(1, Math.max(0.2, 1 - sh / 130)) : 0.75;
                }
                if (p.metalness === undefined) p.metalness = 0.05;
                if (p.envMapIntensity === undefined) p.envMapIntensity = QUALITY_ENV_INTENSITY;
                const m = new Std(p);
                m.userData.fromPhong = true;
                return m;
            };
            Shim.prototype = Std.prototype;
            Shim.__llStandardShim = true;
            THREE.MeshPhongMaterial = Shim;
        }

        // ---- renderer + environment ---------------------------------------------------------
        function qualityInit() {
            try {
                if (QUALITY.ready || !renderer || !scene) return;
                qualityInstallMaterialShim();
                renderer.outputEncoding = THREE.LinearEncoding;   // scenes' hex colours are authored for linear output (sRGB washed them out)
                renderer.toneMapping = THREE.NoToneMapping;
                renderer.toneMappingExposure = 1.0;
                // Image-based lighting: RoomEnvironment prefiltered through PMREMGenerator.
                try {
                    const pmrem = new THREE.PMREMGenerator(renderer);
                    const envRT = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04);
                    QUALITY.envTex = envRT.texture;
                    pmrem.dispose();
                } catch (e) { if (window.console) console.warn('[quality] PMREM env skipped:', e && e.message); }
                // Env reflections go to metallic materials only (qualityEnvSweep) — on matte surfaces
                // the room light just washed every scene out.
                scene.environment = null;
                for (let i = 0; i < scene.children.length; i++) {
                    const o = scene.children[i];
                    if (o.isDirectionalLight && o.castShadow) { QUALITY.mainLight = o; break; }
                }
                if (QUALITY.mainLight && QUALITY.mainLight.target) scene.add(QUALITY.mainLight.target);
                QUALITY.mode = qualityLoadMode();
                QUALITY.tier = (QUALITY.mode === 'auto') ? 'med' : QUALITY.mode;
                QUALITY.ready = true;
                qualityApplyTier(true);
            } catch (e) { if (window.console) console.warn('[quality] init failed:', e && e.message); }
        }

        // ---- applying a tier ------------------------------------------------------------------
        function qualityApplyTier(force) {
            try {
                if (!QUALITY.ready) return;
                const P = QUALITY_PRESETS[QUALITY.tier] || QUALITY_PRESETS.med;
                const dpr = Math.min(window.devicePixelRatio || 1, P.pixelRatio);
                renderer.setPixelRatio(dpr);
                renderer.setSize(window.innerWidth, window.innerHeight);
                // Shadows: mapSize per tier, off on low.
                const L = QUALITY.mainLight;
                const wasOn = renderer.shadowMap.enabled;
                renderer.shadowMap.enabled = P.shadow > 0;
                if (L) {
                    L.castShadow = P.shadow > 0;
                    if (P.shadow > 0 && L.shadow.mapSize.width !== P.shadow) {
                        L.shadow.mapSize.set(P.shadow, P.shadow);
                        if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; }
                    }
                }
                if (wasOn !== renderer.shadowMap.enabled || force) qualityMarkMaterialsDirty();
                qualityApplyInstanceBudget();
                qualityBuildComposer();
                QUALITY.samples = [];
            } catch (e) { if (window.console) console.warn('[quality] apply failed:', e && e.message); }
        }

        function qualityMarkMaterialsDirty() {
            try { scene.traverse(function (o) { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); } }); }
            catch (e) { /* ignore */ }
        }

        // Instance budgets from enrichScene scale with the tier (InstancedMesh.count is the
        // number of instances drawn; the full allocation is remembered in userData.fullCount).
        function qualityApplyInstanceBudget() {
            try {
                const P = QUALITY_PRESETS[QUALITY.tier] || QUALITY_PRESETS.med;
                const objs = (typeof sceneObjects !== 'undefined' && sceneObjects) ? sceneObjects : [];
                objs.forEach(function (o) {
                    if (!o || !o.isInstancedMesh) return;
                    if (o.userData.fullCount == null) o.userData.fullCount = o.count;
                    o.count = Math.max(0, Math.floor(o.userData.fullCount * P.budget));
                });
            } catch (e) { /* ignore */ }
        }

        function qualityBuildComposer() {
            QUALITY.composer = null; QUALITY.bloomPass = null; QUALITY.saoPass = null;
            QUALITY.composerTier = null;
            const P = QUALITY_PRESETS[QUALITY.tier] || QUALITY_PRESETS.med;
            if (QUALITY.postBroken || !(P.bloom || P.sao)) return;
            if (!THREE.EffectComposer || !THREE.RenderPass) return;
            try {
                const w = window.innerWidth, h = window.innerHeight;
                const c = new THREE.EffectComposer(renderer);
                c.setPixelRatio(renderer.getPixelRatio());
                c.setSize(w, h);
                c.addPass(new THREE.RenderPass(scene, camera));
                if (P.sao && THREE.SAOPass) {
                    const sao = new THREE.SAOPass(scene, camera, false, true);
                    sao.params.saoIntensity = 0.012;
                    sao.params.saoScale = 2.5;
                    sao.params.saoKernelRadius = 30;
                    sao.params.saoBlurRadius = 6;
                    c.addPass(sao);
                    QUALITY.saoPass = sao;
                }
                if (P.bloom && THREE.UnrealBloomPass) {
                    // strength 0.6; high threshold so only bright emissives (fireworks, lanterns,
                    // welding sparks) glow — ordinary lit surfaces stay below it.
                    const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.4, 0.85);
                    c.addPass(bloom);
                    QUALITY.bloomPass = bloom;
                }
                // r128 tone-maps in the material shaders but only encodes sRGB when rendering to
                // the screen, so the composer's last pass applies the sRGB transfer.
                // Linear output: no gamma pass (it double-brightened every frame).
                QUALITY.composer = c;
                QUALITY.composerTier = QUALITY.tier;
            } catch (e) {
                QUALITY.postBroken = true; QUALITY.composer = null;
                if (window.console) console.warn('[quality] post-processing disabled:', e && e.message);
            }
        }

        // ---- environment reflections for metallic materials only ----------------------------
        let qualityEnvLast = 0;
        function qualityEnvSweep(nowMs) {
            try {
                if (!QUALITY.ready || !QUALITY.envTex || !scene) return;
                if (nowMs - qualityEnvLast < 1000) return;
                qualityEnvLast = nowMs;
                scene.traverse(function (o) {
                    if (!o.material) return;
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
                        if (m.isMeshStandardMaterial && !m.envMap && (m.metalness || 0) > 0.3) {
                            m.envMap = QUALITY.envTex; m.needsUpdate = true;
                        }
                    });
                });
            } catch (e) { /* ignore */ }
        }
        if (typeof LLHooks !== 'undefined') LLHooks.on('frame', function (dt, now) { qualityEnvSweep(now || performance.now()); });

        // ---- per-scene hook (after buildScene) ---------------------------------------------------
        function qualityOnSceneBuilt(name) {
            try {
                if (!QUALITY.ready) return;
                const T = qualityTuning(name);
                renderer.toneMappingExposure = T.exposure;
                scene.environment = null;                     // env goes to metallic materials only
                // Retune light intensities (base remembered so repeated builds never compound).
                scene.traverse(function (o) {
                    if (o.isLight && typeof o.intensity === 'number') {
                        if (o.userData.baseIntensity == null) o.userData.baseIntensity = o.intensity;
                        o.intensity = o.userData.baseIntensity * T.lightScale;
                    }
                    if (o.material) {
                        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
                            if (m.isMeshStandardMaterial && !m.userData.envSet) { m.envMapIntensity = QUALITY_ENV_INTENSITY; m.userData.envSet = true; }
                        });
                    }
                });
                qualityFitShadow();
                qualityApplyInstanceBudget();
                QUALITY.samples = [];                         // fresh 90-frame window for auto mode
            } catch (e) { if (window.console) console.warn('[quality] scene hook failed:', e && e.message); }
        }

        // One directional light, shadow camera fitted to the play bounds each scene build.
        function qualityFitShadow() {
            const L = QUALITY.mainLight;
            if (!L || !L.shadow) return;
            const b = (typeof computePlayBounds === 'function') ? computePlayBounds() : null;
            if (!b) return;
            const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
            const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 6;   // margin for tall letters
            const cam = L.shadow.camera;
            cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
            cam.near = 0.5; cam.far = 80 + half;
            cam.updateProjectionMatrix();
            if (L.target) { L.target.position.set(cx, b.floorY, cz); L.target.updateMatrixWorld(); }
            L.position.set(cx + 10, b.floorY + 25, cz + 10);
            L.shadow.bias = -0.0004;
        }

        // ---- render + auto tiering -----------------------------------------------------------------
        function qualityRender() {
            const now = (window.performance && performance.now) ? performance.now() : Date.now();
            try {
                if (QUALITY.ready && QUALITY.composer && QUALITY.composerTier === QUALITY.tier) {
                    QUALITY.composer.render();
                } else {
                    renderer.render(scene, camera);
                }
            } catch (e) {
                QUALITY.postBroken = true; QUALITY.composer = null;
                if (window.console) console.warn('[quality] composer render failed, falling back:', e && e.message);
                renderer.render(scene, camera);
            }
            qualityAutoStep(now);
        }

        function qualityAutoStep(now) {
            try {
                if (!QUALITY.ready) return;
                const dt = QUALITY.lastFrameT ? now - QUALITY.lastFrameT : 0;
                QUALITY.lastFrameT = now;
                if (QUALITY.mode !== 'auto') return;
                if (dt <= 0 || dt > 250) return;              // tab switch / hitch: not a steady sample
                QUALITY.samples.push(dt);
                if (QUALITY.samples.length < QUALITY_SAMPLE_FRAMES) return;
                const med = qualityMedian(QUALITY.samples);
                QUALITY.lastMedianMs = med;
                QUALITY.samples = [];
                const next = qualityDecide(med, QUALITY.tier, now, QUALITY.lastStepT, QUALITY.noUpUntil);
                if (next !== QUALITY.tier) {
                    if (QUALITY_TIERS.indexOf(next) < QUALITY_TIERS.indexOf(QUALITY.tier)) QUALITY.noUpUntil = now + QUALITY_NO_UP_AFTER_DOWN_MS;
                    QUALITY.tier = next; QUALITY.lastStepT = now;
                    qualityApplyTier(false);
                }
            } catch (e) { /* never kill the animate loop */ }
        }

        function qualityOnResize() {
            try {
                if (!QUALITY.ready) return;
                renderer.setSize(window.innerWidth, window.innerHeight);
                if (QUALITY.composer) QUALITY.composer.setSize(window.innerWidth, window.innerHeight);
            } catch (e) { /* ignore */ }
        }

        // Options menu: dir = +1 / -1 cycles Auto/Low/Med/High/Ultra and persists the choice.
        function qualityCycle(dir) {
            try {
                QUALITY.mode = qualityCycleMode(QUALITY.mode, dir);
                if (QUALITY.mode !== 'auto') QUALITY.tier = QUALITY.mode;
                QUALITY.lastStepT = 0;
                qualitySaveMode();
                qualityApplyTier(false);
            } catch (e) { /* ignore */ }
        }
