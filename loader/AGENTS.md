# loader/ — AGENTS.md

> **Living doc** — update in the same commit as any behavior change here. See root AGENTS.md maintenance rules.

Runtime injected into the game's Electron main process.

## mod-host.js

Runs in the **main process** (full Node access). It is copied into the asar at `electron/out/mod-host.js` by the patcher — **edit the project copy, then repack** (`node tools/hw.js dev`).

### Flow

1. Exported as `module.exports = async function loadMods(wc)` — called from the appended hook in main.js on every `did-finish-load`.
2. URL guard: returns early unless `wc.getURL()` matches `/totaljerkface\.com/` (skips headless webContents — service workers, devtools).
3. Registers F12 / Ctrl+Shift+I → `openDevTools({mode:'detach'})` toggle via `before-input-event`.
4. `await wc.executeJavaScript(RUNTIME, true)` — injects `window.__HW__` runtime into the page main world. Must be awaited (pitfall #9 in root AGENTS.md).
5. Reads `<game>/mods/` — each subdir with `mod.js` (+ optional `mod.json`) is injected: code + a registration snippet, wrapped in an in-page try/catch whose return value (`OK|...` / `ERR|message|stack`) is logged to `mods/hw-mod-host.log`.

### Rules

- Never use `BrowserWindow.fromWebContents(wc)` — some `did-finish-load` events come from windowless webContents (pitfall #5). Work with `wc` directly.
- All logging through the file-based `log()` helper (stdout is swallowed on Windows — pitfall #7).
- The `RUNTIME` string is injected into the page: it may use browser APIs only, no Node.
- Mod injection wraps code in `(() => { try { ... } catch (e) { return 'ERR|...' } })()` so in-page errors surface in the host log. Preserve this when editing.
- Reset the log file at the start of each `loadMods` run (fresh run → fresh log) — stale logs have misled debugging more than once.
