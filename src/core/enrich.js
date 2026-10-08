// Letter Launcher — src/core/enrich.js
// Scene enrichment: seeded RNG, instancing/prop helpers, NanoLayout, palettes, enrichScene() and the pipe/spigot water puzzle.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // ====================================================================
        // FIDELITY PACK — GPU-instanced enrichment + Gemini Nano layout director
        // + interactive spigot "Water Works" wall. Every entry point is guarded
        // so it can't crash the loop; every object goes through scene.add so the
        // clean-slate swap tears it down. See PLAN_FIDELITY.md.
        // ====================================================================
        let spigots = [];
        let basinInfo = null;
        const _instScratch = new THREE.Object3D();

        function makeRng(seed) {
            let s = (seed >>> 0) || 1;
            return function () {
                s = (s + 0x6D2B79F5) | 0;
                let t = Math.imul(s ^ (s >>> 15), 1 | s);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }
        function hashName(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

        function addInstanced(geo, mat, count, placeFn) {
            count = Math.max(0, Math.min(60000, count | 0));
            if (count === 0) return null;
            const mesh = new THREE.InstancedMesh(geo, mat, count);
            for (let i = 0; i < count; i++) {
                placeFn(i, _instScratch);
                _instScratch.updateMatrix();
                mesh.setMatrixAt(i, _instScratch.matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
            // Instances are spread far from the geometry's origin-centred bounding sphere,
            // so per-object frustum culling would cull the WHOLE batch when the origin
            // leaves view (the "flicker in and out" on moving-camera scenes). Disable it —
            // one instanced draw call is cheap to always submit.
            mesh.frustumCulled = false;
            scene.add(mesh);
            return mesh;
        }

        // Build a THREE.BufferGeometry from a baked static asset (assets/props_data.js).
        // Fresh geometry per call so the clean-slate swap can dispose it safely.
        function makeProp(name) {
            const d = (typeof window !== 'undefined' && window.PROP_ASSETS) ? window.PROP_ASSETS[name] : null;
            if (!d) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(d.position, 3));
            if (d.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(d.normal, 3));
            if (d.color) g.setAttribute('color', new THREE.Float32BufferAttribute(d.color, 3));
            g.setIndex(d.index);
            g.computeBoundingSphere();
            return g;
        }

        const NanoLayout = (function () {
            const cache = {};
            let runSeed = (Date.now() & 0xffffff) || 1;
            const PALETTES = ['lush', 'arid', 'neon', 'dusk'];
            function clampInt(v, lo, hi, dflt) { v = Math.round(Number(v)); if (!isFinite(v)) v = dflt; return Math.max(lo, Math.min(hi, v)); }
            function fallback(name, rng) {
                const heavy = 1 + rng() * 0.9;
                return {
                    seed: (runSeed ^ hashName(name)) >>> 0,
                    palette: PALETTES[(rng() * PALETTES.length) | 0],
                    grass: clampInt(9000 * heavy + rng() * 8000, 3000, 40000, 12000),
                    trees: clampInt(140 * heavy + rng() * 160, 40, 900, 200),
                    rocks: clampInt(120 * heavy + rng() * 180, 30, 800, 180),
                    props: clampInt(60 * heavy + rng() * 120, 20, 600, 120),
                    stars: clampInt(6000 * heavy + rng() * 9000, 2000, 40000, 9000),
                    spigots: { cols: clampInt(6 + rng() * 8, 4, 16, 9), rows: clampInt(3 + rng() * 4, 3, 8, 5), openFraction: 0.2 + rng() * 0.5 }
                };
            }
            function sanitize(name, rng, j) {
                const base = fallback(name, rng);
                if (!j || typeof j !== 'object') return base;
                base.grass = clampInt(j.grass, 3000, 40000, base.grass);
                base.trees = clampInt(j.trees, 40, 900, base.trees);
                base.rocks = clampInt(j.rocks, 30, 800, base.rocks);
                base.props = clampInt(j.props, 20, 600, base.props);
                base.stars = clampInt(j.stars, 2000, 40000, base.stars);
                if (typeof j.palette === 'string' && PALETTES.indexOf(j.palette) >= 0) base.palette = j.palette;
                if (j.spigots && typeof j.spigots === 'object') {
                    base.spigots.cols = clampInt(j.spigots.cols, 4, 16, base.spigots.cols);
                    base.spigots.rows = clampInt(j.spigots.rows, 3, 8, base.spigots.rows);
                    const f = Number(j.spigots.openFraction); if (isFinite(f)) base.spigots.openFraction = Math.max(0, Math.min(1, f));
                }
                return base;
            }
            async function requestNano(name) {
                try {
                    const LM = (typeof window !== 'undefined') && (window.LanguageModel || (window.ai && window.ai.languageModel));
                    if (!LM) return null;
                    let ok = true;
                    if (LM.availability) { const a = await LM.availability(); ok = (a && a !== 'unavailable'); }
                    else if (LM.capabilities) { const c = await LM.capabilities(); ok = c && c.available && c.available !== 'no'; }
                    if (!ok) return null;
                    const session = await LM.create();
                    const prompt =
                        'You are a level-layout director for a playful 3D letter toy. Reply with ONLY compact JSON, no prose. ' +
                        'Schema: {"palette":"lush|arid|neon|dusk","grass":int 3000-40000,"trees":int 40-900,"rocks":int 30-800,' +
                        '"props":int 20-600,"stars":int 2000-40000,"spigots":{"cols":int 4-16,"rows":int 3-8,"openFraction":number 0..1}}. ' +
                        'Make it feel distinct and coherent for the "' + name + '" biome. Vary it. Seed ' + runSeed + '.';
                    const out = await session.prompt(prompt);
                    if (session.destroy) session.destroy();
                    const a = out.indexOf('{'), b = out.lastIndexOf('}');
                    if (a < 0 || b <= a) return null;
                    return JSON.parse(out.slice(a, b + 1));
                } catch (e) { return null; }
            }
            function specFor(name) {
                runSeed = (runSeed + 0x9E3779) & 0xffffff;
                const rng = makeRng((runSeed ^ hashName(name)) >>> 0);
                const spec = cache[name] ? sanitize(name, rng, cache[name]) : fallback(name, rng);
                requestNano(name).then(function (j) { if (j) cache[name] = j; }).catch(function () {});
                return spec;
            }
            return { specFor: specFor, get seed() { return runSeed; } };
        })();

        function paletteColors(p) {
            switch (p) {
                case 'arid': return { grass: 0x9c8f4a, tree: 0x6b7f3a, rock: 0x9a8b74 };
                case 'neon': return { grass: 0x2bd6a7, tree: 0x18908f, rock: 0x5566aa };
                case 'dusk': return { grass: 0x4a6a5a, tree: 0x2f5a52, rock: 0x6b6480 };
                default: return { grass: 0x49c06e, tree: 0x2f8f4e, rock: 0x8b8577 };
            }
        }

        function enrichScene(name) {
            try {
                if (!scene || !THREE.InstancedMesh) return;
                const spec = NanoLayout.specFor(name);
                const rng = makeRng(spec.seed || 1);
                const col = paletteColors(spec.palette);
                const floorY = (scene.userData && scene.userData.playFloorY != null) ? scene.userData.playFloorY : DEFAULT_FLOOR_Y;
                const R = 150;
                const SPACE = (name === 'space' || name === 'moon_rocket' || name === 'flight_sim');
                const URBAN = (name === 'city' || name === 'kyoto_train' || name === 'tower_build');
                const disc = function (o, yOff, sMin, sMax) {
                    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R;
                    o.position.set(Math.cos(a) * r, floorY + (yOff || 0), Math.sin(a) * r);
                    o.rotation.set(0, rng() * Math.PI * 2, 0);
                    const s = sMin + rng() * (sMax - sMin); o.scale.set(s, s, s);
                };
                if (SPACE) {
                    const starGeo = new THREE.SphereGeometry(0.5, 5, 4);
                    const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                    addInstanced(starGeo, starMat, spec.stars, function (i, o) {
                        const rad = 120 + rng() * 260, a = rng() * Math.PI * 2, ph = (rng() - 0.5) * Math.PI;
                        o.position.set(Math.cos(a) * Math.cos(ph) * rad, 30 + Math.abs(Math.sin(ph)) * rad * 0.6, Math.sin(a) * Math.cos(ph) * rad);
                        o.rotation.set(0, 0, 0); const s = 0.3 + rng() * 1.2; o.scale.set(s, s, s);
                    });
                    const pebGeo = new THREE.DodecahedronGeometry(0.4, 0);
                    const pebMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, flatShading: true });
                    addInstanced(pebGeo, pebMat, Math.min(spec.rocks * 4, 8000), function (i, o) { disc(o, 0.2, 0.4, 1.4); });
                    return;
                }
                const vcMat = function () { return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }); };
                const rockGeo = makeProp('rock');
                const bladeGeo = new THREE.ConeGeometry(0.06, 1.0, 3);
                const grassMat = new THREE.MeshStandardMaterial({ color: col.grass, roughness: 1 });
                addInstanced(bladeGeo, grassMat, spec.grass, function (i, o) {
                    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * R;
                    o.position.set(Math.cos(a) * rr, floorY + 0.45, Math.sin(a) * rr);
                    o.rotation.set((rng() - 0.5) * 0.4, rng() * Math.PI, (rng() - 0.5) * 0.4);
                    const s = 0.5 + rng() * 1.1; o.scale.set(s, s * (0.7 + rng()), s);
                });
                if (rockGeo) addInstanced(rockGeo, vcMat(), spec.rocks, function (i, o) { disc(o, 0.4, 0.5, 1.7); });
                const bushGeo = makeProp('bush');
                if (bushGeo) addInstanced(bushGeo, vcMat(), Math.floor(spec.trees * 1.5), function (i, o) { disc(o, 0.3, 0.7, 1.6); });
                if (!URBAN) {
                    const treeGeo = makeProp(name === 'forest' ? 'pine' : 'tree');
                    if (treeGeo) addInstanced(treeGeo, vcMat(), spec.trees, function (i, o) {
                        const a = rng() * Math.PI * 2, rr = (0.25 + 0.75 * Math.sqrt(rng())) * R;
                        o.position.set(Math.cos(a) * rr, floorY + 0.2, Math.sin(a) * rr);
                        o.rotation.set(0, rng() * Math.PI * 2, 0);
                        const s = 1.4 + rng() * 2.6; o.scale.set(s, s, s);
                    });
                }
                if (name === 'waterworks') buildWaterPuzzle(spec, floorY);
            } catch (e) { if (window.console) console.warn('[enrichScene] skipped:', e && e.message); }
        }

        // ---- Water Works: connect-the-pipes routing puzzle --------------------
        // A grid of rotatable pipe pieces on the wall. Water starts at the top-left
        // SOURCE and must be routed to the bottom-right DRAIN. Click a piece to
        // rotate it; a BFS recomputes which pipes are water-filled; filling the drain
        // wins. Openings bitmask: N=1 E=2 S=4 W=8.
        let pipeCells = [];
        let pipeInfo = null;
        const PIPE_EMPTY = 0x59636e, PIPE_FILL = 0x2fa8e0;
        function rotateMask(m, r) { for (let i = 0; i < (r & 3); i++) m = ((m << 1) | (m >> 3)) & 15; return m; }
        function pipeOpenMask(cell) { return cell.fixed ? cell.mask : rotateMask(cell.baseMask, cell.rot); }

        function buildWaterPuzzle(spec, floorY) {
            try {
                pipeCells = []; pipeInfo = null;
                gameMode = null; // remove the old "patch the leak" mechanic entirely
                const cols = Math.max(4, spec.spigots.cols), rows = Math.max(3, spec.spigots.rows);
                const step = 1.5, wz = -11;
                const wallW = cols * step + 1.4, wallH = rows * step + 1.4;
                const topY = floorY + wallH - 1.2, x0 = -(cols - 1) * step / 2;
                const wall = new THREE.Mesh(new THREE.BoxGeometry(wallW, wallH, 0.6),
                    new THREE.MeshStandardMaterial({ color: 0x33424c, roughness: 0.95 }));
                wall.position.set(0, floorY + wallH / 2 - 0.6, wz - 0.5); scene.add(wall);
                const rng = makeRng((spec.seed ^ 0x7A1) >>> 0);
                const TYPES = [{ g: 'pipe_straight', m: 5 }, { g: 'pipe_elbow', m: 3 }, { g: 'pipe_elbow', m: 3 }, { g: 'pipe_tee', m: 7 }];
                const grid = [];
                for (let r = 0; r < rows; r++) {
                    grid[r] = [];
                    for (let c = 0; c < cols; c++) {
                        const isSource = (c === 0 && r === 0), isDrain = (c === cols - 1 && r === rows - 1);
                        let geoName, baseMask, fixed = false, mask = 0, rot = (rng() * 4) | 0;
                        if (isSource) { geoName = 'pipe_elbow'; baseMask = 3; fixed = true; mask = 6; rot = 1; }
                        else if (isDrain) { geoName = 'pipe_elbow'; baseMask = 3; fixed = true; mask = 9; rot = 3; }
                        else { const t = TYPES[(rng() * TYPES.length) | 0]; geoName = t.g; baseMask = t.m; }
                        const geo = makeProp(geoName);
                        const matColor = isSource ? 0x2ecc71 : (isDrain ? 0xe0533a : PIPE_EMPTY);
                        const mat = new THREE.MeshStandardMaterial({ color: matColor, emissive: 0x000000, metalness: 0.3, roughness: 0.55 });
                        const mesh = geo ? new THREE.Mesh(geo, mat) : new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
                        mesh.position.set(x0 + c * step, topY - r * step, wz + 0.35);
                        mesh.rotation.z = -rot * Math.PI / 2;
                        mesh.scale.setScalar(step * 0.62);
                        scene.add(mesh);
                        const cell = { c: c, r: r, mesh: mesh, mat: mat, geoName: geoName, baseMask: baseMask, rot: rot, fixed: fixed, mask: mask, isSource: isSource, isDrain: isDrain, filled: false };
                        grid[r][c] = cell; pipeCells.push(cell);
                    }
                }
                pipeInfo = { cols: cols, rows: rows, grid: grid, won: false, source: grid[0][0], drain: grid[rows - 1][cols - 1] };
                recomputePipeFill();
                if (typeof showBanner === 'function') showBanner('Water Works', 'rotate the pipes — route the flow from the green source to the red drain');
            } catch (e) { if (window.console) console.warn('[waterPuzzle] skipped:', e && e.message); }
        }

        function recomputePipeFill() {
            if (!pipeInfo) return;
            const grid = pipeInfo.grid, cols = pipeInfo.cols, rows = pipeInfo.rows;
            for (let i = 0; i < pipeCells.length; i++) pipeCells[i].filled = false;
            const src = pipeInfo.source; src.filled = true;
            const stack = [src];
            const opp = { 1: 4, 4: 1, 2: 8, 8: 2 };
            const nb = { 1: [0, -1], 4: [0, 1], 2: [1, 0], 8: [-1, 0] };
            while (stack.length) {
                const cell = stack.pop();
                const m = pipeOpenMask(cell);
                [1, 2, 4, 8].forEach(function (dir) {
                    if (!(m & dir)) return;
                    const d = nb[dir], nc = cell.c + d[0], nr = cell.r + d[1];
                    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return;
                    const n = grid[nr][nc];
                    if (n.filled) return;
                    if (pipeOpenMask(n) & opp[dir]) { n.filled = true; stack.push(n); }
                });
            }
            for (let i = 0; i < pipeCells.length; i++) {
                const c = pipeCells[i];
                if (c.isSource || c.isDrain) continue;
                c.mat.color.setHex(c.filled ? PIPE_FILL : PIPE_EMPTY);
                c.mat.emissive.setHex(c.filled ? 0x0d3b52 : 0x000000);
            }
            if (pipeInfo.drain.filled && !pipeInfo.won) {
                pipeInfo.won = true;
                if (typeof showBanner === 'function') showBanner('Connected!', 'the water reaches the drain');
                try { if (typeof detonateFirework === 'function') detonateFirework(pipeInfo.drain.mesh.position.clone()); } catch (e) {}
            }
        }

        // animate loop hook (kept name updateSpigots): shimmer filled pipes.
        function updateSpigots(dt) {
            try {
                if (!pipeCells.length) return;
                const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.004;
                for (let i = 0; i < pipeCells.length; i++) {
                    const c = pipeCells[i];
                    if (c.filled && !c.isSource && !c.isDrain) c.mat.emissiveIntensity = 0.6 + 0.4 * Math.sin(t + i);
                }
            } catch (e) { }
        }

        // mouse hook (kept name handleSpigotClick): rotate the clicked pipe.
        function handleSpigotClick() {
            try {
                if (!pipeCells.length) return false;
                raycaster.setFromCamera(mouse, camera);
                const meshes = pipeCells.map(function (c) { return c.mesh; });
                const hit = raycaster.intersectObjects(meshes, false)[0];
                if (!hit) return false;
                const cell = pipeCells.find(function (c) { return c.mesh === hit.object; });
                if (!cell || cell.fixed) return true;
                cell.rot = (cell.rot + 1) & 3;
                cell.mesh.rotation.z = -cell.rot * Math.PI / 2;
                recomputePipeFill();
                return true;
            } catch (e) { return false; }
        }
