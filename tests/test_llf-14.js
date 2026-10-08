// LLF-14 Letter Sculpting Tool: static wiring + node/cannon logic (alt+drag, fuse, group, UNWELD, cap, cleanup).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, readAllSource } = require('./_src');
const own = fs.readFileSync(path.join(ROOT, 'src/core/sculpt.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const all = readAllSource();
let CANNON = null;
try { CANNON = require('cannon'); } catch (e) { console.log('  SKIP physics: run `npm install` (cannon is a devDependency)'); }

try {
    new Function(own);
    assert.ok(html.indexOf('src/core/sculpt.js') > html.indexOf('src/core/hooks.js') && html.indexOf('src/core/sculpt.js') < html.indexOf('src/robot/'), 'tag after hooks, before robot');
    ['mousedown', 'mouseup', 'frame', 'typed', 'word', 'beforeSceneSwap'].forEach(evt => assert.ok(new RegExp("LLHooks\\.on\\('" + evt + "'").test(own), 'LLHooks ' + evt));
    ['sculptMouseDown(e)', 'sculptMouseUp(e)', 'sculptFrame(dt)'].forEach(h => assert.strictEqual(all.split(h).length - 1, own.split(h).length - 1, h + ' only in sculpt.js'));
    assert.ok(/e\.altKey/.test(own) && /LockConstraint/.test(own) && /SCULPT_MAX_FUSES/.test(own) && /UNWELD\|BREAK/.test(own), 'alt, lock, cap, unweld');
    assert.ok(own.indexOf('\r\n') > 0 && !/[^\r]\n/.test(own), 'CRLF preserved');

    if (CANNON) {
        class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
        const added = [];
        const THREE = {
            Vector3: V3,
            Plane: class { setFromNormalAndCoplanarPoint() { return this; } },
            BufferGeometry: class { setAttribute(n, a) { this.attributes = this.attributes || {}; this.attributes[n] = a; } dispose() {} },
            BufferAttribute: class { constructor(a) { this.array = a; } },
            PointsMaterial: class { dispose() {} }, Points: class { constructor(g, m) { this.geometry = g; this.material = m; } },
            AdditiveBlending: 2
        };
        const world = new CANNON.World();
        world.gravity.set(0, 0, 0);
        const mk = (ch, x) => {
            const body = new CANNON.Body({ mass: 1 });
            body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
            body.position.set(x, 0, 0);
            world.addBody(body);
            return { char: ch, body, mesh: { id: ch } };
        };
        const A = mk('A', 0), B = mk('B', 1.02), C = mk('C', 8), N = mk('N', 20);
        N.type = 'npc';
        const physicsBodies = [A, B, C, N];
        let target = A, ptr = new V3(0, 0, 0);
        const ray = { intersectPlane: (pl, out) => { out.x = ptr.x; out.y = ptr.y; out.z = ptr.z; return out; } };
        const ctx = { THREE, CANNON, world, physicsBodies, menuScreen: 'PLAYING', mouse: {}, camera: { getWorldDirection() {} }, console,
            raycaster: { ray, setFromCamera() {}, intersectObjects: () => (target ? [{ object: target.mesh, point: new V3(target.body.position.x, 0, 0) }] : []) },
            scene: { add: o => added.push(o), remove: o => added.splice(added.indexOf(o), 1) } };
        const api = new Function(...Object.keys(ctx), own + '; return { sculptMouseDown, sculptMouseUp, sculptFrame, sculptBuffer, sculptReset, sculptUnweld, sculptFuse, get fuses() { return sculptFuses; }, get drag() { return sculptDrag; } };')(...Object.values(ctx));
        const step = n => { for (let i = 0; i < n; i++) { api.sculptFrame(0.016); world.step(1 / 60); } };

        assert.strictEqual(api.sculptMouseDown({ button: 0, altKey: false }), false, 'plain drag not consumed');
        assert.strictEqual(api.sculptMouseDown({ button: 0, altKey: true, shiftKey: false }), true, 'alt+drag consumed');
        assert.ok(api.drag && api.drag.pb === A, 'picked A');
        ptr = new V3(0, 0, 0); step(5);
        api.sculptMouseUp({});
        assert.strictEqual(api.fuses.length, 1, 'dropping A touching B fuses');
        assert.ok(added.length >= 1, 'spark added');
        assert.strictEqual(world.constraints.length, 1, 'LockConstraint in world');
        // fused group moves as one: carry B 3 m to +y, A follows
        target = B; api.sculptMouseDown({ button: 0, altKey: true });
        ptr = new V3(B.body.position.x, 3, 0); step(120);
        assert.ok(A.body.position.y > 2, 'A followed B (y=' + A.body.position.y.toFixed(2) + ')');
        assert.ok(Math.abs((B.body.position.x - A.body.position.x) - 1.02) < 0.3 && Math.abs(B.body.position.y - A.body.position.y) < 0.3, 'spacing kept');
        api.sculptMouseUp({});
        // dropping away from anything fuses nothing; dropping on the same group does nothing
        assert.strictEqual(api.fuses.length, 1);
        // C: drag to touch B
        target = C; api.sculptMouseDown({ button: 0, altKey: true });
        ptr = new V3(B.body.position.x + 1.02, B.body.position.y, 0); step(200);
        api.sculptMouseUp({});
        assert.strictEqual(api.fuses.length, 2, 'second fuse');
        // NPC never fuses
        assert.ok(api.sculptFuse(A, N) === null, 'npc never fuses');
        // UNWELD removes the most recent
        assert.strictEqual(api.sculptBuffer('XUNWELD'), true);
        assert.strictEqual(api.fuses.length, 1); assert.strictEqual(world.constraints.length, 1);
        assert.strictEqual(api.sculptBuffer('ABREAK'), true); assert.strictEqual(api.fuses.length, 0);
        assert.strictEqual(api.sculptBuffer('BREAK'), false, 'nothing to break');
        const many = []; for (let i = 0; i < 45; i++) { many.push(mk('D', 40 + i * 2)); physicsBodies.push(many[i]); }
        let made = 0; for (let i = 1; i < many.length; i++) if (api.sculptFuse(many[i - 1], many[i])) made++;
        assert.strictEqual(made, 40, 'fuse cap at 40'); assert.ok(api.sculptFuse(A, C) === null, 'refused past cap');
        // retired bodies: constraint removed
        physicsBodies.splice(physicsBodies.indexOf(many[1]), 1); api.sculptFrame(0.016);
        assert.ok(api.fuses.length < 40, 'pruned fuses of retired bodies');
        // scene swap cleanup
        added.length = 0; api.sculptFuse(A, B); api.sculptReset();
        assert.strictEqual(api.fuses.length, 0); assert.strictEqual(world.constraints.length, 0, 'constraints cleared'); assert.strictEqual(added.length, 0, 'sparks cleared');
    }
    console.log('LLF-14 tests passed.');
} catch (err) { console.error('LLF-14 test failed:', err.message); process.exit(1); }
