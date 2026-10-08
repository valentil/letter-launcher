// Letter Launcher — src/core/playarea.js
// Play area: computePlayBounds..setupPlayArea, bowl build/clear/spawn positions, containment walls, heightfield collider helper.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

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

        // W1: Build a Cannon.js Heightfield collider that matches an undulating VISIBLE
        // surface by sampling the same procedural height function the scene mesh uses.
        // NOTE: In Cannon.js 0.6.2 a Box body (our letters) does NOT collide with a
        // Trimesh (it tunnels straight through), but it DOES collide with a Heightfield,
        // so heightfields are the correct primitive for terrain that letters must rest on.
        function addHeightfieldCollider(minX, minZ, maxX, maxZ, elementSize, heightFn, name) {
            const nx = Math.max(2, Math.round((maxX - minX) / elementSize) + 1);
            const nz = Math.max(2, Math.round((maxZ - minZ) / elementSize) + 1);
            const data = [];
            let minH = Infinity;
            for (let i = 0; i < nx; i++) {
                const row = [];
                const wx = minX + i * elementSize;
                for (let j = 0; j < nz; j++) {
                    // local heightfield y-index maps to world -z after the -90deg X rotation
                    const wz = minZ + (nz - 1 - j) * elementSize;
                    const hgt = heightFn(wx, wz);
                    row.push(hgt);
                    if (hgt < minH) minH = hgt;
                }
                data.push(row);
            }
            // LLB-100000: cannon 0.6.2 builds each collision pillar with its bottom at local
            // height -1, so any sample below -1 (sea floor, craters, dunes under 0) yields an
            // inside-out ConvexPolyhedron: a console.error flood and inverted contact normals.
            // Store the samples relative to the lowest one (all >= 0) and lift the body back
            // down by that amount, so the world surface is unchanged.
            if (!isFinite(minH)) minH = 0;
            for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) data[i][j] -= minH;
            const hfShape = new CANNON.Heightfield(data, { elementSize: elementSize });
            const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
            body.addShape(hfShape);
            // Rotate so the heightfield's height axis points +Y (up) in world space.
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
            body.position.set(minX, minH, minZ + (nz - 1) * elementSize);
            world.addBody(body);
            colliderBodies.push(body);
            // Expose the surface fn so spawns/other logic can reference the real ground.
            scene.userData.groundHeightFn = heightFn;
            return body;
        }
