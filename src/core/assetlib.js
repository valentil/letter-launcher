// Letter Launcher — src/core/assetlib.js
// LLF-69 AssetLib: loads the NativeCAD GLBs described by assets/cad/manifest.d/<name>.json.
// LLF-104: one metadata file per asset, fetched on demand — there is no shared index file.
// Classic <script>: declares window.AssetLib and nothing else at top level (startup stays in main.js).
//
//   AssetLib.place(name, {x, y, z, rotY, scale, lod, parent})  -> THREE.Group, synchronous.
//        Scene builders use THIS: it adds an empty placeholder group now (so buildScene's
//        clean-slate wipe owns it) and swaps the model in when the GLB arrives, or the
//        baked fallback prop if it never does. Never block a scene build on a load.
//   AssetLib.load(name)            -> Promise<THREE.Group>  (cached; clones share geometry/material;
//                                     resolves to fallback(name) on any failure, never rejects)
//   AssetLib.lod(name, distances?) -> Promise<THREE.LOD>    (levels from the GLB's MSFT_lod ids)
//   AssetLib.joints(group)         -> { nodeName: {object, type, axis:THREE.Vector3, min, max} }
//   AssetLib.fallback(name)        -> THREE.Group (makeProp(name) mesh, or a bbox-sized box)
//   AssetLib.meta(name)            -> Promise<entry|null>  (fetches manifest.d/<name>.json once; null offline)
//   AssetLib.info(name)            -> entry or null (sync; null until meta(name)/load/lod/place fetched it)
//   AssetLib.list()                -> Promise<[name]> from the manifest.d/ directory listing ([] if the
//                                     server does not list directories) — tools only, scenes name assets
//   AssetLib.manifest(names?)      -> Promise<{name: entry}> of the given names (default: list()), loaded
//
// three r128's GLTFLoader decodes KHR_mesh_quantization but ignores MSFT_lod, so lod() reads
// parser.json.nodes[i].extensions.MSFT_lod.ids itself and fetches those nodes with
// parser.getDependency('node', id). Lower-level nodes are outside the scene graph and inherit
// the LOD0 node's parent transform (the exporter's mm->m / Z-up->Y-up root), which we copy.

        const AssetLib = (function () {
            const api = { BASE: 'assets/cad/' };   // BASE is overridable (tools/cad/viewer.html)
            const gltfCache = {};          // name -> Promise<gltf>
            const metaCache = {};          // name -> Promise<entry|null>
            const metaData = {};           // name -> entry (filled as each manifest.d/<name>.json arrives)

            function warn(msg, e) { try { if (window.console) console.warn('[AssetLib] ' + msg, e && e.message ? e.message : (e || '')); } catch (_) { } }

            // Per-asset metadata: assets/cad/manifest.d/<name>.json. Never rejects.
            function meta(name) {
                if (!metaCache[name]) {
                    metaCache[name] = new Promise(function (resolve) {
                        try {
                            if (typeof fetch !== 'function') return resolve(null);
                            fetch(api.BASE + 'manifest.d/' + encodeURIComponent(name) + '.json').then(function (r) { return r.ok ? r.json() : null; })
                                .then(function (j) { if (j) metaData[name] = j; resolve(j || null); })
                                .catch(function (e) { warn('meta ' + name + ' unavailable', e); resolve(null); });
                        } catch (e) { warn('meta fetch threw for ' + name, e); resolve(null); }
                    });
                }
                return metaCache[name];
            }
            function info(name) { return metaData[name] || null; }
            // Asset names from the manifest.d/ directory listing (python http.server, npx serve, ...).
            function list() {
                return new Promise(function (resolve) {
                    try {
                        if (typeof fetch !== 'function') return resolve([]);
                        fetch(api.BASE + 'manifest.d/').then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
                            const out = [], re = /href="([^"\/?#]+)\.json"/g;
                            let m;
                            while ((m = re.exec(html || ''))) { const n = decodeURIComponent(m[1]); if (out.indexOf(n) < 0) out.push(n); }
                            resolve(out.sort());
                        }).catch(function () { resolve([]); });
                    } catch (e) { resolve([]); }
                });
            }
            function manifest(names) {
                return (names ? Promise.resolve(names) : list()).then(function (ns) {
                    return Promise.all(ns.map(meta)).then(function () {
                        const out = {};
                        ns.forEach(function (n) { if (metaData[n]) out[n] = metaData[n]; });
                        return out;
                    });
                });
            }

            function loadGltf(name) {
                if (!gltfCache[name]) {
                    gltfCache[name] = new Promise(function (resolve, reject) {
                        try {
                            if (typeof THREE === 'undefined' || !THREE.GLTFLoader) throw new Error('THREE.GLTFLoader not loaded');
                            const file = (info(name) && info(name).file) || (name + '.glb');
                            new THREE.GLTFLoader().load(api.BASE + file, resolve, undefined, reject);
                        } catch (e) { reject(e); }
                    });
                }
                return gltfCache[name];
            }

            // Deep clone sharing geometry + material (Mesh.clone shares both; no skinning here).
            function cloneShared(obj) { return obj.clone(true); }

            function fallback(name) {
                const g = new THREE.Group();
                g.name = 'cad-fallback:' + name;
                g.userData.cadFallback = true;
                try {
                    const geo = (typeof makeProp === 'function') ? makeProp(name) : null;
                    if (geo) {
                        const mat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.7, vertexColors: !!geo.getAttribute('color') });
                        g.add(new THREE.Mesh(geo, mat));
                        return g;
                    }
                    const e = info(name), s = (e && e.bboxM && e.bboxM.size) || [0.5, 0.5, 0.5];
                    const box = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]),
                        new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }));
                    if (e && e.bboxM) box.position.set((e.bboxM.min[0] + e.bboxM.max[0]) / 2, (e.bboxM.min[1] + e.bboxM.max[1]) / 2, (e.bboxM.min[2] + e.bboxM.max[2]) / 2);
                    else box.position.y = s[1] / 2;
                    g.add(box);
                } catch (err) { warn('fallback failed for ' + name, err); }
                return g;
            }

            function tag(group, name) {
                group.userData.cad = { name: name };
                return group;
            }

            function load(name) {
                return meta(name).then(function () { return loadGltf(name); }).then(function (gltf) {
                    const g = new THREE.Group();
                    g.name = 'cad:' + name;
                    g.add(cloneShared(gltf.scene));
                    return tag(g, name);
                }).catch(function (e) {
                    warn('load ' + name + ' failed, using fallback', e);
                    return tag(fallback(name), name);
                });
            }

            // Build a THREE.LOD from MSFT_lod. distances[i] = camera distance (m) where level i starts.
            function lod(name, distances) {
                return meta(name).then(function () { return loadGltf(name); }).then(function (gltf) {
                    const parser = gltf.parser, json = parser.json, nodes = json.nodes || [];
                    const level0 = cloneShared(gltf.scene);
                    level0.updateMatrixWorld(true);
                    const chains = [];        // {lod0Object, ids}
                    let levels = 1;
                    nodes.forEach(function (n, i) {
                        const ids = n.extensions && n.extensions.MSFT_lod && n.extensions.MSFT_lod.ids;
                        if (!ids || !ids.length) return;
                        const obj = level0.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n.name || ''));
                        if (!obj) return;
                        chains.push({ obj: obj, ids: ids });
                        levels = Math.max(levels, ids.length + 1);
                    });
                    const builds = [];
                    for (let L = 1; L < levels; L++) {
                        builds.push(Promise.all(chains.map(function (c) {
                            const id = c.ids[Math.min(L, c.ids.length) - 1];
                            return parser.getDependency('node', id).then(function (o) {
                                const wrap = new THREE.Group();
                                c.obj.parent.updateMatrixWorld(true);
                                wrap.matrixAutoUpdate = false;
                                wrap.matrix.copy(c.obj.parent.matrixWorld);   // level0 root is identity, so this is root-relative
                                wrap.add(cloneShared(o));
                                return wrap;
                            });
                        })).then(function (wraps) { const g = new THREE.Group(); wraps.forEach(function (w) { g.add(w); }); return g; }));
                    }
                    return Promise.all(builds).then(function (lower) {
                        const l = new THREE.LOD();
                        l.name = 'cad-lod:' + name;
                        const e = info(name), size = (e && e.bboxM) ? Math.max.apply(null, e.bboxM.size) : 1;
                        const d = distances || [0, size * 12, size * 40];
                        l.addLevel(level0, d[0] || 0);
                        lower.forEach(function (g, i) { l.addLevel(g, d[i + 1] != null ? d[i + 1] : size * 12 * (i + 1)); });
                        return tag(l, name);
                    });
                }).catch(function (e) {
                    warn('lod ' + name + ' failed, using fallback', e);
                    const l = new THREE.LOD();
                    l.addLevel(fallback(name), 0);
                    return tag(l, name);
                });
            }

            // Joint map from node extras (userData.joint) and the asset meta's joints[] by node name.
            function joints(group) {
                const out = {};
                try {
                    const name = group && group.userData && group.userData.cad && group.userData.cad.name;
                    const declared = {};
                    ((info(name) && info(name).joints) || []).forEach(function (j) { declared[j.node] = j; });
                    group.traverse(function (o) {
                        const j = (o.userData && o.userData.joint) || declared[o.name];
                        if (!j || out[o.name]) return;
                        const a = j.axis || [0, 1, 0];
                        out[o.name] = { object: o, type: j.type || 'revolute', axis: new THREE.Vector3(a[0], a[1], a[2]).normalize(), min: j.min, max: j.max };
                    });
                } catch (e) { warn('joints failed', e); }
                return out;
            }

            // Synchronous placement for scene builders: placeholder now, model later.
            function place(name, opts) {
                opts = opts || {};
                const holder = new THREE.Group();
                holder.name = 'cad-slot:' + name;
                try {
                    holder.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
                    if (opts.rotY) holder.rotation.y = opts.rotY;
                    if (opts.scale) holder.scale.setScalar(opts.scale);
                    (opts.parent || scene).add(holder);
                    const p = opts.lod === false ? load(name) : lod(name, opts.distances);
                    p.then(function (model) {
                        try { holder.add(model); holder.userData.cad = model.userData.cad; } catch (e) { warn('swap-in failed for ' + name, e); }
                    });
                } catch (e) { warn('place ' + name + ' failed', e); }
                return holder;
            }

            api.load = load; api.lod = lod; api.joints = joints; api.fallback = fallback;
            api.place = place; api.manifest = manifest; api.info = info; api.meta = meta; api.list = list;
            return api;
        })();
        if (typeof window !== 'undefined') window.AssetLib = AssetLib;
