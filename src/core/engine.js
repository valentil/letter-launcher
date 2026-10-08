// Letter Launcher — src/core/engine.js
// Engine: shared global state, renderer/camera/world setup (init), camera framing, body/particle caps, onWindowResize and the animate() loop.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.
        let scene, camera, renderer, font, world, physicsMaterial;
        let menuItems = ['START GAME', 'SCENES', 'OPTIONS', 'EXIT'];
        let menuMeshes = [];
        let physicsBodies = []; let colliderBodies = [];
        let gravityWells = [];
        let typedWord = "";
        let inputBuffer = ""; // Last 16 characters
        let lastTypeTime = 0;
        let wordPending = null; // LLF-35: { word, timer }
        let selectedIndex = 0;
        let gameStarted = false;
        // Menu state machine: exactly ONE of these screens is active at a time.
        // 'MAIN' (Scenes/Options/Exit), 'SCENES', 'OPTIONS', 'PLAYING' (no menu).
        // setMenuScreen() below is the single authority; the legacy boolean flags
        // (gameStarted / inScenesMenu / inOptionsMenu) are kept in sync from it so the
        // rest of the code (hint, hover, animate) keeps working.
        const MENU_SCREENS = ['MAIN', 'SCENES', 'OPTIONS', 'PLAYING'];
        let menuScreen = 'MAIN';
        let inScenesMenu = false;
        let inOptionsMenu = false;
        let optionsMenuMeshes = [];
        let optionsItems = ['SOUND VOLUME', 'GRAVITY', 'MAX LETTERS', 'BACK'];
        let selectedOptionIndex = 0;
        let soundVolume = 4.0;
        let worldGravity = -9.82;
        let scenesMenuMeshes = [];
        // Word-quest game levels first, then the classic sandbox scenes.
        const GAME_LEVEL_NAMES = ['KYOTO TRAIN', 'FLIGHT SIM', 'MOON ROCKET', 'WATERWORKS', 'TOWER BUILD'];
        let scenesItems = ['KYOTO TRAIN', 'FLIGHT SIM', 'MOON ROCKET', 'WATERWORKS', 'TOWER BUILD',
                           'COASTAL CITY', 'DESERT', 'SPACE', 'CITY', 'FOREST', 'WILD WEST', 'BACK'];
        let selectedSceneIndex = 0; let showEscapeMenu = false;
        let currentScene = 'default';
        let launchers = [];
        let maxLetters = 50; // LLF-34: Default 50
        let isDrawing = false;
        let paintbrushPath = [];
        let trailParticles = [];
        let isRightClickHolding = false;
        let rightClickStartTime = 0;
        let rocketBody = null;
        let rocketMesh = null;
        let fusePath = [];
        let fuseDots = [];
        let timeScale = 1.0; // LLF-16: Time Dilation
        let isTimeSlowed = false; let npcMixer = null;
        // LLF-2: Combo-Based Firework Triggers (fast typing sets off fireworks)
        let comboKeyTimes = []; let lastComboTime = 0;
        const COMBO_SPEED_COUNT = 7;    // keystrokes...
        const COMBO_SPEED_MS = 1400;    // ...within this window trigger a combo
        const COMBO_COOLDOWN_MS = 2500; // min gap between combo bursts
        // LLF-12: Alphabetical Rain Mode (repeating one letter rains that letter)
        let rainActive = false; let rainByHold = false; let rainHeldChar = null; let rainHeldSince = 0;
        let rainTimer = null; let rainEndTimer = null; let rainBed = null;
        const RAIN_HOLD_MS = 1000;      // hold one letter this long to start the rain
        const RAIN_DURATION_MS = 4000;  // a rain lasts about this long
        const RAIN_INTERVAL_MS = 90;    // one letter per tick (spawnLetter retires the oldest at the body cap)
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let screenLetters = [];

        // W5: Central body-cap / retire helper. Keeps the number of *dynamic* letter
        // bodies bounded so sustained fast typing can't leak Cannon bodies or tank FPS.
        // Retires the oldest non-NPC bodies down to the active cap and disposes their
        // GPU resources. An absolute HARD_BODY_CAP always applies on top of the user's
        // maxLetters option, so the physics world stays bounded even if maxLetters is
        // raised high in the Options menu.
        const HARD_BODY_CAP = 120;
        function retireExcessBodies() {
            const cap = Math.max(1, Math.min(maxLetters, HARD_BODY_CAP));
            let guard = 0;
            while (physicsBodies.filter(pb => pb.type !== 'npc').length > cap && guard++ < 2000) {
                const oldestIdx = physicsBodies.findIndex(pb => pb.type !== 'npc');
                if (oldestIdx === -1) break;
                const oldest = physicsBodies.splice(oldestIdx, 1)[0];
                scene.remove(oldest.mesh);
                world.removeBody(oldest.body);
                if (oldest.mesh.geometry) oldest.mesh.geometry.dispose();
                if (oldest.mesh.material) oldest.mesh.material.dispose();
            }
        }

        // W5: Bound the number of live firework/explosion particle meshes. Combo
        // fireworks + rapid explosions can otherwise balloon scene.userData.activeFireworks
        // without limit; trim the oldest so heavy typing/effects stay smooth.
        const MAX_PARTICLES = 400;
        function capParticles() {
            const af = scene.userData.activeFireworks;
            if (af && af.length > MAX_PARTICLES) {
                const excess = af.splice(0, af.length - MAX_PARTICLES);
                excess.forEach(p => scene.remove(p.mesh));
            }
        }

        // Frame the camera on the bounding box of the spawned letters so the pile stays
        // centered on screen wherever it lands (replaces the fixed off-to-the-side vantage).
        const _lettersBox = new THREE.Box3();
        const _boxCenter = new THREE.Vector3();
        const _boxSize = new THREE.Vector3();
        function frameLettersCamera() {
            _lettersBox.makeEmpty();
            let n = 0;
            for (const pb of physicsBodies) {
                if (pb.type) continue;              // letters are the untyped bodies
                if (!pb.mesh) continue;
                _lettersBox.expandByPoint(pb.mesh.position);
                n++;
            }
            const floorY = (playBounds ? playBounds.floorY : DEFAULT_FLOOR_Y);
            if (n === 0) {                          // nothing spawned yet: default vantage
                targetCameraPos.set(0, 5, 15);
                targetCameraLookAt.set(0, 0, 0);
                return;
            }
            _lettersBox.getCenter(_boxCenter);
            _lettersBox.getSize(_boxSize);
            // Frame the horizontal spread of the pile; look at its base so falling letters
            // don't make the camera bob vertically.
            const spread = Math.max(Math.hypot(_boxSize.x, _boxSize.z), 4);
            const fov = camera.fov * Math.PI / 180;
            const dist = Math.min(48, Math.max(13, (spread * 0.5) / Math.tan(fov / 2) * 1.5));
            targetCameraLookAt.set(_boxCenter.x, floorY + 1.5, _boxCenter.z);
            targetCameraPos.set(_boxCenter.x, floorY + 1.5 + dist * 0.5, _boxCenter.z + dist);
        }

        // Scene Select Logic variables
        let tvMeshes = [];
        let tvGrid = []; // 2D array for navigation
        let currentTvX = 0;
        let currentTvY = 0;
        let targetCameraPos = new THREE.Vector3(0, 5, 15);
        let targetCameraLookAt = new THREE.Vector3(0, 0, 0);
        let currentCameraLookAt = new THREE.Vector3(0, 0, 0);
        let cameraMouseOffset = new THREE.Vector3(0, 0, 0); // LLF-58: Camera mouse exploration offset

        function init() {
            // Cannon.js Physics
            world = new CANNON.World();
            world.gravity.set(0, -9.82, 0);
            world.broadphase = new CANNON.NaiveBroadphase();
            world.solver.iterations = 10;

            const groundShape = new CANNON.Plane();
            physicsMaterial = new CANNON.Material("physicsMaterial"); 
            const contactMaterial = new CANNON.ContactMaterial(physicsMaterial, physicsMaterial, { 
                friction: 0.3, 
                restitution: 0.3 
            }); 
            world.addContactMaterial(contactMaterial); 

            // groundBody.addShape(groundShape); // LLF-56: Removed global ground
            // LLF-56: Ground body is removed, scenes will provide their own geometry
            
            // LLF-56: Add invisible walls to keep items in bounds
            const wallMaterial = new CANNON.Material("wallMaterial");
            const walls = [
                { pos: [0, 0, 150], rot: [0, Math.PI, 0] },   // Front
                { pos: [0, 0, -150], rot: [0, 0, 0] },        // Back
                { pos: [150, 0, 0], rot: [0, -Math.PI/2, 0] }, // Right
                { pos: [-150, 0, 0], rot: [0, Math.PI/2, 0] }  // Left
            ];
            walls.forEach(w => {
                const wallBody = new CANNON.Body({ mass: 0, material: wallMaterial });
                wallBody.addShape(new CANNON.Plane());
                wallBody.position.set(w.pos[0], w.pos[1], w.pos[2]);
                wallBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), w.rot[1]);
                world.addBody(wallBody);
            });
            // Three.js Scene
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x050505);
            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 5, 15);
            camera.lookAt(0, 0, 0);

            // Upgrade: Soften ambient, add directional light with shadows
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);

            const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
            mainLight.position.set(10, 20, 10);
            mainLight.castShadow = true;
            mainLight.shadow.mapSize.width = 2048;
            mainLight.shadow.mapSize.height = 2048;
            mainLight.shadow.camera.near = 0.5;
            mainLight.shadow.camera.far = 100;
            mainLight.shadow.camera.left = -50;
            mainLight.shadow.camera.right = 50;
            mainLight.shadow.camera.top = 50;
            mainLight.shadow.camera.bottom = -50;
            scene.add(mainLight);

            const fillLight = new THREE.PointLight(0xffffff, 0.5);
            fillLight.position.set(-20, 10, -10);
            scene.add(fillLight);

            // Hook scene.add so anything a scene builder adds gets tracked for clean-slate
            // swaps. The three global lights above are added BEFORE this hook, so they
            // persist across level changes; per-scene meshes/lights are captured & removed.
            const _origSceneAdd = scene.add.bind(scene);
            scene.add = function () {
                if (capturingSceneObjects) {
                    for (let i = 0; i < arguments.length; i++) sceneObjects.push(arguments[i]);
                }
                return _origSceneAdd.apply(scene, arguments);
            };

            const loader = new THREE.FontLoader();
            loader.load('https://threejs.org/examples/fonts/helvetiker_bold.typeface.json', function (response) {
                font = response;
                setMenuScreen('MAIN');   // start on the title/main menu (single authority)
            });

            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Better quality shadows
            document.body.appendChild(renderer.domElement);

            window.addEventListener('resize', onWindowResize, false);
            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mousedown', onMouseDown);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('contextmenu', (e) => e.preventDefault());

            // W3: unlock audio on the first real user gesture (removes autoplay warnings).
            const audioGesture = () => {
                unlockAudio();
                window.removeEventListener('pointerdown', audioGesture);
                window.removeEventListener('keydown', audioGesture);
            };
            window.addEventListener('pointerdown', audioGesture);
            window.addEventListener('keydown', audioGesture);

            // W3: show the controls hint immediately.
            updateControlsHint();

            // LLF-Fix1: derive the on-screen play box + invisible containment walls.
            setupPlayArea();
        }
        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            // LLF-Fix1: the visible play box depends on aspect ratio — recompute + rewall.
            setupPlayArea();
        }

        function animate() {
            requestAnimationFrame(animate);
            updateControlsHint(); // W3: keep the on-screen hint in sync with game state
            if (npcMixer) npcMixer.update(0.016 * timeScale);
            const time = Date.now() * 0.002;

            // Camera Swing/Lerp — during play, follow the letter pile's bounding box so
            // it stays centered; menus set their own targets (leave those alone).
            // Word-quest levels drive their own camera + sim inside gameFrame().
            if (gameStarted) {
                if (gameMode) gameFrame();
                else frameLettersCamera();
            }
            updateWordHudFrame(); // buffer border glow: green -> orange -> blue -> green
            const finalTargetPos = targetCameraPos.clone().add(cameraMouseOffset);
            camera.position.lerp(finalTargetPos, 0.05);
            currentCameraLookAt.lerp(targetCameraLookAt, 0.05);
            camera.lookAt(currentCameraLookAt);

            // LLF-60: NPC stays within the visible frustum
            const npc = physicsBodies.find(pb => pb.type === 'npc');
            if (npc && gameStarted) {
                // Bounds for the visible scene area (frustum approximation)
                const minX = -12, maxX = 12;
                const minZ = -5, maxZ = 10;
                const minY = -5, maxY = 5;

                let pos = npc.body.position;
                let needsReset = false;

                if (pos.x < minX || pos.x > maxX) { pos.x = THREE.MathUtils.clamp(pos.x, minX, maxX); needsReset = true; }
                if (pos.z < minZ || pos.z > maxZ) { pos.z = THREE.MathUtils.clamp(pos.z, minZ, maxZ); needsReset = true; }
                if (pos.y < minY || pos.y > maxY) { pos.y = THREE.MathUtils.clamp(pos.y, minY, maxY); needsReset = true; }

                if (needsReset) {
                    npc.body.velocity.set(0, 0, 0);
                    // Pick a new wander target inside bounds
                    npc.wanderTarget = new CANNON.Vec3(
                        (Math.random() - 0.5) * 10,
                        -5,
                        (Math.random() - 0.5) * 5
                    );
                    npc.wanderTimer = 2;
                }
                
                // LLF-60: Scene Anchor Point - All future scene elements should be placed 
                // within the frustum visible from targetCameraPos (0, 5, 15) looking at (0, 0, 0).
            }

            if (showEscapeMenu) {
                escapeMenuMeshes.forEach((mesh, i) => {
                    const dist = 5;
                    const pos = new THREE.Vector3(0, (escapeMenuMeshes.length/2 - i) * 1.2, -dist);
                    pos.applyQuaternion(camera.quaternion);
                    pos.add(camera.position);
                    mesh.position.lerp(pos, 0.1);
                    mesh.quaternion.slerp(camera.quaternion, 0.1);
                });
            }
            if (!gameStarted) {
                menuMeshes.forEach((group, i) => {
                    group.userData.baseScale = THREE.MathUtils.lerp(group.userData.baseScale, group.userData.targetScale, 0.1);
                    group.scale.setScalar(group.userData.baseScale);
                    group.position.y = group.userData.originalY + Math.sin(time + i) * 0.2;
                    group.children.forEach((char, j) => {
                        char.position.y = Math.sin(time * 2 + j * 0.5) * 0.05;
                        char.rotation.z = Math.sin(time * 3 + j) * 0.02;
                    });
                });

                // Menu labels stay put — the old back-and-forth Y-rotation swept the text
                // plane through Z and clashed into the adjacent label/value. Selection is
                // already conveyed by scale + colour (updateOptionsSelection / updateScenesSelection).
                if (inScenesMenu) {
                    const selectedTv = tvGrid[currentTvY][currentTvX];
                    if (selectedTv && selectedTv.userData.textMesh) {
                        selectedTv.userData.textMesh.rotation.y = 0;
                    }
                }

                if (inOptionsMenu) {
                    optionsMenuMeshes.forEach((mesh) => {
                        mesh.rotation.y = 0;
                    });
                }
            } else {
                world.step((1 / 60) * timeScale);
                updateSpigots(0.016); // animate open valves + basin fill (guarded, no-op off the water level)
                const now = Date.now();

                // Gravity Wells Logic
                gravityWells = gravityWells.filter(well => {
                    const elapsed = now - well.startTime;
                    if (elapsed > well.duration) {
                        scene.remove(well.mesh);
                        return false;
                    }

                    // Animate the well mesh
                    well.mesh.rotation.z += 0.05 * timeScale;
                    well.mesh.scale.setScalar(1 + Math.sin(time * 5) * 0.2);
                    well.mesh.material.opacity = 0.5 * (1 - elapsed / well.duration);

                    // Pull physics bodies
                    physicsBodies.forEach(pb => {
                        const dist = pb.body.position.distanceTo(new CANNON.Vec3(well.position.x, well.position.y, well.position.z));
                        if (dist < well.radius) {
                            const force = new CANNON.Vec3(
                                well.position.x - pb.body.position.x,
                                well.position.y - pb.body.position.y,
                                well.position.z - pb.body.position.z
                            );
                            force.normalize();
                            force.scale(well.strength * (1 - dist / well.radius) * timeScale, force);
                            pb.body.applyForce(force, pb.body.position);
                        }
                    });
                    return true;
                });

                physicsBodies.forEach(pb => {
                // LLF-56: If y is very low, it might have fallen through colliders 
                if (pb.body.position.y < -50) { 
                    pb.body.position.set(0, 15, 0); 
                    pb.body.velocity.set(0, 0, 0); 
                }
                    pb.mesh.position.copy(pb.body.position);
                    pb.mesh.quaternion.copy(pb.body.quaternion);

                    // LLF-54: Glowing effect for spelled words
                                        // LLF-65: Fire shader more like actual flames
                    if (pb.isFireWord) {
                        const intensity = 5 + Math.sin(time * 15) * 3;
                        pb.mesh.material.emissiveIntensity = intensity;
                        pb.mesh.material.color.setRGB(1.0, 0.3 + Math.sin(time * 20) * 0.2, 0.0);
                        
                        // LLF-65: Actual flames particle effects
                        if (Math.random() > 0.2) {
                            const firePos = pb.mesh.position.clone();
                            firePos.x += (Math.random() - 0.5) * 0.5;
                            firePos.z += (Math.random() - 0.5) * 0.5;
                            spawnFireParticle(firePos);
                        }
                    }
                    if (pb.isSpelled) {
                        const glowIntensity = 0.5 + Math.sin(time * 5) * 0.5;
                        if (pb.mesh.material.emissive) {
                            pb.mesh.material.emissive.setHex(pb.mesh.material.color.getHex());
                            pb.mesh.material.emissiveIntensity = glowIntensity * 2;
                        }
                    }

                    // LLF-3: Zoo Animal Wandering logic
                    if (pb.type === 'zoo_animal' && pb.body.position.y < -4) {
                        pb.wanderTimer -= (1/60) * timeScale;
                        if (pb.wanderTimer <= 0) {
                            pb.wanderTimer = 2 + Math.random() * 3;
                            pb.wanderTarget = new CANNON.Vec3((Math.random()-0.5)*40, -5, (Math.random()-0.5)*40);
                        }
                        const dir = pb.wanderTarget.vsub(pb.body.position);
                        dir.y = 0;
                        dir.normalize();
                        const speed = 5 * timeScale;
                        pb.body.velocity.x = dir.x * speed;
                        pb.body.velocity.z = dir.z * speed;
                        
                        // Look towards target (rough approximation with quaternion)
                        const angle = Math.atan2(dir.x, dir.z);
                        pb.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
                    }
                    if (pb.type === 'npc') {
                        // Keep on ground if fallen through
                        if (pb.body.position.y < -10) pb.body.position.y = 5;

                        // Knock over letters logic (applied to all physics bodies)
                        physicsBodies.forEach(other => {
                            if (other !== pb && other.body.position.distanceTo(pb.body.position) < 2.0) {
                                // LLB-17: Disable knocking while presenting and for 5s after
                                if (pb.presentingWord || (pb.postPresentingTimer && pb.postPresentingTimer > 0)) {
                                    return;
                                }
                                // Knock over: apply a force away from npc
                                const knockDir = other.body.position.vsub(pb.body.position);
                                knockDir.y = 0.5; // slight upward pop
                                knockDir.normalize();
                                other.body.applyImpulse(knockDir.scale(5), other.body.position);
                            }
                        });

                        if (pb.presentingWord) {
                            const word = pb.presentingWord;
                            pb.body.velocity.set(0, 0, 0);

                            // Keep shown letters standing
                            if (pb.shownLetters) {
                                pb.shownLetters.forEach((l, idx) => {
                                    if (!l.body || !l.mesh || l.isHeadingToScreen) return;
                                    const npcPos = pb.body.position;
                                    // Space letters out, handle long words by scaling distance
                                    const spacing = word.length > 8 ? 1.0 : 1.5;
                                    const targetPos = new THREE.Vector3(npcPos.x, npcPos.y - 1, npcPos.z).add(
                                        new THREE.Vector3((idx - (word.length-1)/2)*spacing, 0, 4).applyQuaternion(pb.mesh.quaternion)
                                    );
                                    // Lerp body towards target to "stand them up"
                                    const currentPos = l.body.position;
                                    l.body.position.x += (targetPos.x - currentPos.x) * 0.1 * timeScale;
                                    l.body.position.z += (targetPos.z - currentPos.z) * 0.1 * timeScale;
                                    l.body.velocity.y *= 0.9; // dampen
                                    // Align rotation to NPC
                                    const targetQuat = pb.body.quaternion;
                                    l.body.quaternion.x += (targetQuat.x - l.body.quaternion.x) * 0.1 * timeScale;
                                    l.body.quaternion.y += (targetQuat.y - l.body.quaternion.y) * 0.1 * timeScale;
                                    l.body.quaternion.z += (targetQuat.z - l.body.quaternion.z) * 0.1 * timeScale;
                                    l.body.quaternion.w += (targetQuat.w - l.body.quaternion.w) * 0.1 * timeScale;
                                    l.body.quaternion.normalize();
                                });
                            }
                            
                            // LLF-63: Throw entire word at once
                            const npcPosThrow = pb.body.position;
                            const backpackPos = new THREE.Vector3(npcPosThrow.x, npcPosThrow.y + 1, npcPosThrow.z).add(
                                new THREE.Vector3(0,0,-1).applyQuaternion(pb.mesh.quaternion)
                            );
                            
                            // Create a word group/container or just throw individual letters in a burst
                            for (let i = 0; i < word.length; i++) {
                                const char = word[i];
                                const letter = spawnLetter(char);
                                if (letter) {
                                    letter.body.position.set(backpackPos.x, backpackPos.y, backpackPos.z);
                                    
                                    // Fire shader / Glowing effect
                                    letter.mesh.material = new THREE.MeshStandardMaterial({
                                        color: 0xff4400,
                                        emissive: 0xff2200,
                                        emissiveIntensity: 5,
                                        metalness: 0.9,
                                        roughness: 0.1
                                    });
                                    letter.isFireWord = true;

                                    const targetPos = new THREE.Vector3(0, 0, 0);
                                    const throwDir = targetPos.clone().sub(letter.body.position).normalize();
                                    const speed = 25 + Math.random() * 10;
                                    // Spread them out slightly
                                    const spread = new THREE.Vector3((Math.random()-0.5)*3, (Math.random()-0.5)*3, (Math.random()-0.5)*3);
                                    
                                    // Calculate upward toss
                                    const upToss = 15 + Math.random() * 10;
                                    
                                    letter.body.velocity.set(
                                        throwDir.x * speed + spread.x, 
                                        upToss + spread.y, 
                                        throwDir.z * speed + spread.z
                                    );
                                    
                                    letter.isHeadingToScreen = false;
                                    letter.char = char;
                                }
                            }
                            
                            pb.presentingWord = null;
                            pb.postPresentingTimer = 5.0;
                            pb.wanderTimer = 2;
                        }
                        
                        if (!pb.presentingWord) {
                            // LLB-17: Tick post-presenting timer
                            if (pb.postPresentingTimer > 0) {
                                pb.postPresentingTimer -= (1/60) * timeScale;
                            }

                            // LLF-66: Dino wanders towards camera over 20 seconds
                            if (pb.wanderTowardCamera) {
                                const elapsed = (Date.now() - pb.wanderStartTime) / 1000;
                                const duration = 20; // 20 seconds
                                
                                // Target position: 50 units out from camera in the direction it's pointing
                                const cameraDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                                cameraDir.y = 0; // Keep it on the ground
                                cameraDir.normalize();
                                const targetPos = camera.position.clone().add(cameraDir.multiplyScalar(50));
                                targetPos.y = -5; // Ground level
                                
                                if (elapsed < duration) {
                                    // Mix wandering with camera attraction
                                    const cameraInfluence = elapsed / duration; // 0 to 1
                                    
                                    if (pb.wanderTimer <= 0 || !pb.wanderTarget) {
                                        pb.wanderTimer = 5 + Math.random() * 10;
                                        const randomWander = new CANNON.Vec3((Math.random()-0.5)*60, -5, (Math.random()-0.5)*60);
                                        
                                        // Blend random target with camera target
                                        pb.wanderTarget = new CANNON.Vec3(
                                            THREE.MathUtils.lerp(randomWander.x, targetPos.x, cameraInfluence),
                                            -5,
                                            THREE.MathUtils.lerp(randomWander.z, targetPos.z, cameraInfluence)
                                        );
                                    }
                                } else {
                                    // Fully locked on to camera direction
                                    pb.wanderTarget = new CANNON.Vec3(targetPos.x, -5, targetPos.z);
                                    if (pb.wanderTimer <= 0) pb.wanderTimer = 1.0;
                                }
                            }

                            // Normal Wandering
                            pb.wanderTimer -= (1/60) * timeScale;
                            if (pb.wanderTimer <= 0 || !pb.wanderTarget) {
                                pb.wanderTimer = 5 + Math.random() * 10;
                                pb.wanderTarget = new CANNON.Vec3((Math.random()-0.5)*60, -5, (Math.random()-0.5)*60);
                            }
                            const dir = pb.wanderTarget.vsub(pb.body.position);
                            dir.y = 0; dir.normalize();
                            pb.body.velocity.x = dir.x * 4 * timeScale;
                            pb.body.velocity.z = dir.z * 4 * timeScale;
                            
                            const angle = Math.atan2(dir.x, dir.z);
                            pb.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
                        }
                    }
                });

                if (currentScene === 'coastal_city') {
                    const ocean = scene.children.find(m => m.geometry && m.geometry.type === 'PlaneGeometry' && m.position.y <= -15);
                    if (ocean) {
                        ocean.position.y = -15.5 + Math.sin(time * 0.5) * 0.2;
                        ocean.rotation.x = -Math.PI / 2 + Math.sin(time * 0.3) * 0.01;
                        ocean.rotation.y = Math.sin(time * 0.1) * 0.01;
                    }
                }
                if (currentScene === 'desert' && scene.userData.sparkles) {
                    const positions = scene.userData.sparkles.geometry.attributes.position.array;
                    for (let i = 0; i < positions.length; i += 3) {
                        positions[i+1] = -5.04 + Math.sin(time * 5 + i) * 0.05;
                    }
                    scene.userData.sparkles.geometry.attributes.position.needsUpdate = true;
                }
                if (currentScene === 'desert' && scene.userData.sparkles) {
                    const positions = scene.userData.sparkles.geometry.attributes.position.array;
                    for (let i = 0; i < positions.length; i += 3) {
                        positions[i+1] = -5.04 + Math.sin(time * 5 + i) * 0.05;
                    }
                    scene.userData.sparkles.geometry.attributes.position.needsUpdate = true;
                }

                if (currentScene === 'wild_west' && scene.userData.trainCars) {
                    // W2: advance a single head parameter along the arc-length curve;
                    // each car trails it by a fixed arc gap, so the train follows the
                    // track smoothly. Kinematic bodies are teleported to match.
                    const curve = scene.userData.trackCurve;
                    const L = scene.userData.trackLength || 1;
                    const du = scene.userData.trainCarGap / L;
                    const wwH = scene.userData.wwHeight || (() => -5.05);
                    scene.userData.trainHeadU = (scene.userData.trainHeadU + 0.0009 * timeScale) % 1;
                    const headU = scene.userData.trainHeadU;
                    scene.userData.trainCars.forEach((car, k) => {
                        let u = (headU - k * du) % 1;
                        if (u < 0) u += 1;
                        const p = curve.getPointAt(u);
                        const t = curve.getTangentAt(u);
                        const yaw = Math.atan2(t.x, t.z);
                        const gy = wwH(p.x, p.z);
                        car.group.position.set(p.x, gy, p.z);
                        car.group.rotation.y = yaw;
                        car.body.position.set(p.x, gy + car.yOff, p.z);
                        car.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
                    });
                    scene.userData.trainWheels.forEach(w => {
                        w.rotation.x += 0.18 * timeScale;
                    });
                }

                // Firework Animation Logic — honors optional per-particle gravity/drag/decay
                // (LLF-Fix3) so willow/ring/crackle/palm bursts each move distinctly.
                if (scene.userData.activeFireworks) {
                    scene.userData.activeFireworks = scene.userData.activeFireworks.filter(p => {
                        p.mesh.position.x += p.velocity.x * timeScale;
                        p.mesh.position.y += p.velocity.y * timeScale;
                        p.mesh.position.z += p.velocity.z * timeScale;
                        const g = (p.gravity != null) ? p.gravity : 0.001;
                        p.velocity.y -= g * timeScale; // Gravity
                        if (p.drag != null && p.drag !== 1.0) {
                            const d = Math.pow(p.drag, timeScale);
                            p.velocity.x *= d; p.velocity.y *= d; p.velocity.z *= d;
                        }
                        p.life -= ((p.decay != null) ? p.decay : 0.02) * timeScale;
                        p.mesh.material.opacity = Math.max(0, Math.min(1, p.life));
                        p.mesh.material.transparent = true;

                        if (p.life <= 0) {
                            scene.remove(p.mesh);
                            return false;
                        }
                        return true;
                    });
                }

                // Rocket Fuse and Launch Logic
                if (scene.userData.pendingRockets) {
                    scene.userData.pendingRockets = scene.userData.pendingRockets.filter(rocket => {
                        if (rocket.fuse.length > 0) {
                            // LLF-16: Use a counter to slow down fuse burning
                            rocket.fuseCounter = (rocket.fuseCounter || 0) + timeScale;
                            if (rocket.fuseCounter >= 1.0) {
                                rocket.fuseCounter = 0;
                                const p = rocket.fuse.pop();
                                const dot = rocket.dots.pop();
                                if (dot) {
                                    spawnFirework(p);
                                    scene.remove(dot);
                                }
                            }
                            return true;
                        } else {
                            // LLF-Fix3: Cinematic scripted flight — the rocket rises AND
                            // recedes into the background (arcing away from the camera like
                            // a TV firework), then detonates into a varied burst. Driven by
                            // position (physics body detached) so containment walls never
                            // block it and the arc is exactly the shape we want.
                            if (!rocket.flight) {
                                if (rocket.body) {
                                    world.removeBody(rocket.body);
                                    physicsBodies = physicsBodies.filter(pb => pb.body !== rocket.body);
                                }
                                const b = playBounds || { minX: -8, maxX: 8, minZ: -9, maxZ: 5, floorY: DEFAULT_FLOOR_Y };
                                const start = rocket.mesh.position.clone();
                                const ox = THREE.MathUtils.clamp(start.x, b.minX, b.maxX);
                                const oz = THREE.MathUtils.clamp(start.z, b.minZ + 1, b.maxZ);
                                const oy = b.floorY + 0.5;              // launch from near the ground
                                rocket.flight = {
                                    duration: 1500 + Math.random() * 800,   // ms of ascent
                                    ox: ox, oy: oy, oz: oz,
                                    drift: (Math.random() - 0.5) * 10,      // lateral sway
                                    depth: 26 + Math.random() * 20,         // travel INTO background (-z)
                                    apex: 14 + Math.random() * 8,           // rise height
                                    style: FIREWORK_STYLES[Math.floor(Math.random() * FIREWORK_STYLES.length)],
                                    hue: Math.random(),
                                    u: 0, lastExhaust: 0,
                                    prev: new THREE.Vector3(ox, oy, oz)
                                };
                                rocket.mesh.position.set(ox, oy, oz);
                                playRocketWhoosh();                         // LLF-Fix4 launch sound
                            }
                            const fl = rocket.flight;
                            fl.u += (timeScale * 16.7) / fl.duration;       // advance (slow-mo aware)
                            const t = Math.min(1, fl.u);
                            const cur = new THREE.Vector3(
                                fl.ox + fl.drift * t,
                                fl.oy + fl.apex * (1 - (1 - t) * (1 - t)), // rise, easing near apex
                                fl.oz - fl.depth * t                       // recede into background
                            );
                            const dir = cur.clone().sub(fl.prev);
                            if (dir.lengthSq() > 1e-6) {
                                dir.normalize();
                                rocket.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                            }
                            rocket.mesh.position.copy(cur);
                            fl.prev.copy(cur);
                            // Thin exhaust trail trailing the nose.
                            fl.lastExhaust += timeScale;
                            if (fl.lastExhaust >= 1) {
                                fl.lastExhaust = 0;
                                fwParticle(cur.clone().addScaledVector(dir, -0.6),
                                    new THREE.Vector3((Math.random() - 0.5) * 0.02, -0.02, (Math.random() - 0.5) * 0.02),
                                    new THREE.Color(1.0, 0.7, 0.3), { gravity: 0.0005, decay: 0.06, size: 0.06 });
                            }
                            if (t < 1) return true;

                            // Detonate at apex with the chosen varied style + color.
                            detonateFirework(cur, fl.style, fl.hue);
                            scene.remove(rocket.mesh);
                            if (rocket.mesh.geometry) rocket.mesh.geometry.dispose();
                            if (rocket.mesh.material) rocket.mesh.material.dispose();
                            return false;
                        }
                    });
                }
            }

            
            // LLF-62: Screen letters logic
            screenLetters = screenLetters.filter(sl => {
                if (sl.stuckTimer > 0) {
                    sl.stuckTimer -= (1/60) * timeScale;
                } else {
                    sl.vy += 0.2 * timeScale;
                    sl.y += sl.vy;
                    sl.life -= 0.01 * timeScale;
                    sl.el.style.top = sl.y + '%';
                    sl.el.style.opacity = sl.life;
                    sl.el.style.transform = 'scale(' + (1 + (1-sl.life)) + ')';
                }

                if (sl.y > 110 || sl.life <= 0) {
                    document.getElementById('waterMarkOverlay').removeChild(sl.el);
                    return false;
                }
                return true;
            });

            
            // Check 3D letters for screen collision
            const frustum = new THREE.Frustum();
            const projScreenMatrix = new THREE.Matrix4();
            projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(projScreenMatrix);

            physicsBodies.forEach(pb => {
                if (pb.isHeadingToScreen) {
                    const pos = pb.mesh.position.clone();
                    const distance = pos.distanceTo(camera.position);
                    
                    // If it's in front of camera and very close
                    if (distance < 5) {
                        // Project to screen coordinates to see if it's actually "on screen"
                        const vector = pos.project(camera);
                        const x = (vector.x + 1) / 2;
                        const y = -(vector.y - 1) / 2;
                        
                        // If within screen bounds (roughly)
                        if (x > -0.2 && x < 1.2 && y > -0.2 && y < 1.2) {
                            spawnScreenLetter(pb.char);
                            pb.isHeadingToScreen = false;
                            scene.remove(pb.mesh);
                            world.removeBody(pb.body);
                            physicsBodies = physicsBodies.filter(item => item !== pb);
                        }
                    }
                }
            });

            renderer.render(scene, camera);
        }
