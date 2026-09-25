/**
 * Free Camera (engine) — detach the in-level camera; pan with arrow keys, zoom with
 * the mouse wheel. Toggle: hotkey F or window.freecam.toggle().
 *
 * Mechanism (verified against the obfuscated cam.step()/center() source): step() calls
 * `this._focus.GetInterpolatedPosition()` every step and feeds it to center(point)
 * (world meters × m_physScale → container position, clamped by borders). So we REPLACE
 * cam._focus with a fake object whose GetInterpolatedPosition() returns our pan
 * position (a self-mimicking Proxy so any chained call still yields x/y). Focus is a
 * b2Body, NOT a plain {x,y} object — midX/midY writes get recomputed and don't stick.
 * removeSecondFocus() is called on enable so the single-focus path runs.
 *
 * Controls while enabled:
 *   W/A/S/D         pan (50%/s of visible width; Shift = 4x) — NOT arrows, because
 *                   arrow keys are the game's default drive keys (see options135)
 *   Mouse wheel     zoom (clamped 0.25–4)
 *   F               toggle off (camera snaps back to the character)
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.game && HWLibs.settings)) {
            HW.log('FreeCam', 'HWLibs.game/settings missing — install mods/_lib/');
            return;
        }
        const game = HWLibs.game;

        const state = {
            enabled: false,
            zoom: 1,
            zoom0: 1,
            pos: { x: 0, y: 0 },   // world meters
            keys: new Set(),
            lastT: 0,
            origFocus: null,
            origSecond: null,
            fake: null,
            errored: false
        };

        function cam() { return game.camera(); }

        function makeFake(target) {
            let fake = null;
            fake = new Proxy(target, {
                get(t, k) {
                    if (k === 'x') return t.x;
                    if (k === 'y') return t.y;
                    // any method call (GetInterpolatedPosition, .clone(), …) returns
                    // another proxy that reads/writes the same live position
                    return () => fake;
                }
            });
            return fake;
        }

        function currentFocusPos(c) {
            try {
                const p = c._focus.GetInterpolatedPosition();
                return { x: p.x, y: p.y };
            } catch (e) {
                return { x: 0, y: 0 };
            }
        }

        function enable() {
            const c = cam();
            if (!c) { HW.log('FreeCam', 'no camera — enter a level first'); return false; }
            if (!c._focus || typeof c._focus.GetInterpolatedPosition !== 'function') {
                HW.log('FreeCam', 'unexpected camera shape — see console dump');
                dump('enable-unexpected');
                return false;
            }
            state.zoom0 = typeof c.zoom === 'number' ? c.zoom : 1;
            state.zoom = state.zoom0;
            state.origFocus = c._focus;
            state.origSecond = c._secondFocus;
            try { c.removeSecondFocus(); } catch (e) {}
            state.pos = currentFocusPos(c);
            state.fake = makeFake(state.pos);
            c._focus = state.fake;
            state.enabled = true;
            HW.log('FreeCam', 'ON — arrows pan, wheel zoom, F to exit (pos ' +
                state.pos.x.toFixed(1) + ',' + state.pos.y.toFixed(1) + ')');
            return true;
        }

        function disable() {
            const c = cam();
            if (c) {
                if (state.origFocus) { try { c._focus = state.origFocus; } catch (e) {} }
                if (state.origSecond !== undefined) { try { c._secondFocus = state.origSecond; } catch (e) {} }
                try { c.zoom = state.zoom0; } catch (e) {}
            }
            state.enabled = false;
            state.fake = null;
            state.origFocus = null;
            state.origSecond = null;
            state.keys.clear();
            HW.log('FreeCam', 'OFF — camera back to character');
        }

        function toggle() { return state.enabled ? (disable(), false) : enable(); }

        // --- input ---------------------------------------------------------

        window.addEventListener('keydown', (e) => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (!state.enabled) { if (!enable()) return; } else disable();
                return;
            }
            if (state.enabled && /^[wasd]$/i.test(e.key) || state.enabled && e.key === 'Shift') {
                state.keys.add(e.key);
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', (e) => { state.keys.delete(e.key); });
        window.addEventListener('blur', () => { state.keys.clear(); });

        window.addEventListener('wheel', (e) => {
            if (!state.enabled) return;
            e.preventDefault();
            state.zoom *= (e.deltaY < 0 ? 1.1 : 1 / 1.1);
            state.zoom = Math.max(0.25, Math.min(4, state.zoom));
        }, { passive: false });

        // --- per-tick: move the fake focus -----------------------------------

        const HW_BASE = window.innerWidth || 900;
        HW.onTick(function (t) {
            try {
                if (!state.enabled) { state.lastT = 0; return; }
                const c = cam();
                if (!c || c._focus !== state.fake) { disable(); return; }
                // pan: time-based, 50% of visible width per second (frame-rate independent)
                const dt = state.lastT ? Math.min(0.1, (t - state.lastT) / 1000) : 0;
                state.lastT = t;
                const physScale = c.m_physScale || 62.5;
                const visibleWorld = HW_BASE / state.zoom / physScale;
                const step = visibleWorld * 0.5 * dt;
                if (state.keys.size) {
                    let dx = 0, dy = 0;
                    if (state.keys.has('a')) dx -= 1;
                    if (state.keys.has('d')) dx += 1;
                    if (state.keys.has('w')) dy -= 1;
                    if (state.keys.has('s')) dy += 1;
                    if (state.keys.has('Shift')) { dx *= 4; dy *= 4; }
                    state.pos.x += dx * step;
                    state.pos.y += dy * step;
                }
                c.zoom = state.zoom;
            } catch (e) {
                if (!state.errored) { state.errored = true; HW.log('FreeCam', 'tick error:', e.message); disable(); }
            }
        });

        window.freecam = {
            toggle,
            on: enable,
            off: disable,
            get enabled() { return state.enabled; },
            setZoom(z) { state.zoom = Math.max(0.25, Math.min(4, +z || 1)); }
        };

        HW.log('FreeCam', 'engine ready — F to toggle, window.freecam');
    });
})();
