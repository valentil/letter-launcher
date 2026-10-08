// Letter Launcher — src/scenes/waterworks.js
// Scene "WATERWORKS" (level): createWaterworksScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // ==================================================================
        // ==== LEVEL 4: WATERWORKS (buckets, pipes, valves, leaks) =========
        // Route water from the tank through the valve into three buckets.
        // Fill all three to the line without overflowing — and patch any
        // joints that spring a leak along the way.
        // ==================================================================
        function createWaterworksScene() {
            currentScene = 'waterworks';
            scene.background = new THREE.Color(0xb8d4e0);
            scene.fog = new THREE.FogExp2(0xb8d4e0, 0.004);
            const F = -5.1;
            const st = {};

            // Yard: ground, back fence, one season-able tree
            const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
                new THREE.MeshPhongMaterial({ color: 0xa8b08e }));
            ground.rotation.x = -Math.PI / 2; ground.position.y = F; scene.add(ground);
            for (let i = -8; i <= 8; i++) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.2),
                    new THREE.MeshPhongMaterial({ color: 0x9a7b52 }));
                post.position.set(i * 2.6, F + 1.3, -14);
                scene.add(post);
            }
            st.season = 1;
            makeGameTree(new THREE.Vector3(-14, F, -8), 0x2e8b57, st);
            makeGameTree(new THREE.Vector3(14, F, -9), 0x2e8b57, st);

            // Water tank on legs, main pipe, junction + valve wheel
            const pipeMat = new THREE.MeshStandardMaterial({ color: 0x51616e, metalness: 0.6, roughness: 0.4 });
            st.pipeMat = pipeMat;
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3, 14),
                new THREE.MeshStandardMaterial({ color: 0x6e8291, metalness: 0.5, roughness: 0.5 }));
            tank.position.set(0, 7.5, -6); scene.add(tank);
            st.tank = tank;
            [[-1.8, -1.2], [1.8, -1.2], [-1.8, 1.2], [1.8, 1.2]].forEach(lp => {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 11, 6), pipeMat);
                leg.position.set(lp[0], F + 5.55, -6 + lp[1]); scene.add(leg);
            });
            // ---- The pipe MAZE -------------------------------------------
            // TANK → main rotary valve (VALVE / LEFT / RIGHT) → two mains →
            // rotating ELBOWS that multiplex the stream: DOWN into an outer
            // bucket, or ACROSS the diagonal cross-pipes into the center one.
            const Z = -6;
            const wheelMat = new THREE.MeshStandardMaterial({ color: 0xb03a2e, metalness: 0.4, roughness: 0.5 });
            function pipeBetween(ax, ay, bx, by, r) {
                const len = Math.hypot(bx - ax, by - ay);
                const p = new THREE.Mesh(new THREE.CylinderGeometry(r || 0.28, r || 0.28, len, 8), pipeMat);
                p.position.set((ax + bx) / 2, (ay + by) / 2, Z);
                p.rotation.z = -Math.atan2(bx - ax, by - ay);
                scene.add(p);
                return p;
            }
            // Tank stem + main valve housing with the BIG red wheel
            pipeBetween(0, 6.1, 0, 5.5, 0.32);
            const v1Box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), pipeMat);
            v1Box.position.set(0, 5, Z); scene.add(v1Box);
            st.v1Box = v1Box;
            const mainWheel = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.11, 8, 18), wheelMat);
            mainWheel.position.set(0, 5, Z + 0.85); scene.add(mainWheel);
            [0, Math.PI / 2].forEach(a => {
                const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), wheelMat);
                spoke.rotation.z = a; spoke.position.set(0, 5, Z + 0.85);
                mainWheel.attach ? mainWheel.attach(spoke) : scene.add(spoke);
            });
            st.mainWheel = mainWheel;
            // Left/right mains
            pipeBetween(-0.65, 5, -7.35, 5, 0.26);
            pipeBetween(0.65, 5, 7.35, 5, 0.26);
            // Fixed cross-pipes (diagonals into the shared center drop)
            pipeBetween(-6.8, 4.3, -0.5, 3.55, 0.2);
            pipeBetween(6.8, 4.3, 0.5, 3.55, 0.2);
            pipeBetween(0, 3.5, 0, 2.1, 0.24);
            // Outer down-drops below the elbows
            pipeBetween(-8, 3.25, -8, 2.1, 0.24);
            pipeBetween(8, 3.25, 8, 2.1, 0.24);
            // Rotating elbows: a visible pipe ARM swings between DOWN and
            // ACROSS, each with its own little wheel.
            function makeElbow(x, crossSign) {
                const housing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), pipeMat);
                housing.position.set(x, 5, Z); scene.add(housing);
                const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 14), wheelMat);
                wheel.position.set(x, 5, Z + 0.72); scene.add(wheel);
                const arm = new THREE.Group();
                const armPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.7, 8), pipeMat);
                armPipe.position.y = -0.85; arm.add(armPipe);
                arm.position.set(x, 5, Z);
                scene.add(arm);
                return { arm, wheel, crossAngle: crossSign * 1.21, housing };
            }
            st.E1 = makeElbow(-8, 1);
            st.E2 = makeElbow(8, -1);

            // Three branch pipes ending in downspouts over the buckets
            st.buckets = [];
            st.spouts = [];
            const bucketX = [-8, 0, 8];
            bucketX.forEach((bx, i) => {
                const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.35, 8), pipeMat);
                mouth.position.set(bx, 1.95, -6);
                scene.add(mouth);
                st.spouts.push(new THREE.Vector3(bx, 1.8, -6));

                const bucket = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.25, 2.6, 16, 1, true),
                    new THREE.MeshStandardMaterial({ color: 0x8d99a6, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }));
                bucket.position.set(bx, F + 1.3, -6);
                scene.add(bucket);
                const bottom = new THREE.Mesh(new THREE.CircleGeometry(1.25, 16),
                    new THREE.MeshStandardMaterial({ color: 0x7d8994, side: THREE.DoubleSide }));
                bottom.rotation.x = -Math.PI / 2;
                bottom.position.set(bx, F + 0.02, -6);
                scene.add(bottom);
                const fillLine = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.045, 6, 24),
                    new THREE.MeshBasicMaterial({ color: 0xffffff }));
                fillLine.rotation.x = Math.PI / 2;
                fillLine.position.set(bx, F + 2.47, -6);
                scene.add(fillLine);
                const waterMat = new THREE.MeshPhongMaterial({ color: 0x3d9be9, transparent: true, opacity: 0.85, emissive: 0x000000 });
                const water = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.2, 1, 16), waterMat);
                water.position.set(bx, F + 0.05, -6);
                water.scale.y = 0.02;
                scene.add(water);
                st.buckets.push({ x: bx, water, waterMat, mesh: bucket });
            });
            st.leakJoints = [
                new THREE.Vector3(0, 5, -6),    // main valve
                new THREE.Vector3(-8, 5, -6),   // left elbow
                new THREE.Vector3(8, 5, -6)     // right elbow
            ];

            // Sim state: main valve (L/R) + two elbow multiplexers (down/cross)
            st.flowing = false; st.rate = 1;
            st.pressure = false; st.fills = [0, 0, 0];
            st.leak = -1; st.duck = null;
            st.main = 'L'; st.e1 = 'down'; st.e2 = 'down';
            // The route the water CURRENTLY takes: waypoints in the pipe plane
            // plus the bucket it will end in. Drops snapshot this when they
            // spawn, so in-flight water keeps flowing the old way after you
            // turn a valve — properly "flowy".
            function currentPath() {
                const pts = [[0, 6], [0, 5]];
                if (st.main === 'L') {
                    pts.push([-8, 5]);
                    if (st.e1 === 'down') { pts.push([-8, 1.9]); return { pts, bucket: 0 }; }
                    pts.push([-4, 3.7], [0, 3.5], [0, 1.9]); return { pts, bucket: 1 };
                }
                pts.push([8, 5]);
                if (st.e2 === 'down') { pts.push([8, 1.9]); return { pts, bucket: 2 }; }
                pts.push([4, 3.7], [0, 3.5], [0, 1.9]); return { pts, bucket: 1 };
            }
            const routeName = () =>
                'TANK→' + (st.main === 'L' ? 'LEFT' : 'RIGHT') + '→' +
                ((st.main === 'L' ? st.e1 : st.e2) === 'down' ? 'DOWN' : 'ACROSS') +
                '→' + ['L', 'M', 'R'][currentPath().bucket] + ' bucket';
            function clankBeep() {
                beeps([[420, 0.1, 0, 'square', 0.12], [380, 0.12, 120, 'square', 0.12]]);
            }
            function setMain(side) {
                st.main = side;
                tween(700, k => { st.mainWheel.rotation.z += 0.09; });
                clankBeep();
                gameMsg('The big wheel groans — main flow to the ' + (side === 'L' ? 'LEFT' : 'RIGHT') + '. Route: ' + routeName());
            }
            function toggleElbow(E, key) {
                st[key] = st[key] === 'down' ? 'cross' : 'down';
                const to = st[key] === 'down' ? 0 : E.crossAngle;
                const from = E.arm.rotation.z;
                tween(700, k => {
                    E.arm.rotation.z = from + (to - from) * k;
                    E.wheel.rotation.z += 0.12;
                });
                clankBeep();
                gameMsg('The elbow swings ' + (st[key] === 'down' ? 'DOWN' : 'ACROSS') + '. Route: ' + routeName());
            }
            // Path-following particle water (pooled droplet meshes)
            st.dropPool = [];
            st.spawnAcc = 0;
            const dropGeo = new THREE.SphereGeometry(0.1, 6, 5);
            const dropMat = new THREE.MeshBasicMaterial({ color: 0x59b7ff, transparent: true, opacity: 0.9 });
            function spawnDrop() {
                let d = st.dropPool.find(d2 => !d2.active);
                if (!d) {
                    if (st.dropPool.length >= 140) return;
                    d = { mesh: new THREE.Mesh(dropGeo, dropMat), active: false };
                    scene.add(d.mesh);
                    st.dropPool.push(d);
                }
                const route = currentPath();
                d.active = true; d.mesh.visible = true;
                d.pts = route.pts; d.bucket = route.bucket;
                d.seg = 0; d.t = 0; d.fall = false; d.vy = 0;
                d.x = route.pts[0][0] + (Math.random() - 0.5) * 0.18;
                d.y = route.pts[0][1];
            }
            function splash(bx, big) {
                puffBurst(new THREE.Vector3(bx, F + 2.6, -6), 0x66bbff, big ? 26 : 12, 1.6,
                    { gravity: 0.003, decay: 0.03, size: 0.08 });
                gameBeep(big ? 200 : 600, 0.3, 'sine', big ? 0.2 : 0.1);
            }

            // ---- LLF-84: levels 2 and 3 — flow-target puzzles on a CAD pump station -----------------
            // Level 1 (the bucket path puzzle above) is unchanged. Winning it opens the pump station:
            // WaterNet (Hardy-Cross network) is re-solved when a gate valve or the motor toggles.
            st.stage = 1; st.goalHold = 0; st.station = null;
            try {
                if (window.WaterStation && window.WaterNet && window.WaterParts)
                    st.station = window.WaterStation.create({ scene: scene, F: F });
            } catch (err) { st.station = null; if (window.console) console.warn('[WATERWORKS] station unavailable', err); }
            const PCT = o => Math.round(o * 100) + '%';
            function stationLine() {
                const g = st.station.goals().map(x => x.label + ' ' + x.lps.toFixed(1) + '/' + x.need + ' L/s').join(' · ');
                return g + ' · gauge ' + st.station.pressure().toFixed(1) + ' m';
            }
            function stationGoalHtml() {
                const def = window.WaterNet.STAGES[st.stage - 2];
                return def.blurb + ' Goal: ' + def.goals.map(g => g.label + ' \u2265 ' + g.minLps + ' L/s').join(' and ') +
                    '. Type GATE, SLUICE' + (def.valves.length > 2 ? ', BYPASS' : '') + ' to step a gate valve (closed, 25, 50, 100%)' +
                    (def.pump ? ', MOTOR to start the pump' : '') + ', GAUGE to read the dial.';
            }
            function advanceStage() {
                st.flowing = false;
                if (!st.station || st.stage >= 3) { gameWin('MASTER PLUMBER'); return; }
                st.stage++; st.goalHold = 0;
                st.station.setStage(st.stage - 2);
                const def = window.WaterNet.STAGES[st.stage - 2];
                setObjective('WATERWORKS \u2014 ' + def.title, stationGoalHtml());
                beeps([[523, 0.12, 0, 'triangle', 0.2], [659, 0.12, 120, 'triangle', 0.2], [784, 0.2, 240, 'triangle', 0.2]]);
                gameMsg(def.title + ': ' + def.blurb, 7000);
            }
            function stationValve(n) {
                if (st.stage < 2 || !st.station) { gameMsg('Fill the three buckets first \u2014 then the pump station opens.'); return; }
                const r = st.station.cycle(n);
                if (!r) { gameMsg('There is no gate valve ' + (n + 1) + ' on this line.'); return; }
                clankBeep();
                gameMsg('Gate ' + r.id + ' \u2192 ' + PCT(r.opening) + '. ' + stationLine());
            }
            function stationMotor() {
                if (st.stage < 2 || !st.station) { gameMsg('Fill the three buckets first \u2014 then the pump station opens.'); return; }
                const on = st.station.toggleMotor();
                if (on === null) { gameMsg('This line runs from the header tank \u2014 no motor to start.'); return; }
                gameBeep(on ? 180 : 120, 0.4, 'sawtooth', 0.14);
                gameMsg((on ? 'Motor ON \u2014 the pump spins up. ' : 'Motor OFF. ') + stationLine());
            }
            function stationRead() {
                if (st.stage < 2 || !st.station) { gameMsg('No gauge yet \u2014 beat the bucket level first.'); return; }
                gameMsg('Gauge: ' + stationLine() + ' \u00b7 gates ' + st.station.openings().map(PCT).join(' / '));
            }

            setGameMode({
                name: 'WATERWORKS',
                objective: "Fill all three buckets to the white line.",
                intro: ["A full tank is useless until someone opens the door. Make the water run.","Spin the big valve and swing the elbows to steer the stream into a bucket.","Leaks happen; patch them. Type HELP if lost."],
                hints: [
                    { after: 25, text: "Riddle: which word makes a tank pour?" },
                    { after: 55, text: "Nudge: start the flow, turn the valve, then rotate the elbow until water lands in a bucket." },
                    { after: 90, text: "Near answer: W... starts the flow, V... picks a main, R... turns the elbow, F... patches leaks, D... dumps an overflow." }
                ],
                advancers: ["WATER|FLOW|POUR|OPEN", "STOP|OFF|SHUT|CLOSE", "VALVE|TURN", "LEFT", "RIGHT", "ROTATE|ELBOW|SPIN", "CRANK|WHEEL", "MIDDLE|CENTER|CENTRE", "PUMP|FAST|MORE", "SLOW|TRICKLE|GENTLE|LESS", "NORMAL|STEADY", "PRESSURE|BLAST|SURGE", "DRAIN|EMPTY|DUMP", "FIX|PATCH|WRENCH|REPAIR", "GATE|ALPHA|FIRST", "SLUICE|BRAVO|SECOND", "BYPASS|RETURN|THIRD", "MOTOR|PRIME|ENGINE", "GAUGE|DIAL|READ"],
                words: expandWords({
                    // ---- state advancers -------------------------------------
                    'WATER|FLOW|POUR|OPEN': () => {
                        if (st.flowing) { gameMsg('The water already runs.'); return; }
                        st.flowing = true;
                        gameBeep(500, 0.4, 'sine', 0.12);
                        gameMsg('Water rushes into the maze! Route: ' + routeName());
                    },
                    'STOP|OFF|SHUT|CLOSE': () => {
                        st.flowing = false;
                        gameBeep(300, 0.3, 'sine', 0.1);
                        gameMsg('The flow gurgles to a stop.');
                    },
                    'VALVE|TURN': () => setMain(st.main === 'L' ? 'R' : 'L'),
                    'LEFT': () => setMain('L'),
                    'RIGHT': () => setMain('R'),
                    'ROTATE|ELBOW|SPIN': () => toggleElbow(st.E1, 'e1'),
                    'CRANK|WHEEL': () => toggleElbow(st.E2, 'e2'),
                    'MIDDLE|CENTER|CENTRE': () => {
                        gameMsg('No direct line feeds the middle bucket — an elbow must send water ACROSS.');
                    },
                    'PUMP|FAST|MORE': () => { st.rate = 2; gameMsg('Pump engaged — double flow!'); },
                    'SLOW|TRICKLE|GENTLE|LESS': () => { st.rate = 0.5; gameMsg('Down to a careful trickle.'); },
                    'NORMAL|STEADY': () => { st.rate = 1; st.pressure = false; gameMsg('Steady, ordinary flow.'); },
                    'PRESSURE|BLAST|SURGE': () => {
                        st.pressure = !st.pressure;
                        gameMsg(st.pressure ? 'PRESSURE OVERDRIVE — fast, but the old joints groan…' : 'Pressure released. The pipes sigh with relief.');
                        gameBeep(st.pressure ? 750 : 350, 0.3, 'square', 0.14);
                    },
                    'DRAIN|EMPTY|DUMP': () => {
                        const bi = currentPath().bucket;
                        st.fills[bi] = 0;
                        splash(st.buckets[bi].x, false);
                        gameMsg('The ' + ['LEFT', 'MIDDLE', 'RIGHT'][bi] + ' bucket (current route) drains out.');
                    },
                    'FIX|PATCH|WRENCH|REPAIR': () => {
                        if (st.leak < 0) { gameMsg('Nothing is leaking. The plumber nods, satisfied.'); return; }
                        puffBurst(st.leakJoints[st.leak], 0xffd166, 10, 0.5, { decay: 0.03 });
                        st.leak = -1;
                        beeps([[500, 0.08, 0, 'square', 0.15], [500, 0.08, 130, 'square', 0.15], [700, 0.15, 260, 'square', 0.15]]);
                        gameMsg('Clang, clang — the joint is patched tight!');
                    },
                    // ---- level 2-3 pump station (LLF-84) -----------------------------
                    'GATE|ALPHA|FIRST': () => stationValve(0),
                    'SLUICE|BRAVO|SECOND': () => stationValve(1),
                    'BYPASS|RETURN|THIRD': () => stationValve(2),
                    'MOTOR|PRIME|ENGINE': () => stationMotor(),
                    'GAUGE|DIAL|READ': () => stationRead(),
                    // ---- doodads ---------------------------------------------
                    'BUBBLE|BUBBLES': () => {
                        st.buckets.forEach(b => {
                            if (st.fills[st.buckets.indexOf(b)] > 0.1)
                                puffBurst(new THREE.Vector3(b.x, F + 0.5 + st.fills[st.buckets.indexOf(b)] * 2.4, -6),
                                    0xd7f0ff, 8, 0.8, { gravity: -0.001, decay: 0.02, size: 0.07 });
                        });
                        gameMsg('Blub blub blub.');
                    },
                    'SPLASH': () => { st.buckets.forEach(b => splash(b.x, false)); gameMsg('Splish splash!'); },
                    'DUCK': () => {
                        if (st.duck) { tween(800, k => st.duck.rotation.y = k * Math.PI * 2); gameMsg('The duck spins happily.'); return; }
                        let bi = 0; st.fills.forEach((f2, i) => { if (f2 > st.fills[bi]) bi = i; });
                        const duck = new THREE.Group();
                        const dBody = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6),
                            new THREE.MeshPhongMaterial({ color: 0xffd21e }));
                        duck.add(dBody);
                        const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
                            new THREE.MeshPhongMaterial({ color: 0xffd21e }));
                        dHead.position.set(0.3, 0.35, 0); duck.add(dHead);
                        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6),
                            new THREE.MeshPhongMaterial({ color: 0xff8833 }));
                        beak.rotation.z = -Math.PI / 2; beak.position.set(0.55, 0.32, 0); duck.add(beak);
                        duck.position.set(st.buckets[bi].x, F + 3.6, -6);
                        scene.add(duck);
                        st.duck = duck; st.duckBucket = bi;
                        beeps([[900, 0.1, 0, 'square', 0.12], [700, 0.12, 140, 'square', 0.12]]);
                        gameMsg('A rubber duck plops into the fullest bucket!');
                    },
                    'FISH': () => {
                        const fish = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 6),
                            new THREE.MeshPhongMaterial({ color: 0xff8844 }));
                        fish.rotation.z = Math.PI / 2;
                        const a = st.buckets[0], b = st.buckets[2];
                        flyby(fish, new THREE.Vector3(a.x, F + 2.4, -6), new THREE.Vector3(b.x, F + 2.4, -6), 1400, { arc: 3 });
                        splash(a.x, false); setTimeout(() => splash(b.x, false), 1300);
                        gameMsg('A fish?! It arcs from bucket to bucket.');
                    },
                    'STEAM': () => {
                        st.buckets.forEach(b => puffBurst(new THREE.Vector3(b.x, F + 2.8, -6),
                            0xffffff, 6, 0.8, { gravity: -0.0009, decay: 0.012, size: 0.09 }));
                        gameMsg('The water steams gently. Bath temperature.');
                    },
                    'ICE|FREEZE|COLD': () => {
                        st.buckets.forEach(b => b.waterMat.color.setHex(0xa8e0f5));
                        gameMsg('Brrr — the water turns glacier blue.');
                    },
                    'WARM|HOT': () => {
                        st.buckets.forEach(b => b.waterMat.color.setHex(0x3d9be9));
                        gameMsg('The water warms back to friendly blue.');
                    },
                    'GLOW|NEON': () => {
                        st.buckets.forEach(b => b.waterMat.emissive.setHex(
                            b.waterMat.emissive.getHex() ? 0x000000 : 0x1a86d4));
                        gameMsg('The water glows like something from a lagoon.');
                    },
                    'RAIN': () => { setWeather('rain'); skyTo(0x8fa8b8, 0x8fa8b8); gameMsg('Rain — free water, wrong buckets.'); },
                    'SNOW': () => { setWeather('snow'); skyTo(0xe4ecf2, 0xe4ecf2); gameMsg('Snowflakes settle on the pipes.'); },
                    'SUN|CLEAR': () => { setWeather(null); skyTo(0xb8d4e0, 0xb8d4e0); gameMsg('Sunshine glitters on the water.'); },
                    'NIGHT': () => { skyTo(0x1c2636, 0x1c2636); gameMsg('Night shift at the waterworks.'); },
                    'DAY': () => { skyTo(0xb8d4e0, 0xb8d4e0); gameMsg('Morning at the waterworks.'); },
                    'RUST|OLD': () => { st.pipeMat.color.setHex(0x8a5a3a); gameMsg('The pipes look suddenly… antique.'); },
                    'PAINT|NEW': () => {
                        st.pipeMat.color.setHSL(Math.random(), 0.6, 0.5);
                        gameMsg('Fresh coat of paint! Regulation? Unclear.');
                    },
                    'WAVE|SLOSH': () => {
                        st.buckets.forEach((b, i) => tween(1200, k =>
                            b.water.rotation.z = Math.sin(k * Math.PI * 4 + i) * 0.15 * (1 - k)));
                        gameMsg('The buckets slosh side to side.');
                    },
                    'FROG': () => {
                        const frog = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
                            new THREE.MeshPhongMaterial({ color: 0x4caf50 }));
                        flyby(frog, new THREE.Vector3(-11, F + 2.6, -6), new THREE.Vector3(11, F + 2.6, -6), 2600, { bob: true });
                        beeps([[300, 0.12, 0, 'sawtooth', 0.12], [260, 0.15, 400, 'sawtooth', 0.12], [300, 0.12, 900, 'sawtooth', 0.12]]);
                        gameMsg('Ribbit. A frog hops the bucket rims like stepping stones.');
                    },
                    'SOAP|FOAM': () => {
                        puffBurst(st.tank.position.clone().add(new THREE.Vector3(0, 1.8, 0)),
                            0xffffff, 22, 2.2, { gravity: -0.0004, decay: 0.01, size: 0.13 });
                        gameMsg('Foam boils out of the tank. Who put soap in there?!');
                    },
                    'TAP|DRIP': () => {
                        beeps([[1400, 0.05, 0, 'sine', 0.12], [1400, 0.05, 500, 'sine', 0.12], [1400, 0.05, 1000, 'sine', 0.12]]);
                        for (let i = 0; i < 3; i++) setTimeout(() =>
                            fwParticle(st.spouts[currentPath().bucket].clone(), new THREE.Vector3(0, -0.1, 0),
                                new THREE.Color(0x66bbff), { gravity: 0.004, decay: 0.04, size: 0.07 }), i * 500);
                        gameMsg('Drip… drip… drip. The most patient sound in plumbing.');
                    },
                    'PLUMBER': () => {
                        const wrench = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.3),
                            new THREE.MeshStandardMaterial({ color: 0xc0c8d4, metalness: 0.8, roughness: 0.3 }));
                        wrench.position.set(0, 3.2, -5.2);
                        scene.add(wrench);
                        tween(1800, k => { wrench.rotation.z = k * Math.PI * 4; wrench.position.y = 3.2 + Math.sin(k * Math.PI) * 1; },
                            () => scene.remove(wrench));
                        gameMsg('The plumber twirls a wrench in salute.');
                    },
                    'PIPE|PIPES|CLANK': () => {
                        tween(900, k => { st.v1Box.position.x = Math.sin(k * Math.PI * 6) * 0.08 * (1 - k); });
                        beeps([[220, 0.1, 0, 'square', 0.15], [180, 0.12, 150, 'square', 0.15]]);
                        gameMsg('CLANK. The pipes rattle ominously, then settle.');
                    },
                    'TANK': () => {
                        tween(1400, k => st.tank.rotation.z = Math.sin(k * Math.PI * 3) * 0.06 * (1 - k));
                        gameBeep(90, 0.6, 'sine', 0.18);
                        gameMsg('The big tank sloshes like a drum.');
                    },
                    'WHIRLPOOL|VORTEX': () => {
                        let bi = 0; st.fills.forEach((f2, i) => { if (f2 > st.fills[bi]) bi = i; });
                        const bx = st.buckets[bi].x;
                        for (let i = 0; i < 20; i++) {
                            const a = i * 0.7;
                            fwParticle(new THREE.Vector3(bx + Math.cos(a) * 0.9, F + 0.6 + st.fills[bi] * 2 , -6 + Math.sin(a) * 0.9),
                                new THREE.Vector3(-Math.sin(a) * 0.06, 0, Math.cos(a) * 0.06),
                                new THREE.Color(0x3d9be9), { gravity: 0, decay: 0.02, size: 0.07 });
                        }
                        gameMsg('A tiny whirlpool spins up. Mesmerizing.');
                    },
                    'RAINBOW|MIST': () => {
                        const rb = new THREE.Mesh(new THREE.TorusGeometry(9, 0.35, 8, 40, Math.PI),
                            new THREE.MeshBasicMaterial({ color: 0xffaad4, transparent: true, opacity: 0.45 }));
                        rb.position.set(0, F + 1, -8);
                        scene.add(rb);
                        tween(7000, k => rb.material.opacity = 0.45 * Math.sin(k * Math.PI), () => scene.remove(rb));
                        gameMsg('Mist catches the light — a little rainbow arcs the rig.');
                    },
                    'GURGLE': () => {
                        beeps([[160, 0.1, 0, 'sine', 0.15], [200, 0.1, 100, 'sine', 0.15],
                               [140, 0.1, 220, 'sine', 0.15], [240, 0.15, 340, 'sine', 0.15]]);
                        puffBurst(new THREE.Vector3(0, 4.4, -6), 0xd7f0ff, 6, 0.4, { gravity: -0.001, decay: 0.03, size: 0.06 });
                        gameMsg('The pipes gurgle a little tune.');
                    },
                    'FOUNTAIN': () => {
                        for (let i = 0; i < 24; i++) fwParticle(
                            new THREE.Vector3(0, 5.8, -6),
                            new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.22 + Math.random() * 0.08, (Math.random() - 0.5) * 0.08),
                            new THREE.Color(0x66bbff), { gravity: 0.004, decay: 0.02, size: 0.08 });
                        gameBeep(700, 0.4, 'sine', 0.1);
                        gameMsg('The junction burps a proud little fountain.');
                    },
                    'BIRD': () => {
                        birdsAcross(6);
                        gameMsg('A bird settles on the tank, supervising.');
                    },
                    'TREE|TREES': () => cycleSeason(st)
                }),
                update: () => {
                    // ---- Particle water: each drop follows its own snapshot
                    // of the pipe route, then free-falls into a bucket. Fill
                    // level rises because water ARRIVES, not by abstract rate.
                    if (st.flowing) {
                        st.spawnAcc += (st.rate === 2 ? 2.0 : st.rate === 0.5 ? 0.55 : 1.1) *
                            (st.pressure ? 1.8 : 1) * timeScale;
                        while (st.spawnAcc >= 1) { st.spawnAcc -= 1; spawnDrop(); }
                        // Random leaks; pressure overdrive makes them 3x likelier
                        if (st.leak < 0 && Math.random() < (st.pressure ? 0.0035 : 0.0011) * timeScale) {
                            st.leak = Math.floor(Math.random() * st.leakJoints.length);
                            gameMsg('SSSSST — a joint sprang a LEAK! Water is spraying away…', 6000);
                            gameBeep(1800, 0.6, 'sawtooth', 0.08);
                        }
                    }
                    const dropSpd = 0.16 * (st.pressure ? 1.7 : 1) *
                        (st.rate === 2 ? 1.3 : st.rate === 0.5 ? 0.8 : 1);
                    st.dropPool.forEach(d => {
                        if (!d.active) return;
                        if (!d.fall) {
                            let remaining = dropSpd * timeScale;
                            while (remaining > 0 && d.seg < d.pts.length - 1) {
                                const a = d.pts[d.seg], b = d.pts[d.seg + 1];
                                const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
                                const dist = d.t * segLen + remaining;
                                if (dist >= segLen) { remaining = dist - segLen; d.seg++; d.t = 0; }
                                else { d.t = dist / segLen; remaining = 0; }
                            }
                            if (d.seg >= d.pts.length - 1) {
                                const last = d.pts[d.pts.length - 1];
                                d.x = last[0]; d.y = last[1];
                                d.fall = true; d.vy = 0.02;
                            } else {
                                const a = d.pts[d.seg], b = d.pts[d.seg + 1];
                                d.x = a[0] + (b[0] - a[0]) * d.t;
                                d.y = a[1] + (b[1] - a[1]) * d.t;
                            }
                            // Drops passing a leaking joint may spray out of the maze
                            if (st.leak >= 0) {
                                const lj = st.leakJoints[st.leak];
                                if (Math.hypot(d.x - lj.x, d.y - lj.y) < 0.45 && Math.random() < 0.5) {
                                    d.active = false; d.mesh.visible = false;
                                    fwParticle(new THREE.Vector3(d.x, d.y, -5.9),
                                        new THREE.Vector3((Math.random() - 0.2) * 0.2, 0.12, 0.04),
                                        new THREE.Color(0x88ccff), { gravity: 0.004, decay: 0.05, size: 0.07 });
                                }
                            }
                        } else {
                            d.vy += 0.012 * timeScale;
                            d.y -= d.vy * timeScale;
                            d.x += (Math.random() - 0.5) * 0.03;
                            const surfaceY = F + 0.15 + st.fills[d.bucket] * 2.3;
                            if (d.y <= surfaceY) {
                                d.active = false; d.mesh.visible = false;
                                st.fills[d.bucket] = Math.min(1.16, st.fills[d.bucket] + 0.0018);
                                if (Math.random() < 0.15) puffBurst(
                                    new THREE.Vector3(d.x, surfaceY, -6), 0x9fd4ff, 2, 0.3,
                                    { gravity: 0.002, decay: 0.06, size: 0.05 });
                            }
                        }
                        d.mesh.position.set(d.x, d.y, -5.94);
                    });

                    // Water columns + overflow + duck bobbing
                    st.buckets.forEach((b, i) => {
                        const f2 = st.fills[i];
                        b.water.scale.y = Math.max(0.02, f2 * 2.3);
                        b.water.position.y = F + 0.05 + (f2 * 2.3) / 2;
                        if (f2 >= 1.15) {
                            st.fills[i] = 0;
                            splash(b.x, true);
                            gameMsg('OVERFLOW! The ' + ['LEFT', 'MIDDLE', 'RIGHT'][i] + ' bucket tips and drains. Watch the line!', 5500);
                            beeps([[400, 0.3, 0, 'sawtooth', 0.2], [200, 0.5, 250, 'sawtooth', 0.2]]);
                        }
                    });
                    if (st.duck) {
                        const bi = st.duckBucket;
                        const targetY = F + 0.3 + st.fills[bi] * 2.3;
                        st.duck.position.y += (targetY - st.duck.position.y) * 0.08 * timeScale;
                        st.duck.rotation.z = Math.sin(Date.now() * 0.003) * 0.15;
                    }

                    // Level 1 win: all three buckets at the line (0.95 .. 1.15) -> the pump station opens
                    if (st.stage === 1 && st.fills.every(f2 => f2 >= 0.95)) advanceStage();
                    // Levels 2-3: animate the station; goals must hold for 1.5 s (flow settles)
                    if (st.stage >= 2 && st.station) {
                        try {
                            st.station.update(0.0167 * timeScale);
                            if (!gameMode.won) {
                                st.goalHold = st.station.goalsMet() ? st.goalHold + 0.0167 * timeScale : 0;
                                if (st.goalHold > 1.5) advanceStage();
                            }
                        } catch (err) { if (window.console) console.warn('[WATERWORKS] station update', err); }
                    }

                    targetCameraPos.set(0, 5.5, 25);
                    targetCameraLookAt.set(0, 2.2, -6);

                    if (st.stage >= 2 && st.station) {
                        gameStatus('LEVEL ' + st.stage + ' \u00b7 ' + stationLine() + ' \u00b7 gates ' + st.station.openings().map(PCT).join('/'));
                        return;
                    }
                    gameStatus('L ' + Math.round(st.fills[0] * 100) + '% · M ' + Math.round(st.fills[1] * 100) +
                        '% · R ' + Math.round(st.fills[2] * 100) + '% · ' + routeName() +
                        ' · flow ' + (st.flowing ? 'ON' : 'off') + (st.pressure ? ' · OVERDRIVE' : '') +
                        (st.leak >= 0 ? ' · LEAKING!' : ''));
                }
            });
            setObjective('WATERWORKS',
                'Fill all three buckets to the white line — overflow drains a bucket to zero. ' +
                'One big VALVE picks a main; each side has a rotating ELBOW that sends water ' +
                'down or across the maze. Old joints sometimes give out…');
        }

        SCENES['WATERWORKS'] = { build: createWaterworksScene, kind: 'level', menuOrder: 3 };
