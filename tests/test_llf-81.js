// LLF-81: FLIGHT SIM flies the CAD light aircraft on a real flight model.
//  - flight_model.js (pure, node): level cruise holds 110 kt within +-1 m/s for 60 s; the wing stalls
//    at (and not above) its stall speed; flaps lower the stall speed; touchdown verdicts; takeoff.
//  - aero tables: assets/cad/aircraft_aero.json has CL/CD/Cm over AoA -4..18 for flaps 0/20/30 + method
//    notes, and the copy embedded in flight_model.js matches it.
//  - CAD: recipe + GLB + manifest entry with the control-surface joints; rig + scene wiring; every
//    existing FLIGHT SIM word still present.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FM = require(path.join(ROOT, 'src/scenes/flight/flight_model.js'));
const src = require('./_src').readAllSource();
let failures = 0;
function check(name, cond, extra) {
    if (cond) console.log('PASS', name);
    else { failures++; console.error('FAIL', name, extra !== undefined ? extra : ''); }
}
const KT = FM.KT;

// ---- aero json -------------------------------------------------------------------------------
const aero = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/cad/aircraft_aero.json'), 'utf8'));
check('aero AoA grid -4..18 step 2', JSON.stringify(aero.aoaDeg) === JSON.stringify([-4, -2, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18]));
[0, 20, 30].forEach(f => {
    const t = aero.flaps[f];
    check('aero flaps ' + f + ' has CL/CD/Cm/stallAoA', t && t.CL.length === 12 && t.CD.length === 12 && t.Cm.length === 12 && typeof t.stallAoA === 'number');
});
check('aero method notes recorded', Array.isArray(aero.method) && aero.method.length >= 4 && /cad_wind_tunnel/.test(aero.method.join(' ')));
check('aero cfd provenance array present', Array.isArray(aero.cfd));
const embedded = JSON.parse(JSON.stringify(FM.DEFAULT_AERO));
const stripped = JSON.parse(JSON.stringify(aero)); delete stripped.method; delete stripped.cfd; delete stripped._note;
check('embedded aero == assets/cad/aircraft_aero.json', JSON.stringify(embedded) === JSON.stringify(stripped));
check('flaps raise CL at 0 deg AoA', aero.flaps[30].CL[2] > aero.flaps[20].CL[2] && aero.flaps[20].CL[2] > aero.flaps[0].CL[2]);
check('flaps add drag', aero.flaps[30].CD[2] > aero.flaps[0].CD[2]);

// ---- cruise ----------------------------------------------------------------------------------
{
    const s = FM.create({ h: 300 }); s.trim(110 * KT, 300); s.ap.speedHold = 110 * KT;
    let mn = Infinity, mx = -Infinity, hmin = Infinity, hmax = -Infinity, stalled = false;
    for (let i = 0; i < 600; i++) { s.step(0.1); mn = Math.min(mn, s.V); mx = Math.max(mx, s.V); hmin = Math.min(hmin, s.h); hmax = Math.max(hmax, s.h); stalled = stalled || s.stalled; }
    const v0 = 110 * KT;
    check('cruise: 110 kt held within +-1 m/s over 60 s', mn > v0 - 1 && mx < v0 + 1, [mn, mx]);
    check('cruise: altitude held within +-5 m', hmin > 295 && hmax < 305, [hmin, hmax]);
    check('cruise: no stall', !stalled);
}
// ---- stall -----------------------------------------------------------------------------------
function stallSpeed(flaps) {
    const s = FM.create({ h: 400, flaps }); s.trim(90 * KT, 400); s.throttle = 0;
    let v = null, notBefore = true;
    for (let i = 0; i < 2400 && v == null; i++) {
        s.step(0.05);
        if (s.stalled) v = s.V; else if (s.V < s.vStall() * 0.97) notBefore = false;
    }
    return { v, vs: s.vStall(), notBefore, s };
}
const st0 = stallSpeed(0), st30 = stallSpeed(30);
check('stall: clean wing stalls when slowed', st0.v != null);
check('stall: clean stall within 3 % of Vs', st0.v != null && Math.abs(st0.v - st0.vs) / st0.vs < 0.03, [st0.v, st0.vs]);
check('stall: no stall above the threshold', st0.notBefore && st30.notBefore);
check('flaps reduce stall speed (Vs table)', FM.vStall(aero, 1043, 30) < FM.vStall(aero, 1043, 20) && FM.vStall(aero, 1043, 20) < FM.vStall(aero, 1043, 0));
check('flaps reduce stall speed (simulated)', st30.v != null && st30.v < st0.v - 1.5, [st30.v, st0.v]);
{
    const s = st0.s, th0 = s.theta; let minTheta = Infinity;
    for (let i = 0; i < 40; i++) { s.step(0.05); minTheta = Math.min(minTheta, s.theta); }
    check('stall: nose drops > 8 deg after the break', minTheta < th0 - 8 * Math.PI / 180, [th0, minTheta]);
}
// ---- coefficients ----------------------------------------------------------------------------
{
    const pre = FM.coeffs(aero, aero.flaps[0].stallAoA - 1, 0, false), post = FM.coeffs(aero, aero.flaps[0].stallAoA + 3, 0, false);
    check('post-stall lift falls and nose-down moment appears', post.CL < pre.CL && post.cmBreak < 0);
    const half = FM.coeffs(aero, 4, 10, false);
    check('flaps 10 sits between 0 and 20', half.CL > FM.coeffs(aero, 4, 0, false).CL && half.CL < FM.coeffs(aero, 4, 20, false).CL);
    check('gear down adds drag', FM.coeffs(aero, 4, 0, true).CD > FM.coeffs(aero, 4, 0, false).CD);
}
// ---- landing ---------------------------------------------------------------------------------
function land(flaps, firewall) {
    const s = FM.create({ h: 300 }); s.trim(110 * KT, 300); s.flaps = flaps; s.ap.mode = 'approach'; s.ap.firewall = !!firewall;
    for (let t = 0; t < 400 && !s.touchdown; t += 0.05) s.step(0.05);
    const td = s.touchdown;
    return td ? FM.judgeTouchdown(s.aero, s.mass, flaps, td.V, td.sink) : null;
}
const l30 = land(30), l10 = land(10), lfw = land(30, true);
check('landing: flaps 30 approach lands', l30 && l30.ok, l30);
check('landing: flaps 30 touchdown < 1.3 Vs and sink < 3 m/s', l30 && l30.V < 1.3 * l30.vs && l30.sink < 3);
check('landing: flaps 10 floats in too fast -> bounce', l10 && l10.verdict === 'bounce', l10);
check('landing: firewalled throttle -> bounce', lfw && lfw.verdict === 'bounce', lfw);
check('judge: 3.5 m/s sink is a crash', FM.judgeTouchdown(aero, 1043, 30, 25, 3.5).verdict === 'crash');
check('judge: 1.3 x Vs exactly is a bounce', FM.judgeTouchdown(aero, 1043, 30, 1.3 * FM.vStall(aero, 1043, 30), 1).verdict === 'bounce');
// ---- takeoff ---------------------------------------------------------------------------------
{
    const s = FM.create({}); s.ap.mode = 'takeoff'; s.ap.altHold = 300; let lo = null;
    for (let t = 0; t < 60; t += 0.05) { s.step(0.05); if (!s.onGround && lo == null) lo = t; }
    check('takeoff: lifts off after a ground roll', lo != null && lo > 5 && lo < 30, lo);
    check('takeoff: climbing toward the target', s.h > 100, s.h);
}
// ---- CAD asset -------------------------------------------------------------------------------
const recipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/cad/recipes/light_aircraft.json'), 'utf8'));
const entry = require(path.join(ROOT, 'tools/cad/manifest_store.js')).read('light_aircraft');   // LLF-104: assets/cad/manifest.d/light_aircraft.json
check('manifest has light_aircraft', !!entry);
check('GLB committed', fs.existsSync(path.join(ROOT, 'assets/cad/light_aircraft.glb')));
check('preview committed', fs.existsSync(path.join(ROOT, 'assets/cad/previews/light_aircraft.png')));
const nodes = recipe.parts.map(p => p.nodeName);
['aileron_l', 'aileron_r', 'flap_l', 'flap_r', 'elevator_l', 'elevator_r', 'rudder', 'prop', 'gear_main_l', 'gear_main_r', 'gear_nose']
    .forEach(n => check('separate jointed node ' + n, nodes.includes(n) && entry && entry.joints.some(j => j.node === n && j.pivotMm)));
check('flaps have 0/10/20/30 detents', recipe.joints.find(j => j.node === 'flap_l').detentsDeg.join() === '0,10,20,30');
check('span ~11 m, length ~8.3 m', entry && Math.abs(entry.bboxM.size[0] - 11) < 0.1 && Math.abs(entry.bboxM.size[2] - 8.16) < 0.3, entry && entry.bboxM.size);
check('no brand marks in the recipe prompt', !/cessna|piper|skyhawk/i.test(recipe.prompt + JSON.stringify(recipe.parts)));
// ---- wiring ----------------------------------------------------------------------------------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const iFm = html.indexOf('src/scenes/flight/flight_model.js'), iRig = html.indexOf('src/scenes/flight/aircraft_rig.js'), iRobot = html.indexOf('src/robot/');
check('flight scripts load before src/robot', iFm > 0 && iRig > iFm && iRobot > iRig);
const scene = fs.readFileSync(path.join(ROOT, 'src/scenes/flight_sim.js'), 'utf8');
check('scene attaches the CAD rig', /AircraftRig\.attach\(plane/.test(scene));
check('scene flies FlightModel', /FlightModel\.create\(/.test(scene) && /fm\.step\(/.test(scene));
check('LAND judged by touchdown speed/sink', /judgeTouchdown\(/.test(scene));
check('flaps step through detents', /st\.flapDeg >= 30 \? 0 : st\.flapDeg \+ 10/.test(scene));
check('HIGHER/LOWER drive the altitude hold', (scene.match(/ap\.altHold = hOf\(st\.talt\)/g) || []).length >= 3);
check('rig drives surfaces from the manifest joints', /AssetLib\.info\(NAME\)/.test(src) && /setAngle\(rig, 'aileron_l'/.test(src) && /setAngle\(rig, 'rudder'/.test(src));
['TAKEOFF|FLY', 'LAND|LANDING', 'LEFT', 'RIGHT', 'TURN|AROUND', 'HIGHER|CLIMB', 'LOWER|DESCEND|DIVE', 'FAST|THROTTLE|BOOST', 'SLOW|CRUISE',
    'GEAR|WHEELS', 'FLAPS', 'AUTOPILOT|AUTO', 'OSAKA|PARIS|CAIRO|RIO', 'LOOP', 'ROLL|BARREL', 'WAVE|WAGGLE', 'SMOKE|TRAIL', 'CLOUD|CLOUDS', 'RAIN', 'SNOW',
    'STORM|THUNDER|LIGHTNING', 'SUN|CLEAR', 'NIGHT', 'DAY', 'RAINBOW', 'BIRD|BIRDS|FLOCK', 'BALLOON', 'BLIMP|ZEPPELIN', 'UFO', 'COW|COWS|MOO',
    'TREE|TREES|FOREST', 'RADIO', 'TOWER', 'FLARE|FLARES', 'STARS|STAR', 'MOON', 'JET', 'KITE', 'FIREWORK|FIREWORKS', 'WIND|TURBULENCE']
    .forEach(w => check('word still wired: ' + w, scene.includes("'" + w + "':")));
check('level hints kept', /hints: \[/.test(scene) && scene.includes('Riddle: where do you want to go?'));
check('tower still demands gear', scene.includes('The tower waves us off — our wheels are still up! (GEAR)'));
check('win text kept', scene.includes("gameWin('WELCOME TO ' + st.target.name)"));

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('All LLF-81 checks passed.');
