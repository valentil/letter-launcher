// Letter Launcher — src/scenes/city.js
// Scene "CITY" (sandbox): createCityScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        function createCityScene() {
            currentScene = 'city';
            scene.background = new THREE.Color(0x111122); // Night city
            scene.fog = new THREE.Fog(0x111122, 10, 150);

            // Ground - Road
            const cityGround = new CANNON.Body({ mass: 0 }); 
            cityGround.addShape(new CANNON.Box(new CANNON.Vec3(50, 1, 100))); 
            cityGround.position.set(0, -6.1, 0); 
            world.addBody(cityGround); 
            colliderBodies.push(cityGround);
            const roadGeo = new THREE.PlaneGeometry(100, 200);
            roadGeo.rotateX(-Math.PI / 2);
            const roadMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
            const road = new THREE.Mesh(roadGeo, roadMat);
            road.position.y = -5.1;
            scene.add(road);

            // Buildings
            for (let i = 0; i < 40; i++) {
                const h = 10 + Math.random() * 30;
                const w = 4 + Math.random() * 6;
                const bGeo = new THREE.BoxGeometry(w, h, w);
                const bMat = new THREE.MeshPhongMaterial({ color: 0x333344 });
                const building = new THREE.Mesh(bGeo, bMat);
                
                const x = (Math.random() > 0.5 ? 1 : -1) * (15 + Math.random() * 20);
                const z = (Math.random() - 0.5) * 150;
                building.position.set(x, h/2 - 5.1, z);
                scene.add(building);
                const bCollider = new CANNON.Body({ mass: 0, material: physicsMaterial });
                bCollider.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h/2, w/2)));
                bCollider.position.set(building.position.x, building.position.y, building.position.z);
                world.addBody(bCollider);
                colliderBodies.push(bCollider);

                // Windows
                const winGeo = new THREE.PlaneGeometry(0.5, 0.5);
                const winMat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.7 ? 0xFFFFEE : 0x111122 });
                for(let wy=1; wy < h-1; wy+=2) {
                    for(let wf=0; wf<4; wf++) {
                        const win = new THREE.Mesh(winGeo, winMat);
                        win.position.copy(building.position);
                        win.position.y = wy - 5.1;
                        if (wf === 0) win.position.z += w/2 + 0.01;
                        if (wf === 1) win.position.z -= w/2 + 0.01;
                        if (wf === 2) win.position.x += w/2 + 0.01;
                        if (wf === 3) win.position.x -= w/2 + 0.01;
                        scene.add(win);
                    }
                }
            }

            const light = new THREE.HemisphereLight(0x444477, 0x111122, 0.5);
            scene.add(light);

            createLaunchers(); spawnNPC();
        }

        SCENES['CITY'] = { build: createCityScene, kind: 'sandbox', menuOrder: 8 };
