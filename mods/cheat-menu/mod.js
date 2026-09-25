/**
 * Cheat Menu — one combined cheat panel, built to grow.
 *
 * Currently exposes:
 *   Gravity  — slider + presets (0g/Moon/Mars/Earth/Jupiter) via window.gravity
 *   Character — break-limit factor slider (0.1 fragile … 50 tough), presets
 *               (Paper/Glass/Normal/Tough/Iron), GOD button, Stop bleed button,
 *               via window.charEd. Hotkey I = god toggle (character-editor).
 *               (No limb regrow: dismemberment destroys Box2D joints; the only
 *               game-native rebuild is a full level restart — charEd.respawn().)
 *
 *   Viewport — logical resolution presets (16:9 / 21:9 / 1:1 / 9:16 / Fill window)
 *               via window.viewport.
 *   Time     — physics speed slider (0.05 slow-mo … 2 fast) + presets via window.timeScale.
 *   Camera   — free-camera toggle (window.freecam; also hotkey F).
 *   HUD      — overlay readout toggle (window.hud).
 *   Sandbox  — physics gun toggle (window.physgun; also hotkey G).
 *
 * Consumes the engine mods (gravity-mod, character-editor, viewport-mod, time-mod,
 * freecam-mod, hud-mod, physgun-mod). Injection order is fs order, so engines may not
 * exist yet when this mod's onReady fires — we poll for all engine globals for up to 15s.
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
            if (window.gravity && window.charEd && window.viewport && window.timeScale && window.freecam && window.hud && window.physgun) {
                try { build(); } catch (e) { HW.log('Cheat Menu', 'build failed:', e.message); }
                return;
            }
            if (++tries > 60) {
                HW.log('Cheat Menu', 'engines not found — install all engine mods (gravity, character, viewport, time, freecam, hud, physgun)');
                return;
            }
            setTimeout(wait, 250);
        })();

        function build() {
            const GOD = 1e9;
            const grav = window.gravity;
            const ed = window.charEd;
            const ts = window.timeScale;
            const fc = window.freecam;
            const hud = window.hud;
            const pg = window.physgun;

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
            cSec.addButtons([{ label: 'Stop bleed', value: 'bleed' }],
                () => { ed.heal(); });

            // ---- Viewport --------------------------------------------------
            const vSec = panel.addSection('Viewport');
            vSec.addButtons([
                { label: '16:9', value: '16:9', accent: 'blue' },
                { label: '21:9', value: '21:9' },
                { label: '1:1', value: '1:1' },
                { label: '9:16', value: '9:16' },
                { label: 'Fill', value: 'fill' }
            ], (v) => { window.viewport.apply(v); sync(); });

            // ---- Time ------------------------------------------------------
            const tSec = panel.addSection('Time');
            const tSlider = tSec.addSlider({
                min: 0.05, max: 2, step: 0.05, value: ts.get(),
                onInput: (v) => { ts.set(v); sync(); }
            });
            tSec.addButtons([
                { label: '0.1x', value: 0.1 },
                { label: 'Slow', value: 0.25 },
                { label: 'Half', value: 0.5 },
                { label: '1x', value: 1 },
                { label: '2x', value: 2 }
            ], (v) => { ts.set(v); sync(); });

            // ---- Camera / HUD ----------------------------------------------
            const camSec = panel.addSection('Camera');
            const camToggle = camSec.addToggle({
                label: 'Free camera (F)', value: fc.enabled,
                onChange: (b) => { b ? fc.on() : fc.off(); sync(); }
            });
            const hudSec = panel.addSection('HUD');
            const hudToggle = hudSec.addToggle({
                label: 'Show HUD readout', value: hud.enabled,
                onChange: (b) => { hud.set(b); sync(); }
            });
            const gunSec = panel.addSection('Sandbox');
            const gunToggle = gunSec.addToggle({
                label: 'Physics gun (G)', value: pg.armed,
                onChange: (b) => { b ? pg.on() : pg.off(); sync(); }
            });

            function clampFactor(f) {
                return Math.max(0.1, Math.min(50, f >= GOD ? 50 : f));
            }

            function sync() {
                const g = grav.get();
                const gm = g ? g.multiplier : null;
                if (gm != null) gSlider.set(Math.max(0, Math.min(3, gm)));
                const f = ed.getFactor();
                cSlider.set(clampFactor(f));
                const tf = ts.get();
                tSlider.set(Math.max(0.05, Math.min(2, tf)));
                camToggle.set(fc.enabled);
                hudToggle.set(hud.enabled);
                gunToggle.set(pg.armed);
                panel.setValue('G ' + (gm != null ? gm.toFixed(2) + '×' : '?') +
                    ' · C ' + (f >= GOD ? 'GOD' : parseFloat(f.toFixed(2)) + '×') +
                    ' · T ' + parseFloat(tf.toFixed(2)) + '×');
            }

            let poll = setInterval(sync, 500);
            panel.onClosed(() => clearInterval(poll));
            sync();

            HW.log('Cheat Menu', 'panel ready — gravity + character (hotkey I = god)');
        }
    });
})();
