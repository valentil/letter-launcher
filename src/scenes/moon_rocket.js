// Letter Launcher — src/scenes/moon_rocket.js
// Scene "MOON ROCKET" (level): createMoonRocketScene and its private helpers. Registers itself in window.SCENES.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // ==================================================================
        // ==== LEVEL 3: MOON ROCKET (orbit the moon and come home) =========
        // Launch from the pad, drop the spent booster, circularize, fly one
        // full orbit, then retro-burn and land back on the pad. Space props
        // borrowed from the SPACE scene (starfield, nebula, distant planet).
        // ==================================================================
        function createMoonRocketScene() {
            currentScene = 'moon_rocket';
            scene.background = new THREE.Color(0x000005);
            scene.fog = null;
            const st = {};
            const MOON_R = 10;
            const CENTER = new THREE.Vector3(0, 1, 0);

            // Starfield + nebula + distant planet (SPACE-scene assets)
            const starGeo = new THREE.BufferGeometry();
            const starPos = new Float32Array(900 * 3);
            for (let i = 0; i < starPos.length; i++) starPos[i] = (Math.random() - 0.5) * 400;
            starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
            const starMat = new THREE.PointsMaterial({ color: 0xFFFFFF, size: 0.5 });
            scene.add(new THREE.Points(starGeo, starMat));
            st.starMat = starMat;
            const nebulaMat = new THREE.MeshBasicMaterial({
                color: 0x220044, side: THREE.BackSide, transparent: true, opacity: 0.3
            });
            scene.add(new THREE.Mesh(new THREE.SphereGeometry(160, 24, 24), nebulaMat));
            st.nebulaMat = nebulaMat;
            const planetMat = new THREE.MeshPhongMaterial({ color: 0x4488FF, emissive: 0x112244 });
            const planet = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 24), planetMat);
            planet.position.set(-48, 26, -80);
            scene.add(planet);
            st.planet = planet;
            const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12),
                new THREE.MeshBasicMaterial({ color: 0xfff2c9 }));
            sunGlow.position.set(70, 40, -90);
            scene.add(sunGlow);
            st.sun = sunGlow;
            const light = new THREE.PointLight(0xFFFFFF, 1.6, 300);
            light.position.set(60, 40, 60);
            scene.add(light);
            st.light = light;

            // The moon — an indexed sphere (shared vertices + proper UVs).
            // Displacement is a DETERMINISTIC function of position, so
            // duplicated seam vertices move identically and the surface can
            // never crack open (the old per-vertex random tore the faces).
            const moonGeo = new THREE.SphereGeometry(MOON_R, 48, 32);
            const mv = moonGeo.attributes.position;
            for (let i = 0; i < mv.count; i++) {
                const x = mv.getX(i), y = mv.getY(i), z = mv.getZ(i);
                const n = 1 +
                    0.016 * Math.sin(x * 1.7 + z * 2.3) * Math.cos(y * 2.1 + x * 0.9) +
                    0.010 * Math.sin(y * 3.7 + z * 1.3);
                mv.setXYZ(i, x * n, y * n, z * n);
            }
            moonGeo.computeVertexNormals();
            // Real moon texture borrowed from the comet-rex project. Tries the
            // local downscaled copy first, then the comet-rex original (when
            // served from the showcase root); stays flat gray if neither loads.
            const moonMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 });
            (function loadMoonTex(srcs) {
                if (!srcs.length) { console.warn('moon texture missing — using flat gray'); return; }
                new THREE.TextureLoader().load(srcs[0], tex => {
                    moonMat.map = tex;
                    moonMat.color.setHex(0xffffff);
                    moonMat.needsUpdate = true;
                }, undefined, () => loadMoonTex(srcs.slice(1)));
            })(['assets/moon_2k.jpg', '../comet-rex/assets/8k_moon.jpg']);
            const moon = new THREE.Mesh(moonGeo, moonMat);
            moon.position.copy(CENTER);
            scene.add(moon);
            st.moon = moon;

            // Launch pad on the lower-right of the disc (orbit is in the X/Y plane)
            st.padTh = -0.62;
            const padDir = th => new THREE.Vector3(Math.cos(th), Math.sin(th), 0);
            const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 10),
                new THREE.MeshStandardMaterial({ color: 0x555e66, metalness: 0.4, roughness: 0.6 }));
            pad.position.copy(CENTER).addScaledVector(padDir(st.padTh), MOON_R + 0.1);
            pad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), padDir(st.padTh));
            scene.add(pad);
            // Additive blending so the beacon GLOWS over the sky instead of
            // rendering as a dark beam.
            st.padBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 26, 8, 1, true),
                new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
            st.padBeacon.position.copy(CENTER).addScaledVector(padDir(st.padTh), MOON_R + 13);
            st.padBeacon.quaternion.copy(pad.quaternion);
            st.padBeacon.visible = false;
            scene.add(st.padBeacon);
            st.orbitRing = new THREE.Mesh(new THREE.TorusGeometry(MOON_R + 7, 0.06, 6, 80),
                new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
            st.orbitRing.position.copy(CENTER);
            st.orbitRing.visible = false;
            scene.add(st.orbitRing);

            // The rocket (with a strap-on booster ring that STAGE jettisons)
            const rocket = new THREE.Group();
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 0.4, roughness: 0.4 });
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.4, 12), bodyMat);
            body.position.y = 1.2; rocket.add(body);
            const noseR = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 12),
                new THREE.MeshStandardMaterial({ color: 0xc23b22 }));
            noseR.position.y = 2.85; rocket.add(noseR);
            for (let i = 0; i < 3; i++) {
                const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.55),
                    new THREE.MeshStandardMaterial({ color: 0xc23b22 }));
                const a = (i / 3) * Math.PI * 2;
                fin.position.set(Math.cos(a) * 0.5, 0.35, Math.sin(a) * 0.5);
                fin.rotation.y = -a; rocket.add(fin);
            }
            const booster = new THREE.Group();
            for (let i = 0; i < 3; i++) {
                const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8),
                    new THREE.MeshStandardMaterial({ color: 0xb8863b, metalness: 0.5, roughness: 0.5 }));
                const a = (i / 3) * Math.PI * 2 + 0.5;
                tank.position.set(Math.cos(a) * 0.62, 0.7, Math.sin(a) * 0.62);
                booster.add(tank);
            }
            rocket.add(booster);
            st.booster = booster;
            st.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5),
                new THREE.MeshBasicMaterial({ color: 0x330000 }));
            st.strobe.position.y = 3.35; rocket.add(st.strobe);
            scene.add(rocket);
            st.rocket = rocket;

            // Sim state — position expressed as (angle th around the moon, altitude)
            st.phase = 'pad';   // pad -> ascent -> coast -> orbit -> deorbit -> landing -> landed
            st.th = st.padTh; st.alt = 0; st.dir = 1;
            st.lap = 0; st.lapDone = false; st.staged = false;
            st.fuel = 1; st.strobeOn = false; st.flagPlanted = false;
            st.hint1 = false; st.hint2 = false;

            const radial = () => padDir(st.th);
            const surfPos = (th, alt) => CENTER.clone().addScaledVector(padDir(th), MOON_R + 1.55 + alt);
            function flame(size) {
                const tail = st.rocket.position.clone().addScaledVector(
                    new THREE.Vector3(0, -1, 0).applyQuaternion(st.rocket.quaternion), st.flameDrop || 0.4);
                fwParticle(tail, new THREE.Vector3((Math.random() - 0.5) * 0.04, -0.03, 0),
                    new THREE.Color().setHSL(0.07 + Math.random() * 0.04, 0.95, 0.55),
                    { gravity: 0.0002, decay: 0.05, size: size || 0.1 });
            }

            // LLF-82: staged-flight layer (src/scenes/rocket/*.js). CAD rocket + umbilical tower + lander, a real ascent
            // sim and tumbling stages. Every call goes through rf(), which turns the whole layer off on the first
            // error and leaves the original arcade rocket logic running.
            const rfctx = { rocket: st.rocket, pad, flame };
            const rf = (fn, dflt) => {
                if (st.rfBroken || typeof RocketFlight === 'undefined') return dflt;
                try { return fn(); } catch (e) { st.rfBroken = true; console.warn('[moon_rocket] staged flight disabled', e); return dflt; }
            };
            rf(() => RocketFlight.attach(st, rfctx));

            setGameMode({
                name: 'MOON ROCKET',
                objective: "Orbit the moon once, then land back on the pad.",
                intro: ["Rockets drink before they dance. Check the tanks first.","Light the fuse, drop the spent booster, and circle the moon once.","Then brake and come home to the pad. Type HELP if lost."],
                hints: [
                    { after: 25, text: "Riddle: what fills a thirsty tank, and what lights the fuse?" },
                    { after: 55, text: "Nudge: refuel, launch, jettison the booster, orbit, then slow down to land." },
                    { after: 90, text: "Near answer: L... to go up, S... the booster, O... the moon, R... to brake, then L... on the pad." }
                ],
                advancers: ["LAUNCH|IGNITE|BLAST|LIFTOFF", "STAGE|SEPARATE|JETTISON", "ORBIT|CIRCLE", "BOOST|BURN", "RETRO|BRAKE|SLOW", "LAND|TOUCHDOWN", "ABORT", "LEGS|GEAR|DEPLOY", "FUEL|REFUEL|TANK", "FLIP|REVERSE", "SCAN|RADAR|MAP"],
                words: expandWords({
                    // ---- state advancers -------------------------------------
                    'LAUNCH|IGNITE|BLAST|LIFTOFF': () => {
                        if (st.phase !== 'pad' && st.phase !== 'landed') { gameMsg('We are already off the pad.'); return; }
                        if (st.fuel < 0.25) { gameMsg('Tanks nearly dry — FUEL up first.'); return; }
                        st.phase = 'ascent'; st.fuel -= 0.25;
                        if (!gameMode.won) { st.lap = 0; st.lapDone = false; }
                        beeps([[90, 1.2, 0, 'sawtooth', 0.3], [140, 1.0, 300, 'sawtooth', 0.2]]);
                        puffBurst(st.rocket.position.clone(), 0xdddddd, 20, 1.5, { decay: 0.02 });
                        gameMsg('IGNITION. The little ship climbs away from the pad…');
                        rf(() => RocketFlight.launch(st, rfctx));
                    },
                    'STAGE|SEPARATE|JETTISON': () => {
                        if (st.phase !== 'pad' && rf(() => RocketFlight.stage(st, rfctx), false)) return;
                        if (st.staged) { gameMsg('The booster is already tumbling below.'); return; }
                        if (st.phase === 'pad') { gameMsg('Staging on the pad would just be littering.'); return; }
                        st.staged = true;
                        st.booster.visible = false;
                        const chunk = st.booster.clone();
                        chunk.visible = true;
                        const from = st.rocket.position.clone();
                        flyby(chunk, from, CENTER.clone().addScaledVector(padDir(st.th - 0.5), MOON_R + 0.4), 2600, {
                            spin: true, onDone: () => puffBurst(chunk.position.clone(), 0xaaaaaa, 10, 1, { decay: 0.03 })
                        });
                        gameBeep(300, 0.3, 'square', 0.15);
                        gameMsg('Booster away! The ship feels light enough to circle now.');
                    },
                    'ORBIT|CIRCLE': () => {
                        if (st.phase === 'ascent' && st.rf && st.rf.active && st.rf.fl && !st.rf.fl.inOrbit) { gameMsg('Still burning for orbit — wait for insertion.'); return; }
                        if (st.phase !== 'coast' && st.phase !== 'ascent') { gameMsg(st.phase === 'orbit' ? 'Already orbiting.' : 'Get off the pad first (LAUNCH).'); return; }
                        if (!st.staged) { gameMsg('The spent booster is dead weight — the ship cannot circle yet. (STAGE)'); return; }
                        if (st.alt < 5) { gameMsg('Too low to orbit — keep climbing.'); return; }
                        st.phase = 'orbit';
                        gameBeep(660, 0.4, 'triangle', 0.15);
                        gameMsg('Orbit achieved! One full lap around the moon, pilot.');
                    },
                    'BOOST|BURN': () => {
                        if (st.phase !== 'orbit' && st.phase !== 'coast') { gameMsg('Nothing to boost right now.'); return; }
                        if (st.fuel < 0.15) { gameMsg('Not enough fuel for a burn.'); return; }
                        st.fuel -= 0.15;
                        st.alt = Math.min(11, st.alt + 2);
                        for (let i = 0; i < 8; i++) setTimeout(() => flame(0.14), i * 60);
                        gameMsg('Prograde burn — orbit raised.');
                    },
                    'RETRO|BRAKE|SLOW': () => {
                        if (st.phase !== 'orbit') { gameMsg('A retro-burn needs an orbit to slow down from.'); return; }
                        st.phase = 'deorbit';
                        st.orbitRing.visible = false;
                        for (let i = 0; i < 8; i++) setTimeout(() => flame(0.14), i * 60);
                        gameMsg('Retro-burn… descending. LAND when the pad passes below.');
                    },
                    'LAND|TOUCHDOWN': () => {
                        if (st.phase === 'pad' || st.phase === 'landed') { gameMsg('We are on the ground, flight.'); return; }
                        if (st.phase === 'orbit') { gameMsg('Too fast to land from orbit — RETRO first.'); return; }
                        if (Math.abs(angDiff(st.th, st.padTh)) > 0.38) { gameMsg('Not above the pad! Wait for it to come around.'); return; }
                        st.phase = 'landing';
                        rf(() => RocketFlight.land(st, rfctx));
                        gameMsg('Gear out… easing down to the pad…');
                    },
                    'ABORT': () => {
                        if (st.phase === 'pad' || st.phase === 'landed') { gameMsg('Nothing to abort.'); return; }
                        st.phase = 'landing'; st.th = st.padTh;
                        rf(() => RocketFlight.land(st, rfctx));
                        gameMsg('ABORT — auto-return spirals the ship straight home.');
                        gameBeep(220, 0.6, 'square', 0.2);
                    },
                    'LEGS|GEAR|DEPLOY': () => {
                        if (st.phase === 'pad' || st.phase === 'landed') { gameMsg('The legs are only for the lander, and we are already down.'); return; }
                        if (st.phase !== 'deorbit' && st.phase !== 'landing') { gameMsg('Legs out now would just add drag. Deploy them on the way down (RETRO first).'); return; }
                        if (!rf(() => { if (!RocketFlight.ready(st)) return false; RocketFlight.land(st, rfctx); return true; }, false)) { gameMsg('Landing legs extend by themselves with the gear — LAND when ready.'); return; }
                        gameBeep(520, 0.2, 'triangle', 0.12);
                    },
                    'FUEL|REFUEL|TANK': () => {
                        if (st.phase !== 'pad' && st.phase !== 'landed') { gameMsg('No fuel trucks in space, sadly.'); return; }
                        st.fuel = 1;
                        puffBurst(st.rocket.position.clone(), 0xa8e6ff, 10, 1, { decay: 0.025 });
                        gameMsg('Tanks topped off.');
                    },
                    'FLIP|REVERSE': () => {
                        st.dir *= -1;
                        gameMsg('Flipping the orbit — now circling the other way.');
                    },
                    'SCAN|RADAR|MAP': () => {
                        st.padBeacon.visible = !st.padBeacon.visible;
                        st.orbitRing.visible = st.padBeacon.visible;
                        gameBeep(1200, 0.15, 'sine', 0.1);
                        gameMsg(st.padBeacon.visible ? 'Scanner ON — pad beacon and orbit guide lit.' : 'Scanner off.');
                    },
                    // ---- doodads ---------------------------------------------
                    'STARS|STAR|TWINKLE': () => {
                        tween(2400, k => { st.starMat.size = 0.5 + Math.abs(Math.sin(k * Math.PI * 3)) * 0.7; });
                        gameMsg('The starfield shimmers.');
                    },
                    'COMET|REX': () => {
                        const comet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0),
                            new THREE.MeshBasicMaterial({ color: 0xaaffee }));
                        flyby(comet, new THREE.Vector3(-70, 40, -30), new THREE.Vector3(70, -10, -20), 4200, { spin: true });
                        const trail = setInterval(() => {
                            if (!gameMode || !comet.parent) { clearInterval(trail); return; }
                            fwParticle(comet.position.clone(), new THREE.Vector3(0, 0, 0),
                                new THREE.Color(0x88ffee), { gravity: 0, decay: 0.02, size: 0.12 });
                        }, 50);
                        setTimeout(() => clearInterval(trail), 4400);
                        gameMsg('Rex the comet streaks past, showing off as usual.');
                    },
                    'METEOR|METEORS|SHOWER': () => {
                        for (let i = 0; i < 3; i++) setTimeout(() => {
                            const a = Math.random() * Math.PI * 2;
                            const hit = CENTER.clone().addScaledVector(padDir(a), MOON_R);
                            const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0),
                                new THREE.MeshBasicMaterial({ color: 0xffaa66 }));
                            flyby(m, hit.clone().addScaledVector(padDir(a), 30).add(new THREE.Vector3(14, 10, 0)), hit, 900,
                                { onDone: () => { puffBurst(hit, 0xbbbbbb, 14, 1, { decay: 0.03 }); gameBeep(90, 0.3, 'sawtooth', 0.15); } });
                        }, i * 500);
                        gameMsg('Meteorites pepper the far side.');
                    },
                    'EARTH|PLANET|HOME': () => {
                        tween(2000, k => st.planet.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.15));
                        gameMsg('The blue planet glows — everyone you know lives there.');
                    },
                    'SUN|FLARE': () => {
                        tween(1600, k => { st.sun.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.6); st.light.intensity = 1.6 + Math.sin(k * Math.PI) * 1.4; });
                        gameMsg('A solar flare ripples past. Sunglasses on.');
                    },
                    'NEBULA': () => {
                        const h = Math.random();
                        tween(3000, k => st.nebulaMat.color.setHSL(h, 0.7, 0.12 + Math.sin(k * Math.PI) * 0.08));
                        gameMsg('The nebula blushes a new color.');
                    },
                    'ALIEN': () => {
                        const blob = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6),
                            new THREE.MeshPhongMaterial({ color: 0x77dd77, emissive: 0x1a4a1a }));
                        const a = st.padTh + 2.2;
                        const from = CENTER.clone().addScaledVector(padDir(a), MOON_R - 0.6);
                        flyby(blob, from, from.clone().addScaledVector(padDir(a), 1.4), 800, {
                            onDone: () => setTimeout(() => { if (scene) flyby(blob.clone(), blob.position.clone(), from, 800); }, 900)
                        });
                        beeps([[1600, 0.08, 0, 'square', 0.08], [1900, 0.08, 120, 'square', 0.08]]);
                        gameMsg('Something green peeked out of a crater. It waved?');
                    },
                    'UFO|SAUCER': () => {
                        const ufo = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.6, 0.5, 12),
                            new THREE.MeshStandardMaterial({ color: 0xc0c8d4, metalness: 0.9, roughness: 0.1 }));
                        flyby(ufo, new THREE.Vector3(60, 25, -10), new THREE.Vector3(-60, 18, -6), 1500, { spin: true });
                        beeps([[1400, 0.1, 0, 'square', 0.08], [900, 0.12, 130, 'square', 0.08]]);
                        gameMsg('A saucer buzzes the pattern. Rude.');
                    },
                    'FLAG': () => {
                        if (st.flagPlanted) { gameMsg('The flag already stands proud.'); return; }
                        st.flagPlanted = true;
                        const fg = new THREE.Group();
                        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6),
                            new THREE.MeshPhongMaterial({ color: 0xcccccc }));
                        pole.position.y = 0.8; fg.add(pole);
                        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5),
                            new THREE.MeshBasicMaterial({ color: 0xff4466, side: THREE.DoubleSide }));
                        cloth.position.set(0.48, 1.3, 0); fg.add(cloth);
                        const base = CENTER.clone().addScaledVector(padDir(st.padTh + 0.28), MOON_R + 0.05);
                        fg.position.copy(base);
                        fg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), padDir(st.padTh + 0.28));
                        scene.add(fg);
                        gameMsg('Flag planted beside the pad. History!');
                    },
                    'MOON|WOBBLE': () => {
                        tween(1600, k => {
                            const s = 1 + Math.sin(k * Math.PI * 2) * 0.05 * (1 - k);
                            st.moon.scale.set(s, 2 - s, s);
                        }, () => st.moon.scale.setScalar(1));
                        gameMsg('The moon jiggles like it is made of mochi.');
                    },
                    'CRATER|GEYSER': () => {
                        const a = Math.random() * Math.PI * 2;
                        puffBurst(CENTER.clone().addScaledVector(padDir(a), MOON_R + 0.3),
                            0xd0d0d0, 18, 0.6, { gravity: 0.0012, decay: 0.015, size: 0.09 });
                        gameMsg('A dust geyser vents from an old crater.');
                    },
                    'DUST': () => {
                        puffBurst(st.rocket.position.clone(), 0xbfbfbf, 16, 1.4, { decay: 0.02 });
                        gameMsg('Moon dust swirls around the ship.');
                    },
                    'SATELLITE': () => {
                        const sat = new THREE.Group();
                        const bus = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
                            new THREE.MeshStandardMaterial({ color: 0xccb84a, metalness: 0.6 }));
                        sat.add(bus);
                        [-0.9, 0.9].forEach(x => {
                            const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.5),
                                new THREE.MeshPhongMaterial({ color: 0x2244aa }));
                            panel.position.x = x; sat.add(panel);
                        });
                        flyby(sat, new THREE.Vector3(-55, 14, -12), new THREE.Vector3(55, 20, -12), 9000, { spin: true });
                        beeps([[2000, 0.05, 0, 'sine', 0.06], [2000, 0.05, 600, 'sine', 0.06], [2000, 0.05, 1200, 'sine', 0.06]]);
                        gameMsg('A satellite blinks past overhead.');
                    },
                    'ROVER': () => {
                        const rover = new THREE.Group();
                        const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.5),
                            new THREE.MeshStandardMaterial({ color: 0xd0d4da, metalness: 0.5 }));
                        chassis.position.y = 0.25; rover.add(chassis);
                        for (let i = 0; i < 4; i++) {
                            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 8),
                                new THREE.MeshPhongMaterial({ color: 0x222222 }));
                            wheel.rotation.x = Math.PI / 2;
                            wheel.position.set((i % 2) * 0.6 - 0.3, 0.14, (i < 2 ? 0.3 : -0.3));
                            rover.add(wheel);
                        }
                        const a0 = st.padTh - 0.9, a1 = st.padTh - 2.2;
                        const from = CENTER.clone().addScaledVector(padDir(a0), MOON_R + 0.15);
                        const to = CENTER.clone().addScaledVector(padDir(a1), MOON_R + 0.15);
                        rover.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), padDir(a0));
                        flyby(rover, from, to, 8000, { arc: 1.2 });
                        gameMsg('The old rover trundles between craters.');
                    },
                    'WAVE|HELLO': () => {
                        tween(1400, k => { st.rocket.rotation.z += Math.sin(k * Math.PI * 4) * 0.02; });
                        gameMsg('The ship waggles a friendly hello.');
                    },
                    'LIGHTS|BEACON|STROBE': () => {
                        st.strobeOn = !st.strobeOn;
                        gameMsg(st.strobeOn ? 'Nav strobe blinking.' : 'Strobe off.');
                    },
                    'MUSIC|SONG': () => {
                        beeps([[523, 0.18, 0, 'triangle', 0.14], [659, 0.18, 200, 'triangle', 0.14],
                               [784, 0.18, 400, 'triangle', 0.14], [659, 0.18, 600, 'triangle', 0.14],
                               [880, 0.4, 800, 'triangle', 0.16]]);
                        gameMsg('Mission control hums a little space waltz.');
                    },
                    'ECLIPSE': () => {
                        tween(3200, k => { st.light.intensity = 1.6 - Math.sin(k * Math.PI) * 1.3; });
                        gameMsg('The planet slides across the sun — brief, beautiful dark.');
                    },
                    'AURORA': () => {
                        for (let i = 0; i < 24; i++) fwParticle(
                            new THREE.Vector3(-30 + i * 2.5, -14 + Math.sin(i * 0.5) * 3, -30),
                            new THREE.Vector3(0, 0.05, 0),
                            new THREE.Color().setHSL(0.35 + Math.random() * 0.15, 0.9, 0.55),
                            { gravity: -0.0002, decay: 0.008, size: 0.16 });
                        gameMsg('An aurora curtain ripples along the horizon.');
                    },
                    'ASTEROID|ROCK': () => {
                        const ast = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0),
                            new THREE.MeshPhongMaterial({ color: 0x8a8378, flatShading: true }));
                        flyby(ast, new THREE.Vector3(65, -5, -25), new THREE.Vector3(-65, 12, -25), 6000, { spin: true });
                        gameMsg('A lumpy asteroid tumbles by, minding its business.');
                    },
                    'GALAXY|SPIRAL': () => {
                        for (let i = 0; i < 40; i++) {
                            const a = i * 0.5, r = 1 + i * 0.35;
                            fwParticle(new THREE.Vector3(30 + Math.cos(a) * r, 20 + Math.sin(a) * r * 0.5, -40),
                                new THREE.Vector3(-Math.sin(a) * 0.02, Math.cos(a) * 0.01, 0),
                                new THREE.Color().setHSL(0.65 + Math.random() * 0.1, 0.8, 0.7),
                                { gravity: 0, decay: 0.008, size: 0.1 });
                        }
                        gameMsg('A toy galaxy pinwheels into view.');
                    },
                    'DINO|DINOSAUR': () => {
                        const dino = new THREE.Group();
                        const dBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.7),
                            new THREE.MeshPhongMaterial({ color: 0x3f9b4f }));
                        dBody.position.y = 0.8; dino.add(dBody);
                        const dHead = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5),
                            new THREE.MeshPhongMaterial({ color: 0x3f9b4f }));
                        dHead.position.set(0.9, 1.4, 0); dino.add(dHead);
                        const dTail = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 5),
                            new THREE.MeshPhongMaterial({ color: 0x3f9b4f }));
                        dTail.rotation.z = Math.PI / 2; dTail.position.set(-1.2, 0.9, 0); dino.add(dTail);
                        const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6),
                            new THREE.MeshPhongMaterial({ color: 0xaaddff, transparent: true, opacity: 0.4 }));
                        helmet.position.set(0.9, 1.4, 0); dino.add(helmet);
                        const a0 = st.padTh + 1.1;
                        const from = CENTER.clone().addScaledVector(padDir(a0), MOON_R + 0.4);
                        const to = CENTER.clone().addScaledVector(padDir(a0 - 1.6), MOON_R + 0.4);
                        dino.scale.setScalar(0.8);
                        flyby(dino, from, to, 7000, { bob: true });
                        gameBeep(120, 0.6, 'sawtooth', 0.2);
                        gameMsg('A space dinosaur bounds across the regolith. Sure, why not.');
                    },
                    'SIGNAL|PING': () => {
                        for (let i = 0; i < 3; i++) setTimeout(() => {
                            const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 6, 24),
                                new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.7 }));
                            ringM.position.copy(st.rocket.position);
                            scene.add(ringM);
                            tween(1200, k => { ringM.scale.setScalar(1 + k * 6); ringM.material.opacity = 0.7 * (1 - k); },
                                () => scene.remove(ringM));
                            gameBeep(1500 - i * 200, 0.12, 'sine', 0.08);
                        }, i * 300);
                        gameMsg('Ping… ping… mission control sends its love.');
                    }
                }),
                update: () => {
                    // Phase physics (angle + altitude around the moon)
                    const flying = st.phase === 'ascent' && rf(() => RocketFlight.tick(st, rfctx, timeScale), false);
                    if (flying) {
                        // the ascent sim (RocketAscent) is driving the climb; see src/scenes/rocket/flight.js
                    } else if (st.phase === 'ascent') {
                        st.alt += 0.055 * timeScale;
                        flame(0.11);
                        if (st.alt >= 3 && !st.hint1) { st.hint1 = true; gameMsg('The spent booster is dragging us down… (something to SHED?)'); }
                        if (st.alt >= 7) { st.phase = 'coast'; gameMsg('Engine cutoff at altitude. Now make the path a circle…'); }
                    } else if (st.phase === 'coast') {
                        st.th += 0.0012 * st.dir * timeScale;
                        st.alt -= 0.006 * timeScale;
                        if (st.alt <= 2) { st.phase = 'ascent'; gameMsg('Falling back! Boosting to hold altitude…'); }
                    } else if (st.phase === 'orbit') {
                        const w = 0.011 * st.dir * timeScale;
                        st.th += w;
                        st.lap += Math.abs(w);
                        if (Math.random() < 0.4) fwParticle(st.rocket.position.clone(),
                            new THREE.Vector3(0, 0, 0), new THREE.Color(0x88ccff),
                            { gravity: 0, decay: 0.012, size: 0.07 });
                        if (st.lap >= Math.PI * 2 && !st.lapDone) {
                            st.lapDone = true;
                            gameMsg('FULL ORBIT COMPLETE! Now slow down and get back to the pad…', 6000);
                            gameBeep(880, 0.5, 'triangle', 0.2);
                        }
                    } else if (st.phase === 'deorbit') {
                        st.th += 0.006 * st.dir * timeScale;
                        st.alt += (2.5 - st.alt) * 0.01 * timeScale;
                        if (!st.hint2 && st.lapDone) { st.hint2 = true; }
                    } else if (st.phase === 'landing') {
                        st.th += angDiff(st.padTh, st.th) * 0.04 * timeScale;
                        st.alt = Math.max(0, st.alt - 0.045 * timeScale);
                        if (!rf(() => RocketFlight.legsReady(st), true)) st.alt = Math.max(st.alt, 0.3);   // touchdown waits for the legs
                        flame(0.08);
                        if (st.alt <= 0.01 && Math.abs(angDiff(st.th, st.padTh)) < 0.05) {
                            st.th = st.padTh; st.alt = 0; st.phase = 'landed';
                            puffBurst(st.rocket.position.clone(), 0xcccccc, 16, 1.2, { decay: 0.03 });
                            gameBeep(220, 0.5, 'sine', 0.2);
                            if (st.lapDone) gameWin('ONE SMALL LAP FOR ROCKETKIND');
                            else gameMsg('Down safe — but the moon was not circled. LAUNCH again!');
                        }
                    }

                    // Rocket transform: radial on/near the ground, tangent in orbit
                    st.rocket.position.copy(surfPos(st.th, st.alt));
                    const rad = radial();
                    const tan = new THREE.Vector3(-rad.y * st.dir, rad.x * st.dir, 0);
                    let upTarget = (st.phase === 'orbit' || st.phase === 'deorbit') ? tan : rad;
                    const tilt = rf(() => RocketFlight.attitude(st, rad, tan), null);   // gravity-turn pitch over
                    if (tilt) upTarget = tilt;
                    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upTarget);
                    st.rocket.quaternion.slerp(q, 0.08 * timeScale);
                    if (st.strobeOn) st.strobe.material.color.setHex(
                        (Math.floor(Date.now() / 250) % 2) ? 0xff2222 : 0x330000);

                    rf(() => RocketFlight.frame(st, rfctx, timeScale));   // tumbling spent stages

                    // Fixed wide view of the whole moon + orbit
                    targetCameraPos.set(0, 4, 44);
                    targetCameraLookAt.copy(CENTER);

                    gameStatus(st.phase.toUpperCase() + ' · alt ' + st.alt.toFixed(1) +
                        ' · lap ' + Math.min(100, Math.round(st.lap / (Math.PI * 2) * 100)) + '%' +
                        ' · fuel ' + Math.round(st.fuel * 100) + '%' + (st.lapDone ? ' · ORBIT LOGGED' : '') + rf(() => RocketFlight.status(st), ''));
                }
            });
            setObjective('MOON ROCKET',
                'Fly one full orbit around the moon, then land back on the pad. ' +
                'The ship answers to launch-day words — though something heavy may hold it back…');
        }

        SCENES['MOON ROCKET'] = { build: createMoonRocketScene, kind: 'level', menuOrder: 2 };
