/**
 * Gravity UI — on-screen slider for the Gravity Modifier mod.
 * Requires gravity-mod (window.gravity) and HWLibs.ui (mods/_lib/ui.js).
 *
 * First consumer of HWLibs.ui — the panel/drag/persistence plumbing lives there now.
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    HW.onReady(function () {
        if (!window.gravity) {
            HW.log('Gravity UI', 'gravity-mod not loaded — cannot start');
            return;
        }
        if (!(window.HWLibs && window.HWLibs.ui)) {
            HW.log('Gravity UI', 'HWLibs.ui missing — install lib/_lib/ui.js');
            return;
        }

        const panel = HWLibs.ui.panel({ title: 'Gravity', storageKey: 'gravity' });
        const slider = panel.addSlider({
            min: 0, max: 3, step: 0.05, value: 1,
            onInput: (v) => {
                if (window.gravity.set(v)) panel.setValue(Number(v).toFixed(2) + 'x');
            }
        });
        panel.addButtons([
            { label: '0g', value: 0 },
            { label: 'Moon', value: 0.16 },
            { label: 'Mars', value: 0.38 },
            { label: 'Earth', value: 1 },
            { label: 'Jupiter', value: 2.53 }
        ], (v) => { slider.set(v); window.gravity.set(v); panel.setValue(Number(v).toFixed(2) + 'x'); });

        // readout sync — follow gravity changes made outside this UI
        let poll = setInterval(() => {
            const g = window.gravity.get();
            if (g) {
                slider.set(Math.max(0, Math.min(3, g.multiplier)));
                panel.setValue(g.multiplier.toFixed(2) + 'x');
            }
        }, 500);
        panel.onClosed(() => clearInterval(poll));

        HW.log('Gravity UI', 'panel ready — drag to move');
    });
})();
