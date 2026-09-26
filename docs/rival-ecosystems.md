# Rival mod-loader ecosystems (competitive + compat notes)

> Created 2026-09-26. The Steam v1.99.1 modding scene started 2026-09-21..25 with two
> third-party loaders. We support their mod formats so our manager can run everything.
> Sources downloaded to `/tmp/rival/` (not in repo) for analysis only — **never rehost
> or derive their code** (see licenses below).

## The players

| Loader | Author | Where | Format | Notes |
|---|---|---|---|---|
| **HWML** | pineapple54 | Nexus mods #1 ("Happy Wheels Mod Loader") | single `mod.js`, `HW.registerMod`, settings-block → menu UI | drops `hwml-sw.js` into `resources/webroot`; F1 in-game menu; claims Steam-update survival; Steam Deck "supported" (untested); achievements guard for gameplay mods; safe mode (Shift); asset/skin packs |
| **JHWML** | Jimbobgaming | GameBanana tool #24249 + Nexus | mod folder with `mod.json` (`web[]`, `electronMain`, `electronPreload`), env = `window.HWGhost` | Windows-only unsigned EXE installer; public mod catalog; hosted relay for multiplayer |

**Licenses / permissions — hard constraints:**
- HWML mods (Nexus): default "no upload to other sites" permissions. Don't rehost, don't bundle files.
- JHWML launcher: CC **BY-NC-ND 4.0** (no derivatives). Jimbob's mods: unlicensed zips, but same etiquette — link + attribute, never repackage.

**Tactic:** compat, not copying. Users download rival zips from their pages; our manager
runs them; marketplace indexes with attribution + deep links.

## What we verified live (2026-09-26)

### Jimbob format support in mod-host (`loader/mod-host.js`)
- `mod.json.web[]` → all files under `<mod>/web/` injected in order in ONE
  `executeJavaScript`, one try/catch per file (errors report filename).
- `mod.json.electronMain` → `require()`d in the main process AFTER page injection OK
  (`loadSidecar`). node_modules resolve from `<game>/mods/node_modules/` — installed
  `ws` there (`npm install --prefix <game>/mods ws`) for the multiplayer relay.
  `require` caches, so double-calls (boot + jsonl replay) are no-ops.
- `electronPreload` → **unsupported** (preloads bind at window creation). Mods with a
  page-WebSocket fallback still work.
- Boot loop accepts dirs with `mod.json.web` even without `mod.js`.

### Gotchas found (all fixed, keep in mind for future formats)
1. **Chunk-table key ends in `4` on this build** (`Tmueo5kmh4`) — Jimbob's own
   webpack-probe hardcodes `/^Tmu[A-Za-z0-9]+0$/` (old build `Tmueo2t1b0` ends in 0) and
   **fails on our build**. Our probe scans generically (overridden push + chunk-tuple
   shape) and then patches `require` into their `window.HWGhost` facade after their
   files run. Never match chunk tables by name.
2. Template-literal generation bugs (both bit us once): `.join('\\n')` inside a template
   literal yields literal `\n` text (syntax error) — use `.join('\n')`. Mod names with
   apostrophes (`Jimbob's …`) must be interpolated via `JSON.stringify`, never raw
   inside single quotes.

### Result
`jimbobs-multiplayer` 0.2.6 (from GameBanana dl/1824783): all 5 web files loaded,
sidecar loaded, adapter `installed: true`, multiplayer UI button live,
`window.HWGhost.status = "Open Multiplayer to join or host a room."`, zero errors,
alongside our 9 mods (10 total).

### Character chain verified end-to-end (2026-09-26, user-tested in game)

Tung Tung Sahur (Nexus #7, character for Jimbob's Custom Characters) runs on our loader:
1. Parent mod `jimbobs-custom-characters` copied into `<game>/mods/` (same GameBanana
   zip flow as multiplayer).
2. Character folder copied to `<parent>/web/characters/<id>/` + `index.json` regenerated.
3. **Assets must be fetchable by the page at `./js/<modid>/characters/...`** — their
   system mirrors mod web content into `resources/webroot/js/` (their electron-scan.cjs
   writes there). We mirrored the characters dir into webroot the same way; the game's
   protocol handler serves it (fetch 200s confirmed from the page).
4. Character-menu hook: `screenManager.currentScreen.happyWheels.sessionController.characterMenu`.
   Their `HWCustomCharacters.slots/painted` counters only populate at that screen.
5. Their self-capture fails on this build (same `Tmu...0` name bug) — our post-injection
   compat step patches our require into `window.HWGhost`, and custom-chars' own fallback
   (scan window for the chunk array) would ALSO fail — ours is the working path.

**Our native version: `mods/character-packs/`** (v0.1.0, verified live 2026-09-26).
Same `character.json` schema → their community content is drop-in compatible. Host side:
`syncCharacterPacks()` mirrors `<game>/mods/character-packs/packs/*` →
`resources/webroot/js/hw-character-packs/` (additive, wiped + rebuilt each boot) and
publishes manifests as `window.__HW__.characterPacks` before mods load. Mod side:
HWLibs.ui panel, pick pack → sheet mapped onto the base atlas grid (fetch
`assets-*/animate/character<base>/character<base>.json`, scale = sheet/atlas size,
frames matched by rect) → reskins live sprites via `HWLibs.game.character()` walker
(objects with `.pixiSprite`), restores originals on Vanilla/teardown, re-applies per
new session via onTick.

## Their game knowledge we can reuse (facts, not their code)

- Level downloads: `POST /get_level.hw` with `action=get_level` (mutable metadata) /
  `get_record` (level geometry), param `level_id`. SHA-256 of response = level identity
  (their ghost-matching key).
- `session.iteration` + `session.m_timeStep` → physics-time clock (ms) = `(iter - start) * step * 1000`.
- Ghost/pose wire format: per-frame `parts[i] = [id, textureId, 6 affine numbers, alpha(0..1), color(24bit)]`, ≤1200 parts/frame, textures listed separately with frame/orig/trim/rotate. Recording cap 7200 frames.
- Webpack module IDs (v1.99.1, both builds seen): `35057` = game state module (`.w` =
  the global settings/app state, 62 keys incl. `use60FPS`, `characterIndex`,
  `CURRENT_VERSION`); `99430` = PixiJS module with obf. exports `mcf`(Container),
  `kxk`(Sprite), `gPd`(Texture.from), `uqu`(Matrix), `M_G`(Rectangle), `WpD`(utils,
  `.TextureCache`). Their code also references `29552` — **absent on our build**.
- State object also carries `rootApp`, `currentSession`, `totalCharacters` — grab state
  module then read `.w.rootApp` (our preload capture is redundant for this path!).
- Custom character format: `<dir>/character.json` = `{name, base: <vanilla character
  index 1..11>, sheet: png, icon: png}` + `index.json` listing dirs. Sheet must match
  base atlas aspect ratio; frames scaled from `assets-*/animate/character<base>/`.
