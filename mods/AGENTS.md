# mods/ — AGENTS.md

> **Living doc** — new game internals discovered while writing mods (localStorage keys,
> object graph paths, event names) belong here immediately, in the same commit. See root
> AGENTS.md maintenance rules.

Where mods live. Each subfolder is one mod, installed to the game by copying it into `<game>/mods/` (`node tools/hw.js install <name>`).

## Mod anatomy

```
mods/<name>/
├── mod.json   # manifest: name, version, description, author, tags
└── mod.js     # plain browser script (IIFE), loaded into the game page
```

## Mod environment

- Runs in the game page's **main world** (sandboxed: no Node, no `require`/`module`/`fs`).
- Global API: `window.__HW__`
  - `HW.onReady(cb)` — fires when the PixiJS app is found; callback receives the app.
  - `HW.onTick(cb)` — per-frame callback (rAF piggyback).
  - `HW.getApp()` / `HW.getStage()` — PixiJS application / root stage.
  - `HW.log(modName, ...args)` — prefixed console log (visible in F12 console).
  - `HW.mods` — registered mod list.
- Game settings: `window.HW_SETTINGS` (frozen: siteURL etc.). User options live in **localStorage key `option135`** — JSON with `keyCodes` (87=W accelerate, 83=S decelerate, 65=A lean back, 68=D lean forward, 32=primary, 16/17=secondary, 90=Z eject, 67=C camera), `gamepadBindings`, `bloodSetting` (1–5), `use60FPS`.

## Verified game object graph

See **[docs/game-internals.md](../docs/game-internals.md)** — full verified graph
(session/world/level/character/camera paths), gravity conventions (y-down +10),
Box2D 2.1a-port API surface, reachable globals, UI overlay pattern. Consume it via
`HWLibs.game` (see lib below) rather than hard-coding paths in mods.

## Installed mods

- `devtools` — exposes `window.devTools` inspector helpers (stage walk, screenshot).
- `gravity-mod` — `window.gravity` API (set/moon/mars/jupiter/zeroG/reset/get). Verified in-level.
- `cheat-menu` — combined cheat panel (supersedes gravity-ui, which was removed): collapsible
  sections Gravity + Character, drives `window.gravity` + `window.charEd`. Verified in-level.
  UI plumbing is all in `HWLibs.ui` — see its header for the section-scoped API.
- `character-editor` — break-limit multiplier (Normal/Tough/Iron/GOD presets + slider,
  0.05–1e9 = paper ↔ god), hotkey **I** = god toggle, Heal (**full level restart** via
  `sessionController.restartLevel()` — the only clean limb-regrow path; see
  docs/game-internals.md) + Stop bleed. Console API `window.charEd`
  (setFactor/getFactor/heal/respawn/info). Limits are DISCOVERED per character instance
  (own props matching `/Limit/`) — 20 keys found live, don't hard-code them. Baseline
  captured per character object; re-applied every tick so respawns/level restarts are
  covered. Verified live: discovery, god-mode application, restartLevel heal.
  Character.reset()/create() called directly leak bodies — never use them.

## Mod library idea (TODO — shared code between mods)

Desired: mods shouldn't re-implement UI panels, settings storage, object-graph lookups.
Sketch: `lib/` directory loaded by the host BEFORE mods; each lib registers itself into
`window.HWLibs.<name>`; mods consume via `HWLibs.ui.panel(...)`, `HWLibs.settings.get(...)`.
Not started — see root AGENTS.md TODO.

## Rules for writing mods

1. IIFE + `'use strict'`, grab `const HW = window.__HW__` at top, entry logic inside `HW.onReady(...)`.
2. No CommonJS. No Node APIs. No top-level throw (an IIFE-level throw marks the whole mod failed in the host log).
3. Log through `HW.log`, not bare `console.log`, so output is attributable.
4. Anything exploratory (hunting for game internals) should cache results on `window` with a clear name — the obfuscated game code hides everything, so runtime discovery is precious; record findings in the mod's header comment or root AGENTS.md.
5. Errors inside async callbacks (e.g. after `onReady`) are NOT caught by the host wrapper — wrap your own async work in try/catch and `HW.log` failures.
