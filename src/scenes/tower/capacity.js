// Letter Launcher - src/scenes/tower/capacity.js
// LLF-85 TOWER BUILD: how much load a block carries before it cracks. Pure functions (no THREE / CANNON), so the
// node tests run them directly. Data: assets/cad/block_capacity.json (tools/cad/gen/block_capacity.js, from the CAD
// masses and sections of tower_block / tower_beam). Classic <script>: declares window.TowerCapacity only.
//
//   TowerCapacity.DEFAULTS            the same numbers as block_capacity.json, used until/unless the fetch lands
//   TowerCapacity.load(url?)          fetch the json into TowerCapacity.data (idempotent), resolves the data
//   TowerCapacity.impactN(type, v)    peak force when a block of `type` lands at v m/s on a bedded stack
//   TowerCapacity.utilisation(blocks, opts) -> { byId: {id: {util, loadN, midN, impactN, areaFrac, supporters}}, groundN }
//        blocks: [{ id, type, x, y, z, w, h, d?, impactN? }]  centre position, footprint w x d (d = w), height h (metres)
//        opts:   { ground: {top, x0, x1, z0, z1} or an array of them, linked(a, b): optional predicate (are these two blocks in contact?), gapTol }
//   TowerCapacity.colour(util)        [r,g,b] 0..1, green -> yellow -> red
var TowerCapacity = (function () {
    'use strict';
    var api = {};
    api.DEFAULTS = {
        gravity: 9.80665, bedStiffnessNPerM: 5e8,
        types: {
            CONCRETE: { massKg: 9360, footprintM2: 4, capacityN: 49725000, axialStiffnessNPerM: 69230769230, areaExponent: 1, impactDuctilityFactor: 1 },
            BRICK: { massKg: 7020, footprintM2: 4, capacityN: 33150000, axialStiffnessNPerM: 27692307692, areaExponent: 1, impactDuctilityFactor: 1 },
            STEEL: { massKg: 2427.2, footprintM2: 2.89, capacityN: 5170000, axialStiffnessNPerM: 2.8e9, areaExponent: 0.5, impactDuctilityFactor: 3.317 }
        }
    };
    api.data = api.DEFAULTS;

    api.load = function (url) {
        if (api._p) return api._p;
        api._p = (typeof fetch === 'function' ? fetch(url || 'assets/cad/block_capacity.json') : Promise.reject(new Error('no fetch')))
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) { if (j && j.types) api.data = j; return api.data; })
            .catch(function (e) { try { console.warn('[TowerCapacity] using built-in capacities:', e && e.message || e); } catch (_) { } return api.data; });
        return api._p;
    };

    function T(type) { return api.data.types[type] || api.data.types.CONCRETE; }
    api.typeInfo = T;
    api.weightN = function (type) { return T(type).massKg * (api.data.gravity || 9.80665); };

    // Landing at v m/s on the stack: a rigid mass on a spring, F = v * sqrt(k_eff * m); k_eff = block column and bed in series.
    api.impactN = function (type, v) {
        var t = T(type), kb = api.data.bedStiffnessNPerM || 5e8, kc = t.axialStiffnessNPerM;
        var k = 1 / (1 / kc + 1 / kb);
        return Math.max(0, v) * Math.sqrt(k * t.massKg) / (t.impactDuctilityFactor || 1);
    };

    function ovl(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }
    function box(b) { var w = b.w / 2, d = (b.d || b.w) / 2; return { x0: b.x - w, x1: b.x + w, z0: b.z - d, z1: b.z + d, bot: b.y - b.h / 2, top: b.y + b.h / 2 }; }

    api.utilisation = function (blocks, opts) {
        opts = opts || {};
        var g = api.data.gravity || 9.80665, tol = opts.gapTol == null ? 0.12 : opts.gapTol;
        var list = blocks.map(function (b) { return { b: b, bx: box(b), carried: 0, sup: [], above: 0, aboveArea: 0 }; });
        list.sort(function (p, q) { return q.bx.bot - p.bx.bot; });                  // highest first
        var out = { byId: {}, groundN: 0 }, i, j;
        var byIdx = {}; list.forEach(function (e, n) { byIdx[e.b.id] = n; });
        // supporters: blocks whose top is within tol of this block's bottom and whose footprint overlaps; or the ground
        list.forEach(function (e) {
            var ar = [], tot = 0, a;
            list.forEach(function (o) {
                if (o === e) return;
                if (Math.abs(o.bx.top - e.bx.bot) > tol || o.bx.bot >= e.bx.bot) return;
                if (opts.linked && !opts.linked(e.b, o.b)) return;
                a = ovl(e.bx.x0, e.bx.x1, o.bx.x0, o.bx.x1) * ovl(e.bx.z0, e.bx.z1, o.bx.z0, o.bx.z1);
                if (a > 1e-4) { ar.push({ o: o, a: a }); tot += a; }
            });
            [].concat(opts.ground || []).forEach(function (gd) {
                if (Math.abs(e.bx.bot - gd.top) > tol) return;
                a = ovl(e.bx.x0, e.bx.x1, gd.x0, gd.x1) * ovl(e.bx.z0, e.bx.z1, gd.z0, gd.z1);
                if (a > 1e-4) { ar.push({ o: null, a: a }); tot += a; }
            });
            e.sup = ar; e.supArea = tot;
        });
        // load flows down: each block passes (own weight + what it carries + impact) to its supporters in proportion to overlap
        list.forEach(function (e) {
            var t = T(e.b.type), own = api.weightN(e.b.type), imp = e.b.impactN || 0;
            e.own = own; e.impact = imp;
            e.total = own + e.carried + imp;
            e.mid = e.carried + own / 2 + imp;
            e.sup.forEach(function (s) {
                var share = e.total * (s.a / e.supArea);
                if (s.o) { s.o.carried += share; s.o.above += 1; s.o.aboveArea += s.a; } else out.groundN += share;
            });
        });
        list.forEach(function (e) {
            var t = T(e.b.type), fp = (e.b.w * (e.b.d || e.b.w)) || t.footprintM2;
            var fBot = e.supArea > 0 ? Math.min(1, e.supArea / fp) : 0;
            var fTop = e.above > 0 ? Math.min(1, e.aboveArea / fp) : 1;
            var f = Math.max(0.02, Math.min(fBot, fTop));
            var cap = t.capacityN * Math.pow(f, t.areaExponent == null ? 1 : t.areaExponent);
            out.byId[e.b.id] = { id: e.b.id, type: e.b.type, util: e.mid / cap, loadN: e.total, midN: e.mid, impactN: e.impact, capacityN: cap, areaFrac: f,
                supporters: e.sup.map(function (s) { return s.o ? s.o.b.id : 'GROUND'; }) };
        });
        return out;
    };

    api.colour = function (u) {
        u = Math.max(0, Math.min(1, u));
        if (u < 0.5) { var k = u / 0.5; return [0.15 + 0.80 * k, 0.75 + 0.1 * k, 0.2 * (1 - k)]; }   // green -> yellow
        var m = (u - 0.5) / 0.5; return [0.95, 0.85 * (1 - m) + 0.1 * m, 0.05 * m];                   // yellow -> red
    };
    return api;
})();
if (typeof window !== 'undefined') window.TowerCapacity = TowerCapacity;
if (typeof module !== 'undefined' && module.exports) module.exports = TowerCapacity;
