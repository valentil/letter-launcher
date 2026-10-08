// LLF-9 Typographic Constellations: static + vm logic checks.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = require('./_src').readAllSource();
const own = fs.readFileSync(path.join(__dirname, '..', 'src/core/constellations.js'), 'utf8');
try {
    new Function(own); // syntax
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.indexOf('src/core/constellations.js') > 0 && html.indexOf('src/core/constellations.js') < html.indexOf('src/robot/'), 'tag before robot scripts');
    assert.ok(/new THREE\.Line\(/.test(own) && /AdditiveBlending/.test(own), 'additive THREE.Line');
    assert.ok(/e\.shiftKey/.test(own) && /e\.button === 2/.test(own) && /'Escape'/.test(own), 'shift-click, right-click, Escape');
    assert.ok(/scene\.add\(line\)/.test(own) && /CONST_MAX_SEGMENTS/.test(own), 'scene.add + cap');
    assert.ok(/currentScene === 'space'/.test(own) && /constMakeLabel/.test(own), 'space sky + label');
    ['constellationMouseDown(e)', 'constellationKey(e)', 'updateConstellations()', 'constClearAll()'].forEach(h =>
        assert.ok(new RegExp('try \\{[^}]*' + h.replace(/[()]/g, '\\$&')).test(src), 'try/catch hook ' + h));
    // logic: closing a 3-chain in a stubbed env
    const T = { Vector3: class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} clone(){return new T.Vector3(this.x,this.y,this.z);} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;} },
        BufferGeometry: class { setAttribute(n,a){this.attributes=this.attributes||{};this.attributes[n]=a;} setDrawRange(s,c){this.dr=c;} dispose(){} },
        BufferAttribute: class { constructor(a){this.array=a;} setXYZ(){} }, LineBasicMaterial: class { constructor(o){Object.assign(this,o);} dispose(){} },
        Line: class { constructor(g,m){this.geometry=g;this.material=m;} }, AdditiveBlending: 2 };
    const added = [], pbs = [0,1,2].map(i => ({ char: 'ABC'[i], mesh: { parent: {}, position: new T.Vector3(i,0,0) } }));
    let hit = null;
    const ctx = { THREE: T, menuScreen: 'PLAYING', currentScene: 'x', physicsBodies: pbs, scene: { add: o => added.push(o), remove: o => added.splice(added.indexOf(o), 1) },
        raycaster: { setFromCamera(){}, intersectObjects: () => hit ? [{ object: hit.mesh }] : [] }, mouse: {}, camera: {}, console };
    const fn = new Function(...Object.keys(ctx), own + '; return { constellationMouseDown, constellationKey, updateConstellations, get n(){return constellations.length;}, get active(){return activeConstellation;} };');
    const api = fn(...Object.values(ctx));
    const click = (i, o={}) => { hit = i == null ? null : pbs[i]; return api.constellationMouseDown(Object.assign({ button: 0, shiftKey: true }, o)); };
    assert.strictEqual(click(0, { shiftKey: false }), false, 'plain click not consumed');
    click(0); click(1); assert.strictEqual(api.active.nodes.length, 2);
    api.constellationKey({ key: 'Escape' }); assert.strictEqual(api.n, 0, 'Escape cancels'); assert.strictEqual(added.length, 0, 'line removed');
    click(0); click(1); click(2); click(0); assert.ok(!api.active, 'closed'); assert.strictEqual(api.n, 1);
    api.updateConstellations();
    click(0); assert.ok(api.active); api.constellationMouseDown({ button: 2 }); assert.ok(!api.active, 'right-click cancels');
    console.log('LLF-9 tests passed.');
} catch (err) { console.error('LLF-9 test failed:', err.message); process.exit(1); }
