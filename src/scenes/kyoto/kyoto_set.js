// Letter Launcher — src/scenes/kyoto/kyoto_set.js
// LLF-83: KYOTO TRAIN permanent way and set dressing from NativeCAD.
//   KyotoSet.track(opts)    swept ballast + 50N rails for both loops (kyoto_track_outer / _inner GLBs) and the
//                           kyoto_sleeper GLB instanced every 600 mm along the curves. The scene's baked primitive
//                           rails/ties stay visible until the CAD models arrive, so offline play still has track.
//   KyotoSet.dress(opts)    torii, pagoda, palace gate, station, lanterns, school bus from their recipes (AssetLib).
// Everything is parented to `scene` synchronously (buildScene's clean-slate wipe owns it); loads swap in later.
        var KyotoSet = (function () {
            function isReal(model) { return !!(model && !(model.userData && model.userData.cadFallback)); }

            // Sleeper transforms along a curve: perpendicular to the tangent, every `step` world units.
            // skip(p) lets the caller drop sleepers already laid by another loop (the shared south arc).
            function sleeperFrames(curve, step, skip) {
                var L = curve.getLength(), n = Math.max(2, Math.round(L / step)), out = [];
                for (var i = 0; i < n; i++) {
                    var u = i / n, p = curve.getPointAt(u), t = curve.getTangentAt(u);
                    if (skip && skip(p)) continue;
                    out.push({ x: p.x, z: p.z, yaw: Math.atan2(-t.z, t.x) });
                }
                return out;
            }

            function track(opts) {
                var S = opts.scale, F = opts.ground, res = { loaded: 0 };
                var holders = [];
                [['kyoto_track_outer', 0], ['kyoto_track_inner', -0.002]].forEach(function (d) {
                    var h = new THREE.Group();
                    h.name = 'cad-slot:' + d[0];
                    h.position.set(0, F + d[1], 0);          // inner sits 2 mm (world) low: the shared arc never z-fights
                    h.scale.setScalar(S);
                    scene.add(h);
                    holders.push(h);
                    try {
                        AssetLib.load(d[0]).then(function (m) {
                            if (!isReal(m)) return;
                            h.add(m);
                            res.loaded++;
                            if (res.loaded === 2 && opts.fallbackRails) opts.fallbackRails.visible = false;
                        });
                    } catch (e) { }
                });
                // sleepers: one InstancedMesh over both loops
                try {
                    var step = 0.6 * S, frames = sleeperFrames(opts.outer, step, null);
                    var outerPts = opts.outer.getSpacedPoints(400);
                    frames = frames.concat(sleeperFrames(opts.inner, step, function (p) {
                        for (var k = 0; k < outerPts.length; k++) if (Math.hypot(p.x - outerPts[k].x, p.z - outerPts[k].z) < 0.25) return true;
                        return false;
                    }));
                    res.sleeperCount = frames.length;
                    AssetLib.load('kyoto_sleeper').then(function (g) {
                        try {
                            if (!isReal(g)) return;
                            var mesh = null;
                            g.traverse(function (o) { if (!mesh && o.isMesh) mesh = o; });
                            if (!mesh || !THREE.InstancedMesh) return;
                            g.updateMatrixWorld(true);
                            var local = mesh.matrixWorld.clone();
                            var im = new THREE.InstancedMesh(mesh.geometry, mesh.material, frames.length);
                            var M = new THREE.Matrix4(), R = new THREE.Matrix4(), Sc = new THREE.Matrix4().makeScale(S, S, S);
                            var y = F + 0.18 * S;            // sleeper bottom 180 mm: top 20 mm proud of the 300 mm ballast
                            frames.forEach(function (f, i) {
                                R.makeRotationY(f.yaw);
                                M.makeTranslation(f.x, y, f.z).multiply(R).multiply(Sc).multiply(local);
                                im.setMatrixAt(i, M);
                            });
                            im.instanceMatrix.needsUpdate = true;
                            im.receiveShadow = true;
                            im.name = 'kyoto-sleepers';
                            scene.add(im);
                            if (opts.fallbackTies) opts.fallbackTies.visible = false;
                            res.sleepers = im;
                        } catch (e) { }
                    });
                } catch (e) { }
                res.holders = holders;
                return res;
            }

            // Set dressing: [name, x, z, rotY, scale, extra] placed on the ground through AssetLib.place.
            function dress(opts) {
                var out = {};
                (opts.items || []).forEach(function (it) {
                    try {
                        out[it.key || it.name] = AssetLib.place(it.name, { x: it.x, y: opts.ground, z: it.z, rotY: it.rotY || 0, scale: it.scale || opts.scale, lod: it.lod });
                    } catch (e) { }
                });
                return out;
            }
            return { track: track, dress: dress, sleeperFrames: sleeperFrames, isReal: isReal };
        })();
        if (typeof window !== 'undefined') window.KyotoSet = KyotoSet;
