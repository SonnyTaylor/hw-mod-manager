/**
 * HWLibs.game — safe accessors over the verified game object graph.
 * See docs/game-internals.md for the full graph. All getters return null
 * (and log once per session) when the target doesn't exist yet.
 *
 * Requires: nothing. Registers: window.HWLibs.game
 */
(function () {
    'use strict';

    const HW = window.__HW__;
    let warned = {};

    function warnOnce(key, msg) {
        if (warned[key]) return;
        warned[key] = true;
        HW.log('HWLibs.game', msg);
    }

    function getScreen() {
        try {
            const sm = HW.app.screenManager;
            return (sm && sm.currentScreen) || null;
        } catch (e) { return null; }
    }

    function getSession() {
        try {
            const hw = getScreen().happyWheels;
            const s = hw.sessionController.session;
            if (!s || s.isMenu) return null;
            return s;
        } catch (e) { return null; }
    }

    function needSession(label) {
        const s = getSession();
        if (!s) warnOnce(label, label + ': no active level session — enter a level first');
        return s;
    }

    window.HWLibs = window.HWLibs || {};
    window.HWLibs.game = {
        /** Live level session (class MA) or null. */
        session: getSession,
        /** Box2D world or null. */
        world() { const s = needSession('world'); return (s && s.m_world) || null; },
        /** Level model (class i2) or null. */
        level() { const s = needSession('level'); return (s && s._level) || null; },
        /** Player character (class ij) or null. */
        character() { const s = needSession('character'); return (s && s._character) || null; },
        /** Session controller (class fu) — has restartLevel()/replayLevel()/levelDataObject. */
        sessionController() {
            try { return getScreen().happyWheels.sessionController || null; } catch (e) { return null; }
        },
        /** Camera controller (class J) or null. */
        camera() { const s = needSession('camera'); return (s && s._camera) || null; },
        /** true when a level session is active (not menu). */
        inLevel() { return !!getSession(); },
        /** Gravity convenience: get current {x,y,multiplier} (y-down, +10 = Earth). */
        getGravity() {
            const w = this.world();
            if (!w || !w.m_gravity) return null;
            return { x: w.m_gravity.x, y: w.m_gravity.y, multiplier: w.m_gravity.y / 10 };
        },
        /** Gravity convenience: set multiplier (y-down, +10 = Earth). */
        setGravity(multiplier) {
            const w = this.world();
            if (!w || !w.m_gravity) { warnOnce('setGravity', 'setGravity: no world — enter a level first'); return false; }
            const y = 10 * multiplier;
            const g = w.m_gravity;
            if (typeof g.Set === 'function') g.Set(0, y); else { g.x = 0; g.y = y; }
            w.SetGravity(g);
            return true;
        }
    };
})();
