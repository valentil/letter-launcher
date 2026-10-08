/**
 * src/scenes/robot_factory/director.js — LLF-80 [Robot-7] ROBOT FACTORY camera director + phone HUD.
 * Browser: window.RFDirector.  Node: require('./src/scenes/robot_factory/director.js') (pure helpers only).
 *
 * Cameras (CLOSE word, Tab or Shift+C, or the camera button on touch screens cycle them):
 *   OVERVIEW     the default 3/4 view of the cell (RFLayout.CAMERA), pulled back on narrow / portrait screens
 *                until the whole cell fits
 *   A1 / A2      over-the-shoulder of each arm: behind and above the pedestal, looking along the arm at its work
 *   BIN          top-down over the tote with the occlusion heat overlay (green = clear on top, red = buried)
 *   TRAY         the type tray from the front, a little above, so the set letters read left to right
 * Every close-up zoom-fits its subject's bounding box: fitCameraToBox() puts the 8 box corners inside the view
 * frustum for the camera's actual fov and aspect (the narrower of the two fovs decides on a phone), with a small
 * margin. Close-ups own the camera in the LLHooks 'frame' hook (after the engine's lerp, before render), so mouse
 * parallax cannot push the subject out of frame; the overview keeps the engine's parallax.
 *
 * Phone HUD (< 600 px wide): the PLAN Gantt collapses to one progress bar (order letters set + shift clock), and a
 * compact order strip replaces the 3D board text that is too small to read at 390 px.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RFDirector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var NARROW_PX = 600;
  var CAMS = ['OVERVIEW', 'A1', 'A2', 'BIN', 'TRAY'];
  var LABEL = { OVERVIEW: 'OVERVIEW', A1: 'ARM A1 · OVER THE SHOULDER', A2: 'ARM A2 · OVER THE SHOULDER', BIN: 'BIN CAM · OCCLUSION HEAT', TRAY: 'TRAY CAM' };

  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /**
   * Zoom-fit: camera position that frames the axis-aligned box {min:[x,y,z], max:[x,y,z]} (THREE frame, Y up)
   * looking along -dir (dir points from the subject toward the camera). fovDeg is the VERTICAL fov, aspect = w/h.
   * Returns {pos, look, dist}: every corner lies inside the frustum with `margin` (1.1 = 10 % air).
   */
  function fitCameraToBox(box, dir, fovDeg, aspect, margin, minDist) {
    var mn = box.min, mx = box.max;
    var c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    var back = norm(dir), fwd = [-back[0], -back[1], -back[2]];
    var upHint = Math.abs(back[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
    var right = norm(cross(fwd, upHint)), up = cross(right, fwd);
    var tv = Math.tan(fovDeg * Math.PI / 360), th = tv * (aspect > 0 ? aspect : 1);
    margin = margin || 1.1;
    var d = 0;
    for (var i = 0; i < 8; i++) {
      var p = [i & 1 ? mx[0] : mn[0], i & 2 ? mx[1] : mn[1], i & 4 ? mx[2] : mn[2]];
      var r = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      var x = dot(r, right) * margin, y = dot(r, up) * margin, z = dot(r, fwd);   // z > 0 = beyond the centre
      // corner at depth (d + z) must satisfy |x| <= (d + z) * th and |y| <= (d + z) * tv
      d = Math.max(d, Math.abs(x) / th - z, Math.abs(y) / tv - z);
    }
    d = Math.max(d, minDist || 0.3);
    return { pos: [c[0] + back[0] * d, c[1] + back[1] * d, c[2] + back[2] * d], look: c, dist: d };
  }
  /** True when every corner of box projects inside NDC [-1,1] for a camera at pos looking at look. */
  function boxInView(box, pos, look, fovDeg, aspect) {
    var fwd = norm([look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]]);
    var upHint = Math.abs(fwd[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
    var right = norm(cross(fwd, upHint)), up = cross(right, fwd);
    var tv = Math.tan(fovDeg * Math.PI / 360), th = tv * aspect;
    for (var i = 0; i < 8; i++) {
      var p = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
      var r = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]], z = dot(r, fwd);
      if (z <= 0) return false;
      if (Math.abs(dot(r, right)) / (z * th) > 1.0001 || Math.abs(dot(r, up)) / (z * tv) > 1.0001) return false;
    }
    return true;
  }
  function nextCam(i, dir) { return (i + (dir < 0 ? CAMS.length - 1 : 1)) % CAMS.length; }
  /** Andon heat colour for a glyph's visible fraction (1 = clear on top -> green, 0 = buried -> red). */
  function heatColor(vis) {
    var v = Math.max(0, Math.min(1, +vis || 0));
    var r = Math.round(255 * Math.min(1, 2 * (1 - v))), g = Math.round(220 * Math.min(1, 2 * v));
    return 'rgb(' + r + ',' + g + ',40)';
  }
  /** Phone-strip text for the order list: "OPEN ✓ · SALE 2/4 · EXIT …" */
  function orderStrip(orders, cur) {
    return (orders || []).map(function (o) {
      if (o.state === 'shipped') return o.key + ' ✓';
      if (o.state === 'active' && cur) return o.key + ' ' + cur.slots.filter(function (s) { return s.state === 'set'; }).length + '/' + cur.slots.length;
      if (o.state === 'queued') return o.key + ' …';
      return o.key;
    }).join(' · ');
  }

  // ------------------------------------------------------------------ browser director
  function create(o) {
    var THREE = o.THREE || window.THREE, L = o.layout, stage = o.stage, cell = o.cell, root = o.root;
    var d = { idx: 0, pos: null, look: null, heat: null, heatT: 0, dom: null, flashT: 0, fitted: null };
    function V(x, y, z) { return new THREE.Vector3(x, z, -y); }
    function boxOf(obj, fallback) {
      try {
        if (obj) { var b = new THREE.Box3().setFromObject(obj); if (!b.isEmpty() && isFinite(b.min.x)) return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] }; }
      } catch (e) { /* fall back */ }
      return fallback;
    }
    function rbox(x0, y0, z0, x1, y1, z1) {   // robot-frame extents -> THREE box
      return { min: [Math.min(x0, x1), Math.min(z0, z1), Math.min(-y0, -y1)], max: [Math.max(x0, x1), Math.max(z0, z1), Math.max(-y0, -y1)] };
    }
    function aspect() { return typeof window !== 'undefined' && window.innerHeight ? window.innerWidth / window.innerHeight : 16 / 9; }
    function fov() { return typeof camera !== 'undefined' && camera ? camera.fov : 75; }

    function subject(name) {
      var B = L.BIN, T = L.TRAY;
      if (name === 'BIN') return { box: rbox(B.x - 0.61, B.y - 0.41, 0.6, B.x + 0.61, B.y + 0.41, 1.1), dir: [0, 1, 0.4], margin: 1.06 };
      // the slot rail + standing letters (not the legs); from the front, high enough to look over the tote's back rim
      // and its pile, under the hopper even on a phone's long throw
      if (name === 'TRAY') return { box: rbox(T.x - 1.72, T.y - 0.125, 0.62, T.x + 1.72, T.y + 0.125, 0.98), dir: [0, 1, 1], margin: 1.08 };
      if (name === 'A1' || name === 'A2') {
        var i = name === 'A1' ? 0 : 1, a = L.ARM_BASES[i], s = i === 0 ? -1 : 1;
        var arm = stage.arms[i];
        // the arm itself (pedestal to tool) + the reach it is working in (its half of tote and tray)
        var b = boxOf(arm && arm.holder, rbox(a.x - 0.4, a.y - 0.4, 0, a.x + 0.4, a.y + 0.4, 1.9));
        var work = rbox(s < 0 ? -1.5 : 0, B.y - 0.4, 0.55, s < 0 ? 0 : 1.5, T.y + 0.15, 1.0);
        var u = { min: [Math.min(b.min[0], work.min[0]), 0, Math.min(b.min[2], work.min[2])], max: [Math.max(b.max[0], work.max[0]), Math.max(b.max[1], work.max[1]), Math.max(b.max[2], work.max[2])] };
        // behind the pedestal (outboard), above, slightly toward the camera side: over the shoulder
        return { box: u, dir: [s * 0.75, 1.05, 0.6], margin: 1.04 };
      }
      // overview: the fenced cell + the board top; never closer than the authored camera
      return { box: rbox(-L.FENCE_X, L.CURTAIN_Y + 0.4, 0, L.FENCE_X, L.FENCE_Y, 2.0), dir: null, margin: 1.0 };
    }

    function target() {
      var name = CAMS[d.idx], s = subject(name), C = L.CAMERA;
      if (name === 'OVERVIEW') {
        var pos = V(C.pos[0], C.pos[1], C.pos[2]), look = V(C.look[0], C.look[1], C.look[2]);
        var dir = [pos.x - look.x, pos.y - look.y, pos.z - look.z], dist0 = Math.hypot(dir[0], dir[1], dir[2]);
        var f = fitCameraToBox(s.box, dir, fov(), aspect(), 1.0);
        // only pull back (portrait phones); landscape keeps the authored framing
        var k = f.dist > dist0 && aspect() < 1.2 ? f.dist / dist0 : 1;
        return { pos: [look.x + dir[0] * k, look.y + dir[1] * k, look.z + dir[2] * k], look: [look.x, look.y, look.z], fit: f };
      }
      var g = fitCameraToBox(s.box, s.dir, fov(), aspect(), s.margin, 0.6);
      return { pos: g.pos, look: g.look, fit: g, box: s.box };
    }

    function setCam(i, quiet) {
      d.idx = ((i % CAMS.length) + CAMS.length) % CAMS.length;
      d.fitted = null; d.cut = true;   // director cuts between cameras (no slow fly-through the fence)
      if (d.heat) d.heat.mesh.visible = CAMS[d.idx] === 'BIN';
      if (!quiet && typeof gameMsg === 'function') gameMsg('Camera: ' + LABEL[CAMS[d.idx]] + (d.idx ? ' — CLOSE again for the next, Tab cycles' : ''), 3000);
      ensureDom(); if (d.dom) { d.dom.label.textContent = '📷 ' + LABEL[CAMS[d.idx]]; d.dom.label.style.opacity = '1'; d.flashT = 2.5; }
    }

    // ---------------------------------------------------------------- bin occlusion heat overlay
    function buildHeat() {
      var cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
      var tex = new THREE.CanvasTexture(cv);
      var bin = cell.bin.BIN || { halfX: 0.522, halfZ: 0.322, floorY: 0.603, wallH: 0.49 };
      var m = new THREE.Mesh(new THREE.PlaneGeometry(bin.halfX * 2, bin.halfZ * 2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.85 }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 12;
      m.position.set(L.BIN.x, bin.floorY + bin.wallH + 0.02, -L.BIN.y);
      m.visible = false; root.add(m);
      d.heat = { mesh: m, cv: cv, ctx: cv.getContext('2d'), tex: tex, bin: bin };
    }
    function drawHeat() {
      var h = d.heat, g = h.ctx, W = h.cv.width, H = h.cv.height, bin = h.bin;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
      var occ = {};
      try { occ = cell.bin.occlusionMap(); } catch (e) { /* ignore */ }
      var sx = W / (bin.halfX * 2), sz = H / (bin.halfZ * 2), ox = L.BIN.x, oz = -L.BIN.y;
      var list = cell.bin.glyphs.slice().sort(function (a, b) { return a.body.position.y - b.body.position.y; });   // low first, top drawn last
      list.forEach(function (gl) {
        var p = gl.body.position, om = occ[gl.id] || { visibleFraction: 1 };
        var x = (p.x - ox + bin.halfX) * sx, y = (p.z - oz + bin.halfZ) * sz;
        g.globalAlpha = 0.75; g.fillStyle = heatColor(om.visibleFraction);
        g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1; g.fillStyle = '#fff'; g.font = 'bold 12px monospace'; g.textAlign = 'center'; g.fillText(gl.ch, x, y + 4);
      });
      h.tex.needsUpdate = true;
    }

    // ---------------------------------------------------------------- DOM: camera label/button, phone strip + progress bar
    function narrow() { return typeof window !== 'undefined' && window.innerWidth < NARROW_PX; }
    function ensureDom() {
      if (d.dom || typeof document === 'undefined') return;
      var label = document.createElement('div'); label.id = 'rfCamLabel';
      label.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:max(10px,env(safe-area-inset-top));z-index:230;pointer-events:none;' +
        'background:rgba(8,14,20,0.72);color:#cfe8ff;font:600 12px/1.2 monospace;padding:5px 10px;border-radius:6px;opacity:0;transition:opacity .4s;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      var btn = document.createElement('button'); btn.id = 'rfCamBtn'; btn.type = 'button'; btn.textContent = '📷';
      btn.setAttribute('aria-label', 'Next camera');
      btn.style.cssText = 'position:fixed;right:max(12px,env(safe-area-inset-right));bottom:calc(72px + env(safe-area-inset-bottom));min-width:48px;min-height:48px;border-radius:24px;' +
        'border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.6);color:#fff;font-size:20px;z-index:400;touch-action:manipulation;display:none';
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); setCam(nextCam(d.idx, 1)); });
      var strip = document.createElement('div'); strip.id = 'rfOrderStrip';
      strip.style.cssText = 'position:fixed;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:128px;z-index:205;pointer-events:none;' +
        'display:none;background:rgba(8,14,20,0.78);color:#e8f1f8;font:600 clamp(12px,3.6vw,15px)/1.3 monospace;padding:6px 8px;border-radius:8px;box-sizing:border-box;overflow-wrap:anywhere;text-align:center';
      var bar = document.createElement('div'); bar.id = 'rfProgress';
      bar.style.cssText = 'position:fixed;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:180px;height:14px;z-index:205;' +
        'display:none;background:rgba(8,14,20,0.8);border:1px solid #3fa9ff;border-radius:7px;overflow:hidden;pointer-events:none;box-sizing:border-box';
      var fill = document.createElement('div'); fill.style.cssText = 'height:100%;width:0;background:linear-gradient(90deg,#3fa9ff,#4cd964);transition:width .3s';
      var txt = document.createElement('div'); txt.style.cssText = 'position:absolute;inset:0;font:600 10px/12px monospace;color:#fff;text-align:center';
      bar.appendChild(fill); bar.appendChild(txt);
      [label, btn, strip, bar].forEach(function (el) { document.body.appendChild(el); });
      d.dom = { label: label, btn: btn, strip: strip, bar: bar, fill: fill, txt: txt, all: [label, btn, strip, bar] };
    }
    /** HUD state each frame: R = the scene state (orders, clock, planOn, gantt canvas). */
    function hud(R) {
      ensureDom(); if (!d.dom) return;
      var n = narrow(), touch = typeof document !== 'undefined' && document.body.classList.contains('touch-play');
      d.dom.btn.style.display = touch || n ? 'block' : 'none';
      var playing = typeof menuScreen === 'undefined' || menuScreen === 'PLAYING';
      if (!playing) { d.dom.strip.style.display = d.dom.bar.style.display = 'none'; return; }
      var cur = R.cell.current;
      // stack strip + bar just above whatever bottom HUD is showing (typing box, controls hint), never under it
      var anchor = window.innerHeight;
      ['wordHud', 'controlsHint', 'kbButton'].forEach(function (id) {
        var el = document.getElementById(id); if (!el || getComputedStyle(el).display === 'none') return;
        var r = el.getBoundingClientRect(); if (r.height > 0 && r.top > window.innerHeight * 0.5) anchor = Math.min(anchor, r.top);
      });
      var stripH = d.dom.strip.style.display === 'none' ? 0 : d.dom.strip.offsetHeight + 6;
      d.dom.strip.style.bottom = Math.round(window.innerHeight - anchor + 6) + 'px';
      d.dom.bar.style.bottom = Math.round(window.innerHeight - anchor + 6 + stripH) + 'px';
      if (n && !R.sandbox) {
        var s = orderStrip(R.orders, cur);
        if (d.dom.strip._t !== s) { d.dom.strip._t = s; d.dom.strip.textContent = s; }
        d.dom.strip.style.display = 'block';
      } else d.dom.strip.style.display = 'none';
      // PLAN on a phone: the Gantt collapses into one progress bar
      var showBar = n && R.planOn;
      if (R.gantt) R.gantt.style.display = R.planOn && !n ? 'block' : 'none';
      if (R.panel) R.panel.style.display = R.planOn && !n ? 'block' : 'none';
      d.dom.bar.style.display = showBar ? 'block' : 'none';
      if (showBar) {
        var m = cur ? cur.slots.length : 0, k = cur ? cur.slots.filter(function (x) { return x.state === 'set'; }).length : 0;
        d.dom.fill.style.width = (m ? Math.round(100 * k / m) : 0) + '%';
        var clk = R.sandbox ? '' : ' · ' + Math.floor(Math.max(0, R.clock) / 60) + ':' + ('0' + Math.floor(Math.max(0, R.clock) % 60)).slice(-2);
        var t = (cur ? cur.word + ' ' + k + '/' + m : 'tray empty') + (R.cell.planner ? ' · solving' : '') + clk;
        if (d.dom.txt._t !== t) { d.dom.txt._t = t; d.dom.txt.textContent = t; }
      }
    }

    // ---------------------------------------------------------------- per-frame (level update) + camera hook
    function update(dt, R) {
      var tg = target();
      d.fitted = tg;
      if (typeof targetCameraPos !== 'undefined') { targetCameraPos.set(tg.pos[0], tg.pos[1], tg.pos[2]); targetCameraLookAt.set(tg.look[0], tg.look[1], tg.look[2]); }
      if (CAMS[d.idx] === 'BIN') {
        if (!d.heat) buildHeat();
        d.heat.mesh.visible = true;
        d.heatT -= dt; if (d.heatT <= 0) { d.heatT = 0.4; drawHeat(); }
      }
      if (d.flashT > 0) { d.flashT -= dt; if (d.flashT <= 0 && d.dom && d.idx === 0) d.dom.label.style.opacity = '0'; }
      if (R) hud(R);
    }
    /** After the engine lerp (LLHooks 'frame'): close-ups own the camera (no parallax drift off the subject). */
    function frameHook() {
      if (!d.fitted || typeof camera === 'undefined' || !camera) return;
      var P = d.fitted.pos, Lk = d.fitted.look;
      if (!d.pos) { d.pos = new THREE.Vector3().copy(camera.position); d.look = new THREE.Vector3().copy(typeof currentCameraLookAt !== 'undefined' ? currentCameraLookAt : new THREE.Vector3()); }
      if (d.idx === 0) {
        if (d.cut) { d.cut = false; camera.position.set(P[0], P[1], P[2]); camera.lookAt(Lk[0], Lk[1], Lk[2]); if (typeof currentCameraLookAt !== 'undefined') currentCameraLookAt.set(Lk[0], Lk[1], Lk[2]); }
        d.pos.copy(camera.position); if (typeof currentCameraLookAt !== 'undefined') d.look.copy(currentCameraLookAt); return;
      }
      if (d.cut) { d.cut = false; d.pos.set(P[0], P[1], P[2]); d.look.set(Lk[0], Lk[1], Lk[2]); }
      d.pos.lerp(new THREE.Vector3(P[0], P[1], P[2]), 0.2);     // close-ups follow a moving arm's box smoothly
      d.look.lerp(new THREE.Vector3(Lk[0], Lk[1], Lk[2]), 0.2);
      camera.position.copy(d.pos); camera.lookAt(d.look);
      if (typeof currentCameraLookAt !== 'undefined') currentCameraLookAt.copy(d.look);
    }
    function dispose() {
      if (d.dom) d.dom.all.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
      d.dom = null;
    }
    return {
      state: d, update: update, frameHook: frameHook, dispose: dispose, hud: hud,
      cycle: function (dir) { setCam(nextCam(d.idx, dir || 1)); return CAMS[d.idx]; },
      set: function (name) { var i = CAMS.indexOf(name); if (i >= 0) setCam(i, true); return CAMS[d.idx]; },
      get cam() { return CAMS[d.idx]; },
      target: target, subject: subject
    };
  }

  return { create: create, fitCameraToBox: fitCameraToBox, boxInView: boxInView, nextCam: nextCam, heatColor: heatColor,
    orderStrip: orderStrip, CAMS: CAMS, LABEL: LABEL, NARROW_PX: NARROW_PX };
});
