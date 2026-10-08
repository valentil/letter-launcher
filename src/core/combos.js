// Letter Launcher — src/core/combos.js
// LLF-2: typing-speed combo meter. Back-to-back combos within COMBO_STREAK_MS escalate a
// tier (1..COMBO_MAX_TIER): more bursts and a hotter palette. Caps: 3+3*3 = 12 bursts x 20
// particles = 240 < MAX_PARTICLES (400), and spawnFirework still calls capParticles().
// Classic script: declarations only.

        const COMBO_STREAK_MS = 6000;  // next combo within this gap keeps the streak alive
        const COMBO_MAX_TIER = 3;
        const COMBO_PALETTES = [
            null,                                  // tier 0 unused
            [0xffd34d, 0xff8c42, 0xffffff],        // tier 1: warm gold
            [0xff4d6d, 0xff9e00, 0xffe66d, 0xffffff], // tier 2: hot reds/oranges
            [0x00e5ff, 0xc77dff, 0xff4de1, 0xffffff, 0xfff176] // tier 3: full spectrum
        ];
        let comboTier = 0; let comboTierTime = -1e9;

        // Returns the firework intensity (== tier) for a combo fired at `now` (ms).
        function comboNextIntensity(now) {
            comboTier = (now - comboTierTime) <= COMBO_STREAK_MS ? Math.min(COMBO_MAX_TIER, comboTier + 1) : 1;
            comboTierTime = now;
            return comboTier;
        }

        // A random colour from the tier's palette (undefined -> spawnFirework's own random).
        function comboColorFor(tier) {
            const p = COMBO_PALETTES[Math.max(1, Math.min(COMBO_MAX_TIER, Math.floor(tier || 1)))];
            return p ? p[Math.floor(Math.random() * p.length)] : undefined;
        }
