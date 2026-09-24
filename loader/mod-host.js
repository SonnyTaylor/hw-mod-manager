/**
 * HW Mod Host (main process)
 *
 * Called from patched main.js after the window finishes loading.
 * Injects the mod runtime into the page's main world, then loads
 * every mod found in the mods/ directory as plain browser JavaScript.
 *
 * Why main process? sandbox:true + contextIsolation:true in the game's
 * window means the renderer has no Node access. But executeJavaScript()
 * from the main process runs directly in the page's main world — full
 * access to PixiJS and game objects, no sandbox restrictions.
 */

const fs = require('fs');
const path = require('path');

// File logging — Windows GUI apps swallow stdout, so write to disk instead
const LOG_FILE = path.join(process.resourcesPath, '..', 'mods', 'hw-mod-host.log');
function log(...args) {
    const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

// Mods live next to the resources folder: <game>/mods
function getModsDir() {
    return path.join(process.resourcesPath, '..', 'mods');
}

// Core runtime injected before any mod. Provides a tiny API surface.
const RUNTIME = `
window.__HW__ = {
    version: '1.0.0',
    mods: [],
    ready: false,
    _readyCallbacks: [],
    _tickCallbacks: [],

    onReady(cb) {
        if (this.ready) cb(this.app);
        else this._readyCallbacks.push(cb);
    },
    onTick(cb) {
        this._tickCallbacks.push(cb);
    },
    getApp() { return this.app; },
    getStage() { return this.app && this.app.stage; },
    log(mod, ...args) {
        console.log('%c[HW]%c ' + mod + ':', 'color:#0af;font-weight:bold', '', ...args);
    }
};

// Locate the PixiJS Application. The game doesn't expose it globally,
// so we probe for it. PixiJS v6 attaches nothing by default, but the
// renderer's canvas -> view -> app chain usually leads back to it.
(function hunt() {
    const canvases = document.querySelectorAll('canvas');
    for (const c of canvases) {
        for (const k of Object.getOwnPropertyNames(c)) {
            try {
                const v = c[k];
                if (v && v.renderer && v.stage && v.ticker) {
                    window.__HW__.app = v;
                    window.__HW__.ready = true;
                    window.__HW__._readyCallbacks.forEach(cb => { try { cb(v); } catch(e){ console.error(e); } });
                    return;
                }
            } catch(e) {}
        }
    }
    setTimeout(hunt, 1000);
})();

// Tick pump — piggybacks on rAF so mods get a per-frame callback
(function tick(t) {
    requestAnimationFrame(tick);
    for (const cb of window.__HW__._tickCallbacks) {
        try { cb(t); } catch(e) { console.error('[HW] tick error:', e); }
    }
})(0);

console.log('%c[HW]%c Mod runtime injected', 'color:#0af;font-weight:bold', '');
`;

module.exports = async function loadMods(win) {
    const modsDir = getModsDir();
    try { fs.writeFileSync(LOG_FILE, ''); } catch (e) {}
    log('Mods directory:', modsDir);

    // Inject runtime first and WAIT for it — mods reference window.__HW__
    // at the top of their IIFE, so a race here breaks every mod.
    try {
        await win.webContents.executeJavaScript(RUNTIME, true);
        log('Runtime injected OK');
    } catch (e) {
        log('Runtime injection FAILED:', e.message);
        return;
    }

    let entries;
    try {
        entries = fs.readdirSync(modsDir, { withFileTypes: true });
    } catch (e) {
        log('Cannot read mods dir:', e.message);
        return;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const modJs = path.join(modsDir, entry.name, 'mod.js');
        const manifestPath = path.join(modsDir, entry.name, 'mod.json');

        if (!fs.existsSync(modJs)) continue;

        let manifest = { name: entry.name, version: '1.0.0' };
        try {
            if (fs.existsSync(manifestPath)) {
                manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
            }
        } catch (e) {
            log(`Bad mod.json in ${entry.name}:`, e.message);
        }

        let code;
        try {
            code = fs.readFileSync(modJs, 'utf8');
        } catch (e) {
            log(`Cannot read ${modJs}:`, e.message);
            continue;
        }

        const registration = `
            try {
                window.__HW__.mods.push(${JSON.stringify(manifest)});
                console.log('[HW] Loaded mod: ${manifest.name} v${manifest.version}');
            } catch(e) {
                console.error('[HW] Mod ${manifest.name} failed:', e);
            }
        `;

        // Wrap the mod in try/catch INSIDE the page so we get the real error
        // back over the promise (executeJavaScript's generic "script failed
        // to execute" message is useless for debugging).
        const wrapped = `(() => {
    try {
        ${code}
        ${registration}
        return 'OK|hw=' + typeof window.__HW__ + '|mods=' + (window.__HW__ ? window.__HW__.mods.length : '?');
    } catch (e) {
        return 'ERR|' + (e && e.message ? e.message : String(e)) + '|' + (e && e.stack ? String(e.stack).split('\\n').slice(0,3).join(' << ') : '');
    }
})()`;

        try {
            const result = await win.webContents.executeJavaScript(wrapped, true);
            if (result.startsWith('OK')) {
                log(`Injected: ${manifest.name} v${manifest.version} [${result}]`);
            } else {
                log(`Failed ${manifest.name}: ${result}`);
            }
        } catch (e) {
            log(`Failed to inject ${manifest.name}:`, e.message);
        }
    }
};
