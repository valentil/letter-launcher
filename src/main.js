// Letter Launcher — src/main.js
// Boot: runs last, after every core/scene file has declared its globals and registered its scene.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // Boot the app (all declarations above are initialized by now).
        syncScenesFromRegistry();   // LLF-67: menu list from window.SCENES
        init();
        animate();
        // build: word-quest levels v1
