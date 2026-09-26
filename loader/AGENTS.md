# loader/ — AGENTS.md

> **Living doc** — update in the same commit as any behavior change here. See root AGENTS.md maintenance rules.

Runtime injected into the game's Electron main process.

## mod-host.js

Runs in the **main process** (full Node access). It is copied into the asar at `electron/out/mod-host.js` by the patcher — **edit the project copy, then repack** (`node tools/hw.js dev`). Platform-neutral: `process.resourcesPath`/`..` resolves to the game root on both Windows and the native Linux build (verified on Linux 2026-09-25).

### Flow

1. Exported as `module.exports = async function loadMods(wc)` — called from the appended hook in main.js on every `did-finish-load`.
2. URL guard: returns early unless `wc.getURL()` matches `/totaljerkface\.com/` (skips headless webContents — service workers, devtools).
3. Registers F12 / Ctrl+Shift+I → `openDevTools({mode:'detach'})` toggle via `before-input-event`.
4. Starts the **eval bridge** (`startEvalBridge`) and the **CDP discovery loop** (`startDiscoveryLoop`).
5. `await wc.executeJavaScript(RUNTIME, true)` — injects `window.__HW__` runtime into the page main world. Must be awaited (pitfall #9 in root AGENTS.md).
6. Reads `mods/state.json` (written by the desktop manager: per-mod `{enabled, settings}`), arms the **command channel**, then reads `<game>/mods/` — each subdir with `mod.js` (+ optional `mod.json`) is injected unless state.json says disabled (then it's only *registered*, see below). Injection = code + a registration snippet, wrapped in an in-page try/catch whose return value (`OK|...` / `ERR|message|stack`) is logged to `mods/hw-mod-host.log`. Right after a mod registers, its saved settings from state.json are applied via `HW._applySettings` (mods that registered `onSettings` observe them; deferred if onReady hasn't fired yet).

The obfuscated game keeps the `PIXI.Application` inside closures — no global, no canvas back-reference, canvas probing finds nothing (`window.__HW__.ready` stayed false forever). Three mechanisms, first one wins:

1. **Preload pre-hook (primary, works)** — the patcher disables `sandbox` + `contextIsolation` in the window's webPreferences and **prepends** a hook to the game's preload. It runs in the page's main world BEFORE game scripts and traps `Function.prototype.call` (narrow check: first arg with `.stage && .renderer` = the ticker invoking `listener.fn.call(app)`). Pixi's Ticker calls each listener with `.call(app)`, so the Application instance is captured the first frame after the app is constructed. Captured object lands in `window.__HW_DISCOVERY__.app`; the runtime polls it every 500ms and calls `_setApp`. The trap self-restores once found (or after 60s).
2. **CDP debugger route (backup)** — `wc.debugger` attach + `DOMDebugger.getEventListeners(canvas)` → bound handlers → `Runtime.getProperties` internalProperties → `[[BoundThis]]` → InteractionManager → `.renderer` → `_lastObjectRendered` (stage). Currently blocked: something unknown already holds the debugger on the game page at startup (`Debugger is already attached to the target`, `devtoolsOpen: false`) — cause unknown, kept as fallback with 4s retries.
3. **Canvas probing (legacy)** — probes canvas own properties for `{renderer, stage, ticker}`. Doesn't work on this build; kept as harmless fallback.

Note the captured app is the game's own Application subclass (obfuscated class `y4` with game methods `update`, `onAssetsLoaded`, `updatePixiResolution`, `resize`) — the real thing, not a shim.

### Webpack require — the "master key" (verified 2026-09-26)

The webpack runtime overrides the chunk array's `push`. Pushing a fake chunk
`[['__hw_probe__'], {}, require => …]` executes the callback with the bundle's require
function → **every obfuscated module becomes accessible by numeric ID**. Implemented in
the RUNTIME as `webpackProbe()` (scans generically for chunk-like arrays with overridden
push — the table key varies per build: `Tmueo2t1b0` old, `Tmueo5kmh4` current).
Exposed as `window.__HW__.require` + `window.__HW__.state` (module 35057 `.w`) and a
compat facade `window.HWGhost` for Jimbob-ecosystem mods (see docs/rival-ecosystems.md).
Known IDs: `35057` game state, `99430` PixiJS (`mcf` Container, `kxk` Sprite, `gPd`
Texture, `uqu` Matrix, `M_G` Rectangle, `WpD` utils/TextureCache). Their code also uses
`29552` — absent on our build.

### Eval bridge (dev tooling)

No remote-debugging-port (main.js exits if present). For live JS execution in the page: write JS to `<game>/mods/dev-eval.js`; a 500ms poller runs it via `wc.executeJavaScript` and writes the result to `<game>/mods/dev-eval-result.txt`. Re-running the same content is a no-op (dedupe). This is how the agent can probe the live game from bash. Files are recreated on demand; delete after use.

### Command channel (hot-toggle / hot-settings, used by the desktop manager)

The manager appends one JSON command per line to `<game>/mods/.hw-commands.jsonl`; `startCommandChannel` polls every 250ms consuming it **byte-offset** (nothing runs twice; file truncation resets the offset; >1MB truncates). Ops:

- `{"op":"toggle","id":"<dir>","enabled":bool}` — enable = full re-injection of that mod from disk (`injectMod`, reads current mod.js + applies saved settings); disable = runs the mod's registered `onDisable` teardowns via `HW._disableMod(id)`. Mods never injected (boot-disabled) return `not-loaded`.
- `{"op":"settings","id":"<dir>","settings":{...}}` — pushes values into `HW._applySettings` (see runtime registry below).
- `{"op":"eval","code":"..."}` — arbitrary page JS (handy for tests).

`HW.mods` list entries carry `{...manifest, id, enabled}` and are updated in place by both ops, so `window.__HW__.mods` always reflects live state (verified via eval bridge: toggling flips `enabled`, hot-enable replaces the entry without duplicating it — `mods=9` stays 9).

### Runtime registry (page side, part of RUNTIME)

- `HW._mods[id] = { manifest, disable[], enable[], onSettings[] }`, `HW._current` = folder id of the mod being injected.
- Mods register teardown/hooks at **IIFE top level**: `HW.onDisable(fn)` (required for hot-toggle), `HW.onSettings(fn)`, `HW.onEnable(fn)` (rarely needed — hot-enable re-injects and re-applies settings).
- `HW.settings(id?)` — saved settings for a mod (from state.json), available immediately at IIFE top level.
- `HW._registerCurrent(manifest)` — called by the host's registration snippet; resets the fn arrays so re-injection never stacks stale teardowns.
- `HW._disableMod(id)` / `HW._applySettings(id, values)` — invoked by command-channel ops.

### PixiJS app discovery (why it exists, how it works)

The obfuscated game keeps the `PIXI.Application` inside closures — no global, no canvas back-reference, canvas probing finds nothing (`window.__HW__.ready` stayed false forever). Three mechanisms, first one wins:

1. **Preload pre-hook (primary, works)** — the patcher disables `sandbox` + `contextIsolation` in the window's webPreferences and **prepends** a hook to the game's preload. It runs in the page's main world BEFORE game scripts and traps `Function.prototype.call` (narrow check: first arg with `.stage && .renderer` = the ticker invoking `listener.fn.call(app)`). Pixi's Ticker calls each listener with `.call(app)`, so the Application instance is captured the first frame after the app is constructed. Captured object lands in `window.__HW_DISCOVERY__.app`; the runtime polls it every 500ms and calls `_setApp`. The trap self-restores once found (or after 60s).
2. **CDP debugger route (backup)** — `wc.debugger` attach + `DOMDebugger.getEventListeners(canvas)` → bound handlers → `Runtime.getProperties` internalProperties → `[[BoundThis]]` → InteractionManager → `.renderer` → `_lastObjectRendered` (stage). Currently blocked: something unknown already holds the debugger on the game page at startup (`Debugger is already attached to the target`, `devtoolsOpen: false`) — cause unknown, kept as fallback with 4s retries.
3. **Canvas probing (legacy)** — probes canvas own properties for `{renderer, stage, ticker}`. Doesn't work on this build; kept as harmless fallback.

Note the captured app is the game's own Application subclass (obfuscated class `y4` with game methods `update`, `onAssetsLoaded`, `updatePixiResolution`, `resize`) — the real thing, not a shim.

### Mod injection formats

Two formats supported by `injectMod`:
- **ours**: `<mod>/mod.js` single file (mods/AGENTS.md contract).
- **Jimbob-ecosystem compat** (docs/rival-ecosystems.md): `<mod>/mod.json` with `"web":
  [...]` (files under `<mod>/web/`) — injected in order in one executeJavaScript, one
  try/catch per file; `"electronMain"` sidecar `require()`d in the main process after
  page injection OK (`loadSidecar`); `"electronPreload"` unsupported (logged). After the
  files run, a compat step patches our captured webpack require into their
  `window.HWGhost` facade if their own probe failed. Boot loop accepts these dirs
  without mod.js.

### Shared libs (mods/_lib/)

- `mods/_lib/<name>.js` files load BEFORE mods (in fs order); each registers into `window.HWLibs.<name>`.
- Mods declare deps in mod.json: `"requires": ["ui"]` — the host refuses injection with `Skipped <mod>: missing libs (...)` in the log.
- Current libs: `game` (session/world/level/character/camera accessors + gravity helpers), `settings` (namespaced localStorage), `ui` (panel factory: drag/collapse/persist/sliders/buttons).
- `hw install-libs` copies project `mods/_lib/` → game; `hw dev` auto-syncs libs every cycle.
- Editing a lib: change project copy → `hw install-libs` (or any `hw dev`) → relaunch.

### Rules

- Never use `BrowserWindow.fromWebContents(wc)` — some `did-finish-load` events come from windowless webContents (pitfall #5). Work with `wc` directly.
- All logging through the file-based `log()` helper (stdout is swallowed on Windows — pitfall #7).
- The `RUNTIME` string is injected into the page: it may use browser APIs only, no Node.
- Mod injection wraps code in `(() => { try { ... } catch (e) { return 'ERR|...' } })()` so in-page errors surface in the host log. Preserve this when editing.
- Reset the log file at the start of each `loadMods` run (fresh run → fresh log) — stale logs have misled debugging more than once.
