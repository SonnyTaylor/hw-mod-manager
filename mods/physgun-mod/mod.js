/**
 * Physics Gun (engine) — grab any dynamic body with the mouse and drag it;
 * release to fling. Toggle: hotkey G or window.physgun.toggle().
 *
 * Mechanism: velocity-PD telekinesis instead of a b2MouseJoint — the Box2D joint
 * def classes are hidden inside the obfuscated bundle (no global Box2D), but
 * body.SetLinearVelocity/SetAwake/GetPosition are verified API (docs/game-internals.md).
 * Each tick: v = (cursorWorld - bodyPos) * GAIN, clamped; body keeps its velocity on
 * release, so letting go mid-swing flings naturally.
 *
 * Controls while armed:
 *   Left mouse down   grab the nearest dynamic body under the cursor
 *   Move / hold       body follows the cursor
 *   Left mouse up     release (body keeps its velocity = fling)
 *   G                 arm/disarm the gun
 *
 * Picking: nearest body by world position within ~5% of visible width; skips static
 * bodies (GetMass 0), the level ground body and the endBlock body. Everything else —
 * including character parts and vehicles — is fair game.
 *
 * Cursor → world conversion (verified against cam.center() source): screen CSS px →
 * pixi logical px (canvas rect ratio) → containerObj.globalToLocal → ÷ m_physScale
 * = world meters.
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.game && HWLibs.settings)) {
            HW.log('PhysGun', 'HWLibs.game/settings missing — install mods/_lib/');
            return;
        }
        const game = HWLibs.game;
        const settings = HWLibs.settings;
        const NS = 'physgun';

        const state = {
            armed: settings.get(NS, 'armed', false),
            grabbed: null,
            target: { x: 0, y: 0 },
            errored: false
        };

        const GAIN = 12;    // velocity gain per meter of error
        const MAXV = 30;    // m/s cap (~2 screens/s at 1x zoom)

        function inLevel() { return game.inLevel(); }

        /** Screen (CSS px) → world meters via the camera container. */
        function screenToWorld(clientX, clientY) {
            const cam = game.camera();
            const app = window.__HW__.getApp();
            const cont = cam && cam._containerObj;
            if (!cont || typeof cont.globalToLocal !== 'function') return null;
            const view = (app.renderer && app.renderer.view) || document.querySelector('canvas');
            const rect = view.getBoundingClientRect();
            const ratio = rect.width / (app.w || 900);   // css px per logical px
            const pt = { x: (clientX - rect.left) / ratio, y: (clientY - rect.top) / ratio };
            const local = cont.globalToLocal(pt);       // logical container units
            const ps = cam.m_physScale || 62.5;
            return { x: local.x / ps, y: local.y / ps };
        }

        function pickBody(world) {
            const ses = game.session();
            const lvl = game.level();
            if (!ses || !lvl || !ses.m_world) return null;
            const cam = game.camera();
            const ps = (cam && cam.m_physScale) || 62.5;
            const app = window.__HW__.getApp();
            const view = (app.renderer && app.renderer.view) || document.querySelector('canvas');
            const rect = view.getBoundingClientRect();
            const visibleWorld = rect.width / (cam && cam.zoom ? cam.zoom : 1) / ps;
            const maxDist = visibleWorld * 0.06;

            const skip = new Set();
            if (lvl.levelBody) skip.add(lvl.levelBody);
            if (lvl.endBlock && lvl.endBlock.body) skip.add(lvl.endBlock.body);

            let best = null, bestD = Infinity;
            for (let b = ses.m_world.GetBodyList(); b; b = b.GetNext()) {
                if (skip.has(b)) continue;
                let mass = 0;
                try { mass = typeof b.GetMass === 'function' ? b.GetMass() : (b.m_mass || 0); } catch (e) {}
                if (!(mass > 0)) continue;    // static bodies (and NaNs) out
                let p;
                try { p = b.GetPosition(); } catch (e) { continue; }
                if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
                const d = Math.hypot(p.x - world.x, p.y - world.y);
                if (d < bestD) { bestD = d; best = b; }
            }
            return bestD <= maxDist ? best : null;
        }

        function release(silent) {
            if (!state.grabbed) return;
            state.grabbed = null;
            if (!silent) HW.log('PhysGun', 'released');
        }

        // --- input -----------------------------------------------------------

        window.addEventListener('mousedown', (e) => {
            if (!state.armed || e.button !== 0) return;
            if (e.target && e.target.closest && e.target.closest('.hw-panel')) return; // our UI
            if (!inLevel()) return;
            const w = screenToWorld(e.clientX, e.clientY);
            if (!w) return;
            const b = pickBody(w);
            if (b) {
                state.grabbed = b;
                state.target = w;
                HW.log('PhysGun', 'grabbed', (b.constructor && b.constructor.name) || 'body');
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        window.addEventListener('mousemove', (e) => {
            if (!state.armed || !state.grabbed) return;
            const w = screenToWorld(e.clientX, e.clientY);
            if (w) state.target = w;
        }, true);

        window.addEventListener('mouseup', (e) => {
            if (!state.armed || e.button !== 0) return;
            release();
        }, true);

        window.addEventListener('keydown', (e) => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            if (e.key.toLowerCase() !== 'g' || e.ctrlKey || e.altKey || e.metaKey) return;
            setArmed(!state.armed);
        });

        // session gone → drop the grab (world destroyed)
        let lastSes = null;

        function setArmed(v) {
            state.armed = !!v;
            settings.set(NS, 'armed', state.armed);
            if (!state.armed) release(true);
            HW.log('PhysGun', state.armed ? 'ARMED — click a body to grab, G to disarm' : 'disarmed');
        }

        // --- per-tick: PD pull ------------------------------------------------

        HW.onTick(function () {
            try {
                const ses = game.session();
                if (ses !== lastSes) { lastSes = ses; release(true); }
                if (!state.armed || !state.grabbed) return;
                const b = state.grabbed;
                let p;
                try { p = b.GetPosition(); } catch (e) { release(true); return; }
                if (!p || !isFinite(p.x) || !isFinite(p.y)) { release(true); return; }
                let vx = (state.target.x - p.x) * GAIN;
                let vy = (state.target.y - p.y) * GAIN;
                const sp = Math.hypot(vx, vy);
                if (sp > MAXV) { vx *= MAXV / sp; vy *= MAXV / sp; }
                b.SetLinearVelocity({ x: vx, y: vy });
                if (typeof b.SetAwake === 'function') b.SetAwake(true);
            } catch (e) {
                if (!state.errored) { state.errored = true; HW.log('PhysGun', 'tick error:', e.message); release(true); }
            }
        });

        window.physgun = {
            toggle() { setArmed(!state.armed); return state.armed; },
            on() { setArmed(true); },
            off() { setArmed(false); },
            get armed() { return state.armed; }
        };

        HW.log('PhysGun', 'engine ready — G to arm, window.physgun');
    });
})();
