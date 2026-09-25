/**
 * Viewport (engine) — logical resolution / aspect control.
 *
 * The game lays out natively from app.safeSize/app.maxSize (both {900,500} on this
 * build): its resize() reads them, calls renderer.resize() at that logical size and
 * letterboxes the canvas CSS to the window. This mod just drives that native path.
 *
 * Console API (window.viewport):
 *   viewport.apply(name)          '16:9' | '21:9' | '1:1' | '9:16' | 'fill'
 *   viewport.presets              list of names
 *   viewport.current              active preset (persisted in hw.viewport settings)
 *   viewport.restore()            back to the game's own 900x500
 *
 * Notes:
 *  - 'fill' matches the logical aspect to the window (no letterbox); it re-applies
 *    on window resize. Other presets keep the game's own resize handler working on
 *    window resizes (it re-runs resize() with our maxSize values).
 *  - updatePixiResolution() is called after every resize to keep the DPR/quality
 *    factor consistent (it recomputes the game's FILTER_RES from screen height).
 *  - UI elements are laid out for 900x500 by the game's own screen resize handlers,
 *    so menus/HUD reflow with the new logical size — visual quirks are possible at
 *    extreme aspects; report them rather than widening the presets blindly.
 *  - MENUS: the game's menu screens look broken at extreme aspects (UI is authored
 *    for 900x500), so the engine AUTO-REVERTS to 16:9 while no level session is
 *    active and re-applies the chosen preset when a level loads (per-tick check).
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    let pendingPreset = null;
    function applySettings(v) {
        if (!v || !v.preset) return;
        if (window.viewport) window.viewport.apply(v.preset);
        else pendingPreset = v.preset;
    }
    HW.onSettings(applySettings);
    HW.onDisable(function () {
        try { if (window.viewport) window.viewport.restore(); } catch (e) {}
        HW.log('Viewport', 'disabled — restored to the game\'s own resolution');
    });

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.settings)) {
            HW.log('Viewport', 'HWLibs.settings missing — install mods/_lib/');
            return;
        }
        const settings = HWLibs.settings;
        const app = HW.getApp();
        if (!app || !app.resize) {
            HW.log('Viewport', 'app/resize unavailable — cannot control viewport');
            return;
        }

        // The game's own values (always 900x500 on this build), for restore.
        const ORIG = {
            width: app.safeSize.width, height: app.safeSize.height
        };

        const PRESETS = {
            '16:9': () => [900, 500],
            '21:9': () => [900, 386],
            '1:1': () => [700, 700],
            '9:16': () => [500, 900],
            // logical aspect = window aspect → canvas fills the window, no letterbox
            'fill': () => [900, Math.max(100, Math.round(900 * window.innerHeight / Math.max(1, window.innerWidth)))]
        };

        let current = settings.get('viewport', 'preset', '16:9');
        if (!PRESETS[current]) current = '16:9';

        function apply(name, silent) {
            const p = PRESETS[name];
            if (!p) return false;
            const w = p()[0], h = p()[1];
            try {
                app.safeSize = { width: w, height: h };
                app.maxSize = { width: w, height: h };
                app.resize();
                app.updatePixiResolution();
                current = name;
                if (!silent) settings.set('viewport', 'preset', name);
                if (!silent) HW.log('Viewport', name + ' → ' + w + 'x' + h + ' (logical)');
                return true;
            } catch (e) {
                HW.log('Viewport', 'apply failed:', e.message);
                return false;
            }
        }

        // Keep 'fill' matching the window; the game's own resize handler covers the rest.
        let rt = null;
        window.addEventListener('resize', () => {
            clearTimeout(rt);
            rt = setTimeout(() => { if (current === 'fill') apply('fill'); }, 200);
        });

        window.viewport = {
            apply,
            presets: Object.keys(PRESETS),
            get current() { return current; },
            restore() { return apply('16:9'); }
        };

        // re-apply the persisted choice (default 16:9 needs no action)
        if (current !== '16:9') apply(current);
        if (pendingPreset) { const p = pendingPreset; pendingPreset = null; if (p !== '16:9') apply(p); }

        // Menus are authored for 900x500 — revert there, restore in-level.
        let menuSaved = null;
        HW.onTick(function () {
            try {
                const inLevel = HWLibs.game.inLevel();
                if (!inLevel && current !== '16:9') {
                    menuSaved = current;
                    apply('16:9', true);
                } else if (inLevel && menuSaved) {
                    const want = menuSaved; menuSaved = null;
                    if (PRESETS[want]) apply(want, true);
                }
            } catch (e) {}
        });

        HW.log('Viewport', 'engine ready — window.viewport, presets: ' + window.viewport.presets.join(', '));
    });
})();
