// Letter Launcher — src/scenes/rocket/stage_bodies.js (LLF-82)
// Tumbling spent stages for the MOON ROCKET scene. Each separated stage becomes a cannon.js body with the
// stage's REAL mass (dry + leftover propellant, from RocketAscent.stageNow) and a diagonal inertia built from the
// CAD dry-mass shell estimate in assets/cad/rocket_stages.json plus the leftover propellant as a solid column.
// It lives in a private zero-gravity CANNON.World (the game's own world is untouched) in the VEHICLE frame:
// the live stack accelerates away, so a dropped stage feels an apparent -accel along the stack axis; the
// separation springs push slightly off its centre of mass and an aerodynamic force acts at the centre of
// pressure (the stage's geometric centre, which is ahead of its COM), so it starts to tumble.
//
// Classic <script>; also node-loadable (module.exports) for the pure helper tumbleParams().
(function (root) {
    'use strict';

    // Pure: mass, principal inertia and the initial angular velocity of a separated stage. +Y is the stage axis.
    //   rec: a RocketAscent separation record (dryKg, leftoverPropKg, lengthM, diameterM, comZm, inertia?)
    //   tbl: the matching rocket_stages.json stage ({inertiaDry:{axialKgM2, transverseKgM2}}) or null
    function tumbleParams(rec, tbl, opts) {
        opts = opts || {};
        var dry = rec.dryKg, prop = rec.leftoverPropKg || 0, L = rec.lengthM || 10, r = (rec.diameterM || 6) / 2;
        var mass = dry + prop;
        var dI = (tbl && tbl.inertiaDry) || { axialKgM2: dry * r * r, transverseKgM2: dry * (r * r / 2 + L * L / 12) };
        // leftover propellant as a solid column of the stage length (slosh ignored)
        var pAx = prop * r * r / 2, pTr = prop * (3 * r * r + L * L) / 12;
        var Iax = dI.axialKgM2 + pAx, Itr = dI.transverseKgM2 + pTr;
        var dv = opts.separationDv != null ? opts.separationDv : 2.0;      // m/s from the separation springs/retros (assumed)
        var e = opts.offsetM != null ? opts.offsetM : 2.5;                 // m, thrust-line offset from the COM (assumed)
        var J = mass * dv;                                                 // N s
        return { mass: mass, inertia: { x: Itr, y: Iax, z: Itr }, dv: dv, offsetM: e,
                 omega: { x: 0, y: 0, z: e * J / Itr }, comZm: rec.comZm || L / 2, lengthM: L, diameterM: r * 2 };
    }

    function create(opts) {
        opts = opts || {};
        if (typeof CANNON === 'undefined') return null;
        var world = new CANNON.World();
        world.gravity.set(0, 0, 0);
        var list = [];
        var api = {
            world: world, bodies: list,
            // spawn(rec, tbl, state) -> { body, params, tag }; state: { pos:{x,y,z} (m, vehicle frame), rho, accel (m/s^2 of the live stack) }
            spawn: function (rec, tbl, state, tag) {
                var p = tumbleParams(rec, tbl, opts);
                var b = new CANNON.Body({ mass: p.mass });
                b.inertia.set(p.inertia.x, p.inertia.y, p.inertia.z);
                b.invInertia.set(1 / p.inertia.x, 1 / p.inertia.y, 1 / p.inertia.z);
                b.position.set(state.pos.x, state.pos.y, state.pos.z);
                b.velocity.set(0, -p.dv, 0);
                b.angularVelocity.set(p.omega.x, p.omega.y, p.omega.z);
                b.linearDamping = 0; b.angularDamping = 0;
                b.updateInertiaWorld(true);
                world.addBody(b);
                var item = { body: b, params: p, tag: tag, age: 0, rho: state.rho || 0, accel: state.accel || 0 };
                list.push(item);
                return item;
            },
            // dt in seconds of visual time; each body feels the apparent acceleration and drag at its CP
            step: function (dt) {
                for (var i = 0; i < list.length; i++) {
                    var it = list[i], b = it.body, p = it.params;
                    b.applyForce(new CANNON.Vec3(0, -p.mass * it.accel, 0), new CANNON.Vec3(0, 0, 0));
                    var v = b.velocity.length();
                    if (it.rho > 0 && v > 1) {
                        var A = p.diameterM * p.lengthM * 0.6;                       // side-on-ish reference area
                        var Fd = 0.5 * it.rho * v * v * 0.8 * A;
                        var dir = b.velocity.scale(-1 / v);
                        var cp = new CANNON.Vec3(0, p.lengthM / 2 - p.comZm, 0);        // geometric centre relative to the COM (body frame)
                        b.applyForce(dir.scale(Fd), b.quaternion.vmult(cp));
                    }
                    it.age += dt;
                }
                world.step(1 / 60, dt, 8);
            },
            remove: function (item) {
                var k = list.indexOf(item); if (k >= 0) list.splice(k, 1);
                world.remove(item.body);
            },
            clear: function () { while (list.length) api.remove(list[0]); }
        };
        return api;
    }

    var out = { tumbleParams: tumbleParams, create: create };
    if (typeof module !== 'undefined' && module.exports) module.exports = out;
    else root.StageBodies = out;
})(typeof window !== 'undefined' ? window : this);
