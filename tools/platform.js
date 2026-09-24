/**
 * Platform-aware Happy Wheels install detection.
 *
 * The Steam build ships as either:
 *   - Windows: an Electron app whose executable is "Happy Wheels.exe"
 *   - Linux:   a native Electron build (appid 4705510) whose executable is
 *              "happy-wheels-bin" (steam launches it via the "happy-wheels"
 *              shell wrapper, which adds --ozone-platform=x11)
 *
 * Both use the same asar layout, fuse, and mod-host injection. Only the
 * binary name and the install location differ, so the tools share this.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// The file Electron actually boots (and the one carrying the asar-integrity fuse).
const EXE_NAME = IS_WINDOWS ? 'Happy Wheels.exe' : 'happy-wheels-bin';

// The native Linux build is a Steam app; launching the binary directly makes
// steamworks `restartAppIfNecessary` bounce it back to Steam, so launch via Steam.
const STEAM_APPID = '4705510';

const STEAM_TAIL = ['steamapps', 'common', 'Happy Wheels'];
const HOME = os.homedir();

// Common Steam install roots, in priority order.
const CANDIDATE_PATHS = IS_WINDOWS
    ? [
        'C:/SteamLibrary/steamapps/common/Happy Wheels',
        'C:/Program Files (x86)/Steam/steamapps/common/Happy Wheels',
    ]
    : [
        path.join(HOME, '.local/share/Steam', ...STEAM_TAIL),
        path.join(HOME, '.steam/steam', ...STEAM_TAIL),
        path.join(HOME, '.steam/root', ...STEAM_TAIL),
        path.join(HOME, '.var/app/com.valvesoftware.Steam/data/Steam', ...STEAM_TAIL), // Flatpak
    ];

// HW_GAME_PATH always wins; otherwise pick the first candidate that actually
// contains the boot binary, falling back to the first candidate.
function detectGamePath() {
    return process.env.HW_GAME_PATH
        || CANDIDATE_PATHS.find(p => fs.existsSync(path.join(p, EXE_NAME)))
        || CANDIDATE_PATHS[0];
}

module.exports = { IS_WINDOWS, IS_LINUX, EXE_NAME, STEAM_APPID, CANDIDATE_PATHS, detectGamePath };
