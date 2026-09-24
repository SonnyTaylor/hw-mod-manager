/**
 * DevTools Helper Mod
 * 
 * Provides utility functions for inspecting and debugging the game.
 * Access via window.devTools in the browser console.
 */

let api = null;

module.exports = {
    name: 'DevTools Helper',
    
    async init(modApi) {
        api = modApi;
        api.log('DevTools Helper', 'Initializing...');
        
        // Set up debug utilities
        window.devTools = {
            /**
             * Get the current PixiJS app
             */
            getPixiApp: () => api.getPixiApp(),
            
            /**
             * Get the game stage
             */
            getStage: () => api.getStage(),
            
            /**
             * List all display objects on stage
             */
            listStageChildren: () => {
                const stage = api.getStage();
                if (!stage) return 'Stage not available';
                
                const children = [];
                const traverse = (container, depth = 0) => {
                    for (const child of container.children || []) {
                        children.push({
                            name: child.constructor.name,
                            type: child.constructor.name,
                            visible: child.visible,
                            x: child.x,
                            y: child.y,
                            width: child.width,
                            height: child.height,
                            depth
                        });
                        if (child.children && child.children.length > 0) {
                            traverse(child, depth + 1);
                        }
                    }
                };
                traverse(stage);
                return children;
            },
            
            /**
             * Get game settings
             */
            getSettings: () => api.getSettings(),
            
            /**
             * Monitor physics bodies (if Box2D is exposed)
             */
            getPhysicsWorld: () => {
                // Box2D world might be accessible through game objects
                const stage = api.getStage();
                if (stage && stage.session) {
                    return stage.session.m_world;
                }
                return null;
            },
            
            /**
             * Take a screenshot
             */
            screenshot: () => {
                const app = api.getPixiApp();
                if (!app) return null;
                return app.renderer.extract.canvas(app.stage);
            },
            
            /**
             * List loaded mods
             */
            listMods: () => {
                return window.__HW_MOD_LOADER__?.mods || [];
            }
        };
        
        // Wait for game to be ready
        api.onGameReady((pixiApp) => {
            api.log('DevTools Helper', 'Game is ready!');
            api.log('DevTools Helper', 'Use window.devTools to inspect the game');
            api.log('DevTools Helper', 'Example: devTools.listStageChildren()');
        });
    }
};