// Letter Launcher — src/scenes/robot_factory.js (LLF-78 [Robot-5])
// Scene "ROBOT FACTORY" (level) + "ROBOT SANDBOX": constraint-solved robots typeset signs from a bin of letters.
//   Type an order from the board (OPEN, SALE, EXIT, PIZZA, WELCOMEHOME) -> RobotPlanner (CSP) assigns glyphs, arms,
//   grasps and times -> RobotMotion drives the two pedestal arms (IK, guarded transits, grasp physics) -> the glyphs
//   stand in the type tray -> the conveyor ships the sign. Finite Scrabble stock, buried / face-down letters,
//   vacuum JAMs and a forklift crossing the light curtain are the puzzle; SHAKE, REFILL, RESET, SWAP, FAST/SLOW,
//   STOP/GO are the levers. PLAN shows the solver: per-arm Gantt strip, reach shells, chosen glyph -> slot lines,
//   solver stats. Shifts 2 and 3 unlock with a shift-1 star (Progress.isUnlocked('ROBOT FACTORY', n)).
// Physics + robots live in src/scenes/robot_factory/cell.js (engine-free, node-tested); the set in stage.js; the
// layout table in layout.js. Per-frame work runs in the level's update(); input/frame hooks via LLHooks (HOOKS.md).
// Classic <script>: shares top-level globals (scene, setGameMode, ...) with the other src/ files.

var RobotFactory = (function () {
    'use strict';
    var NAME = 'ROBOT FACTORY', SANDBOX = 'ROBOT SANDBOX';
    var SHIFTS = [
        { orders: ['OPEN', 'SALE', 'EXIT', 'PIZZA', 'WELCOME HOME'], clock: 240 },
        { orders: ['TAXI', 'HOTEL', 'JAZZ', 'BAKERY', 'NO PARKING'], clock: 240 },
        { orders: ['QUIZ', 'VIDEO', 'BOXING', 'EXPRESS', 'WAFFLE HOUSE'], clock: 270 }
    ];
    var START_STOCK = 40;                          // glyphs poured at shift start (Scrabble frequencies)
    var SUBS_STOCK = { '0': 1, '2': 2, '5': 1 };   // the number drawer: 0 for O, 2 for Z, 5 for S
    var stats = { placed: 0, orders: 0, faults: 0 };
    if (typeof window !== 'undefined') window.__llRobotStats = stats;
    var R = null;        // the running map (null when another scene is up)
    var nextShift = 1;

    function keyOf(order) { return order.replace(/ /g, ''); }
    function letterColor(ch) {
        var pal = [0xe63946, 0xf4a261, 0x2a9d8f, 0x457b9d, 0xe9c46a, 0x8ecae6, 0xff70a6, 0x70d6ff, 0x9b5de5, 0x06d6a0];
        return pal[(ch.charCodeAt(0) * 7) % pal.length];
    }

    // ---------------------------------------------------------------- glyph factory (CAD glyphs, text-box fallback)
    function glyphReady() { return typeof LetterGlyphs !== 'undefined' && LetterGlyphs.ready(); }
    function makeGlyph(ch, scale) {
        if (glyphReady() && LetterGlyphs.has(ch)) {
            var g = LetterGlyphs.create(ch, { scale: scale, color: letterColor(ch) });
            if (g) { g.mesh.material.metalness = 0.15; g.mesh.material.roughness = 0.45; return g; }
        }
        var body = new CANNON.Body({ mass: 0.35 });
        var cv = document.createElement('canvas'); cv.width = cv.height = 64;
        var c2 = cv.getContext('2d'); c2.fillStyle = '#' + letterColor(ch).toString(16).padStart(6, '0'); c2.fillRect(0, 0, 64, 64);
        c2.fillStyle = '#fff'; c2.font = 'bold 52px sans-serif'; c2.textAlign = 'center'; c2.fillText(ch, 32, 52);
        var geo = new THREE.BoxGeometry(0.8 * scale, 1 * scale, 0.4 * scale); geo.translate(0, 0.05 * scale, 0);
        var mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.5 }));
        mesh.castShadow = true;
        return { body: body, mesh: mesh };
    }
    function glyphEntry(ch) { return glyphReady() && LetterGlyphs.entry ? LetterGlyphs.entry(ch) : null; }
    function hullShapes(ch, s) { var e = glyphEntry(ch); return e ? LetterGlyphs.buildHullShapes(e, s) : null; }

    // ---------------------------------------------------------------- build
    function build(sandbox) {
        teardown();
        currentScene = sandbox ? 'robot_sandbox' : 'robot_factory';
        scene.background = new THREE.Color(0x9aa6b0);
        scene.fog = new THREE.Fog(0x9aa6b0, 14, 34);
        var root = new THREE.Group(); root.name = 'robot_factory_root'; scene.add(root);
        var shiftN = sandbox ? 0 : Math.max(1, Math.min(3, nextShift));
        if (!sandbox && typeof Progress !== 'undefined' && !Progress.isUnlocked(NAME, shiftN)) shiftN = 1;
        if (typeof Progress !== 'undefined' && Progress.flags) Progress.flags.robotFactoryMapPresent = true;
        var armMeta = typeof AssetLib !== 'undefined' && AssetLib.info ? AssetLib.info('robot_arm') : null;
        var cell = RFCell.create({
            CANNON: CANNON, seed: 1 + Math.floor(Math.random() * 1e6), parent: root, armMeta: armMeta,
            makeGlyph: makeGlyph, glyphEntry: glyphEntry, hullShapes: hullShapes, onEvent: onCellEvent
        });
        var stage = RFStage.build({ THREE: THREE, layout: RFLayout, cell: cell, root: root });
        R = {
            sandbox: !!sandbox, shift: shiftN, def: sandbox ? null : SHIFTS[shiftN - 1], root: root, cell: cell, stage: stage,
            phase: 'loading', t: 0, clock: sandbox ? 0 : SHIFTS[shiftN - 1].clock, last: performance.now(),
            orders: [], queue: [], score: 0, shipped: 0, faults: 0, subs: 0, cycles: [], log: [],
            planOn: false, ships: [], forklift: null, nextForklift: 55 + Math.random() * 25, msgs: [], boardDirty: true,
            lastPlan: null, solver: null, compose: '', composeT: 0, lightsOn: true, music: 0
        };
        stats.placed = 0; stats.orders = 0; stats.faults = 0;
        if (!sandbox) R.orders = R.def.orders.map(function (w, i) { return { word: w, key: keyOf(w), state: 'waiting', idx: i, pts: 0 }; });
        setGameMode(levelDef(sandbox));
        if (sandbox) setObjective(SANDBOX, 'Type ANY word or name and press Enter: the two robots plan it and set it in the tray. SHAKE, REFILL, PLAN, FAST, DANCE work here too.');
        else setObjective(NAME + ' · SHIFT ' + shiftN, 'Fill the five sign orders on the board before the shift clock runs out. Type an order (as one word: WELCOMEHOME) to send it to the robots. Letters are finite and get buried — the robots solve what they can; you keep them supplied and safe.');
        showBanner('SHIFT STARTING', 'pouring the letter stock into the tote…');
        targetCameraPos.set(0, RFLayout.CAMERA.pos[2], -RFLayout.CAMERA.pos[1]);
        targetCameraLookAt.set(0, RFLayout.CAMERA.look[2], -RFLayout.CAMERA.look[1]);
    }
    function teardown() {
        if (!R) return;
        try { R.cell.dispose(); } catch (e) { /* ignore */ }
        try { if (R.dom) R.dom.forEach(function (d) { if (d.parentNode) d.parentNode.removeChild(d); }); } catch (e) { /* ignore */ }
        R = null;
    }

    // ---------------------------------------------------------------- level definition (vocabulary)
    function levelDef(sandbox) {
        var adv = {
            'REFILL|HOPPER|FILL': refill,
            'SHAKE|VIBRATE|JIGGLE': shake,
            'RESET|CLEAR|FIX': reset,
            'SWAP|TOOL|CHANGE': swapTool,
            'FAST|FASTER|HURRY': function () { setSpeed(1.5); },
            'SLOW|SLOWER|CAREFUL': function () { setSpeed(0.5); },
            'NORMAL|NOMINAL': function () { setSpeed(1.0); },
            'STOP|ESTOP|HALT': estop,
            'GO|RUN|RESUME': resume,
            'PLAN|SOLVER|GANTT': togglePlan,
            'NEXT|SHIFT': function () { changeShift(+1); },
            'AGAIN|RETRY': function () { changeShift(0); }
        };
        var advancers = Object.keys(adv);
        if (!sandbox) R.orders.forEach(function (o) { adv[o.key] = function () { requestOrder(o); }; advancers.unshift(o.key); });
        var doodads = {
            'SPARK|WELD|WELDER': weld, 'OIL|GREASE': oil, 'LIGHTS|LAMP|LAMPS': lights, 'BREAK|LUNCH|VENDING': breakTime,
            'FORKLIFT': forkliftDriveBy, 'ALARM|SIREN': alarm, 'COFFEE': coffee, 'MUSIC|RADIO': music,
            'DANCE|BOOGIE': function () { armShow('dance'); }, 'WAVE': function () { armShow('wave'); }, 'HELLO': function () { armShow('hello'); }
        };
        var words = {}, k;
        for (k in adv) words[k] = adv[k];
        for (k in doodads) words[k] = doodads[k];
        return {
            name: sandbox ? SANDBOX : NAME,
            objective: "Fill the shift's five sign orders before the clock runs out.",
            intro: ["Five signs to set before the shift ends. Type an order from the board (OPEN…) and the robots solve it.", "Letters run out or get buried: SHAKE the tote, REFILL the hopper, RESET a jammed arm (red light).", "Forklift coming? STOP the cell before it breaks the light curtain. PLAN shows the solver; HELP if stuck."],
            hints: [
                { after: 25, text: "Riddle: the board lists five signs. What happens when you type one?" },
                { after: 55, text: "Nudge: type OPEN. If the robots stall, the reason shows in the panel — SHAKE unburies, REFILL brings fresh letters." },
                { after: 90, text: "Near answer: type orders as one word (WELCOMEHOME). RESET clears a JAM, GO resumes after STOP, FAST trades drops for speed." }
            ],
            advancers: advancers,
            parTimeS: 200,
            words: expandWords(words),
            update: frame
        };
    }

    // ---------------------------------------------------------------- orders
    function requestOrder(o) {
        if (!R || R.sandbox) return;
        if (R.phase === 'over') { gameMsg('The shift is over — type AGAIN to retry, or NEXT.'); return; }
        if (o.state === 'shipped') { gameMsg(o.word + ' already shipped. Next sign!'); return; }
        if (o.state === 'active' || o.state === 'queued') { gameMsg(o.word + ' is already on the line.'); return; }
        o.state = 'queued'; R.queue.push(o); R.boardDirty = true;
        gameMsg('Order ' + o.word + ' queued for the robots.');
        gameBeep(880, 0.08, 'square', 0.1);
        pumpQueue();
    }
    function pumpQueue() {
        if (!R || R.cell.current || R.phase !== 'run' || !R.queue.length) return;
        if (R.ships.some(function (s) { return s.phase < 2; })) return;   // tray still clearing
        var o = R.queue.shift();
        o.state = 'active'; o.t0 = R.t; R.boardDirty = true;
        R.cell.order(o.word, { id: o.idx, ref: o });
    }
    function sandboxSubmit(text) {
        text = String(text || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
        if (!text || !R) return;
        var ctrl = R.ctrlWords && R.ctrlWords[text.replace(/ /g, '')];
        if (ctrl) { try { ctrl(); } catch (e) { /* ignore */ } return; }
        if (R.cell.current) { R.queue.push({ word: text, key: text, state: 'queued', idx: -1 }); gameMsg(text + ' queued.'); return; }
        R.queue.push({ word: text, key: text, state: 'queued', idx: -1 });
        pumpQueue();
    }

    function onCellEvent(type, info) {
        if (!R) return;
        if (type === 'filled') {
            R.phase = 'run'; hideBanner();
            gameMsg('Shift on! ' + info.count + ' letters in the tote. Type an order from the board.', 6000);
            pumpQueue();
        } else if (type === 'plan') {
            R.lastPlan = info; R.boardDirty = true;
            if (info.unsat) {
                var why = (info.reasons || [])[0] || 'no plan';
                gameMsg('Solver: ' + why.replace(/;.*$/, '') + ' — try SHAKE or REFILL.', 7000);
            }
        } else if (type === 'placed') {
            stats.placed++; R.boardDirty = true; gameBeep(1320, 0.06, 'sine', 0.08);
        } else if (type === 'orderDone') {
            shipOrder(info.order);
        } else if (type === 'fault') {
            if (info.soft) return;
            stats.faults++; R.faults++;
            if (info.kind === 'jam') {
                gameMsg('JAM! ' + info.arm + ' dropped its ' + (info.char || 'letter') + ' — type RESET to clear the fault.', 7000);
                beeps([[440, 0.15, 0, 'sawtooth', 0.12], [330, 0.25, 180, 'sawtooth', 0.12]]);
            } else gameMsg('Fault: ' + info.kind + (info.char ? ' (' + info.char + ')' : '') + ' — the solver re-plans.', 4500);
        } else if (type === 'toolChange') {
            var i = info.arm === 'A1' ? 0 : 1, a = R.stage.arms[i];
            if (a && a.syncTool) a.syncTool();
            if (a && a.holder) puffBurst(a.holder.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xdddddd, 6, 0.3, { gravity: -0.0005, decay: 0.04, size: 0.04 });
        } else if (type === 'refill') {
            gameBeep(220, 0.4, 'square', 0.08);
        }
    }

    // ---------------------------------------------------------------- shipping (tray -> conveyor -> crate)
    function shipOrder(order) {
        var ref = order.meta && order.meta.ref;
        var res = R.cell.ship();
        if (!res) return;
        var cycle = R.t - (ref && ref.t0 != null ? ref.t0 : R.t);
        var letters = res.glyphs.length, bonus = Math.max(0, Math.round((60 - cycle) * 3));
        var pts = 100 + 20 * letters + bonus - 25 * order.subs;
        R.subs += order.subs; R.cycles.push(cycle);
        var belt = new THREE.Vector3(0, 0.93, -RFLayout.CONVEYOR.y);
        res.glyphs.forEach(function (g, k) {
            if (!g.mesh) return;
            var p0 = g.mesh.position.clone();
            var p1 = new THREE.Vector3(p0.x, 0.93 + 0.08, belt.z);
            R.ships.push({ mesh: g.mesh, p0: p0, p1: p1, t: -k * 0.05, phase: 0 });
        });
        if (!R.sandbox && ref) {
            ref.state = 'shipped'; ref.pts = pts; ref.cycle = cycle; R.score += pts; R.shipped++; stats.orders++;
            gameMsg('SHIPPED ' + order.word + ' +' + pts + ' (' + cycle.toFixed(0) + ' s' + (order.subs ? ', ' + order.subs + ' substitute' : '') + ')', 6000);
            if (R.shipped >= R.orders.length) winShift();
        } else { stats.orders++; gameMsg('Set and shipped: ' + order.word, 4000); }
        beeps([[660, 0.1, 0, 'triangle', 0.15], [880, 0.1, 110, 'triangle', 0.15], [1100, 0.18, 220, 'triangle', 0.15]]);
        R.boardDirty = true;
    }
    function updateShips(dt) {
        var C = RFLayout.CONVEYOR, cr = RFLayout.CRATE;
        R.ships = R.ships.filter(function (s) {
            s.t += dt;
            if (s.t < 0) return true;
            if (s.phase === 0) {          // lift out of the slot and over onto the belt (arc)
                var k = Math.min(1, s.t / 1.1);
                s.mesh.position.lerpVectors(s.p0, s.p1, k); s.mesh.position.y += Math.sin(k * Math.PI) * 0.35;
                if (k >= 1) { s.phase = 1; s.t = 0; }
            } else if (s.phase === 1) {   // ride the belt to the head pulley
                s.mesh.position.x += dt * 0.9;
                if (s.mesh.position.x > C.x + 1.5) { s.phase = 2; s.vy = 0; }
            } else {                      // drop into the shipping crate
                s.vy -= 9.8 * dt; s.mesh.position.y += s.vy * dt; s.mesh.position.x = Math.min(s.mesh.position.x + dt * 0.6, cr.x + 0.05);
                if (s.mesh.position.y < 0.15) { if (s.mesh.parent) s.mesh.parent.remove(s.mesh); return false; }
            }
            return true;
        });
        if (!R.ships.length || R.ships.every(function (s) { return s.phase >= 1; })) pumpQueue();
    }

    function winShift() {
        R.phase = 'won';
        var avg = R.cycles.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, R.cycles.length);
        var used = R.def.clock - R.clock;
        var stars = 1 + (used <= 180 ? 1 : 0) + (R.faults === 0 && R.subs === 0 ? 1 : 0);
        try { if (typeof Progress !== 'undefined') Progress.recordShift(NAME, R.shift, { completed: true, bestTimeS: Math.round(used), stars: stars, wordsFound: [] }); } catch (e) { /* ignore */ }
        gameWin('SHIFT ' + R.shift + ' COMPLETE');
        showBanner('★ SHIFT ' + R.shift + ' COMPLETE ★',
            'score ' + R.score + ' · orders ' + R.shipped + '/5 · avg cycle ' + avg.toFixed(1) + ' s · substitutes ' + R.subs + ' · faults ' + R.faults +
            '<br>' + '★'.repeat(stars) + '☆'.repeat(3 - stars) + (R.shift < 3 ? ' — type NEXT for shift ' + (R.shift + 1) : ' — the night shift is yours'));
    }
    function loseShift() {
        R.phase = 'over';
        R.cell.estop(true);
        showBanner('SHIFT OVER', R.shipped + '/5 signs shipped · score ' + R.score + ' — type AGAIN to retry' + (R.shift < 3 && typeof Progress !== 'undefined' && Progress.isUnlocked(NAME, R.shift + 1) ? ' or NEXT' : ''));
    }
    function changeShift(d) {
        if (!R || R.sandbox) return;
        var n = R.shift + d;
        if (n > 3) n = 1;
        if (d > 0 && typeof Progress !== 'undefined' && !Progress.isUnlocked(NAME, n)) { gameMsg('Shift ' + n + ' unlocks after a star on shift 1.'); return; }
        nextShift = n;
        buildScene(SCENES[NAME].build);
    }

    // ---------------------------------------------------------------- levers
    function refill() {
        if (!R) return;
        if (R.cell.pendingHopper) { gameMsg('The hopper is already pouring.'); return; }
        // the hopper brings what the open orders still miss, plus a fresh Scrabble handful
        var need = {}, have = R.cell.availability();
        var words = [];
        if (R.cell.current) words.push(R.cell.current.word);
        R.queue.forEach(function (q) { words.push(q.word); });
        if (!R.sandbox) R.orders.forEach(function (o) { if (o.state === 'waiting' && words.length < 3) words.push(o.word); });
        words.join('').replace(/ /g, '').split('').forEach(function (c) { need[c] = (need[c] || 0) + 1; });
        var counts = {};
        Object.keys(need).forEach(function (c) { var miss = need[c] - (have[c] || 0); if (miss > 0) counts[c] = miss + 1; });
        counts = RFCell.mergeCounts(counts, RFCell.scrabbleStock(10));
        var n = R.cell.refill(counts);
        R.cell.cancelQueued();
        gameMsg('Hopper open: ' + n + ' fresh letters pour in (arms wait while it settles).', 5000);
    }
    function shake() {
        if (!R) return;
        R.cell.shake(2.5);
        R.cell.cancelQueued();
        gameMsg('BRRRR — the tote vibrates; buried letters shuffle up. The solver re-plans.', 4500);
        beeps([[70, 0.6, 0, 'sawtooth', 0.12], [75, 0.6, 600, 'sawtooth', 0.12], [70, 0.6, 1200, 'sawtooth', 0.1]]);
    }
    function reset() {
        if (!R) return;
        if (R.forklift && R.forklift.inside) { gameMsg('Forklift still inside the cell — wait for it to back out.'); return; }
        var did = R.cell.reset();
        R.stage.curtain.setBroken(false);
        gameMsg(did ? 'Faults cleared — arms back in automatic.' : 'Nothing to reset. All green.');
    }
    function swapTool() {
        R.cell.forceToolSwap();
        R.cell.arms.forEach(function (a, i) { var s = R.stage.arms[i]; if (s && s.syncTool) s.syncTool(); });
        gameMsg('Tool change: the arms swap between vacuum cup and gripper (the solver picks again).');
    }
    function setSpeed(s) {
        var v = R.cell.setSpeed(s);
        gameMsg('Arm speed override ' + Math.round(v * 100) + '%' + (v > 1 ? ' — faster, but the vacuum drops more' : v < 1 ? ' — slow and sure' : ''));
    }
    function estop() {
        if (!R) return;
        R.cell.estop(true);
        gameMsg('EMERGENCY STOP — everything halts. Type GO to resume.', 5000);
        beeps([[300, 0.4, 0, 'square', 0.12]]);
    }
    function resume() {
        if (!R) return;
        if (R.forklift && R.forklift.inside) { gameMsg('Forklift still inside the light curtain!'); return; }
        if (R.phase === 'over') return;
        R.cell.estop(false); R.stage.curtain.setBroken(false);
        gameMsg('Resumed.');
    }
    function togglePlan() {
        R.planOn = !R.planOn;
        R.stage.overlay.visible = R.planOn;
        ensureDom();
        R.dom.forEach(function (d) { d.style.display = R.planOn ? 'block' : 'none'; });
        gameMsg(R.planOn ? 'PLAN view: Gantt per arm, reach shells, chosen letters, solver stats.' : 'PLAN view off.');
    }

    // ---------------------------------------------------------------- doodads
    function weld() {
        var st = R.stage;
        for (var i = 0; i < 6; i++) setTimeout(function () {
            if (!R) return;
            st.weldLight.intensity = 3.5;
            puffBurst(st.weldPos.clone(), function () { return Math.random() < 0.5 ? 0xffd27a : 0xffffff; }, 10, 0.25, { gravity: 0.003, decay: 0.05, size: 0.03 });
        }, i * 220);
        beeps([[2400, 0.05, 0, 'square', 0.04], [2600, 0.05, 220, 'square', 0.04], [2300, 0.05, 440, 'square', 0.04]]);
        gameMsg('The welding cell crackles blue behind the fence.');
    }
    function oil() {
        R.cell.arms.forEach(function (a, i) {
            var h = R.stage.arms[i].holder;
            puffBurst(h.position.clone().add(new THREE.Vector3(0, 0.25, 0)), 0x2b2112, 8, 0.2, { gravity: 0.002, decay: 0.03, size: 0.03 });
        });
        gameMsg('A maintenance tech oils the J2 gearboxes. The arms purr.');
    }
    function lights() {
        R.lightsOn = !R.lightsOn;
        R.stage.lamps.forEach(function (l) { if (l.isLight) l.intensity = R.lightsOn ? 1.1 : 0.25; else l.visible = R.lightsOn; });
        gameMsg(R.lightsOn ? 'High-bays back on.' : 'Lights dimmed — the andons glow in the dark.');
    }
    function breakTime() {
        var W = RFLayout.WORKER_PATH;
        for (var i = 0; i < 2; i++) {
            var man = makeBoxMan(i ? 0x2b6cb0 : 0xe67e22, 0xf2c200);
            man.scale.setScalar(0.95);
            R.root.add(man);
            (function (m, delay) {
                var t = -delay, legs = W.length - 1;
                R.walkers = R.walkers || [];
                R.walkers.push({ mesh: m, t: t, step: function (dt) {
                    t += dt; if (t < 0) { m.visible = false; return true; } m.visible = true;
                    var u = Math.min(legs, t / 2.2), k = Math.floor(Math.min(legs - 1e-6, u)), f = u - k;
                    var a = W[k], b = W[k + 1];
                    m.position.set(a[0] + (b[0] - a[0]) * f, Math.abs(Math.sin(t * 9)) * 0.04, -(a[1] + (b[1] - a[1]) * f));
                    m.rotation.y = Math.atan2(b[0] - a[0], -(b[1] - a[1])) + Math.PI;
                    if (u >= legs) { if (m.parent) m.parent.remove(m); return false; }
                    return true;
                } });
            })(man, i * 1.4);
        }
        gameMsg('Break time — two operators wander off to the vending machine.');
    }
    function forkliftDriveBy() { startForklift(false); gameMsg('A forklift beeps along the aisle. Mind the curtain…'); }
    function alarm() {
        R.alarmUntil = R.t + 3;
        beeps([[880, 0.25, 0, 'square', 0.1], [660, 0.25, 300, 'square', 0.1], [880, 0.25, 600, 'square', 0.1], [660, 0.25, 900, 'square', 0.1]]);
        gameMsg('Test alarm! (Every andon flashes red. Nobody panics. It is Tuesday.)');
    }
    function coffee() {
        puffBurst(R.stage.vendingPos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xf4f4f4, 10, 0.2, { gravity: -0.0008, decay: 0.015, size: 0.05 });
        gameMsg('Coffee for the line. Productivity +0% (morale +100%).');
    }
    function music() {
        R.music = R.t + 7;
        var notes = [523, 659, 784, 659, 587, 698, 880, 698];
        notes.forEach(function (f, i) { setTimeout(function () { gameBeep(f, 0.18, 'triangle', 0.07); }, i * 260); });
        gameMsg('The radio on the bench plays the factory jingle.');
    }
    // IK-solved arm shows (idle arms only): DANCE = both arms trace a synchronised figure-8, WAVE = a wave that
    // rolls from A1 to A2, HELLO = both arms lift and wave at the camera.
    function armShow(kind) {
        var K = RobotKin, ok = 0;
        R.cell.arms.forEach(function (a, i) {
            if (a.path || a.queue.length || a.show || R.cell.estopped) return;
            var base = a.chain.base, keys = [], DEG = Math.PI / 180;
            function tcp(fx, fy, z, tiltDeg) {
                var T = K.mul(base, K.poseFromXYZRPY(fx, fy, z, Math.PI, (tiltDeg || 0) * DEG, 0));
                var r = K.ik(T, keys.length ? keys[keys.length - 1] : a.home, {}, a.chain);
                if (r) keys.push(r.q);
            }
            if (kind === 'dance') { for (var k = 0; k <= 8; k++) { var th = k / 8 * Math.PI * 2; tcp(0.55 + 0.12 * Math.sin(th), 0.25 * Math.sin(2 * th), 0.85 + 0.15 * Math.cos(th), 15 * Math.sin(th)); } }
            else if (kind === 'wave') { for (var w = 0; w < 5; w++) tcp(0.5, 0.0, w % 2 ? 1.05 : 0.6, w % 2 ? -25 : 25); }
            else { tcp(0.35, i === 0 ? -0.35 : 0.35, 1.25, 0); for (var h = 0; h < 4; h++) { var q = keys[keys.length - 1]; if (!q) break; var q2 = q.slice(); q2[5] += (h % 2 ? -1 : 1) * 0.9; q2[3] += (h % 2 ? -1 : 1) * 0.3; keys.push(q2); } }
            if (keys.length < 2) return;
            keys.unshift(a.q.slice()); keys.push(a.home.slice());
            a.show = { keys: keys, t: kind === 'wave' ? -i * 1.1 : 0, seg: kind === 'dance' ? 0.45 : 0.5 };
            ok++;
        });
        if (!ok) { gameMsg('The arms are busy — try again when they are idle.'); return; }
        gameMsg(kind === 'dance' ? 'The arms dance — every keyframe IK-solved.' : kind === 'wave' ? 'A wave rolls down the line.' : 'Hello from cell 1!');
    }
    function updateShows(dt) {
        R.cell.arms.forEach(function (a) {
            var s = a.show; if (!s) return;
            if (a.path || R.cell.estopped) { if (a.path) a.show = null; return; }
            s.t += dt; if (s.t < 0) return;
            var u = s.t / s.seg, k = Math.floor(u), f = u - k;
            if (k >= s.keys.length - 1) { a.q = s.keys[s.keys.length - 1].slice(); a.show = null; }
            else { f = f * f * (3 - 2 * f); var A = s.keys[k], B = s.keys[k + 1]; a.q = A.map(function (v, j) { return v + (B[j] - v) * f; }); }
            if (a.rig) a.rig.setJoints(a.q);
        });
    }

    // ---------------------------------------------------------------- forklift (safety event)
    function startForklift(enter) {
        if (R.forklift) return;
        var P = enter ? RFLayout.FORKLIFT_PATH : [[-9, -3.4], [9, -3.4]];
        R.forklift = { path: P, t: 0, enter: enter, inside: false, warned: false, speed: 1.6 };
        R.stage.forklift.visible = true;
        if (enter) { gameMsg('⚠ FORKLIFT heading for the cell! Type STOP before it breaks the light curtain.', 7000); beeps([[1000, 0.12, 0, 'square', 0.1], [1000, 0.12, 400, 'square', 0.1], [1000, 0.12, 800, 'square', 0.1]]); }
    }
    function updateForklift(dt) {
        var F = R.forklift; if (!F) return;
        F.t += dt * F.speed;
        var P = F.path, d = F.t, i = 0, seg;
        for (; i < P.length - 1; i++) { seg = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); if (d <= seg) break; d -= seg; }
        if (i >= P.length - 1) { R.stage.forklift.visible = false; R.forklift = null; return; }
        var a = P[i], b = P[i + 1], f = d / seg, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        var rev = F.enter && i >= 3;                       // backing out: keep facing the cell
        var hx = rev ? a[0] - b[0] : b[0] - a[0], hy = rev ? a[1] - b[1] : b[1] - a[1];
        R.stage.forklift.position.set(x, 0, -y);
        R.stage.forklift.rotation.y = Math.atan2(hy, hx) - Math.PI / 2;
        if (Math.floor(F.t * 2) !== F.beep) { F.beep = Math.floor(F.t * 2); if (rev) gameBeep(1200, 0.08, 'square', 0.04); }
        var noseY = y + (rev ? -1 : 1) * 1.3 * (hy >= 0 ? 1 : -1);
        var inside = F.enter && Math.max(y, noseY) > RFLayout.CURTAIN_Y - 0.05 && Math.abs(x) < 2.0;
        if (inside && !F.inside) {
            F.inside = true; R.stage.curtain.setBroken(true);
            if (R.cell.estopped) gameMsg('Light curtain broken — but the cell was already stopped. Good call!', 5000);
            else {
                R.cell.estop(true); stats.faults++; R.faults++; R.score = Math.max(0, R.score - 50);
                gameMsg('SAFETY TRIP! The forklift broke the curtain with robots moving: −50 and a fault. Type GO once it has left.', 7000);
                beeps([[200, 0.5, 0, 'sawtooth', 0.15], [150, 0.6, 500, 'sawtooth', 0.15]]);
            }
        } else if (!inside && F.inside) {
            F.inside = false;
            gameMsg('Forklift clear of the cell. Type GO to resume.', 6000);
        }
    }

    // ---------------------------------------------------------------- order board (canvas texture)
    function drawBoard() {
        var b = R.stage.board, g = b.ctx, W = b.canvas.width, H = b.canvas.height;
        g.fillStyle = '#0b1218'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#f2c200'; g.fillRect(0, 0, W, 70);
        g.fillStyle = '#111'; g.font = 'bold 46px monospace'; g.textAlign = 'left';
        g.fillText(R.sandbox ? 'SANDBOX — TYPE ANYTHING' : 'ORDERS · SHIFT ' + R.shift, 24, 52);
        g.textAlign = 'right';
        if (!R.sandbox) { var c = Math.max(0, R.clock); g.fillText(Math.floor(c / 60) + ':' + ('0' + Math.floor(c % 60)).slice(-2), W - 24, 52); }
        g.textAlign = 'left';
        var list = R.sandbox ? R.queue.concat(R.cell.current ? [{ word: R.cell.current.word, state: 'active' }] : []) : R.orders;
        list.slice(0, 5).forEach(function (o, i) {
            var y = 140 + i * 82, cur = R.cell.current, n = 0, m = 0;
            if (o.state === 'active' && cur) { m = cur.slots.length; n = cur.slots.filter(function (s) { return s.state === 'set'; }).length; }
            var col = o.state === 'shipped' ? '#4cd964' : o.state === 'active' ? '#7fd7ff' : o.state === 'queued' ? '#ffd166' : '#d8dee4';
            g.fillStyle = col; g.font = 'bold 54px monospace';
            g.fillText(o.word, 30, y);
            g.font = '30px monospace'; g.textAlign = 'right';
            var tag = o.state === 'shipped' ? 'SHIPPED +' + o.pts : o.state === 'active' ? 'SETTING ' + n + '/' + m : o.state === 'queued' ? 'QUEUED' : 'type ' + o.key;
            g.fillText(tag, W - 30, y - 6); g.textAlign = 'left';
        });
        g.fillStyle = '#9fb3c8'; g.font = '28px monospace';
        g.fillText('SCORE ' + R.score + '   SHIPPED ' + R.shipped + '/5   FAULTS ' + R.faults, 30, H - 26);
        b.tex.needsUpdate = true;
    }

    // ---------------------------------------------------------------- PLAN overlay (DOM: Gantt + solver stats)
    function ensureDom() {
        if (R.dom) return;
        var gantt = document.createElement('canvas'); gantt.width = 420; gantt.height = 96; gantt.id = 'rfGantt';
        gantt.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:21;width:420px;max-width:calc(100vw - 24px);height:96px;background:rgba(8,14,20,0.82);border:1px solid #3fa9ff;border-radius:8px;display:none;pointer-events:none';
        var panel = document.createElement('div'); panel.id = 'rfSolver';
        panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:21;max-width:min(300px,calc(100vw - 24px));background:rgba(8,14,20,0.82);color:#cfe8ff;font:12px/1.35 monospace;border:1px solid #ff7ad9;border-radius:8px;padding:8px 10px;display:none;pointer-events:none;white-space:pre-wrap';
        document.body.appendChild(gantt); document.body.appendChild(panel);
        R.dom = [gantt, panel]; R.gantt = gantt; R.panel = panel;
    }
    var PHASE_COL = { 'transit-in': '#5b6b7a', transit: '#5b6b7a', approach: '#3fa9ff', close: '#3fa9ff', 'wait-pick': '#29424f', lift: '#3fa9ff',
        'wait-place': '#29424f', place: '#4cd964', open: '#4cd964', retreat: '#4cd964', park: '#3a3f44' };
    function drawPlan() {
        var c = R.cell, hub = c.hub, g = R.gantt.getContext('2d'), W = R.gantt.width, H = R.gantt.height;
        g.clearRect(0, 0, W, H);
        var t0 = hub.time - 2, span = 24, x0 = 34, sx = (W - x0 - 6) / span;
        g.font = '11px monospace'; g.fillStyle = '#9fb3c8'; g.fillText('pick', W - 150, 12); g.fillText('transit', W - 112, 12); g.fillText('place', W - 52, 12);
        g.fillStyle = '#3fa9ff'; g.fillRect(W - 160, 5, 8, 8); g.fillStyle = '#5b6b7a'; g.fillRect(W - 122, 5, 8, 8); g.fillStyle = '#4cd964'; g.fillRect(W - 62, 5, 8, 8);
        c.arms.forEach(function (a, i) {
            var y = 24 + i * 34;
            g.fillStyle = R.stage.armColors[i] === 0x3fa9ff ? '#3fa9ff' : '#ff7ad9'; g.font = 'bold 12px monospace'; g.fillText(a.id, 4, y + 15);
            g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x0, y, W - x0 - 6, 22);
            if (a.path) a.path.segments.forEach(function (s) {
                var xa = x0 + (s.t0 - t0) * sx, xb = x0 + (s.t0 + s.T - t0) * sx;
                if (xb < x0 || xa > W) return;
                g.fillStyle = PHASE_COL[s.phase] || '#777'; g.fillRect(Math.max(x0, xa), y + 2, Math.max(1, Math.min(W - 6, xb) - Math.max(x0, xa) - 1), 18);
            });
            a.queue.forEach(function (j) {     // planned jobs: pick window, transit, place window
                if (j.tPick == null) return;
                [[j.tPick - 0.6, j.tPick + 0.6, '#3fa9ff'], [j.tPick + 0.6, j.tPlace, '#5b6b7a'], [j.tPlace, j.tEnd || j.tPlace + 0.6, j.kind === 'clear' ? '#b07a3a' : '#4cd964']].forEach(function (b) {
                    var xa = x0 + (b[0] - t0) * sx, xb = x0 + (b[1] - t0) * sx; if (xb < x0 || xa > W) return;
                    g.globalAlpha = 0.55; g.fillStyle = b[2]; g.fillRect(Math.max(x0, xa), y + 5, Math.max(1, xb - Math.max(x0, xa)), 12); g.globalAlpha = 1;
                });
                g.fillStyle = '#fff'; g.font = '10px monospace'; var lx = x0 + (j.tPick - t0) * sx; if (lx > x0 && lx < W - 10) g.fillText(j.kind === 'clear' ? '×' + j.char : j.char, lx - 3, y + 15);
            });
            if (a.show) { g.fillStyle = '#ff7ad9'; g.fillText('♪ show', x0 + 4, y + 15); }
        });
        g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(x0 + 2 * sx, 18); g.lineTo(x0 + 2 * sx, H - 4); g.stroke();
        // solver panel
        var p = c.planner, st = p ? p.stats() : (R.lastPlan && R.lastPlan.result && R.lastPlan.result.stats) || null;
        var lines = ['SOLVER  ' + (p ? 'running · ' + st.phase : st ? (R.lastPlan.unsat ? 'partial' : 'solved') : 'idle')];
        if (st) {
            lines.push('iterations ' + st.iterations + '  evals ' + st.evaluations);
            lines.push('makespan ' + (isFinite(st.makespan) ? st.makespan.toFixed(1) : '–') + ' s  slices ' + st.slices + '  ' + (st.elapsedMs || 0).toFixed(0) + ' ms');
            lines.push('substitutes ' + st.substitutes + '  tool changes ' + st.toolChanges + '  zone conflicts ' + st.conflicts);
        }
        if (R.lastPlan && R.lastPlan.input) lines.push('glyphs seen ' + R.lastPlan.input.glyphs.length + ' · slots ' + R.lastPlan.input.slots.length + ' · jobs ' + R.lastPlan.jobs.length);
        if (R.lastPlan && R.lastPlan.reasons && R.lastPlan.reasons.length) lines.push('⚠ ' + R.lastPlan.reasons.slice(0, 2).join('\n⚠ '));
        lines.push('placed ' + c.stats.placed + ' · picks ' + c.stats.picks + ' · digs ' + c.stats.clears + ' · jams ' + c.stats.jams);
        var txt = lines.join('\n');
        if (R.panel._t !== txt) { R.panel._t = txt; R.panel.textContent = txt; }
        // 3D: chosen glyph -> slot lines + markers
        var jobs = [];
        c.arms.forEach(function (a) { if (a.job && a.job.kind !== 'park') jobs.push(a.job); a.queue.forEach(function (j) { jobs.push(j); }); });
        var ov = R.stage.overlay;
        while (R.stage.linePool.length < jobs.length) {
            var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
            var ln = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
            ln.renderOrder = 10; ov.add(ln);
            var mk = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
            mk.rotation.x = Math.PI / 2; mk.renderOrder = 11; ov.add(mk);
            R.stage.linePool.push({ line: ln, mark: mk });
        }
        R.stage.linePool.forEach(function (lp, i) {
            var j = jobs[i], rec = j && c.glyphs[j.glyphId];
            if (!j || !rec) { lp.line.visible = lp.mark.visible = false; return; }
            var col = j.armId === 'A1' ? 0x3fa9ff : 0xff7ad9;
            var p0 = rec.body.position, s = j.orderSlot ? j.orderSlot.slot.center : null;
            var pos = lp.line.geometry.attributes.position;
            pos.setXYZ(0, p0.x, p0.y + 0.05, p0.z);
            if (s) pos.setXYZ(1, s[0], s[2] + 0.12, -s[1]); else { var a = c.hub.arms[j.armId]; pos.setXYZ(1, a.discard.x, a.discard.z + 0.2, -a.discard.y); }
            pos.needsUpdate = true; lp.line.geometry.computeBoundingSphere();
            lp.line.material.color.setHex(j.kind === 'clear' ? 0xb07a3a : col); lp.line.visible = true;
            lp.mark.position.set(p0.x, p0.y + 0.06, p0.z); lp.mark.material.color.setHex(col); lp.mark.visible = true;
            lp.mark.scale.setScalar(1 + 0.15 * Math.sin(R.t * 6 + i));
        });
    }

    // ---------------------------------------------------------------- per-frame
    function frame() {
        if (!R) return;
        var now = performance.now(), dt = Math.min(0.5, Math.max(0, (now - R.last) / 1000)); R.last = now;
        R.t += dt;
        var cell = R.cell;
        if (R.phase === 'loading') {
            if (glyphReady() || R.t > 6) { R.phase = 'fill'; cell.startFill(RFCell.mergeCounts(RFCell.scrabbleStock(START_STOCK), SUBS_STOCK)); }
        }
        cell.step(dt);
        R.stage.update(dt);
        updateShows(dt);
        updateShips(dt);
        if (R.walkers) R.walkers = R.walkers.filter(function (w) { return w.step(dt); });
        if (R.phase === 'run' && !R.sandbox) {
            R.clock -= dt;
            if (R.clock <= 0) loseShift();
            R.nextForklift -= dt;
            if (R.nextForklift <= 0 && !R.forklift) { startForklift(true); R.nextForklift = 70 + Math.random() * 40; }
        }
        updateForklift(dt);
        // andons: green running, amber holding / waiting / e-stop, red fault (flashing)
        cell.arms.forEach(function (a, i) {
            var st = a.faulted ? 'red' : cell.estopped ? 'amber' : (a.holding || cell.holding) ? 'amber' : 'green';
            var flash = a.faulted || (R.alarmUntil && R.t < R.alarmUntil);
            R.stage.setAndon(i, R.alarmUntil && R.t < R.alarmUntil ? 'red' : st, flash || (cell.estopped && Math.floor(R.t) % 2 === 0));
        });
        if (R.music && R.t < R.music && Math.random() < 0.08) puffBurst(R.stage.radioPos.clone(), 0x7fd7ff, 1, 0.1, { gravity: -0.0012, decay: 0.02, size: 0.04 });
        R.boardT = (R.boardT || 0) + dt;
        if (R.boardDirty || R.boardT > 0.5) { R.boardT = 0; R.boardDirty = false; drawBoard(); }
        if (R.planOn && R.dom) drawPlan();
        // status line
        var cur = cell.current, line;
        if (R.phase === 'loading' || R.phase === 'fill') line = 'Shift starting — pouring letters…';
        else {
            var n = cur ? cur.slots.filter(function (s) { return s.state === 'set'; }).length : 0;
            line = (R.sandbox ? 'SANDBOX' : 'SHIFT ' + R.shift + ' · ' + Math.floor(Math.max(0, R.clock) / 60) + ':' + ('0' + Math.floor(Math.max(0, R.clock) % 60)).slice(-2)) +
                ' · score ' + R.score + ' · tray ' + (cur ? cur.word + ' ' + n + '/' + cur.slots.length : 'empty') +
                ' · tote ' + cell.bin.glyphs.length + (cell.estopped ? ' · E-STOP' : '') + (cell.speed !== 1 ? ' · speed ' + Math.round(cell.speed * 100) + '%' : '') +
                (cell.arms.some(function (a) { return a.faulted; }) ? ' · JAM (RESET)' : '') + (cell.planner ? ' · solving…' : '');
        }
        gameStatus(line);
        if (R.sandbox && R.compose && now - R.composeT > 1600) { var t = R.compose; R.compose = ''; sandboxSubmit(t); updateWordHud(); }
        targetCameraPos.set(0, RFLayout.CAMERA.pos[2], -RFLayout.CAMERA.pos[1]);
        targetCameraLookAt.set(0, RFLayout.CAMERA.look[2], -RFLayout.CAMERA.look[1]);
    }

    // ---------------------------------------------------------------- sandbox typing (anything typed is set)
    function sandboxKey(e) {
        if (!R || !R.sandbox || typeof gameMode === 'undefined' || !gameMode || gameMode.name !== SANDBOX) return false;
        if (typeof menuScreen !== 'undefined' && menuScreen !== 'PLAYING') return false;
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'Enter') { var t = R.compose; R.compose = ''; sandboxSubmit(t); hudShow(); return true; }
        if (e.key === 'Backspace') { R.compose = R.compose.slice(0, -1); hudShow(); return true; }
        if (e.key === ' ' && R.compose) { R.compose += ' '; R.composeT = performance.now(); hudShow(); return true; }
        if (/^[a-zA-Z0-9]$/.test(e.key)) {
            R.compose = (R.compose + e.key.toUpperCase()).slice(0, 12); R.composeT = performance.now();
            if (typeof playTone === 'function') try { playTone(e.key.toUpperCase(), null); } catch (er) { /* ignore */ }
            hudShow(); return true;
        }
        return false;
    }
    function hudShow() { var el = document.getElementById('wordHud'); if (el) el.innerHTML = R.compose ? R.compose.replace(/ /g, '·') : '<span class="ph">type anything, Enter to set it…</span>'; }

    function buildFactory() { build(false); }
    function buildSandbox() {
        build(true);
        var def = gameMode, map = {};
        Object.keys(def.words).forEach(function (w) { map[w] = def.words[w]; });
        R.ctrlWords = map;
        def.words = {};   // the sandbox reads the composing stick instead of the word matcher
    }

    if (typeof LLHooks !== 'undefined') {
        LLHooks.on('keydown', function (e) { return sandboxKey(e); });
        LLHooks.on('beforeSceneSwap', function () { teardown(); });
    }

    return { buildFactory: buildFactory, buildSandbox: buildSandbox, SHIFTS: SHIFTS, stats: stats, keyOf: keyOf,
        get running() { return R; } };
})();

SCENES['ROBOT FACTORY'] = { build: RobotFactory.buildFactory, kind: 'level', menuOrder: 4.5, smokeWords: ['OPEN', 'PLAN', 'SHAKE'] };
SCENES['ROBOT SANDBOX'] = { build: RobotFactory.buildSandbox, kind: 'sandbox', menuOrder: 11, smokeWords: ['HELLO'] };
