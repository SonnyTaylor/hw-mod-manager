/**
 * HW Mod Host (main process)
 *
 * Called from patched main.js after the window finishes loading.
 * Injects the mod runtime into the page's main world, then loads
 * every enabled mod found in the mods/ directory as plain browser JavaScript.
 *
 * Why main process? sandbox:true + contextIsolation:true in the game's
 * window means the renderer has no Node access. But executeJavaScript()
 * from the main process runs directly in the page's main world — full
 * access to PixiJS and game objects, no sandbox restrictions.
 *
 * Hot-toggle: the desktop manager appends commands to mods/.hw-commands.jsonl;
 * startCommandChannel() consumes them (byte-offset, 250ms poll) and can
 * enable/disable mods and push settings into the live page without a restart.
 * Boot-time enable/disable + per-mod settings live in mods/state.json,
 * written by the same manager.
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

// --- persisted state (written by the desktop manager) --------------------
function readState(modsDir) {
    try { return JSON.parse(fs.readFileSync(path.join(modsDir, 'state.json'), 'utf8')); }
    catch (e) { return { mods: {} }; }
}
function isEnabled(id, state) {
    return !state || !state.mods || !state.mods[id] || state.mods[id].enabled !== false;
}
function savedSettings(id, state) {
    return (state && state.mods && state.mods[id] && state.mods[id].settings) || {};
}

// Core runtime injected before any mod. Provides a tiny API surface.
const RUNTIME = `
window.__HW__ = {
    version: '1.1.0',
    mods: [],
    ready: false,
    _readyCallbacks: [],
    _tickCallbacks: [],
    // Hot-toggle registries. _mods[id] = { manifest, disable:[], enable:[], onSettings:[] }
    _mods: {},
    _settingsStore: {},
    _current: null,

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

    // --- hot-toggle contract (mods call these at IIFE top level) ---
    // Saved settings for this mod ({} before the manager saves any).
    settings(id) { return (this._settingsStore || {})[id || this._current] || {}; },
    // Register teardown / re-enable / live-settings hooks for the mod being injected.
    onDisable(fn) { this._hook(fn, 'disable'); },
    onEnable(fn) { this._hook(fn, 'enable'); },
    onSettings(fn) { this._hook(fn, 'onSettings'); },
    _hook(fn, kind) {
        const id = this._current;
        if (!id) { console.error('[HW] on' + kind.slice(0,1).toUpperCase() + kind.slice(1) + ' called outside mod injection'); return; }
        const m = (this._mods[id] = this._mods[id] || { manifest: null, disable: [], enable: [], onSettings: [] });
        m[kind].push(fn);
    },
    // Host calls after mod code evaluates: record manifest + refresh the mods list.
    _registerCurrent(manifest) {
        const id = this._current || manifest.id;
        const m = (this._mods[id] = this._mods[id] || { manifest: null, disable: [], enable: [], onSettings: [] });
        // Re-injection (hot enable) must not stack stale teardowns.
        m.manifest = Object.assign({}, manifest, { id, enabled: true });
        m.disable.length = 0; m.enable.length = 0; m.onSettings.length = 0;
        const i = this.mods.findIndex(e => e.id === id);
        if (i >= 0) this.mods[i] = m.manifest; else this.mods.push(m.manifest);
        return 'registered|' + id;
    },
    // Manager hot-disable: run teardowns, flip the list entry.
    _disableMod(id) {
        const m = this._mods[id];
        if (!m) return 'not-loaded';
        for (const fn of m.disable) { try { fn(); } catch (e) { console.error('[HW] onDisable error:', e); } }
        m.disable.length = 0;
        const entry = this.mods.find(e => e.id === id);
        if (entry) entry.enabled = false;
        return 'ok';
    },
    // Manager pushes settings values; mods subscribed via onSettings receive them.
    _applySettings(id, values) {
        this._settingsStore[id] = values || {};
        const m = this._mods[id];
        if (!m) return 'no-mod';
        for (const fn of m.onSettings) { try { fn(this._settingsStore[id]); } catch (e) { console.error('[HW] onSettings error:', e); } }
        const entry = this.mods.find(e => e.id === id);
        if (entry) entry.settings = this._settingsStore[id];
        return 'ok';
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

// Shared lib registry — libs in mods/_lib/ populate this before mods load.
window.HWLibs = window.HWLibs || {};
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

// --- Command channel (desktop manager → live page) ------------------------
// The manager appends one JSON command per line to mods/.hw-commands.jsonl:
//   {"op":"toggle","id":"gravity-mod","enabled":false}
//   {"op":"settings","id":"gravity-mod","settings":{"factor":0.3}}
//   {"op":"eval","code":"..."}
// Consumed byte-offset style so nothing runs twice; truncation resets it.
function startCommandChannel(wc, modsDir) {
    const cmdFile = path.join(modsDir, '.hw-commands.jsonl');
    let offset = 0;
    let busy = false;
    let stopped = false;
    wc.once('destroyed', () => { stopped = true; });

    const timer = setInterval(async () => {
        if (stopped || busy || wc.isDestroyed()) return;
        let stat;
        try { stat = fs.statSync(cmdFile); } catch { offset = 0; return; }
        if (stat.size < offset) offset = 0;           // truncated by the writer
        if (stat.size === offset) return;
        busy = true;
        try {
            const fh = fs.openSync(cmdFile, 'r');
            const buf = Buffer.alloc(stat.size - offset);
            fs.readSync(fh, buf, 0, buf.length, offset);
            fs.closeSync(fh);
            let text = buf.toString('utf8');
            let consumed = buf.length;
            if (!text.endsWith('\n')) {                 // partial line — wait for the rest
                const idx = text.lastIndexOf('\n');
                if (idx < 0) { busy = false; return; }
                text = text.slice(0, idx + 1);
                consumed = Buffer.byteLength(text, 'utf8');
            }
            offset += consumed;
            for (const line of text.split('\n')) {
                if (!line.trim()) continue;
                let cmd = null;
                try { cmd = JSON.parse(line); } catch (e) { log('Bad command line:', line.slice(0, 120)); continue; }
                try { await handleCommand(wc, modsDir, cmd); }
                catch (e) { log(`Command ${cmd.op} failed:`, e.message); }
            }
        } finally {
            busy = false;
        }
    }, 250);
}

async function handleCommand(wc, modsDir, cmd) {
    log('Command:', cmd.op, cmd.id || '');
    if (cmd.op === 'toggle') {
        if (cmd.enabled) {
            const state = readState(modsDir);
            const res = await injectMod(wc, modsDir, cmd.id, state);
            if (res.ok) log(`Hot-enabled: ${cmd.id} [${res.result}]`);
            else log(`Hot-enable FAILED: ${cmd.id} → ${res.result}`);
        } else {
            const expr = `window.__HW__._disableMod(${JSON.stringify(cmd.id)})`;
            const r = await wc.executeJavaScript(expr, true);
            log(`Hot-disabled: ${cmd.id} → ${r}`);
        }
    } else if (cmd.op === 'settings') {
        const expr = `window.__HW__._applySettings(${JSON.stringify(cmd.id)}, ${JSON.stringify(cmd.settings || {})})`;
        const r = await wc.executeJavaScript(expr, true);
        log(`Settings applied: ${cmd.id} → ${r}`);
    } else if (cmd.op === 'eval') {
        const r = await wc.executeJavaScript(cmd.code, true);
        log(`Eval → ${String(r).slice(0, 200)}`);
    } else {
        log('Unknown command op:', cmd.op);
    }
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

// --- Mod injection (shared by boot loop and hot-enable) -------------------

function readManifest(modsDir, dirName) {
    let manifest = { name: dirName, version: '1.0.0' };
    const manifestPath = path.join(modsDir, dirName, 'mod.json');
    try {
        if (fs.existsSync(manifestPath)) {
            manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
        }
    } catch (e) {
        log(`Bad mod.json in ${dirName}:`, e.message);
    }
    return manifest;
}

// Inject one mod into the page. Returns { ok, result }.
async function injectMod(wc, modsDir, dirName, state) {
    const code = fs.readFileSync(path.join(modsDir, dirName, 'mod.js'), 'utf8');
    const manifest = { ...readManifest(modsDir, dirName) };

    const registration = `
        try {
            const __req = ${JSON.stringify(manifest.requires || [])}.filter(n => !(window.HWLibs && window.HWLibs[n]));
            if (__req.length) return 'MISSING_LIBS|' + __req.join(',');
            window.__HW__._registerCurrent(${JSON.stringify(manifest)});
            console.log('[HW] Loaded mod: ${manifest.name} v${manifest.version}');
        } catch(e) {
            console.error('[HW] Mod ${manifest.name} failed:', e);
        }
    `;

    // Wrap the mod in try/catch INSIDE the page so we get the real error
    // back over the promise (executeJavaScript's generic "script failed
    // to execute" message is useless for debugging).
    const wrapped = `(() => {
    window.__HW__._current = ${JSON.stringify(dirName)};
    try {
        ${code}
        ${registration}
        return 'OK|mods=' + (window.__HW__ ? window.__HW__.mods.length : '?');
    } catch (e) {
        return 'ERR|' + (e && e.message ? e.message : String(e)) + '|' + (e && e.stack ? String(e.stack).split('\\n').slice(0,3).join(' << ') : '');
    }
})()`;

    try {
        const result = await wc.executeJavaScript(wrapped, true);
        if (result.startsWith('OK')) {
            // Saved settings (manager state.json) are applied right after
            // registration so mods observe their configured values.
            const vals = savedSettings(dirName, state);
            if (Object.keys(vals).length) {
                try {
                    await wc.executeJavaScript(
                        `window.__HW__._applySettings(${JSON.stringify(dirName)}, ${JSON.stringify(vals)})`,
                        true,
                    );
                    log(`Settings applied at boot: ${dirName} (${Object.keys(vals).join(', ')})`);
                } catch (e) {
                    log(`Settings apply failed for ${dirName}:`, e.message);
                }
            }
            return { ok: true, result, manifest };
        } else if (result.startsWith('MISSING_LIBS')) {
            log(`Skipped ${dirName}: missing libs (${result.slice('MISSING_LIBS|'.length)}) — add them to mods/_lib/`);
        } else {
            log(`Failed ${dirName}: ${result}`);
        }
        return { ok: false, result, manifest };
    } catch (e) {
        log(`Failed to inject ${dirName}:`, e.message);
        return { ok: false, result: e.message, manifest };
    }
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

    const state = readState(modsDir);
    startCommandChannel(wc, modsDir);
    log('Command channel armed (mods/.hw-commands.jsonl)');

    let entries;
    try {
        entries = fs.readdirSync(modsDir, { withFileTypes: true });
    } catch (e) {
        log('Cannot read mods dir:', e.message);
        return;
    }

    // Shared libs: mods/_lib/<name>.js, loaded BEFORE mods. Each lib registers
    // itself into window.HWLibs.<name>; mods declare dependencies via
    // mod.json "requires": ["name"] and are refused with a clear log if missing.
    const libDir = path.join(modsDir, '_lib');
    try {
        const libFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));
        for (const f of libFiles) {
            const libName = f.replace(/\.js$/, '');
            const code = fs.readFileSync(path.join(libDir, f), 'utf8');
            const wrapped = `(() => { try { ${code} ; return 'OK|' + (window.HWLibs ? Object.keys(window.HWLibs).join(',') : 'no-registry'); } catch (e) { return 'ERR|' + (e && e.message ? e.message : e); } })()`;
            const r = await wc.executeJavaScript(wrapped, true);
            if (String(r).startsWith('OK')) log(`Lib ${libName} loaded [${r}]`);
            else log(`Lib ${libName} FAILED: ${r}`);
        }
    } catch (e) {
        if (!/ENOENT/.test(e.message)) log('Lib dir read failed:', e.message);
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirName = entry.name;
        const modJs = path.join(modsDir, dirName, 'mod.js');
        if (dirName === '_lib' || !fs.existsSync(modJs)) continue;

        const manifest = readManifest(modsDir, dirName);

        // Disabled at boot: register in the mods list without injecting code,
        // so the manager (and HW.mods) still shows it exists.
        if (!isEnabled(dirName, state)) {
            const expr = `(() => {
                const m = Object.assign({}, ${JSON.stringify(manifest)}, { id: ${JSON.stringify(dirName)}, enabled: false });
                if (!window.__HW__.mods.find(e => e.id === m.id)) window.__HW__.mods.push(m);
                return 'ok';
            })()`;
            try { await wc.executeJavaScript(expr, true); log(`Registered (disabled): ${dirName} v${manifest.version}`); }
            catch (e) { log(`Failed registering ${dirName}:`, e.message); }
            continue;
        }

        const res = await injectMod(wc, modsDir, dirName, state);
        if (res.ok) log(`Injected: ${manifest.name} v${manifest.version} [${res.result}]`);
    }
};
