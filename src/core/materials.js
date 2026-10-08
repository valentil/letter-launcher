// LLF-73 [Forge-R2] Letter materials: chrome / steel / brass / aluminium / wood / rubber / glass.
// One table ties each material's look (three) to its physics (density -> mass via LetterGlyphs.massFor,
// restitution/friction -> cannon ContactMaterials) and to its modal ring (modal_audio.js material).
// Typed words STEEL / WOOD / RUBBER / GLASS / BRASS / CHROME (also ALUMINIUM) switch the material of
// the letters spawned after it; each scene has a default. Registered via LLHooks only (docs/HOOKS.md);
// glyph bodies are re-materialled from the 'letterSpawned' hook, so glyphs.js needs no edit.
// modal: modal_audio.js knows steel/aluminium/brass/wood/abs. chrome = plated steel -> steel;
// glass (E 70 GPa, rho 2500: E/rho within 10% of steel/aluminium) -> aluminium modes; rubber -> the
// heavily damped abs modes (a thud, not a ring).
const LL_MATERIALS = {
    chrome:    { color: 0xffffff, metalness: 1.0, roughness: 0.04, density: 7850, restitution: 0.25, friction: 0.35, modal: 'steel' },
    steel:     { color: 0xb4b9c0, metalness: 1.0, roughness: 0.25, density: 7850, restitution: 0.25, friction: 0.4,  modal: 'steel' },
    brass:     { color: 0xc9a23c, metalness: 1.0, roughness: 0.3,  density: 8500, restitution: 0.2,  friction: 0.4,  modal: 'brass' },
    aluminium: { color: 0xd6d9de, metalness: 1.0, roughness: 0.35, density: 2700, restitution: 0.3,  friction: 0.35, modal: 'aluminium' },
    wood:      { color: 0xb07a45, metalness: 0.0, roughness: 0.8,  density: 600,  restitution: 0.4,  friction: 0.6,  modal: 'wood', texture: 'wood' },
    rubber:    { color: 0x23262b, metalness: 0.0, roughness: 0.95, density: 1100, restitution: 0.8,  friction: 0.9,  modal: 'abs' },
    glass:     { color: 0xcfe9f2, metalness: 0.0, roughness: 0.05, density: 2500, restitution: 0.15, friction: 0.3,  modal: 'aluminium', glass: true, shatterSpeed: 6 }
};
const LL_MATERIAL_WORDS = { STEEL: 'steel', WOOD: 'wood', RUBBER: 'rubber', GLASS: 'glass', BRASS: 'brass', CHROME: 'chrome', ALUMINIUM: 'aluminium', ALUMINUM: 'aluminium' };
const LL_SCENE_DEFAULTS = { kyoto: 'wood', space: 'aluminium', robot: 'steel' };   // matched as a substring of the scene key

const LLMaterials = (function () {
    const api = { MATERIALS: LL_MATERIALS, WORDS: LL_MATERIAL_WORDS, SCENE_DEFAULTS: LL_SCENE_DEFAULTS };
    let current = null;                 // null = leave letters as the engine made them
    const cannonMats = {}, meshMats = {};
    let woodTex = null;
    const pendingShatter = [];

    function sceneDefault(sceneName) {
        const k = String(sceneName || '').toLowerCase();
        for (const s in LL_SCENE_DEFAULTS) if (k.indexOf(s) >= 0) return LL_SCENE_DEFAULTS[s];
        return null;
    }

    // ---- physics -------------------------------------------------------------------------------
    function cannonMaterial(CN, name) {
        const k = name;
        if (!cannonMats[k] || cannonMats[k].__cn !== CN) { const m = new CN.Material('ll_' + name); m.__cn = CN; cannonMats[k] = m; }
        return cannonMats[k];
    }
    // Letter-vs-ground uses the letter's own restitution/friction (ground is a neutral surface); letter-vs-letter averages.
    function pairParams(a, b) {
        return { restitution: (a.restitution + b.restitution) / 2, friction: Math.sqrt(a.friction * b.friction) };
    }
    function installContacts(CN, world, groundMaterial) {
        if (!world || world.__llMatContacts === CN) return;
        world.__llMatContacts = CN;
        const names = Object.keys(LL_MATERIALS);
        names.forEach(function (n, i) {
            const mn = cannonMaterial(CN, n);
            if (groundMaterial) world.addContactMaterial(new CN.ContactMaterial(groundMaterial, mn, { restitution: LL_MATERIALS[n].restitution, friction: LL_MATERIALS[n].friction }));
            for (let j = i; j < names.length; j++) {
                const p = pairParams(LL_MATERIALS[n], LL_MATERIALS[names[j]]);
                world.addContactMaterial(new CN.ContactMaterial(mn, cannonMaterial(CN, names[j]), { restitution: p.restitution, friction: p.friction }));
            }
        });
    }

    // ---- look ----------------------------------------------------------------------------------
    function qualityTier() { try { return (typeof QUALITY !== 'undefined' && QUALITY && QUALITY.tier) || 'med'; } catch (_) { return 'med'; } }
    function highTier() { const t = qualityTier(); return t === 'high' || t === 'ultra'; }
    function makeWoodTexture() {      // procedural grain, generated once
        if (woodTex || typeof document === 'undefined' || typeof THREE === 'undefined') return woodTex;
        try {
            const c = document.createElement('canvas'); c.width = 256; c.height = 256;
            const g = c.getContext('2d');
            g.fillStyle = '#b07a45'; g.fillRect(0, 0, 256, 256);
            for (let i = 0; i < 90; i++) {
                const y = Math.random() * 256, a = 0.05 + Math.random() * 0.18, w = 0.5 + Math.random() * 2.2;
                g.strokeStyle = 'rgba(' + (60 + Math.random() * 40 | 0) + ',' + (30 + Math.random() * 25 | 0) + ',10,' + a + ')';
                g.lineWidth = w; g.beginPath(); g.moveTo(0, y);
                for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3 + (Math.random() - 0.5) * 1.5);
                g.stroke();
            }
            woodTex = new THREE.CanvasTexture(c); woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
        } catch (_) { woodTex = null; }
        return woodTex;
    }
    function meshMaterial(name) {
        if (typeof THREE === 'undefined') return null;
        const d = LL_MATERIALS[name];
        const key = name + (d.glass ? (highTier() ? ':t' : ':o') : '');
        if (meshMats[key]) return meshMats[key];
        let m;
        if (d.glass) {
            if (highTier() && THREE.MeshPhysicalMaterial) {
                m = new THREE.MeshPhysicalMaterial({ color: d.color, metalness: 0, roughness: d.roughness, transmission: 0.9, thickness: 0.5, ior: 1.5, transparent: true });
            } else {
                m = new THREE.MeshStandardMaterial({ color: d.color, metalness: 0, roughness: d.roughness, transparent: true, opacity: 0.5 });
            }
        } else {
            m = new THREE.MeshStandardMaterial({ color: d.color, metalness: d.metalness, roughness: d.roughness, envMapIntensity: 1.0 });
            if (d.texture === 'wood') { const t = makeWoodTexture(); if (t) { m.map = t; m.color = new THREE.Color(0xffffff); } }
        }
        meshMats[key] = m;
        return m;
    }

    // ---- apply to a spawned glyph letter ---------------------------------------------------------
    function apply(letterObj, name) {
        const d = LL_MATERIALS[name];
        if (!d || !letterObj || !letterObj.body || !letterObj.mesh) return false;
        const body = letterObj.body, mesh = letterObj.mesh;
        if (!body.__glyph) return false;                                  // only CAD glyph bodies have a real volume
        const G = (typeof LetterGlyphs !== 'undefined') ? LetterGlyphs : null;
        const scale = mesh.scale ? mesh.scale.x : 1;
        const m = G ? G.massFor(body.__glyphChar, scale, d.density) : 0;
        if (m > 0 && body.mass > 0) {
            const r = m / body.mass;                                      // inertia scales with density at fixed shape
            body.mass = m; body.invMass = 1 / m;
            body.inertia.set(body.inertia.x * r, body.inertia.y * r, body.inertia.z * r);
            body.invInertia.set(1 / body.inertia.x, 1 / body.inertia.y, 1 / body.inertia.z);
            if (body.updateInertiaWorld) body.updateInertiaWorld(true);
        }
        if (typeof CANNON !== 'undefined') {
            body.material = cannonMaterial(CANNON, name);
            if (typeof world !== 'undefined') installContacts(CANNON, world, (typeof physicsMaterial !== 'undefined') ? physicsMaterial : null);
        }
        const mm = meshMaterial(name);
        if (mm) mesh.material = mm;
        body.__modalMaterial = d.modal; body.__llMaterial = name; body.__matBornT = Date.now();
        if (d.glass && body.addEventListener && !body.__shatterHooked) {
            body.__shatterHooked = true;
            body.addEventListener('collide', function (ev) {
                try {
                    if (Date.now() - body.__matBornT < 400 || body.__shattered) return;
                    const v = ev && ev.contact && ev.contact.getImpactVelocityAlongNormal ? Math.abs(ev.contact.getImpactVelocityAlongNormal()) : 0;
                    if (v >= d.shatterSpeed) { body.__shattered = true; pendingShatter.push(body); }
                } catch (_) { }
            });
        }
        return true;
    }

    function flushShatter() {          // outside the physics step: explodeLetter removes the body
        while (pendingShatter.length) {
            const b = pendingShatter.pop();
            try {
                if (typeof physicsBodies === 'undefined' || typeof explodeLetter !== 'function') continue;
                const pb = physicsBodies.find(function (p) { return p.body === b; });
                if (pb) explodeLetter(pb);
            } catch (_) { }
        }
    }

    function setCurrent(name) { current = (name && LL_MATERIALS[name]) ? name : null; return current; }
    function getCurrent() { return current; }
    function onWord(w) {
        const n = LL_MATERIAL_WORDS[String(w || '').toUpperCase()];
        if (n) { setCurrent(n); try { if (typeof LLHooks !== 'undefined') LLHooks.emit('materialChanged', n); } catch (_) { } }
    }
    function onSpawned(ch, letterObj) { if (current) apply(letterObj, current); }

    api.sceneDefault = sceneDefault; api.cannonMaterial = cannonMaterial; api.installContacts = installContacts; api.pairParams = pairParams;
    api.meshMaterial = meshMaterial; api.apply = apply; api.setCurrent = setCurrent; api.getCurrent = getCurrent;
    api.onWord = onWord; api.onSpawned = onSpawned; api.flushShatter = flushShatter; api.pendingShatter = pendingShatter;
    return api;
})();
if (typeof window !== 'undefined') window.LLMaterials = LLMaterials;
if (typeof module !== 'undefined' && module.exports) module.exports = { LLMaterials: LLMaterials, LL_MATERIALS: LL_MATERIALS };

if (typeof LLHooks !== 'undefined') {
    LLHooks.on('word', function (w) { LLMaterials.onWord(w); });
    LLHooks.on('letterSpawned', function (ch, obj) { LLMaterials.onSpawned(ch, obj); });
    LLHooks.on('afterSceneBuild', function (name) { LLMaterials.setCurrent(LLMaterials.sceneDefault(name)); });
    LLHooks.on('frame', function () { LLMaterials.flushShatter(); });
}
