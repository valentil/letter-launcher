// Letter Launcher — src/scenes/waterworks/parts.js (LLF-84)
// WATERWORKS hardware: one THREE.InstancedMesh per mesh of each CAD part type (pipe_spool, elbow_90,
// flange_joint, gate_valve_body, gate_valve_stem). Parts are placed with matrices; the GLBs come from
// AssetLib (assets/cad/*.glb, metres, +Y up). Primitive stand-ins are shown instantly and swapped for
// the CAD meshes when the GLB arrives (or kept if AssetLib / the GLB is unavailable).
// Classic <script>: window.WaterParts. Pure placement maths is exported for node tests.
(function (root) {
    'use strict';
    var S = 6;                  // scene units per CAD metre (DN50 pipe = 0.36 units across)
    var ELBOW_R = 0.15;         // elbow_90 centreline radius, metres
    var VALVE_LEN = 0.15, VALVE_AXIS_H = 0.0825, STEM_BASE_H = 0.2055, STEM_RISE = 0.04;
    var JOINT_LEN = 0.116;      // flange_joint overall length, metres

    // ---- pure placement maths (no THREE) -------------------------------------------------
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function len(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
    function unit(v) { var l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
    function add(a, b, k) { k = k == null ? 1 : k; return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]; }
    // Break a polyline into straight runs + elbows. Corners get an elbow; every straight run is
    // shortened by the elbow's leg (ELBOW_R * S) at each end. Returns {segs:[{a,b,dir}], elbows:[{corner,din,dout}]}.
    function layout(pts) {
        var leg = ELBOW_R * S, segs = [], elbows = [];
        for (var i = 0; i < pts.length - 1; i++) {
            var d = unit(sub(pts[i + 1], pts[i]));
            var a = pts[i], b = pts[i + 1];
            if (i > 0) a = add(a, d, leg);
            if (i < pts.length - 2) b = add(b, d, -leg);
            segs.push({ a: a, b: b, dir: d, length: len(sub(b, a)) });
        }
        for (var j = 1; j < pts.length - 1; j++) {
            var din = unit(sub(pts[j], pts[j - 1])), dout = unit(sub(pts[j + 1], pts[j]));
            elbows.push({ corner: pts[j], din: din, dout: dout });
        }
        return { segs: segs, elbows: elbows };
    }
    // Cut gaps (valves, flange joints) out of a straight run. gaps: [{at: distance from a, len, kind}]
    // Returns pieces [{a,b,length}] for spools plus placed items [{kind, centre, dir}].
    function cutRun(seg, gaps) {
        var g = gaps.slice().sort(function (x, y) { return x.at - y.at; });
        var pieces = [], items = [], cur = 0;
        g.forEach(function (gp) {
            var s = gp.at - gp.len / 2, e = gp.at + gp.len / 2;
            if (s > cur + 1e-6) pieces.push({ a: add(seg.a, seg.dir, cur), b: add(seg.a, seg.dir, s), length: s - cur });
            items.push({ kind: gp.kind, centre: add(seg.a, seg.dir, gp.at), dir: seg.dir, id: gp.id });
            cur = e;
        });
        if (seg.length > cur + 1e-6) pieces.push({ a: add(seg.a, seg.dir, cur), b: seg.b, length: seg.length - cur });
        return { pieces: pieces, items: items };
    }
    // Evenly spaced flange joints on long runs (every `every` units) that do not collide with `gaps`.
    function autoJoints(seg, gaps, every) {
        var out = [], n = Math.floor(seg.length / every), jl = JOINT_LEN * S;
        for (var k = 1; k <= n; k++) {
            var at = seg.length * k / (n + 1), ok = true;
            gaps.forEach(function (gp) { if (Math.abs(gp.at - at) < (gp.len + jl) / 2 + 0.3) ok = false; });
            if (at - jl / 2 < 0.3 || at + jl / 2 > seg.length - 0.3) ok = false;
            if (ok) out.push({ at: at, len: jl, kind: 'flange_joint' });
        }
        return out;
    }
    function valveRotationY(dir) {         // valve flow axis is +X in the GLB frame
        return Math.atan2(-dir[2], dir[0]);
    }
    var api = { S: S, ELBOW_R: ELBOW_R, VALVE_LEN: VALVE_LEN, VALVE_AXIS_H: VALVE_AXIS_H, STEM_BASE_H: STEM_BASE_H,
        STEM_RISE: STEM_RISE, JOINT_LEN: JOINT_LEN, layout: layout, cutRun: cutRun, autoJoints: autoJoints,
        valveRotationY: valveRotationY, unit: unit, sub: sub, add: add, len: len };

    // ---- THREE side ----------------------------------------------------------------------------
    function mats() {
        return {
            pipe: new THREE.MeshStandardMaterial({ color: 0x5a6b7a, metalness: 0.7, roughness: 0.45 }),
            iron: new THREE.MeshStandardMaterial({ color: 0x1a478c, metalness: 0.2, roughness: 0.45 }),
            steel: new THREE.MeshStandardMaterial({ color: 0xa0a4ad, metalness: 1, roughness: 0.35 }),
            bronze: new THREE.MeshStandardMaterial({ color: 0xb58549, metalness: 1, roughness: 0.4 })
        };
    }
    // Primitive stand-ins in the GLB frame (metres, Y up) so a missing GLB still reads as plumbing.
    function primitives(name, M) {
        var T = THREE, out = [];
        function cyl(r, h, mat, x, y, z, rz) {
            var g = new T.CylinderGeometry(r, r, h, 12), m = new T.Matrix4();
            m.makeRotationZ(rz || 0); m.setPosition(x, y, z); out.push({ geometry: g, material: mat, rel: m });
        }
        if (name === 'pipe_spool') cyl(0.03, 1, M.pipe, 0, 0.5, 0);
        else if (name === 'elbow_90') {
            var g = new T.TorusGeometry(ELBOW_R, 0.03, 8, 12, Math.PI / 2), m = new T.Matrix4();
            m.makeRotationZ(Math.PI / 2); m.setPosition(ELBOW_R, 0, 0);
            // rotation first, then translate by (R,0,0) in world: compose explicitly
            var rot = new T.Matrix4().makeRotationZ(Math.PI / 2), tr = new T.Matrix4().makeTranslation(ELBOW_R, 0, 0);
            out.push({ geometry: g, material: M.pipe, rel: tr.multiply(rot) });
        } else if (name === 'flange_joint') {
            cyl(0.03, JOINT_LEN, M.iron, 0, JOINT_LEN / 2, 0); cyl(0.0825, 0.036, M.iron, 0, 0.058, 0);
            for (var i = 0; i < 4; i++) { var a = i * Math.PI / 2; cyl(0.014, 0.012, M.steel, Math.cos(a) * 0.0625, 0.081, Math.sin(a) * 0.0625); }
        } else if (name === 'gate_valve_body') {
            var bm = new T.Matrix4().makeTranslation(0, VALVE_AXIS_H, 0);
            out.push({ geometry: new T.BoxGeometry(0.114, 0.1, 0.1), material: M.iron, rel: bm });
            cyl(0.0825, 0.018, M.iron, -0.066, VALVE_AXIS_H, 0, Math.PI / 2); cyl(0.0825, 0.018, M.iron, 0.066, VALVE_AXIS_H, 0, Math.PI / 2);
            cyl(0.038, 0.06, M.iron, 0, 0.1625, 0); cyl(0.055, 0.013, M.iron, 0, 0.199, 0);
        } else if (name === 'gate_valve_stem') {
            cyl(0.008, 0.14, M.steel, 0, 0.07, 0); cyl(0.072, 0.012, M.bronze, 0, 0.156, 0);
        }
        return out;
    }

    // One handle per part type. count = max instances. place(i, THREE.Matrix4) sets instance i.
    function instanced(name, count, parent) {
        var M = mats(), h = { name: name, count: count, used: 0, meshes: [], loaded: false, mats: [] };
        var tmp = new THREE.Matrix4(), hide = new THREE.Matrix4().makeScale(0, 0, 0);
        for (var i = 0; i < count; i++) h.mats.push(hide.clone());
        function build(parts) {
            h.meshes.forEach(function (im) { parent.remove(im); });
            h.meshes = parts.map(function (p) {
                var im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, count));
                im.frustumCulled = false; im.userData.rel = p.rel;
                parent.add(im); return im;
            });
            h.flush();
        }
        h.flush = function () {
            h.meshes.forEach(function (im) {
                for (var i = 0; i < count; i++) { tmp.multiplyMatrices(h.mats[i], im.userData.rel); im.setMatrixAt(i, tmp); }
                im.instanceMatrix.needsUpdate = true;
            });
        };
        h.place = function (i, m) {
            if (i >= count) return;
            h.mats[i].copy(m); h.used = Math.max(h.used, i + 1);
            h.meshes.forEach(function (im) { tmp.multiplyMatrices(m, im.userData.rel); im.setMatrixAt(i, tmp); im.instanceMatrix.needsUpdate = true; });
        };
        build(primitives(name, M));
        try {
            if (typeof AssetLib !== 'undefined' && AssetLib.load) AssetLib.load(name).then(function (g) {
                try {
                    if (!g || g.userData.cadFallback) return;
                    g.updateMatrixWorld(true);
                    var parts = [];
                    g.traverse(function (o) { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, rel: o.matrixWorld.clone() }); });
                    if (parts.length) { build(parts); h.loaded = true; }
                } catch (e) { if (window.console) console.warn('[WaterParts] swap failed', name, e); }
            });
        } catch (e) { /* stay on primitives */ }
        return h;
    }
    api.instanced = instanced;
    api.primitives = primitives;

    // Matrix helpers (THREE)
    api.matSpool = function (a, b) {           // spool: local +Y from a to b, radial scale S, length scale = length (1 m spool)
        var d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
        var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        return new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(S, L, S));
    };
    api.matElbow = function (corner, din, dout) {   // inlet at origin heading +Y, outlet heading +X, corner at (0,R)
        var ex = new THREE.Vector3(dout[0], dout[1], dout[2]), ey = new THREE.Vector3(din[0], din[1], din[2]);
        var ez = new THREE.Vector3().crossVectors(ex, ey);
        var m = new THREE.Matrix4().makeBasis(ex, ey, ez);
        var q = new THREE.Quaternion().setFromRotationMatrix(m);
        var pos = new THREE.Vector3(corner[0] - din[0] * ELBOW_R * S, corner[1] - din[1] * ELBOW_R * S, corner[2] - din[2] * ELBOW_R * S);
        return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(S, S, S));
    };
    api.matJoint = function (centre, dir) {       // flange_joint origin is at its inlet end
        var d = new THREE.Vector3(dir[0], dir[1], dir[2]);
        var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        var s = JOINT_LEN * S / 2, p = new THREE.Vector3(centre[0] - dir[0] * s, centre[1] - dir[1] * s, centre[2] - dir[2] * s);
        return new THREE.Matrix4().compose(p, q, new THREE.Vector3(S, S, S));
    };
    api.matValve = function (centre, dir, stemRise, wheelAngle, stem) {
        var q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), valveRotationY(dir));
        var pos = new THREE.Vector3(centre[0], centre[1] - VALVE_AXIS_H * S, centre[2]);
        if (!stem) return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(S, S, S));
        var q2 = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wheelAngle || 0));
        var p2 = new THREE.Vector3(pos.x, pos.y + (STEM_BASE_H + (stemRise || 0) * STEM_RISE) * S, pos.z);
        return new THREE.Matrix4().compose(p2, q2, new THREE.Vector3(S, S, S));
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.WaterParts = api;
    else if (root) root.WaterParts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
