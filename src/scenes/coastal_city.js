// Letter Launcher — src/scenes/coastal_city.js
// Scene "COASTAL CITY" (sandbox): createCoastalCityScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        function createCoastalCityScene() {
            currentScene = 'coastal_city';
            scene.background = new THREE.Color(0x87CEEB); // Bright blue sky
            scene.fog = new THREE.FogExp2(0x87CEEB, 0.005);

            // Ocean
            const oceanGeo = new THREE.PlaneGeometry(1000, 1000);
            oceanGeo.rotateX(-Math.PI / 2);
            const oceanMat = new THREE.MeshPhongMaterial({ 
                color: 0x004466, 
                transparent: true, 
                opacity: 0.8, 
                shininess: 100,
                emissive: 0x001122
            });
            const ocean = new THREE.Mesh(oceanGeo, oceanMat);
            ocean.position.y = -15.5; // Bring water level down
            scene.add(ocean);

            // Coastal Land
            const landGeo = new THREE.PlaneGeometry(800, 800, 100, 100);
            landGeo.rotateX(-Math.PI / 2);
            const landVertices = landGeo.attributes.position.array;
            for (let i = 0; i < landVertices.length; i += 3) {
                const x = landVertices[i];
                const z = landVertices[i+2];
                
                // Coast transition
                if (x < -100) {
                    // Deep water area
                    landVertices[i+1] = -20;
                } else if (x < 0) {
                    // Coast/Beach ramp
                    landVertices[i+1] = THREE.MathUtils.lerp(-20, -5.1, (x + 100) / 100);
                } else {
                    // City plateau with slight noise
                    landVertices[i+1] = -5.1 + Math.sin(x * 0.05) * Math.cos(z * 0.05) * 0.5;
                }
            }
            landGeo.computeVertexNormals();
            const landMat = new THREE.MeshPhongMaterial({ 
                color: 0x228B22,
                flatShading: true
            });
            const land = new THREE.Mesh(landGeo, landMat);
            land.position.set(0, 0, 0); // Position at origin
            scene.add(land);

            // Buildings & Billboards
            const billboardTexts = ["THE OLD WAY", "OF DOING", "SOFTWARE", "LEGACY CODE", "MANUAL DEPLOY", "NO TESTS", "SLOW RELEASES", "BUGS EVERYWHERE"];
            
            // W1: collider follows the visible coast (deep water, beach ramp, plateau)
            // instead of a flat box, so letters rest on the actual sloped beach/land.
            const coastHeight = (x, z) => {
                if (x < -100) return -20;
                if (x < 0) return THREE.MathUtils.lerp(-20, -5.1, (x + 100) / 100);
                return -5.1 + Math.sin(x * 0.05) * Math.cos(z * 0.05) * 0.5;
            };
            addHeightfieldCollider(-160, -200, 240, 200, 6, coastHeight, 'coastal_ground');

            // Skyscrapers (placed on land)
            for (let i = 0; i < 5; i++) {
                const h = 60 + Math.random() * 40;
                const w = 10 + Math.random() * 5;
                const bGeo = new THREE.BoxGeometry(w, h, w);
                const bMat = new THREE.MeshPhongMaterial({ color: 0x444455 });
                const building = new THREE.Mesh(bGeo, bMat);
                const x = 50 + Math.random() * 40;
                const z = (Math.random() - 0.5) * 150;
                building.position.set(x, h/2 - 5.1, z);
                scene.add(building);
                const bCollider = new CANNON.Body({ mass: 0, material: physicsMaterial });
                bCollider.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h/2, w/2)));
                bCollider.position.set(building.position.x, building.position.y, building.position.z);
                world.addBody(bCollider);
                colliderBodies.push(bCollider);

                // LLF-39: Add signs/billboards to the closest sides of buildings
                if (Math.random() > 0.5) {
                    const signGeo = new THREE.PlaneGeometry(w * 0.8, w * 0.4);
                    const signMat = new THREE.MeshBasicMaterial({ color: 0xFF00FF });
                    const sign = new THREE.Mesh(signGeo, signMat);
                    
                    // Pick a side (front or left usually visible)
                    if (Math.random() > 0.5) {
                        sign.position.set(x - w/2 - 0.01, h * 0.8 - 5.1, z);
                        sign.rotation.y = -Math.PI / 2;
                    } else {
                        sign.position.set(x, h * 0.8 - 5.1, z - w/2 - 0.01);
                        sign.rotation.y = Math.PI;
                    }
                    scene.add(sign);
                }
            }

            // 4 Billboards (explicitly as requested)
            for (let i = 0; i < 4; i++) {
                const x = 30 + Math.random() * 20;
                const z = (Math.random() - 0.5) * 100;
                const h = 15;
                
                const postGeo = new THREE.CylinderGeometry(0.5, 0.5, h);
                const postMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
                const post = new THREE.Mesh(postGeo, postMat);
                post.position.set(x, h/2 - 5.1, z);
                scene.add(post);

                const billText = billboardTexts[i % billboardTexts.length];
                const billGeo = new THREE.PlaneGeometry(12, 6);
                const billMat = new THREE.MeshBasicMaterial({ color: 0xFFFF00, side: THREE.DoubleSide });
                const billboard = new THREE.Mesh(billGeo, billMat);
                billboard.position.set(x, h - 5.1, z);
                
                // LLF-39: Vary rotation so they aren't all pointing the same way
                billboard.rotation.y = (Math.random() - 0.5) * Math.PI;
                scene.add(billboard);

                if (font) {
                    const billTextGeo = new THREE.TextGeometry(billText, { font: font, size: 0.8, height: 0.1 });
                    billTextGeo.computeBoundingBox();
                    const textWidth = billTextGeo.boundingBox.max.x - billTextGeo.boundingBox.min.x;
                    const textMesh = new THREE.Mesh(billTextGeo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
                    
                    // Position relative to billboard rotation
                    const offset = 0.11;
                    textMesh.position.set(
                        x + Math.sin(billboard.rotation.y) * offset,
                        h - 0.4 - 5.1,
                        z + Math.cos(billboard.rotation.y) * offset
                    );
                    textMesh.rotation.y = billboard.rotation.y;
                    
                    // Center text on billboard
                    textMesh.translateX(-textWidth/2);
                    
                    scene.add(textMesh);
                }
            }

            // 40 Medium Buildings (H: 20-40)
            for (let i = 0; i < 40; i++) {
                const h = 20 + Math.random() * 20;
                const w = 6 + Math.random() * 4;
                const bGeo = new THREE.BoxGeometry(w, h, w);
                const bMat = new THREE.MeshPhongMaterial({ color: 0x555566 });
                const building = new THREE.Mesh(bGeo, bMat);
                const x = 40 + Math.random() * 100;
                const z = (Math.random() - 0.5) * 250;
                building.position.set(x, h/2 - 5.1, z);
                scene.add(building);
                const bCollider = new CANNON.Body({ mass: 0, material: physicsMaterial });
                bCollider.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h/2, w/2)));
                bCollider.position.set(building.position.x, building.position.y, building.position.z);
                world.addBody(bCollider);
                colliderBodies.push(bCollider);
            }

            // 150 Smaller Houses (H: 5-10)
            for (let i = 0; i < 150; i++) {
                const h = 5 + Math.random() * 5;
                const w = 4 + Math.random() * 2;
                const bGeo = new THREE.BoxGeometry(w, h, w);
                const bMat = new THREE.MeshPhongMaterial({ color: 0x776655 });
                const building = new THREE.Mesh(bGeo, bMat);
                const x = 30 + Math.random() * 150;
                const z = (Math.random() - 0.5) * 300;
                building.position.set(x, h/2 - 5.1, z);
                scene.add(building);
                const bCollider = new CANNON.Body({ mass: 0, material: physicsMaterial });
                bCollider.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h/2, w/2)));
                bCollider.position.set(building.position.x, building.position.y, building.position.z);
                world.addBody(bCollider);
                colliderBodies.push(bCollider);
            }

            // Boats
            for (let i = 0; i < 15; i++) {
                const boatGroup = new THREE.Group();
                const hullGeo = new THREE.BoxGeometry(4, 1, 2);
                const hullMat = new THREE.MeshPhongMaterial({ color: 0xeeeeee });
                const hull = new THREE.Mesh(hullGeo, hullMat);
                boatGroup.add(hull);

                const cabinGeo = new THREE.BoxGeometry(1.5, 1, 1.2);
                const cabinMat = new THREE.MeshPhongMaterial({ color: 0x336699 });
                const cabin = new THREE.Mesh(cabinGeo, cabinMat);
                cabin.position.set(-0.5, 1, 0);
                boatGroup.add(cabin);

                const x = -10 - Math.random() * 100;
                const z = (Math.random() - 0.5) * 200;
                boatGroup.position.set(x, -5.3, z);
                boatGroup.rotation.y = Math.random() * Math.PI * 2;
                scene.add(boatGroup);
            }

            // LLF-69: real NativeCAD props on the seafront promenade (x ~ 4-10, the start of the
            // city plateau) via AssetLib — placeholders now, GLBs swap in when loaded.
            try {
                if (window.AssetLib) {
                    for (let z = -80; z <= 80; z += 32) {
                        AssetLib.place('street_lamp', { x: 6, y: coastHeight(6, z), z: z, rotY: Math.PI });
                    }
                    [[8, -40], [8, 24], [8, 72]].forEach(function (p) {
                        AssetLib.place('fire_hydrant', { x: p[0], y: coastHeight(p[0], p[1]), z: p[1], rotY: Math.PI });
                    });
                    [[3, -8, 0.3], [3.7, -7.2, 1.2], [3.2, -7.9, 0.3], [4, 46, 0.8], [3.4, 47, 2.2]].forEach(function (c, i) {
                        AssetLib.place('wooden_crate', { x: c[0], y: coastHeight(c[0], c[1]) + (i === 2 ? 0.38 : 0), z: c[1], rotY: c[2], lod: false });
                    });
                }
            } catch (e) { if (window.console) console.warn('[coastal_city] CAD props skipped:', e && e.message); }

            const sun = new THREE.DirectionalLight(0xFFFFFF, 1.2);
            sun.position.set(100, 100, 50);
            scene.add(sun);
            scene.add(new THREE.AmbientLight(0x888888));

            createLaunchers(); spawnNPC();
        }

        SCENES['COASTAL CITY'] = { build: createCoastalCityScene, kind: 'sandbox', menuOrder: 5 };
