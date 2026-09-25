/**
 * HUD Mod (engine) — small always-on-top readout, in-level only.
 *
 * Shows: fps · bodies · time factor · gravity factor · GOD/freecam flags.
 * Hides automatically in menus (no session). Toggle with window.hud.toggle()
 * or the cheat-menu HUD switch. State persisted (hw.hud settings namespace).
 *
 * While OUR HUD is enabled, the game's own FPS counter (a PIXI text object with
 * _text like "59 fps" under the stage) is suppressed via renderable=false+visible
 *=false — re-asserted every few ticks because the game re-sets visible per frame
 * and recreates the counter per screen. When our HUD is disabled, both flags are
 * restored so the built-in counter comes back.
 *
 * Pointer-events: none — never blocks the game.
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    let pendingEnabled = null;
    function applySettings(v) {
        if (!v || typeof v.enabled !== 'boolean') return;
        if (window.hud) window.hud.set(v.enabled);
        else pendingEnabled = v.enabled;
    }
    HW.onSettings(applySettings);
    HW.onDisable(function () {
        // hud.set(false) hides the readout AND restores the game's own FPS counter
        try { if (window.hud) window.hud.set(false); } catch (e) {}
        HW.log('HUD', 'disabled — game FPS counter restored');
    });

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.game && HWLibs.settings)) {
            HW.log('HUD', 'HWLibs.game/settings missing — install mods/_lib/');
            return;
        }
        const game = HWLibs.game;
        const settings = HWLibs.settings;

        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99998;pointer-events:none;' +
            'font:11px/1.5 ui-monospace,Menlo,monospace;color:#cfe3ff;' +
            'background:rgba(15,18,25,.65);border:1px solid rgba(120,140,180,.25);' +
            'border-radius:6px;padding:4px 8px;white-space:pre;display:none;';
        document.body.appendChild(el);

        let enabled = settings.get('hud', 'enabled', true);
        let frames = 0, lastFpsT = performance.now(), fps = 0, acc = 0;
        let bodyCount = 0, lastBodyCountT = 0;
        const suppressed = new Set();

        function fmt(v, suffix) { return v == null ? '?' : parseFloat(v.toFixed(2)) + (suffix || ''); }

        function render() {
            const ses = game.session();
            if (!ses || !enabled) { el.style.display = 'none'; return; }
            el.style.display = 'block';
            const lines = [];
            lines.push(fps + ' fps · ' + bodyCount + ' bodies');
            if (window.timeScale && window.timeScale.get() !== 1) lines.push('time ' + fmt(window.timeScale.get()) + '×');
            const g = game.getGravity();
            if (g && Math.abs(g.multiplier - 1) > 0.01) lines.push('grav ' + fmt(g.multiplier) + '×');
            if (window.charEd && window.charEd.getFactor() >= 1e9) lines.push('GOD');
            if (window.freecam && window.freecam.enabled) lines.push('freecam');
            if (ses.paused) lines.push('paused');
            el.textContent = lines.join('\n');
        }

        function findFpsCounters() {
            const found = [];
            try {
                const stage = HW.getStage();
                if (!stage) return found;
                const walk = (o, depth) => {
                    if (!o || depth > 10 || found.length > 5) return;
                    try {
                        if (typeof o._text === 'string' && /fps/i.test(o._text)) found.push(o);
                    } catch (e) {}
                    if (Array.isArray(o.children)) for (const k of o.children) walk(k, depth + 1);
                };
                walk(stage, 0);
            } catch (e) {}
            return found;
        }

        function applySuppression() {
            try {
                const counters = findFpsCounters();
                if (enabled) {
                    counters.forEach(o => {
                        try {
                            o.visible = false;
                            o.renderable = false; // survives the game re-setting visible=true
                            suppressed.add(o);
                        } catch (e) {}
                    });
                } else if (suppressed.size) {
                    suppressed.forEach(o => {
                        try { o.visible = true; o.renderable = true; } catch (e) {}
                    });
                    suppressed.clear();
                }
            } catch (e) {}
        }

        let lastSes = null;
        HW.onTick(function (t) {
            try {
                // direct handle: suppress the new session's counter the instant it
                // appears (kills the spawn-race window; scan below stays as fallback)
                const ses = game.session();
                if (ses && ses !== lastSes) {
                    lastSes = ses;
                    if (enabled) {
                        try {
                            if (ses.fpsText) { ses.fpsText.visible = false; ses.fpsText.renderable = false; suppressed.add(ses.fpsText); }
                        } catch (e) {}
                    }
                }
                // fps: smooth rAF rate
                frames++;
                const now = performance.now();
                if (now - lastFpsT >= 500) {
                    fps = Math.round(frames * 1000 / (now - lastFpsT));
                    frames = 0; lastFpsT = now;
                }
                // body count: poll 4x/s (GetBodyCount is a full-list walk)
                if (now - lastBodyCountT > 250) {
                    lastBodyCountT = now;
                    const w = game.world();
                    bodyCount = w ? w.GetBodyCount() : 0;
                }
                acc += 1;
                if (acc % 8 === 0) render();        // ~8Hz repaint
                if (acc % 6 === 0) applySuppression(); // re-assert / restore
            } catch (e) {}
        });

        window.hud = {
            toggle() { enabled = !enabled; settings.set('hud', 'enabled', enabled); render(); applySuppression(); return enabled; },
            get enabled() { return enabled; },
            set(v) { enabled = !!v; settings.set('hud', 'enabled', enabled); render(); applySuppression(); }
        };

        render();
        applySuppression();
        HW.log('HUD', 'engine ready — window.hud (toggle in cheat menu)');
    });
})();
