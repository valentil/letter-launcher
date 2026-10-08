// Letter Launcher — src/scenes/tower_build.js
// Scene "TOWER BUILD" (level): createTowerBuildScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // ==================================================================
        // ==== LEVEL 5: TOWER BUILD (crane + physics blocks + welding) =====
        // Load blocks onto the crane hook, aim with LEFT/RIGHT, drop them
        // onto the pad, and WELD settled ones solid until the stack reaches
        // the red GOAL beam. Real physics: sloppy stacks topple.
        // ==================================================================
        function createTowerBuildScene() {
            currentScene = 'tower_build';
            scene.background = new THREE.Color(0xc9ddea);
            scene.fog = new THREE.FogExp2(0xc9ddea, 0.005);
            const F = -5.1;
            const st = {};
            const SITE = new THREE.Vector3(0, F, -2);

            // Ground + physics floor
            const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
                new THREE.MeshPhongMaterial({ color: 0xb59a6f }));
            ground.rotation.x = -Math.PI / 2; ground.position.y = F; scene.add(ground);
            const dirt = new THREE.Mesh(new THREE.CircleGeometry(9, 24),
                new THREE.MeshPhongMaterial({ color: 0x9c7a4d }));
            dirt.rotation.x = -Math.PI / 2; dirt.position.set(0, F + 0.02, -2); scene.add(dirt);
            const floorBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
            floorBody.addShape(new CANNON.Box(new CANNON.Vec3(60, 1, 60)));
            floorBody.position.set(0, F - 1, 0);
            world.addBody(floorBody);
            colliderBodies.push(floorBody);
            // Concrete pad to build on
            const pad = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.4, 4.2),
                new THREE.MeshPhongMaterial({ color: 0x8d8d8d }));
            pad.position.set(SITE.x, F + 0.2, SITE.z); scene.add(pad);
            const padBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
            padBody.addShape(new CANNON.Box(new CANNON.Vec3(2.1, 0.2, 2.1)));
            padBody.position.set(SITE.x, F + 0.2, SITE.z);
            world.addBody(padBody);
            colliderBodies.push(padBody);

            // Crane: mast, jib, counterweight, cab, trolley + cable + hook
            const steelMat = new THREE.MeshStandardMaterial({ color: 0xe8b428, metalness: 0.4, roughness: 0.5 });
            const mast = new THREE.Mesh(new THREE.BoxGeometry(0.9, 14, 0.9), steelMat);
            mast.position.set(8.5, F + 7, -2); scene.add(mast);
            const jib = new THREE.Mesh(new THREE.BoxGeometry(15, 0.6, 0.7), steelMat);
            jib.position.set(2.5, F + 13.6, -2); scene.add(jib);
            const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.4),
                new THREE.MeshStandardMaterial({ color: 0x666666 }));
            counter.position.set(10.6, F + 13.2, -2); scene.add(counter);
            const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4),
                new THREE.MeshPhongMaterial({ color: 0x3a4b5c }));
            cab.position.set(8.5, F + 12.4, -1.2); scene.add(cab);
            st.cab = cab;
            const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.9),
                new THREE.MeshStandardMaterial({ color: 0x444444 }));
            scene.add(trolley); st.trolley = trolley;
            const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
                new THREE.MeshBasicMaterial({ color: 0x222222 }));
            scene.add(cable); st.cable = cable;
            const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
                new THREE.MeshStandardMaterial({ color: 0xb03a2e, metalness: 0.5, roughness: 0.4 }));
            scene.add(hook); st.hook = hook;
            // Preview block that hangs on the hook once LOADed
            const previewMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.8 });
            const preview = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 2.0), previewMat);
            preview.visible = false;
            scene.add(preview); st.preview = preview;

            // Goal beam + label
            st.goalY = F + 6.6;
            const goal = new THREE.Mesh(new THREE.BoxGeometry(7, 0.18, 4.6),
                new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.45 }));
            goal.position.set(SITE.x, st.goalY, SITE.z); scene.add(goal);
            st.goalMesh = goal;
            const goalLabel = makeTextLabel('GOAL', 0.7, 0xff3333);
            goalLabel.position.set(SITE.x - 4.9, st.goalY + 0.2, SITE.z); scene.add(goalLabel);

            // Site dressing: fence, cones, mixer, workers, tree, flag, lights, banner
            for (let i = -5; i <= 5; i++) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.15),
                    new THREE.MeshPhongMaterial({ color: 0x777777 }));
                post.position.set(i * 2.4, F + 0.8, 6);
                scene.add(post);
                const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.08),
                    new THREE.MeshPhongMaterial({ color: 0xd06428 }));
                bar.position.set(i * 2.4 + 1.2, F + 1.3, 6);
                scene.add(bar);
            }
            st.cones = [];
            [[-5, 2.5], [5, 2.5], [-6, -6], [6, -6]].forEach(cp => {
                const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 10),
                    new THREE.MeshPhongMaterial({ color: 0xff6a1a }));
                cone.position.set(cp[0], F + 0.5, cp[1]);
                scene.add(cone); st.cones.push(cone);
            });
            const mixer = new THREE.Group();
            const mixBase = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.2),
                new THREE.MeshPhongMaterial({ color: 0x556677 }));
            mixBase.position.y = 0.4; mixer.add(mixBase);
            const drumGeo = new THREE.CylinderGeometry(0.7, 0.5, 1.6, 10);
            const drum = new THREE.Mesh(drumGeo, new THREE.MeshPhongMaterial({ color: 0xdddddd }));
            drum.rotation.z = 0.6; drum.position.y = 1.4; mixer.add(drum);
            mixer.position.set(-7.5, F, 0);
            scene.add(mixer); st.drum = drum;
            st.workers = [];
            [[-4, 3.5, 0xf2b01e], [4.5, 3.8, 0x3a7bd5], [-2, -5.5, 0x4caf50]].forEach(wp => {
                const w = makeBoxMan(wp[2], 0xf2d21e);
                w.scale.setScalar(0.75);
                w.position.set(wp[0], F, wp[1]);
                scene.add(w); st.workers.push(w);
            });
            st.season = 1;
            makeGameTree(new THREE.Vector3(-10, F, 4), 0x2e8b57, st);
            const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
                new THREE.MeshPhongMaterial({ color: 0xcccccc }));
            flagPole.position.set(8.5, F + 15.2, -2); scene.add(flagPole);
            st.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7),
                new THREE.MeshBasicMaterial({ color: 0xd42a2a, side: THREE.DoubleSide }));
            st.flag.position.set(9.2, F + 14.4, -2);
            st.flag.scale.setScalar(0.001);
            scene.add(st.flag);
            st.floods = [];
            [[-8, 5], [8, 5]].forEach(fp => {
                const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 6),
                    new THREE.MeshPhongMaterial({ color: 0x555555 }));
                lp.position.set(fp[0], F + 2.5, fp[1]); scene.add(lp);
                const lampMat = new THREE.MeshPhongMaterial({ color: 0xf5f0d0, emissive: 0x000000 });
                const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.4), lampMat);
                lamp.position.set(fp[0], F + 5.1, fp[1]); scene.add(lamp);
                st.floods.push(lampMat);
            });
            st.banner = new THREE.Group();
            const bannerPlane = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2),
                new THREE.MeshBasicMaterial({ color: 0xffe14c, side: THREE.DoubleSide }));
            st.banner.add(bannerPlane);
            const bannerText = makeTextLabel('SAFETY FIRST', 0.5, 0x222222);
            bannerText.position.set(0, -0.25, 0.02);
            st.banner.add(bannerText);
            st.banner.position.set(0, F + 3.4, 5.9);
            st.banner.scale.setScalar(0.001);
            scene.add(st.banner);
            st.bannerUp = false;

            // Sim state
            st.loaded = null; st.hookX = 0; st.hookY = F + 10.5;
            st.blocks = []; st.magnet = false; st.scaffT = 0; st.scaffMeshes = [];
            st.cemented = false; st.dropCount = 0;
            const BLOCK_TYPES = {
                CONCRETE: { color: 0x9e9e9e, mass: 2.0, w: 2.0, h: 1.3 },
                BRICK: { color: 0xb5533c, mass: 1.6, w: 2.0, h: 1.3 },
                STEEL: { color: 0x7d8da1, mass: 3.2, w: 1.7, h: 1.3 }
            };
            function loadBlock(type) {
                if (st.loaded) { gameMsg('The hook already carries a ' + st.loaded.toLowerCase() + ' block. DROP it first.'); return; }
                st.loaded = type;
                const def = BLOCK_TYPES[type];
                st.preview.visible = true;
                st.preview.material.color.setHex(def.color);
                st.preview.scale.set(def.w / 2.0, 1, def.w / 2.0);
                gameBeep(340, 0.2, 'square', 0.12);
                gameMsg(type + ' block on the hook. Aim with LEFT/RIGHT, then DROP.');
            }
            function settledUnwelded() {
                return st.blocks.filter(b => !b.welded &&
                    b.body.velocity.length() < 0.6 && Math.abs(b.body.position.x) < 4 &&
                    Math.abs(b.body.position.z - SITE.z) < 4);
            }

            setGameMode({
                name: 'TOWER BUILD',
                words: expandWords({
                    // ---- state advancers -------------------------------------
                    'LOAD|BLOCK|CONCRETE': () => loadBlock('CONCRETE'),
                    'BRICK|BRICKS': () => loadBlock('BRICK'),
                    'STEEL|GIRDER': () => loadBlock('STEEL'),
                    'DROP|PLACE|RELEASE': () => {
                        if (!st.loaded) { gameMsg('Nothing on the hook. LOAD a block (or ask for BRICK / STEEL).'); return; }
                        const def = BLOCK_TYPES[st.loaded];
                        st.loaded = null; st.preview.visible = false; st.dropCount++;
                        const geo = new THREE.BoxGeometry(def.w, def.h, def.w);
                        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                            color: def.color, roughness: 0.75, metalness: def.mass > 3 ? 0.5 : 0.1 }));
                        mesh.castShadow = true; mesh.receiveShadow = true;
                        const px = st.hookX + (Math.random() - 0.5) * 0.15;
                        mesh.position.set(px, st.hookY - 1.2, SITE.z);
                        scene.add(mesh);
                        const body = new CANNON.Body({ mass: def.mass, material: physicsMaterial });
                        body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, def.h / 2, def.w / 2)));
                        body.position.set(px, st.hookY - 1.2, SITE.z);
                        world.addBody(body);
                        const rec = { mesh, body, type: 'gameBlock', welded: false, half: def.h / 2 };
                        physicsBodies.push(rec);
                        st.blocks.push(rec);
                        gameBeep(180, 0.25, 'square', 0.12);
                        gameMsg('Block away!');
                    },
                    'WELD|FUSE|FIX': () => {
                        const cands = settledUnwelded();
                        if (!cands.length) { gameMsg('Nothing settled to weld — wait for a block to stop wobbling.'); return; }
                        cands.sort((a, b) => a.body.position.y - b.body.position.y);
                        const b = cands[0];
                        b.welded = true;
                        b.body.mass = 0;
                        b.body.updateMassProperties();
                        b.body.velocity.set(0, 0, 0);
                        b.body.angularVelocity.set(0, 0, 0);
                        b.mesh.material.emissive = b.mesh.material.emissive || new THREE.Color(0);
                        b.mesh.material.emissive.setHex(0x331a00);
                        puffBurst(new THREE.Vector3().copy(b.body.position), 0xffd166, 16, 1.2,
                            { gravity: 0.002, decay: 0.05, size: 0.06 });
                        beeps([[1200, 0.08, 0, 'sawtooth', 0.1], [1400, 0.08, 100, 'sawtooth', 0.1], [1100, 0.12, 200, 'sawtooth', 0.1]]);
                        gameMsg('BZZZT — welded solid at ' + (b.body.position.y - F).toFixed(1) + ' up.');
                    },
                    'UP|RAISE|LIFT': () => { st.hookY = Math.min(F + 12.5, st.hookY + 1); gameMsg('Hook up. Higher drop, more chaos.'); },
                    'DOWN|LOWER': () => { st.hookY = Math.max(F + 6, st.hookY - 1); gameMsg('Hook down. Gentler drops.'); },
                    'LEFT': () => { st.hookX = Math.max(-3.5, st.hookX - 1.2); gameMsg('Trolley left.'); },
                    'RIGHT': () => { st.hookX = Math.min(3.5, st.hookX + 1.2); gameMsg('Trolley right.'); },
                    'CENTER|MIDDLE|AIM': () => { st.hookX = 0; gameMsg('Trolley centered over the pad.'); },
                    'CLEAR|WRECK|SCRAP': () => {
                        let n = 0;
                        st.blocks = st.blocks.filter(b => {
                            if (b.welded) return true;
                            scene.remove(b.mesh); world.removeBody(b.body);
                            physicsBodies = physicsBodies.filter(pb => pb !== b);
                            puffBurst(new THREE.Vector3().copy(b.body.position), 0xaaaaaa, 6, 1, { decay: 0.04 });
                            n++;
                            return false;
                        });
                        gameMsg(n ? 'Cleared ' + n + ' loose block' + (n > 1 ? 's' : '') + ' off the site.' : 'No loose blocks to clear.');
                    },
                    'MAGNET': () => {
                        st.magnet = !st.magnet;
                        gameMsg(st.magnet ? 'Magnet ON — falling blocks are drawn to the trolley line.' : 'Magnet off. Pure gravity now.');
                        gameBeep(st.magnet ? 900 : 400, 0.25, 'square', 0.12);
                    },
                    'SCAFFOLD|SUPPORT|BRACE': () => {
                        if (st.scaffT > 0) { gameMsg('Scaffolding is already up.'); return; }
                        st.scaffT = 720;
                        [-1, 1].forEach(s => {
                            const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9, 3.6),
                                new THREE.MeshPhongMaterial({ color: 0xc9a75a, transparent: true, opacity: 0.7 }));
                            m.position.set(s * 1.6, F + 4.5, SITE.z);
                            scene.add(m);
                            const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
                            body.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 4.5, 1.8)));
                            body.position.set(s * 1.6, F + 4.5, SITE.z);
                            world.addBody(body);
                            st.scaffMeshes.push({ mesh: m, body });
                        });
                        gameMsg('Scaffold walls raised — stack fast, they come down soon!');
                    },
                    'CEMENT|SLAB|FOUNDATION': () => {
                        if (st.cemented) { gameMsg('The foundation slab is already poured.'); return; }
                        st.cemented = true;
                        const slab = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.8, 5.4),
                            new THREE.MeshPhongMaterial({ color: 0xb5b5b5 }));
                        slab.position.set(SITE.x, F + 0.8, SITE.z);
                        scene.add(slab);
                        const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
                        body.addShape(new CANNON.Box(new CANNON.Vec3(2.7, 0.4, 2.7)));
                        body.position.set(SITE.x, F + 0.8, SITE.z);
                        world.addBody(body);
                        colliderBodies.push(body);
                        tween(1000, k => st.drum.rotation.y = k * Math.PI * 6);
                        puffBurst(new THREE.Vector3(SITE.x, F + 1.4, SITE.z), 0xcccccc, 14, 2.4, { decay: 0.03 });
                        gameMsg('Mixer pours a wide foundation slab. Solid start!');
                    },
                    // ---- doodads ---------------------------------------------
                    'HAT|HELMET': () => {
                        st.workers.forEach(w => puffBurst(w.position.clone().add(new THREE.Vector3(0, 1.6, 0)),
                            0xf2d21e, 6, 0.4, { gravity: 0.001, decay: 0.03, size: 0.06 }));
                        gameMsg('The crew tips their hard hats in unison.');
                    },
                    'WORKER|WORKERS|CREW|WAVE': () => {
                        st.workers.forEach((w, i) => tween(1000 + i * 150, k =>
                            w.position.y = F + Math.abs(Math.sin(k * Math.PI * 2)) * 0.5 * (1 - k)));
                        gameMsg('The crew waves back enthusiastically.');
                    },
                    'HORN|AIRHORN': () => {
                        beeps([[220, 0.6, 0, 'sawtooth', 0.3], [220, 0.4, 700, 'sawtooth', 0.3]]);
                        st.workers.forEach(w => tween(500, k => w.scale.setScalar(0.75 - Math.sin(k * Math.PI) * 0.12)));
                        gameMsg('BWAAAMP. Everyone ducks out of habit.');
                    },
                    'LUNCH|SANDWICH': () => {
                        gameBeep(880, 0.8, 'triangle', 0.15);
                        st.workers.forEach(w => tween(3000, k => w.rotation.x = Math.sin(Math.min(k * 4, 1) * Math.PI / 2) * 0.8 * (k < 0.9 ? 1 : (1 - k) * 10)));
                        gameMsg('Lunch whistle! The crew sits down mid-site.');
                    },
                    'COFFEE': () => {
                        puffBurst(st.cab.position.clone().add(new THREE.Vector3(0, 0.8, 0)),
                            0xffffff, 6, 0.3, { gravity: -0.0008, decay: 0.015, size: 0.06 });
                        tween(900, k => st.cab.rotation.z = Math.sin(k * Math.PI * 8) * 0.02 * (1 - k));
                        gameMsg('The crane operator refuels. The cab jitters slightly.');
                    },
                    'RADIO|MUSIC': () => {
                        beeps([[440, 0.12, 0, 'square', 0.08], [554, 0.12, 150, 'square', 0.08],
                               [659, 0.12, 300, 'square', 0.08], [554, 0.2, 450, 'square', 0.08]]);
                        st.cones.forEach((c, i) => tween(800 + i * 100, k =>
                            c.rotation.z = Math.sin(k * Math.PI * 4) * 0.2 * (1 - k)));
                        gameMsg('Site radio crackles a tune; the cones bop along.');
                    },
                    'DOG': () => {
                        const dog = new THREE.Group();
                        const dBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.35),
                            new THREE.MeshPhongMaterial({ color: 0x8a5a2b }));
                        dBody.position.y = 0.4; dog.add(dBody);
                        const dHead = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.3),
                            new THREE.MeshPhongMaterial({ color: 0x8a5a2b }));
                        dHead.position.set(0.5, 0.6, 0); dog.add(dHead);
                        flyby(dog, new THREE.Vector3(-12, F, 2), new THREE.Vector3(12, F, 3), 3200, { bob: true });
                        beeps([[500, 0.1, 0, 'square', 0.15], [500, 0.1, 200, 'square', 0.15]]);
                        gameMsg('The site dog sprints through with someone\'s glove.');
                    },
                    'PIGEON|PIGEONS|BIRD': () => {
                        birdsAcross(F + 14, 0x888899);
                        gameMsg('Pigeons burst off the jib in a huff.');
                    },
                    'SPARK|SPARKS|GRIND': () => {
                        const b = st.blocks[st.blocks.length - 1];
                        const pos = b ? new THREE.Vector3().copy(b.body.position) : SITE.clone().add(new THREE.Vector3(0, 1, 0));
                        puffBurst(pos, 0xffd166, 20, 0.8, { gravity: 0.003, decay: 0.05, size: 0.05 });
                        gameBeep(1600, 0.4, 'sawtooth', 0.1);
                        gameMsg('An angle grinder screams somewhere. Sparks everywhere.');
                    },
                    'PAINT': () => {
                        st.blocks.forEach(b => { if (!b.welded) b.mesh.material.color.setHSL(Math.random(), 0.6, 0.55); });
                        gameMsg('The loose blocks get a surprise paint job.');
                    },
                    'FLAG': () => {
                        st.bannerUp = st.bannerUp; // no-op guard
                        tween(1400, k => st.flag.scale.setScalar(Math.max(0.001, k)));
                        gameMsg('The company flag runs up the mast!');
                    },
                    'LIGHTS|FLOODLIGHT': () => {
                        const on = st.floods[0].emissive.getHex() === 0;
                        st.floods.forEach(l => l.emissive.setHex(on ? 0xfff2b0 : 0x000000));
                        gameMsg(on ? 'Floodlights ON — night shift ready.' : 'Floodlights off.');
                    },
                    'NIGHT': () => { skyTo(0x1a2233, 0x1a2233); gameMsg('Dusk settles over the site.'); },
                    'DAY|SUN': () => { skyTo(0xc9ddea, 0xc9ddea); gameMsg('Morning shift. Coffee first.'); },
                    'RAIN': () => { setWeather('rain'); skyTo(0x8a99a8, 0x8a99a8); gameMsg('Rain — the site turns to mud.'); },
                    'SNOW': () => { setWeather('snow'); skyTo(0xe4ecf2, 0xe4ecf2); gameMsg('Snow dusts the girders.'); },
                    'CLEAR': () => { setWeather(null); skyTo(0xc9ddea, 0xc9ddea); gameMsg('Skies clear over the site.'); },
                    'WIND': () => {
                        tween(2200, k => { st.cable.rotation.z = Math.sin(k * Math.PI * 5) * 0.08 * (1 - k); });
                        puffBurst(new THREE.Vector3(0, F + 0.5, 0), 0xc9b083, 14, 6, { gravity: 0.0005, decay: 0.02, size: 0.07 });
                        gameMsg('A gust rocks the cable and kicks up dust.');
                    },
                    'MUD|PUDDLE': () => {
                        puffBurst(new THREE.Vector3((Math.random() - 0.5) * 8, F + 0.3, (Math.random() - 0.5) * 6),
                            0x6b5432, 12, 1.5, { gravity: 0.002, decay: 0.04, size: 0.08 });
                        gameBeep(160, 0.2, 'sine', 0.15);
                        gameMsg('SPLAT. Someone finds the deep puddle.');
                    },
                    'CONE|CONES': () => {
                        st.cones.forEach((c, i) => tween(700 + i * 180, k =>
                            c.position.y = F + 0.5 + Math.abs(Math.sin(k * Math.PI * 2)) * 0.8 * (1 - k)));
                        gameMsg('The traffic cones do a little dance. Nobody saw that.');
                    },
                    'TRUCK': () => {
                        const truck = new THREE.Group();
                        const cabT = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.6),
                            new THREE.MeshPhongMaterial({ color: 0xd42a2a }));
                        cabT.position.set(1.6, 1, 0); truck.add(cabT);
                        const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 1.6),
                            new THREE.MeshPhongMaterial({ color: 0x777777 }));
                        bed.position.set(-0.6, 0.9, 0); truck.add(bed);
                        [[-1.4], [0.2], [1.6]].forEach(wx => {
                            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10),
                                new THREE.MeshPhongMaterial({ color: 0x111111 }));
                            wheel.rotation.x = Math.PI / 2;
                            wheel.position.set(wx[0], 0.4, 0.8); truck.add(wheel);
                        });
                        flyby(truck, new THREE.Vector3(-16, F, 7.5), new THREE.Vector3(16, F, 7.5), 4200);
                        gameBeep(80, 1.6, 'sawtooth', 0.15);
                        gameMsg('A dump truck rumbles past the fence.');
                    },
                    'MIXER|DRUM': () => {
                        tween(2000, k => st.drum.rotation.y = k * Math.PI * 10);
                        puffBurst(mixer.position.clone().add(new THREE.Vector3(0, 2, 0)),
                            0xcccccc, 8, 0.8, { decay: 0.02, size: 0.07 });
                        gameMsg('The mixer drum spins up with a gravelly churn.');
                    },
                    'JACKHAMMER': () => {
                        beeps(Array.from({ length: 8 }, (_, i) => [110, 0.05, i * 90, 'square', 0.18]));
                        tween(800, k => { targetCameraPos.y += (Math.random() - 0.5) * 0.3; });
                        gameMsg('BRRRRRT. The whole street feels that one.');
                    },
                    'SIREN': () => {
                        beeps([[600, 0.5, 0, 'sine', 0.2], [450, 0.5, 500, 'sine', 0.2], [600, 0.5, 1000, 'sine', 0.2]]);
                        gameMsg('End-of-day siren. Tools down… except yours.');
                    },
                    'STARS|STAR': () => {
                        for (let i = 0; i < 14; i++) fwParticle(
                            new THREE.Vector3((Math.random() - 0.5) * 40, 12 + Math.random() * 8, -10 - Math.random() * 8),
                            new THREE.Vector3(0, 0, 0), new THREE.Color(0xffffff), { gravity: 0, decay: 0.01, size: 0.1 });
                        gameMsg('Stars over the scaffolding.');
                    },
                    'TREE|TREES': () => cycleSeason(st),
                    'BANNER|SAFETY': () => {
                        st.bannerUp = !st.bannerUp;
                        const from = st.bannerUp ? 0.001 : 1, to = st.bannerUp ? 1 : 0.001;
                        tween(1200, k => st.banner.scale.setScalar(from + (to - from) * k));
                        gameMsg(st.bannerUp ? 'A "SAFETY FIRST" banner unfurls on the fence.' : 'Banner rolled away.');
                    },
                    'CAT': () => {
                        const cat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.25),
                            new THREE.MeshPhongMaterial({ color: 0xd9d9d9 }));
                        flyby(cat, new THREE.Vector3(10, F + 13.9, -2), new THREE.Vector3(-4, F + 13.9, -2), 6000, { bob: true });
                        gameMsg('A cat strolls the jib like it owns the crane.');
                    },
                    'ECHO|HAMMER': () => {
                        beeps([[700, 0.1, 0, 'square', 0.2], [700, 0.08, 350, 'square', 0.1], [700, 0.06, 700, 'square', 0.05]]);
                        gameMsg('Tink… tink… tink — a hammer echoes off the hills.');
                    }
                }),
                update: () => {
                    // Hook rig follows the trolley target
                    st.trolley.position.set(st.hookX, F + 13.25, SITE.z);
                    const cableLen = (F + 13.05) - st.hookY;
                    st.cable.scale.y = Math.max(0.1, cableLen);
                    st.cable.position.set(st.hookX, st.hookY + cableLen / 2, SITE.z);
                    st.hook.position.set(st.hookX, st.hookY, SITE.z);
                    if (st.preview.visible) st.preview.position.set(st.hookX, st.hookY - 1.0, SITE.z);

                    // Magnet assist pulls falling blocks toward the trolley line
                    if (st.magnet) st.blocks.forEach(b => {
                        if (!b.welded && b.body.velocity.y < -0.5)
                            b.body.velocity.x += (st.hookX - b.body.position.x) * 0.004 * timeScale;
                    });

                    // Scaffold expiry
                    if (st.scaffT > 0) {
                        st.scaffT -= timeScale;
                        if (st.scaffT <= 0) {
                            st.scaffMeshes.forEach(s => { scene.remove(s.mesh); world.removeBody(s.body); });
                            st.scaffMeshes = [];
                            gameMsg('The scaffold comes down — hope the welds hold!');
                        }
                    }

                    // Tumbled-block detection
                    st.blocks.forEach(b => {
                        if (!b.welded && !b.tumbled && b.body.position.y < F + 1 &&
                            (Math.abs(b.body.position.x) > 4.5 || Math.abs(b.body.position.z - SITE.z) > 4.5)) {
                            b.tumbled = true;
                            gameMsg('A block tumbled off the pad. LOAD another (or CLEAR the mess).');
                        }
                    });

                    // Win: a WELDED block's top reaches the goal beam
                    let best = F;
                    st.blocks.forEach(b => { if (b.welded) best = Math.max(best, b.body.position.y + b.half); });
                    st.goalMesh.material.opacity = 0.35 + Math.sin(Date.now() * 0.004) * 0.15;
                    if (best >= st.goalY - 0.05) gameWin('TOWER TOPPED OUT');

                    targetCameraPos.set(9, F + 12, 17);
                    targetCameraLookAt.set(0, F + 4, SITE.z);

                    gameStatus('welded height ' + Math.max(0, best - F).toFixed(1) + ' / ' + (st.goalY - F).toFixed(1) +
                        ' · hook x ' + st.hookX.toFixed(1) +
                        ' · ' + (st.loaded ? st.loaded + ' loaded' : 'hook empty') +
                        (st.magnet ? ' · MAGNET' : '') + (st.cemented ? ' · slab' : ''));
                }
            });
            setObjective('TOWER BUILD',
                'Stack and weld blocks until the tower reaches the red GOAL beam. ' +
                'The crane crew answers to plain site words. Unwelded stacks topple — physics is the foreman here.');
        }

        SCENES['TOWER BUILD'] = { build: createTowerBuildScene, kind: 'level', menuOrder: 4 };
