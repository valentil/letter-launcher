// Letter Launcher - src/core/progress.js (LLF-88)
// Progression + save: per level {completed, bestTimeS, stars, wordsFound[]} in localStorage
// (try/catch, in-memory fallback), level-select cards (preview, stars, best time) and the
// Robot Factory shift-unlock API. Classic script; global `Progress`.
//   stars: 1 = finished, 2 = finished under par time, 3 = finished with all doodads found
var Progress = (function () {
    var KEY = 'll_progress_v1';
    var DEFAULT_PAR_S = 180;
    var mem = {};            // in-memory fallback / cache
    var loaded = false;
    var run = null;          // current attempt {name, t0}

    // Registry of shift-gated maps. The Robot Factory map does not exist yet; when it lands it
    // calls Progress.recordShift('ROBOT FACTORY', n, {...}) and asks Progress.isUnlocked(name, n).
    var SHIFT_GATES = { 'ROBOT FACTORY': { shifts: 3, minStarsToUnlockNext: 1 } };
    var flags = { robotFactoryShiftGating: true, robotFactoryMapPresent: false };

    function store() { try { return window.localStorage; } catch (e) { return null; } }
    function load() {
        if (loaded) return mem;
        loaded = true;
        try {
            var s = store(), raw = s && s.getItem(KEY);
            if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') mem = o; }
        } catch (e) {}
        return mem;
    }
    function save() { try { var s = store(); if (s) s.setItem(KEY, JSON.stringify(mem)); } catch (e) {} }

    // Merge two records: better time wins, stars max, words union, completed OR.
    function merge(a, b) {
        a = a || {}; b = b || {};
        var ta = a.bestTimeS > 0 ? a.bestTimeS : 0, tb = b.bestTimeS > 0 ? b.bestTimeS : 0;
        var best = ta && tb ? Math.min(ta, tb) : (ta || tb || 0);
        var words = [];
        (a.wordsFound || []).concat(b.wordsFound || []).forEach(function (w) { if (words.indexOf(w) < 0) words.push(w); });
        return { completed: !!(a.completed || b.completed), bestTimeS: best,
                 stars: Math.max(a.stars || 0, b.stars || 0), wordsFound: words };
    }
    // stars from a finished run: 1 finish, 2 under par, 3 all doodads found (and finished).
    function starsFor(timeS, parS, doodadsFound, doodadsTotal) {
        var s = 1;
        if (timeS > 0 && timeS <= (parS || DEFAULT_PAR_S)) s = 2;
        if (doodadsTotal > 0 && doodadsFound >= doodadsTotal) s = 3;
        return s;
    }
    function fmtTime(t) {
        if (!(t > 0)) return '--:--';
        var m = Math.floor(t / 60), s = Math.floor(t % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function get(name) { var r = load()[name]; return r ? merge(r, null) : { completed: false, bestTimeS: 0, stars: 0, wordsFound: [] }; }
    function record(name, rec) { load(); mem[name] = merge(mem[name], rec); save(); return get(name); }

    // ---- hooks from gamemode.js ----
    function onStart(def) { run = def && def.name ? { name: def.name, t0: Date.now() } : null; }
    function onWin(def) {
        try {
            if (!def || !def.name) return;
            var t0 = run && run.name === def.name ? run.t0 : Date.now();
            var timeS = Math.max(1, Math.round((Date.now() - t0) / 1000));
            var found = def.found ? Array.from(def.found) : [];
            var dF = 0, dT = 0;
            try { if (typeof Hints !== 'undefined' && def.found) { var c = Hints.counts(def, def.found); dF = c.doo[0]; dT = c.doo[1]; } } catch (e) {}
            var stars = starsFor(timeS, def.parTimeS, dF, dT);
            var before = get(def.name);
            var after = record(def.name, { completed: true, bestTimeS: timeS, stars: stars, wordsFound: found });
            var line = '★'.repeat(stars) + '☆'.repeat(3 - stars) + '  ' + fmtTime(timeS) +
                (before.bestTimeS && timeS < before.bestTimeS ? '  NEW BEST!' : (after.bestTimeS ? '  best ' + fmtTime(after.bestTimeS) : ''));
            if (typeof gameMsg === 'function') gameMsg(line, 9000);
        } catch (e) {}
    }

    // ---- shifts (Robot Factory etc.) ----
    function shiftKey(name, shift) { return name + '#' + shift; }
    function recordShift(name, shift, rec) { return record(shiftKey(name, shift), rec); }
    function isUnlocked(name, shift) {
        shift = shift == null ? 1 : shift;
        if (shift <= 1) return true;
        var gate = SHIFT_GATES[name];
        if (!gate || !flags.robotFactoryShiftGating) return true;
        if (shift > gate.shifts) return false;
        // shifts 2 and 3 unlock once shift 1 has a star (per brief: "after shift 1 star")
        return get(shiftKey(name, 1)).stars >= gate.minStarsToUnlockNext;
    }

    // ---- level-select card ----
    function slug(n) { return String(n).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
    function hue(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; }
    function drawCard(cv, name, rec, img) {
        var g = cv.getContext('2d'), w = cv.width, h = cv.height;
        var grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'hsl(' + hue(name) + ',55%,32%)'); grad.addColorStop(1, 'hsl(' + ((hue(name) + 50) % 360) + ',60%,16%)');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        if (img) { try { g.drawImage(img, 0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h * 0.62, w, h * 0.38); } catch (e) {} }
        g.textAlign = 'center'; g.fillStyle = '#fff';
        g.font = 'bold ' + Math.round(h * 0.13) + 'px sans-serif';
        if (!img) g.fillText(name, w / 2, h * 0.42);
        g.font = Math.round(h * 0.17) + 'px sans-serif';
        g.fillStyle = '#ffd700';
        g.fillText('★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars), w / 2, h * 0.78);
        g.font = Math.round(h * 0.11) + 'px sans-serif'; g.fillStyle = '#fff';
        g.fillText(rec.completed ? 'best ' + fmtTime(rec.bestTimeS) : 'not played', w / 2, h * 0.92);
    }
    // Adds a card plane in front of a menu TV. Safe to call with any THREE scene; never throws.
    function decorateCard(tv, name, sceneRef) {
        try {
            if (typeof document === 'undefined' || typeof THREE === 'undefined' || !tv || !tv.geometry) return null;
            var p = tv.geometry.parameters || {}, w = (p.width || 3) - 0.2, h = (p.height || 2) - 0.2;
            var rec = get(name), cv = document.createElement('canvas'); cv.width = 320; cv.height = Math.round(320 * h / w);
            drawCard(cv, name, rec, null);
            var tex = new THREE.CanvasTexture(cv);
            var plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
            plane.position.set(0, 0, 0.11);   // local to the TV: it moves and is removed with it
            plane.userData = { type: 'progressCard', name: name };
            // Child of the TV itself, so clearing the menu (scene.remove(tv)) removes the card too
            tv.add(plane);
            try { // optional preview image; fallback tile stays if missing
                var img = new Image();
                img.onload = function () { drawCard(cv, name, rec, img); tex.needsUpdate = true; };
                img.src = 'assets/previews/' + slug(name) + '.png';
            } catch (e) {}
            return plane;
        } catch (e) { return null; }
    }

    function _reset() { mem = {}; loaded = true; run = null; }
    return { merge: merge, starsFor: starsFor, fmtTime: fmtTime, get: get, record: record, onStart: onStart, onWin: onWin,
             recordShift: recordShift, isUnlocked: isUnlocked, decorateCard: decorateCard, slug: slug,
             SHIFT_GATES: SHIFT_GATES, flags: flags, KEY: KEY, _reset: _reset };
})();
if (typeof window !== 'undefined') window.Progress = Progress;
