/**
 * src/scenes/robot_factory/stage.js — LLF-78 [Robot-5] ROBOT FACTORY set dressing (THREE only).
 * Browser: window.RFStage. Builds everything you SEE around the RFCell physics: factory floor + walkways +
 * decals, walls and roof truss, high-bay lamps (shadow-casting spots), the CAD props from RFLayout.PROPS
 * (AssetLib.place / load, lod:false so the rigged arm keeps its joint nodes), the two arms bound to
 * RobotRig with gripper + vacuum tool on the flange, andon stack lights, light curtain, overhead hopper,
 * shipping crate, order board (canvas texture), and the background life (weld booth, vending machine,
 * radio bench, forklift, workers).
 *
 * Everything hangs under one root group created by the scene builder, so scene_swap's clean-slate wipe
 * owns it (later additions go into that root, never straight into the scene).
 * Coordinates: robot frame (Z up) via P(x, y, z) -> THREE (x, z, -y).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RFStage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function build(o) {
    var THREE = o.THREE || window.THREE, L = o.layout || window.RFLayout, cell = o.cell, rootG = o.root;
    var AL = typeof AssetLib !== 'undefined' ? AssetLib : (typeof window !== 'undefined' ? window.AssetLib : null);
    var Rig = typeof window !== 'undefined' ? window.RobotRig : null, M = typeof window !== 'undefined' ? window.RobotMotion : null;
    function V(x, y, z) { return new THREE.Vector3(x, z, -y); }
    function std(c, r, m, extra) { return new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r == null ? 0.6 : r, metalness: m || 0 }, extra || {})); }
    function mesh(geo, mat, x, y, z, parent) {
      var m = new THREE.Mesh(geo, mat); m.position.copy(V(x, y, z)); m.castShadow = true; m.receiveShadow = true;
      (parent || rootG).add(m); return m;
    }
    function boxAt(w, d, h, mat, x, y, z0, parent) { return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z0 + h / 2, parent); }
    function canvasTex(w, h, draw) {
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var g = cv.getContext('2d'); draw(g, w, h);
      var t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return { canvas: cv, ctx: g, tex: t };
    }
    var st = { arms: [], lamps: [], workers: [], t: 0 };

    // ------------------------------------------------------------------ floor, walkways, decals
    var floorTex = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#8b8f93'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 1800; i++) { g.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255' : '0,0,0') + ',' + (Math.random() * 0.05) + ')'; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6); }
      g.strokeStyle = 'rgba(40,40,40,0.35)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);   // saw-cut joints every 4 m
    });
    floorTex.tex.wrapS = floorTex.tex.wrapT = THREE.RepeatWrapping; floorTex.tex.repeat.set(10, 10);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), std(0xffffff, 0.32, 0.08, { map: floorTex.tex }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; rootG.add(floor);
    var yellow = std(0xf2c200, 0.5, 0, { emissive: 0x221a00 });
    function stripe(x0, y0, x1, y1, wdt) {
      var len = Math.hypot(x1 - x0, y1 - y0), m = new THREE.Mesh(new THREE.PlaneGeometry(len, wdt || 0.1), yellow);
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      m.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, 0.003)); m.receiveShadow = true; rootG.add(m); return m;
    }
    // aisle (forklift lane) and the walkway ringing the cell
    stripe(-12, -2.9, 12, -2.9); stripe(-12, -3.9, 12, -3.9);
    stripe(-2.5, 2.2, 2.5, 2.2); stripe(-2.5, -2.5, -2.5, 2.2); stripe(2.5, -2.5, 2.5, 2.2);
    stripe(-6, 2.25, 6, 2.25, 0.06);
    // hazard hatch under the light curtain + KEEP OUT decal
    var hatch = canvasTex(512, 64, function (g, w, h) {
      g.fillStyle = '#f2c200'; g.fillRect(0, 0, w, h); g.fillStyle = '#111';
      for (var x = -h; x < w; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.fill(); }
    });
    var hz = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.32), new THREE.MeshStandardMaterial({ map: hatch.tex, roughness: 0.6 }));
    hz.rotation.x = -Math.PI / 2; hz.position.copy(V(0, L.CURTAIN_Y, 0.004)); hz.receiveShadow = true; rootG.add(hz);
    var decal = canvasTex(512, 128, function (g, w, h) {
      g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(242,194,0,0.92)'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center';
      g.fillText('ROBOT CELL 1', w / 2, 58); g.font = 'bold 30px sans-serif'; g.fillText('AUTHORISED PERSONNEL ONLY', w / 2, 104);
    });
    var dm = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: decal.tex, transparent: true, roughness: 0.7 }));
    dm.rotation.x = -Math.PI / 2; dm.position.copy(V(0, -2.55, 0.005)); rootG.add(dm);

    // ------------------------------------------------------------------ building: walls, columns, roof truss
    var wallMat = std(0xb9bfc4, 0.85, 0.05), steel = std(0x5a6168, 0.5, 0.6), dark = std(0x2b2f33, 0.6, 0.4);
    boxAt(24, 0.2, 7.5, wallMat, 0, 7.0, 0);
    boxAt(0.2, 16, 7.5, wallMat, -11, -1, 0); boxAt(0.2, 16, 7.5, wallMat, 11, -1, 0);
    for (var cx = -9; cx <= 9; cx += 6) { boxAt(0.3, 0.3, L.ROOF, steel, cx, 6.7, 0); }
    for (var ty = -4; ty <= 6; ty += 2.5) boxAt(22, 0.18, 0.3, steel, 0, ty, L.ROOF);            // roof purlins (on the wall tops)
    for (var tx = -6; tx <= 6; tx += 3) boxAt(0.2, 11, 0.4, steel, tx, 0.75, L.ROOF - 0.4);     // truss chords
    // high-bay lamps: shade + chain rod up to the truss, shadow-casting spot over the cell
    L.HANGING.filter(function (h) { return /^lamp/.test(h.id); }).forEach(function (h, i) {
      mesh(new THREE.CylinderGeometry(0.02, 0.02, L.ROOF - 0.4 - h.zTop, 6), steel, h.x, h.y, (L.ROOF - 0.4 + h.zTop) / 2);
      var shade = mesh(new THREE.ConeGeometry(0.42, 0.3, 20, 1, true), std(0x3d4a55, 0.4, 0.7, { side: THREE.DoubleSide }), h.x, h.y, (h.zTop + h.zBottom) / 2);
      var bulb = mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff4d6 }), h.x, h.y, h.zBottom + 0.05);
      bulb.castShadow = false;
      if (i < 2) {
        var sp = new THREE.SpotLight(0xffffff, 0.7, 14, 0.75, 0.5, 1.2);
        sp.position.copy(V(h.x, h.y, h.zBottom)); sp.target.position.copy(V(h.x * 0.4, h.y - 0.6, 0));
        sp.castShadow = i === 0; sp.shadow.mapSize.set(1024, 1024);   // one shadow-casting high-bay keeps the frame cheap sp.shadow.camera.near = 0.5; sp.shadow.camera.far = 9; sp.shadow.bias = -0.0008;
        rootG.add(sp); rootG.add(sp.target); st.lamps.push(sp);
      }
      st.lamps.push(bulb);
    });
    var amb = new THREE.HemisphereLight(0xdfe8f0, 0x3a3530, 0.15); rootG.add(amb); st.amb = amb;

    // ------------------------------------------------------------------ CAD props from the layout table
    var placed = {};
    L.PROPS.forEach(function (p) {
      if (!p.asset || /^arm_/.test(p.id) || !AL) return;
      var t = V(p.x, p.y, p.z || 0);
      placed[p.id] = AL.place(p.asset, { x: t.x, y: t.y, z: t.z, rotY: p.yaw || 0, lod: false, parent: rootG });
    });
    st.placed = placed;
    // spare tools resting on the rack tops (rack top plate at 927 mm)
    if (AL) {
      AL.place('vacuum_tool', { x: -1.75, y: 0.927, z: 0.95, lod: false, parent: rootG });
      AL.place('gripper', { x: 1.75, y: 0.927, z: 0.95, lod: false, parent: rootG });
    }

    // ------------------------------------------------------------------ arms on pedestals
    L.ARM_BASES.forEach(function (a, i) {
      var holder = new THREE.Group(); holder.position.copy(V(a.x, a.y, L.PEDESTAL_H)); holder.rotation.y = a.yaw; rootG.add(holder);
      var arm = { holder: holder, rig: null, gripper: null, vacuum: null, ready: false, id: a.id };
      st.arms.push(arm);
      function attachTools(flange) {
        var mount = new THREE.Group(); mount.rotation.z = -Math.PI / 2; flange.add(mount);   // tool +Y -> flange +X
        arm.mount = mount;
        if (AL) {
          AL.load('gripper').then(function (g) { arm.gripper = g; mount.add(g); if (M) arm.fingers = M.bindFingers(g); syncTool(); });
          AL.load('vacuum_tool').then(function (g) { arm.vacuum = g; mount.add(g); syncTool(); });
        }
      }
      function useProxy() {
        if (!Rig || arm.rig) return;
        var proxy = Rig.buildProxyArm(THREE, cell.arms[i].chain, { color: 0xf2a900 });
        holder.add(proxy);
        arm.rig = Rig.bind(proxy); attachTools(proxy.getObjectByName('J6_flange')); bindToCell();
      }
      function bindToCell() {
        var ca = cell.arms[i]; ca.rig = arm.rig; arm.ready = true;
        try { arm.rig.setJoints(ca.q); } catch (e) { /* keep going */ }
      }
      if (AL && Rig) {
        AL.load('robot_arm').then(function (g) {
          try {
            g.traverse(function (n) { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            holder.add(g);
            arm.rig = Rig.bind(g);
            attachTools(g.getObjectByName('J6_flange') || arm.rig.nodes[5]);
            bindToCell();
          } catch (e) { try { holder.remove(g); } catch (e2) { /* ignore */ } useProxy(); }
        });
        setTimeout(function () { if (!arm.rig) useProxy(); }, 9000);
      } else if (Rig) useProxy();
      function syncTool() {
        var tool = cell.arms[i].tool;
        if (arm.gripper) arm.gripper.visible = tool !== 'vacuum';
        if (arm.vacuum) arm.vacuum.visible = tool === 'vacuum';
        cell.arms[i].fingers = tool !== 'vacuum' ? (arm.fingers || null) : null;
      }
      arm.syncTool = syncTool;
    });

    // ------------------------------------------------------------------ andon stack lights (floor poles)
    st.andons = L.ARM_BASES.map(function (a, i) {
      var p = L.byId('andon_' + a.id);
      boxAt(0.2, 0.2, 0.02, dark, p.x, p.y, 0);
      mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), steel, p.x, p.y, 0.72);
      var cols = [0x22dd44, 0xffb000, 0xff2a1a], lights = [];
      cols.forEach(function (c, k) {
        var m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, roughness: 0.3, transparent: true, opacity: 0.92 });
        lights.push(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 16), m, p.x, p.y, 1.47 + (2 - k) * 0.105));
      });
      mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 16), dark, p.x, p.y, 1.75);
      return { lights: lights, state: 'green', flash: false };
    });
    st.setAndon = function (i, state, flash) { var a = st.andons[i]; if (a) { a.state = state; a.flash = !!flash; } };

    // ------------------------------------------------------------------ light curtain
    var beams = [];
    [-1, 1].forEach(function (sx) {
      var p = L.byId(sx < 0 ? 'curtain_L' : 'curtain_R');
      boxAt(0.12, 0.12, 0.02, dark, p.x, p.y, 0);
      boxAt(0.07, 0.07, 1.8, std(0xf2c200, 0.5, 0.2), p.x, p.y, 0.02);
      boxAt(0.03, 0.04, 1.6, std(0x111111, 0.3, 0.1, { emissive: 0x330000 }), p.x - sx * 0.05, p.y, 0.15);
    });
    for (var bz = 0.25; bz < 1.7; bz += 0.15) {
      var bm = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.18, depthWrite: false }));
      bm.position.copy(V(0, L.CURTAIN_Y, bz)); rootG.add(bm); beams.push(bm);
    }
    st.curtain = { beams: beams, broken: false, setBroken: function (b) { this.broken = b; } };

    // ------------------------------------------------------------------ overhead hopper (hung from the truss)
    var hp = L.HANGING[0];
    var hopper = mesh(new THREE.CylinderGeometry(0.5, 0.16, hp.zTop - hp.zBottom, 4, 1, true), std(0x7d8790, 0.45, 0.6, { side: THREE.DoubleSide }), hp.x, hp.y, (hp.zTop + hp.zBottom) / 2);
    hopper.rotation.y = Math.PI / 4;
    mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), steel, hp.x, hp.y, hp.zTop + 0.02);
    [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].forEach(function (d) {
      mesh(new THREE.CylinderGeometry(0.015, 0.015, L.ROOF - 0.4 - hp.zTop, 6), steel, hp.x + d[0], hp.y + d[1], (L.ROOF - 0.4 + hp.zTop) / 2);
    });
    var door = new THREE.Group(); door.position.copy(V(hp.x - 0.12, hp.y, hp.zBottom)); rootG.add(door);
    var doorPlate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.24), std(0xf2c200, 0.5, 0.3)); doorPlate.position.x = 0.12; doorPlate.castShadow = true; door.add(doorPlate);
    st.hopperDoor = door;

    // ------------------------------------------------------------------ shipping crate (open-top, on the floor)
    var cr = L.CRATE, wood = std(0x9c7448, 0.85, 0);
    boxAt(cr.hx * 2, cr.hy * 2, 0.03, wood, cr.x, cr.y, 0);
    boxAt(cr.hx * 2, 0.03, cr.h, wood, cr.x, cr.y - cr.hy + 0.015, 0); boxAt(cr.hx * 2, 0.03, cr.h, wood, cr.x, cr.y + cr.hy - 0.015, 0);
    boxAt(0.03, cr.hy * 2, cr.h, wood, cr.x - cr.hx + 0.015, cr.y, 0); boxAt(0.03, cr.hy * 2, cr.h, wood, cr.x + cr.hx - 0.015, cr.y, 0);

    // ------------------------------------------------------------------ order board on two floor posts
    var B = L.BOARD;
    boxAt(0.12, 0.12, B.zMid + B.h / 2, steel, -B.w / 2 - 0.1, B.y, 0); boxAt(0.12, 0.12, B.zMid + B.h / 2, steel, B.w / 2 + 0.1, B.y, 0);
    boxAt(B.w + 0.3, 0.08, B.h + 0.16, dark, 0, B.y + 0.06, B.zMid - B.h / 2 - 0.08);
    var board = canvasTex(1024, 600, function (g, w, h) { g.fillStyle = '#0b1218'; g.fillRect(0, 0, w, h); });
    var bp = new THREE.Mesh(new THREE.PlaneGeometry(B.w, B.h), new THREE.MeshBasicMaterial({ map: board.tex }));
    bp.position.copy(V(0, B.y - 0.01, B.zMid)); rootG.add(bp);
    st.board = board;

    // ------------------------------------------------------------------ background life
    var wb = L.byId('weld_booth');
    boxAt(1.8, 1.8, 0.05, dark, wb.x, wb.y, 0);
    [[-0.9, 0], [0.9, 0]].forEach(function (d) { boxAt(0.05, 1.8, 2.2, std(0x6b7076, 0.6, 0.4), wb.x + d[0], wb.y, 0); });
    boxAt(1.8, 0.05, 2.2, std(0x6b7076, 0.6, 0.4), wb.x, wb.y + 0.9, 0);
    var curtainW = boxAt(1.7, 0.02, 1.9, new THREE.MeshStandardMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.55, roughness: 0.9 }), wb.x, wb.y - 0.9, 0.2);
    curtainW.castShadow = false;
    boxAt(0.8, 0.5, 0.85, steel, wb.x, wb.y + 0.2, 0.05);
    st.weldLight = new THREE.PointLight(0x9fd0ff, 0, 6); st.weldLight.position.copy(V(wb.x, wb.y, 1.2)); rootG.add(st.weldLight);
    st.weldPos = V(wb.x, wb.y - 0.2, 0.95);
    var vm = L.byId('vending');
    boxAt(0.9, 0.8, 1.9, std(0xc0392b, 0.4, 0.3), vm.x, vm.y, 0);
    var vpanel = mesh(new THREE.PlaneGeometry(0.6, 1.1), new THREE.MeshStandardMaterial({ color: 0xddeeff, emissive: 0x7fb8ff, emissiveIntensity: 0.5 }), vm.x - 0.08, vm.y - 0.41, 1.15);
    vpanel.rotation.y = 0;
    st.vendingPos = V(vm.x, vm.y - 0.9, 0);
    var be = L.byId('bench');
    boxAt(1.4, 0.7, 0.05, wood, be.x, be.y, 0.85);
    [[-0.65, -0.3], [0.65, -0.3], [-0.65, 0.3], [0.65, 0.3]].forEach(function (d) { boxAt(0.05, 0.05, 0.85, steel, be.x + d[0], be.y + d[1], 0); });
    var ra = L.byId('radio');
    st.radio = boxAt(0.32, 0.16, 0.18, std(0x333a40, 0.5, 0.3), ra.x, ra.y, 0.9);
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 16), std(0x111111, 0.4), ra.x - 0.07, ra.y - 0.081, 0.99).rotation.x = Math.PI / 2;
    st.radioPos = V(ra.x, ra.y, 1.15);

    // forklift (procedural: chassis, counterweight, mast, forks, overhead guard, wheels) parked at the aisle start
    var fk = new THREE.Group();
    var orange = std(0xf28c28, 0.5, 0.2);
    function fkBox(w, d, h, mat, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.copy(V(x, y, z + h / 2)); m.castShadow = true; fk.add(m); return m; }
    fkBox(1.0, 1.6, 0.55, orange, 0, 0, 0.2); fkBox(1.0, 0.4, 0.45, dark, 0, -0.75, 0.75);
    fkBox(0.08, 0.08, 1.25, steel, -0.42, -0.45, 0.75); fkBox(0.08, 0.08, 1.25, steel, 0.42, -0.45, 0.75);   // overhead-guard posts
    fkBox(0.08, 0.08, 1.25, steel, -0.42, 0.65, 0.75); fkBox(0.08, 0.08, 1.25, steel, 0.42, 0.65, 0.75);
    var mast = fkBox(0.8, 0.08, 1.9, steel, 0, 0.9, 0.1);
    fkBox(0.12, 1.0, 0.05, steel, -0.25, 1.4, 0.12); fkBox(0.12, 1.0, 0.05, steel, 0.25, 1.4, 0.12);
    fkBox(1.0, 1.0, 0.05, dark, 0, 0.1, 2.0);
    [[-0.5, 0.55], [0.5, 0.55], [-0.5, -0.55], [0.5, -0.55]].forEach(function (d) {
      var w = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 14), dark); w.rotation.z = Math.PI / 2; w.position.copy(V(d[0], d[1], 0.2)); w.castShadow = true; fk.add(w);
    });
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffa000 })); beacon.position.copy(V(0, 0.1, 2.1)); fk.add(beacon);
    fk.userData.beacon = beacon; fk.visible = false; rootG.add(fk);
    st.forklift = fk;
    void mast;

    // ------------------------------------------------------------------ overlay group (PLAN)
    st.overlay = new THREE.Group(); st.overlay.visible = false; rootG.add(st.overlay);
    var shellCols = [0x3fa9ff, 0xff7ad9];
    st.shells = L.ARM_BASES.map(function (a, i) {
      var g = new THREE.Group();
      var r = 1.42;
      var sh = new THREE.Mesh(new THREE.SphereGeometry(r, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
        new THREE.MeshBasicMaterial({ color: shellCols[i], transparent: true, opacity: 0.045, depthWrite: false, side: THREE.FrontSide }));
      var wf = new THREE.Mesh(sh.geometry, new THREE.MeshBasicMaterial({ color: shellCols[i], wireframe: true, transparent: true, opacity: 0.1, depthWrite: false }));
      g.add(sh); g.add(wf);
      g.position.copy(V(a.x + Math.cos(a.yaw) * 0.15, a.y + Math.sin(a.yaw) * 0.15, L.PEDESTAL_H + 0.45));
      st.overlay.add(g);
      return g;
    });
    st.armColors = shellCols;
    st.linePool = [];
    st.markPool = [];

    st.update = function (dt) {
      st.t += dt;
      // andons
      st.andons.forEach(function (a) {
        var on = { green: 0, amber: 1, red: 2 }[a.state], blink = !a.flash || (Math.floor(st.t * 4) % 2 === 0);
        a.lights.forEach(function (m, k) { m.material.emissiveIntensity = k === on && blink ? 2.2 : 0.08; });
      });
      // curtain beams glow when broken
      st.curtain.beams.forEach(function (b, k) { b.material.opacity = st.curtain.broken ? (0.45 + 0.4 * Math.sin(st.t * 18 + k)) : 0.16; b.material.color.setHex(st.curtain.broken ? 0xff0000 : 0xff3030); });
      // hopper door follows the cell
      st.hopperDoor.rotation.z = -cell.hopperDoor * 1.3;
      if (st.forklift.visible) st.forklift.userData.beacon.material.color.setHex(Math.floor(st.t * 3) % 2 ? 0xffa000 : 0x553300);
      if (st.weldLight.intensity > 0) st.weldLight.intensity = Math.max(0, st.weldLight.intensity - dt * 3);
    };
    return st;
  }

  return { build: build };
});
