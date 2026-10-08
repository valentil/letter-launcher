// Letter Launcher — src/core/hints.js (LLF-87)
// Onboarding + hint ladder for the word-quest levels:
//   - 20-second intro card on first play of each level (dismissible, seen-flag in localStorage)
//   - escalating idle hints: riddle -> nudge -> near-answer (def.hints = [{after: secondsIdle, text}, x3])
//   - "close..." amber flash when the buffer tail is one edit from an undiscovered state advancer
//   - found-word list shown as advancers x/N and doodads y/M
//   - typing HELP shows the objective plus the current hint
// Level defs (passed to setGameMode) carry: objective, intro:[3 lines], hints:[3 tiers],
// advancers:['GO|START', 'STOP|HALT', ...] (the same pipe keys used in words:). Everything else
// in words is a doodad. Classic script: top-level code only declares. The game calls it through
// small guarded hooks in gamemode.js (onLevelStart / onWord / onMiss / tick / tryHelp).
var Hints = (function () {
    'use strict';
    var INTRO_MS = 20000;
    var LS_PREFIX = 'll_intro_seen_';
    var st = { def: null, lastAdvance: 0, shownTier: -1, introEl: null, introTimer: null,
               introOpen: false, nearEl: null, nearUntil: 0, now: function () { return Date.now(); } };

    // ---------- pure helpers (unit-tested in node) ----------
    function lev1(a, b) { // true when Levenshtein distance(a, b) <= 1 (and a !== b handled by caller)
        if (a === b) return true;
        var la = a.length, lb = b.length;
        if (Math.abs(la - lb) > 1) return false;
        var i = 0;
        while (i < la && i < lb && a[i] === b[i]) i++;
        if (la === lb) return a.slice(i + 1) === b.slice(i + 1);   // substitution
        if (la > lb) return a.slice(i + 1) === b.slice(i);          // extra letter in a
        return a.slice(i) === b.slice(i + 1);                       // missing letter in a
    }
    // Returns the advancer word the buffer tail is exactly one edit away from, or null.
    // Only words >= 4 chars, only undiscovered ones. Prefixes of the word never count (typing
    // STOKE must not flash "close" at STOK), so a shorter tail only matches when it is not a prefix.
    function nearMiss(buffer, advancerWords, found) {
        var best = null;
        for (var i = 0; i < advancerWords.length; i++) {
            var w = advancerWords[i];
            if (w.length < 4 || buffer.slice(-w.length) === w || (found && found.has && found.has(w))) continue;
            for (var L = w.length - 1; L <= w.length + 1; L++) {
                if (L > buffer.length) continue;
                var tail = buffer.slice(buffer.length - L);
                if (tail === w || w.indexOf(tail) === 0) continue;
                if (lev1(tail, w) && (!best || w.length > best.length)) best = w;
            }
        }
        return best;
    }
    function advancerGroups(def) {
        return (def && def.advancers || []).map(function (k) { return String(k).split('|'); });
    }
    function advancerWords(def) {
        var out = [];
        advancerGroups(def).forEach(function (g) { out = out.concat(g); });
        return out;
    }
    // Counts for the found list: { adv:[found,total], doo:[found,total] }
    function counts(def, found) {
        var groups = advancerGroups(def), advSet = {}, advFound = 0;
        groups.forEach(function (g) {
            g.forEach(function (w) { advSet[w] = true; });
            if (g.some(function (w) { return found.has(w); })) advFound++;
        });
        var fns = [], foundFns = [];
        var words = def.words || {};
        Object.keys(words).forEach(function (w) {
            if (advSet[w]) return;
            var f = words[w];
            if (fns.indexOf(f) < 0) fns.push(f);
            if (found.has(w) && foundFns.indexOf(f) < 0) foundFns.push(f);
        });
        return { adv: [advFound, groups.length], doo: [foundFns.length, fns.length] };
    }
    // Highest unlocked hint tier index for an idle time in seconds (-1 = none yet).
    function tierFor(hints, idleSec) {
        var t = -1;
        (hints || []).forEach(function (h, i) { if (idleSec >= h.after) t = i; });
        return t;
    }

    // ---------- DOM bits (all guarded) ----------
    function el(id) { try { return document.getElementById(id); } catch (e) { return null; } }
    function seen(name) { try { return localStorage.getItem(LS_PREFIX + name) === '1'; } catch (e) { return false; } }
    function markSeen(name) { try { localStorage.setItem(LS_PREFIX + name, '1'); } catch (e) {} }

    function closeIntro() {
        if (st.introTimer) { clearTimeout(st.introTimer); st.introTimer = null; }
        if (st.introEl && st.introEl.parentNode) st.introEl.parentNode.removeChild(st.introEl);
        st.introEl = null;
        if (st.introOpen) st.lastAdvance = st.now(); // idle clock starts after the card is gone
        st.introOpen = false;
    }
    function showIntro(def) {
        if (!def.intro || !def.intro.length || typeof document === 'undefined') return;
        var d = document.createElement('div');
        d.id = 'introCard';
        d.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:30;max-width:420px;' +
            'background:rgba(12,18,30,0.92);color:#fff;border:2px solid #7fd7ff;border-radius:14px;padding:16px 20px;' +
            'font-family:sans-serif;box-shadow:0 0 24px rgba(127,215,255,0.45)';
        var h = '<div style="font-weight:700;letter-spacing:1px;color:#7fd7ff;margin-bottom:8px">' + (def.name || 'NEW LEVEL') + '</div>';
        def.intro.forEach(function (l) { h += '<div style="margin:4px 0;font-size:15px">' + l + '</div>'; });
        h += '<button id="introGo" style="margin-top:10px;padding:6px 14px;border-radius:8px;border:0;background:#7fd7ff;' +
             'color:#012;font-weight:700;cursor:pointer">Got it</button>';
        d.innerHTML = h;
        document.body.appendChild(d);
        st.introEl = d; st.introOpen = true;
        var b = d.querySelector('#introGo'); if (b) b.onclick = closeIntro;
        st.introTimer = setTimeout(closeIntro, INTRO_MS);
        markSeen(def.name);
    }
    function flashNear(word) {
        if (typeof document === 'undefined') return;
        if (!st.nearEl) {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:25;pointer-events:none;' +
                'color:#ffb347;font:700 18px sans-serif;text-shadow:0 0 10px rgba(255,170,60,0.8);display:none';
            document.body.appendChild(d); st.nearEl = d;
        }
        st.nearEl.textContent = 'close…';
        st.nearEl.style.display = 'block';
        st.nearUntil = st.now() + 1300;
    }
    function renderFound(def) {
        var root = el('objectiveHud'); if (!root || !def) return;
        var f = root.querySelector('.found'); if (!f) return;
        var c = counts(def, def.found);
        f.textContent = 'Advancers ' + c.adv[0] + '/' + c.adv[1] + ' · Doodads ' + c.doo[0] + '/' + c.doo[1] +
            (def.found.size ? ' — ' + Array.from(def.found).join(' · ') : '');
    }
    function say(text, ms) { try { if (typeof gameMsg === 'function') gameMsg(text, ms); } catch (e) {} }

    // ---------- hooks called from gamemode.js ----------
    function onLevelStart(def) {
        closeIntro();
        st.def = def; st.shownTier = -1; st.lastAdvance = st.now();
        if (st.nearEl) st.nearEl.style.display = 'none';
        if (def && def.intro && !seen(def.name)) showIntro(def);
    }
    function onWord(word) {
        var def = st.def; if (!def) return;
        var isAdv = advancerWords(def).indexOf(word) >= 0;
        if (isAdv) {
            st.lastAdvance = st.now(); st.shownTier = -1;
            if (st.introOpen) closeIntro();
        }
        renderFound(def);
    }
    function onMiss(buffer) {
        var def = st.def; if (!def || def.won) return;
        var w = nearMiss(buffer, advancerWords(def), def.found);
        if (w) flashNear(w);
    }
    function currentHint(def) {
        var t = Math.max(0, tierFor(def.hints, (st.now() - st.lastAdvance) / 1000));
        return (def.hints && def.hints[t]) ? def.hints[t].text : '';
    }
    function tryHelp(buffer) {
        var def = st.def;
        if (!def || !/HELP$/.test(buffer)) return false;
        say('Goal: ' + (def.objective || 'explore!') + '  —  Hint: ' + currentHint(def), 12000);
        return true;
    }
    function tick() {
        var def = st.def; if (!def) return;
        var now = st.now();
        if (st.nearEl && st.nearUntil && now > st.nearUntil) { st.nearEl.style.display = 'none'; st.nearUntil = 0; }
        if (def.won || st.introOpen || !def.hints) return;
        var t = tierFor(def.hints, (now - st.lastAdvance) / 1000);
        if (t > st.shownTier) {
            st.shownTier = t;
            say('Hint: ' + def.hints[t].text, 14000);
        }
    }
    function reset() { closeIntro(); st.def = null; }

    return { nearMiss: nearMiss, lev1: lev1, counts: counts, tierFor: tierFor, advancerWords: advancerWords,
             onLevelStart: onLevelStart, onWord: onWord, onMiss: onMiss, tryHelp: tryHelp, tick: tick, reset: reset,
             _state: st };
})();
