// Letter Launcher — src/scenes/wild_west.js
// Scene "WILD WEST" (sandbox): createWildWestScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        function createWildWestScene() {
            currentScene = 'wild_west';
            scene.background = new THREE.Color(0xFFCC88); // Dusky orange sky
            scene.fog = new THREE.FogExp2(0xFFCC88, 0.005);

            // Red Sand / Rocky Ground
            // W1: heightfield collider matching the visible canyon floor (dunes + the
            // shallow track bed), and shared with the train so it rides on real ground.
            const wwHeight = (x, z) => -5.1 + Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5 + (Math.abs(z) < 2 ? -0.2 : 0);
            scene.userData.wwHeight = wwHeight;
            addHeightfieldCollider(-160, -160, 160, 160, 6, wwHeight, 'wild_west_ground');
            const groundGeo = new THREE.PlaneGeometry(1000, 1000, 100, 100);
            groundGeo.rotateX(-Math.PI / 2);
            const vertices = groundGeo.attributes.position.array;
            for (let i = 0; i < vertices.length; i += 3) {
                const x = vertices[i];
                const z = vertices[i+2];
                // Flat canyon floor with some variation
                vertices[i+1] = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5;
                // Add some tracks in the middle
                if (Math.abs(z) < 2) vertices[i+1] -= 0.2;
            }
            groundGeo.computeVertexNormals();
            const groundMat = new THREE.MeshPhongMaterial({ color: 0xA0522D, flatShading: true });
            const ground = new THREE.Mesh(groundGeo, groundMat);
            ground.position.y = -5.1;
            ground.receiveShadow = true;
            scene.add(ground);

            // Flatirons / Mountains on the left
            for (let i = 0; i < 6; i++) {
                const mtGeo = new THREE.ConeGeometry(20 + Math.random() * 30, 60 + Math.random() * 40, 3);
                const mtMat = new THREE.MeshPhongMaterial({ color: 0x8B4513, flatShading: true });
                const mt = new THREE.Mesh(mtGeo, mtMat);
                mt.position.set(-80 - i * 20, 20, (Math.random() - 0.5) * 200);
                mt.rotation.y = Math.PI / 4;
                scene.add(mt);
                const mtCollider = new CANNON.Body({ mass: 0 });
                mtCollider.addShape(new CANNON.Cylinder(0.1, 30, 80, 3));
                mtCollider.position.set(mt.position.x, mt.position.y, mt.position.z);
                world.addBody(mtCollider);
                colliderBodies.push(mtCollider);
            }

            // Old Timey Town on the right
            for (let i = 0; i < 8; i++) {
                const h = 8 + Math.random() * 5;
                const w = 6;
                const building = new THREE.Group();
                const bGeo = new THREE.BoxGeometry(w, h, 10);
                const bMat = new THREE.MeshPhongMaterial({ color: 0x5D4037 });
                const bMesh = new THREE.Mesh(bGeo, bMat);
                building.add(bMesh);

                // False front facade
                const facadeGeo = new THREE.PlaneGeometry(w + 2, h + 4);
                const facadeMat = new THREE.MeshPhongMaterial({ color: 0x795548, side: THREE.DoubleSide });
                const facade = new THREE.Mesh(facadeGeo, facadeMat);
                facade.position.set(-w/2 - 0.1, 2, 0);
                const x_b = 40 + Math.random() * 10; const z_b = (i - 4) * 15;
                // Removed buggy vertices update
                building.add(facade);

                building.position.set(x_b, h/2 - 5.1, z_b);
                scene.add(building);
                const bCollider = new CANNON.Body({ mass: 0, material: physicsMaterial });
                bCollider.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h/2, 5)));
                bCollider.position.set(building.position.x, building.position.y, building.position.z);
                world.addBody(bCollider);
                colliderBodies.push(bCollider);
            }

            // W2: A single smooth closed CatmullRom track loop that the train follows,
            // laid down as rails + ties that sit on the actual (undulating) ground.
            const trackCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-95, 0, -55),
                new THREE.Vector3(-35, 0, -92),
                new THREE.Vector3(38, 0, -80),
                new THREE.Vector3(96, 0, -18),
                new THREE.Vector3(82, 0, 52),
                new THREE.Vector3(22, 0, 90),
                new THREE.Vector3(-48, 0, 80),
                new THREE.Vector3(-96, 0, 22)
            ], true, 'catmullrom', 0.5);

            const railMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.4 });
            const tieMat = new THREE.MeshStandardMaterial({ color: 0x4E342E, roughness: 0.9 });
            const trackSamples = 260;
            const trackPts = trackCurve.getSpacedPoints(trackSamples);
            for (let i = 0; i < trackSamples; i++) {
                const p = trackPts[i];
                const pn = trackPts[(i + 1) % trackSamples];
                const dir = new THREE.Vector3().subVectors(pn, p);
                const segLen = dir.length();
                if (segLen < 1e-4) continue;
                dir.normalize();
                const yaw = Math.atan2(dir.x, dir.z);
                const nrm = new THREE.Vector3(-dir.z, 0, dir.x); // sideways offset for two rails
                const midX = (p.x + pn.x) / 2, midZ = (p.z + pn.z) / 2;
                const gy = wwHeight(midX, midZ);
                [1.2, -1.2].forEach(off => {
                    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, segLen * 1.08), railMat);
                    rail.position.set(midX + nrm.x * off, gy + 0.18, midZ + nrm.z * off);
                    rail.rotation.y = yaw;
                    rail.receiveShadow = true;
                    scene.add(rail);
                });
                if (i % 3 === 0) {
                    const tie = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.5), tieMat);
                    tie.position.set(midX, gy + 0.08, midZ);
                    tie.rotation.y = yaw;
                    tie.receiveShadow = true;
                    scene.add(tie);
                }
            }

            // W2: Articulated train. Each car is its own group that rides the track
            // curve independently (so it hugs the curve instead of cutting corners),
            // and each carries a kinematic Cannon body so letters land on / bounce off it.
            const trainWheels = [];
            const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14);
            wheelGeo.rotateZ(Math.PI / 2); // axle along local X, forward is local +Z
            const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.5, roughness: 0.5 });

            function buildCarUnit(def) {
                const unit = new THREE.Group();
                const bodyH = def.height;
                const wheelR = 0.5;
                const base = wheelR + 0.15; // body floor sits just above the wheels
                if (def.isEngine) {
                    const boilerGeo = new THREE.CylinderGeometry(1, 1, def.length * 0.55, 20);
                    boilerGeo.rotateX(Math.PI / 2);
                    const boiler = new THREE.Mesh(boilerGeo, new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.4, roughness: 0.6 }));
                    boiler.position.set(0, base + 0.9, def.length * 0.12);
                    unit.add(boiler);
                    const cabin = new THREE.Mesh(new THREE.BoxGeometry(def.width, bodyH, def.length * 0.32),
                        new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.3, roughness: 0.7 }));
                    cabin.position.set(0, base + bodyH / 2, -def.length * 0.32);
                    unit.add(cabin);
                    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 14),
                        new THREE.MeshStandardMaterial({ color: 0x111111 }));
                    chimney.position.set(0, base + 2.3, def.length * 0.34);
                    unit.add(chimney);
                    const cc = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.4, 4),
                        new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
                    cc.rotateX(Math.PI / 2);
                    cc.position.set(0, base, def.length * 0.5 + 0.35);
                    unit.add(cc);
                } else {
                    const body = new THREE.Mesh(new THREE.BoxGeometry(def.width, bodyH, def.length),
                        new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.3, roughness: 0.7 }));
                    body.position.set(0, base + bodyH / 2, 0);
                    unit.add(body);
                }
                const zPos = [-def.length * 0.3, 0, def.length * 0.3];
                zPos.forEach(zz => {
                    [def.width / 2 - 0.1, -def.width / 2 + 0.1].forEach(xx => {
                        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                        wheel.position.set(xx, wheelR, zz);
                        unit.add(wheel);
                        trainWheels.push(wheel);
                    });
                });
                unit.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
                return { group: unit, top: base + bodyH };
            }

            const carDefs = [
                { length: 6.0, width: 2.6, height: 2.2, color: 0x3a2a20, isEngine: true },
                { length: 4.5, width: 2.4, height: 1.5, color: 0x222222 }, // tender
                { length: 5.5, width: 2.6, height: 2.4, color: 0x5b3a2e },
                { length: 5.5, width: 2.6, height: 2.4, color: 0x4E342E },
                { length: 5.5, width: 2.6, height: 2.4, color: 0xBF360C }  // caboose
            ];

            const trainCars = [];
            carDefs.forEach(def => {
                const unit = buildCarUnit(def);
                scene.add(unit.group);
                const halfTop = unit.top / 2;
                const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
                body.addShape(new CANNON.Box(new CANNON.Vec3(def.width / 2, halfTop, def.length / 2)));
                world.addBody(body);
                colliderBodies.push(body);
                trainCars.push({ group: unit.group, body: body, yOff: halfTop });
            });

            scene.userData.trainCars = trainCars;
            scene.userData.trainWheels = trainWheels;
            scene.userData.trackCurve = trackCurve;
            scene.userData.trackLength = trackCurve.getLength();
            scene.userData.trainHeadU = 0;
            scene.userData.trainCarGap = 7.2;

            // Stagecoach Robbery in background
            const stagecoach = new THREE.Group();
            const coachGeo = new THREE.BoxGeometry(3, 2, 2);
            const coach = new THREE.Mesh(coachGeo, new THREE.MeshPhongMaterial({ color: 0xFFD54F }));
            coach.position.y = 1;
            stagecoach.add(coach);
            stagecoach.position.set(-20, -5.1, -25);
            scene.add(stagecoach);

            // Cowboys on horses
            for (let i = 0; i < 4; i++) {
                const cowboy = new THREE.Group();
                const horseGeo = new THREE.BoxGeometry(1.5, 1, 0.5);
                const horse = new THREE.Mesh(horseGeo, new THREE.MeshPhongMaterial({ color: 0x6D4C41 }));
                horse.position.y = 0.5;
                cowboy.add(horse);
                const riderGeo = new THREE.BoxGeometry(0.5, 1, 0.5);
                const rider = new THREE.Mesh(riderGeo, new THREE.MeshPhongMaterial({ color: i === 0 ? 0x000000 : 0x555555 }));
                rider.position.y = 1.5;
                cowboy.add(rider);
                cowboy.position.set(-15 + (i * 3), -5.1, -22 + (i % 2 * 6));
                scene.add(cowboy);
            }

            createLaunchers(); spawnNPC();
        }

        SCENES['WILD WEST'] = { build: createWildWestScene, kind: 'sandbox', menuOrder: 10 };
