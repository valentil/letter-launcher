// Letter Launcher — src/scenes/desert.js
// Scene "DESERT" (sandbox): createDesertScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        function createDesertScene() {
            currentScene = 'desert';
            scene.background = new THREE.Color(0x87CEEB); // Sky blue
            scene.fog = new THREE.FogExp2(0xEEDD88, 0.01);

            // Ground / Sand - LLF-44: Improved texture feel with flatShading and shadows
            const groundGeo = new THREE.PlaneGeometry(320, 320, 80, 80);
            groundGeo.rotateX(-Math.PI / 2);

            const vertices = groundGeo.attributes.position.array;
            for (let i = 0; i < vertices.length; i += 3) {
                const x = vertices[i];
                const z = vertices[i+2];
                vertices[i+1] = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2; // Dunes
            }
            groundGeo.computeVertexNormals();
            const groundMat = new THREE.MeshPhongMaterial({ 
                color: 0xEEDD88, 
                flatShading: true,
                shininess: 0
            });
            const ground = new THREE.Mesh(groundGeo, groundMat);
            ground.position.y = -5.1;
            ground.receiveShadow = true;
            scene.add(ground);
            // W1: heightfield collider matching the visible dunes (was a flat box, so
            // letters used to float over troughs and sink into crests).
            const desertHeight = (x, z) => -5.1 + Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
            addHeightfieldCollider(-150, -150, 150, 150, 5, desertHeight, 'desert_ground');

            // Mountains - LLF-44: Visceral flat-shaded look
            for (let i = 0; i < 5; i++) {
                const mtGeo = new THREE.ConeGeometry(20 + Math.random() * 20, 30 + Math.random() * 20, 4);
                const mtMat = new THREE.MeshPhongMaterial({ 
                    color: 0xCCAA77, 
                    flatShading: true,
                    shininess: 10
                });
                const mt = new THREE.Mesh(mtGeo, mtMat);
                mt.position.set((Math.random() - 0.5) * 150, 10, -80 - Math.random() * 20);
                mt.rotation.y = Math.random() * Math.PI;
                mt.castShadow = true;
                mt.receiveShadow = true;
                scene.add(mt);
                const mtCollider = new CANNON.Body({ mass: 0 });
                mtCollider.addShape(new CANNON.Cylinder(0.1, 30, 50, 4));
                mtCollider.position.set(mt.position.x, mt.position.y, mt.position.z);
                world.addBody(mtCollider);
                colliderBodies.push(mtCollider);
            }

            // Oasis
            const oasisGeo = new THREE.CircleGeometry(8, 32);
            oasisGeo.rotateX(-Math.PI / 2);
            const oasisMat = new THREE.MeshPhongMaterial({ 
                color: 0x00AADD, 
                transparent: true, 
                opacity: 0.8,
                shininess: 100
            });
            const oasis = new THREE.Mesh(oasisGeo, oasisMat);
            oasis.position.set(0, -5.05, 0);
            oasis.receiveShadow = true;
            scene.add(oasis);

            // Sparkles for Oasis
            const sparkleGeo = new THREE.BufferGeometry();
            const sparkleCount = 50;
            const sparklePos = new Float32Array(sparkleCount * 3);
            for (let i = 0; i < sparkleCount * 3; i += 3) {
                const r = Math.random() * 7;
                const theta = Math.random() * Math.PI * 2;
                sparklePos[i] = Math.cos(theta) * r;
                sparklePos[i+1] = -5.04;
                sparklePos[i+2] = Math.sin(theta) * r;
            }
            sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePos, 3));
            const sparkleMat = new THREE.PointsMaterial({ color: 0xFFFFFF, size: 0.2, transparent: true });
            const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
            scene.add(sparkles);
            scene.userData.sparkles = sparkles;

            // Palm Tree
            const palmGroup = new THREE.Group();
            const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 6, 8);
            const trunkMat = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = 3;
            trunk.castShadow = true;
            trunk.receiveShadow = true;
            palmGroup.add(trunk);

            const leafMat = new THREE.MeshPhongMaterial({ color: 0x228B22 });
            for (let i = 0; i < 8; i++) {
                const leafGeo = new THREE.BoxGeometry(4, 0.1, 1);
                leafGeo.translate(2, 0, 0);
                const leaf = new THREE.Mesh(leafGeo, leafMat);
                leaf.position.y = 6;
                leaf.rotation.y = (i / 8) * Math.PI * 2;
                leaf.rotation.z = 0.2;
                leaf.castShadow = true;
                leaf.receiveShadow = true;
                palmGroup.add(leaf);
            }
            palmGroup.position.set(5, -5, 2);
            scene.add(palmGroup);

            // Sun Light already added in init(), but we can add secondary fills
            const fillLight = new THREE.HemisphereLight(0x444477, 0x111122, 0.2);
            scene.add(fillLight);

            createLaunchers(); spawnNPC();
        }

        SCENES['DESERT'] = { build: createDesertScene, kind: 'sandbox', menuOrder: 6 };
