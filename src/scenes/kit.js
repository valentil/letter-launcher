// Letter Launcher — src/scenes/kit.js
// LLF-86 [Fidelity-Kit] sandbox scenes asset kit: one layout table per scene, placed through
// AssetLib (src/core/assetlib.js), with static Cannon colliders for heavy props and a dev-mode
// bbox overlap check (console.warn + window.__llfKit test hook). Classic <script>: loads after
// assetlib.js and before the scene files; scenes call llfKitPlace('<SCENE>', groundAt) from their
// builder inside try/catch. No scene-specific geometry lives here, only tables and helpers.
//
// LLF_KIT_DIMS is the asset bbox in the GLB frame (m, +Y up) copied from assets/cad/manifest.json
// (node tools/cad/kit_dims.js <names>); tests/test_llf86_assetkit.js fails if it drifts.
// LAYOUT entries: n = asset, x/z = world position, rotY, dy = lift above ground, lod:false for
// small props, col:true = heavy prop gets a static collider from its bbox, fixed:true = placed by
// the scene itself (checked for overlap, not placed again).

        const LLF_KIT_DIMS = {"park_bench":{"min":[-0.915,0,-0.58],"max":[0.915,0.85,-0.015]},"traffic_light":{"min":[-0.175,0,-0.175],"max":[3.05,5.45,0.175]},"sedan":{"min":[-2.3,0,-0.925],"max":[2.3,1.45,0.925]},"street_lamp":{"min":[-0.15,0,-0.16],"max":[1.9,6.246,0.16]},"fire_hydrant":{"min":[-0.215,0,-0.195],"max":[0.15,0.772,0.195]},"wooden_crate":{"min":[0,0,-0.4],"max":[0.6,0.38,0]}};

        const LLF_KIT_LAYOUT = {
            CITY: [
                // lamps / hydrants / crates are placed by city.js (LLF-69); listed so the check sees them
                { n: 'street_lamp', x: -9, z: -60, rotY: 0, fixed: true }, { n: 'street_lamp', x: 9, z: -48, rotY: Math.PI, fixed: true },
                { n: 'street_lamp', x: -9, z: -36, rotY: 0, fixed: true }, { n: 'street_lamp', x: 9, z: -24, rotY: Math.PI, fixed: true },
                { n: 'street_lamp', x: -9, z: -12, rotY: 0, fixed: true }, { n: 'street_lamp', x: 9, z: 0, rotY: Math.PI, fixed: true },
                { n: 'street_lamp', x: -9, z: 12, rotY: 0, fixed: true }, { n: 'street_lamp', x: 9, z: 24, rotY: Math.PI, fixed: true },
                { n: 'street_lamp', x: -9, z: 36, rotY: 0, fixed: true }, { n: 'street_lamp', x: 9, z: 48, rotY: Math.PI, fixed: true },
                { n: 'street_lamp', x: -9, z: 60, rotY: 0, fixed: true }, { n: 'street_lamp', x: 9, z: 72, rotY: Math.PI, fixed: true },
                { n: 'fire_hydrant', x: -8.4, z: -30, rotY: 0, fixed: true }, { n: 'fire_hydrant', x: 8.4, z: 6, rotY: Math.PI, fixed: true },
                { n: 'fire_hydrant', x: -8.4, z: 42, rotY: 0, fixed: true }, { n: 'fire_hydrant', x: 8.4, z: -54, rotY: Math.PI, fixed: true },
                // LLF-86 kit
                { n: 'traffic_light', x: -7, z: -4, rotY: 0, col: true },
                { n: 'traffic_light', x: 7, z: 4, rotY: Math.PI, col: true },
                { n: 'park_bench', x: -11.5, z: -20, rotY: -Math.PI / 2, lod: false },
                { n: 'park_bench', x: -11.5, z: 28, rotY: -Math.PI / 2, lod: false },
                { n: 'park_bench', x: 11.5, z: -40, rotY: Math.PI / 2, lod: false },
                { n: 'park_bench', x: 11.5, z: 14, rotY: Math.PI / 2, lod: false },
                { n: 'sedan', x: -4, z: -25, rotY: Math.PI / 2, col: true },
                { n: 'sedan', x: 4, z: 30, rotY: -Math.PI / 2, col: true },
                { n: 'sedan', x: -4, z: 66, rotY: Math.PI / 2, col: true },
                { n: 'sedan', x: 4, z: -62, rotY: -Math.PI / 2, col: true }
            ]
        };

        // World-space axis-aligned envelope of an item's rotated bbox (conservative for rotY not a multiple of 90deg).
        function llfKitFootprint(it, dims) {
            const d = (dims || LLF_KIT_DIMS)[it.n];
            if (!d) return null;
            const c = Math.cos(it.rotY || 0), s = Math.sin(it.rotY || 0);
            let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
            [[d.min[0], d.min[2]], [d.min[0], d.max[2]], [d.max[0], d.min[2]], [d.max[0], d.max[2]]].forEach(function (p) {
                // three.js rotation about +Y: x' = x*cos + z*sin, z' = -x*sin + z*cos
                const wx = it.x + p[0] * c + p[1] * s, wz = it.z - p[0] * s + p[1] * c;
                if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
            });
            const y0 = (it.dy || 0) + d.min[1], y1 = (it.dy || 0) + d.max[1];
            return { x0: x0, x1: x1, z0: z0, z1: z1, y0: y0, y1: y1 };
        }

        // Pairs of items whose envelopes interpenetrate by more than eps metres on every axis.
        function llfKitOverlaps(list, dims, eps) {
            eps = eps == null ? 0.01 : eps;
            const fp = list.map(function (it) { return llfKitFootprint(it, dims); }), out = [];
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
                const a = fp[i], b = fp[j];
                if (!a || !b) continue;
                if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > eps && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > eps &&
                    Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > eps) out.push([i, j]);
            }
            return out;
        }

        function llfKitDev() {
            try { return /[?&]dev\b/.test(location.search) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch (e) { return false; }
        }

        // Place a scene's kit through AssetLib. groundAt(x, z) -> world y of the ground there.
        // Safe to call from a scene builder: every step is guarded and nothing awaits.
        function llfKitPlace(key, groundAt) {
            const list = LLF_KIT_LAYOUT[key] || [];
            const ov = llfKitOverlaps(list);
            try {
                window.__llfKit = window.__llfKit || { overlaps: {}, placed: {} };
                window.__llfKit.overlaps[key] = ov.length; window.__llfKit.placed[key] = 0;
                if (ov.length && llfKitDev() && window.console) ov.forEach(function (p) { console.warn('[kit ' + key + '] overlap:', list[p[0]].n, '@', list[p[0]].x, list[p[0]].z, 'x', list[p[1]].n, '@', list[p[1]].x, list[p[1]].z); });
            } catch (e) { }
            if (!window.AssetLib) return 0;
            let placed = 0;
            list.forEach(function (it) {
                if (it.fixed) return;
                try {
                    const y = (groundAt ? groundAt(it.x, it.z) : 0) + (it.dy || 0);
                    AssetLib.place(it.n, { x: it.x, y: y, z: it.z, rotY: it.rotY || 0, lod: it.lod === false ? false : undefined });
                    if (it.col) llfKitCollider(it, y);
                    placed++;
                } catch (e) { if (window.console) console.warn('[kit ' + key + '] ' + it.n + ' skipped:', e && e.message); }
            });
            try { window.__llfKit.placed[key] = placed; } catch (e) { }
            return placed;
        }

        // Static (mass 0) box collider from the asset bbox, rotated with the prop.
        function llfKitCollider(it, groundY) {
            if (typeof CANNON === 'undefined' || typeof world === 'undefined') return;
            const d = LLF_KIT_DIMS[it.n]; if (!d) return;
            const hx = (d.max[0] - d.min[0]) / 2, hy = (d.max[1] - d.min[1]) / 2, hz = (d.max[2] - d.min[2]) / 2;
            const cx = (d.max[0] + d.min[0]) / 2, cz = (d.max[2] + d.min[2]) / 2, c = Math.cos(it.rotY || 0), s = Math.sin(it.rotY || 0);
            const body = new CANNON.Body({ mass: 0, material: (typeof physicsMaterial !== 'undefined') ? physicsMaterial : undefined });
            body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
            body.position.set(it.x + cx * c + cz * s, groundY + d.min[1] + hy, it.z - cx * s + cz * c);
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), it.rotY || 0);
            world.addBody(body);
            if (typeof colliderBodies !== 'undefined') colliderBodies.push(body);
        }

        if (typeof window !== 'undefined') window.LLF_KIT = { DIMS: LLF_KIT_DIMS, LAYOUT: LLF_KIT_LAYOUT, footprint: llfKitFootprint, overlaps: llfKitOverlaps };
