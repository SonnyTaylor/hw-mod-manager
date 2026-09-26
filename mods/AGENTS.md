# mods/ — AGENTS.md

> **Living doc** — new game internals discovered while writing mods (localStorage keys,
> object graph paths, event names) belong here immediately, in the same commit. See root
> AGENTS.md maintenance rules.

Where mods live. Each subfolder is one mod, installed to the game by copying it into `<game>/mods/` (`node tools/hw.js install <name>`).

## Mod anatomy

```
mods/<name>/
├── mod.json   # manifest: name, version, description, author, tags,
│              #   requires, hotToggle, settings (schema)
└── mod.js     # plain browser script (IIFE), loaded into the game page
```

Manifest fields beyond the basics:

- `"requires": ["game"]` — HWLibs the host must find before injecting (else refused).
- `"hotToggle": true` — the mod implements `HW.onDisable` teardown and can be
  toggled live from the manager. Without it the manager shows "applies on launch"
  and only flips boot-time state.
- `"settings": [...]` — schema for the manager's settings panel (rendered as native
  UI, hot-pushed into the game):
  `{id, type: 'select'|'slider'|'toggle'|'text'|'number'|'color', label, default, ...}`
  — sliders take `min/max/step/unit`, selects take `options: [{value,label}]`.
  Values are persisted by the manager in `<game>/mods/state.json` and hot-applied
  through the command channel; at boot the host applies them right after injection.

## Hot-toggle & settings contract (required for hotToggle mods)

Register hooks at **IIFE top level** (the host sets `HW._current` before eval'ing
your code):

```js
let pending = null;
function applySettings(v) {
    if (!window.myAPI) { pending = v; return; }   // onReady may lag injection
    /* apply v */
}
HW.onSettings(applySettings);      // manager pushes saved values (boot + live)
HW.onDisable(function () {         // teardown — restore game state, remove UI
    /* restore */
});
HW.onEnable(fn);                   // rarely needed — hot-enable re-injects the mod
```

- `HW.settings()` returns the mod's saved values immediately (from state.json) —
  use inside `onReady` instead of re-reading HWLibs.settings for manager-owned values.
- Teardowns must leave the game as if the mod never ran (restore mutated state,
  remove DOM elements). `HWLibs.ui` panels have `panel.destroy()` for this.
- **Remove only YOUR panel**: `HWLibs.ui` tags every panel with
  `data-hw-panel="<storageKey>"` — teardown uses
  `document.querySelectorAll('[data-hw-panel="<storageKey>"]')`. Never blanket-remove
  `.hw-panel` — that wipes other mods' panels (bug we hit with cheat-menu, 2026-09-26).
- `HW._registerCurrent` resets the hook arrays on re-injection, so toggling
  off→on never stacks stale teardowns.
- Reference implementation: gravity-mod (preset select + custom factor slider,
  deferred application until onReady).
- `HWLibs.ui` v3 panels **auto-dock**: panels without a user-dragged position
  arrange into a wrap-around row anchored top-right, so panels from different
  mods never overlap. Dragging a panel frees it (position persisted per
  storageKey as `userX/userY`); everything else keeps auto-docking across
  sessions. Panels work fine without a `storageKey` (nothing is persisted).

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

## Installed mods (all hot-toggleable as of v1.1.0 runtime)

- `devtools` — exposes `window.devTools` inspector helpers (stage walk, screenshot); disable removes the global.
- `gravity-mod` — `window.gravity` API (set/moon/mars/jupiter/zeroG/reset/get). Verified in-level.
  Settings: preset select + custom factor slider; onDisable resets gravity.
- `viewport-mod` — logical resolution/aspect presets via `window.viewport`
  (16:9 / 21:9 / 1:1 / 9:16 portrait / fill-window). Drives the game's OWN layout path
  (`app.safeSize`+`app.maxSize` → `app.resize()` + `updatePixiResolution()`) — see
  docs/game-internals.md. Menus are authored for 900x500 and look broken at extreme
  aspects, so the engine auto-reverts to 16:9 in menus (silent, not persisted) and
  re-applies the chosen preset when a level session starts (per-tick check).
  Settings: aspect select; onDisable restores 16:9.
- `freecam-mod` — free camera: hotkey **F**, pan **W/A/S/D** (50%/s of visible width,
  Shift = 4x; NOT arrows — arrows are the game's default drive keys per options135),
  wheel zoom 0.25–4. Mechanism: replaces `camera._focus` with a proxy fake whose
  GetInterpolatedPosition() returns the pan position (decoded from cam.step()/center());
  removeSecondFocus() on enable; restore on disable. onDisable → freecam.off().
- `hud-mod` — corner readout (fps/bodies/flags), in-level only; SUPPRESSES the game's own
  FPS counter while enabled: direct handle `session.fpsText` on session change + periodic
  scan, restored when HUD is disabled (hud.set(false) does both).
  Settings: show readout toggle; onDisable → hud.set(false).
- `time-mod` — physics time factor via `window.timeScale` (set/get/normal; 0.05–∞).
  Scales `session.m_timeStep` against a per-session baseline, re-applied per tick.
  Settings: factor slider; onDisable → timeScale.normal().
- `cheat-menu` — combined cheat panel: collapsible sections Gravity / Character /
  Viewport / Time / Camera / HUD / Sandbox; consumes engine console APIs (`window.gravity`,
  `window.charEd`, `window.viewport`, `window.timeScale`, `window.freecam`, `window.hud`,
  `window.physgun`) and polls for them at startup. onDisable removes the panel (`.hw-panel`).
- `character-editor` — break-limit multiplier (Normal/Tough/Iron/GOD presets + custom
  slider, 0.05–1e9 = paper ↔ god), hotkey **I** = god toggle, Stop bleed.
  Console API `window.charEd` (setFactor/getFactor/heal/respawn/info). `respawn()` is
  a full level restart via `sessionController.restartLevel()` (documented in
  docs/game-internals.md); it is NOT in the cheat-menu UI because "heal = level restart"
  was confusing. Limb regrow in place is not feasible (destroyed Box2D joints; direct
  character.reset()/create() leak bodies — never call them). Limits are DISCOVERED per
  character instance (own props matching `/Limit/`) — 20 keys found live, don't hard-code
  them. Baseline captured per character object; re-applied every tick so respawns/level
  restarts are covered. Settings: durability preset + custom factor; onDisable → setFactor(1).
- `physgun-mod` — physics gun: grab/drag/fling bodies (hotkey **G** to arm, LMB grab).
  Skips static bodies, ground and endBlock. Settings: strength slider (0.25–5x);
  onDisable → physgun.off().

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
