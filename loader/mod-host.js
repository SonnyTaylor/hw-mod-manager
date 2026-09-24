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
    },

    // Called by the CDP discovery loop once the live renderer is found.
    _setRenderer(renderer) {
        if (this.ready) return true;
        const app = {
            isShim: true,
            renderer,
            get stage() { return renderer._lastObjectRendered; },
            get ticker() { return renderer.ticker || null; },
            get view() { return renderer.view; },
        };
        return this._setApp(app);
    },

    // Called when the preload pre-hook captured the real Application.
    _setApp(app) {
        if (this.ready) return true;
        this.app = app;
        this.ready = true;
        this._readyCallbacks.forEach(cb => { try { cb(app); } catch (e) { console.error('[HW] onReady error:', e); } });
        this._readyCallbacks.length = 0;
        console.log('%c[HW]%c App discovered — ready', 'color:#0af;font-weight:bold');
        return true;
    }
};

// Poll the preload pre-hook's capture slot. The hook only catches the app
// once a ticker frame fires after game scripts run; retry until found.
(function checkDiscovery() {
    try {
        const d = window.__HW_DISCOVERY__;
        if (d && d.app && !window.__HW__.ready) {
            window.__HW__._setApp(d.app);
            return;
        }
        if (window.__HW__.ready) return;
    } catch (e) {}
    setTimeout(checkDiscovery, 500);
})();

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

// --- Eval bridge ---------------------------------------------------------
// No remote-debugging-port (main.js exits if it's present), so live JS
// execution in the game page is done via a file channel: write JS to
// <game>/mods/dev-eval.js, this poller runs it in the page's main world,
// and the result lands in <game>/mods/dev-eval-result.txt.
// Re-running the same content is a no-op (content hash dedupe).
function startEvalBridge(wc) {
    const evalFile = path.join(getModsDir(), 'dev-eval.js');
    const resultFile = path.join(getModsDir(), 'dev-eval-result.txt');
    let lastRun = null;
    let stopped = false;
    wc.once('destroyed', () => { stopped = true; });
    const timer = setInterval(() => {
        if (stopped || wc.isDestroyed()) { clearInterval(timer); return; }
        let code;
        try { code = fs.readFileSync(evalFile, 'utf8'); } catch { return; }
        if (!code || !code.trim() || code === lastRun) return;
        lastRun = code;
        wc.executeJavaScript(code, true).then(res => {
            const out = `=== ${new Date().toISOString()} ===\n${typeof res === 'string' ? res : JSON.stringify(res, null, 1)}`;
            fs.writeFileSync(resultFile, out + '\n');
            log('Eval bridge: OK (' + out.length + ' chars)');
        }).catch(e => {
            const msg = `=== ${new Date().toISOString()} ===\nERROR: ${e && e.message ? e.message : String(e)}`;
            fs.writeFileSync(resultFile, msg + '\n');
            log('Eval bridge: FAILED: ' + (e && e.message ? e.message : e));
        });
    }, 500);
}

// --- Live PixiJS discovery via CDP ---------------------------------------
// The obfuscated game keeps the PIXI.Application inside closures — no global,
// no canvas back-reference. But Pixi's InteractionManager attaches event
// listeners to the canvas, and those handlers are BOUND functions. Chrome
// DevTools Protocol exposes bound functions' internal slots:
//   handler -> [[BoundThis]] -> InteractionManager -> .renderer -> live
//   WebGL renderer -> _lastObjectRendered -> the root stage container.
// Uses webContents.debugger (no remote-debugging-port needed). Note: fails
// while the user's own DevTools window is attached (one debugger per target).
function dbgSend(dbg, method, params) {
    return new Promise((resolve, reject) => {
        dbg.sendCommand(method, params || {}, (err, result) => {
            if (err) reject(new Error(typeof err === 'string' ? err : JSON.stringify(err)));
            else resolve(result);
        });
    });
}

async function discoverAppViaCDP(wc) {
    // A lingering DevTools client (even a hidden/detached window) blocks
    // our attach — close it first and restore it after discovery.
    const devtoolsWasOpen = (() => { try { return wc.isDevToolsOpened(); } catch (e) { return false; } })();
    if (devtoolsWasOpen) {
        log('CDP: DevTools is open — closing temporarily for attach');
        try { wc.closeDevTools(); } catch (e) {}
        await new Promise(r => setTimeout(r, 700));
    }
    const dbg = wc.debugger;
    try { dbg.attach('1.3'); } catch (e) {
        log('CDP attach failed:', e.message, '| devtoolsOpen:', devtoolsWasOpen);
        return false;
    }
    try {
        await dbgSend(dbg, 'Runtime.enable');
        const ev = await dbgSend(dbg, 'Runtime.evaluate', {
            expression: "document.querySelector('canvas')",
            returnByValue: false,
        });
        const canvasId = ev.result && ev.result.objectId;
        if (!canvasId) throw new Error('no canvas found');

        const el = await dbgSend(dbg, 'DOMDebugger.getEventListeners', { objectId: canvasId });
        const listeners = (el && el.listeners) || [];
        if (!listeners.length) throw new Error('no listeners on canvas yet');

        for (const l of listeners) {
            const handlerId = l.handler && l.handler.objectId;
            if (!handlerId) continue;
            let props;
            try { props = await dbgSend(dbg, 'Runtime.getProperties', { objectId: handlerId }); }
            catch (e) { continue; }
            const boundThis = (props.internalProperties || []).find(p => p.name === '[[BoundThis]]');
            if (!boundThis || !boundThis.objectId) continue;

            const check = await dbgSend(dbg, 'Runtime.callFunctionOn', {
                objectId: boundThis.objectId,
                functionDeclaration: 'function () {' +
                    'try {' +
                    '  if (this.renderer && this.renderer.view) {' +
                    '    window.__HW__._setRenderer(this.renderer);' +
                    '    return "RENDERER_OK|" + (this.renderer._lastObjectRendered ? "stage" : "no-stage");' +
                    '  }' +
                    '  return "no-renderer:" + Object.keys(this).slice(0, 12).join(",");' +
                    '} catch (e) { return "err:" + e.message; }' +
                    '}',
                returnByValue: true,
            });
            const val = check.result && check.result.value;
            log(`CDP: listener "${l.type}" -> ${val}`);
            if (typeof val === 'string' && val.startsWith('RENDERER_OK')) return true;
        }
        throw new Error('no pixi renderer found via listeners');
    } finally {
        try { dbg.detach(); } catch (e) {}
        if (devtoolsWasOpen) {
            setTimeout(() => { try { wc.openDevTools({ mode: 'detach' }); } catch (e) {} }, 300);
        }
    }
}

// Poll discovery until the app is found. Handles the async race (the game
// creates the app some time after did-finish-load) and DevTools conflicts
// (user's F12 window holds the debugger — retries until it is closed).
function startDiscoveryLoop(wc) {
    let i = 0;
    const maxTries = 150; // 4s interval → ~10 minutes of patience
    const timer = setInterval(async () => {
        if (wc.isDestroyed() || wc.__hwDiscoveryDone) { clearInterval(timer); return; }
        try {
            const ok = await discoverAppViaCDP(wc);
            if (ok) { wc.__hwDiscoveryDone = true; clearInterval(timer); log('PixiJS app discovered via CDP'); }
        } catch (e) {
            if (i % 5 === 0) log(`CDP discovery attempt ${i + 1} failed: ${e.message}`);
        }
        if (++i >= maxTries) { clearInterval(timer); log('CDP discovery gave up'); }
    }, 4000);
}

module.exports = async function loadMods(wc) {
    // Only inject into the actual game page — skip service workers,
    // devtools pages, and other headless webContents Electron spawns.
    let url = '';
    try { url = wc.getURL ? wc.getURL() : ''; } catch (e) {}
    if (!/totaljerkface\.com/.test(url)) return;

    const modsDir = getModsDir();
    try { fs.writeFileSync(LOG_FILE, ''); } catch (e) {}
    log('Mods directory:', modsDir);

    // F12 / Ctrl+Shift+I toggles DevTools. The game ships with the menu
    // removed and no accelerator bound, so devTools:!0 alone does nothing
    // until something calls openDevTools().
    try {
        wc.on('before-input-event', (e, input) => {
            if (input.type !== 'keyDown') return;
            const isF12 = input.key === 'F12';
            const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i';
            if (isF12 || isCtrlShiftI) {
                if (wc.isDevToolsOpened()) wc.closeDevTools();
                else wc.openDevTools({ mode: 'detach' });
                e.preventDefault();
            }
        });
        log('F12 DevTools toggle registered');
    } catch (e) {
        log('F12 registration failed:', e.message);
    }

    // Start the eval bridge (see startEvalBridge comment).
    startEvalBridge(wc);

    // Start CDP-based PixiJS discovery (see startDiscoveryLoop comment).
    startDiscoveryLoop(wc);

    // Inject runtime first and WAIT for it — mods reference window.__HW__
    // at the top of their IIFE, so a race here breaks every mod.
    try {
        await wc.executeJavaScript(RUNTIME, true);
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
            const result = await wc.executeJavaScript(wrapped, true);
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
