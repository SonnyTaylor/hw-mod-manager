# tools/ — AGENTS.md

> **Living doc** — update in the same commit as any behavior change here. See root AGENTS.md maintenance rules.

Scripts and CLI for patching and developing against the game.

## Files

- **platform.js** — shared install detection: boot-binary name per OS (`Happy Wheels.exe` / `happy-wheels-bin`), Steam paths for Windows, Linux (incl. Flatpak), the Steam appid, and `detectGamePath()`. Required by both other scripts — keep all platform branching in here.
- **patch-game.js** — one-shot patcher. Steps in order: flip fuse (backs up boot binary first) → backup asar → restore asar from backup → extract → patch main.js → install mod-host → save state → repack with `--unpack-dir "node_modules/steamworks.js"`. Subcommands: `patch` (default), `restore`, `status`.
- **hw.js** — dev CLI. `hw dev` = kill game → patch → launch → wait → print `mods/hw-mod-host.log`. This is the standard way to test changes to `loader/mod-host.js` (which lives inside the asar — repack required). Kill is `taskkill` (Windows) / `pkill -f '[h]appy-wheels-bin'` (Linux, bracket defeats self-match); launch is direct exec (Windows) / `steam -applaunch 4705510` (Linux — direct exec bounces back to Steam via restartAppIfNecessary). The `hw dev` wait is 20s on Windows, 60s on Linux (Steam cold start + pressure-vessel setup).

## Rules

- The pack command MUST keep `--unpack-dir "node_modules/steamworks.js"` — packing native modules into the asar breaks the game (see root AGENTS.md pitfall #2).
- The extract step MUST extract from the restored `app.asar`, not from `app.asar.original` (name-derived `.unpacked` sibling resolution — pitfall #3).
- The patch step is written to be idempotent (checks for existing markers like `devTools:!0` and `mod-host.js` before applying). Keep it that way.
- execSync failures: asar CLI errors are cryptic — on ENOENT mentioning `.unpacked`, suspect the extraction-source pitfall.
