// LLF-10: Animal Ride Mechanic — static wiring + vm behaviour test for src/core/ride.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readAllSource } = require('./_src');
const src = readAllSource();
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// Wiring
const html = read('index.html');
assert(html.indexOf('src/core/ride.js') > 0 && html.indexOf('src/core/ride.js') < html.indexOf('src/robot/'), 'ride.js tagged before robot');
assert(/try \{ rideFrame\(/.test(read('src/core/engine.js')), 'animate hook');
assert(/rideDrives\(pb\)/.test(read('src/core/engine.js')), 'wander suspended while riding');
const menu = read('src/core/menu.js');
for (const h of ['rideMouseDown', 'rideMouseUp', 'rideKey', 'rideCheckBuffer']) assert(menu.includes(h), h);
assert(read('src/core/scene_swap.js').includes('rideReset'), 'scene swap cleanup');

// Behaviour with stubs
class V3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(o){return this.set(o.x,o.y,o.z);} clone(){return new V3(this.x,this.y,this.z);}
  lerp(o,t){this.x+=(o.x-this.x)*t;this.y+=(o.y-this.y)*t;this.z+=(o.z-this.z)*t;return this;} }
class Q { constructor(){this.x=0;this.y=0;this.z=0;this.w=1;} copy(o){this.x=o.x;this.y=o.y;this.z=o.z;this.w=o.w;return this;} clone(){return new Q().copy(this);} slerp(){return this;} }
const mkBody = (x, z) => ({ position: new V3(x, -5, z), velocity: new V3(), angularVelocity: new V3(), quaternion: Object.assign(new Q(), {y: 0, w: 1}),
  shapes: [{ halfExtents: { x: 2, y: 1, z: 1 } }], fixedRotation: false, updateMassProperties() {}, applyImpulse(i) { this.pushed = i; } });
const animal = { type: 'zoo_animal', mesh: {}, body: mkBody(0, 0) };
const letter = { type: 'letter', mesh: {}, body: mkBody(0, 2) };
const camera = { position: new V3(0, 5, 15), quaternion: new Q() };
const ctx = { THREE: { Vector3: V3, Object3D: class { constructor(){this.position=new V3();this.quaternion=new Q();} lookAt(){} } },
  CANNON: { Vec3: V3 }, physicsBodies: [animal, letter], camera, currentCameraLookAt: new V3(0,0,0), cameraMouseOffset: new V3(1,1,0),
  mouse: { x: 0, y: 0 }, menuScreen: 'PLAYING', console };
ctx.CANNON.Vec3 = V3;
animal.body.quaternion.setFromAxisAngle = undefined;
vm.createContext(ctx);
vm.runInContext(read('src/core/ride.js') + ';this.api={rideState,rideMount,rideDismount,rideFrame,rideReset,rideCheckBuffer,rideKey,rideIsActive};', ctx);
const a = ctx.api;
// body.quaternion needs setFromAxisAngle during drive
animal.body.quaternion.setFromAxisAngle = function (ax, ang) { this.y = Math.sin(ang/2); this.w = Math.cos(ang/2); };
a.rideCheckBuffer('XXRIDE');
assert(a.rideIsActive(), 'RIDE mounts');
assert.strictEqual(ctx.cameraMouseOffset.x, 0, 'parallax suspended');
for (let i = 0; i < 80; i++) a.rideFrame(0.016);
assert.strictEqual(a.rideState.phase, 'riding');
assert(animal.body.velocity.z > 1, 'animal driven forward');
assert(letter.body.pushed, 'letters ahead pushed');
ctx.mouse.x = 1;
for (let i = 0; i < 200; i++) a.rideFrame(0.016);
assert(Math.abs(a.rideState.heading - a.rideState.baseHeading) <= Math.PI / 3 + 1e-6, 'steering limited');
assert(a.rideKey({ key: 'Escape' }), 'Escape consumed while riding');
for (let i = 0; i < 100; i++) a.rideFrame(0.016);
assert.strictEqual(a.rideState.phase, 'idle', 'dismount completes');
assert.strictEqual(ctx.camera.position.z, 15, 'camera restored to saved pose');
assert(ctx.cameraMouseOffset.x !== 0, 'parallax restored');
assert(!a.rideKey({ key: 'Escape' }), 'Escape not consumed when idle');
a.rideCheckBuffer('RIDE'); a.rideReset();
assert.strictEqual(a.rideState.phase, 'idle', 'reset clears ride');
console.log('LLF-10 ride tests passed');
