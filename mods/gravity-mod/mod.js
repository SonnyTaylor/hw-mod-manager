/**
 * Gravity Modifier — browser-script style mod
 * Usage in console:
 *   gravity.set(0.5)   // half gravity
 *   gravity.moon()     // 0.16x
 *   gravity.mars()     // 0.38x
 *   gravity.jupiter()  // 2.53x
 *   gravity.zeroG()    // 0x
 *   gravity.get()      // current gravity
 *   gravity.reset()    // back to 1x
 *
 * World path (discovered live via eval bridge, see mods/AGENTS.md):
 *   app.screenManager.currentScreen.happyWheels.sessionController.session.m_world
 * Box2D 2.1a Flash-port API: world.SetGravity(vec), gravity in world.m_gravity
 * as {x:0, y:10} — y-DOWN positive, physScale 62.5 px/m. b2Vec2 has .Set(x,y).
 * Only exists while a level is loaded (menu has no session).
 *
 * Hot-toggle + settings (see mods/AGENTS.md contract):
 *   onDisable  → resets gravity to 1x (the game keeps running normally).
 *   onSettings → applies the manager's saved values (preset / factor);
 *                deferred until window.gravity exists (onReady may lag the
 *                injection that pushed the values).
 */
(function () {
    'use strict';

    const HW = window.__HW__;
    const BASE_GRAVITY = 10; // measured live: m_gravity = {x:0, y:10}

    function findSession() {
        try {
            return HW.app.screenManager.currentScreen.happyWheels.sessionController.session;
        } catch (e) {
            return null;
        }
    }

    let pendingSettings = null;

    function applySettings(v) {
        v = v || {};
        const g = window.gravity;
        if (!g) { pendingSettings = v; return; }
        if (v.preset === 'custom') {
            if (typeof v.factor === 'number') g.set(v.factor);
        } else if (v.preset && v.preset !== 'normal' && typeof g[v.preset] === 'function') {
            g[v.preset]();
        } else {
            g.reset();
        }
    }

    HW.onSettings(applySettings);
    HW.onDisable(function () {
        try { if (window.gravity) window.gravity.reset(); } catch (e) {}
        HW.log('Gravity Modifier', 'disabled — gravity restored');
    });

    HW.onReady(function () {
        HW.log('Gravity Modifier', 'ready — path-based world finder (enter a level to use)');

        window.gravity = {
            set(multiplier) {
                const session = findSession();
                const world = session && session.m_world;
                if (!world || !world.m_gravity) {
                    HW.log('Gravity Modifier', 'physics world not found — enter a level first');
                    return false;
                }
                const g = world.m_gravity;
                const y = BASE_GRAVITY * multiplier;
                if (typeof g.Set === 'function') g.Set(0, y);
                else { g.x = 0; g.y = y; }
                // 2.1a port: SetGravity stores the reference — both mutations are belt & braces
                world.SetGravity(g);
                HW.log('Gravity Modifier', 'gravity set to ' + multiplier + 'x (' + y.toFixed(2) + ' y/s²)');
                return true;
            },
            get() {
                const session = findSession();
                const world = session && session.m_world;
                if (!world || !world.m_gravity) return null;
                const g = world.m_gravity;
                return { x: g.x, y: g.y, multiplier: g.y / BASE_GRAVITY };
            },
            reset() { return this.set(1); },
            moon() { return this.set(0.16); },
            mars() { return this.set(0.38); },
            jupiter() { return this.set(2.53); },
            zeroG() { return this.set(0); }
        };

        if (pendingSettings) { applySettings(pendingSettings); pendingSettings = null; }
    });
})();
