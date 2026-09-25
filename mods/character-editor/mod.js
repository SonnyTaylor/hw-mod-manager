/**
 * Character Editor (engine) — break-limit multiplier + bleed heal.
 * UI panel lives in the cheat-menu mod; this mod exposes the API and keeps
 * limits applied every tick.
 *
 * Console API (window.charEd):
 *   charEd.setFactor(n)  multiplier on all break/ligament limits
 *                        (0.05–0.5 = fragile, 1 = normal, 3 = tough,
 *                         1e9 = effectively god mode)
 *   charEd.getFactor()
 *   charEd.heal()        reset bleedCounter to 0
 *   charEd.info()        discovered limit keys + {base, current} per key
 *
 * Hotkey: I — toggles between 1x and the remembered "god" factor (default 1e9).
 *
 * Internals used (verified, see docs/game-internals.md):
 *   character (class ij): neckBreakLimit, spineLimit, torsoBreakLimit,
 *   shoulderBreakLimit, hipBreakLimit, elbowLigamentLimit, kneeLigamentLimit…,
 *   bleedCounter, lostLimbs (Set)
 *
 * Approach: limit keys are DISCOVERED per character instance (own props
 * matching /Limit$/) — never hard-coded, 20 keys found live so far. A baseline
 * is captured once per character object; limits are re-applied every frame as
 * baseline × factor, which covers respawns and any game-side limit resets.
 * Limb restoration (lostLimbs) is deliberately NOT attempted — clearing the
 * Set does not rebuild destroyed Box2D bodies/joints.
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.game && HWLibs.settings)) {
            HW.log('Character Editor', 'HWLibs.game/settings missing — install mods/_lib/');
            return;
        }
        const game = HWLibs.game;
        const settings = HWLibs.settings;
        const NS = 'character-editor';
        const GOD = 1e9;

        const state = {
            factor: settings.get(NS, 'factor', 1),
            hotFactor: settings.get(NS, 'hotFactor', GOD), // what the I hotkey toggles to
            base: null,      // { key: baselineValue } for the current character
            keys: null,      // discovered limit keys
            lastChar: null,
            errored: false   // log async errors once, don't spam per frame
        };

        // --- discovery + application -------------------------------------

        function discoverKeys(char) {
            return Object.getOwnPropertyNames(char)
                .filter(k => /Limit/.test(k) && typeof char[k] === 'number');
        }

        function captureBase(char) {
            state.keys = discoverKeys(char);
            state.base = {};
            for (const k of state.keys) state.base[k] = char[k];
        }

        function apply(char) {
            if (!state.keys) return;
            for (const k of state.keys) {
                try { char[k] = state.base[k] * state.factor; } catch (e) {}
            }
        }

        function setFactor(v, opts) {
            state.factor = v >= GOD ? GOD : Math.max(0.05, +v || 1);
            settings.set(NS, 'factor', state.factor);
            const c = game.character();
            if (c) apply(c);
            if (!opts || !opts.silent) HW.log('Character Editor', 'break limits ×' + fmtFactor());
            return state.factor;
        }

        function heal() {
            const c = game.character();
            if (!c) return false;
            try {
                if (typeof c.bleedCounter === 'number') c.bleedCounter = 0;
                if (c.lostLimbs) c.lostLimbs.clear();
                HW.log('Character Editor', 'bleed stopped');
                return true;
            } catch (e) {
                HW.log('Character Editor', 'heal failed:', e.message);
                return false;
            }
        }

        /** Full heal: game-native level restart — regrows limbs, clears lostLimbs,
         *  bleeding and any world bloat. The tick engine re-applies the factor to the
         *  fresh character automatically (new instance → new baseline).
         *  NOTE: character.reset()/create() called directly LEAK 27 bodies per call
         *  (the game tears down at session level, not character level) — never call
         *  them as a heal. restartLevel() is the clean path. */
        function respawn() {
            try {
                const sc = game.sessionController();
                if (!sc || typeof sc.restartLevel !== 'function') throw new Error('no sessionController.restartLevel');
                sc.restartLevel();
                HW.log('Character Editor', 'level restarted (full heal)');
                return true;
            } catch (e) {
                HW.log('Character Editor', 'respawn failed:', e.message);
                return false;
            }
        }

        function fmtFactor() {
            return state.factor >= GOD ? 'GOD (∞)' : parseFloat(state.factor.toFixed(2)) + 'x';
        }

        function info() {
            const c = game.character();
            if (!c || !state.keys) return { ready: false, note: 'enter a level first' };
            return state.keys.map(k => ({ key: k, base: state.base[k], current: c[k] }))
                .concat([{ factor: state.factor, bleedCounter: c.bleedCounter }]);
        }

        window.charEd = { setFactor, getFactor: () => state.factor, heal, respawn, info };

        // --- tick: keep limits applied -----------------------------------

        HW.onTick(function () {
            try {
                const c = game.character();
                if (!c) { state.lastChar = null; return; }
                if (c !== state.lastChar) {
                    state.lastChar = c;
                    captureBase(c);
                    if (state.factor !== 1) HW.log('Character Editor', state.keys.length + ' limits found, applying ' + fmtFactor());
                }
                apply(c);
            } catch (e) {
                if (!state.errored) { state.errored = true; HW.log('Character Editor', 'tick error:', e.message); }
            }
        });

        // --- hotkey: I toggles between normal and hotFactor ---------------

        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() !== 'i' || e.ctrlKey || e.altKey || e.metaKey) return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            const goingGod = state.factor === 1;
            setFactor(goingGod ? state.hotFactor : 1);
            if (!goingGod) settings.set(NS, 'hotFactor', state.hotFactor); // remember next god level
        });

        HW.log('Character Editor', 'engine ready — window.charEd (UI: cheat-menu mod)');
    });
})();
