/**
 * Free Camera (engine) — detach the in-level camera; pan with arrow keys, zoom with
 * the mouse wheel. Toggle: hotkey F or window.freecam.toggle().
 *
 * Mechanism: the camera (class J — see docs/game-internals.md: zoom, midX/midY,
 * _focus/_steppedFocus, _containerObj) computes its position from a focus object
 * during the game's update. Our HW.onTick callbacks run EARLIER in the frame than
 * the game's ticker (registered first), so we write the SOURCE values each tick
 * (_focus.x/y and zoom) and the camera's own update then uses them — no fighting
 * the renderer.
 *
 * _focus shape is detected at enable (this build obfuscates class names; shapes
 * only): numeric x/y → focus-override mode. Otherwise falls back to writing
 * cam.midX/midY directly (may be overwritten by the camera each step — a dump is
 * logged to the console on enable for iteration).
 *
 * Controls while enabled:
 *   Arrow keys      pan (Shift = 3x speed)
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
            mode: null,     // 'focus' | 'mid'
            zoom: 1,
            zoom0: 1,
            pos: { x: 0, y: 0 },
            keys: new Set(),
            errored: false
        };

        function cam() { return game.camera(); }

        function dump(label) {
            const c = cam();
            if (!c) return;
            const focusKeys = c._focus ? Object.getOwnPropertyNames(c._focus).slice(0, 12).join(',') : String(c._focus);
            const stepKeys = c._steppedFocus ? Object.getOwnPropertyNames(c._steppedFocus).slice(0, 12).join(',') : String(c._steppedFocus);
            const protoFns = [];
            let cur = c;
            for (let d = 0; cur && d < 2; d++) {
                protoFns.push(Object.getOwnPropertyNames(cur).filter(k => /focus|zoom|pan|move|update|set/i.test(k) && typeof cur[k] === 'function'));
                cur = Object.getPrototypeOf(cur);
            }
            HW.log('FreeCam', label, 'zoom=' + c.zoom, 'mid=' + c.midX + ',' + c.midY,
                '_focus{' + focusKeys + '}', '_stepped{' + stepKeys + '}',
                'proto:' + protoFns.map((f, i) => i + '[' + f.join('|') + ']').join(' '),
                'physScale=' + c.m_physScale);
        }

        function enable() {
            const c = cam();
            if (!c) { HW.log('FreeCam', 'no camera — enter a level first'); return false; }
            state.zoom0 = typeof c.zoom === 'number' ? c.zoom : 1;
            state.zoom = state.zoom0;
            state.mode = null;
            if (c._focus && typeof c._focus.x === 'number' && typeof c._focus.y === 'number') {
                state.mode = 'focus';
                state.pos = { x: c._focus.x, y: c._focus.y };
            } else if (typeof c.midX === 'number') {
                state.mode = 'mid';
                state.pos = { x: c.midX, y: c.midY };
            }
            dump('enable');
            if (!state.mode) { HW.log('FreeCam', 'unknown camera shape — nothing overridden (dump above)'); return false; }
            state.enabled = true;
            HW.log('FreeCam', 'ON (' + state.mode + ' mode) — arrows pan, wheel zoom, F to exit');
            return true;
        }

        function disable() {
            const c = cam();
            if (c && typeof state.zoom0 === 'number') { try { c.zoom = state.zoom0; } catch (e) {} }
            state.enabled = false;
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
            if (state.enabled && (e.key.startsWith('Arrow') || e.key === 'Shift')) {
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

        // --- per-tick application -------------------------------------------

        const HW_BASE = window.innerWidth || 900;
        HW.onTick(function () {
            try {
                if (!state.enabled) return;
                const c = cam();
                if (!c) { disable(); return; }
                // pan speed: ~2.5% of the visible width per frame (world units)
                const physScale = c.m_physScale || 62.5;
                const visibleWorld = HW_BASE / state.zoom / physScale;
                const step = visibleWorld * 0.025;
                if (state.keys.size) {
                    let dx = 0, dy = 0;
                    if (state.keys.has('ArrowLeft')) dx -= 1;
                    if (state.keys.has('ArrowRight')) dx += 1;
                    if (state.keys.has('ArrowUp')) dy -= 1;
                    if (state.keys.has('ArrowDown')) dy += 1;
                    if (state.keys.has('Shift')) { dx *= 3; dy *= 3; }
                    state.pos.x += dx * step;
                    state.pos.y += dy * step;
                }
                if (state.mode === 'focus') {
                    if (c._focus && typeof c._focus.x === 'number') { c._focus.x = state.pos.x; c._focus.y = state.pos.y; }
                    if (c._steppedFocus && typeof c._steppedFocus.x === 'number') { c._steppedFocus.x = state.pos.x; c._steppedFocus.y = state.pos.y; }
                } else if (state.mode === 'mid') {
                    c.midX = state.pos.x; c.midY = state.pos.y;
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
