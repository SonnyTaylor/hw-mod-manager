/**
 * Time Mod (engine) — physics time control (slow-motion / fast-forward).
 *
 * Console API (window.timeScale):
 *   timeScale.set(n)   factor on the physics step (0.1 = slow-mo, 1 = normal, 2 = fast)
 *   timeScale.get()
 *   timeScale.normal() back to 1
 *
 * Internals: session.m_timeStep is the fixed physics step (1/30 s, verified in
 * docs/game-internals.md). We re-apply base × factor every tick — same pattern as
 * character-editor's break limits — because the session object is recreated on
 * level load/restart. Base is captured per session instance from the live value,
 * so it stays correct even if the game changes its step size.
 *
 * Only session.m_timeStep is touched — never the game's frame loop or accumulator
 * (steps/_accumulatedStep), so rendering stays at full fps while the world advances
 * slower/faster.
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.game && HWLibs.settings)) {
            HW.log('Time Mod', 'HWLibs.game/settings missing — install mods/_lib/');
            return;
        }
        const game = HWLibs.game;
        const settings = HWLibs.settings;
        const NS = 'time-mod';

        const state = {
            factor: settings.get(NS, 'factor', 1),
            base: null,     // baseline m_timeStep per session instance
            lastSes: null,
            errored: false
        };

        function setFactor(v, opts) {
            state.factor = Math.max(0.05, +v || 1);
            settings.set(NS, 'factor', state.factor);
            const ses = game.session();
            if (ses && state.base) ses.m_timeStep = state.base * state.factor;
            if (!opts || !opts.silent) HW.log('Time Mod', 'time ×' + fmt());
            return state.factor;
        }

        function fmt() {
            return parseFloat(state.factor.toFixed(2)) + 'x';
        }

        window.timeScale = {
            set: setFactor,
            get: () => state.factor,
            normal: () => setFactor(1)
        };

        HW.onTick(function () {
            try {
                const ses = game.session();
                if (!ses) { state.lastSes = null; return; }
                if (ses !== state.lastSes) {
                    state.lastSes = ses;
                    state.base = ses.m_timeStep;
                    if (state.factor !== 1) ses.m_timeStep = state.base * state.factor;
                }
                if (state.factor !== 1 && state.base) ses.m_timeStep = state.base * state.factor;
            } catch (e) {
                if (!state.errored) { state.errored = true; HW.log('Time Mod', 'tick error:', e.message); }
            }
        });

        HW.log('Time Mod', 'engine ready — window.timeScale (UI: cheat-menu mod)');
    });
})();
