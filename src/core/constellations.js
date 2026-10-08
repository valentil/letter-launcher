// Letter Launcher — src/core/constellations.js (LLF-9 Typographic Constellations)
// Shift+left-click letters to chain them with glowing neon lines. Clicking the first
// letter again closes the shape (it pulses); in the SPACE scene a closed shape floats
// up into the sky and stays as a star constellation with its letters as a name label.
// Escape / right-click cancels the chain in progress. Classic script: declarations only
// at top level; wired via LLHooks registrations at the end of this file (LLF-91).

        const CONST_MAX_NODES = 12;      // letters per chain
        const CONST_MAX_SEGMENTS = 48;   // total line segments alive at once (all chains)
        const CONST_MAX_SKY = 4;         // floated constellations kept in the sky
        const CONST_NEON = [0x00ffff, 0xff00ff, 0x39ff14, 0xffe600, 0xff3860];
        let constellations = [];         // { nodes:[{pb,pos}], line, closed, color, pulseT, sky, label, t0 }
        let activeConstellation = null;  // chain being built (also in `constellations`)
        let constellationColorIdx = 0;

        function constSegmentCount() {
            return constellations.reduce((n, c) => n + Math.max(0, c.nodes.length - 1 + (c.closed ? 1 : 0)), 0);
        }

        function constDispose(c) {
            [c.line, c.label, c.stars].forEach(o => {
                if (!o) return;
                if (scene) scene.remove(o);
                if (o.geometry && o.geometry.dispose) o.geometry.dispose();
                if (o.material) {
                    if (o.material.map && o.material.map.dispose) o.material.map.dispose();
                    if (o.material.dispose) o.material.dispose();
                }
            });
        }

        function constMakeLine(color) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CONST_MAX_NODES + 1) * 3), 3));
            geo.setDrawRange(0, 0);
            const mat = new THREE.LineBasicMaterial({
                color, transparent: true, opacity: 0.95,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const line = new THREE.Line(geo, mat);
            line.frustumCulled = false;
            scene.add(line);
            return line;
        }

        function constPickLetter(e) {
            raycaster.setFromCamera(mouse, camera);
            const meshes = physicsBodies.filter(pb => pb.char && pb.type !== 'npc' && pb.type !== 'zoo_animal' && pb.mesh).map(pb => pb.mesh);
            const hits = raycaster.intersectObjects(meshes, true);
            if (!hits.length) return null;
            let o = hits[0].object;
            while (o) {
                const pb = physicsBodies.find(p => p.mesh === o);
                if (pb) return pb;
                o = o.parent;
            }
            return null;
        }

        function constCancel() {
            if (!activeConstellation) return false;
            const i = constellations.indexOf(activeConstellation);
            if (i >= 0) constellations.splice(i, 1);
            constDispose(activeConstellation);
            activeConstellation = null;
            return true;
        }

        function constClearAll() {
            constellations.forEach(constDispose);
            constellations = [];
            activeConstellation = null;
        }

        // Returns true when the event was consumed (caller should stop handling it).
        function constellationMouseDown(e) {
            if (menuScreen !== 'PLAYING') return false;
            if (e.button === 2 && activeConstellation) { constCancel(); return true; }
            if (e.button !== 0 || !e.shiftKey) return false;
            const pb = constPickLetter(e);
            if (!pb) return true; // shift-click on empty space: swallow, keep chain
            if (!activeConstellation) {
                if (constSegmentCount() >= CONST_MAX_SEGMENTS) {
                    const old = constellations.shift();
                    if (old) constDispose(old);
                }
                const color = CONST_NEON[constellationColorIdx++ % CONST_NEON.length];
                activeConstellation = { nodes: [], line: constMakeLine(color), closed: false, color, pulseT: 0, sky: false };
                constellations.push(activeConstellation);
            }
            const c = activeConstellation;
            if (c.nodes.length >= 3 && c.nodes[0].pb === pb) {
                c.closed = true; c.pulseT = 0; c.t0 = Date.now();
                activeConstellation = null;
                return true;
            }
            if (c.nodes[c.nodes.length - 1] && c.nodes[c.nodes.length - 1].pb === pb) return true;
            if (c.nodes.length < CONST_MAX_NODES && constSegmentCount() < CONST_MAX_SEGMENTS) {
                c.nodes.push({ pb, pos: pb.mesh.position.clone() });
            }
            return true;
        }

        function constellationKey(e) {
            if (e.key === 'Escape') constCancel();
        }

        function constMakeLabel(text, color) {
            const cv = document.createElement('canvas');
            cv.width = 256; cv.height = 64;
            const g = cv.getContext('2d');
            g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.shadowColor = '#' + ('000000' + color.toString(16)).slice(-6); g.shadowBlur = 14;
            g.fillStyle = '#ffffff'; g.fillText(text, 128, 32);
            const tex = new THREE.CanvasTexture(cv);
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            spr.scale.set(6, 1.5, 1);
            scene.add(spr);
            return spr;
        }

        function constSendToSky(c) {
            c.sky = true; c.t0 = Date.now();
            c.nodes.forEach(n => { n.sky = n.pos.clone(); });
            const skyCount = constellations.filter(x => x.sky).length;
            if (skyCount > CONST_MAX_SKY) {
                const old = constellations.find(x => x.sky && x !== c);
                if (old) { constellations.splice(constellations.indexOf(old), 1); constDispose(old); }
            }
            const name = c.nodes.map(n => n.pb.char || '').join('');
            c.label = constMakeLabel(name, c.color);
            const sg = new THREE.BufferGeometry();
            sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.nodes.length * 3), 3));
            c.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            c.stars.frustumCulled = false;
            scene.add(c.stars);
        }

        function updateConstellations() {
            if (!constellations.length || !scene) return;
            const now = Date.now();
            for (let ci = constellations.length - 1; ci >= 0; ci--) {
                const c = constellations[ci];
                // letters removed from the world (exploded etc.): keep last known position
                c.nodes.forEach(n => {
                    if (!c.sky && n.pb.mesh && n.pb.mesh.parent) n.pos.copy(n.pb.mesh.position);
                });
                if (!c.sky && c.nodes.some(n => !(n.pb.mesh && n.pb.mesh.parent)) && !c.closed) {
                    if (c === activeConstellation) activeConstellation = null;
                    constellations.splice(ci, 1); constDispose(c); continue;
                }
                if (c.closed && !c.sky && currentScene === 'space' && now - c.t0 > 1500) constSendToSky(c);
                let pts = c.nodes.map(n => n.pos);
                if (c.sky) {
                    const k = Math.min(1, (now - c.t0) / 4000);
                    const lift = 14 * (1 - Math.pow(1 - k, 3));
                    pts = c.nodes.map(n => n.sky.clone().setY(n.sky.y + lift));
                    const cen = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
                    c.label.position.set(cen.x, cen.y + 2, cen.z);
                    c.label.material.opacity = 0.6 + 0.4 * Math.sin(now * 0.003);
                    const sp = c.stars.geometry.attributes.position;
                    pts.forEach((p, i) => sp.setXYZ(i, p.x, p.y, p.z));
                    sp.needsUpdate = true;
                }
                const arr = c.line.geometry.attributes.position;
                pts.forEach((p, i) => arr.setXYZ(i, p.x, p.y, p.z));
                let count = pts.length;
                if (c.closed && pts.length) { arr.setXYZ(count, pts[0].x, pts[0].y, pts[0].z); count++; }
                arr.needsUpdate = true;
                c.line.geometry.setDrawRange(0, count);
                if (c.closed) {
                    c.pulseT += 0.12;
                    c.line.material.opacity = 0.65 + 0.35 * Math.sin(c.pulseT * 2);
                    if (!c.sky) c.nodes.forEach(n => {
                        const m = n.pb.mesh && n.pb.mesh.material;
                        if (m && m.emissive) m.emissiveIntensity = 0.8 + 0.6 * Math.sin(c.pulseT * 2);
                    });
                }
            }
        }

        // LLF-91 hook bus: registered here instead of one-liners in menu.js / engine.js / scene_swap.js.
        if (typeof LLHooks !== 'undefined') {
            LLHooks.on('mousedown', function (e) { return constellationMouseDown(e); }); // true = click consumed
            LLHooks.on('keydown', function (e) { constellationKey(e); });
            LLHooks.on('frame', function () { updateConstellations(); });
            LLHooks.on('beforeSceneSwap', function () { constClearAll(); });
        }
