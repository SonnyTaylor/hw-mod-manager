/**
 * Gravity Modifier — browser-script style mod
 * Usage in console:
 *   gravity.set(0.5)   // half gravity
 *   gravity.moon()     // 0.16x
 *   gravity.zeroG()    // 0x
 *   gravity.reset()    // back to normal
 */
(function () {
    'use strict';

    const HW = window.__HW__;
    const HW_GRAVITY = -10; // PixiJS/box2d convention will be confirmed at runtime

    function findWorld() {
        // The Session object holding the Box2D world isn't globally exposed.
        // Strategy: walk the stage and look for objects with a b2World-like shape.
        const stage = HW.getStage();
        if (!stage) return null;
        let found = null;
        (function walk(node, depth) {
            if (found || depth > 6) return;
            for (const k of Object.getOwnPropertyNames(node)) {
                try {
                    const v = node[k];
                    if (v && typeof v === 'object' && v.SetGravity && v.GetGravity) {
                        found = v;
                        return;
                    }
                    if (v && typeof v === 'object' && v.m_world && v.m_world.SetGravity) {
                        found = v.m_world;
                        return;
                    }
                } catch (e) {}
            }
            if (node.children) for (const c of node.children) walk(c, depth + 1);
        })(stage, 0);
        return found;
    }

    HW.onReady(function () {
        HW.log('Gravity Modifier', 'ready — waiting for physics world');

        window.gravity = {
            set(multiplier) {
                const world = findWorld();
                if (!world) {
                    HW.log('Gravity Modifier', 'physics world not found (only works during a level?)');
                    return false;
                }
                const g = world.GetGravity();
                const box = window.Box2D || { Common: { Math: { b2Vec2: null } } };
                // b2Vec2 may not be globally exposed; fall back to duck-typing
                let vec;
                try {
                    vec = new box.Common.Math.b2Vec2(0, HW_GRAVITY * multiplier);
                } catch (e) {
                    // If we can't construct a b2Vec2, mutate the existing one
                    vec = g;
                    vec.y = HW_GRAVITY * multiplier;
                }
                world.SetGravity(vec);
                HW.log('Gravity Modifier', 'set to ' + multiplier + 'x');
                return true;
            },
            reset() { return this.set(1); },
            moon() { return this.set(0.16); },
            mars() { return this.set(0.38); },
            jupiter() { return this.set(2.53); },
            zeroG() { return this.set(0); },
            get() {
                const world = findWorld();
                if (!world) return null;
                const g = world.GetGravity();
                return { x: g.x, y: g.y, multiplier: g.y / HW_GRAVITY };
            }
        };

        HW.log('Gravity Modifier', 'try: gravity.moon()');
    });
})();
