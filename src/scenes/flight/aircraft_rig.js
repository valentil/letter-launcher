// Letter Launcher — src/scenes/flight/aircraft_rig.js
// LLF-81: puts the CAD light aircraft (assets/cad/light_aircraft.glb) into the FLIGHT SIM's plane
// group and drives its control surfaces from the joints declared in the recipe / manifest.
// Each jointed node is re-parented under a pivot group placed on its hinge line (kernel-frame mm,
// i.e. inside the exporter's nativecad-root), so a rotation of the pivot swings the surface about
// its real hinge. Until the GLB arrives (or offline) the legacy primitive plane stays visible.
// Classic <script>: declares window.AircraftRig only.

        const AircraftRig = (function () {
            const NAME = 'light_aircraft';
            const SCALE = 0.55;            // 11 m span -> ~6 world units, the size the scene was laid out for
            const D2R = Math.PI / 180;
            // kernel-frame rotation axes (the manifest axes are in the GLB frame: (x, y, z)gl = (x, z, -y)kernel)
            function kernelAxis(a) { return new THREE.Vector3(a[0], -a[2], a[1]).normalize(); }

            function attach(plane, opts) {
                opts = opts || {};
                const rig = {
                    ready: false, model: null, pivots: {}, legacy: opts.legacy || [],
                    cur: { aileron: 0, elevator: 0, rudder: 0, flapDeg: 0, gear: 1 }, propAngle: 0
                };
                rig.update = function (c, dt) { try { update(rig, c || {}, dt || 1 / 60); } catch (e) { } };
                try {
                    if (typeof AssetLib === 'undefined') return rig;
                    AssetLib.load(NAME).then(function (model) {
                        try {
                            if (!model || model.userData.cadFallback || !plane.parent) return;   // keep the legacy plane
                            const holder = new THREE.Group();
                            holder.name = 'cad-aircraft';
                            holder.scale.setScalar(SCALE);
                            // wheels at y = -1 (the scene parks the group 1 unit above the ground), CG near the origin
                            holder.position.set(0, -1.0, -1.2 * SCALE);
                            holder.add(model);
                            plane.add(holder);
                            const root = model.getObjectByName('nativecad-root') || model;
                            const info = AssetLib.info(NAME), joints = (info && info.joints) || [];
                            joints.forEach(function (j) {
                                const node = root.getObjectByName(j.node);
                                if (!node || !j.pivotMm) return;
                                const pivot = new THREE.Group();
                                pivot.name = 'pivot:' + j.node;
                                pivot.position.fromArray(j.pivotMm);
                                node.parent.add(pivot);
                                [j.node].concat(j.carries ? [j.carries] : []).forEach(function (n) {
                                    const o = root.getObjectByName(n);
                                    if (!o) return;
                                    o.position.sub(pivot.position);
                                    pivot.add(o);
                                });
                                rig.pivots[j.node] = { pivot: pivot, axis: kernelAxis(j.axis || [1, 0, 0]), joint: j, base: pivot.position.clone() };
                            });
                            rig.legacy.forEach(function (m) { if (m) m.visible = false; });
                            rig.model = holder; rig.ready = true;
                        } catch (e) { if (window.console) console.warn('[AircraftRig] attach failed', e); }
                    });
                } catch (e) { }
                return rig;
            }

            function setAngle(rig, name, rad) {
                const p = rig.pivots[name];
                if (p) p.pivot.quaternion.setFromAxisAngle(p.axis, rad);
            }
            function approach(cur, target, rate, dt) { const d = target - cur, m = rate * dt; return cur + Math.max(-m, Math.min(m, d)); }

            // c: { aileron -1..1 (+ = roll left), elevator -1..1 (+ = nose up), rudder -1..1 (+ = yaw left),
            //      flapDeg 0..30, gear 0 (up) .. 1 (down), prop 0..1 (throttle) }
            function update(rig, c, dt) {
                const cur = rig.cur;
                cur.aileron = approach(cur.aileron, c.aileron || 0, 3, dt);
                cur.elevator = approach(cur.elevator, c.elevator || 0, 3, dt);
                cur.rudder = approach(cur.rudder, c.rudder || 0, 3, dt);
                cur.flapDeg = approach(cur.flapDeg, c.flapDeg || 0, 12, dt);            // electric flaps ~12 deg/s
                cur.gear = approach(cur.gear, c.gear == null ? 1 : c.gear, 0.6, dt);   // ~1.7 s retract
                rig.propAngle += (4 + 60 * (c.prop || 0)) * dt;
                if (!rig.ready) return;
                // +angle about kernel +X lifts a trailing edge
                setAngle(rig, 'aileron_l', cur.aileron * 18 * D2R);
                setAngle(rig, 'aileron_r', -cur.aileron * 18 * D2R);
                setAngle(rig, 'elevator_l', cur.elevator * 22 * D2R);
                setAngle(rig, 'elevator_r', cur.elevator * 22 * D2R);
                setAngle(rig, 'rudder', -cur.rudder * 24 * D2R);                      // trailing edge to the pilot's left (+X)
                setAngle(rig, 'flap_l', -cur.flapDeg * D2R);
                setAngle(rig, 'flap_r', -cur.flapDeg * D2R);
                setAngle(rig, 'prop', rig.propAngle);
                ['gear_main_l', 'gear_main_r', 'gear_nose'].forEach(function (n) {
                    const p = rig.pivots[n];
                    if (!p) return;
                    const k = Math.max(0.001, cur.gear), travel = (p.joint.max || 0.3) * 1000;
                    p.pivot.scale.setScalar(k);
                    p.pivot.position.copy(p.base).setZ(p.base.z + (1 - cur.gear) * travel * 0.25);
                });
            }

            return { attach: attach, NAME: NAME, SCALE: SCALE };
        })();
        if (typeof window !== 'undefined') window.AircraftRig = AircraftRig;
