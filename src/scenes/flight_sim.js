// Letter Launcher — src/scenes/flight_sim.js
// Scene "FLIGHT SIM" (level): createFlightSimScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // ==================================================================
        // ==== LEVEL 2: FLIGHT SIM (word-driven cross-country hop) =========
        // Pick a destination city, take off, steer with words, then get the
        // GEAR down and FLAPS out to land on its runway.
        // ==================================================================
        function createFlightSimScene() {
            currentScene = 'flight_sim';
            scene.background = new THREE.Color(0x9fd4f5);
            scene.fog = new THREE.FogExp2(0x9fd4f5, 0.0035);
            const F = -5.1;
            const st = {};

            // Rolling countryside
            const terrGeo = new THREE.PlaneGeometry(600, 600, 60, 60);
            terrGeo.rotateX(-Math.PI / 2);
            const tv = terrGeo.attributes.position.array;
            for (let i = 0; i < tv.length; i += 3) {
                const x = tv[i], z = tv[i + 2];
                if (Math.hypot(x, z) > 30) tv[i + 1] = Math.sin(x * 0.03) * Math.cos(z * 0.04) * 2.2;
            }
            terrGeo.computeVertexNormals();
            const terrain = new THREE.Mesh(terrGeo,
                new THREE.MeshPhongMaterial({ color: 0x7fb069, flatShading: true }));
            terrain.position.y = F; scene.add(terrain);

            // Home airfield
            function makeRunway(x, z, yaw) {
                const rw = new THREE.Mesh(new THREE.PlaneGeometry(6, 26),
                    new THREE.MeshPhongMaterial({ color: 0x555555 }));
                rw.rotation.x = -Math.PI / 2; rw.rotation.z = yaw || 0;
                rw.position.set(x, F + 0.06, z); scene.add(rw);
                for (let i = -2; i <= 2; i++) {
                    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.4),
                        new THREE.MeshBasicMaterial({ color: 0xffffff }));
                    stripe.rotation.x = -Math.PI / 2;
                    stripe.position.set(x + Math.sin(yaw || 0) * i * 5, F + 0.07, z + Math.cos(yaw || 0) * i * 5);
                    scene.add(stripe);
                }
                return rw;
            }
            makeRunway(0, 0, 0);
            // LLF-102: control tower, windsocks and approach lights are CAD assets (src/scenes/flight/airfield.js);
            // the primitive tower stays only as the offline fallback and is hidden once the GLB arrives.
            const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 6, 8),
                new THREE.MeshPhongMaterial({ color: 0xdddddd }));
            towerBase.position.set(7, F + 3, 4); scene.add(towerBase);
            const towerTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.4),
                new THREE.MeshPhongMaterial({ color: 0x88bbdd, emissive: 0x000000 }));
            towerTop.position.set(7, F + 6.6, 4); scene.add(towerTop);
            st.towerTop = towerTop;
            st.towerFallback = [towerBase, towerTop];

            // Destination cities on the four compass points
            st.cities = [
                { name: 'OSAKA', pos: new THREE.Vector3(0, F, -115), dirTxt: 'N', color: 0xd45d79 },
                { name: 'PARIS', pos: new THREE.Vector3(115, F, 0), dirTxt: 'E', color: 0x6c8dd6 },
                { name: 'CAIRO', pos: new THREE.Vector3(0, F, 115), dirTxt: 'S', color: 0xd6a44f },
                { name: 'RIO', pos: new THREE.Vector3(-115, F, 0), dirTxt: 'W', color: 0x53b57e }
            ];
            st.cities.forEach(c => {
                for (let i = 0; i < 9; i++) {
                    const h = 3 + Math.random() * 9;
                    const b = new THREE.Mesh(new THREE.BoxGeometry(2.5 + Math.random() * 2, h, 2.5 + Math.random() * 2),
                        new THREE.MeshPhongMaterial({ color: c.color }));
                    b.position.set(c.pos.x + (Math.random() - 0.5) * 26, F + h / 2, c.pos.z + (Math.random() - 0.5) * 26);
                    scene.add(b);
                }
                makeRunway(c.pos.x, c.pos.z, Math.atan2(c.pos.x, c.pos.z));
                const label = makeTextLabel(c.name, 4, 0xffffff);
                label.position.set(c.pos.x, F + 16, c.pos.z);
                label.lookAt(new THREE.Vector3(c.pos.x * 2, F + 16, c.pos.z * 2));
                scene.add(label);
                const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 60, 10, 1, true),
                    new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
                beacon.position.set(c.pos.x, F + 30, c.pos.z);
                beacon.visible = false; scene.add(beacon);
                c.beacon = beacon;
            });

            // LLF-102: CAD airfield props at every runway (home field: lights on both ends)
            try {
                if (typeof Airfield !== 'undefined') {
                    const rws = [{ x: 0, z: 0, yaw: 0, approachBoth: true }].concat(st.cities.map(c => ({ x: c.pos.x, z: c.pos.z, yaw: Math.atan2(c.pos.x, c.pos.z) })));
                    Airfield.build(scene, st, F, rws);   // replaces st.towerTop with a proxy that glows the CAD cab
                    const hideT = () => { if (st.airfield && st.airfield.tower && st.airfield.tower.children.length && !(st.airfield.tower.children[0].userData || {}).cadFallback) st.towerFallback.forEach(m => { m.visible = false; }); else if (st.airfield && currentScene === 'flight_sim') setTimeout(hideT, 600); };
                    setTimeout(hideT, 600);
                }
            } catch (e) { }

            // Season-able forest patches + fields with cows (doodads)
            st.season = 1; // summer green
            [[30, -40], [-45, 25], [50, 45], [-30, -55], [60, -15], [-60, -30]]
                .forEach(tp => makeGameTree(new THREE.Vector3(tp[0], F, tp[1]), 0x2e8b57, st));
            st.fieldPos = new THREE.Vector3(-35, F, 45);

            // The plane
            const plane = new THREE.Group();
            const fusGeo = new THREE.CylinderGeometry(0.5, 0.35, 4.4, 10);
            fusGeo.rotateX(Math.PI / 2);
            plane.add(new THREE.Mesh(fusGeo, new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 0.3, roughness: 0.5 })));
            const noseGeo = new THREE.ConeGeometry(0.42, 0.9, 10);
            noseGeo.rotateX(Math.PI / 2);
            const nose = new THREE.Mesh(noseGeo, new THREE.MeshStandardMaterial({ color: 0xc23b22 }));
            nose.position.z = 2.6; plane.add(nose);
            const wings = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 1.3),
                new THREE.MeshStandardMaterial({ color: 0xc23b22 }));
            wings.position.z = 0.3; plane.add(wings);
            const tailW = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.8),
                new THREE.MeshStandardMaterial({ color: 0xc23b22 }));
            tailW.position.z = -2; plane.add(tailW);
            const tailF = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.9),
                new THREE.MeshStandardMaterial({ color: 0xe8ecf2 }));
            tailF.position.set(0, 0.5, -2); plane.add(tailF);
            const prop = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 0.08),
                new THREE.MeshStandardMaterial({ color: 0x222222 }));
            prop.position.z = 3.05; plane.add(prop);
            st.prop = prop;
            st.gearMeshes = [];
            [[-1, 0.6], [1, 0.6], [0, -1.6]].forEach(gp => {
                const leg = new THREE.Group();
                const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6),
                    new THREE.MeshStandardMaterial({ color: 0x333333 }));
                strut.position.y = -0.25; leg.add(strut);
                const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.15, 8),
                    new THREE.MeshStandardMaterial({ color: 0x111111 }));
                wheel.rotation.z = Math.PI / 2; wheel.position.y = -0.55; leg.add(wheel);
                leg.position.set(gp[0], -0.4, gp[1]);
                plane.add(leg); st.gearMeshes.push(leg);
            });
            st.flapMeshes = [];
            [-2.2, 2.2].forEach(x => {
                const flap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.5),
                    new THREE.MeshStandardMaterial({ color: 0x8a1f14 }));
                flap.position.set(x, -0.02, -0.35); plane.add(flap); st.flapMeshes.push(flap);
            });
            plane.position.set(0, F + 1.0, 8);
            scene.add(plane);
            st.plane = plane;

            // LLF-81: the CAD light aircraft (moving ailerons, elevator, rudder, 4-detent flaps, prop,
            // retracting gear) replaces the primitive plane once its GLB loads, and a real flight model
            // (src/scenes/flight/flight_model.js, aero tables assets/cad/aircraft_aero.json) flies it.
            // Model runs in SI; the map is compressed: KH world units per metre flown, KV per metre of height.
            st.KH = 0.2756; st.KV = 0.04; st.G0 = F + 1.0;
            st.flapDeg = 0; st.stallMsgT = 0; st.wasStalled = false;
            try { st.rig = (typeof AircraftRig !== 'undefined') ? AircraftRig.attach(plane, { legacy: plane.children.slice() }) : null; } catch (e) { st.rig = null; }
            try { st.fm = (typeof FlightModel !== 'undefined') ? FlightModel.create({}) : null; } catch (e) { st.fm = null; }
            try {
                if (st.fm && typeof fetch === 'function') fetch('assets/cad/aircraft_aero.json').then(r => r.ok ? r.json() : null).then(j => {
                    if (j && j.flaps && st.fm && st.phase === 'parked' && gameMode) st.fm = FlightModel.create({ aero: j });
                }).catch(() => { });
            } catch (e) { }
            const KT = 0.514444;
            const hOf = y => (y - st.G0) / st.KV;               // world altitude -> metres AGL
            const cruiseKt = () => st.spdMult > 1 ? 135 : 110;
            function touchdownOutcome(td) {
                const fm = st.fm;
                const j = FlightModel.judgeTouchdown(fm.aero, fm.mass, fm.flaps, td.V, td.sink);
                if (j.ok) {
                    st.phase = 'landed'; fm.ap.mode = 'cruise'; fm.ap.speedHold = null; fm.throttle = 0;
                    puffBurst(plane.position.clone().add(new THREE.Vector3(0, -0.9, 0)), 0xcccccc, 12, 2, { decay: 0.03 });
                    gameBeep(180, 0.5, 'sawtooth', 0.15);
                    gameMsg('Touchdown: ' + j.reason + ' — under 1.3 x Vs (' + Math.round(j.vmax / KT) + ' kt). Greaser!');
                    gameWin('WELCOME TO ' + st.target.name);
                    return;
                }
                if (j.verdict === 'bounce') {
                    puffBurst(plane.position.clone(), 0xcccccc, 8, 1.5, { decay: 0.04 });
                    gameBeep(260, 0.25, 'square', 0.12);
                    gameMsg('BOUNCE! ' + j.reason + '. Going around — more FLAPS, no FAST, then LAND again.');
                } else {
                    puffBurst(plane.position.clone(), 0x555555, 18, 3, { decay: 0.02 });
                    beeps([[90, 0.6, 0, 'sawtooth', 0.25], [60, 0.8, 200, 'sawtooth', 0.2]]);
                    gameMsg('HARD LANDING! ' + j.reason + '. The gear groans — going around to try again.');
                }
                // go-around: full power, climb back to circuit height
                st.phase = 'flying'; st.talt = F + 8;
                fm.touchdown = null; fm.onGround = false; fm.h = Math.max(fm.h, 0.5); fm.gamma = 0.08;
                fm.ap.mode = 'cruise'; fm.ap.altHold = hOf(st.talt); fm.ap.speedHold = cruiseKt() * KT; fm.ap.iSpd = 0.4;
            }

            // Sim state
            st.phase = 'parked';       // parked -> flying -> landing -> landed
            st.heading = Math.PI;      // facing -z (north)
            st.thead = Math.PI;
            st.alt = F + 1.0; st.talt = F + 1.0;
            st.spdMult = 1; st.gear = true; st.flaps = false;
            st.autop = false; st.target = null;
            st.smoke = null; st.turb = 0;

            const fwd = () => new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
            function bearingTo(p) {
                return Math.atan2(p.x - plane.position.x, p.z - plane.position.z);
            }
            function requireFlying(msg2) {
                if (st.phase !== 'flying') { gameMsg(msg2 || 'We are not flying yet. TAKEOFF first.'); return false; }
                return true;
            }
            function setGear(down) {
                st.gear = down;
                if (st.fm) st.fm.gear = down;
                st.gearMeshes.forEach(g2 => tween(800, k => g2.scale.setScalar(down ? k : 1 - k + 0.001)));
                gameBeep(down ? 500 : 700, 0.2, 'square', 0.1);
            }

            setGameMode({
                name: 'FLIGHT SIM',
                objective: "Name a city, take off, fly there, and land with gear down and flaps out.",
                intro: ["A pilot with no destination is a bird with paperwork. Name a city first.","Then take off, steer toward its glowing beacon, and ask for a landing.","Towers are picky: wheels and flaps before touchdown. Type HELP if lost."],
                hints: [
                    { after: 25, text: "Riddle: where do you want to go? Say the name of somewhere far away." },
                    { after: 55, text: "Nudge: pick OSAKA, PARIS, CAIRO or RIO, take off, then turn toward the beacon." },
                    { after: 90, text: "Near answer: T... to leave the ground, G... and F... before the tower lets you L... on the runway." }
                ],
                advancers: ["TAKEOFF|FLY", "LAND|LANDING", "LEFT", "RIGHT", "TURN|AROUND", "HIGHER|CLIMB", "LOWER|DESCEND|DIVE", "FAST|THROTTLE|BOOST", "SLOW|CRUISE", "GEAR|WHEELS", "FLAPS", "AUTOPILOT|AUTO", "OSAKA", "PARIS", "CAIRO", "RIO"],
                words: expandWords({
                    // ---- state advancers -------------------------------------
                    'TAKEOFF|FLY': () => {
                        if (st.phase === 'flying') { gameMsg('Already airborne, captain.'); return; }
                        st.phase = 'flying'; st.talt = F + 13;
                        if (st.fm) { st.fm.ap.mode = 'takeoff'; st.fm.ap.altHold = hOf(st.talt); st.fm.ap.speedHold = null; }
                        beeps([[200, 0.6, 0, 'sawtooth', 0.12], [320, 0.8, 500, 'sawtooth', 0.1]]);
                        gameMsg('Throttle up… rotate… we\'re flying! Pick a destination city by name.');
                        // wheels up once we are actually off the ground (positive climb, the model says airborne)
                        const wheelsUp = () => {
                            if (!gameMode || currentScene !== 'flight_sim' || st.phase !== 'flying' || !st.gear) return;
                            if (st.fm && (st.fm.onGround || st.fm.h < 10)) { setTimeout(wheelsUp, 500); return; }
                            setGear(false); gameMsg('Positive climb — wheels up.');
                        };
                        setTimeout(wheelsUp, 3500);
                    },
                    'LAND|LANDING': () => {
                        if (!requireFlying('Nothing to land — we are on the ground.')) return;
                        if (!st.target) { gameMsg('Land where? Name a destination city first.'); return; }
                        const d = plane.position.distanceTo(st.target.pos);
                        if (d > 30) { gameMsg('Nothing but fields below — ' + st.target.name + ' is still ' + Math.round(d) + ' off.'); return; }
                        if (!st.gear) { gameMsg('The tower waves us off — our wheels are still up! (GEAR)'); return; }
                        if (!st.flaps) { gameMsg('Too fast to touch down. We need drag… (FLAPS)'); return; }
                        st.phase = 'landing';
                        st.landFrom = plane.position.clone();
                        if (st.fm) {
                            // the autopilot flies the descent + flare; touchdown speed and sink decide the outcome
                            st.fm.ap.mode = 'approach'; st.fm.ap.firewall = st.spdMult > 1;
                            st.landH0 = Math.max(1, st.fm.h);
                        } else {
                            const from = plane.position.clone(), to = st.target.pos.clone().setY(F + 1.0);
                            tween(4200, k => {
                                plane.position.lerpVectors(from, to, k);
                                plane.position.y = from.y + (to.y - from.y) * (k * k);
                                st.heading = st.thead = bearingTo(st.target.pos);
                            }, () => { st.phase = 'landed'; gameWin('WELCOME TO ' + st.target.name); });
                        }
                        gameMsg('Flaps ' + st.flapDeg + ', gear down… final approach into ' + st.target.name + '. Touch down under 1.3 x stall speed, gently.');
                    },
                    'LEFT': () => { if (requireFlying()) { st.thead += Math.PI / 4; st.autop = false; gameMsg('Banking left.'); } },
                    'RIGHT': () => { if (requireFlying()) { st.thead -= Math.PI / 4; st.autop = false; gameMsg('Banking right.'); } },
                    'TURN|AROUND': () => { if (requireFlying()) { st.thead += Math.PI; st.autop = false; gameMsg('Coming about — 180.'); } },
                    'HIGHER|CLIMB': () => { if (requireFlying()) { st.talt = Math.min(F + 30, st.talt + 5); if (st.fm) st.fm.ap.altHold = hOf(st.talt); gameMsg('Climbing.'); } },
                    'LOWER|DESCEND|DIVE': () => { if (requireFlying()) { st.talt = Math.max(F + 6, st.talt - 5); if (st.fm) st.fm.ap.altHold = hOf(st.talt); gameMsg('Descending.'); } },
                    'FAST|THROTTLE|BOOST': () => { st.spdMult = 1.9; if (st.fm) { st.fm.ap.speedHold = 135 * KT; st.fm.ap.firewall = true; } gameMsg('Throttle to the firewall!'); },
                    'SLOW|CRUISE': () => { st.spdMult = 1; if (st.fm) { st.fm.ap.speedHold = 110 * KT; st.fm.ap.firewall = false; } gameMsg('Easing back to cruise.'); },
                    'GEAR|WHEELS': () => {
                        setGear(!st.gear);
                        gameMsg(st.gear ? 'Gear down and locked.' : 'Gear up.');
                    },
                    'FLAPS': () => {
                        // four detents: each FLAPS steps 0 -> 10 -> 20 -> 30, and from 30 back to clean
                        const was = st.flaps;
                        st.flapDeg = st.flapDeg >= 30 ? 0 : st.flapDeg + 10;
                        st.flaps = st.flapDeg > 0;
                        if (was !== st.flaps) st.flapMeshes.forEach(f2 => tween(600, k => f2.rotation.x = (st.flaps ? k : 1 - k) * 0.6));
                        const vs = st.fm ? Math.round(FlightModel.vStall(st.fm.aero, st.fm.mass, st.flapDeg) / KT) : 0;
                        gameMsg(st.flaps ? 'Flaps ' + st.flapDeg + ' — slow and steady' + (vs ? ' (stall ' + vs + ' kt).' : '.') : 'Flaps in — clean wing.');
                    },
                    'AUTOPILOT|AUTO': () => {
                        if (!requireFlying()) return;
                        if (!st.target) { gameMsg('Autopilot needs a destination. Name a city.'); return; }
                        st.autop = !st.autop;
                        gameMsg(st.autop ? 'Autopilot ON — tracking ' + st.target.name + '.' : 'Autopilot off, hands on the yoke.');
                    },
                    'OSAKA|PARIS|CAIRO|RIO': () => {
                        // Resolved below in tryGameWords by exact key; this stub is
                        // replaced right after expandWords (kept for the found-list).
                    },
                    // ---- doodads ---------------------------------------------
                    'LOOP': () => {
                        if (!requireFlying()) return;
                        tween(1800, k => { st.plane.rotation.x = -k * Math.PI * 2; });
                        gameMsg('Loop-the-loop! The tower sighs.');
                    },
                    'ROLL|BARREL': () => {
                        if (!requireFlying()) return;
                        tween(1400, k => { st.plane.rotation.z = k * Math.PI * 2; });
                        gameMsg('A crisp barrel roll.');
                    },
                    'WAVE|WAGGLE': () => {
                        tween(1500, k => { st.plane.rotation.z = Math.sin(k * Math.PI * 4) * 0.4 * (1 - k); });
                        gameMsg('Wing-waggle hello!');
                    },
                    'SMOKE|TRAIL': () => {
                        st.smoke = st.smoke ? null : new THREE.Color().setHSL(Math.random(), 0.85, 0.6);
                        gameMsg(st.smoke ? 'Airshow smoke ON.' : 'Smoke off.');
                    },
                    'CLOUD|CLOUDS': () => {
                        for (let i = 0; i < 3; i++) {
                            const cl = new THREE.Group();
                            for (let j = 0; j < 4; j++) {
                                const puff = new THREE.Mesh(new THREE.SphereGeometry(1.4 + Math.random(), 8, 6),
                                    new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
                                puff.position.set((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 2);
                                cl.add(puff);
                            }
                            const base = plane.position.clone().add(fwd().multiplyScalar(30 + i * 18));
                            base.y = plane.position.y + (Math.random() - 0.5) * 5;
                            base.x += (Math.random() - 0.5) * 20;
                            flyby(cl, base, base.clone().add(new THREE.Vector3(18, 0, 0)), 26000);
                        }
                        gameMsg('Puffy clouds drift by.');
                    },
                    'RAIN': () => { setWeather('rain'); skyTo(0x7d93a8, 0x7d93a8); gameMsg('Rain streaks the windscreen.'); },
                    'SNOW': () => { setWeather('snow'); skyTo(0xdfe8f2, 0xdfe8f2); gameMsg('Snow! Mind the icing.'); },
                    'STORM|THUNDER|LIGHTNING': () => {
                        setWeather('rain'); skyTo(0x4a5866, 0x4a5866);
                        setTimeout(() => { if (scene.background) scene.background.setHex(0xffffff); }, 400);
                        beeps([[60, 1.4, 500, 'sawtooth', 0.3]]);
                        gameMsg('CRACK! A storm cell rumbles past.');
                    },
                    'SUN|CLEAR': () => { setWeather(null); skyTo(0x9fd4f5, 0x9fd4f5); gameMsg('Severe clear. Beautiful flying weather.'); },
                    'NIGHT': () => { skyTo(0x101830, 0x101830); gameMsg('Night falls; the cities glitter below.'); },
                    'DAY': () => { skyTo(0x9fd4f5, 0x9fd4f5); gameMsg('Dawn paints the horizon.'); },
                    'RAINBOW': () => {
                        const rb = new THREE.Mesh(new THREE.TorusGeometry(20, 0.7, 8, 40, Math.PI),
                            new THREE.MeshBasicMaterial({ color: 0xff88cc, transparent: true, opacity: 0.5 }));
                        rb.position.set(plane.position.x, F, plane.position.z - 40);
                        scene.add(rb);
                        tween(9000, k => { rb.material.opacity = 0.5 * Math.sin(k * Math.PI); }, () => scene.remove(rb));
                        gameMsg('A rainbow arcs over the fields.');
                    },
                    'BIRD|BIRDS|FLOCK': () => { birdsAcross(plane.position.y - 3); gameMsg('A flock scatters far below.'); },
                    'BALLOON': () => {
                        const bl = new THREE.Group();
                        const env = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8),
                            new THREE.MeshPhongMaterial({ color: 0xd6604f }));
                        env.position.y = 3; bl.add(env);
                        const basket = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1),
                            new THREE.MeshPhongMaterial({ color: 0x8a5a2b }));
                        bl.add(basket);
                        const p0 = plane.position.clone().add(new THREE.Vector3(15, -14, -20));
                        flyby(bl, p0, p0.clone().add(new THREE.Vector3(6, 22, 0)), 14000);
                        gameMsg('A hot-air balloon rises gently.');
                    },
                    'BLIMP|ZEPPELIN': () => {
                        const zp = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8),
                            new THREE.MeshPhongMaterial({ color: 0xb0b8c4 }));
                        zp.scale.set(2.4, 1, 1);
                        const y = plane.position.y + 6;
                        flyby(zp, new THREE.Vector3(plane.position.x - 70, y, plane.position.z - 30),
                            new THREE.Vector3(plane.position.x + 70, y, plane.position.z - 30), 22000);
                        gameMsg('A blimp chugs across the sky.');
                    },
                    'UFO': () => {
                        const ufo = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 0.7, 12),
                            new THREE.MeshStandardMaterial({ color: 0x9be89b, metalness: 0.8, roughness: 0.2 }));
                        const y = plane.position.y + 8;
                        flyby(ufo, new THREE.Vector3(plane.position.x + 60, y, plane.position.z - 40),
                            new THREE.Vector3(plane.position.x - 60, y + 6, plane.position.z - 10), 1600, { spin: true });
                        beeps([[1400, 0.1, 0, 'square', 0.08], [1800, 0.1, 110, 'square', 0.08], [1000, 0.15, 220, 'square', 0.08]]);
                        gameMsg('…nobody will believe the flight log.');
                    },
                    'COW|COWS|MOO': () => {
                        puffBurst(st.fieldPos.clone().add(new THREE.Vector3(0, 1, 0)), 0x8a5a2b, 8, 4, { decay: 0.02 });
                        gameBeep(140, 0.7, 'sawtooth', 0.14);
                        gameMsg('Somewhere below, a cow moos back.');
                    },
                    'TREE|TREES|FOREST': () => cycleSeason(st),
                    'RADIO': () => {
                        beeps([[880, 0.06, 0, 'square', 0.07], [660, 0.06, 90, 'square', 0.07],
                               [880, 0.06, 180, 'square', 0.07], [990, 0.1, 300, 'square', 0.07]]);
                        gameMsg('"…cleared as filed, keep the shiny side up." — tower');
                    },
                    'TOWER': () => {
                        tween(2400, k => st.towerTop.material.emissive.setScalar(Math.abs(Math.sin(k * Math.PI * 3)) * 0.5),
                            () => st.towerTop.material.emissive.setScalar(0));
                        gameMsg('The control tower sweeps its light.');
                    },
                    'FLARE|FLARES': () => {
                        puffBurst(plane.position.clone().add(fwd().multiplyScalar(-3)),
                            () => [0xffdd55, 0xff8833][Math.floor(Math.random() * 2)], 16, 1.5,
                            { gravity: 0.002, decay: 0.03, size: 0.09 });
                        gameMsg('Countermeasures away! (From what, exactly?)');
                    },
                    'STARS|STAR': () => {
                        for (let i = 0; i < 16; i++) fwParticle(
                            plane.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 50, 15 + Math.random() * 10, (Math.random() - 0.5) * 50)),
                            new THREE.Vector3(0, 0, 0), new THREE.Color(0xffffff), { gravity: 0, decay: 0.008, size: 0.1 });
                        gameMsg('Stars wink through the canopy.');
                    },
                    'MOON': () => {
                        const m = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 10),
                            new THREE.MeshBasicMaterial({ color: 0xf5efc9 }));
                        const p0 = plane.position.clone().add(new THREE.Vector3(-60, 5, -80));
                        flyby(m, p0, p0.clone().add(new THREE.Vector3(0, 35, 0)), 12000);
                        gameMsg('The moon climbs alongside.');
                    },
                    'JET': () => {
                        const jet = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3, 6),
                            new THREE.MeshStandardMaterial({ color: 0x666e78, metalness: 0.7, roughness: 0.3 }));
                        jet.rotation.z = -Math.PI / 2;
                        const y = plane.position.y + 4;
                        flyby(jet, new THREE.Vector3(plane.position.x - 90, y, plane.position.z - 15),
                            new THREE.Vector3(plane.position.x + 90, y, plane.position.z - 15), 900);
                        setTimeout(() => gameBeep(50, 0.8, 'sawtooth', 0.35), 700);
                        gameMsg('A jet streaks past — BOOM.');
                    },
                    'KITE': () => {
                        const kite = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4),
                            new THREE.MeshBasicMaterial({ color: 0xff5577, side: THREE.DoubleSide }));
                        kite.rotation.z = Math.PI / 4;
                        const p0 = st.fieldPos.clone();
                        flyby(kite, p0, p0.clone().add(new THREE.Vector3(4, 18, 2)), 7000, { bob: true });
                        gameMsg('A kite dances up from a field.');
                    },
                    'FIREWORK|FIREWORKS': () => {
                        let best = st.cities[0], bd = Infinity;
                        st.cities.forEach(c => { const d = plane.position.distanceTo(c.pos); if (d < bd) { bd = d; best = c; } });
                        detonateFirework(best.pos.clone().add(new THREE.Vector3(0, 20, 0)));
                        gameMsg('Fireworks over ' + best.name + '!');
                    },
                    'WIND|TURBULENCE': () => { st.turb = 140; gameMsg('Bumpy air — hold onto your coffee.'); }
                }),
                update: () => {
                    // City-name targeting (checked directly so each name works)
                    st.prop.rotation.z += (st.phase === 'parked' ? 0.15 : 0.9) * timeScale;
                    if (st.rig && st.phase !== 'flying' && st.phase !== 'landing') st.rig.update({ flapDeg: st.flapDeg, gear: st.gear ? 1 : 0, prop: st.phase === 'parked' ? 0.05 : 0.1 }, timeScale / 60);

                    const fm = st.fm;
                    if (fm && (st.phase === 'flying' || st.phase === 'landing')) {
                        // ---- LLF-81 flight model ---------------------------------------------------
                        const landing = st.phase === 'landing';
                        if (st.autop && st.target && !landing) st.thead = bearingTo(st.target.pos);
                        if (landing && st.target) st.thead = bearingTo(st.target.pos);
                        st.heading += angDiff(st.thead, st.heading) * 0.035 * timeScale;
                        // flaps run out at ~12 deg/s; gusts while WIND is on
                        fm.flaps += Math.max(-0.2, Math.min(0.2, st.flapDeg - fm.flaps)) * timeScale;
                        fm.gustW = st.turb > 0 ? (Math.random() - 0.5) * 7 : 0;
                        if (fm.ap.mode === 'takeoff' && fm.h > 40) { fm.ap.mode = 'cruise'; fm.ap.speedHold = cruiseKt() * KT; }
                        const dt = timeScale / 60 * (landing ? 4 : fm.ap.mode === 'takeoff' ? 2 : 1);   // approach 4x, takeoff 2x: seconds, not minutes
                        const h0 = fm.h, x0 = fm.x;
                        fm.step(dt);
                        if (landing && st.target) {
                            // the compressed map: slide toward the runway as the height comes off
                            const k = Math.min(1, Math.max(0, 1 - fm.h / st.landH0));
                            const tgt = st.target.pos.clone().setY(0);
                            plane.position.x = st.landFrom.x + (tgt.x - st.landFrom.x) * k;
                            plane.position.z = st.landFrom.z + (tgt.z - st.landFrom.z) * k;
                        } else {
                            plane.position.addScaledVector(fwd(), (fm.x - x0) * st.KH * (fm.onGround ? 0.3 : 1));   // ground roll fits the strip
                        }
                        plane.position.y = st.G0 + fm.h * st.KV;
                        plane.rotation.y = st.heading;
                        const turn = angDiff(st.thead, st.heading);
                        const bank = THREE.MathUtils.clamp(turn * 1.2, -0.7, 0.7);
                        plane.rotation.z += (bank - plane.rotation.z) * 0.08 * timeScale;
                        plane.rotation.x = -fm.theta;
                        // stall: buffet shake, nose drop (in the model), a warning horn and a hint
                        if (fm.buffet > 0) {
                            plane.rotation.z += (Math.random() - 0.5) * 0.06 * fm.buffet;
                            plane.rotation.x += (Math.random() - 0.5) * 0.03 * fm.buffet;
                            if (Math.random() < 0.15) gameBeep(1250, 0.05, 'square', 0.05);
                        }
                        if (fm.stalled && !st.wasStalled && !landing) {
                            gameMsg('STALL! ' + Math.round(fm.V / KT) + ' kt is below the ' + Math.round(fm.vStall() / KT) + ' kt stall speed — the nose drops. FAST, FLAPS or LOWER!');
                            beeps([[1250, 0.4, 0, 'square', 0.1], [1250, 0.4, 500, 'square', 0.1]]);
                        }
                        st.wasStalled = fm.stalled;
                        if (st.turb > 0) st.turb -= timeScale;
                        if (st.rig) st.rig.update({
                            aileron: THREE.MathUtils.clamp(turn * 1.5, -1, 1),
                            elevator: THREE.MathUtils.clamp(((fm.ap.thetaCmd || 0) - fm.theta) * 6 + (landing && fm.h < 8 ? 0.4 : 0), -1, 1),
                            rudder: THREE.MathUtils.clamp(turn * 0.5, -1, 1),
                            flapDeg: fm.flaps, gear: st.gear ? 1 : 0, prop: fm.throttle
                        }, timeScale / 60);
                        if (st.smoke && Math.random() < 0.8) fwParticle(
                            plane.position.clone().add(fwd().multiplyScalar(-2.6)),
                            new THREE.Vector3(0, 0, 0), st.smoke,
                            { gravity: 0.0001, decay: 0.006, size: 0.14 });
                        if (fm.touchdown) {
                            const td = fm.touchdown; fm.touchdown = null;
                            if (landing && st.target) touchdownOutcome(td);
                            else if (fm.ap.mode !== 'takeoff' && h0 > 0.5) {
                                puffBurst(plane.position.clone(), 0x555555, 18, 3, { decay: 0.02 });
                                gameMsg('We flew it into a field! The farmer waves us back up. Watch the speed.');
                                fm.onGround = false; fm.h = 1; fm.gamma = 0.1; st.talt = Math.max(st.talt, F + 10);
                                fm.ap.mode = 'cruise'; fm.ap.altHold = hOf(st.talt); fm.ap.speedHold = cruiseKt() * KT;
                            }
                        }
                        if (!landing && (Math.abs(plane.position.x) > 190 || Math.abs(plane.position.z) > 190)) {
                            st.thead = bearingTo(new THREE.Vector3(0, 0, 0));
                            gameMsg('Edge of the chart — turning back toward home field.');
                        }
                    } else if (st.phase === 'flying') {
                        if (st.autop && st.target) st.thead = bearingTo(st.target.pos);
                        st.heading += angDiff(st.thead, st.heading) * 0.035 * timeScale;
                        const spd = 0.26 * st.spdMult * (st.flaps ? 0.6 : 1);
                        plane.position.addScaledVector(fwd(), spd * timeScale);
                        plane.position.y += (st.talt - plane.position.y) * 0.02 * timeScale;
                        plane.rotation.y = st.heading;
                        const bank = THREE.MathUtils.clamp(angDiff(st.thead, st.heading) * 1.2, -0.7, 0.7);
                        plane.rotation.z += (bank - plane.rotation.z) * 0.08 * timeScale;
                        const pitch = THREE.MathUtils.clamp((plane.position.y - st.talt) * 0.05, -0.4, 0.4);
                        plane.rotation.x += (pitch - plane.rotation.x) * 0.08 * timeScale;
                        if (st.turb > 0) {
                            st.turb -= timeScale;
                            plane.position.y += (Math.random() - 0.5) * 0.25;
                            plane.rotation.z += (Math.random() - 0.5) * 0.04;
                        }
                        if (st.smoke && Math.random() < 0.8) fwParticle(
                            plane.position.clone().add(fwd().multiplyScalar(-2.6)),
                            new THREE.Vector3(0, 0, 0), st.smoke,
                            { gravity: 0.0001, decay: 0.006, size: 0.14 });
                        // Keep the flight inside the world
                        if (Math.abs(plane.position.x) > 190 || Math.abs(plane.position.z) > 190) {
                            st.thead = bearingTo(new THREE.Vector3(0, 0, 0));
                            gameMsg('Edge of the chart — turning back toward home field.');
                        }
                    }

                    // Chase camera
                    const behind = plane.position.clone().sub(fwd().multiplyScalar(13));
                    behind.y = plane.position.y + 5.5;
                    targetCameraPos.copy(behind);
                    targetCameraLookAt.copy(plane.position);

                    if (st.target) {
                        const d = Math.round(plane.position.distanceTo(st.target.pos));
                        gameStatus('→ ' + st.target.name + ' (' + st.target.dirTxt + ') · dist ' + d +
                            ' · alt ' + Math.max(0, Math.round(plane.position.y - F)) +
                            ' · gear ' + (st.gear ? 'DOWN' : 'UP') + ' · flaps ' + (st.flaps ? st.flapDeg + '°' : 'IN') +
                            (st.fm && st.phase !== 'parked' ? ' · ' + Math.round(st.fm.V / KT) + ' kt' + (st.fm.stalled ? ' STALL' : '') : '') +
                            (st.autop ? ' · AP' : ''));
                    } else {
                        gameStatus(st.phase === 'parked'
                            ? 'Parked at home field. Destinations: OSAKA N · PARIS E · CAIRO S · RIO W'
                            : 'No destination set — name a city.');
                    }
                }
            });

            // City names need individual handlers (expandWords gave them a stub)
            st.cities.forEach(c => {
                gameMode.words[c.name] = () => {
                    st.target = c;
                    st.cities.forEach(o => { o.beacon.visible = o === c; });
                    gameBeep(760, 0.25, 'triangle', 0.15);
                    gameMsg(c.name + ' set as destination — its beacon glows ' + c.dirTxt + ' of here.');
                };
            });

            setObjective('FLIGHT SIM',
                'Fly to a destination city and land on its runway. The aircraft answers to ' +
                'plain airman\'s words — and towers are picky about landing configuration.');
        }

        SCENES['FLIGHT SIM'] = { build: createFlightSimScene, kind: 'level', menuOrder: 1 };
