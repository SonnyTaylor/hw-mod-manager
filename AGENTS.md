# AGENTS.md — HW-ModManager

> **⚠️ LIVING DOCUMENT** — this file must evolve with the code. Any agent or human who learns
> something new about the game, hits a new pitfall, or changes the architecture is responsible
> for updating the relevant section here **in the same commit** as the change. A stale AGENTS.md
> is worse than none: it actively misleads. If you find documentation that contradicts reality,
> fixing the doc is part of the fix.

Guidance for AI agents (and humans) working in this repository. Read this fully before making changes.

## What This Project Is

A modding framework for **Happy Wheels (Steam, v1.99.1)** — an Electron app wrapping an HTML5 game built on PixiJS 6 + a bug-preserved Box2D port. We patch the Electron shell to inject a mod host that loads user mods into the game's page context at runtime.

**Related research** lives at `~/Downloads/HW_Research/` (see `FINDINGS.md` there): decompiled Flash AS3 source (the original game logic), an older obfuscated HTML5 build, and notes. The Steam version's game code (`resources/webroot/js/index.js`, 1.6MB) is intentionally obfuscated (zero-width chars + constant table) — **we never deobfuscate it; we hook it at runtime instead.**

## Critical Knowledge (hard-won — do not rediscover these)

1. **Electron fuse `EnableEmbeddedAsarIntegrityValidation` is ON.** The exe stores a hash of the asar header. Any modified `app.asar` → instant boot crash ("Integrity check failed"). Fix: `npx @electron/fuses write --app "Happy Wheels.exe" EnableEmbeddedAsarIntegrityValidation=off`. The patcher does this automatically and backs up the exe.
2. **Native modules must NOT be packed inside app.asar.** `steamworks.js` ships `.node` + `steam_api64.dll`. If packed inside, the game crashes on launch: "The specified module could not be found" (dialog box, temp `.tmp.node` path in the stack). Fix: pack with `--unpack-dir "node_modules/steamworks.js"`.
3. **asar extraction resolves unpacked files from a name-derived sibling**: extracting `app.asar.original` looks for `app.asar.original.unpacked/` (doesn't exist → ENOENT). Always restore `app.asar` from backup first, then extract from `app.asar` so its `app.asar.unpacked/` sibling resolves. The patcher handles this; don't "simplify" it away.
4. **The game window uses `sandbox:true, contextIsolation:true, nodeIntegration:false`.** The renderer and even the preload have no usable Node (`fs`/`path` unavailable in sandboxed preload). Mods are therefore injected from the **main process** via `webContents.executeJavaScript()` — which runs in the page's **main world** with full DOM/game access.
5. **`did-finish-load` fires for webContents with no BrowserWindow** (service workers etc.). Never `BrowserWindow.fromWebContents(wc)` without a null check — pass the `wc` itself through the hook.
6. **No `remote-debugging-port`** — `main.js` explicitly exits (code 1) if that flag is present. Use the in-app DevTools instead (F12, registered by mod-host via `before-input-event`).
7. **Windows GUI apps swallow stdout.** The mod host logs to `mods/hw-mod-host.log` in the game folder. Never rely on console output from the game process.
8. **The obfuscated game code contains anti-tamper traps**: regex checks on `location.href` (must match `totaljerkface.com`) and `while(...[42]){}` infinite loops. The Steam build loads via a protocol handler that serves local files under the `totaljerkface.com/__hw_app__/` URL, so checks pass naturally. The mod host's URL guard (`/totaljerkface\.com/`) matches this reality.
9. **Race condition pattern**: `executeJavaScript(RUNTIME)` must be `await`ed before mod injection — mods reference `window.__HW__` at IIFE top-level.
10. **exe backup**: `Happy Wheels.exe.original` sits next to the exe after patching. Restore flow covers it.
11. **Steam updates wipe the patch**: launching the game after a Steam update (or Steam re-verification) restores a pristine exe (fuse re-enabled) and a new `app.asar`, silently un-modding the game — symptom: F12 dead + no `mods/hw-mod-host.log`. The patcher now detects a new pristine build (live asar lacks the `mod-host.js` marker and differs from backup) and refreshes the backup instead of downgrading. After any Steam update, just re-run `hw dev`. Never manually `restore` + forget to re-patch.
12. **`sandbox:true` forces the preload into an isolated world** — Electron ignores `contextIsolation:false` (or breaks hwNative exposure) when sandbox is on. To run our preload hook in the page's MAIN world, BOTH `sandbox:!0→!1` AND `contextIsolation:!0→!1` must be patched in main.js (nodeIntegration stays false, so the page world still has no Node).
13. **The PIXI.Application is unreachable from page JS after boot** — no global, no canvas back-ref; canvas probing (own props walk) finds nothing. Capture it in the preload BEFORE game scripts via the Function.prototype.call trap (see loader/AGENTS.md). Symptom of a lost capture: `__HW__.ready === false` forever, mods' `onReady` never fires, `window.devTools` undefined in console.
14. **Something holds the CDP debugger on the game page at startup** — `wc.debugger.attach()` fails with "Debugger is already attached to the target" while `wc.isDevToolsOpened()` is false. Cause unknown; CDP-based discovery is a fallback only.
15. **`setx HW_GAME_PATH` doesn't affect already-running shells** — env vars set with setx only reach NEW processes; tools now auto-detect the Steam install (`Program Files (x86)` path) so this rarely matters.
16. **hw.js `killGame()` uses `sleep 2` via bash shell** — works, but flaky across machines without bash; the 2s wait matters because Windows needs time to release file locks before re-patching.

## Architecture

```
┌─ main.js (patched: devTools:!0 + appended hook)
│      └─ app.on('web-contents-created') → did-finish-load → require('./mod-host.js')(wc)
│
├─ mod-host.js (main process, full Node)
│      ├─ URL guard: only touches totaljerkface.com pages
│      ├─ F12/Ctrl+Shift+I → openDevTools toggle (before-input-event)
│      ├─ await wc.executeJavaScript(RUNTIME)  → defines window.__HW__ in page
│      └─ for each mods/<dir>/mod.js: wc.executeJavaScript(code + registration)
│             wrapped in-page try/catch so real errors come back over the promise
│
└─ Game page (main world, sandboxed from Node but has full game access)
       ├─ window.__HW__ runtime: onReady/onTick/getApp/getStage/log/mods[]
       ├─ mods as plain browser scripts (NO CommonJS — no require/module/exports)
       └─ PixiJS app discovered by probing canvases for {renderer,stage,ticker}
```

## File Map

| Path | Purpose |
|------|---------|
| `tools/patch-game.js` | Patcher: exe backup + fuse flip, asar backup/extract/patch/pack, restore, status. Idempotent. |
| `tools/hw.js` | Dev CLI (`hw dev` is the main loop). |
| `loader/mod-host.js` | Main-process mod host (copied into asar at `electron/out/`). |
| `mods/<name>/mod.json` | Mod manifest: name, version, description, author, tags. |
| `mods/<name>/mod.js` | Mod code — plain browser script IIFE. |

## Commands

```bash
node tools/hw.js help     # full list
node tools/hw.js dev      # patch → launch → 20s wait → dump mod log  ← main dev loop
node tools/hw.js log      # just show mod host log
node tools/hw.js new X    # scaffold mod in project mods/
node tools/hw.js install X # copy project mod into game mods/
node tools/hw.js restore  # full restore (asar + exe)
node tools/hw.js status
```

Game path defaults to `C:/SteamLibrary/steamapps/common/Happy Wheels`, override with `HW_GAME_PATH` env var or positional arg.

## Testing Changes to mod-host.js

`mod-host.js` lives inside the packed asar — editing the project copy does nothing until repack. Run `node tools/hw.js dev` (kills game, patches, launches, prints log). Watch for:

- Stale logs: log timestamps must be fresh (`Date.now`-ish). A stale log means the game didn't relaunch or `did-finish-load` never fired for the game page.
- `Injected: <name>` lines with `[OK|hw=object|mods=N]` = success.
- `ERR|<message>|<stack>` = real in-page error, fix the mod.

## Conventions

- Mods: plain browser JS, wrapped in an IIFE, entry via `HW.onReady(...)`, log via `HW.log(name, ...)`. Never use `require`, `module`, `fs` in mods.
- Never modify game assets or the obfuscated `index.js` in `resources/webroot/` — hook at runtime.
- Everything must stay reversible: backups are created once (`app.asar.original`, `Happy Wheels.exe.original`), never overwritten; restore restores all of them.
- Git: commit after each working milestone. Do not commit game files or `asar_extracted/` (gitignored).

## Maintenance Rules (for agents)

- **Update-as-you-go**: docs live next to code on purpose. Changed the injection flow? Update `loader/AGENTS.md` in the same commit. Found a new crash signature? Add it to the pitfalls list.
- **Record discoveries about the game itself** (object graphs, localStorage keys, protocols, obfuscation quirks) in the Known Issues/TODO section or `mods/AGENTS.md` — the obfuscated code makes every runtime discovery expensive; losing one means re-deriving it.
- **Delete, don't hoard**: when something becomes untrue, remove or rewrite it — never leave a "this might be outdated" hedge. Docs should state what IS, and get corrected when reality changes.
- When a pitfall cost you a debugging cycle, it deserves a bullet in “Critical Knowledge” with its exact symptom text (error messages are searchable).
- End any session that changed architecture with a docs pass before committing.

## Known Issues / TODO

- **Mod library: DONE (v1)** — loader loads `mods/_lib/*.js` before mods into `window.HWLibs`;
  mod.json `"requires"` gates injection. Libs: `game` (graph accessors + gravity helpers),
  `settings` (namespaced localStorage), `ui` (panel factory). Detailed internals now live in
  `docs/game-internals.md`.
- Gravity mod + gravity UI **verified working in-level** (moon/jupiter tested, screenshot 2026-09-25).
- Settings storage (DevTools → Application → Local Storage): key `option135` holds JSON with keyCodes, gamepadBindings, bloodSetting, use60FPS — future mod API target.
- Mod manager GUI (in-game overlay listing/enabling/disabling installed mods) not started — gravity-ui's panel is the UI proof-of-concept.
- CDP debugger-holder mystery: something attaches to the game page at startup and blocks `wc.debugger` (see loader/AGENTS.md).
- No git remote yet (user wants laptop sync).
