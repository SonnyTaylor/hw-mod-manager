/**
 * DevTools Helper — browser-script style mod
 * Exposes window.devTools for inspecting the game from the console.
 */
(function () {
    'use strict';

    const HW = window.__HW__;

    HW.onDisable(function () {
        try { delete window.devTools; } catch (e) {}
        HW.log('DevTools Helper', 'disabled — window.devTools removed');
    });

    HW.onReady(function (app) {
        HW.log('DevTools Helper', 'game ready, exposing window.devTools');

        window.devTools = {
            getApp: () => window.__HW__.app,
            getStage: () => window.__HW__.app && window.__HW__.app.stage,

            listStageChildren() {
                const stage = this.getStage();
                if (!stage) return 'Stage not available';
                const out = [];
                (function walk(container, depth) {
                    for (const child of container.children || []) {
                        out.push({
                            type: child.constructor.name,
                            visible: child.visible,
                            x: Math.round(child.x),
                            y: Math.round(child.y),
                            children: (child.children || []).length,
                            depth
                        });
                        if (child.children && child.children.length && depth < 4) {
                            walk(child, depth + 1);
                        }
                    }
                })(stage, 0);
                return out;
            },

            getSettings: () => window.HW_SETTINGS || {},
            listMods: () => window.__HW__.mods.map(m => m.name + ' v' + m.version),

            screenshot() {
                const app = this.getApp();
                if (!app) return null;
                return app.renderer.extract.canvas(app.stage);
            }
        };

        HW.log('DevTools Helper', 'try: devTools.listStageChildren()');
    });
})();
