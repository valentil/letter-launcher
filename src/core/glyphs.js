// Letter Launcher — src/core/glyphs.js
// LLF-70: letters as real CAD solids. Classic <script>: declares window.LetterGlyphs and nothing
// else at top level (loading starts from engine.js once the font is in, never at parse time).
//
//   LetterGlyphs.preload()             start fetching assets/cad/glyphs.glb + glyph_physics.json (idempotent)
//   LetterGlyphs.ready()               true once both arrived; until then callers use their old path
//   LetterGlyphs.has(ch)               a CAD glyph exists for ch (A-Z, 0-9; lowercase maps up)
//   LetterGlyphs.create(ch, opts)      -> {mesh, body} or null.  opts: {scale, density, material, color}
//        mesh: THREE.Mesh sharing one cached BufferGeometry per char (origin = the glyph's centre
//              of mass); body: CANNON.Body with one ConvexPolyhedron per hull (shapes cached per
//              char+scale), mass = CAD volume x density x scale^3, inertia = CAD inertia
//              (diagonal, glyph axes) x density/1000 x scale^5. Bodies may sleep (sleepSpeedLimit
//              0.2); anything that pushes a sleeping letter wakes it on the next step.
//   LetterGlyphs.buildHullShapes(entry, scale)  -> [{shape, offset}]  (pure; node tests use it)
//   LetterGlyphs.massFor(ch, scale, density)    -> kg
//   LetterGlyphs.DENSITY                        {foam, foamHd} kg/m^3
//
// Data: assets/cad/glyph_physics.json (tools/cad/glyph_physics.js) - per char com, volume,
// inertia @1000 kg/m^3 and <=8 convex hulls (<=24 verts) in the glyph frame, relative to the COM;
// assets/cad/glyphs.glb (tools/cad/recipes/glyphs.json via NativeCAD, merged by glb_merge.js).
        const LetterGlyphs = (function () {
            const api = { PHYS_URL: 'assets/cad/glyph_physics.json', CAD_NAME: 'glyphs' };
            // ASTM C578 expanded polystyrene grades: Type XI 0.70 pcf, Type VIII 1.15 pcf. Picked so
            // a typed letter weighs about what the old 1 kg box did (~1 kg) and a spelled one ~5 kg.
            api.DENSITY = { foam: 11.2, foamHd: 18.4 };
            let phys = null, root = null, state = 'idle';      // idle | loading | ready | failed
            const geoCache = {}, shapeCache = {};

            function warn(m, e) { try { console.warn('[LetterGlyphs] ' + m, e && e.message ? e.message : (e || '')); } catch (_) { } }
            function key(ch) { return String(ch || '').toUpperCase(); }
            function entry(ch) { return phys && phys.glyphs && phys.glyphs[key(ch)] || null; }

            function preload() {
                if (state !== 'idle') return;
                state = 'loading';
                try {
                    if (typeof fetch !== 'function' || typeof AssetLib === 'undefined') { state = 'failed'; return; }
                    const pj = fetch(api.PHYS_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
                    Promise.all([pj, AssetLib.load(api.CAD_NAME)]).then(function (res) {
                        const g = res[1];
                        if (!g || (g.userData && g.userData.cadFallback) || !g.getObjectByName('glyph_A')) throw new Error('glyphs.glb missing');
                        g.updateMatrixWorld(true);
                        phys = res[0]; root = g; state = 'ready';
                    }).catch(function (e) { state = 'failed'; warn('CAD glyphs unavailable, keeping TextGeometry letters', e); });
                } catch (e) { state = 'failed'; warn('preload threw', e); }
            }
            function ready() { return state === 'ready'; }
            function has(ch) { return !!entry(ch); }

            // Read one (possibly interleaved, possibly KHR_mesh_quantization-normalized) attribute
            // into a plain Float32Array: three r128's getX() does not denormalize.
            function readAttr(a) {
                const n = a.count, s = a.itemSize, out = new Float32Array(n * s);
                const inter = !!a.isInterleavedBufferAttribute;
                const arr = inter ? a.data.array : a.array, stride = inter ? a.data.stride : s, off = inter ? a.offset : 0;
                let div = 1;
                if (a.normalized) {
                    if (arr instanceof Int16Array) div = 32767; else if (arr instanceof Uint16Array) div = 65535;
                    else if (arr instanceof Int8Array) div = 127; else if (arr instanceof Uint8Array) div = 255;
                }
                for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) {
                    const v = arr[i * stride + off + k] / div;
                    out[i * s + k] = a.normalized ? Math.max(v, -1) : v;
                }
                return out;
            }
            // Float geometry in the glyph frame with origin at the COM (cached, shared by every clone).
            function geometry(ch) {
                const k = key(ch);
                if (geoCache[k]) return geoCache[k];
                const e = entry(k), node = root && root.getObjectByName('glyph_' + k);
                if (!e || !node) return null;
                let src = null;
                node.traverse(function (o) { if (!src && o.isMesh) src = o; });
                if (!src) return null;
                const m = src.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
                const g = new THREE.BufferGeometry();
                const pos = readAttr(src.geometry.getAttribute('position'));
                const v = new THREE.Vector3(), ox = e.origin[0] + e.com[0], oy = e.origin[1] + e.com[1], oz = e.origin[2] + e.com[2];
                for (let i = 0; i < pos.length; i += 3) {
                    v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
                    pos[i] = v.x - ox; pos[i + 1] = v.y - oy; pos[i + 2] = v.z - oz;
                }
                g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                const na = src.geometry.getAttribute('normal');
                if (na) {
                    const nrm = readAttr(na);
                    for (let i = 0; i < nrm.length; i += 3) {
                        v.set(nrm[i], nrm[i + 1], nrm[i + 2]).applyMatrix3(nm).normalize();
                        nrm[i] = v.x; nrm[i + 1] = v.y; nrm[i + 2] = v.z;
                    }
                    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
                } else g.computeVertexNormals();
                const uv = src.geometry.getAttribute('uv');
                if (uv) g.setAttribute('uv', new THREE.BufferAttribute(readAttr(uv), 2));
                if (src.geometry.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.geometry.index.array), 1));
                g.computeBoundingBox(); g.computeBoundingSphere();
                g.userData.sharedGlyph = true;           // engine.retireExcessBodies must not dispose it
                geoCache[k] = g;
                return g;
            }

            // Hull point lists (front ring z>0 then back ring, each CCW seen from +z) -> convex
            // polyhedra with outward (CCW) faces, centred on their own centroid for a tight bounding
            // sphere; `offset` puts them back in the body (= COM) frame.
            function buildHullShapes(e, scale) {
                const out = [];
                (e.hulls || []).forEach(function (h) {
                    const n = h.length / 2;
                    if (n < 3) return;
                    let cx = 0, cy = 0, cz = 0;
                    h.forEach(function (p) { cx += p[0]; cy += p[1]; cz += p[2]; });
                    cx /= h.length; cy /= h.length; cz /= h.length;
                    const pts = h.map(function (p) { return new CANNON.Vec3((p[0] - cx) * scale, (p[1] - cy) * scale, (p[2] - cz) * scale); });
                    const faces = [[], []];
                    for (let i = 0; i < n; i++) { faces[0].push(i); faces[1].push(2 * n - 1 - i); }
                    for (let i = 0; i < n; i++) faces.push([n + i, n + (i + 1) % n, (i + 1) % n, i]);
                    out.push({ shape: new CANNON.ConvexPolyhedron(pts, faces), offset: new CANNON.Vec3(cx * scale, cy * scale, cz * scale) });
                });
                return out;
            }
            function shapes(ch, scale) {
                const k = key(ch) + '@' + scale.toFixed(3);
                if (!shapeCache[k]) shapeCache[k] = buildHullShapes(entry(ch), scale);
                return shapeCache[k];
            }
            function massFor(ch, scale, density) {
                const e = entry(ch);
                return e ? e.volume * density * scale * scale * scale : 0;
            }

            // Sleeping lets 150 settled letters cost nothing, but only letters may sleep: the rest
            // of the game pushes bodies with impulses/velocities that a sleeping body ignores.
            function configureWorld(w) {
                if (!w || w.__glyphSleep) return;
                w.__glyphSleep = true;
                w.allowSleep = true;
                (w.bodies || []).forEach(function (b) { if (!b.__glyph) b.allowSleep = false; });
                w.addEventListener('addBody', function (ev) { if (ev.body && !ev.body.__glyph) ev.body.allowSleep = false; });
            }
            function wakeIfPushed() {
                if (this.sleepState !== CANNON.Body.SLEEPING) return;
                if (this.velocity.norm2() + this.angularVelocity.norm2() > 1e-6 || this.force.norm2() > 1e-9 || this.torque.norm2() > 1e-9) this.wakeUp();
            }

            function create(ch, opts) {
                opts = opts || {};
                try {
                    if (!ready() || !has(ch) || typeof CANNON === 'undefined') return null;
                    const scale = opts.scale || 1, density = opts.density || api.DENSITY.foam, e = entry(ch);
                    const geo = geometry(ch);
                    if (!geo) return null;
                    const material = opts.material || new THREE.MeshStandardMaterial({
                        color: opts.color != null ? opts.color : Math.random() * 0xffffff, metalness: 0.8, roughness: 0.3, envMapIntensity: 1.0 });
                    const mesh = new THREE.Mesh(geo, material);
                    mesh.scale.setScalar(scale);
                    mesh.castShadow = true; mesh.receiveShadow = true;
                    mesh.userData.glyph = key(ch);
                    const body = new CANNON.Body({ mass: massFor(ch, scale, density), material: opts.physicsMaterial || (typeof physicsMaterial !== 'undefined' ? physicsMaterial : undefined) });
                    body.__glyph = true;
                    shapes(ch, scale).forEach(function (s) { body.addShape(s.shape, s.offset); });
                    const f = density / 1000 * Math.pow(scale, 5), I = e.inertia;
                    body.inertia.set(I[0][0] * f, I[1][1] * f, I[2][2] * f);
                    body.invInertia.set(1 / body.inertia.x, 1 / body.inertia.y, 1 / body.inertia.z);
                    body.updateInertiaWorld(true);
                    body.allowSleep = true; body.sleepSpeedLimit = 0.2; body.sleepTimeLimit = 1;
                    body.preStep = wakeIfPushed;
                    if (typeof world !== 'undefined' && world) configureWorld(world);
                    return { mesh: mesh, body: body };
                } catch (err) { warn('create ' + ch + ' failed', err); return null; }
            }

            // Test hook: hand in parsed glyph_physics.json without fetch/GLB (node physics tests).
            function _setPhysics(p) { phys = p; }

            api.preload = preload; api.ready = ready; api.has = has; api.create = create;
            api.buildHullShapes = buildHullShapes; api.massFor = massFor; api.configureWorld = configureWorld;
            api.entry = entry; api._setPhysics = _setPhysics;
            return api;
        })();
        if (typeof window !== 'undefined') window.LetterGlyphs = LetterGlyphs;
