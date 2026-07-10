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
        let rainLastChar = null; let rainLastTime = 0; let rainRepeat = 0; let rainActive = false;
        const RAIN_TRIGGER_COUNT = 4;   // same letter this many times in a row...
        const RAIN_WINDOW_MS = 600;     // ...each within this window starts the rain
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

        // === LLF-Fix1: On-screen play volume + containment ===================
        // Letters used to spawn from three fixed launcher cylinders and could land off
        // to the side or clip through scene walls. We now derive a bounded play region
        // ON THE FLOOR that is guaranteed to sit inside the camera frustum (verified in
        // tests/test_fix1_containment.js), spawn letters staggered inside it, and wrap it
        // in invisible static Cannon walls so nothing bounces out of view.
        let playBounds = null;
        let containmentBodies = [];
        // Clean-slate scene swaps: every object a scene builder adds is recorded here
        // (via the scene.add hook installed in init) so we can remove the whole previous
        // level before building the next one — no leftover buildings/ground/props.
        let sceneObjects = [];
        let capturingSceneObjects = false;
        // Bowl container: corrals letters in the CENTER of the frustum so everything
        // stays on-screen. Physics is a ring of inward-tilted CANNON.Box "staves" (Box
        // vs Box collides in Cannon 0.6.2; Box vs Trimesh does NOT — see PLAN_NOTES).
        let bowlBodies = [];
        let bowlMeshes = [];
        let bowlInfo = null;              // { cx, cz, floorY, rTop, rBottom, height, topY }
        let spawnTick = 0;
        const SPAWN_STACK_H = 5;          // letters spawn within floorY .. floorY+5
        const DEFAULT_FLOOR_Y = -5.1;     // every scene's ground sits ~here (see PLAN_NOTES)

        // Compute the floor rectangle visible in the lower band of the screen from the
        // fixed gameplay vantage (0,5,15) looking at the origin. Uses a throwaway camera
        // at that vantage so the result doesn't jitter with the live mouse-offset camera.
        function computePlayBounds() {
            const floorY = (scene && scene.userData && scene.userData.playFloorY != null)
                ? scene.userData.playFloorY : DEFAULT_FLOOR_Y;
            const aspect = (camera && camera.aspect) ? camera.aspect
                : (window.innerWidth / Math.max(1, window.innerHeight));
            const refCam = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
            refCam.position.set(0, 5, 15);
            refCam.lookAt(0, 0, 0);
            refCam.updateMatrixWorld();
            // Lower-band NDC corners: floor is only visible below the horizon, so we sample
            // ny in [-0.82 (screen bottom) .. -0.08 (just under the horizon)].
            const band = [[-0.82, -0.82], [0.82, -0.82], [0.82, -0.08], [-0.82, -0.08]];
            const pts = [];
            for (const [nx, ny] of band) {
                const v = new THREE.Vector3(nx, ny, 0.5).unproject(refCam);
                const dir = v.sub(refCam.position).normalize();
                if (dir.y >= -1e-4) continue;              // ray not descending to the floor
                const t = (floorY - refCam.position.y) / dir.y;
                if (t <= 0) continue;
                pts.push(refCam.position.clone().add(dir.multiplyScalar(t)));
            }
            if (pts.length < 4) {                          // conservative fallback box
                return { minX: -8, maxX: 8, minZ: -9, maxZ: 5, floorY, ceilY: floorY + SPAWN_STACK_H };
            }
            // Intersection rectangle inside the (perspective) trapezoid so EVERY point in
            // it is on-screen at floor height: take inner-most left/right, full z span.
            let minX = Math.max(pts[0].x, pts[3].x);
            let maxX = Math.min(pts[1].x, pts[2].x);
            let minZ = Math.min(pts[0].z, pts[1].z, pts[2].z, pts[3].z);
            let maxZ = Math.max(pts[0].z, pts[1].z, pts[2].z, pts[3].z);
            // Inset 12% for a safe margin from the frustum edges (see test).
            const f = 0.88, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
            minX = cx + (minX - cx) * f; maxX = cx + (maxX - cx) * f;
            minZ = cz + (minZ - cz) * f; maxZ = cz + (maxZ - cz) * f;
            return { minX, maxX, minZ, maxZ, floorY, ceilY: floorY + SPAWN_STACK_H };
        }

        // Predicate reused by tests: is a world position inside the play box (with a small
        // tolerance so a resting/rolling letter still counts)?
        function isWithinPlayBounds(pos, b, tol) {
            b = b || playBounds; if (!b) return true;
            tol = tol || 0;
            return pos.x >= b.minX - tol && pos.x <= b.maxX + tol &&
                   pos.z >= b.minZ - tol && pos.z <= b.maxZ + tol &&
                   pos.y >= b.floorY - 2 && pos.y <= b.ceilY + 6;
        }

        // Build invisible static Cannon walls (thin boxes) around the play box so letters
        // stay on-screen. Cinematic rockets are script-driven (no physics body) so these
        // walls never block them. Rebuilt whenever the play area is (re)computed.
        function buildContainmentWalls(b) {
            containmentBodies.forEach(w => world.removeBody(w));
            containmentBodies = [];
            if (!world) return;
            const H = 14, t = 0.5;
            const cy = b.floorY + H / 2;
            const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
            const halfW = (b.maxX - b.minX) / 2, halfD = (b.maxZ - b.minZ) / 2;
            const specs = [
                { p: [b.minX - t, cy, cz], h: [t, H / 2, halfD + t] }, // left
                { p: [b.maxX + t, cy, cz], h: [t, H / 2, halfD + t] }, // right
                { p: [cx, cy, b.minZ - t], h: [halfW + t, H / 2, t] }, // back (far, into bg)
                { p: [cx, cy, b.maxZ + t], h: [halfW + t, H / 2, t] }  // front (near camera)
            ];
            specs.forEach(s => {
                const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
                body.addShape(new CANNON.Box(new CANNON.Vec3(s.h[0], s.h[1], s.h[2])));
                body.position.set(s.p[0], s.p[1], s.p[2]);
                world.addBody(body);
                containmentBodies.push(body);
            });
        }

        // Remove the bowl (physics + meshes). Called when leaving PLAYING.
        function clearBowl() {
            bowlBodies.forEach(bd => { if (world) world.removeBody(bd); });
            bowlBodies = [];
            bowlMeshes.forEach(m => { if (scene) scene.remove(m); });
            bowlMeshes = [];
            bowlInfo = null;
        }

        // Build a BOWL-shaped container centered in the play box so spawned letters pour
        // into the middle of the frustum and pile up on-screen. The collider is a ring of
        // N inward-tilted CANNON.Box staves (an inverted frustum: wide top, narrow base)
        // plus a flat bottom box — all primitives that DO collide with the Box-shaped
        // letters in Cannon 0.6.2. A translucent cone/rim/base mesh makes it read visually.
        function buildBowl(b) {
            clearBowl();
            if (!world || !scene) return;
            const cx = (b.minX + b.maxX) / 2;
            const cz = (b.minZ + b.maxZ) / 2;
            const floorY = b.floorY;
            const halfSpan = Math.min((b.maxX - b.minX), (b.maxZ - b.minZ)) / 2;
            const rTop = Math.max(4, Math.min(6.5, halfSpan * 0.82));
            const rBottom = rTop * 0.42;
            const height = Math.min(5.5, rTop * 0.95);
            const topY = floorY + height;
            const N = 16;
            const a = rTop - rBottom;                 // radial run from base to rim
            const L = Math.sqrt(a * a + height * height); // slant length of a wall
            const midR = (rTop + rBottom) / 2;
            const midY = floorY + height / 2;
            const halfThick = 0.15;
            const segWidth = (2 * Math.PI * midR / N) * 1.2; // >chord so staves overlap

            for (let i = 0; i < N; i++) {
                const th = (i / N) * Math.PI * 2;
                const cosT = Math.cos(th), sinT = Math.sin(th);
                // Orthonormal wall frame: T=tangent (width), U=up-slant (height),
                // Nn=inward normal (thickness). makeBasis => det +1 (right-handed).
                const T = new THREE.Vector3(-sinT, 0, cosT);
                const U = new THREE.Vector3(a * cosT, height, a * sinT).normalize();
                const Nn = new THREE.Vector3().crossVectors(T, U).normalize();
                const mtx = new THREE.Matrix4().makeBasis(T, U, Nn);
                const quat = new THREE.Quaternion().setFromRotationMatrix(mtx);
                const px = cx + midR * cosT, py = midY, pz = cz + midR * sinT;
                const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
                body.addShape(new CANNON.Box(new CANNON.Vec3(segWidth / 2, L / 2, halfThick)));
                body.position.set(px, py, pz);
                body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
                world.addBody(body);
                bowlBodies.push(body);
            }
            // Flat bottom cap so nothing slips through the converging base.
            const bottom = new CANNON.Body({ mass: 0, material: physicsMaterial });
            bottom.addShape(new CANNON.Box(new CANNON.Vec3(rBottom + 0.4, 0.3, rBottom + 0.4)));
            bottom.position.set(cx, floorY + 0.3, cz);
            world.addBody(bottom);
            bowlBodies.push(bottom);

            // --- Visual (subtle/translucent) ---
            const coneGeo = new THREE.CylinderGeometry(rTop, rBottom, height, 40, 1, true);
            const coneMat = new THREE.MeshPhongMaterial({
                color: 0x66ccff, transparent: true, opacity: 0.16,
                side: THREE.DoubleSide, shininess: 90, depthWrite: false
            });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.set(cx, midY, cz);
            scene.add(cone); bowlMeshes.push(cone);

            const rim = new THREE.Mesh(
                new THREE.TorusGeometry(rTop, 0.12, 12, 48),
                new THREE.MeshPhongMaterial({ color: 0x99ddff, transparent: true, opacity: 0.55, depthWrite: false })
            );
            rim.position.set(cx, topY, cz); rim.rotation.x = Math.PI / 2;
            scene.add(rim); bowlMeshes.push(rim);

            const base = new THREE.Mesh(
                new THREE.CircleGeometry(rBottom + 0.4, 40),
                new THREE.MeshPhongMaterial({ color: 0x336699, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
            );
            base.position.set(cx, floorY + 0.06, cz); base.rotation.x = -Math.PI / 2;
            scene.add(base); bowlMeshes.push(base);

            bowlInfo = { cx, cz, floorY, rTop, rBottom, height, topY };
        }

        // Compute a spawn position ABOVE the bowl center, spread over a golden-angle
        // spiral inside the inner disc so consecutive drops land apart and fall into the
        // bowl (centered on screen). Falls back to the play box if no bowl yet.
        function bowlSpawnPos(sizeY) {
            sizeY = sizeY || 1;
            const idx = spawnTick++;
            if (bowlInfo) {
                const ang = idx * 2.399963229728653;           // golden angle
                const rad = Math.sqrt((idx % 13) / 13) * bowlInfo.rTop * 0.5;
                return new THREE.Vector3(
                    bowlInfo.cx + Math.cos(ang) * rad,
                    bowlInfo.topY + 1.5 + (idx % 5) * 0.5 + sizeY * 0.5,
                    bowlInfo.cz + Math.sin(ang) * rad
                );
            }
            const b = playBounds || { minX: -8, maxX: 8, minZ: -9, maxZ: 5, floorY: DEFAULT_FLOOR_Y };
            const fx = (idx * 0.618033988749895) % 1;
            const fz = ((idx * 7 + 3) * 0.618033988749895) % 1;
            return new THREE.Vector3(
                b.minX + (b.maxX - b.minX) * (0.2 + 0.6 * fx),
                b.floorY + SPAWN_STACK_H + 2 + (idx % 5) * 0.5,
                b.minZ + (b.maxZ - b.minZ) * (0.25 + 0.5 * fz)
            );
        }

        // Recompute the play box + invisible containment walls. No bowl: letters now
        // fall onto the actual scene landscape and pile there; the camera frames the
        // pile (see frameLettersCamera) so it stays centered on screen.
        function setupPlayArea() {
            if (!scene || !world) return;
            clearBowl();                      // ensure no leftover bowl from older builds
            playBounds = computePlayBounds();
            buildContainmentWalls(playBounds);// invisible box keeps letters in view
        }

        // Remove everything the previous scene builder added (meshes + colliders) plus
        // the spawned letters, so swapping levels is a true clean slate.
        function clearSceneGeometry() {
            // Word-quest teardown: drop the active game definition + HUDs so a
            // freshly built scene starts clean (its builder re-creates them).
            if (typeof gameMode !== 'undefined' && gameMode) {
                (gameMode.flybys || []).forEach(f => { if (scene) scene.remove(f.mesh); });
                gameMode = null;
            }
            if (wordPending) { clearTimeout(wordPending.timer); wordPending = null; }
            inputBuffer = "";
            const objHud = document.getElementById('objectiveHud');
            if (objHud) objHud.style.display = 'none';
            const banner = document.getElementById('gameBanner');
            if (banner) banner.style.display = 'none';
            sceneObjects.forEach(o => {
                if (scene) scene.remove(o);
                if (o.geometry && o.geometry.dispose) o.geometry.dispose();
            });
            sceneObjects = [];
            colliderBodies.forEach(b => { if (world) world.removeBody(b); });
            colliderBodies = [];
            // Clear spawned letters/props (keep the persistent NPC if present).
            const keep = [];
            physicsBodies.forEach(pb => {
                if (pb.type === 'npc') { keep.push(pb); return; }
                if (scene) scene.remove(pb.mesh);
                if (pb.body && world) world.removeBody(pb.body);
                if (pb.mesh && pb.mesh.geometry && pb.mesh.geometry.dispose) pb.mesh.geometry.dispose();
            });
            physicsBodies = keep;
        }

        // Build a scene with clean-slate semantics: wipe the old level, then capture
        // every object the builder adds so the NEXT swap can wipe this one.
        function buildScene(builder) {
            clearSceneGeometry();
            capturingSceneObjects = true;
            try { builder(); }
            finally { capturingSceneObjects = false; }
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

        // === LLF-Fix4: Synthesized rocket SFX (no external audio files) =======
        // Short white-noise buffer used by the whoosh/boom crackle.
        function makeNoiseBuffer(duration) {
            const sr = audioCtx.sampleRate;
            const buf = audioCtx.createBuffer(1, Math.max(1, Math.floor(sr * duration)), sr);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            return buf;
        }

        // Rising whistle + airy noise sweep — plays as a rocket lifts off.
        function playRocketWhoosh() {
            initAudio();
            if (!audioCtx || soundVolume <= 0) return;
            const now = audioCtx.currentTime;
            // Ascending sine whistle
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(1300, now + 1.4);
            const og = audioCtx.createGain();
            og.gain.setValueAtTime(0.0001, now);
            og.gain.exponentialRampToValueAtTime(0.12 * soundVolume, now + 0.15);
            og.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
            osc.connect(og); og.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 1.55);
            // Airy band-passed noise that opens up as it climbs
            const noise = audioCtx.createBufferSource();
            noise.buffer = makeNoiseBuffer(1.5);
            const bp = audioCtx.createBiquadFilter();
            bp.type = 'bandpass'; bp.Q.value = 0.8;
            bp.frequency.setValueAtTime(600, now);
            bp.frequency.exponentialRampToValueAtTime(3200, now + 1.4);
            const ng = audioCtx.createGain();
            ng.gain.setValueAtTime(0.0001, now);
            ng.gain.exponentialRampToValueAtTime(0.05 * soundVolume, now + 0.2);
            ng.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
            noise.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
            noise.start(now); noise.stop(now + 1.5);
        }

        // Low thump + high crackle — plays on detonation.
        function playRocketBoom() {
            initAudio();
            if (!audioCtx || soundVolume <= 0) return;
            const now = audioCtx.currentTime;
            // Descending low-frequency thump
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(170, now);
            osc.frequency.exponentialRampToValueAtTime(38, now + 0.35);
            const og = audioCtx.createGain();
            og.gain.setValueAtTime(0.5 * soundVolume, now);
            og.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc.connect(og); og.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.5);
            // High-passed noise crackle
            const noise = audioCtx.createBufferSource();
            noise.buffer = makeNoiseBuffer(0.6);
            const hp = audioCtx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = 1100;
            const ng = audioCtx.createGain();
            ng.gain.setValueAtTime(0.3 * soundVolume, now + 0.02);
            ng.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
            noise.connect(hp); hp.connect(ng); ng.connect(audioCtx.destination);
            noise.start(now); noise.stop(now + 0.6);
        }

        // W3: Context-aware controls hint. Called cheaply each frame; only touches the
        // DOM when the game state actually changes, so a new player always sees what to
        // do (and how to reach the scene selector) without per-frame layout churn.
        let _hintState = null;
        function updateControlsHint() {
            const el = document.getElementById('controlsHint');
            if (!el) return;
            let state, html;
            if (gameStarted && typeof gameMode !== 'undefined' && gameMode) {
                state = 'wordquest:' + gameMode.name;
                html = '<b>' + gameMode.name + '</b> &nbsp;·&nbsp; type <b>words</b> the scene understands — the glowing box shows your typing &nbsp;·&nbsp; ' +
                       '<span class="key">Space</span> clears &nbsp;·&nbsp; <span class="key">Esc</span> menu';
            } else if (gameStarted) {
                state = 'game';
                html = 'Type <span class="key">A</span>–<span class="key">Z</span> / <span class="key">0</span>–<span class="key">9</span> to launch letters &nbsp;·&nbsp; ' +
                       '<span class="key">Space</span> slow-mo &nbsp;·&nbsp; <b>Middle-click</b> a letter to explode &nbsp;·&nbsp; ' +
                       '<b>Right-drag</b> a firework rocket &nbsp;·&nbsp; <span class="key">Esc</span> menu';
            } else if (inScenesMenu) {
                state = 'scenes';
                html = '<b>Scene selector</b> &nbsp;·&nbsp; top shelf = <b>word-quest games</b>, bottom = classic toys &nbsp;·&nbsp; <span class="key">←</span><span class="key">↑</span><span class="key">↓</span><span class="key">→</span> browse &nbsp;·&nbsp; <span class="key">Enter</span> or <b>click</b> to load';
            } else if (inOptionsMenu) {
                state = 'options';
                html = '<span class="key">↑</span><span class="key">↓</span> pick option &nbsp;·&nbsp; <span class="key">←</span><span class="key">→</span> change value &nbsp;·&nbsp; <span class="key">Enter</span> on BACK to return';
            } else {
                state = 'menu';
                html = '<span class="key">↑</span><span class="key">↓</span> move &nbsp;·&nbsp; <span class="key">Enter</span> or <b>click</b> to select &nbsp;·&nbsp; choose <b>SCENES</b> to pick a map';
            }
            if (state !== _hintState) {
                _hintState = state;
                el.innerHTML = html;
            }
        }

        // W3: Gate the Web Audio context behind a real user gesture so browsers never
        // emit an autoplay warning. The AudioContext is created lazily and resumed on
        // the first keydown / pointerdown, after which normal keystroke synthesis works.
        let audioUnlocked = false;
        function unlockAudio() {
            initAudio();
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            audioUnlocked = true;
        }

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

        // LLF-12: Alphabetical Rain Mode. Rains a heavy fall of one specific letter from
        // the top of the scene. Reuses spawnLetter (so the W5 body cap still applies) and
        // guards with rainActive so a held key can't stack multiple concurrent showers.
        function startLetterRain(char) {
            if (rainActive || !font) return;
            rainActive = true;
            let dropped = 0;
            const total = 24;
            const iv = setInterval(() => {
                if (!gameStarted || dropped >= total) { clearInterval(iv); rainActive = false; return; }
                const obj = spawnLetter(char);
                if (obj && obj.body) {
                    obj.body.position.set(
                        (Math.random() - 0.5) * 24,
                        16 + Math.random() * 6,
                        (Math.random() - 0.5) * 8 - 1
                    );
                    obj.body.velocity.set(0, -2, 0);
                }
                dropped++;
            }, 80);
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



        // Audio Context for Musical Keystroke Synthesis
        let audioCtx;
        function initAudio() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            // W3: a context created outside a user gesture starts 'suspended'; resume it
            // so no autoplay warning is logged and tones play once the user interacts.
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
        }

        function playTone(char, position) {
            initAudio();
            if (!audioCtx) return;

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const panner = audioCtx.createPanner();

            // Unique frequency based on letter (A=440Hz, others stepped by semitones)
            const code = char.charCodeAt(0) - 65; // A=0, B=1...
            const freq = 440 * Math.pow(2, (code - 9) / 12);
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

            // Spatial positioning
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            if (position) {
                panner.positionX.setValueAtTime(position.x, audioCtx.currentTime);
                panner.positionY.setValueAtTime(position.y, audioCtx.currentTime);
                panner.positionZ.setValueAtTime(position.z, audioCtx.currentTime);
            }

            osc.connect(panner);
            panner.connect(gain);
            gain.connect(audioCtx.destination);

            const now = audioCtx.currentTime;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.2 * soundVolume, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 1);

            osc.start(now);
            osc.stop(now + 1);
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

        function yellWord(word) {
            initAudio();
            if (!audioCtx) return;
            const msg = new SpeechSynthesisUtterance(word);
            msg.rate = 1.2;
            msg.pitch = 1.5;
            msg.volume = soundVolume;
            window.speechSynthesis.speak(msg);
        }

        function playZooAnimalSound(animal) {
            initAudio();
            if (!audioCtx) return;
            const now = audioCtx.currentTime;

            if (animal === 'LION') {
                // Low frequency growl/roar
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.exponentialRampToValueAtTime(40, now + 1);

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.3 * soundVolume, now + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);

                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1.5);
            } else if (animal === 'ELEPHANT') {
                // High frequency trumpet
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.linearRampToValueAtTime(600, now + 0.2);
                osc.frequency.exponentialRampToValueAtTime(400, now + 0.8);

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.2 * soundVolume, now + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1);

                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1);
            } else if (animal === 'MONKEY') {
                // Quick chirps
                for (let i = 0; i < 3; i++) {
                    const t = now + i * 0.2;
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.frequency.setValueAtTime(800 + Math.random() * 400, t);
                    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
                    gain.gain.setValueAtTime(0.1 * soundVolume, t);
                    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start(t);
                    osc.stop(t + 0.15);
                }
            } else if (animal === 'GIRAFFE') {
                // Low hum
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(60, now);
                osc.frequency.linearRampToValueAtTime(70, now + 1);
                gain.gain.setValueAtTime(0.1 * soundVolume, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1);
            } else {
                yellWord(animal);
            }
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

        // W1: Build a Cannon.js Heightfield collider that matches an undulating VISIBLE
        // surface by sampling the same procedural height function the scene mesh uses.
        // NOTE: In Cannon.js 0.6.2 a Box body (our letters) does NOT collide with a
        // Trimesh (it tunnels straight through), but it DOES collide with a Heightfield,
        // so heightfields are the correct primitive for terrain that letters must rest on.
        function addHeightfieldCollider(minX, minZ, maxX, maxZ, elementSize, heightFn, name) {
            const nx = Math.max(2, Math.round((maxX - minX) / elementSize) + 1);
            const nz = Math.max(2, Math.round((maxZ - minZ) / elementSize) + 1);
            const data = [];
            for (let i = 0; i < nx; i++) {
                const row = [];
                const wx = minX + i * elementSize;
                for (let j = 0; j < nz; j++) {
                    // local heightfield y-index maps to world -z after the -90deg X rotation
                    const wz = minZ + (nz - 1 - j) * elementSize;
                    row.push(heightFn(wx, wz));
                }
                data.push(row);
            }
            const hfShape = new CANNON.Heightfield(data, { elementSize: elementSize });
            const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
            body.addShape(hfShape);
            // Rotate so the heightfield's height axis points +Y (up) in world space.
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
            body.position.set(minX, 0, minZ + (nz - 1) * elementSize);
            world.addBody(body);
            colliderBodies.push(body);
            // Expose the surface fn so spawns/other logic can reference the real ground.
            scene.userData.groundHeightFn = heightFn;
            return body;
        }

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

            const sun = new THREE.DirectionalLight(0xFFFFFF, 1.2);
            sun.position.set(100, 100, 50);
            scene.add(sun);
            scene.add(new THREE.AmbientLight(0x888888));

            createLaunchers(); spawnNPC();
        }

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

            createLaunchers(); spawnNPC();
        }

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

        // ==================================================================
        // ==== WORD-QUEST GAME FRAMEWORK ===================================
        // Gamified levels: the simulation reacts to whole TYPED WORDS.
        // A level is a normal scene builder PLUS a gameMode definition:
        //   setGameMode({
        //     name,                       // level name
        //     words: { WORD: fn, ... },   // typed word -> action. Two kinds:
        //                                 //   state advancers (move toward the win)
        //                                 //   doodads (reactive flavor, no progress)
        //     update(),                   // per-frame sim + camera targets
        //   })
        // Discovering the words IS the puzzle: the objective HUD gives the
        // goal plus riddle-ish hints, and found words collect on screen.
        // ==================================================================
        let gameMode = null;
        let bufferHeat = 0;          // 0 (ready/green) .. 1 (hot/orange)
        let hudFlashUntil = 0;       // blue success-flash deadline (ms epoch)

        function hudEl(id) { return document.getElementById(id); }
        function setWordHudVisible(v) { const el = hudEl('wordHud'); if (el) el.style.display = v ? 'block' : 'none'; }
        function setObjectiveVisible(v) { const el = hudEl('objectiveHud'); if (el) el.style.display = v ? 'block' : 'none'; }
        function showBanner(title, sub) {
            const el = hudEl('gameBanner'); if (!el) return;
            el.innerHTML = title + (sub ? '<div style="font-size:15px;color:#fff;margin-top:8px;font-weight:400;letter-spacing:0.5px">' + sub + '</div>' : '');
            el.style.display = 'block';
        }
        function hideBanner() { const el = hudEl('gameBanner'); if (el) el.style.display = 'none'; }

        function updateWordHud() {
            const el = hudEl('wordHud'); if (!el) return;
            const buf = inputBuffer.slice(-14);
            el.innerHTML = buf.length ? buf : '<span class="ph">type a word…</span>';
        }
        function bumpHeat() { bufferHeat = Math.min(1, bufferHeat + 0.16); }
        function hudFlashSuccess(word) {
            hudFlashUntil = Date.now() + 700;
            const el = hudEl('wordHud');
            if (el) { el.innerHTML = '<span style="color:#7fd7ff">' + word + '</span>'; el._flashed = true; }
            bufferHeat = 0;
        }
        // Called every frame: decays heat and drives the border green->orange,
        // holds blue during a success flash, then settles back to green.
        function updateWordHudFrame() {
            const el = hudEl('wordHud');
            if (!el || el.style.display === 'none') return;
            bufferHeat = Math.max(0, bufferHeat - 0.006);
            let border, glow;
            if (Date.now() < hudFlashUntil) {
                border = '#4da6ff'; glow = 'rgba(77,166,255,0.8)';
            } else {
                const h = Math.round(135 - 110 * bufferHeat); // 135=green -> 25=orange
                border = 'hsl(' + h + ',75%,55%)';
                glow = 'hsla(' + h + ',75%,55%,0.55)';
                if (el._flashed) { el._flashed = false; updateWordHud(); }
            }
            if (el._b !== border) {
                el._b = border;
                el.style.borderColor = border;
                el.style.boxShadow = '0 0 18px ' + glow;
            }
        }

        function setObjective(title, goalHtml) {
            const el = hudEl('objectiveHud'); if (!el) return;
            el.innerHTML = '<h3>' + title + '</h3><div class="goal">' + goalHtml +
                '</div><div class="status"></div><div class="msg"></div><div class="found"></div>';
            el.style.display = 'block';
        }
        let _gameMsgTimer = null;
        function gameMsg(text, ms) {
            const el = hudEl('objectiveHud'); if (!el) return;
            const m = el.querySelector('.msg'); if (!m) return;
            m.textContent = text;
            if (_gameMsgTimer) clearTimeout(_gameMsgTimer);
            _gameMsgTimer = setTimeout(() => { m.textContent = ''; }, ms || 4500);
        }
        function gameStatus(text) {
            const el = hudEl('objectiveHud'); if (!el) return;
            const s = el.querySelector('.status');
            if (s && s.textContent !== text) s.textContent = text;
        }
        function markFound(word) {
            if (!gameMode) return;
            gameMode.found.add(word);
            const el = hudEl('objectiveHud'); if (!el) return;
            const f = el.querySelector('.found');
            if (f) f.textContent = 'Words found: ' + Array.from(gameMode.found).join(' · ');
        }

        function setGameMode(def) {
            gameMode = Object.assign({
                found: new Set(), won: false,
                tweens: [], flybys: [], weather: null, skyTarget: null
            }, def);
            inputBuffer = ''; bufferHeat = 0;
            updateWordHud();
        }

        function gameWin(text) {
            if (!gameMode || gameMode.won) return;
            gameMode.won = true;
            showBanner('★ ' + text + ' ★', 'Esc for the menu — or keep typing words to play with the scene');
            for (let i = 0; i < 8; i++) {
                setTimeout(() => {
                    if (scene && gameMode) detonateFirework(new THREE.Vector3(
                        (Math.random() - 0.5) * 26, 8 + Math.random() * 9, (Math.random() - 0.5) * 12 - 4));
                }, i * 240);
            }
            [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
                setTimeout(() => gameBeep(f, 0.5, 'triangle', 0.22), i * 110));
        }

        // Expand { 'GO|START|CHOO': fn } into { GO: fn, START: fn, CHOO: fn }.
        function expandWords(map) {
            const out = {};
            for (const k in map) k.split('|').forEach(a => { out[a] = map[k]; });
            return out;
        }

        // Longest matching level word at the END of the input buffer wins.
        function tryGameWords() {
            if (!gameMode || !gameMode.words) return false;
            let best = null;
            for (const w in gameMode.words) {
                if (w.length >= 2 && inputBuffer.endsWith(w) && (!best || w.length > best.length)) best = w;
            }
            if (!best) return false;
            hudFlashSuccess(best);
            markFound(best);
            inputBuffer = '';
            try { gameMode.words[best](); } catch (err) { console.warn('word action failed:', best, err); }
            return true;
        }

        function handleGameKey(key) {
            if (/^[a-zA-Z]$/.test(key)) {
                const char = key.toUpperCase();
                playTone(char, null);
                inputBuffer += char;
                if (inputBuffer.length > 24) inputBuffer = inputBuffer.slice(-24);
                bumpHeat();
                updateWordHud();
                tryGameWords();
            } else if (key === ' ') {
                inputBuffer = '';
                updateWordHud();
            }
        }

        // --- Shared doodad toolkit -----------------------------------------
        function gameBeep(freq, dur, type, vol) {
            initAudio();
            if (!audioCtx || soundVolume <= 0) return;
            const now = audioCtx.currentTime;
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = type || 'sine';
            o.frequency.setValueAtTime(freq, now);
            g.gain.setValueAtTime((vol || 0.15) * soundVolume, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + (dur || 0.2));
            o.connect(g); g.connect(audioCtx.destination);
            o.start(now); o.stop(now + (dur || 0.2) + 0.05);
        }
        function beeps(seq) { // [[freq, dur, delayMs, type, vol], ...]
            seq.forEach(s => setTimeout(() => gameBeep(s[0], s[1], s[3], s[4]), s[2] || 0));
        }
        function tween(dur, fn, onDone) { if (gameMode) gameMode.tweens.push({ t: 0, dur, fn, onDone }); }
        function flyby(mesh, from, to, dur, opts) {
            if (!gameMode || !scene) return;
            mesh.position.copy(from); scene.add(mesh);
            gameMode.flybys.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, opts: opts || {} });
        }
        function puffBurst(pos, color, n, spread, opts) {
            for (let i = 0; i < (n || 14); i++) {
                const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.7 + 0.15, (Math.random() - 0.5))
                    .multiplyScalar((spread || 1) * 0.12);
                fwParticle(
                    pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * (spread || 1), 0, (Math.random() - 0.5) * (spread || 1))),
                    v, new THREE.Color(typeof color === 'function' ? color() : color),
                    Object.assign({ gravity: 0.001, decay: 0.02 }, opts || {}));
            }
        }
        function setWeather(kind) { if (gameMode) gameMode.weather = kind; }
        function skyTo(hex, fogHex) {
            if (gameMode) gameMode.skyTarget = { c: new THREE.Color(hex), f: fogHex != null ? new THREE.Color(fogHex) : null };
        }
        function nearestU(curve, pos, samples) {
            samples = samples || 220;
            let bu = 0, bd = Infinity;
            for (let i = 0; i < samples; i++) {
                const u = i / samples;
                const p = curve.getPointAt(u);
                const dx = p.x - pos.x, dz = p.z - pos.z;
                const d = dx * dx + dz * dz;
                if (d < bd) { bd = d; bu = u; }
            }
//__APPEND_MARKER__