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
- Game settings: `window.HW_SETTINGS` (frozen: siteURL etc.). User options live in
  **localStorage key `options135`** (plural — NOT `option135`) — JSON with `keyCodes`
  (NAMED fields: `accelerateCode` 38↑, `decelerateCode` 40↓, `leanForwardCode` 39→,
  `leanBackCode` 37←, `primaryActionCode` 32, `secondaryAction1Code` 16, `secondaryAction2Code` 17,
  `ejectCode` 90, `switchCameraCode` 67 — ARROW KEYS ARE THE DEFAULT DRIVE KEYS),
  `gamepadBindings`, `bloodSetting` (1–5), `use60FPS`, `fatlady` easter-egg flag.
  Written back as JSON — the game reads it on load; remap mods write here.

## Verified game object graph

See **[docs/game-internals.md](../docs/game-internals.md)** — full verified graph
(session/world/level/character/camera paths), gravity conventions (y-down +10),
Box2D 2.1a-port API surface, reachable globals, UI overlay pattern. Consume it via
`HWLibs.game` (see lib below) rather than hard-coding paths in mods.

## Installed mods

- `devtools` — exposes `window.devTools` inspector helpers (stage walk, screenshot).
- `gravity-mod` — `window.gravity` API (set/moon/mars/jupiter/zeroG/reset/get). Verified in-level.
- `viewport-mod` — logical resolution/aspect presets via `window.viewport`
  (16:9 / 21:9 / 1:1 / 9:16 portrait / fill-window, persisted, re-applies 'fill' on window
  resize). Drives the game's OWN layout path (`app.safeSize`+`app.maxSize` →
  `app.resize()` + `updatePixiResolution()`) — see docs/game-internals.md. Verified
  working by user (2026-09-25). Menus are authored for 900x500 and look broken at
  extreme aspects, so the engine auto-reverts to 16:9 in menus (silent, not persisted)
  and re-applies the chosen preset when a level session starts (per-tick check).
- `time-mod` — physics time factor via `window.timeScale` (set/get/normal; 0.05–∞,
  presets in cheat menu). Scales `session.m_timeStep` against a per-session baseline,
  re-applied per tick. In-level verification pending.
- `cheat-menu` — combined cheat panel (supersedes gravity-ui, which was removed):
  collapsible sections Gravity + Character + Viewport + Time; consumes engine console
  APIs (`window.gravity`, `window.charEd`, `window.viewport`, `window.timeScale`) and
  polls for them at startup because fs-order injection doesn't guarantee engines load
  first — add new engines to that poll. UI plumbing is all in `HWLibs.ui` — see its
  header for the section-scoped API.
- `character-editor` — break-limit multiplier (Normal/Tough/Iron/GOD presets + slider,
  0.05–1e9 = paper ↔ god), hotkey **I** = god toggle, Stop bleed (bleedCounter reset).
  Console API `window.charEd` (setFactor/getFactor/heal/respawn/info) — `respawn()` is
  a full level restart via `sessionController.restartLevel()` (documented in
  docs/game-internals.md); it is NOT in the cheat-menu UI because "heal = level restart"
  was confusing. Limb regrow in place is not feasible (destroyed Box2D joints; direct
  character.reset()/create() leak bodies — never call them). Limits are DISCOVERED per
  character instance (own props matching `/Limit/`) — 20 keys found live, don't
  hard-code them. Baseline captured per character object; re-applied every tick so
  respawns/level restarts are covered. Verified live: discovery, god-mode application,
  restartLevel behavior.

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
