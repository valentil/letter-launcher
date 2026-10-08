// LLB-100000: cannon "faceNormals ... looks like it points into the shape" flood in COASTAL CITY,
// DESERT, SPACE (and any terrain with samples below -1), plus the hard-coded /LetterLauncher/ path.
//   1. static: playarea.addHeightfieldCollider stores samples relative to their minimum and lifts the
//      body by it; letters.js loads the NPC dino page-relative.
//   2. physics (node + cannon 0.6.2, skipped when not installed): the real addHeightfieldCollider,
//      fed a terrain that dips to -6 m, lets boxes fall and settle with ZERO cannon winding errors,
//      and they rest on the same world surface as heightFn (the shift is invisible).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./_src');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } }

const pa = fs.readFileSync(path.join(ROOT, 'src/core/playarea.js'), 'utf8');
const start = pa.indexOf('function addHeightfieldCollider(');
ok(start > 0, 'addHeightfieldCollider exists');
let depth = 0, end = -1;
for (let i = pa.indexOf('{', start); i < pa.length; i++) {
    if (pa[i] === '{') depth++;
    else if (pa[i] === '}' && --depth === 0) { end = i + 1; break; }
}
const fnSrc = pa.slice(start, end);
ok(/data\[i\]\[j\]\s*-=\s*minH/.test(fnSrc) && /body\.position\.set\(minX,\s*minH,/.test(fnSrc), 'heightfield samples are made non-negative and the body is lifted back by the minimum');
const letters = fs.readFileSync(path.join(ROOT, 'src/core/letters.js'), 'utf8');
ok(!/['"]\/LetterLauncher\//.test(letters) && /loader\.load\('combo_dino_fixed\.glb'/.test(letters), 'NPC dino loads page-relative, no /LetterLauncher/ mount');

let CANNON = null;
try { CANNON = require('cannon'); } catch (e) { /* devDependency missing */ }
if (!CANNON) console.log('  SKIP physics: run `npm install` (cannon is a devDependency)');
else {
    const heightFn = (x, z) => -3 + 3 * Math.sin(x * 0.11) * Math.cos(z * 0.09);   // dips to -6 m
    let errors = 0;
    const oe = console.error, ow = console.warn;
    console.error = () => { errors++; }; console.warn = () => { };
    const ctx = { CANNON, Math, Infinity, isFinite, world: null, scene: { userData: {} }, physicsMaterial: undefined, colliderBodies: [] };
    vm.createContext(ctx);
    ctx.world = new CANNON.World();
    ctx.world.gravity.set(0, -9.82, 0);
    vm.runInContext(fnSrc + '\nthis.addHeightfieldCollider = addHeightfieldCollider;', ctx);
    ctx.addHeightfieldCollider(-40, -40, 40, 40, 5, heightFn, 'test_ground');
    const boxes = [];
    for (let k = 0; k < 25; k++) {
        const b = new CANNON.Body({ mass: 1 });
        b.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.3, 0.3)));
        const x = -30 + (k % 5) * 14 + 1.3, z = -30 + Math.floor(k / 5) * 14 + 1.7;
        b.position.set(x, heightFn(x, z) + 2, z);
        ctx.world.addBody(b); boxes.push(b);
    }
    for (let s = 0; s < 60 * 5; s++) ctx.world.step(1 / 60);
    console.error = oe; console.warn = ow;
    ok(errors === 0, `no cannon winding errors on terrain below -1 m (got ${errors})`);
    // settled boxes sit on the heightFn surface (within the 5 m triangulation's chord error + half box)
    const off = boxes.map(b => Math.abs(b.position.y - 0.3 - heightFn(b.position.x, b.position.z)));
    ok(Math.max(...off) < 0.6, `boxes rest on the real ground (max offset ${Math.max(...off).toFixed(2)} m)`);
    ok(boxes.every(b => b.position.y > -7), 'nothing tunnels through the terrain');
}
console.log(`test_llb-100000: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
