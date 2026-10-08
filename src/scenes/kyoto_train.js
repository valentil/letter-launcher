// Letter Launcher — src/scenes/kyoto_train.js
// Scene "KYOTO TRAIN" (level): createKyotoTrainScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // ==================================================================
        // ==== LEVEL 1: KYOTO TRAIN (isometric word-driven train puzzle) ===
        // Deliver the Shogun to the palace: stop at his station, get him
        // aboard, switch off the outer line before the stalled school bus,
        // open the palace gates, and stop at the palace on the inner line.
        // ==================================================================
        function createKyotoTrainScene() {
            currentScene = 'kyoto_train';
            scene.background = new THREE.Color(0xcfe8f5);
            scene.fog = new THREE.FogExp2(0xcfe8f5, 0.004);
            const F = -5.1;
            const st = {};
            // LLF-83 diorama scale: 1 world unit = 1/0.3 m of the real C57 (machiya and track fit the same scale).
            const KYOTO_S = 0.3;
            const KYOTO_RAIL_TOP = 0.453 * KYOTO_S;   // ballast 300 mm + 50N rail 153 mm, at scale

            // Ground + pond
            const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
                new THREE.MeshPhongMaterial({ color: 0x9fca8a }));
            ground.rotation.x = -Math.PI / 2; ground.position.y = F;
            ground.receiveShadow = true; scene.add(ground);
            st.pondMat = new THREE.MeshPhongMaterial({ color: 0x3d84b8, shininess: 100, emissive: 0x000000 });
            const pond = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24), st.pondMat);
            pond.rotation.x = -Math.PI / 2; pond.position.set(-12, F + 0.03, 6);
            scene.add(pond);
            st.pondPos = new THREE.Vector3(-12, F + 0.2, 6);

            // Two track lines. Outer loop passes the bus crossing; the inner
            // line cuts across in front of the palace. They share the south arc.
            st.outer = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-18, 0, -12), new THREE.Vector3(0, 0, -16),
                new THREE.Vector3(18, 0, -12), new THREE.Vector3(21, 0, 2),
                new THREE.Vector3(13, 0, 14), new THREE.Vector3(0, 0, 16),
                new THREE.Vector3(-13, 0, 14), new THREE.Vector3(-21, 0, 2)
            ], true, 'catmullrom', 0.5);
            st.inner = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-21, 0, 2), new THREE.Vector3(-13, 0, -3),
                new THREE.Vector3(0, 0, -6), new THREE.Vector3(13, 0, -3),
                new THREE.Vector3(21, 0, 2), new THREE.Vector3(13, 0, 14),
                new THREE.Vector3(0, 0, 16), new THREE.Vector3(-13, 0, 14)
            ], true, 'catmullrom', 0.5);
            st.outerL = st.outer.getLength();
            st.innerL = st.inner.getLength();
            // Rails + ties are BAKED into two merged meshes (one per material)
            // instead of ~700 individual meshes — a huge draw-call saving.
            const railBaker = makeBaker(), tieBaker = makeBaker();
            function layRails(curve) {
                const n = 120;
                const pts = curve.getSpacedPoints(n);
                for (let i = 0; i < n; i++) {
                    const p = pts[i], pn = pts[(i + 1) % n];
                    const dir = new THREE.Vector3().subVectors(pn, p);
                    const len = dir.length(); if (len < 1e-4) continue;
                    dir.normalize();
                    const yaw = Math.atan2(dir.x, dir.z);
                    const nrm = new THREE.Vector3(-dir.z, 0, dir.x);
                    const mx = (p.x + pn.x) / 2, mz = (p.z + pn.z) / 2;
                    [0.55, -0.55].forEach(off => {
                        railBaker.add(new THREE.BoxGeometry(0.14, 0.1, len * 1.1),
                            mx + nrm.x * off, F + 0.15, mz + nrm.z * off, yaw);
                    });
                    if (i % 3 === 0) tieBaker.add(new THREE.BoxGeometry(1.6, 0.08, 0.3), mx, F + 0.09, mz, yaw);
                }
            }
            layRails(st.outer); layRails(st.inner);
            railBaker.bake(new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.5, roughness: 0.5 }));
            tieBaker.bake(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 }));

            // Clearance test so nothing spawns on the rails or in a landmark.
            const trackPts = [];
            [st.outer, st.inner].forEach(c => c.getSpacedPoints(150).forEach(p => trackPts.push(p)));
            const keepOut = [
                [0, -11, 6.5],   // palace
                [0, -8.2, 4],    // palace gates
                [0, -6, 3.5],    // palace crossing
                [0, 18.3, 5.5],  // station platform
                [-12, 6, 6],     // pond
                [15, -17, 5],    // school
                [15, -13.6, 3],  // schoolkids
                [5.5, 18.5, 3],  // torii
                [-5.5, 18.5, 2.5], // statue
                [10, -15, 5]     // bus crossing
            ];
            function isClear(x, z, trackMin) {
                for (const k of keepOut) {
                    if (Math.hypot(x - k[0], z - k[1]) < k[2]) return false;
                }
                for (const p of trackPts) {
                    if (Math.hypot(x - p.x, z - p.z) < trackMin) return false;
                }
                return true;
            }

            // Machiya townhouses: placed procedurally with clearance checks so
            // none clip the rails or landmarks, then BAKED into two meshes
            // (bodies + roofs).
            const housePts = [];
            const houseBodyBaker = makeBaker(), houseRoofBaker = makeBaker();
            let placeTries = 0;
            while (housePts.length < 15 && placeTries++ < 350) {
                const x = (Math.random() - 0.5) * 38;
                const z = (Math.random() - 0.5) * 30 - 1;
                if (!isClear(x, z, 3.6)) continue;
                if (housePts.some(h2 => Math.hypot(h2.x - x, h2.z - z) < 4.4)) continue;
                const w = 2.2 + Math.random() * 1.4, h = 1.8 + Math.random() * 1.2;
                houseBodyBaker.add(new THREE.BoxGeometry(w, h, w), x, F + h / 2, z);
                houseRoofBaker.add(new THREE.ConeGeometry(w * 0.95, h * 0.7, 4),
                    x, F + h + h * 0.35, z, Math.PI / 4);
                housePts.push({ x, z });
            }
            st.houseMesh = houseBodyBaker.bake(new THREE.MeshPhongMaterial({ color: 0xd9c7a7 }));
            st.roofMesh = houseRoofBaker.bake(new THREE.MeshPhongMaterial({ color: 0x3d4750, flatShading: true }));
            st.teahousePos = housePts.length ? new THREE.Vector3(housePts[0].x, F, housePts[0].z)
                                             : new THREE.Vector3(8, F, 6);

            // Palace (multi-tier pagoda) + gates that must be OPENED to win
            const palace = new THREE.Group();
            [[6, 2.4, 0], [4.6, 2.0, 2.4], [3.2, 1.8, 4.4]].forEach(t => {
                const tier = new THREE.Mesh(new THREE.BoxGeometry(t[0], t[1], t[0] * 0.8),
                    new THREE.MeshPhongMaterial({ color: 0xf3ead8 }));
                tier.position.y = t[2] + t[1] / 2; palace.add(tier);
                const roof = new THREE.Mesh(new THREE.ConeGeometry(t[0] * 0.85, 1.1, 4),
                    new THREE.MeshPhongMaterial({ color: 0xa33327, flatShading: true }));
                roof.position.y = t[2] + t[1] + 0.5; roof.rotation.y = Math.PI / 4; palace.add(roof);
            });
            palace.position.set(0, F, -11);
            scene.add(palace);
            st.palace = palace;
            st.gates = [];
            [-1.1, 1.1].forEach((gx, i) => {
                const gate = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.6, 0.2),
                    new THREE.MeshPhongMaterial({ color: 0x7a1f1f }));
                gate.position.set(gx, F + 1.3, -8.2);
                scene.add(gate); st.gates.push({ mesh: gate, dir: i === 0 ? -1 : 1 });
            });
            st.gatesOpen = false;

            // Torii gate near the station + samurai statue + lanterns
            const torii = new THREE.Group();
            const toriiMat = new THREE.MeshPhongMaterial({ color: 0xc23b22 });
            [-1.2, 1.2].forEach(x => {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3, 8), toriiMat);
                post.position.set(x, 1.5, 0); torii.add(post);
            });
            const beam = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 0.36), toriiMat);
            beam.position.y = 3; torii.add(beam);
            const beam2 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 0.3), toriiMat);
            beam2.position.y = 2.3; torii.add(beam2);
            torii.position.set(5.5, F, 18.5);
            scene.add(torii);
            st.torii = torii; st.toriiMat = toriiMat;
            const statue = makeBoxMan(0x6a7d8a, 0x8a9aa8);
            statue.scale.setScalar(1.4);
            statue.position.set(-5.5, F, 18.5);
            scene.add(statue);
            st.statue = statue;
            st.lanterns = [];
            [[-3, 17.5], [3, 17.5], [-16, 2], [16, 2], [-3, -8.5], [3, -8.5]].forEach(lp => {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.6, 6),
                    new THREE.MeshPhongMaterial({ color: 0x333333 }));
                post.position.set(lp[0], F + 0.8, lp[1]); scene.add(post);
                const lampMat = new THREE.MeshPhongMaterial({ color: 0xf7e8c0, emissive: 0x000000 });
                const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lampMat);
                lamp.position.set(lp[0], F + 1.75, lp[1]); scene.add(lamp);
                st.lanterns.push(lampMat);
            });
            st.lanternsOn = false;

            // Station platform + waiting Shogun
            const platform = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 2.2),
                new THREE.MeshPhongMaterial({ color: 0x8d8d8d }));
            platform.position.set(0, F + 0.25, 18.3);
            scene.add(platform);
            st.stationPos = new THREE.Vector3(0, F, 16);
            const shogun = makeBoxMan(0x24365c, 0xd4af37);
            shogun.position.set(1.4, F + 0.5, 18.2);
            scene.add(shogun);
            st.shogun = shogun; st.aboard = false;

            // School + kids near the outer line (WHISTLE makes them step back)
            const school = new THREE.Group();
            const sBody = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 3),
                new THREE.MeshPhongMaterial({ color: 0xe8d28a }));
            sBody.position.y = 1.2; school.add(sBody);
            const sRoof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.4, 4),
                new THREE.MeshPhongMaterial({ color: 0x8a4b32, flatShading: true }));
            sRoof.position.y = 3.1; sRoof.rotation.y = Math.PI / 4; school.add(sRoof);
            school.position.set(15, F, -17);
            scene.add(school);
            st.kids = [];
            for (let i = 0; i < 3; i++) {
                const kid = makeBoxMan([0xd45050, 0x50a0d4, 0xd4c050][i], 0xf2e14c);
                kid.scale.setScalar(0.55);
                kid.position.set(15 + (i - 1) * 1.4, F, -13.6);
                scene.add(kid);
                st.kids.push({ mesh: kid, baseZ: -13.6 });
            }
            st.kidsPos = new THREE.Vector3(15, F, -13.6);
            st.whistleT = 0; st.schoolWarned = false;

            // The stalled school bus on the outer line's north crossing
            const bus = new THREE.Group();
            const busBody = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 1.9),
                new THREE.MeshPhongMaterial({ color: 0xf2b01e }));
            busBody.position.y = 1.3; bus.add(busBody);
            const busStripe = new THREE.Mesh(new THREE.BoxGeometry(5.02, 0.5, 1.92),
                new THREE.MeshPhongMaterial({ color: 0x222222 }));
            busStripe.position.y = 1.6; bus.add(busStripe);
            [[-1.8, 1], [1.8, 1], [-1.8, -1], [1.8, -1]].forEach(wp => {
                const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10),
                    new THREE.MeshPhongMaterial({ color: 0x111111 }));
                wheel.rotation.x = Math.PI / 2;
                wheel.position.set(wp[0], 0.42, wp[1] * 0.95); bus.add(wheel);
            });
            // Parked on the outer line's north-east crossing, near the school
            // (clear of the palace so the two never visually collide).
            st.busBaseX = 10;
            bus.position.set(st.busBaseX, F, -15);
            bus.rotation.y = 0.5;
            scene.add(bus);
            st.bus = bus; st.busHome = 0; st.busAway = 0;
            st.busPos = new THREE.Vector3(st.busBaseX, F, -15);

            // Cherry trees: procedural clearance placement; trunks + foliage
            // baked into ONE mesh each. The foliage material gets a wind-sway
            // vertex shader (onBeforeCompile) so every tree gently waves —
            // zero per-frame JS cost. Season 0 = spring pink.
            st.season = 0;
            st.trees = [];
            const trunkBaker = makeBaker(), leafBaker = makeBaker();
            placeTries = 0;
            while (st.trees.length < 16 && placeTries++ < 450) {
                const x = (Math.random() - 0.5) * 46;
                const z = (Math.random() - 0.5) * 38 - 1;
                if (!isClear(x, z, 3.0)) continue;
                if (housePts.some(h2 => Math.hypot(h2.x - x, h2.z - z) < 3.4)) continue;
                if (st.trees.some(t => Math.hypot(t.pos.x - x, t.pos.z - z) < 3.4)) continue;
                trunkBaker.add(new THREE.CylinderGeometry(0.18, 0.3, 2.2, 6), x, F + 1.1, z);
                for (let i = 0; i < 3; i++) {
                    leafBaker.add(new THREE.SphereGeometry(0.9 + Math.random() * 0.5, 7, 5),
                        x + (Math.random() - 0.5) * 1.2, F + 2.4 + Math.random() * 0.9,
                        z + (Math.random() - 0.5) * 1.2);
                }
                st.trees.push({ pos: new THREE.Vector3(x, F, z), mat: null });
            }
            trunkBaker.bake(new THREE.MeshPhongMaterial({ color: 0x6b4a2f }));
            st.leafShaderStore = {};
            const kyotoLeafMat = makeWindyMaterial(
                new THREE.MeshPhongMaterial({ color: 0xffb7d5 }), F + 1.8, st.leafShaderStore);
            st.leafMesh = leafBaker.bake(kyotoLeafMat);
            st.trees.forEach(t => { t.mat = kyotoLeafMat; });
            st.windBoost = 0;

            // Hidden extras for doodads: Mt Fuji + a moon
            const fuji = new THREE.Mesh(new THREE.ConeGeometry(26, 34, 5),
                new THREE.MeshPhongMaterial({ color: 0x7d8ba8, flatShading: true }));
            const fujiCap = new THREE.Mesh(new THREE.ConeGeometry(9, 10, 5),
                new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true }));
            fujiCap.position.y = 12.5; fuji.add(fujiCap);
            fuji.position.set(-55, F, -85);
            fuji.scale.setScalar(0.001); fuji.visible = false;
            scene.add(fuji);
            st.fuji = fuji; st.fujiUp = false;
            const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12),
                new THREE.MeshBasicMaterial({ color: 0xf5efc9 }));
            moon.position.set(40, -20, -70); moon.visible = false;
            scene.add(moon);
            st.moon = moon; st.moonUp = false;

            // The train: engine + tender + caboose (script-driven, no physics)
            st.cars = []; st.wheels = [];
            function makeTrainCar(len, h, color, isEngine) {
                const g = new THREE.Group();
                // LLF-83: the engine's primitive body is only the fallback until the CAD C57 swaps in.
                const body = isEngine ? new THREE.Group() : g;
                if (isEngine) g.add(body);
                if (isEngine) {
                    const boilerGeo = new THREE.CylinderGeometry(0.55, 0.55, len * 0.6, 12);
                    boilerGeo.rotateX(Math.PI / 2);
                    const boiler = new THREE.Mesh(boilerGeo,
                        new THREE.MeshStandardMaterial({ color: color, metalness: 0.4, roughness: 0.5 }));
                    boiler.position.set(0, 0.95, len * 0.1); body.add(boiler);
                    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, h, len * 0.35),
                        new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: 0.7 }));
                    cab.position.set(0, 0.5 + h / 2, -len * 0.28); body.add(cab);
                    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.8, 8),
                        new THREE.MeshStandardMaterial({ color: 0x111111 }));
                    chimney.position.set(0, 1.7, len * 0.3); body.add(chimney);
                    st.chimneyOffset = new THREE.Vector3(0, 2.1, len * 0.3);
                } else {
                    const carBody = new THREE.Mesh(new THREE.BoxGeometry(1.3, h, len),
                        new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 }));
                    carBody.position.y = 0.5 + h / 2; g.add(carBody);
                }
                [-len * 0.3, len * 0.3].forEach(zz => {
                    [0.62, -0.62].forEach(xx => {
                        const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 10);
                        wheelGeo.rotateZ(Math.PI / 2);
                        const wheel = new THREE.Mesh(wheelGeo,
                            new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
                        wheel.position.set(xx, 0.3, zz); body.add(wheel);
                        st.wheels.push(wheel);
                    });
                });
                g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
                if (isEngine) {
                    st.locoFallback = body;
                    try {
                        // JNR C57 Pacific from NativeCAD at diorama scale (gauge 1067 mm -> rails at +-0.16)
                        if (typeof KyotoLocoRig !== 'undefined') st.loco = KyotoLocoRig.attach(g, { scale: KYOTO_S, y: KYOTO_RAIL_TOP });
                    } catch (e) { st.loco = null; }
                }
                scene.add(g);
                return g;
            }
            st.cars.push(makeTrainCar(3.4, 1.1, 0x2c5545, true));
            st.cars.push(makeTrainCar(2.6, 0.9, 0x222222, false));
            st.cars.push(makeTrainCar(3.0, 1.1, 0xa33327, false));
            st.carGap = 3.6;

            // Sim state
            st.line = 'outer';
            st.u = nearestU(st.outer, new THREE.Vector3(21, 0, 2));
            st.startU = st.u;
            st.spd = 0; st.mult = 1; st.dir = 1; st.vel = 0;
            st.fuel = 1; st.shake = 0; st.crashCd = 0;
            st.stationHinted = false; st.palaceHinted = false;

            const enginePos = () => st.cars[0].position;
            function whistle() {
                beeps([[620, 0.35, 0, 'triangle', 0.2], [830, 0.5, 240, 'triangle', 0.2]]);
                if (st.chimneyOffset) puffBurst(
                    enginePos().clone().add(new THREE.Vector3(0, 2.2, 0)), 0xeeeeee, 10, 0.6,
                    { gravity: -0.0006, decay: 0.02, size: 0.09 });
            }
            function crash() {
                st.spd = 0; st.vel = 0; st.shake = 26; st.crashCd = 90;
                puffBurst(st.busPos.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xff7733, 26, 2.2,
                    { gravity: 0.002, decay: 0.03 });
                beeps([[120, 0.6, 0, 'sawtooth', 0.3], [70, 0.8, 120, 'sawtooth', 0.3]]);
                st.u = st.startU; st.line = 'outer';
                gameMsg('CRASH! The school bus was stalled on the OUTER line. Train reset — try the points…', 6000);
            }
            // Victory sequence: the Shogun dismounts, walks through the open
            // gates under a petal storm while the camera pushes in.
            function kyotoFinale() {
                if (gameMode.won) return;
                const cab = st.cars[st.cars.length - 1];
                const from = new THREE.Vector3(cab.position.x, F, cab.position.z);
                st.aboard = false;
                st.shogun.position.copy(from);
                st.shogun.rotation.y = Math.atan2(0 - from.x, -8.4 - from.z);
                tween(3000, k => {
                    st.shogun.position.lerpVectors(from, new THREE.Vector3(0, F, -8.6), k);
                    st.shogun.position.y = F + Math.abs(Math.sin(k * Math.PI * 8)) * 0.12;
                }, () => tween(1100, k => { st.shogun.rotation.x = Math.sin(k * Math.PI) * 0.55; }));
                setWeather('petals');
                for (let i = 0; i < 6; i++) setTimeout(() =>
                    puffBurst(new THREE.Vector3((Math.random() - 0.5) * 16, F + 5 + Math.random() * 4, -11 + (Math.random() - 0.5) * 6),
                        0xffb7d5, 16, 3, { gravity: 0.0004, decay: 0.01, size: 0.09 }), i * 300);
                st.winCam = true;
                gameWin('THE SHOGUN REACHES THE PALACE');
            }

            setGameMode({
                name: 'KYOTO TRAIN',
                objective: "Get the Shogun aboard, then stop at the palace with the gates open.",
                intro: ["This engine obeys plain words. Type them, and the world answers.","Your passenger, the Shogun, waits at a station. Stop there and call his name.","Stuck? Riddles appear when you idle, or type HELP any time."],
                hints: [
                    { after: 25, text: "Riddle: what does a sleepy little engine need to hear before it chuffs off?" },
                    { after: 55, text: "Nudge: halt beside the Shogun's station, call him by title, then ask the palace doors to open." },
                    { after: 90, text: "Near answer: G... to roll, S... to halt, S... boards the passenger (his title), P... opens the gates. Low on coal? S-T-O-K-E." }
                ],
                advancers: ["GO|START|CHOO|DEPART|ONWARD", "STOP|HALT|BRAKE", "FAST|HURRY|EXPRESS", "SLOW|EASY|GENTLE", "SWITCH|POINTS|TRACKS", "REVERSE|BACK", "SHOGUN", "PALACE|GATES|OPEN", "BUS", "WHISTLE|HORN", "STOKE|COAL|FIRE"],
                words: expandWords({
                    // ---- state advancers -------------------------------------
                    'GO|START|CHOO|DEPART|ONWARD': () => {
                        if (st.crashCd > 0) { gameMsg('The crew is still dusting off…'); return; }
                        if (st.fuel <= 0) { gameMsg('No steam — the coal is spent. STOKE the firebox.'); return; }
                        st.spd = 1; whistle(); gameMsg('The little engine chuffs forward.');
                    },
                    'STOP|HALT|BRAKE': () => {
                        st.spd = 0;
                        const d = enginePos().distanceTo(st.stationPos);
                        if (d < 6 && !st.aboard) gameMsg('Stopped at the station. The SHOGUN awaits your word…');
                        else gameMsg('Brakes squeal. The train halts.');
                        gameBeep(220, 0.4, 'sawtooth', 0.12);
                    },
                    'FAST|HURRY|EXPRESS': () => { st.mult = 1.8; gameMsg('Full steam ahead!'); },
                    'SLOW|EASY|GENTLE': () => { st.mult = 0.6; gameMsg('Easing off the throttle.'); },
                    'SWITCH|POINTS|TRACKS': () => {
                        const to = st.line === 'outer' ? 'inner' : 'outer';
                        const curve = to === 'inner' ? st.inner : st.outer;
                        st.u = nearestU(curve, enginePos());
                        st.line = to;
                        beeps([[300, 0.08, 0, 'square', 0.15], [260, 0.08, 90, 'square', 0.15]]);
                        gameMsg('Clack! Points switched — now on the ' + to.toUpperCase() + ' line.');
                    },
                    'REVERSE|BACK': () => { st.dir *= -1; gameMsg('Reversing gear engaged.'); },
                    'SHOGUN': () => {
                        const d = enginePos().distanceTo(st.stationPos);
                        if (!st.aboard && st.spd === 0 && Math.abs(st.vel) < 0.0002 && d < 6) {
                            st.aboard = true;
                            gameMsg('The Shogun bows and boards the caboose!', 5000);
                            beeps([[523, 0.2, 0, 'triangle', 0.2], [659, 0.3, 180, 'triangle', 0.2]]);
                        } else if (st.aboard) {
                            gameMsg('The Shogun rides with quiet dignity.');
                            tween(700, k => { st.shogun.rotation.x = Math.sin(k * Math.PI) * 0.5; });
                        } else {
                            gameMsg('The Shogun bows from the southern station. Stop there for him.');
                            tween(700, k => { st.shogun.rotation.x = Math.sin(k * Math.PI) * 0.5; });
                        }
                    },
                    'PALACE|GATES|OPEN': () => {
                        if (!st.gatesOpen) {
                            st.gatesOpen = true;
                            st.gates.forEach(g2 => tween(1400, k => {
                                g2.mesh.position.x = g2.dir * (1.1 + k * 1.6);
                                g2.mesh.rotation.y = g2.dir * k * 0.9;
                            }));
                            gameBeep(392, 0.6, 'triangle', 0.18);
                            gameMsg('The palace gates swing open!');
                        } else gameMsg('The gates already stand open, awaiting the Shogun.');
                    },
                    'BUS': () => {
                        beeps([[310, 0.25, 0, 'square', 0.22], [310, 0.25, 320, 'square', 0.22]]);
                        if (st.busAway <= 0) {
                            st.busAway = 650;
                            tween(1500, k => { st.bus.position.x = st.busBaseX + k * 15; });
                            gameMsg('The driver restarts the bus — the crossing clears for a moment!');
                        } else gameMsg('The bus honks back cheerfully.');
                    },
                    'WHISTLE|HORN': () => {
                        whistle();
                        st.whistleT = 620;
                        st.kids.forEach(k2 => tween(900, t =>
                            k2.mesh.position.z = k2.baseZ - t * 2.2));
                        gameMsg('WHOO-WHOO! The schoolchildren step well back from the line.');
                    },
                    'STOKE|COAL|FIRE': () => {
                        st.fuel = 1;
                        puffBurst(enginePos().clone().add(new THREE.Vector3(0, 1.5, 0)), 0xff8833, 12, 0.8,
                            { gravity: -0.0004, decay: 0.03, size: 0.06 });
                        gameMsg('Coal shoveled — the firebox roars back to life.');
                    },
                    // ---- doodads (react, but do not advance the game) --------
                    'TREE|TREES|SAKURA': () => cycleSeason(st),
                    'CHERRY|BLOSSOM|HANAMI|PETALS': () => {
                        if (gameMode.weather === 'petals') { setWeather(null); gameMsg('The petal-fall settles.'); }
                        else { setWeather('petals'); gameMsg('Cherry blossoms drift over the city…'); }
                    },
                    'RAIN': () => { setWeather('rain'); skyTo(0x8fa8bd, 0x8fa8bd); gameMsg('A soft rain falls on Kyoto.'); },
                    'SNOW': () => { setWeather('snow'); skyTo(0xdfe8f2, 0xdfe8f2); gameMsg('Snow hushes the rooftops.'); },
                    'SUN|CLEAR': () => { setWeather(null); skyTo(0xcfe8f5, 0xcfe8f5); gameMsg('The sky clears to blue.'); },
                    'NIGHT': () => {
                        skyTo(0x141c33, 0x141c33);
                        st.lanternsOn = true;
                        st.lanterns.forEach(l => l.emissive.setHex(0xffaa44));
                        gameMsg('Dusk falls; the lanterns glow warm.');
                    },
                    'DAY|DAWN|MORNING': () => {
                        skyTo(0xcfe8f5, 0xcfe8f5);
                        st.lanternsOn = false;
                        st.lanterns.forEach(l => l.emissive.setHex(0x000000));
                        st.moon.visible = false; st.moonUp = false;
                        gameMsg('Morning light returns.');
                    },
                    'FOG|MIST': () => {
                        tween(7000, k => { if (scene.fog) scene.fog.density = 0.004 + Math.sin(k * Math.PI) * 0.02; });
                        gameMsg('Mist curls through the streets…');
                    },
                    'WIND|GUST|BREEZE': () => {
                        st.windBoost = 4; // gusts the foliage wind shader
                        for (let i = 0; i < 22; i++) fwParticle(
                            new THREE.Vector3(-20 + Math.random() * 8, F + 2 + Math.random() * 5, (Math.random() - 0.5) * 26),
                            new THREE.Vector3(0.25 + Math.random() * 0.1, 0.01, 0),
                            new THREE.Color(0xffb7d5), { gravity: 0.0002, decay: 0.012, size: 0.07 });
                        gameMsg('A gust sweeps petals across the rooftops.');
                    },
                    'BIRD|BIRDS|CRANE': () => { birdsAcross(9); gameMsg('Cranes wheel over the city.'); },
                    'CAT': () => {
                        const cat = new THREE.Group();
                        const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.3),
                            new THREE.MeshPhongMaterial({ color: 0x333333 }));
                        body.position.y = 0.15; cat.add(body);
                        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.5, 5),
                            new THREE.MeshPhongMaterial({ color: 0x333333 }));
                        tail.position.set(-0.4, 0.35, 0); tail.rotation.z = 0.7; cat.add(tail);
                        flyby(cat, new THREE.Vector3(-12, F + 3.4, -1), new THREE.Vector3(12, F + 3.4, -1), 3600, { bob: true });
                        beeps([[900, 0.15, 0, 'sine', 0.12], [700, 0.2, 180, 'sine', 0.1]]);
                        gameMsg('A rooftop cat trots by, unimpressed.');
                    },
                    'BELL|TEMPLE': () => {
                        gameBeep(98, 1.8, 'sine', 0.3);
                        tween(1800, k => st.palace.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.03));
                        gameMsg('A temple bell tolls, deep and slow.');
                    },
                    'DRUM|TAIKO': () => {
                        beeps([[80, 0.2, 0, 'sine', 0.35], [80, 0.2, 250, 'sine', 0.35], [60, 0.35, 500, 'sine', 0.4]]);
                        [st.houseMesh, st.roofMesh].forEach((m, i) => {
                            if (m) tween(700 + i * 80, k =>
                                m.position.y = Math.abs(Math.sin(k * Math.PI * 2)) * 0.22 * (1 - k));
                        });
                        gameMsg('Taiko drums — the whole town bounces!');
                    },
                    'LANTERN|LANTERNS|LIGHT': () => {
                        st.lanternsOn = !st.lanternsOn;
                        st.lanterns.forEach(l => l.emissive.setHex(st.lanternsOn ? 0xffaa44 : 0x000000));
                        gameMsg(st.lanternsOn ? 'Paper lanterns flicker alight.' : 'The lanterns are snuffed out.');
                    },
                    'HANABI|FIREWORK|FIREWORKS': () => {
                        detonateFirework(new THREE.Vector3(0, 12, -11));
                        gameMsg('Hanabi! Fireworks bloom over the palace.');
                    },
                    'KOI|FISH': () => {
                        const koi = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 6),
                            new THREE.MeshPhongMaterial({ color: 0xff7733 }));
                        koi.rotation.z = Math.PI / 2;
                        flyby(koi, st.pondPos.clone().add(new THREE.Vector3(-1.5, 0, 0)),
                            st.pondPos.clone().add(new THREE.Vector3(1.5, 0, 0)), 900, { arc: 2 });
                        puffBurst(st.pondPos, 0x66ccff, 10, 1.2, { decay: 0.03 });
                        gameMsg('A koi leaps, flashing orange.');
                    },
                    'GARDEN|FLOWER|FLOWERS': () => {
                        for (let i = 0; i < 4; i++) puffBurst(
                            new THREE.Vector3((Math.random() - 0.5) * 8, F + 0.5, -8 + (Math.random() - 0.5) * 4),
                            () => [0xff6b9d, 0xffd166, 0xa78bfa, 0xff8fa3][Math.floor(Math.random() * 4)],
                            8, 1.5, { gravity: 0.0008, decay: 0.014, size: 0.08 });
                        gameMsg('The palace garden bursts into bloom.');
                    },
                    'TEA': () => {
                        puffBurst(st.teahousePos.clone().add(new THREE.Vector3(0, 3.4, 0)),
                            0xffffff, 8, 0.5, { gravity: -0.0008, decay: 0.012, size: 0.07 });
                        gameMsg('Steam rises from the teahouse. The kettle sings.');
                        gameBeep(1200, 0.5, 'sine', 0.06);
                    },
                    'NINJA': () => {
                        const ninja = makeBoxMan(0x1a1a1a, 0x1a1a1a);
                        ninja.scale.setScalar(0.7);
                        flyby(ninja, new THREE.Vector3(14, F + 3.2, 6), new THREE.Vector3(-14, F + 3.2, 6), 1400, { arc: 1.5 });
                        gameBeep(2000, 0.12, 'sawtooth', 0.05);
                        gameMsg('…did a shadow just cross the rooftops?');
                    },
                    'MONK': () => {
                        const monk = makeBoxMan(0x7a5230, null);
                        monk.scale.setScalar(0.8);
                        flyby(monk, new THREE.Vector3(-10, F, -6), new THREE.Vector3(4, F, -8.5), 9000, { bob: true });
                        gameBeep(880, 1.2, 'sine', 0.08);
                        gameMsg('A monk walks the palace path, bell chiming softly.');
                    },
                    'TORII': () => {
                        tween(2000, k => {
                            const e = Math.sin(k * Math.PI) * 0.6;
                            st.toriiMat.emissive = st.toriiMat.emissive || new THREE.Color(0);
                            st.toriiMat.emissive.setRGB(e, e * 0.15, e * 0.1);
                        });
                        gameMsg('The torii gate glows vermilion.');
                    },
                    'SMOKE|STEAM': () => {
                        for (let i = 0; i < 3; i++) setTimeout(() =>
                            puffBurst(enginePos().clone().add(new THREE.Vector3(0, 2.2, 0)), 0xdddddd, 8, 0.4,
                                { gravity: -0.0008, decay: 0.012, size: 0.11 }), i * 220);
                        gameMsg('The engine blows proud smoke rings.');
                    },
                    'STAR|STARS': () => {
                        for (let i = 0; i < 14; i++) fwParticle(
                            new THREE.Vector3((Math.random() - 0.5) * 40, 12 + Math.random() * 8, -10 - Math.random() * 10),
                            new THREE.Vector3(0, 0, 0), new THREE.Color(0xffffff),
                            { gravity: 0, decay: 0.01, size: 0.1 });
                        gameMsg('Stars prickle awake above the hills.');
                    },
                    'FUJI|MOUNTAIN': () => {
                        st.fujiUp = !st.fujiUp;
                        st.fuji.visible = true;
                        const from = st.fujiUp ? 0.001 : 1, to = st.fujiUp ? 1 : 0.001;
                        tween(2200, k => st.fuji.scale.setScalar(from + (to - from) * k),
                            () => { if (!st.fujiUp) st.fuji.visible = false; });
                        gameMsg(st.fujiUp ? 'The clouds part — Mount Fuji stands on the horizon.' : 'Fuji slips back behind the haze.');
                    },
                    'MOON': () => {
                        st.moonUp = !st.moonUp;
                        st.moon.visible = true;
                        const fy = st.moonUp ? -20 : 26, ty = st.moonUp ? 26 : -20;
                        tween(2600, k => st.moon.position.y = fy + (ty - fy) * k,
                            () => { if (!st.moonUp) st.moon.visible = false; });
                        gameMsg(st.moonUp ? 'A pale moon climbs the sky.' : 'The moon sets beyond the hills.');
                    },
                    'QUAKE|EARTHQUAKE|RUMBLE': () => {
                        st.shake = 20;
                        gameBeep(40, 1.2, 'sawtooth', 0.25);
                        gameMsg('The ground shivers… just a small one.');
                    }
                }),
                update: () => {
                    const curve = st.line === 'outer' ? st.outer : st.inner;
                    const L = st.line === 'outer' ? st.outerL : st.innerL;

                    // Timers
                    if (st.crashCd > 0) st.crashCd -= timeScale;
                    if (st.whistleT > 0) {
                        st.whistleT -= timeScale;
                        if (st.whistleT <= 0) st.kids.forEach(k2 =>
                            tween(900, t => k2.mesh.position.z = k2.baseZ - 2.2 + t * 2.2));
                    }
                    if (st.busAway > 0) {
                        st.busAway -= timeScale;
                        if (st.busAway <= 0) tween(1500, k => { st.bus.position.x = st.busBaseX + 15 - k * 15; });
                    }

                    // Speed with school-zone crawl + coal burn
                    let mult = st.mult;
                    const ep = enginePos();
                    const nearKids = ep.distanceTo(st.kidsPos) < 9;
                    if (nearKids && st.whistleT <= 0 && st.spd > 0) {
                        mult = Math.min(mult, 0.35);
                        if (!st.schoolWarned) {
                            st.schoolWarned = true;
                            gameMsg('Children near the line — the driver crawls. A WHISTLE would warn them.');
                        }
                    } else if (!nearKids) st.schoolWarned = false;
                    if (st.spd > 0 && st.fuel > 0) {
                        st.fuel = Math.max(0, st.fuel - 0.00035 * timeScale);
                        if (st.fuel <= 0) { st.spd = 0; gameMsg('The coal is spent! STOKE the firebox to raise steam.'); }
                    }
                    const targetVel = st.spd * (0.075 * mult * st.dir) / L;
                    st.vel += (targetVel - st.vel) * 0.06 * timeScale;
                    st.u = ((st.u + st.vel * timeScale) % 1 + 1) % 1;

                    // Place cars along the active curve
                    const du = st.carGap / L;
                    st.cars.forEach((car, k) => {
                        let u = ((st.u - k * du) % 1 + 1) % 1;
                        const p = curve.getPointAt(u);
                        const t2 = curve.getTangentAt(u);
                        car.position.set(p.x, F, p.z);
                        car.rotation.y = Math.atan2(t2.x * st.dir, t2.z * st.dir);
                    });
                    st.wheels.forEach(w => { w.rotation.x += st.vel * L * 0.5 * timeScale; });
                    // LLF-83: CAD loco — wheels + Walschaerts valve gear solved from distance rolled;
                    // the reverser (gear) eases toward the running direction.
                    if (st.loco) {
                        try {
                            st.gear = (st.gear == null ? 1 : st.gear) + ((st.dir >= 0 ? 1 : -1) - (st.gear == null ? 1 : st.gear)) * 0.05 * timeScale;
                            st.loco.update(Math.abs(st.vel) * L * timeScale, st.gear);
                            if (st.locoFallback && st.loco.loaded()) st.locoFallback.visible = false;
                        } catch (e) { }
                    }
                    if (Math.abs(st.vel) * L > 0.02 && Math.random() < 0.25)
                        fwParticle(ep.clone().add(new THREE.Vector3(0, 2.2, 0)),
                            new THREE.Vector3(0, 0.05, 0), new THREE.Color(0xcccccc),
                            { gravity: -0.0005, decay: 0.03, size: 0.08 });

                    // Shogun rides the caboose
                    if (st.aboard) {
                        const cab = st.cars[st.cars.length - 1];
                        st.shogun.position.set(cab.position.x, F + 1.6, cab.position.z);
                        st.shogun.rotation.y = cab.rotation.y;
                    }

                    // Crash into the bus (outer line only, while it blocks)
                    if (st.line === 'outer' && st.busAway <= 0 && Math.abs(st.vel) * L > 0.01 &&
                        ep.distanceTo(st.busPos) < 4.5 && st.crashCd <= 0) crash();

                    // Station hint
                    if (!st.aboard && !st.stationHinted && ep.distanceTo(st.stationPos) < 6 &&
                        st.spd === 0 && Math.abs(st.vel) < 0.0002) {
                        st.stationHinted = true;
                        gameMsg('The station master salutes. Someone important is waiting…');
                    }

                    // Win: Shogun aboard, gates open, stopped at the palace
                    // crossing. Hints REPEAT (every ~6s) so the last step is
                    // never a mystery, and being stopped nearby on the wrong
                    // line gets its own nudge.
                    const palaceStop = new THREE.Vector3(0, F, -6);
                    const isStopped = st.spd === 0 && Math.abs(st.vel) < 0.0002;
                    st.palaceHintT = Math.max(0, (st.palaceHintT || 0) - timeScale);
                    if (st.aboard && isStopped && !gameMode.won) {
                        if (ep.distanceTo(palaceStop) < 7) {
                            if (st.gatesOpen) kyotoFinale();
                            else if (st.palaceHintT <= 0) {
                                st.palaceHintT = 380;
                                gameMsg('You have arrived — but the PALACE gates are shut tight.', 5500);
                            }
                        } else if (ep.distanceTo(st.palace.position) < 11 && st.line === 'outer' &&
                                   st.palaceHintT <= 0) {
                            st.palaceHintT = 380;
                            gameMsg('So close! The palace crossing is on the INNER line — SWITCH the points.', 5500);
                        }
                    }

                    // Foliage wind shader: time + gust decay (WIND doodad)
                    if (st.windBoost > 0) st.windBoost = Math.max(0, st.windBoost - 0.02 * timeScale);
                    if (st.leafShaderStore && st.leafShaderStore.shader) {
                        st.leafShaderStore.shader.uniforms.uTime.value = Date.now() * 0.001;
                        st.leafShaderStore.shader.uniforms.uWind.value = 1 + st.windBoost;
                    }
                    // Pond shimmer
                    if (st.pondMat) st.pondMat.emissive.setScalar(0.05 + Math.sin(Date.now() * 0.0016) * 0.04);

                    // Isometric camera with a gentle follow + crash shake;
                    // after the win it pushes in on the palace celebration.
                    if (st.winCam) {
                        targetCameraPos.set(11, 13, 6);
                        targetCameraLookAt.set(0, F + 2.5, -10);
                    } else {
                        targetCameraPos.set(ep.x * 0.22 + 27, 25, ep.z * 0.22 + 27);
                        targetCameraLookAt.set(ep.x * 0.4, F + 1, ep.z * 0.4);
                    }
                    if (st.shake > 0) {
                        st.shake -= timeScale;
                        targetCameraPos.x += (Math.random() - 0.5) * 1.4;
                        targetCameraPos.y += (Math.random() - 0.5) * 1.4;
                    }

                    const coal = Math.round(st.fuel * 100);
                    gameStatus(gameMode.won
                        ? '★ COMPLETE — the Shogun is home. Words still play!'
                        : 'coal ' + coal + '% · ' + st.line.toUpperCase() + ' line · ' +
                          (st.aboard ? 'Shogun ABOARD' : 'Shogun at the station') +
                          (st.gatesOpen ? ' · gates OPEN' : ''));
                }
            });
            setObjective('KYOTO TRAIN',
                'Deliver the Shogun to the palace. The engine obeys plain words — tell it what to do. ' +
                'Mind what blocks the outer line, and closed doors help no one.');
            gameMode.weather = 'petals'; // gentle spring ambience (CHERRY toggles)
        }

        SCENES['KYOTO TRAIN'] = { build: createKyotoTrainScene, kind: 'level', menuOrder: 0 };
