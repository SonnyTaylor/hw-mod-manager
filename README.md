# Happy Wheels Mod Manager

A modding framework for Happy Wheels (Steam/HTML5 version).

## Quick Start

### 1. Patch the Game (First time only)
```bash
node tools/patch-game.js "C:/SteamLibrary/steamapps/common/Happy Wheels"
```

This will:
- ✅ Create a backup (`app.asar.original`)
- ✅ Enable DevTools (F12 in-game)
- ✅ Install the mod loader
- ✅ Your original game files are never lost

### 2. Install Mods
Copy mod folders into the game's `mods/` directory:
```
C:/SteamLibrary/steamapps/common/Happy Wheels/mods/
├── my-cool-mod/
│   ├── mod.json      # Mod metadata
│   └── mod.js        # Mod code
└── another-mod/
    ├── mod.json
    └── mod.js
```

### 3. Launch the Game
Just run Happy Wheels from Steam. Mods load automatically!

### 4. Restore Original Game
**Option A:** Double-click `restore.bat`

**Option B:** Command line
```bash
node tools/patch-game.js restore
```

**Option C:** Nuclear option (if all else fails)
1. Right-click Happy Wheels in Steam
2. Properties → Installed Files → Verify integrity
3. Steam will re-download original files

✅ **Your save data is safe** — it's stored in `%APPDATA%/HappyWheels`, not in the game folder.

---

## Safety & Reversibility

| Concern | Answer |
|---------|--------|
| Can I break my game? | Worst case, verify files in Steam |
| Will I lose my saves? | No — saves are in `%APPDATA%/HappyWheels` |
| Can I undo the patch? | Yes — run `restore.bat` or verify in Steam |
| Will Steam achievements still work? | They should, but use at your own risk |
| Can I get banned? | Unlikely for single-player, but mod at your own risk |

### Backup Locations
- `app.asar.original` — Full backup of the game archive
- `main.js.original` — Backup of the Electron main process
- `.hw-mod-state.json` — Tracks patch status

### Emergency Restore
If anything goes wrong:
1. Delete the `resources` folder in your Happy Wheels install
2. Right-click game in Steam → Properties → Installed Files → Verify integrity
3. Steam will re-download everything fresh

---

## Project Structure

```
HW-ModManager/
├── patches/            # Reference patches for main.js
├── loader/
│   └── mod-loader.js   # Core mod loader (injected into game)
├── mods/
│   └── examples/
│       ├── devtools/   # Debug utilities mod
│       └── gravity-mod/# Gameplay modifier example
├── tools/
│   └── patch-game.js   # Game patcher script
├── FINDINGS.md         # Reverse engineering research
└── README.md
```

## Writing Mods

### Basic Mod Structure
```
my-mod/
├── mod.json    # Metadata (optional but recommended)
└── mod.js      # Main mod file
```

### mod.json
```json
{
    "name": "My Cool Mod",
    "version": "1.0.0",
    "description": "Does cool stuff",
    "author": "Your Name",
    "tags": ["gameplay", "visual"]
}
```

### mod.js
```javascript
module.exports = {
    name: 'My Cool Mod',
    
    async init(api) {
        // Called when mod loader initializes
        api.log('My Cool Mod', 'Hello!');
        
        // Wait for game to be ready
        api.onGameReady((pixiApp) => {
            api.log('My Cool Mod', 'Game is running!');
            // Now you can modify the game
        });
    }
};
```

## Mod API

The `api` object passed to your mod's `init()` function provides:

| Method | Description |
|--------|-------------|
| `api.log(name, ...args)` | Console output with mod prefix |
| `api.getPixiApp()` | Get PixiJS Application instance |
| `api.getStage()` | Get the root display container |
| `api.onGameReady(callback)` | Run code when game is loaded |
| `api.onTick(callback)` | Run code every frame |
| `api.hookNative(method, callback)` | Intercept hwNative API calls |
| `api.getSettings()` | Get game settings (HW_SETTINGS) |
| `api.getModDataPath(name)` | Get persistent storage path |

## Debugging

After patching, DevTools is enabled. Press `F12` or `Ctrl+Shift+I` in-game.

### Console Commands (with devtools mod)
```javascript
devTools.getPixiApp()          // Get PixiJS app
devTools.listStageChildren()   // List all display objects
devTools.getSettings()         // Game settings
devTools.listMods()            // See loaded mods
```

### Console Commands (with gravity mod)
```javascript
gravity.set(0.5)    // Half gravity
gravity.moon()      // Moon gravity (0.16x)
gravity.zeroG()     // Zero gravity
gravity.reset()     // Back to normal
```

---

## Version Control

This project is designed to work with git. To sync between machines:

```bash
# On your desktop
git add .
git commit -m "Added new mod"
git push

# On your laptop
git pull
```

Game files are .gitignored - each machine provides its own game installation.

---

## How It Works

1. **Patcher** modifies the Electron app's `main.js` to:
   - Enable DevTools
   - Load our mod loader script
   - Disable anti-tamper checks

2. **Mod Loader** runs in the renderer process and:
   - Scans the `mods/` directory
   - Loads and initializes each mod
   - Provides APIs for game interaction

3. **Mods** are plain JavaScript modules that:
   - Export an `init(api)` function
   - Use the API to hook into game events
   - Modify PixiJS objects, physics, etc.

---

## Future Plans

- [ ] Mod manager GUI (in-game overlay)
- [ ] Mod dependency system
- [ ] Asset replacement pipeline
- [ ] Character/level modding tools
- [ ] Mod conflict detection
- [ ] Auto-updates for mods

---

## Credits

- **Jim Bonacci** - Original Happy Wheels creator
- **Goodboy Digital** - HTML5 port (PixiJS studio)
- **Afterflash** - Flash source decompilation