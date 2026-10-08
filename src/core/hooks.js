// Letter Launcher — src/core/hooks.js (LLF-91: core hook bus)
// Feature modules register for core events here instead of adding one-line calls to
// engine.js / menu.js / scene_swap.js (those one-liners made every parallel lane
// conflict at the same spots). Core files emit each event exactly once; a module does
//     LLHooks.on('frame', function (dt, now) { ... });
// at load time in its own file. emit() runs every handler inside try/catch (a broken
// feature can never stop the game loop) and returns true when any handler returned
// true, which the input events treat as "consumed". See docs/HOOKS.md for the list.
// Classic script: loads right after engine.js, before every module that registers.
(function () {
    const handlers = {};

    function on(evt, fn) {
        if (typeof fn !== 'function') return fn;
        (handlers[evt] || (handlers[evt] = [])).push(fn);
        return fn;
    }

    function off(evt, fn) {
        const list = handlers[evt];
        if (!list) return;
        const i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
    }

    function emit(evt) {
        const list = handlers[evt];
        if (!list || !list.length) return false;
        const args = Array.prototype.slice.call(arguments, 1);
        let consumed = false;
        const snapshot = list.slice();
        for (let i = 0; i < snapshot.length; i++) {
            const fn = snapshot[i];
            try {
                if (fn.apply(null, args) === true) consumed = true;
            } catch (err) {
                // Log once per handler so a per-frame failure doesn't flood the console.
                if (!fn.__llHookErr) {
                    fn.__llHookErr = true;
                    if (typeof console !== 'undefined') console.error('[LLHooks] ' + evt + ' handler failed', err);
                }
            }
        }
        return consumed;
    }

    const api = { on: on, off: off, emit: emit, _handlers: handlers };
    if (typeof window !== 'undefined') window.LLHooks = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
