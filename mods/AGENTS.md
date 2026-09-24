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

## Rules for writing mods

1. IIFE + `'use strict'`, grab `const HW = window.__HW__` at top, entry logic inside `HW.onReady(...)`.
2. No CommonJS. No Node APIs. No top-level throw (an IIFE-level throw marks the whole mod failed in the host log).
3. Log through `HW.log`, not bare `console.log`, so output is attributable.
4. Anything exploratory (hunting for game internals) should cache results on `window` with a clear name — the obfuscated game code hides everything, so runtime discovery is precious; record findings in the mod's header comment or root AGENTS.md.
5. Errors inside async callbacks (e.g. after `onReady`) are NOT caught by the host wrapper — wrap your own async work in try/catch and `HW.log` failures.
