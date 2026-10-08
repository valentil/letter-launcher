// Letter Launcher — src/scenes/waterworks/network.js (LLF-84)
// Pure hydraulic network solver (no THREE, no DOM; node-testable). Classic <script> in the
// browser (window.WaterNet), CommonJS in node tests.
//
// Model: nodes joined by edges. Head H (m) = elevation + pressure head. Fixed-head nodes
// (tank, sump, open-air outlets) are tied to a virtual ground node G by pseudo-edges, so
// reservoirs become ordinary loops and plain Hardy-Cross applies:
//   head change across an edge  f(Q) = H_from - H_to
//   pipe  : f = sign(Q) * ( r |Q|^1.852 + kq Q^2 )       r = Hazen-Williams, kq = K/(2 g A^2)
//   pump  : f = -(h0 - a Q^2) for Q >= 0, check valve (stiff) for Q < 0
//   valve : an opening in (0..1] becomes a minor-loss K on the pipe; <= 0.02 closes the edge.
// Solve = Hardy-Cross sweeps over the fundamental loops of a spanning tree, run when a valve
// toggles (never per frame). Units: metres, m^3/s (the game shows L/s).
(function (root) {
    'use strict';
    var G = 9.81;
    var CLOSED_BELOW = 0.02;

    function hwR(len, d, C) { return len > 0 ? 10.67 * len / (Math.pow(C, 1.852) * Math.pow(d, 4.87)) : 0; }
    // Gate valve minor-loss coefficient vs opening (1 = fully open). Game-tuned, monotone.
    function valveK(opening) {
        var o = Math.max(CLOSED_BELOW, Math.min(1, opening));
        return 0.15 + 12 * (1 - o) * (1 - o);
    }

    function create(def) {
        var nodeIds = [], nodeIndex = {};
        def.nodes.forEach(function (n) { nodeIndex[n.id] = nodeIds.length; nodeIds.push(n.id); });
        var nodes = def.nodes.map(function (n) {
            return { id: n.id, fixed: n.head != null ? +n.head : null, elev: n.elev || 0, demand: n.demand || 0 };
        });
        var edges = def.edges.map(function (e) {
            var d = e.diameter || 0.08;
            return {
                id: e.id, from: nodeIndex[e.from], to: nodeIndex[e.to], type: e.type || 'pipe',
                length: e.length || 0, diameter: d, C: e.C || 130, K: e.K || 0,
                opening: e.opening == null ? null : e.opening,   // null = no valve on this edge
                pump: e.pump || null, on: e.on !== false
            };
        });
        var edgeIndex = {};
        edges.forEach(function (e, i) { edgeIndex[e.id] = i; });
        var last = null;

        function isOpen(e) {
            if (e.type === 'pump') return e.on;
            return e.opening == null || e.opening > CLOSED_BELOW;
        }
        function coeffs(e) {
            var A = Math.PI * e.diameter * e.diameter / 4;
            var K = e.K + (e.opening == null ? 0 : valveK(e.opening));
            return { r: hwR(e.length, e.diameter, e.C), kq: K / (2 * G * A * A) };
        }

        function solve(opts) {
            opts = opts || {};
            var tol = opts.tol || 1e-7, maxIter = opts.maxIter || 200;
            var n = nodes.length, GN = n;           // ground node index
            // active edge list: real open edges + pseudo edges ground->fixed node
            var act = [];
            edges.forEach(function (e, i) {
                if (isOpen(e)) act.push({ from: e.from, to: e.to, real: i, c: coeffs(e), e: e });
            });
            nodes.forEach(function (nd, i) {
                if (nd.fixed != null) act.push({ from: GN, to: i, real: -1, head: nd.fixed });
            });
            var sumD = 0; nodes.forEach(function (nd) { sumD += nd.demand; });
            var dem = nodes.map(function (nd) { return nd.demand; }); dem.push(-sumD);

            // spanning tree from ground (BFS)
            var adj = []; for (var i = 0; i <= n; i++) adj.push([]);
            act.forEach(function (a, k) { adj[a.from].push([a.to, k]); adj[a.to].push([a.from, k]); });
            var parent = new Array(n + 1).fill(-1), parentEdge = new Array(n + 1).fill(-1);
            var depth = new Array(n + 1).fill(-1), order = [GN], inTree = {};
            depth[GN] = 0;
            for (var q = 0; q < order.length; q++) {
                var u = order[q];
                adj[u].forEach(function (p) {
                    if (depth[p[0]] < 0) { depth[p[0]] = depth[u] + 1; parent[p[0]] = u; parentEdge[p[0]] = p[1]; inTree[p[1]] = true; order.push(p[0]); }
                });
            }
            var Q = new Array(act.length).fill(0);
            // initial continuity-satisfying flows on the tree (leaves up)
            var sub = dem.slice();
            for (var oi = order.length - 1; oi > 0; oi--) {
                var v = order[oi], k = parentEdge[v], a = act[k];
                Q[k] = a.from === parent[v] ? sub[v] : -sub[v];
                sub[parent[v]] += sub[v];
            }
            // fundamental loops from non-tree edges
            var loops = [];
            act.forEach(function (a, k) {
                if (inTree[k] || depth[a.from] < 0 || depth[a.to] < 0) return;
                var members = [[k, 1]];
                var x = a.to, y = a.from, up = [], down = [];
                while (x !== y) {
                    if (depth[x] >= depth[y]) { up.push([parentEdge[x], act[parentEdge[x]].from === x ? 1 : -1]); x = parent[x]; }
                    else { down.push([parentEdge[y], act[parentEdge[y]].from === parent[y] ? 1 : -1]); y = parent[y]; }
                }
                loops.push(members.concat(up, down.reverse()));
            });
            function f(a, q) {
                if (a.real < 0) return -a.head;
                if (a.e.type === 'pump') {
                    var p = a.e.pump;
                    return q >= 0 ? -(p.h0 - p.a * q * q) : -p.h0 + 1e5 * q;
                }
                var m = Math.abs(q);
                return (q < 0 ? -1 : 1) * (a.c.r * Math.pow(m, 1.852) + a.c.kq * m * m);
            }
            function df(a, q) {
                if (a.real < 0) return 0;
                var m = Math.max(Math.abs(q), 1e-4);
                if (a.e.type === 'pump') return q >= 0 ? 2 * a.e.pump.a * m : 1e5;
                return 1.852 * a.c.r * Math.pow(m, 0.852) + 2 * a.c.kq * m;
            }
            var iter = 0, maxD = Infinity;
            while (iter < maxIter && maxD > tol) {
                maxD = 0; iter++;
                for (var li = 0; li < loops.length; li++) {
                    var L = loops[li], num = 0, den = 0;
                    for (var mi = 0; mi < L.length; mi++) {
                        var kk = L[mi][0], sg = L[mi][1];
                        num += sg * f(act[kk], Q[kk]); den += df(act[kk], Q[kk]);
                    }
                    if (den <= 0) continue;
                    var dq = -num / den;
                    for (mi = 0; mi < L.length; mi++) Q[L[mi][0]] += L[mi][1] * dq;
                    if (Math.abs(dq) > maxD) maxD = Math.abs(dq);
                }
                if (!loops.length) break;
            }
            // heads from the tree
            var H = new Array(n + 1).fill(null); H[GN] = 0;
            for (oi = 1; oi < order.length; oi++) {
                v = order[oi]; k = parentEdge[v]; a = act[k];
                var fv = f(a, Q[k]);
                H[v] = a.from === parent[v] ? H[parent[v]] - fv : H[parent[v]] + fv;
            }
            var flows = {}, heads = {}, inflow = {};
            edges.forEach(function (e) { flows[e.id] = 0; });
            nodes.forEach(function (nd) { inflow[nd.id] = 0; });
            act.forEach(function (a, k) {
                if (a.real < 0) return;
                flows[a.e.id] = Q[k];
                inflow[nodes[a.to].id] += Q[k]; inflow[nodes[a.from].id] -= Q[k];
            });
            nodes.forEach(function (nd, i) { heads[nd.id] = H[i]; });
            last = { flows: flows, heads: heads, inflow: inflow, iterations: iter, converged: maxD <= tol, residual: maxD };
            return last;
        }

        var api = {
            nodes: nodes, edges: edges, solve: solve,
            edge: function (id) { return edges[edgeIndex[id]]; },
            setOpening: function (id, o) { var e = edges[edgeIndex[id]]; if (e) e.opening = Math.max(0, Math.min(1, o)); return api; },
            setPump: function (id, on) { var e = edges[edgeIndex[id]]; if (e) e.on = !!on; return api; },
            result: function () { return last; },
            // net water arriving at a node (m^3/s); for an open-air outlet this is what is delivered
            delivered: function (id) { return last ? Math.max(0, last.inflow[id] || 0) : 0; },
            // pressure head above the node's own elevation (m)
            pressure: function (id) {
                if (!last) return 0;
                var nd = nodes[nodeIndex[id]], h = last.heads[id];
                return h == null ? 0 : Math.max(0, h - nd.elev);
            }
        };
        return api;
    }

    // ---- Flow-target puzzle stages (levels 2 and 3 of WATERWORKS) ------------------------
    // Level 1 is the original bucket path puzzle in waterworks.js. Each stage lists the valves
    // the player can set (discrete gate positions) and the fountain flows that must be met.
    var STEPS = [0, 0.25, 0.5, 1];
    var SUPPLY_HEAD = 14;
    var STAGES = [
        {
            id: 'FOUNTAIN-1', title: 'LEVEL 2 — FOUNTAIN FLOW',
            blurb: 'Deliver enough water to the fountain through two parallel mains.',
            nodes: [{ id: 'TANK', head: SUPPLY_HEAD, elev: 12 }, { id: 'J1', elev: 1 }, { id: 'J2', elev: 1 }, { id: 'FOUNT', head: 1.5, elev: 1.5 }],
            edges: [
                { id: 'feed', from: 'TANK', to: 'J1', length: 14, diameter: 0.08 },
                { id: 'mainA', from: 'J1', to: 'J2', length: 22, diameter: 0.05, opening: 0 },
                { id: 'mainB', from: 'J1', to: 'J2', length: 16, diameter: 0.08, opening: 0 },
                { id: 'nozzle', from: 'J2', to: 'FOUNT', length: 3, diameter: 0.065, K: 1.2 }
            ],
            valves: ['mainA', 'mainB'], gauge: 'J2',
            goals: [{ node: 'FOUNT', minLps: 23.6, label: 'FOUNTAIN' }]
        },
        {
            id: 'FOUNTAIN-2', title: 'LEVEL 3 — TWO FOUNTAINS',
            blurb: 'The pump feeds two fountains and a return line. Share the flow so both reach their targets.',
            nodes: [{ id: 'SUMP', head: 0, elev: 0 }, { id: 'J1', elev: 0.5 }, { id: 'J2', elev: 0.5 },
                    { id: 'FOUNT1', head: 1.5, elev: 1.5 }, { id: 'FOUNT2', head: 1.5, elev: 1.5 }],
            edges: [
                { id: 'pump', from: 'SUMP', to: 'J1', type: 'pump', pump: { h0: 22, a: 9000 } },
                { id: 'trunk', from: 'J1', to: 'J2', length: 10, diameter: 0.08 },
                { id: 'br1', from: 'J2', to: 'FOUNT1', length: 18, diameter: 0.05, K: 1.2, opening: 0 },
                { id: 'br2', from: 'J2', to: 'FOUNT2', length: 6, diameter: 0.05, K: 1.2, opening: 0 },
                { id: 'bypass', from: 'J1', to: 'SUMP', length: 4, diameter: 0.065, opening: 1 }
            ],
            valves: ['br1', 'br2', 'bypass'], pump: 'pump', gauge: 'J2',
            goals: [{ node: 'FOUNT1', minLps: 8.5, label: 'FOUNTAIN 1' }, { node: 'FOUNT2', minLps: 9.5, label: 'FOUNTAIN 2' }]
        }
    ];

    function build(stage) { return create({ nodes: stage.nodes, edges: stage.edges }); }
    function goalsMet(net, stage) {
        return stage.goals.every(function (g) { return net.delivered(g.node) * 1000 >= g.minLps; });
    }
    // Brute-force every valve/pump setting; returns the winning combos (for tests + hints).
    function solutions(stage) {
        var net = build(stage), out = [], vs = stage.valves;
        var pumpOpts = stage.pump ? [false, true] : [true];
        (function rec(i, cur) {
            if (i === vs.length) {
                pumpOpts.forEach(function (pon) {
                    vs.forEach(function (v, j) { net.setOpening(v, cur[j]); });
                    if (stage.pump) net.setPump(stage.pump, pon);
                    net.solve();
                    if (goalsMet(net, stage)) out.push({ openings: cur.slice(), pump: pon });
                });
                return;
            }
            STEPS.forEach(function (s) { cur[i] = s; rec(i + 1, cur); });
        })(0, []);
        return out;
    }

    var api = { create: create, hwR: hwR, valveK: valveK, STAGES: STAGES, STEPS: STEPS, build: build,
                goalsMet: goalsMet, solutions: solutions, GRAVITY: G };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.WaterNet = api;
    else if (root) root.WaterNet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
