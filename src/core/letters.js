// Letter Launcher — src/core/letters.js
// Letters: spawnLetter, spellWordInScene, explodeLetter, gravity wells, shapes, launchers, NPC/zoo/nuke spawns, combo fireworks, letter rain, fireworks.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // LLF-2: Combo-Based Firework Triggers. Called when the player types fast enough;
        // launches a staggered volley of fireworks above the scene plus a rising chord.
        function triggerComboFireworks(intensity) {
            intensity = intensity || 1;
            const bursts = 3 + Math.floor(intensity * 3);
            for (let i = 0; i < bursts; i++) {
                const pos = new THREE.Vector3(
                    (Math.random() - 0.5) * 30,
                    6 + Math.random() * 10,
                    (Math.random() - 0.5) * 10 - 2
                );
                setTimeout(() => spawnFirework(pos), i * 90);
            }
            initAudio();
            if (audioCtx) {
                const now = audioCtx.currentTime;
                [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(f, now + i * 0.06);
                    gain.gain.setValueAtTime(0.0001, now + i * 0.06);
                    gain.gain.exponentialRampToValueAtTime(0.25 * soundVolume, now + i * 0.06 + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.4);
                    osc.connect(gain); gain.connect(audioCtx.destination);
                    osc.start(now + i * 0.06); osc.stop(now + i * 0.06 + 0.4);
                });
            }
        }

        // LLF-12: Alphabetical Rain Mode. Rains one letter from above the camera frustum for
        // ~RAIN_DURATION_MS. Reuses spawnLetter (so the body cap retires the oldest letters) and
        // guards with rainActive so a held key can't stack showers. Soft filtered-noise bed while it falls.
        function startLetterRain(char, byHold) {
            if (rainActive || !font || !gameStarted) return;
            rainActive = true; rainByHold = !!byHold;
            try { startRainBed(); } catch (e) {}
            rainTimer = setInterval(() => {
                try {
                    if (!gameStarted) { stopLetterRain(); return; }
                    const obj = spawnLetter(char);
                    if (obj && obj.body) {
                        const fov = (camera && camera.fov ? camera.fov : 75) * Math.PI / 360;
                        const dist = camera ? Math.max(10, camera.position.length()) : 16;
                        const top = (camera ? camera.position.y : 0) + Math.tan(fov) * dist + 4; // above the view
                        obj.body.position.set((Math.random() - 0.5) * 24, Math.max(16, top) + Math.random() * 6, (Math.random() - 0.5) * 8 - 1);
                        obj.body.velocity.set(0, -2, 0);
                    }
                } catch (e) { stopLetterRain(); }
            }, RAIN_INTERVAL_MS);
            rainEndTimer = setTimeout(stopLetterRain, RAIN_DURATION_MS);
        }

        function stopLetterRain() {
            if (rainTimer) { clearInterval(rainTimer); rainTimer = null; }
            if (rainEndTimer) { clearTimeout(rainEndTimer); rainEndTimer = null; }
            rainActive = false; rainByHold = false;
            try { stopRainBed(); } catch (e) {}
        }

        function startRainBed() {
            if (!audioCtx || rainBed) return;
            const len = audioCtx.sampleRate * 2;
            const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            const src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = true;
            const filt = audioCtx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 3200; filt.Q.value = 0.6;
            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.06 * soundVolume, audioCtx.currentTime + 0.3);
            src.connect(filt); filt.connect(gain); gain.connect(audioCtx.destination);
            src.start();
            rainBed = { src: src, gain: gain };
        }

        function stopRainBed() {
            if (!rainBed) return;
            const bed = rainBed; rainBed = null;
            const t = audioCtx.currentTime;
            bed.gain.gain.cancelScheduledValues(t);
            bed.gain.gain.setValueAtTime(bed.gain.gain.value, t);
            bed.gain.gain.linearRampToValueAtTime(0, t + 0.4);
            try { bed.src.stop(t + 0.45); } catch (e) {}
        }

        function spawnScreenLetter(char) {
            console.log("Spawning screen letter:", char);
            const el = document.createElement('div');
            el.innerHTML = char;
            el.style.position = 'absolute';
            el.style.color = '#fff';
            el.style.fontSize = '120px';
            el.style.fontWeight = 'bold';
            el.style.fontFamily = 'Arial, sans-serif';
            // Center-ish area
            el.style.left = (20 + Math.random() * 60) + '%';
            el.style.top = (20 + Math.random() * 60) + '%';
            el.style.textShadow = '0 0 20px #00f, 0 0 40px #00f';
            el.style.zIndex = '1000';
            
            const mark = document.createElement('div');
            mark.style.position = 'absolute';
            mark.style.width = '200%';
            mark.style.height = '200%';
            mark.style.left = '-50%';
            mark.style.top = '-50%';
            mark.style.background = 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 70%)';
            mark.style.borderRadius = '50%';
            el.appendChild(mark);

            const container = document.getElementById('waterMarkOverlay');
            if (container) {
                container.appendChild(el);
                screenLetters.push({ 
                    el: el, 
                    y: parseFloat(el.style.top), 
                    vy: 0, 
                    life: 1.0, 
                    stuckTimer: 2.0 // Stick for 2 seconds
                });
            } else {
                console.error("waterMarkOverlay not found!");
            }
        }

        // NOTE: init()/animate() are invoked at the very END of this script so
        // that every top-level let/const (including the word-quest game state)
        // is initialized before the first frame runs.

        function spawnNPC() {
            if (physicsBodies.find(pb => pb.type === 'npc')) return;
            const loader = new THREE.GLTFLoader();
            loader.load('/LetterLauncher/combo_dino_fixed.glb', (gltf) => {
                const model = gltf.scene;
                model.scale.set(0.5, 0.5, 0.5);
                scene.add(model);
                
                if (gltf.animations && gltf.animations.length > 0) {
                    npcMixer = new THREE.AnimationMixer(model);
                    const action = npcMixer.clipAction(gltf.animations[0]);
                    action.play();
                }

                const npcBody = new CANNON.Body({ mass: 1 });
                npcBody.addShape(new CANNON.Box(new CANNON.Vec3(1.0, 1.5, 1.0)));
                npcBody.position.set((Math.random()-0.5)*20, 5, (Math.random()-0.5)*20);
                npcBody.fixedRotation = true;
                npcBody.updateMassProperties();
                world.addBody(npcBody);
                physicsBodies.push({ mesh: model, body: npcBody, type: 'npc', wanderTimer: 0, fireTimer: 5, wanderTowardCamera: true, wanderStartTime: Date.now() });
            });
        }

        function spawnZooAnimal(animal) {
            if (!font) return;
            
            const zooAnimals = {
                'LION': { color: 0xFFD700, scale: 3, sound: 'LION' },
                'ELEPHANT': { color: 0x808080, scale: 5, sound: 'ELEPHANT' },
                'MONKEY': { color: 0x8B4513, scale: 1.5, sound: 'MONKEY' },
                'ZEBRA': { color: 0xFFFFFF, scale: 2.5, sound: 'ZEBRA' },
                'GIRAFFE': { color: 0xFFA500, scale: 6, sound: 'GIRAFFE' }
            };

            const config = zooAnimals[animal] || { color: 0xffffff, scale: 2, sound: animal };
            playZooAnimalSound(config.sound);

            const geo = new THREE.TextGeometry(animal, { font: font, size: config.scale, height: config.scale * 0.4 });
            geo.computeBoundingBox();
            const material = new THREE.MeshPhongMaterial({ color: config.color, shininess: 80 });
            const mesh = new THREE.Mesh(geo, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const box = new THREE.Box3().setFromObject(mesh);
            const size = new THREE.Vector3();
            box.getSize(size);

            // Bowl fix: drop the animal above the bowl center so it lands on-screen.
            const pos = bowlSpawnPos(size.y);
            mesh.position.copy(pos);
            scene.add(mesh);

            const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
            const body = new CANNON.Body({ mass: config.scale * 2, material: physicsMaterial });
            body.addShape(shape);
            body.position.set(pos.x, pos.y, pos.z);
            world.addBody(body);

            physicsBodies.push({ mesh, body, type: 'zoo_animal', animal: animal, wanderTimer: 0, wanderTarget: new CANNON.Vec3(0,0,0) });
            
            retireExcessBodies();
            }

        function launchNuke() {
            // Screen shake
            const originalPos = camera.position.clone();
            let shakeTime = 0;
            const shakeInterval = setInterval(() => {
                camera.position.x = originalPos.x + (Math.random() - 0.5) * 2;
                camera.position.y = originalPos.y + (Math.random() - 0.5) * 2;
                shakeTime += 50;
                if (shakeTime > 7000) { // Extended for the new sequence
                    clearInterval(shakeInterval);
                    camera.position.copy(originalPos);
                }
            }, 50);

            // Audio sequence
            initAudio();
            const now = audioCtx.currentTime;
            
            // Air Raid Siren
            const sirenOsc = audioCtx.createOscillator();
            const sirenGain = audioCtx.createGain();
            sirenOsc.type = 'sine';
            sirenOsc.frequency.setValueAtTime(440, now);
            sirenGain.gain.setValueAtTime(0, now);
            sirenGain.gain.linearRampToValueAtTime(0.01 * soundVolume, now + 0.5);
            
            // Wailing effect
            for (let i = 0; i < 100; i++) {
                sirenOsc.frequency.exponentialRampToValueAtTime(140, now + i);
                sirenOsc.frequency.exponentialRampToValueAtTime(480, now + i + 0.5);
            }
            
            sirenOsc.connect(sirenGain);
            sirenGain.connect(audioCtx.destination);
            sirenOsc.start(now);
            sirenOsc.stop(now + 20); // 5s before, then during explosion

            // Explosion Sound at 5s
            setTimeout(() => {
                const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
                const output = noiseBuffer.getChannelData(0);
                for (let i = 0; i < audioCtx.sampleRate * 2; i++) output[i] = Math.random() * 2 - 1;
                
                const noise = audioCtx.createBufferSource();
                noise.buffer = noiseBuffer;
                const filter = audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(500, audioCtx.currentTime);
                filter.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 2);
                
                const expGain = audioCtx.createGain();
                expGain.gain.setValueAtTime(1 * soundVolume, audioCtx.currentTime);
                expGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 2);
                
                noise.connect(filter);
                filter.connect(expGain);
                expGain.connect(audioCtx.destination);
                noise.start();
                
                // Fade out siren
                sirenGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 5);
            }, 5000);

            // Visual sequence
            setTimeout(() => {
                // White Flash
                const flashGeo = new THREE.SphereGeometry(200, 32, 32);
                const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, side: THREE.BackSide });
                const flash = new THREE.Mesh(flashGeo, flashMat);
                flash.position.set(0, 0, 0);
                scene.add(flash);
                
                let opacity = 1;
                const fadeInterval = setInterval(() => {
                    opacity -= 0.05;
                    flash.material.opacity = opacity;
                    if (opacity <= 0) {
                        clearInterval(fadeInterval);
                        scene.remove(flash);
                    }
                }, 50);

                // Orange Glow Fade
                const glowGeo = new THREE.SphereGeometry(180, 32, 32);
                const glowMat = new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.8, side: THREE.BackSide });
                const glow = new THREE.Mesh(glowGeo, glowMat);
                glow.position.set(0, 0, 0);
                scene.add(glow);
                
                let glowOpacity = 0.8;
                const glowFadeInterval = setInterval(() => {
                    glowOpacity -= 0.01;
                    glow.material.opacity = glowOpacity;
                    if (glowOpacity <= 0) {
                        clearInterval(glowFadeInterval);
                        scene.remove(glow);
                    }
                }, 50);

                // Physics Push
                physicsBodies.forEach(pb => {
                    const dir = pb.body.position.clone();
                    dir.normalize();
                    pb.body.applyImpulse(new CANNON.Vec3(dir.x * 100, 100, dir.z * 100), pb.body.position);
                });

                // Mushroom Cloud
                for (let i = 0; i < 200; i++) {
                    setTimeout(() => {
                        const r = Math.random() * 2;
                        const angle = Math.random() * Math.PI * 2;
                        const h = Math.random() * 15;
                        const pos = new THREE.Vector3(
                            Math.cos(angle) * r * (h/5 + 1), 
                            -5 + h, 
                            Math.sin(angle) * r * (h/5 + 1)
                        );
                        spawnFirework(pos);
                    }, i * 5);
                }
            }, 5000);
        }

        function createLaunchers() {
            launchers.forEach(l => scene.remove(l));
            launchers = [];
            const launcherGeo = new THREE.CylinderGeometry(0.5, 0.7, 1.5, 16);
            const launcherMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
            
            const positions = [
                new THREE.Vector3(-10, 10, 0),
                new THREE.Vector3(10, 10, 0),
                new THREE.Vector3(0, 12, -5)
            ];

            positions.forEach(pos => {
                const launcher = new THREE.Mesh(launcherGeo, launcherMat);
                launcher.position.copy(pos);
                launcher.rotation.x = Math.PI; // Point down
                scene.add(launcher);
                launchers.push(launcher);
            });
        }

        function spawnLetter(char) {
            if (!font) return;

            // LLF-34: Enforce maxLetters
            retireExcessBodies();
            const geo = new THREE.TextGeometry(char, { font: font, size: 1, height: 0.4 });
            geo.computeBoundingBox();
            
            // LLF-47: Metallic bump mapping for letters
            // LLF-52: Randomize color
            const material = new THREE.MeshStandardMaterial({ 
                color: Math.random() * 0xffffff,
                metalness: 0.8,
                roughness: 0.3,
                envMapIntensity: 1.0,
                flatShading: true // Gives a faceted, metallic look
            });
            const mesh = new THREE.Mesh(geo, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            const box = new THREE.Box3().setFromObject(mesh);
            const size = new THREE.Vector3();
            box.getSize(size);
            
            // Bowl fix: drop ABOVE the bowl center (golden-angle spiral) so letters fall
            // into the bowl and pile up centered on screen. Falls back to the play box.
            if (!bowlInfo && !playBounds) setupPlayArea();
            const pos = bowlSpawnPos(size.y);
            pos.x += (Math.random() - 0.5) * 0.4;
            pos.z += (Math.random() - 0.5) * 0.4;
            mesh.position.copy(pos);
            scene.add(mesh);

            const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
            const body = new CANNON.Body({ mass: 1, material: physicsMaterial });
            body.addShape(shape);
            body.position.set(pos.x, pos.y, pos.z);
            body.angularVelocity.set(Math.random() * 5, Math.random() * 5, Math.random() * 5);
            world.addBody(body);

            physicsBodies.push({ mesh, body });

            // LLF-34: Keep count and delete older ones
            retireExcessBodies();
            return { mesh, body };
        }

        function spellWordInScene(word) {
            if (!font) return;

            // LLF-57: NPC presentation logic
            const npc = physicsBodies.find(pb => pb.type === 'npc');
            if (npc) {
                // LLB-16: Clear previous word's letters if still presenting or just finished
                if (npc.shownLetters) {
                    npc.shownLetters.forEach(l => {
                        // Give them a little kick away
                        l.body.applyImpulse(new CANNON.Vec3((Math.random()-0.5)*5, 5, (Math.random()-0.5)*5), l.body.position);
                    });
                }
                npc.presentingWord = word;
                npc.presentingCharIdx = 0;
                npc.presentingTimer = 0;
                npc.shownLetters = [];
                yellWord(word);
                return;
            }

            // LLF-52: TTS the word
            yellWord(word);

            // Bowl fix: center the spelled row over the bowl and drop it from above the
            // rim so the whole word falls into the bowl on-screen.
            const bx = bowlInfo ? bowlInfo.cx : 0;
            const bz = bowlInfo ? bowlInfo.cz : -10;
            const dropY = bowlInfo ? (bowlInfo.topY + 4) : 15;
            const startX = bx - (word.length / 2) * 1.5;
            for (let i = 0; i < word.length; i++) {
                const char = word[i];

                // LLF-34: Enforce maxLetters
                retireExcessBodies();
            const geo = new THREE.TextGeometry(char, { font: font, size: 1.5, height: 0.6 });
                geo.computeBoundingBox();
                // LLF-47: Metallic bump mapping for word letters
                // LLF-52: Randomize color
                const material = new THREE.MeshStandardMaterial({ 
                    color: Math.random() * 0xffffff, 
                    emissive: 0x000000,
                    metalness: 0.8,
                    roughness: 0.3,
                    envMapIntensity: 1.2,
                    flatShading: true
                });
                const mesh = new THREE.Mesh(geo, material);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                
                const box = new THREE.Box3().setFromObject(mesh);
                const size = new THREE.Vector3();
                box.getSize(size);
                
                // LLF-52: Randomize starting position slightly
                const pos = new THREE.Vector3(startX + i * 1.5 + (Math.random() - 0.5) * 0.4, dropY + (Math.random() * 2), bz + (Math.random() - 0.5) * 0.6);
                mesh.position.copy(pos);
                scene.add(mesh);

                const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
                const body = new CANNON.Body({ mass: 5, material: physicsMaterial }); // Heavier letters
                body.addShape(shape);
                body.position.set(pos.x, pos.y, pos.z);
                world.addBody(body);

                physicsBodies.push({ mesh, body, isSpelled: true });
                
                // LLF-34: Keep count and delete older ones
                retireExcessBodies();
            // Add an upward force to "stand them up" initially
                body.applyImpulse(new CANNON.Vec3(0, 5, 0), body.position);
            }
        }

        function createGravityWell(word, position) {
            const well = {
                word: word,
                position: position.clone(),
                startTime: Date.now(),
                duration: 5000, // 5 seconds
                radius: 15,
                strength: 50,
                mesh: null
            };

            // Visual for gravity well
            const geo = new THREE.TorusGeometry(2, 0.05, 16, 100);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(position);
            scene.add(mesh);
            well.mesh = mesh;

            gravityWells.push(well);
        }

        function spawnShape() {
            const shapes = ['cube', 'sphere', 'box'];
            const type = shapes[Math.floor(Math.random() * shapes.length)];
            let geo, shape;
            const size = 1;
            // LLF-47: Metallic shape material
            const material = new THREE.MeshStandardMaterial({ 
                color: Math.random() * 0xffffff,
                metalness: 0.8,
                roughness: 0.3,
                envMapIntensity: 1.0,
                flatShading: true
            });

            // LLF-34: Enforce maxLetters
            retireExcessBodies();
            if (type === 'cube' || type === 'box') {
                geo = new THREE.BoxGeometry(size, size, size);
                shape = new CANNON.Box(new CANNON.Vec3(size/2, size/2, size/2));
            } else {
                geo = new THREE.SphereGeometry(size/2, 16, 16);
                shape = new CANNON.Sphere(size/2);
            }

            const mesh = new THREE.Mesh(geo, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            // Bowl fix: drop the shape above the bowl center so it lands on-screen.
            const pos = bowlSpawnPos(size);
            mesh.position.copy(pos);
            scene.add(mesh);

            const body = new CANNON.Body({ mass: 1, material: physicsMaterial });
            body.addShape(shape);
            body.position.set(pos.x, pos.y, pos.z);
            body.angularVelocity.set(Math.random() * 5, Math.random() * 5, Math.random() * 5);
            world.addBody(body);

            physicsBodies.push({ mesh, body });

            // LLF-34: Keep count and delete older ones
            retireExcessBodies();
            }

        function spawnFirework(pos) {
            const particleCount = 20;
            const particles = [];
            
            for (let i = 0; i < particleCount; i++) {
                const geo = new THREE.SphereGeometry(0.05, 4, 4);
                const mat = new THREE.MeshBasicMaterial({ color: Math.random() * 0xffffff });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(pos);
                scene.add(mesh);
                
                const angle = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI;
                const speed = 0.05 + Math.random() * 0.1;
                const velocity = new THREE.Vector3(
                    Math.sin(phi) * Math.cos(angle) * speed,
                    Math.sin(phi) * Math.sin(angle) * speed,
                    Math.cos(phi) * speed
                );
                
                particles.push({ mesh, velocity, life: 1.0 });
            }
            
            // Add a temporary animation loop or manage in main animate
            scene.userData.activeFireworks = scene.userData.activeFireworks || [];
            scene.userData.activeFireworks.push(...particles);
            capParticles(); // W5
        }

        // === LLF-Fix3: Cinematic detonation with varied burst styles =========
        // Extends the LLF-2 firework code. Each detonation randomly picks a color and one
        // of several burst styles. Particles carry optional per-particle gravity/drag/decay
        // (honored by the firework animate loop) so willow/ring/etc. look distinct.
        const FIREWORK_STYLES = ['sphere', 'willow', 'ring', 'crackle', 'palm'];
        function fwParticle(pos, velocity, color, opts) {
            const geo = new THREE.SphereGeometry((opts && opts.size) || 0.07, 4, 4);
            const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1.0 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            scene.add(mesh);
            scene.userData.activeFireworks = scene.userData.activeFireworks || [];
            scene.userData.activeFireworks.push(Object.assign(
                { mesh, velocity, life: 1.0, gravity: 0.0016, drag: 1.0, decay: 0.02 },
                opts || {}
            ));
        }
        function detonateFirework(pos, style, hue) {
            style = style || FIREWORK_STYLES[Math.floor(Math.random() * FIREWORK_STYLES.length)];
            hue = (hue == null) ? Math.random() : hue;
            playRocketBoom(); // LLF-Fix4 sound
            const col = (h, s, l) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s == null ? 0.9 : s, l == null ? 0.55 : l);
            if (style === 'willow') {
                // Slow, drooping golden trails: low speed, strong gravity, long life.
                for (let i = 0; i < 34; i++) {
                    const a = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
                    const sp = 0.06 + Math.random() * 0.06;
                    fwParticle(pos, new THREE.Vector3(
                        Math.sin(phi) * Math.cos(a) * sp,
                        Math.abs(Math.cos(phi)) * sp * 1.3 + 0.05, // bias upward first
                        Math.sin(phi) * Math.sin(a) * sp
                    ), col(0.09 + Math.random() * 0.05, 0.85, 0.55), { gravity: 0.0045, drag: 0.985, decay: 0.011, size: 0.08 });
                }
            } else if (style === 'ring') {
                // Flat expanding ring in a random tilted plane.
                const tilt = (Math.random() - 0.5) * 0.6;
                const baseHue = hue;
                for (let i = 0; i < 30; i++) {
                    const a = (i / 30) * Math.PI * 2;
                    const sp = 0.17 + Math.random() * 0.03;
                    fwParticle(pos, new THREE.Vector3(
                        Math.cos(a) * sp,
                        Math.sin(a) * sp * tilt,
                        Math.sin(a) * sp
                    ), col(baseHue + Math.random() * 0.06), { gravity: 0.0008, drag: 0.99, decay: 0.016 });
                }
            } else if (style === 'crackle') {
                // Bright compact flash, then a few delayed micro-pops (the "crackle").
                for (let i = 0; i < 16; i++) {
                    const a = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
                    const sp = 0.1 + Math.random() * 0.12;
                    fwParticle(pos, new THREE.Vector3(
                        Math.sin(phi) * Math.cos(a) * sp,
                        Math.sin(phi) * Math.sin(a) * sp,
                        Math.cos(phi) * sp
                    ), col(hue, 0.2, 0.9), { gravity: 0.0016, decay: 0.05, size: 0.06 });
                }
                for (let k = 0; k < 3; k++) {
                    setTimeout(() => {
                        if (!scene) return;
                        const off = new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3).add(pos);
                        for (let i = 0; i < 8; i++) {
                            const a = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
                            const sp = 0.08 + Math.random() * 0.08;
                            fwParticle(off, new THREE.Vector3(
                                Math.sin(phi) * Math.cos(a) * sp,
                                Math.sin(phi) * Math.sin(a) * sp,
                                Math.cos(phi) * sp
                            ), col(Math.random(), 0.3, 0.95), { gravity: 0.002, decay: 0.06, size: 0.05 });
                        }
                        capParticles();
                    }, 120 + k * 120);
                }
            } else if (style === 'palm') {
                // A few thick fronds that rise then droop.
                for (let f = 0; f < 9; f++) {
                    const a = (f / 9) * Math.PI * 2;
                    const sp = 0.15 + Math.random() * 0.05;
                    fwParticle(pos, new THREE.Vector3(
                        Math.cos(a) * sp * 0.6,
                        0.18 + Math.random() * 0.05,
                        Math.sin(a) * sp * 0.6
                    ), col(hue + Math.random() * 0.04, 0.9, 0.6), { gravity: 0.004, drag: 0.985, decay: 0.013, size: 0.1 });
                }
            } else {
                // 'sphere' — classic even burst.
                for (let i = 0; i < 28; i++) {
                    const a = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
                    const sp = 0.12 + Math.random() * 0.1;
                    fwParticle(pos, new THREE.Vector3(
                        Math.sin(phi) * Math.cos(a) * sp,
                        Math.sin(phi) * Math.sin(a) * sp,
                        Math.cos(phi) * sp
                    ), col(hue + Math.random() * 0.08), { gravity: 0.0016, decay: 0.02 });
                }
            }
            capParticles(); // W5: never leak particles
        }

        function spawnFireParticle(pos) {
            const geo = new THREE.SphereGeometry(0.1 + Math.random() * 0.1, 4, 4);
            const colors = [0xff4400, 0xff8800, 0xffaa00, 0xffff00];
            const mat = new THREE.MeshBasicMaterial({
                color: colors[Math.floor(Math.random() * colors.length)],
                transparent: true,
                opacity: 0.8
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            scene.add(mesh);

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 0.05,
                0.1 + Math.random() * 0.1,
                (Math.random() - 0.5) * 0.05
            );

            scene.userData.activeFireworks = scene.userData.activeFireworks || [];
            scene.userData.activeFireworks.push({ mesh, velocity, life: 1.0 });
            capParticles(); // W5
        }

        function explodeLetter(pb) {
            const pos = pb.mesh.position.clone();
            
            // LLF-4: Burst with a localized force field effect
            physicsBodies.forEach(other => {
                if (other === pb) return;
                const dist = other.body.position.distanceTo(pb.body.position);
                if (dist < 10) {
                    const dir = other.body.position.vsub(pb.body.position);
                    dir.normalize();
                    const force = 30 * (1 - dist/10);
                    other.body.applyImpulse(dir.scale(force), other.body.position);
                }
            });

            // Shatter into smaller glowing particles
            for (let i = 0; i < 30; i++) {
                const geo = new THREE.SphereGeometry(0.1 + Math.random() * 0.1, 4, 4);
                const mat = new THREE.MeshStandardMaterial({ 
                    color: pb.mesh.material.color || 0x00ffff,
                    emissive: pb.mesh.material.color || 0x00ffff,
                    emissiveIntensity: 2
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(pos);
                scene.add(mesh);

                const angle = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI;
                const speed = 0.2 + Math.random() * 0.4;
                const velocity = new THREE.Vector3(
                    Math.sin(phi) * Math.cos(angle) * speed,
                    Math.sin(phi) * Math.sin(angle) * speed,
                    Math.cos(phi) * speed
                );

                scene.userData.activeFireworks = scene.userData.activeFireworks || [];
                scene.userData.activeFireworks.push({ mesh, velocity, life: 1.0 + Math.random() });
            }
            capParticles(); // W5: bound particle count after a shatter burst

            // Sound
            initAudio();
            if (audioCtx) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(400, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.2 * soundVolume, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.3);
            }

            // Remove original
            scene.remove(pb.mesh);
            world.removeBody(pb.body);
            physicsBodies = physicsBodies.filter(p => p !== pb);
            if (pb.mesh.geometry) pb.mesh.geometry.dispose();
            if (pb.mesh.material) pb.mesh.material.dispose();
        }
