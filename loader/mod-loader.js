/**
 * Happy Wheels Mod Loader
 * 
 * This script is injected into the Electron app via preload.
 * It loads mods from the mods/ directory and provides them with
 * APIs to modify the game.
 * 
 * Mods run in the renderer context with access to:
 * - window.hwNative (Electron IPC bridge)
 * - The PixiJS stage (once game loads)
 * - Game state (once available)
 */

const fs = require('fs');
const path = require('path');

class HWModLoader {
    constructor() {
        this.mods = [];
        this.gameReady = false;
        this.pixiApp = null;
        this.modApi = null;
        
        // Paths
        this.gamePath = path.dirname(path.dirname(__dirname)); // Go up from electron/out/
        this.modsPath = path.join(this.gamePath, 'mods');
        
        console.log('[HW Mod Loader] Initializing...');
        console.log('[HW Mod Loader] Game path:', this.gamePath);
        console.log('[HW Mod Loader] Mods path:', this.modsPath);
    }

    async init() {
        // Create mods directory if it doesn't exist
        if (!fs.existsSync(this.modsPath)) {
            fs.mkdirSync(this.modsPath, { recursive: true });
        }

        // Create mod API
        this.modApi = this.createModApi();

        // Load all mods
        await this.loadMods();

        // Set up game hooks
        this.setupHooks();

        console.log(`[HW Mod Loader] Initialized with ${this.mods.length} mod(s)`);
    }

    createModApi() {
        const loader = this;
        
        return {
            /**
             * Get the PixiJS application instance
             */
            getPixiApp() {
                return loader.pixiApp;
            },

            /**
             * Get the game's stage (root container)
             */
            getStage() {
                return loader.pixiApp?.stage;
            },

            /**
             * Register a callback for when the game is ready
             */
            onGameReady(callback) {
                if (loader.gameReady) {
                    callback(loader.pixiApp);
                } else {
                    loader._gameReadyCallbacks = loader._gameReadyCallbacks || [];
                    loader._gameReadyCallbacks.push(callback);
                }
            },

            /**
             * Register a callback for each game tick
             */
            onTick(callback) {
                loader._tickCallbacks = loader._tickCallbacks || [];
                loader._tickCallbacks.push(callback);
            },

            /**
             * Hook into native API calls
             */
            hookNative(method, callback) {
                if (window.hwNative && window.hwNative[method]) {
                    const original = window.hwNative[method];
                    window.hwNative[method] = function(...args) {
                        return callback(original, ...args);
                    };
                }
            },

            /**
             * Log to console with mod prefix
             */
            log(modName, ...args) {
                console.log(`[Mod: ${modName}]`, ...args);
            },

            /**
             * Get game settings
             */
            getSettings() {
                return window.HW_SETTINGS || {};
            },

            /**
             * Access to the file system for mod data
             */
            getModDataPath(modName) {
                const dataPath = path.join(loader.modsPath, modName, 'data');
                if (!fs.existsSync(dataPath)) {
                    fs.mkdirSync(dataPath, { recursive: true });
                }
                return dataPath;
            }
        };
    }

    async loadMods() {
        if (!fs.existsSync(this.modsPath)) {
            console.log('[HW Mod Loader] No mods directory found');
            return;
        }

        const entries = fs.readdirSync(this.modsPath, { withFileTypes: true });
        
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            
            const modPath = path.join(this.modsPath, entry.name);
            const manifestPath = path.join(modPath, 'mod.json');
            const mainPath = path.join(modPath, 'mod.js');

            // Check for mod manifest or main file
            if (fs.existsSync(manifestPath) || fs.existsSync(mainPath)) {
                try {
                    await this.loadMod(entry.name, modPath, manifestPath, mainPath);
                } catch (err) {
                    console.error(`[HW Mod Loader] Failed to load mod "${entry.name}":`, err);
                }
            }
        }
    }

    async loadMod(name, modPath, manifestPath, mainPath) {
        let manifest = { name, version: '1.0.0', description: '' };
        
        // Load manifest if exists
        if (fs.existsSync(manifestPath)) {
            try {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                manifest.name = manifest.name || name;
            } catch (err) {
                console.warn(`[HW Mod Loader] Invalid mod.json in "${name}", using defaults`);
            }
        }

        // Skip if no main file
        if (!fs.existsSync(mainPath)) {
            console.log(`[HW Mod Loader] Skipping "${name}" - no mod.js found`);
            return;
        }

        console.log(`[HW Mod Loader] Loading mod: ${manifest.name} v${manifest.version}`);

        // Load the mod
        const mod = require(mainPath);
        
        // Call mod's init function if it exists
        if (typeof mod.init === 'function') {
            await mod.init(this.modApi);
        }

        this.mods.push({
            name: manifest.name,
            version: manifest.version,
            module: mod,
            path: modPath
        });
    }

    setupHooks() {
        // Hook into the game's initialization
        // We need to detect when PixiJS is ready and the game has started
        
        // Method 1: Watch for PIXI to be available
        const checkInterval = setInterval(() => {
            // Look for PIXI app in the global scope or attached to elements
            const canvas = document.querySelector('canvas');
            if (canvas && canvas.__pixi_app__) {
                this.pixiApp = canvas.__pixi_app__;
                this.onPixiReady();
                clearInterval(checkInterval);
                return;
            }

            // Alternative: Check for PIXI global
            if (window.PIXI) {
                // Try to find the app instance
                this.findPixiApp();
            }
        }, 1000);

        // Method 2: Hook into requestAnimationFrame for game loop
        const originalRAF = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => {
            return originalRAF((timestamp) => {
                // Run mod tick callbacks
                if (this._tickCallbacks) {
                    for (const cb of this._tickCallbacks) {
                        try {
                            cb(timestamp, this.pixiApp);
                        } catch (err) {
                            console.error('[HW Mod Loader] Tick callback error:', err);
                        }
                    }
                }
                callback(timestamp);
            });
        };

        // Method 3: Listen for DOM changes that indicate game state
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.tagName === 'CANVAS') {
                        setTimeout(() => this.findPixiApp(), 500);
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    findPixiApp() {
        // PIXI apps are often stored on canvas elements
        const canvases = document.querySelectorAll('canvas');
        for (const canvas of canvases) {
            // Check common PIXI app storage patterns
            for (const key of Object.keys(canvas)) {
                if (canvas[key] && canvas[key].stage && canvas[key].renderer) {
                    this.pixiApp = canvas[key];
                    this.onPixiReady();
                    return;
                }
            }
        }

        // Check window object for PIXI app
        if (window.__PIXI_APP__) {
            this.pixiApp = window.__PIXI_APP__;
            this.onPixiReady();
        }
    }

    onPixiReady() {
        if (this.gameReady) return;
        
        this.gameReady = true;
        console.log('[HW Mod Loader] PixiJS app detected!');

        // Notify mods
        if (this._gameReadyCallbacks) {
            for (const cb of this._gameReadyCallbacks) {
                try {
                    cb(this.pixiApp);
                } catch (err) {
                    console.error('[HW Mod Loader] Game ready callback error:', err);
                }
            }
        }
    }
}

// Initialize the mod loader
const modLoader = new HWModLoader();
modLoader.init().catch(err => {
    console.error('[HW Mod Loader] Initialization failed:', err);
});

// Expose to window for debugging
window.__HW_MOD_LOADER__ = modLoader;