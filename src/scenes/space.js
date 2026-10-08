// Letter Launcher — src/scenes/space.js
// Scene "SPACE" (sandbox): createSpaceScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        function createSpaceScene() {
            currentScene = 'space';
            scene.background = new THREE.Color(0x000005);
            
            // W1: Give SPACE a real, VISIBLE moon surface (with craters) that the
            // physics collider matches, so letters rest on the moon instead of on an
            // invisible plane floating in the void.
            const moonCraters = [
                { x: 8, z: -6, r: 11, d: 2.4 }, { x: -16, z: 10, r: 14, d: 3.0 },
                { x: 22, z: 20, r: 9, d: 1.8 }, { x: -6, z: 26, r: 12, d: 2.6 },
                { x: 30, z: -18, r: 10, d: 2.0 }
            ];
            const moonHeight = (x, z) => {
                let h = -5.1 + Math.sin(x * 0.08) * Math.cos(z * 0.08) * 0.6;
                for (const c of moonCraters) {
                    const dd = Math.hypot(x - c.x, z - c.z);
                    if (dd < c.r) h -= c.d * (1 - (dd / c.r) * (dd / c.r));
                }
                return h;
            };
            const moonGeo = new THREE.PlaneGeometry(320, 320, 96, 96);
            moonGeo.rotateX(-Math.PI / 2);
            const moonVerts = moonGeo.attributes.position.array;
            for (let i = 0; i < moonVerts.length; i += 3) {
                moonVerts[i + 1] = moonHeight(moonVerts[i], moonVerts[i + 2]);
            }
            moonGeo.computeVertexNormals();
            const moonMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1.0, metalness: 0.0, flatShading: true });
            const moonSurface = new THREE.Mesh(moonGeo, moonMat);
            moonSurface.receiveShadow = true;
            scene.add(moonSurface);
            addHeightfieldCollider(-160, -160, 160, 160, 5, moonHeight, 'moon_surface');

            // Starfield
            const starGeo = new THREE.BufferGeometry();
            const starCount = 1000;
            const starPos = new Float32Array(starCount * 3);
            for (let i = 0; i < starCount * 3; i++) {
                starPos[i] = (Math.random() - 0.5) * 400;
            }
            starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
            const starMat = new THREE.PointsMaterial({ color: 0xFFFFFF, size: 0.5 });
            const stars = new THREE.Points(starGeo, starMat);
            scene.add(stars);

            // Nebula-like effect
            const nebulaGeo = new THREE.SphereGeometry(100, 32, 32);
            const nebulaMat = new THREE.MeshBasicMaterial({ 
                color: 0x220044, 
                side: THREE.BackSide, 
                transparent: true, 
                opacity: 0.3 
            });
            const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
            scene.add(nebula);

            // Planet
            const planetGeo = new THREE.SphereGeometry(20, 32, 32);
            const planetMat = new THREE.MeshPhongMaterial({ color: 0x4488FF, emissive: 0x112244 });
            const planet = new THREE.Mesh(planetGeo, planetMat);
            planet.position.set(-60, 20, -100);
            scene.add(planet);

            // Floating rocks
            for (let i = 0; i < 20; i++) {
                const rockGeo = new THREE.IcosahedronGeometry(1 + Math.random(), 0);
                const rockMat = new THREE.MeshPhongMaterial({ color: 0x888888, flatShading: true });
                const rock = new THREE.Mesh(rockGeo, rockMat);
                rock.position.set((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100, -50 - Math.random() * 50);
                rock.userData.rotationSpeed = Math.random() * 0.02;
                scene.add(rock);
            }

            const light = new THREE.PointLight(0xFFFFFF, 2, 200);
            light.position.set(0, 50, 50);
            scene.add(light);

            // LLF-86: lunar rover + comms dish (src/scenes/kit.js)
            try { if (typeof llfKitPlace === 'function') llfKitPlace('SPACE', moonHeight); }
            catch (e) { if (window.console) console.warn('[space] kit skipped:', e && e.message); }

            createLaunchers(); spawnNPC();
        }

        SCENES['SPACE'] = { build: createSpaceScene, kind: 'sandbox', menuOrder: 7 };
