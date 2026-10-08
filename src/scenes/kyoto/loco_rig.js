// Letter Launcher — src/scenes/kyoto/loco_rig.js
// LLF-83: puts the NativeCAD C57 (kyoto_c57_chassis + kyoto_c57_motion GLBs, plus the tender) under a
// train-car group and drives its wheels and Walschaerts valve gear from distance rolled, using the pure
// solver in valve_gear.js. Node transforms live under the exporter's `nativecad-root` (kernel frame, mm,
// Z up), so every pose is a rotation about the root's local +Y (the axle direction) plus a translation.
//
//   const rig = KyotoLocoRig.attach(parentGroup, { scale: 0.3 });   // synchronous, AssetLib.place inside
//   rig.update(distanceWorldUnits, gear)   // per frame; cheap no-op until the GLB has swapped in
//   rig.loaded()                           // true once the motion model is rigged
        var KyotoLocoRig = (function () {
            var VG = (typeof KyotoValveGear !== 'undefined') ? KyotoValveGear : null;
            var PARTS = ['coupling_rod', 'main_rod', 'crosshead', 'return_crank', 'eccentric_rod',
                'expansion_link', 'radius_rod', 'combination_lever', 'valve_spindle'];

            function findNode(root, name) {
                var hit = null;
                root.traverse(function (o) { if (!hit && o.name === name) hit = o; });
                return hit;
            }
            function remember(o) {
                if (!o.userData.rest) o.userData.rest = { x: o.position.x, y: o.position.y, z: o.position.z };
                return o;
            }
            // Pose a node rigidly: rotate by phi (CCW in the x-z plane) about p0, then move p0 to p1 (kernel mm).
            function pose(o, p0, p1, phi) {
                var r = o.userData.rest, a = -phi, c = Math.cos(a), s = Math.sin(a);
                var dx = r.x - p0[0], dz = r.z - p0[1];
                o.position.set(p1[0] + dx * c + dz * s, r.y, p1[1] - dx * s + dz * c);
                o.quaternion.setFromAxisAngle(AXIS, a);
            }
            var AXIS = (typeof THREE !== 'undefined') ? new THREE.Vector3(0, 1, 0) : null;

            function rigModel(holder, rig) {
                var G = VG.GEOM, nodes = { wheels: [], parts: [] };
                ['l', 'r'].forEach(function (side) {
                    G.coupledAxles.forEach(function (x, i) {
                        var w = findNode(holder, 'driver_' + (i + 1) + '_' + side);
                        if (w) nodes.wheels.push({ o: remember(w), c: [x, G.driverR], k: 1 });
                    });
                    PARTS.forEach(function (p) {
                        var o = findNode(holder, p + '_' + side);
                        if (o) nodes.parts.push({ o: remember(o), part: p, side: side });
                    });
                });
                return nodes.parts.length ? nodes : null;
            }
            function rigCarrying(holder) {
                var list = [];
                [['lead_1', 4600], ['lead_2', 2400], ['trail', -5000]].forEach(function (d) {
                    ['l', 'r'].forEach(function (side) {
                        var o = findNode(holder, d[0] + '_' + side);
                        if (o) list.push({ o: remember(o), c: [d[1], 430], k: VG.GEOM.driverR / 430 });
                    });
                });
                return list.length ? list : null;
            }

            function attach(parent, opts) {
                opts = opts || {};
                var S = opts.scale || 0.3;
                var mount = new THREE.Group();
                mount.name = 'kyoto-c57';
                mount.scale.setScalar(S);
                mount.rotation.y = -Math.PI / 2;           // kernel +X (forward) -> car local +Z
                mount.position.y = opts.y || 0;
                parent.add(mount);
                var chassis = null, motion = null;
                try {
                    chassis = AssetLib.place('kyoto_c57_chassis', { parent: mount, lod: false });
                    motion = AssetLib.place('kyoto_c57_motion', { parent: mount, lod: false });
                } catch (e) { }
                var rig = { mount: mount, theta: VG ? VG.GEOM.theta0 : 0, gear: 1, nodes: null, carrying: null };
                rig.loaded = function () { return !!rig.nodes; };
                rig.update = function (distWorld, gear) {
                    try {
                        if (!VG) return;
                        if (gear != null) rig.gear = gear;
                        rig.theta += VG.thetaFromDistance((distWorld || 0) * 1000 / S);
                        if (!rig.nodes && motion && motion.children.length) rig.nodes = rigModel(motion, rig);
                        if (!rig.carrying && chassis && chassis.children.length) rig.carrying = rigCarrying(chassis);
                        var dT = rig.theta - VG.GEOM.theta0;
                        if (rig.carrying) rig.carrying.forEach(function (w) { pose(w.o, w.c, w.c, dT * w.k); });
                        if (!rig.nodes) return;
                        rig.nodes.wheels.forEach(function (w) { pose(w.o, w.c, w.c, dT); });
                        ['l', 'r'].forEach(function (side) {
                            var P = VG.poses(rig.theta, rig.gear, side);
                            if (!P) return;
                            rig.nodes.parts.forEach(function (n) {
                                if (n.side !== side) return;
                                var q = P.parts[n.part];
                                if (q) pose(n.o, q.p0, q.p1, q.rot);
                            });
                        });
                    } catch (e) { }
                };
                rig.chassis = chassis; rig.motion = motion;
                return rig;
            }
            return { attach: attach, pose: pose, PARTS: PARTS };
        })();
        if (typeof window !== 'undefined') window.KyotoLocoRig = KyotoLocoRig;
