/**
 * Character Editor — break-limit multiplier + bleed heal.
 *
 * Console API (window.charEd):
 *   charEd.setFactor(n)  multiplier on all break/ligament limits
 *                        (1 = normal, 3 = tough, 1e9 = effectively god mode)
 *   charEd.getFactor()
 *   charEd.heal()        reset bleedCounter to 0
 *   charEd.info()        discovered limit keys + {base, current} per key
 *
 * Internals used (verified, see docs/game-internals.md):
 *   character (class ij): neckBreakLimit, spineLimit, torsoBreakLimit,
 *   shoulderBreakLimit, hipBreakLimit, elbowLigamentLimit, kneeLigamentLimit…,
 *   bleedCounter, lostLimbs (Set)
 *
 * Approach: limit keys are DISCOVERED per character instance (own props
 * matching /Limit$/) — never hard-coded, so extra joints (wrists etc.) are
 * covered automatically. A baseline is captured once per character object;
 * limits are re-applied every frame as baseline × factor, which covers
 * respawns and any game-side limit resets. Limb restoration (lostLimbs) is
 * deliberately NOT attempted — clearing the Set does not rebuild destroyed
 * Box2D bodies/joints.
 */
(function () {
    'use strict';

    const HW = window.__HW__;
    const NS = 'character-editor';
    const GOD = 1e9;

    HW.onReady(function () {
        if (!(window.HWLibs && HWLibs.game && HWLibs.settings)) {
            HW.log('Character Editor', 'HWLibs.game/settings missing — install mods/_lib/');
            return;
        }
        const game = HWLibs.game;
        const settings = HWLibs.settings;

        const state = {
            factor: settings.get(NS, 'factor', 1),
            hotFactor: settings.get(NS, 'hotFactor', GOD), // what the I hotkey restores to
            base: null,      // { key: baselineValue } for the current character
            keys: null,      // discovered limit keys
            lastChar: null,
            errored: false   // log async errors once, don't spam per frame
        };

        // --- discovery + application -------------------------------------

        function discoverKeys(char) {
            const keys = Object.getOwnPropertyNames(char).filter(k => /Limit/.test(k) && typeof char[k] === 'number');
            return keys.length ? keys : null;
        }

        function captureBase(char) {
            state.keys = discoverKeys(char);
            state.base = {};
            if (state.keys) for (const k of state.keys) state.base[k] = char[k];
        }

        function apply(char) {
            if (!state.keys) return;
            for (const k of state.keys) {
                try { char[k] = state.base[k] * state.factor; } catch (e) {}
            }
        }

        function setFactor(v, opts) {
            state.factor = v >= GOD ? GOD : Math.max(1, Number(v) || 1);
            settings.set(NS, 'factor', state.factor);
            const c = game.character();
            if (c) apply(c);
            syncPanel();
            if (!opts || !opts.silent) HW.log('Character Editor', 'break limits ×' + fmtFactor());
            return state.factor;
        }

        function heal() {
            const c = game.character();
            if (!c) return false;
            try {
                if (typeof c.bleedCounter === 'number') c.bleedCounter = 0;
                if (c.bleedCounter && typeof c.bleedCounter.set === 'function') c.bleedCounter.set(0);
                HW.log('Character Editor', 'bleed reset');
                return true;
            } catch (e) {
                HW.log('Character Editor', 'heal failed:', e.message);
                return false;
            }
        }

        function fmtFactor() {
            return state.factor >= GOD ? 'GOD (∞)' : state.factor.toFixed(1).replace(/\.0$/, '') + 'x';
        }

        function info() {
            const c = game.character();
            if (!c || !state.keys) return { ready: false, note: 'enter a level first' };
            return state.keys.map(k => ({ key: k, base: state.base[k], current: c[k] }))
                .concat([{ factor: state.factor, bleedCounter: c.bleedCounter }]);
        }

        window.charEd = { setFactor, getFactor: () => state.factor, heal, info };

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

        // --- panel ---------------------------------------------------------

        let panel = null, slider = null;
        try {
            if (!(window.HWLibs && HWLibs.ui)) throw new Error('HWLibs.ui missing');
            panel = HWLibs.ui.panel({ title: 'Character', storageKey: 'char-ed' });
            slider = panel.addSlider({
                min: 1, max: 50, step: 0.5, value: state.factor,
                onInput: (v) => setFactor(v, { silent: true })
            });
            panel.addButtons([
                { label: 'Normal', value: 1 },
                { label: 'Tough', value: 3 },
                { label: 'Iron', value: 10 }
            ], (v) => { slider.set(v, true); });
            panel.addButtons([{ label: 'GOD', value: GOD }], (v) => { slider.set(50, true); setFactor(v); });
            panel.addButtons([{ label: 'Heal', value: 'heal' }], () => heal());
            syncPanel();
        } catch (e) {
            HW.log('Character Editor', 'panel failed (mod still active):', e.message);
        }

        function syncPanel() {
            if (!panel) return;
            panel.setValue(fmtFactor());
            if (slider && state.factor <= 50) slider.set(state.factor);
        }

        HW.log('Character Editor', 'ready — hotkey I = god toggle, window.charEd for console');
    });
})();
