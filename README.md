# Happy Wheels Mod Manager

A modding framework for **Happy Wheels (Steam/Electron version)** — patches the game to load user mods at runtime. Fully reversible.

## Quick Start

```bash
# One-time: patch the game (backs up exe + asar automatically)
node tools/hw.js patch

# Main dev loop: patch → launch game → show mod load log
node tools/hw.js dev

# Write a mod, then install + test it
node tools/hw.js new my-mod
node tools/hw.js install my-mod
node tools/hw.js dev
```

In-game: **F12** (or Ctrl+Shift+I) opens DevTools. Console commands from the example mods:

```js
devTools.listMods()          // loaded mods
devTools.listStageChildren() // PixiJS scene graph dump
gravity.moon()               // low gravity in a level
gravity.reset()              // back to normal
```

## Restoring the Original Game

```bash
node tools/hw.js restore       # restores app.asar AND the exe (re-enables fuse)
```

Or the nuclear option: Steam → Right-click game → Properties → Installed Files → Verify integrity.

**Save data lives in `%APPDATA%/HappyWheels`** — patching/restoring never touches it.

## Safety

| Question | Answer |
|----------|--------|
| Can I break my game? | Worst case: verify files in Steam |
| Lose my saves? | No — they're outside the game folder |
| Undo the patch? | `hw restore` (backups are never overwritten) |
| Multiplayer/bans? | Game is effectively single-player; mod at your own risk |

Backups created on first patch: `resources/app.asar.original`, `Happy Wheels.exe.original`.

## Documentation

> **These are living docs** — they're updated in the same commit as code changes, not kept as
> stale snapshots. If something in them contradicts reality, the doc is the bug.

- **[AGENTS.md](AGENTS.md)** — architecture, pitfalls, and testing workflow (read this first)
- **[tools/AGENTS.md](tools/AGENTS.md)** — patcher + CLI internals
- **[loader/AGENTS.md](loader/AGENTS.md)** — mod host injection flow
- **[mods/AGENTS.md](mods/AGENTS.md)** — writing mods (API reference, conventions)

## CLI Reference

```
hw patch              patch the game
hw restore            restore original game
hw status             patch status
hw launch             kill + relaunch game
hw log                show mod host log
hw dev                patch + launch + show log (main dev loop)
hw new <name>         scaffold a new mod
hw install <name>     copy project mod into game
hw list               list mods
```

Game path: override with `HW_GAME_PATH` env var.

## How It Works

```
main.js (patched: DevTools on, mod-host hook appended)
   └─ on page load → mod-host.js (main process)
        └─ injects window.__HW__ runtime + each mods/*/mod.js
             via webContents.executeJavaScript (page main world)
```

Why this design: the game window uses `sandbox` + `contextIsolation`, so the renderer has no Node access. Injection from the main process into the page's main world sidesteps that entirely while keeping mods dead-simple (plain JS files).

## Credits

- **Jim Bonacci / Fancy Force** — Happy Wheels
- **Goodboy Digital** — HTML5 port
- **Afterflash** — Flash source decompilation (research reference)
