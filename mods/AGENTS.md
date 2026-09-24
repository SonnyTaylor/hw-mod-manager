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

## Verified game object graph (discovered live via eval bridge, 2026-09-25)

All names are real runtime properties on the live game (class names are obfuscated
single/double letters — never rely on them, rely on paths and shapes).

```
window.__HW__.app                       — the game's own PIXI.Application subclass (obf. y4)
  .update / .onAssetsLoaded / .updatePixiResolution / .resize
  .screenManager
    .screens / .history / .currentScreen (y3 = a screen; in-game screen id string)
    .currentScreen.happyWheels          — main game screen controller (y3, a display object)
      .sessionController
        .session (MA)                   — THE live level session; only exists while a level is loaded
          .m_world (e)                  — Box2D 2.1a Flash-port world
            .SetGravity(vec) / .m_gravity {x,y} / .CreateBody / .GetBodyCount / .Step / .m_bodyList
          ._level (i2)                  — level model (shapes, tokens, jointDictionary...)
          ._character (ij)              — player character (break limits, limbs, handlers)
          ._camera (J)                  — camera controller
          ._particleController / ._contactListener (J) / ._containerSprite
          .m_physScale = 62.5           — pixels per meter
          .m_timeStep = 1/30, .frames, .paused, .isMenu, .charIndex
      ._levelID / ._replayID / ._userID
  .tempGameScreen (y3)                  — screen container template (options, renderer, stage)
```

- **Gravity convention**: `world.m_gravity = {x:0, y:10}` — y is DOWN-positive, +10 = Earth.
  `b2Vec2` has `.Set(x,y)`; `SetGravity` stores the reference (mutate + call both).
- **Renderer**: PIXI 6 `WebGLRenderer` (obf. t), `renderer._lastObjectRendered` = root drawn
  (used by the CDP discovery fallback).
- No `PIXI` global, no `Box2D` global — all classes are inside the webpack bundle
  (`window.Tmueo2t1b0` chunk table, pushed by dependencies.js as chunk [[520]];
  the obfuscated index.js consumes it directly — its push is still native Array.push).
- Reachable globals: `hwNative` (preload IPC bridge), `HW_SETTINGS`, `__SENTRY__`,
  `Howler/Howl/Sound`, `gsapVersions`, `__core-js_shared__`, `Tmueo2t1b0`, `__HW__`.
- UI overlay pattern (gravity-ui): plain DOM element appended to `document.body`,
  `position:fixed; z-index:99999`, state in a namespaced localStorage key. The game's
  canvas doesn't interfere since our element sits above it; avoid stealing key events
  (don't focus inputs; document-level key listeners still reach the game).

## Installed mods

- `devtools` — exposes `window.devTools` inspector helpers (stage walk, screenshot).
- `gravity-mod` — `window.gravity` API (set/moon/mars/jupiter/zeroG/reset/get). Verified in-level.
- `gravity-ui` — draggable on-screen slider + presets, drives `window.gravity`. Verified in-level.

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
