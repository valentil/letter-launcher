// Letter Launcher — src/scenes/forest.js
// Scene "FOREST" (sandbox): createForestScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        function createForestScene() {
            currentScene = 'forest';
            scene.background = new THREE.Color(0x224422);
            scene.fog = new THREE.FogExp2(0x224422, 0.02);

            // Ground
            const forestGround = new CANNON.Body({ mass: 0 }); 
            forestGround.addShape(new CANNON.Box(new CANNON.Vec3(100, 1, 100))); 
            forestGround.position.set(0, -6.1, 0); 
            world.addBody(forestGround); 
            colliderBodies.push(forestGround);
            const groundGeo = new THREE.PlaneGeometry(200, 200);
            groundGeo.rotateX(-Math.PI / 2);
            const groundMat = new THREE.MeshPhongMaterial({ color: 0x113311 });
            const ground = new THREE.Mesh(groundGeo, groundMat);
            ground.position.y = -5.1;
            scene.add(ground);

            // Trees
            for (let i = 0; i < 100; i++) {
                const treeGroup = new THREE.Group();
                const trunkGeo = new THREE.CylinderGeometry(0.2, 0.4, 4);
                const trunkMat = new THREE.MeshPhongMaterial({ color: 0x442211 });
                const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                treeGroup.add(trunk);

                const leavesGeo = new THREE.ConeGeometry(2, 6, 8);
                const leavesMat = new THREE.MeshPhongMaterial({ color: 0x115511 });
                const leaves = new THREE.Mesh(leavesGeo, leavesMat);
                leaves.position.y = 4;
                treeGroup.add(leaves);

                const x = (Math.random() - 0.5) * 150;
                const z = (Math.random() - 0.5) * 150;
                if (Math.abs(x) < 5 && Math.abs(z) < 5) continue; // Clear center
                treeGroup.position.set(x, -3.1, z);
                scene.add(treeGroup);
            }

            const sun = new THREE.DirectionalLight(0xFFFFFF, 0.8);
            sun.position.set(10, 20, 10);
            scene.add(sun);

            createLaunchers(); spawnNPC();
        }

        SCENES['FOREST'] = { build: createForestScene, kind: 'sandbox', menuOrder: 9 };
