# Happy Wheels (Steam v1.99.1) — Game Internals

> Verified live against the running game via the eval bridge (2026-09-25).
> Class names are obfuscated short identifiers (`y4`, `MA`, `e`…) — **never rely on
> them**; rely on property paths and object shapes. Re-verify after any Steam update.

## Global objects reachable from the page main world

| Global | What it is |
|---|---|
| `hwNative` | Preload IPC bridge (steam calls, presence, deeplink, fullscreen, auth, friends) |
| `HW_SETTINGS` | Frozen config: `{siteURL}` |
| `Tmueo2t1b0` | Webpack chunk table — array with one entry `[[520], modules]` pushed by `dependencies.js`; the obfuscated `index.js` consumes it directly (its `.push` is still native) |
| `__SENTRY__` | Sentry SDK state |
| `Howler`, `Howl`, `Sound` | Howler.js audio |
| `gsapVersions` | GSAP tween lib |
| `__core-js_shared__` | core-js polyfill registry |
| `__HW__` | Our mod runtime |

**No `PIXI` global. No `Box2D` global.** All engine classes live inside the webpack
bundle closures. Capturing live instances requires the preload pre-hook (see
loader/AGENTS.md) or event-graph tricks.

## The main object graph

```
window.__HW__.app                       — the game's own PIXI.Application subclass (obf. y4)
  .update / .onAssetsLoaded / .updatePixiResolution / .resize   (game methods)
  .resourceManager                      — asset loader
  .screenManager
    .screens / .transitionMap / .history / .targetScreen / .currentScreen
    .currentScreen (y3)                 — a screen; has own options/renderer/stage/id
      .happyWheels (y3)                 — main game screen controller (display object)
        ._levelID / ._replayID / ._userID
        .sessionController
          .session (MA)                 — THE live level session; only exists in-level
            .m_world (e)                — Box2D 2.1a Flash-port world
            ._level (i2)                — level model
            ._character (ij)            — player character model
            ._camera (J)                — camera controller
            ._contactListener (J)
            ._particleController (Ma)
            ._containerSprite (t)       — display container for the level
  .tempGameScreen (y3)                  — screen template (options/renderer/stage/happyWheels)
```

### The session object (class MA) — full property dump

Display-object base (children, transform, listeners) **plus**:

- Physics: `m_world`, `m_iterations`, `m_timeStep` (1/30), `m_physScale` (62.5 px/m), `steps`, `_accumulatedStep`
- Parts: `_level` (i2), `_character` (ij), `_camera` (J), `_particleController`, `_contactListener` (J), `_buttonContainer`
- Controller: `sessionController` (class `fu`) — owns `restartLevel()`, `replayLevel()`,
  `beginSession()`, `loadSession()`, `killSession()`, `requestPause()`, `die()`,
  `levelDataObject` (the level's source data — restart path), `restartCount`
- State: `frames`, `paused`, `inputAllowed`, `isEditorTest`, `isMenu`, `charIndex`, `_version`, `_levelVersion`
- Movement: `_travel` (Mq), `_flips`, `_magnet`, `cameraModeInvocations`, `enableCameraMode`, `useDebugger`

### Box2D world (class e) — Box2D 2.1a Flash-port API

```
SetGravity(vec)  Destroy()  CreateBody(def)  DestroyBody(body)  CreateJoint  DestroyJoint
Step(dt)  GetBodyCount()  GetBodyList()  GetJointList()  Query  Solve  SolveTOI
SetContactListener  SetDebugDraw  GetGroundBody  Refilter  ...
m_gravity  m_bodyList  m_bodyCount  m_groundBody
```

- **Gravity convention: y-DOWN positive.** Earth = `{x:0, y:10}`. `b2Vec2` has `.Set(x,y)`.
- `SetGravity` stores the passed vector **by reference** (2.1a behavior) — mutate + call both.
- Level load creates ~105 bodies for a simple level.

### Level (class i2)

`levelData`, `tokens`, `totalTokens`, `borderThickness`, `skyHeight`, `m_physScale`,
`paintBodyVector`, `paintItemVector`, `actionsVector`, `keepVector`, `triggers`,
`jointDictionary` (Map), `vehicleDictionary`, `groupDictionary`, `contactAddBuffer` (Map),
display layers: `background`, `characterLayer`, `foreground`, `backDrops`.

### Character (class ij)

Break/dismember limits — FULL list (20 keys, enumerated live 2026-09-25; discover with
`Object.getOwnPropertyNames(char).filter(k => /Limit/.test(k))` rather than hard-coding):

- Joints: `neckBreakLimit` (85), `spineLimit` (105), `torsoBreakLimit` (181),
  `intestineLimit` (261), `shoulderBreakLimit` (75), `shoulderSnapLimit` (90),
  `hipBreakLimit` (95), `hipSnapLimit` (110), `elbowBreakLimit` (70),
  `elbowLigamentLimit` (80), `kneeBreakLimit` (80), `kneeLigamentLimit` (95)
- Vehicle/prop smash: `chairSmashLimit` (200), `wheelSmashLimit` (200),
  `jetSmashLimit` (30), `fueltankSmashLimit` (30)
- Head/part smash (small floats, ≈1/62.5 physScale units): `headSmashLimit` (≈3.01),
  `chestSmashLimit` (≈7.52), `pelvisSmashLimit` (≈5.52), `footSmashLimit` (≈4.01)

(parenthesized values = measured baselines on a simple level; treat as indicative)

Plus `lostLimbs` (Set), `bleedCounter`, handlers (`keyDownHandler`, `contactAddHandler`…),
`_startX/_startY`, `character_scale`, `_session`, `m_physScale`.

#### Character methods (prototype chain, enumerated live 2026-09-25)

- Class `fK` → `fK` → base `k`. Base `k` has the full dismemberment machinery:
  `torsoBreak`, `neckBreak`, `shoulderBreak1/2`, `elbowBreak1/2`, `hipBreak1/2`,
  `kneeBreak1/2`, `headSmash1`, `chestSmash`, `pelvisSmash`, `footSmash1/2`,
  `helmetSmash`, `explodeShape`, plus `create`, `createBodies`, `createJoints`,
  `setLimits`, `resetJointLimits`, `reset`, `die`, `checkJoints`, `removeBody`,
  `isOwnBody`, `trackLimbLost`, `trackDecapitation`, `eject`, pose functions.
- **Calling `character.reset()` or `.create()` directly LEAKS 27 bodies per call**
  (11 `isOwnBody`-tracked + 16 untracked rig parts; the game tears down at session
  level, not character level). Never use them as a heal.
- **Clean full heal = `sessionController.restartLevel()`** (class `fu`, on
  `happyWheels.sessionController`) — the game's own restart (pause/death screen path).
  Reuses `sessionController.levelDataObject`, so it works even when
  `happyWheels._levelID` is -1 (injected-session levels). Regrows limbs, clears
  bleeding/lostLimbs, resets world body count to pristine.
- `character.neckBreak()` etc. need contact args — calling with none silently no-ops.
- `character.isOwnBody(body)` identifies the 11 tracked character bodies (not all rig parts).

### Camera (class J)

`zoom`, `midX/midY`, borders/limits, `_focus`, `_steppedFocus`, `_containerObj`, `m_physScale`.

### Viewport / resolution (app-level, decoded from live `app.resize()` source)

- `app.safeSize` and `app.maxSize` (both `{width:900, height:500}`) are THE levers: the
  game's own `app.resize()` reads them, calls `renderer.resize()` at that logical size
  (× DPR/FILTER_RES) and letterboxes the canvas CSS to the window, centering it.
- To change aspect: set BOTH `app.safeSize` and `app.maxSize` to `{width,height}` (logical,
  base width 900), then call `app.resize()` + `app.updatePixiResolution()`. Verified live
  (900×386 = 21:9). `updatePixiResolution()` recomputes the game's global FILTER_RES
  (renderer/interaction resolution) from screen height — call it after resize.
- `app.w`/`app.h` mirror the logical size after resize; `renderer.view.style` holds the
  canvas CSS (width/height/left/top). `app.screen` is undefined (non-standard PIXI use).
- UI elements reflow via the game's screen resize handlers; extreme aspects may look odd.
- Implemented in `viewport-mod` (`window.viewport`: 16:9 / 21:9 / 1:1 / 9:16 / fill).

### Physics time control

- `session.m_timeStep` (1/30) is the fixed physics step; multiplying it slows/speeds the
  world while rendering stays full-fps. Re-apply per tick (session recreated on level
  load/restart); base captured per session instance. Implemented in `time-mod`
  (`window.timeScale`). In-level verification pending.

## UI overlay pattern (proven by gravity-ui)

- Plain DOM element on `document.body`, `position:fixed; z-index:99999` — sits above the canvas.
- The game's canvas listeners don't conflict with a separate overlay element.
- Don't steal key events (no focused inputs) — document-level game key handlers still fire.
- Persist UI state in a namespaced localStorage key (`hw.<name>`).

## localStorage

- `option135` — the game's own settings JSON: `keyCodes` (87=W accelerate, 83=S decelerate,
  65=A lean back, 68=D lean forward, 32=primary, 16/17=secondary, 90=Z eject, 67=C camera),
  `gamepadBindings`, `bloodSetting` (1–5), `use60FPS`.
- Mods should use their own namespaced keys (`hw.<name>`) — see `HWLibs.settings`.
