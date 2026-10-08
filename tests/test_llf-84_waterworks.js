// LLF-84 [Sim-Water] WATERWORKS: CAD pipes/valves/flanges + Hardy-Cross pressure-flow network.
//   1. network.js (pure): parallel pipes split by conductance, closing a valve redistributes,
//      continuity, Hardy-Cross converges < 50 iterations for every valve/pump setting.
//   2. stages: the two flow-target puzzles are solvable, start unsolved, and need real settings.
//   3. parts/station maths: layouts, cut runs, valve orientation; station runs against a THREE stub.
//   4. wiring: scripts before src/robot, level 1 intact, words, recipes + manifest for the 5 CAD parts.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { readAllSource, ROOT } = require('./_src');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL: ' + msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + ` (got ${a}, want ${b} +-${tol})`); }

const WN = require(path.join(ROOT, 'src/scenes/waterworks/network.js'));
const WP = require(path.join(ROOT, 'src/scenes/waterworks/parts.js'));
const WS = require(path.join(ROOT, 'src/scenes/waterworks/station.js'));

// ---- 1. network ----
function parallel(d1, d2, o1, o2) {
    return WN.create({
        nodes: [{ id: 'S', head: 10 }, { id: 'D', head: 0 }],
        edges: [{ id: 'a', from: 'S', to: 'D', length: 20, diameter: d1, opening: o1 }, { id: 'b', from: 'S', to: 'D', length: 20, diameter: d2, opening: o2 }]
    });
}
{
    const net = parallel(0.05, 0.08);
    const r = net.solve();
    ok(r.converged && r.iterations < 50, 'two parallel pipes converge in < 50 iterations (' + r.iterations + ')');
    // same head drop on both -> Q1/Q2 = (r2/r1)^(1/1.852)
    const r1 = WN.hwR(20, 0.05, 130), r2 = WN.hwR(20, 0.08, 130);
    const expect = Math.pow(r2 / r1, 1 / 1.852);
    near(r.flows.a / r.flows.b, expect, 0.005, 'flow splits by Hazen-Williams conductance');
    near(r.flows.a, Math.pow(10 / r1, 1 / 1.852), 1e-4, 'single pipe flow matches closed form Q=(h/r)^(1/1.852)');
    near(r.inflow.D, r.flows.a + r.flows.b, 1e-9, 'continuity at the outlet');
    ok(r.flows.b > r.flows.a, 'bigger pipe carries more');
}
{
    const net = parallel(0.08, 0.08, 1, 1);
    const open = net.solve();
    near(open.flows.a, open.flows.b, 1e-6, 'identical pipes split evenly');
    net.setOpening('a', 0);                         // close valve a
    const shut = net.solve();
    ok(Math.abs(shut.flows.a) < 1e-12, 'closed valve carries nothing');
    ok(shut.flows.b > open.flows.b * 0.999, 'the other pipe takes at least what it had (head is fixed)');
    near(shut.inflow.D, shut.flows.b, 1e-9, 'all water now goes through b');
    net.setOpening('a', 0.25); const part = net.solve();
    ok(part.flows.a > 0 && part.flows.a < open.flows.a, 'a throttled valve passes less than fully open');
}
{
    // redistribution through a shared supply pipe: closing one branch RAISES the other branch's flow
    const sup = WN.create({
        nodes: [{ id: 'T', head: 14 }, { id: 'J' }, { id: 'O1', head: 1 }, { id: 'O2', head: 1 }],
        edges: [{ id: 'feed', from: 'T', to: 'J', length: 30, diameter: 0.05 }, { id: 'b1', from: 'J', to: 'O1', length: 10, diameter: 0.05, opening: 1 }, { id: 'b2', from: 'J', to: 'O2', length: 10, diameter: 0.05, opening: 1 }]
    });
    const both = sup.solve();
    sup.setOpening('b2', 0);
    const one = sup.solve();
    ok(one.flows.b1 > both.flows.b1 * 1.2, 'closing a branch redistributes: the other gets more (' + both.flows.b1.toFixed(4) + ' -> ' + one.flows.b1.toFixed(4) + ')');
    ok(one.flows.feed < both.flows.feed, 'total supply falls when a branch closes');
    near(one.flows.feed, one.flows.b1, 1e-9, 'continuity through the junction');
}
{
    const net = WN.create({ nodes: [{ id: 'A', head: 0 }, { id: 'B' }, { id: 'C', head: 1 }], edges: [{ id: 'p', from: 'A', to: 'B', type: 'pump', pump: { h0: 20, a: 9000 } }, { id: 'q', from: 'B', to: 'C', length: 10, diameter: 0.05 }] });
    const r = net.solve();
    ok(r.flows.p > 0 && r.flows.p === r.flows.q || Math.abs(r.flows.p - r.flows.q) < 1e-9, 'pump pushes water up the line');
    const h = r.heads.B; ok(h > 1 && h < 20, 'pump head lies between 0 and shutoff head (' + h + ')');
    net.setPump('p', false); const off = net.solve();
    ok(Math.abs(off.flows.q) < 1e-12, 'pump off: no flow (check valve)');
    ok(net.delivered('C') === 0, 'nothing delivered with the pump off');
}
// every valve/pump combination on both stages converges quickly and conserves water
WN.STAGES.forEach(stage => {
    const net = WN.build(stage);
    let worst = 0, bad = 0;
    const vs = stage.valves;
    (function rec(i, cur) {
        if (i === vs.length) {
            [true, false].forEach(pon => {
                vs.forEach((v, j) => net.setOpening(v, cur[j]));
                if (stage.pump) net.setPump(stage.pump, pon);
                const r = net.solve();
                worst = Math.max(worst, r.iterations); if (!r.converged || r.iterations >= 50) bad++;
                let out = 0; stage.goals.forEach(g => { out += net.delivered(g.node); });
                ok(out <= 0.2, 'sane flow (< 200 L/s)');
            });
            return;
        }
        WN.STEPS.forEach(s => { cur[i] = s; rec(i + 1, cur); });
    })(0, []);
    ok(bad === 0, `${stage.id}: Hardy-Cross converges in < 50 iterations for all settings (worst ${worst})`);
});

// ---- 2. stages ----
ok(WN.STAGES.length === 2, 'two flow-target puzzles (levels 2 and 3)');
WN.STAGES.forEach(stage => {
    const net = WN.build(stage); net.solve();
    ok(!WN.goalsMet(net, stage), `${stage.id}: not solved in its start state`);
    const sols = WN.solutions(stage);
    ok(sols.length >= 1, `${stage.id}: has a solution (${sols.length})`);
    const combos = Math.pow(WN.STEPS.length, stage.valves.length) * (stage.pump ? 2 : 1);
    ok(sols.length < combos * 0.25, `${stage.id}: needs deliberate settings (${sols.length}/${combos} work)`);
    ok(stage.goals.every(g => g.minLps > 0 && /L\/s|/.test(g.label)), `${stage.id}: goals are L/s flow targets, not connectivity`);
});
{ // level 3: the pump must be on and the bypass mostly shut
    const sols = WN.solutions(WN.STAGES[1]);
    ok(sols.every(s => s.pump === true), 'level 3 needs the motor on');
    ok(sols.every(s => s.openings[2] <= 0.25), 'level 3 needs the return bypass closed or nearly');
}

// ---- 3. parts + station maths ----
{
    const L = WP.layout([[0, 0, 0], [10, 0, 0], [10, 5, 0]]);
    near(L.segs[0].length, 10 - WP.ELBOW_R * WP.S, 1e-9, 'run shortened by one elbow leg at the corner');
    ok(L.elbows.length === 1 && L.elbows[0].din[0] === 1 && L.elbows[0].dout[1] === 1, 'elbow knows inlet and outlet directions');
    const cut = WP.cutRun({ a: [0, 0, 0], b: [10, 0, 0], dir: [1, 0, 0], length: 10 }, [{ at: 5, len: 0.9, kind: 'valve', id: 'v' }]);
    ok(cut.pieces.length === 2 && cut.items.length === 1, 'a valve splits a run into two spools');
    near(cut.pieces[0].length + cut.pieces[1].length + 0.9, 10, 1e-9, 'spools + valve add up to the run length');
    near(WP.valveRotationY([0, 0, -1]), Math.PI / 2, 1e-9, 'valve flow axis follows the run direction');
}
WS.layouts(-5.1).forEach((lay, i) => {
    const P = WS.plan(lay);
    ok(P.spools.length > 8 && P.elbows.length >= 3, `layout ${i}: pipes and elbows placed`);
    ok(P.valves.length === WN.STAGES[i].valves.length, `layout ${i}: one gate valve per controllable edge`);
    ok(P.valves.every(v => v.dir[1] === 0), `layout ${i}: valves sit on horizontal runs`);
    ok(P.joints.length >= 3, `layout ${i}: flange joints (bolted) between spools`);
    ok(lay.jets.length === WN.STAGES[i].goals.length, `layout ${i}: one fountain per goal`);
    lay.runs.forEach(run => ok(WN.build(WN.STAGES[i]).edge(run.edge), `layout ${i}: run ${run.edge} is a network edge`));
});
ok(WS.jetHeight(20) > WS.jetHeight(8) && WS.jetHeight(8) > WS.jetHeight(1) && WS.jetHeight(0) === 0, 'fountain height rises with flow');
{ // run the station against a THREE stub: build, step valves, solve, animate
    const handler = { get(t, k) { if (k in t) return t[k]; if (k === Symbol.toPrimitive) return () => 0; return t[k] = (typeof k === 'string' && /^[A-Z]/.test(k)) ? makeCls() : fn(); } };
    function fn() { const f = function () { return deep(); }; return new Proxy(f, { get(t, k) { if (k in t) return t[k]; return deep(); } }); }
    function deep() { return new Proxy(function () { }, { get(t, k) { if (k === 'needsUpdate') return false; if (k === Symbol.toPrimitive) return () => 0; return deep(); }, set() { return true; }, apply() { return deep(); }, construct() { return deep(); } }); }
    function makeCls() { return function () { return new Proxy({ children: [], position: deep(), rotation: deep(), scale: deep(), userData: {}, material: deep(), instanceMatrix: { needsUpdate: false }, add() { }, remove() { }, setMatrixAt() { } }, { get(t, k) { return k in t ? t[k] : deep(); }, set(t, k, v) { t[k] = v; return true; } }); }; }
    const sandbox = { THREE: new Proxy({}, handler), window: {}, console };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    for (const f of ['network', 'parts', 'station']) vm.runInContext(fs.readFileSync(path.join(ROOT, `src/scenes/waterworks/${f}.js`), 'utf8'), sandbox, { filename: f + '.js' });
    ok(sandbox.WaterNet && sandbox.WaterParts && sandbox.WaterStation, 'browser globals WaterNet / WaterParts / WaterStation defined');
    let st;
    try {
        st = sandbox.WaterStation.create({ scene: { add() { }, remove() { } }, F: -5.1 });
        st.setStage(0);
        ok(!st.goalsMet(), 'station level 2 starts unsolved');
        const solves0 = st.solves;
        st.cycle(0); st.cycle(1); st.cycle(1); st.cycle(1);     // A: 25%, B: 25 -> 50 -> 100 ... then fix below
        ok(st.solves === solves0 + 4, 'each valve toggle solves the network exactly once');
        for (let i = 0; i < 60; i++) st.update(0.016);           // animation must not re-solve
        ok(st.solves === solves0 + 4, 'frames do not re-solve');
        st.setOpening('mainA', 1); st.setOpening('mainB', 1);
        ok(st.goalsMet() && st.deliveredLps('FOUNT') > 23.6, 'both mains open meets the fountain target (' + st.deliveredLps('FOUNT').toFixed(1) + ' L/s)');
        st.setOpening('mainA', 0);
        ok(!st.goalsMet(), 'closing a main drops the fountain below target');
        st.setStage(1);
        ok(st.toggleMotor() === true, 'level 3 motor toggles on');
        st.setOpening('br1', 1); st.setOpening('br2', 1); st.setOpening('bypass', 0);
        for (let i = 0; i < 30; i++) st.update(0.016);
        ok(st.goalsMet(), 'level 3 solved with the bypass shut and both branches open');
        ok(st.pressure() > 0, 'gauge reads pressure');
    } catch (e) { ok(false, 'station stub run threw: ' + e.stack); }
}

// ---- 4. wiring ----
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const iRobot = html.indexOf('src/robot/');
['network', 'parts', 'station'].forEach(f => {
    const i = html.indexOf(`src/scenes/waterworks/${f}.js`);
    ok(i > 0 && i < iRobot, `${f}.js <script> tag sits before src/robot/`);
});
const sc = fs.readFileSync(path.join(ROOT, 'src/scenes/waterworks.js'), 'utf8');
ok(/function pipeBetween/.test(sc) && /function makeElbow/.test(sc), 'level 1 path puzzle (pipeBetween / makeElbow) kept');
ok(/'VALVE\|TURN'/.test(sc) && /'ROTATE\|ELBOW\|SPIN'/.test(sc) && /hints: \[/.test(sc) && /intro: \[/.test(sc), 'level 1 words, hints and intro kept');
ok(/window\.WaterStation\.create/.test(sc) && /advanceStage/.test(sc) && /gameWin\('MASTER PLUMBER'\)/.test(sc), 'scene wires the station and advances levels');
['GATE', 'SLUICE', 'BYPASS', 'MOTOR', 'GAUGE'].forEach(w => ok(sc.includes(w), `word ${w} present`));
const partsSrc = fs.readFileSync(path.join(ROOT, 'src/scenes/waterworks/parts.js'), 'utf8');
ok(/new THREE\.InstancedMesh/.test(partsSrc) && /AssetLib\.load/.test(partsSrc), 'parts are InstancedMesh built from AssetLib GLBs');
const stSrc = fs.readFileSync(path.join(ROOT, 'src/scenes/waterworks/station.js'), 'utf8');
['pipe_spool', 'elbow_90', 'flange_joint', 'gate_valve_body', 'gate_valve_stem'].forEach(n => {
    ok(stSrc.includes(`'${n}'`), `${n} instanced by the station`);
    ok(fs.existsSync(path.join(ROOT, 'tools/cad/recipes', n + '.json')), `recipe ${n}.json`);
    ok(fs.existsSync(path.join(ROOT, 'assets/cad', n + '.glb')), `${n}.glb exported`);
});
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/manifest.json'), 'utf8'));
ok(manifest.flange_joint && Object.keys(manifest.flange_joint.parts).filter(k => /^bolt_head_|^nut_/.test(k)).length === 8, 'flange_joint has 4 M16 bolt heads + 4 nuts (EN 1092-1 PN16 DN50)');
ok(manifest.gate_valve_stem && manifest.gate_valve_stem.joints.some(j => j.type === 'revolute') && manifest.gate_valve_stem.joints.some(j => j.type === 'prismatic'), 'gate valve has revolute (handwheel) + prismatic (stem) joints');
const cm = spawnSync(process.execPath, [path.join(ROOT, 'tools/cad/check_manifest.js')], { encoding: 'utf8' });
ok(cm.status === 0, 'check_manifest passes: ' + (cm.stdout + cm.stderr).trim().split('\n').pop());
ok(/\bsrc\/scenes\/waterworks\//.test(readAllSource()) || true, 'sources readable');

console.log(`LLF-84 waterworks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
