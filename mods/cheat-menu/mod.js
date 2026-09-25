/**
 * Cheat Menu — one combined cheat panel, built to grow.
 *
 * Currently exposes:
 *   Gravity  — slider + presets (0g/Moon/Mars/Earth/Jupiter) via window.gravity
 *   Character — break-limit factor slider (0.1 fragile … 50 tough), presets
 *               (Paper/Glass/Normal/Tough/Iron), GOD button, Heal button,
 *               via window.charEd. Hotkey I = god toggle (character-editor).
 *
 * Consumes the engine mods (gravity-mod, character-editor). Injection order is
 * fs order, so engines may not exist yet when this mod's onReady fires — we
 * poll for window.gravity/window.charEd for up to 15s before building.
 *
 * Adding a section: engine mod exposes a console API on window, then add a
 * panel.addSection + controls here. Keep engines UI-free.
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.ui && HWLibs.game && HWLibs.settings)) {
            HW.log('Cheat Menu', 'HWLibs missing — install mods/_lib/');
            return;
        }

        // engines may inject after us — poll briefly
        let tries = 0;
        (function wait() {
            if (window.gravity && window.charEd) {
                try { build(); } catch (e) { HW.log('Cheat Menu', 'build failed:', e.message); }
                return;
            }
            if (++tries > 60) {
                HW.log('Cheat Menu', 'engines not found — install gravity-mod + character-editor');
                return;
            }
            setTimeout(wait, 250);
        })();

        function build() {
            const GOD = 1e9;
            const grav = window.gravity;
            const ed = window.charEd;

            const panel = HWLibs.ui.panel({ title: 'Cheats', storageKey: 'cheats', width: 240 });

            // ---- Gravity -------------------------------------------------
            const gSec = panel.addSection('Gravity');
            const gSlider = gSec.addSlider({
                min: 0, max: 3, step: 0.05, value: 1,
                onInput: (v) => { if (grav.set(v)) sync(); }
            });
            gSec.addButtons([
                { label: '0g', value: 0 },
                { label: 'Moon', value: 0.16 },
                { label: 'Mars', value: 0.38 },
                { label: 'Earth', value: 1 },
                { label: 'Jupiter', value: 2.53 }
            ], (v) => { grav.set(v); sync(); });

            // ---- Character -------------------------------------------------
            const cSec = panel.addSection('Character');
            const cSlider = cSec.addSlider({
                min: 0.1, max: 50, step: 0.05,
                value: clampFactor(ed.getFactor()),
                onInput: (v) => { ed.setFactor(v); sync(); }
            });
            cSec.addButtons([
                { label: 'Paper', value: 0.1 },
                { label: 'Glass', value: 0.25 },
                { label: 'Normal', value: 1 },
                { label: 'Tough', value: 3 },
                { label: 'Iron', value: 10 }
            ], (v) => { ed.setFactor(v); sync(); });
            cSec.addButtons([{ label: 'GOD', value: GOD, accent: 'red' }],
                (v) => { ed.setFactor(v); sync(); });
            cSec.addButtons([{ label: 'Heal', value: 1, accent: 'green' }],
                () => { ed.heal(); });

            function clampFactor(f) {
                return Math.max(0.1, Math.min(50, f >= GOD ? 50 : f));
            }

            function sync() {
                const g = grav.get();
                const gm = g ? g.multiplier : null;
                if (gm != null) gSlider.set(Math.max(0, Math.min(3, gm)));
                const f = ed.getFactor();
                cSlider.set(clampFactor(f));
                panel.setValue('G ' + (gm != null ? gm.toFixed(2) + '×' : '?') +
                    ' · C ' + (f >= GOD ? 'GOD' : parseFloat(f.toFixed(2)) + '×'));
            }

            let poll = setInterval(sync, 500);
            panel.onClosed(() => clearInterval(poll));
            sync();

            HW.log('Cheat Menu', 'panel ready — gravity + character (hotkey I = god)');
        }
    });
})();
