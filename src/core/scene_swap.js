// Letter Launcher — src/core/scene_swap.js
// Scene swap: clearSceneGeometry() clean-slate wipe + buildScene(builder).
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // Remove everything the previous scene builder added (meshes + colliders) plus
        // the spawned letters, so swapping levels is a true clean slate.
        function clearSceneGeometry() {
            try { rideReset(); } catch (e) { console.error('rideReset', e); } // LLF-10
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
            try { builder(); enrichScene(currentScene); }
            finally { capturingSceneObjects = false; }
        }
