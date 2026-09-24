/**
 * Gravity Modifier Mod
 * 
 * Changes the game's gravity. Fun for moon jumps or heavy gravity!
 * 
 * Usage in console:
 *   gravity.set(0.5)   // Half gravity (moon-like)
 *   gravity.set(1.0)   // Normal gravity
 *   gravity.set(2.0)   // Double gravity
 *   gravity.reset()    // Back to default
 */

let api = null;
const DEFAULT_GRAVITY = 10; // Box2D default gravity

module.exports = {
    name: 'Gravity Modifier',
    
    async init(modApi) {
        api = modApi;
        api.log('Gravity Modifier', 'Initializing...');
        
        // Expose gravity controls
        window.gravity = {
            /**
             * Set gravity multiplier (1.0 = normal)
             */
            set(multiplier) {
                const world = findPhysicsWorld();
                if (!world) {
                    api.log('Gravity Modifier', 'Physics world not found!');
                    return false;
                }
                
                const gravity = new Box2D.Common.Math.b2Vec2(0, DEFAULT_GRAVITY * multiplier);
                world.SetGravity(gravity);
                api.log('Gravity Modifier', `Gravity set to ${multiplier}x`);
                return true;
            },
            
            /**
             * Reset to default gravity
             */
            reset() {
                this.set(1.0);
            },
            
            /**
             * Get current gravity
             */
            get() {
                const world = findPhysicsWorld();
                if (!world) return null;
                const g = world.GetGravity();
                return {
                    x: g.x,
                    y: g.y,
                    multiplier: g.y / DEFAULT_GRAVITY
                };
            },
            
            /**
             * Fun presets
             */
            moon: () => window.gravity.set(0.16),
            mars: () => window.gravity.set(0.38),
            jupiter: () => window.gravity.set(2.53),
            zeroG: () => window.gravity.set(0),
        };
        
        api.log('Gravity Modifier', 'Ready! Use gravity.set(multiplier) to change gravity');
    }
};

/**
 * Try to find the Box2D physics world
 */
function findPhysicsWorld() {
    // Method 1: Through PixiJS stage (if game exposes it)
    const stage = api.getStage();
    if (stage) {
        // The game might store session/world on stage
        if (stage.session?.m_world) return stage.session.m_world;
        if (stage.__session?.m_world) return stage.__session.m_world;
    }
    
    // Method 2: Search window for Box2D world
    // This is hacky but sometimes necessary
    for (const key of Object.keys(window)) {
        const obj = window[key];
        if (obj && obj.m_world && obj.m_world.SetGravity) {
            return obj.m_world;
        }
    }
    
    return null;
}