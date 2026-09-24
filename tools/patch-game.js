#!/usr/bin/env node
/**
 * Happy Wheels Mod Manager - Game Patcher
 * 
 * Patches the Electron app to:
 * 1. Enable DevTools
 * 2. Load our custom mod loader
 * 3. Disable anti-tamper URL checks
 * 
 * Usage: node tools/patch-game.js [path-to-happy-wheels]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { EXE_NAME, detectGamePath } = require('./platform');

// Default install location (HW_GAME_PATH env overrides; auto-detect walks the
// common Windows and Linux Steam locations — see tools/platform.js)
const DEFAULT_GAME_PATH = detectGamePath();

class GamePatcher {
    constructor(gamePath) {
        this.gamePath = gamePath || DEFAULT_GAME_PATH;
        this.resourcesPath = path.join(this.gamePath, 'resources');
        this.asarPath = path.join(this.resourcesPath, 'app.asar');
        this.extractedPath = path.join(this.gamePath, 'asar_extracted');
        this.backupPath = path.join(this.resourcesPath, 'app.asar.original');
    }

    async patch() {
        console.log('🎮 Happy Wheels Mod Patcher');
        console.log('===========================\n');
        console.log(`Game path: ${this.gamePath}\n`);

        // Step 1: Check if game exists
        if (!fs.existsSync(this.asarPath)) {
            console.error('❌ Could not find Happy Wheels at:', this.gamePath);
            console.error('   Provide the correct path as an argument.');
            process.exit(1);
        }

        // Step 2: Flip the asar-integrity fuse
        // The game's exe has Electron's EnableEmbeddedAsarIntegrityValidation
        // fuse enabled — it stores a hash of the asar header and refuses to
        // boot if the archive is modified. We must disable it BEFORE the
        // patched asar can load.
        this.flipFuse();

        // Step 3: Backup original asar
        if (!fs.existsSync(this.backupPath)) {
            console.log('📦 Backing up original app.asar...');
            fs.copyFileSync(this.asarPath, this.backupPath);
            console.log('   ✓ Backup saved to app.asar.original');
        } else {
            console.log('📦 Backup already exists, skipping...');
        }

        // Also backup main.js specifically
        const mainPath = path.join(this.extractedPath, 'electron', 'out', 'main.js');
        const mainBackupPath = path.join(this.extractedPath, 'electron', 'out', 'main.js.original');

        // Step 4: Restore pristine asar from backup, then extract from it.
        // (We extract from app.asar rather than the backup because the asar
        // tool resolves unpacked files from a name-derived sibling directory:
        // app.asar -> app.asar.unpacked. Restoring first keeps re-runs
        // idempotent AND keeps the unpacked path valid.)
        //
        // Steam-update handling: if the live asar is UNPATCHED (no mod-host
        // marker) and differs from our backup, Steam has shipped a new
        // pristine build — refresh the backup instead of downgrading.
        const asarIsPatched = fs.readFileSync(this.asarPath).includes('mod-host.js');
        if (asarIsPatched && fs.existsSync(this.backupPath)) {
            fs.copyFileSync(this.backupPath, this.asarPath);
        } else if (!asarIsPatched && fs.existsSync(this.backupPath)) {
            const current = fs.readFileSync(this.asarPath);
            const backup = fs.readFileSync(this.backupPath);
            if (!current.equals(backup)) {
                console.log('♻️  Steam shipped a new pristine build — refreshing backup...');
                fs.copyFileSync(this.asarPath, this.backupPath);
            }
        }
        if (fs.existsSync(this.extractedPath)) {
            fs.rmSync(this.extractedPath, { recursive: true, force: true });
        }
        console.log('📂 Extracting app.asar...');
        execSync(`npx @electron/asar extract "${this.asarPath}" "${this.extractedPath}"`);

        // Step 5: Patch main.js
        console.log('🔧 Patching main.js...');
        this.patchMainJS();

        // Step 5b: No separate preload patch needed — mods are injected from
        // the main process via executeJavaScript (see loader/mod-host.js).

        // Step 5: Copy mod loader to resources
        console.log('📥 Installing mod loader...');
        this.installModLoader();

        // Step 6: Save patch state
        this.savePatchState();

        // Step 7: Repack asar
        // IMPORTANT: steamworks.js contains native modules (.node/.dll) that
        // must stay OUTSIDE the asar (Electron can't dlopen from inside an
        // archive). The original app used app.asar.unpacked for these — the
        // --unpack-dir flag reproduces that layout. Without it the game
        // crashes on launch with "The specified module could not be found."
        console.log('📦 Repacking app.asar...');
        execSync(`npx @electron/asar pack "${this.extractedPath}" "${this.asarPath}" --unpack-dir "node_modules/steamworks.js"`);

        console.log('\n✅ Patching complete!');
        console.log('\nYour game is now mod-ready. Install mods to the mods/ folder.');
        console.log('\nTo restore original game, run:');
        console.log('  node tools/patch-game.js restore\n');
    }

    patchMainJS() {
        const mainPath = path.join(this.extractedPath, 'electron', 'out', 'main.js');
        let content = fs.readFileSync(mainPath, 'utf8');
        let changed = [];

        // 1. Enable DevTools
        if (content.includes('devTools:!1')) {
            content = content.replace(/devTools:!1/g, 'devTools:!0');
            changed.push('DevTools enabled');
        } else if (content.includes('devTools:!0')) {
            changed.push('DevTools already enabled');
        }

        // 1b. Disable contextIsolation AND sandbox so our preload hook runs in
        // the page's MAIN world before the game scripts boot — that's the only
        // moment we can install prototype traps that capture the PIXI
        // Application (the obfuscated game keeps it in closures, unreachable
        // afterwards). nodeIntegration stays false, so the page world itself
        // still has no Node access; only our preload shell code does.
        let prefsPatched = false;
        if (content.includes('contextIsolation:!0')) {
            content = content.replace(/contextIsolation:!0/g, 'contextIsolation:!1');
            prefsPatched = true;
        }
        if (content.includes('sandbox:!0')) {
            content = content.replace(/sandbox:!0/g, 'sandbox:!1');
            prefsPatched = true;
        }
        if (prefsPatched) {
            changed.push('contextIsolation + sandbox disabled (preload pre-hook world)');
        } else if (content.includes('contextIsolation:!1')) {
            changed.push('contextIsolation/sandbox already disabled');
        }

        // 2. Hook mod host into the app.
        // Appended block waits for any BrowserWindow's webContents to finish
        // loading, then calls mod-host.js which injects the mod runtime + mods.
        if (!content.includes('mod-host.js')) {
            const hook = `;
// === HW MOD HOST HOOK (added by HW-ModManager) ===
try {
    const __hwModHost = require('node:path').join(__dirname, 'mod-host.js');
    const __hwLoadMods = require(__hwModHost);
    require('electron').app.on('web-contents-created', (e, wc) => {
        wc.on('did-finish-load', () => {
            try { __hwLoadMods(wc); }
            catch (err) { console.error('[HW Mod Host] failed:', err); }
        });
    });
    console.log('[HW Mod Host] hook installed');
} catch (err) { console.error('[HW Mod Host] hook error:', err); }
`;
            content += hook;
            changed.push('Mod host hook installed');
        } else {
            changed.push('Mod host hook already present');
        }

        // 3. Neutralize anti-tamper infinite loops (if present in main.js —
        //    the real ones live in the obfuscated index.js which we leave alone)
        const before = content;
        const infiniteLoopPattern = /while\([a-zA-Z_$]+\u200C\[42\]\)\{\}/g;
        content = content.replace(infiniteLoopPattern, '/* MOD: anti-tamper disabled */');
        if (content !== before) changed.push('Anti-tamper loops neutralized');

        fs.writeFileSync(mainPath, content, 'utf8');

        // 1c. Append the pre-hook to the game's preload (runs in main world
        // before dependencies.js/index.js execute).
        this.patchPreload();

        for (const c of changed) console.log('   ✓ ' + c);
    }

    patchPreload() {
        const preloadPath = path.join(this.extractedPath, 'electron', 'out', 'preload.js');
        let content = fs.readFileSync(preloadPath, 'utf8');
        let patched = false;

        // Harden hwNative exposure: with contextIsolation off, contextBridge
        // may not behave — fall back to direct assignment on failure.
        const exposePattern = 'e.contextBridge.exposeInMainWorld("hwNative",n)';
        if (content.includes(exposePattern)) {
            content = content.replace(
                exposePattern,
                'try{e.contextBridge.exposeInMainWorld("hwNative",n)}catch(err){window.hwNative=n}'
            );
            patched = true;
        }

        const MARKER = 'HW MOD PRE-HOOK';
        if (content.includes(MARKER)) {
            if (patched) fs.writeFileSync(preloadPath, content, 'utf8');
            return;
        }

        // Pre-hook is PREPENDED so it runs before the game's own preload code
        // and before any game dependency executes.
        const hook = `// === ${MARKER} (added by HW-ModManager) ===
// Runs in the page's main world BEFORE the game scripts. Pixi's Ticker
// invokes listeners via fn.call(app) every frame — a temporary
// Function.prototype.call trap captures the Application instance that the
// obfuscated game otherwise keeps hidden in closures.
(function () {
    try {
        window.__HW_DISCOVERY__ = { app: null };
        const origCall = Function.prototype.call;
        let done = false;
        Function.prototype.call = function (...args) {
            if (!done) {
                try {
                    const c = args[0];
                    if (c && c.stage && c.renderer) {
                        done = true;
                        window.__HW_DISCOVERY__.app = c;
                        Function.prototype.call = origCall;
                    }
                } catch (e) {}
            }
            return origCall.apply(this, args);
        };
        setTimeout(function () { if (!done) Function.prototype.call = origCall; }, 60000);
    } catch (e) {}
})();
`;
        fs.writeFileSync(preloadPath, hook + content, 'utf8');
        console.log('   ✓ Preload pre-hook installed');
    }

    installModLoader() {
        const loaderDest = path.join(this.extractedPath, 'electron', 'out', 'mod-host.js');
        const loaderSrc = path.join(__dirname, '..', 'loader', 'mod-host.js');

        if (fs.existsSync(loaderSrc)) {
            fs.copyFileSync(loaderSrc, loaderDest);
            console.log('   ✓ Mod host installed');
        } else {
            console.log('   ⚠ mod-host.js not found in project loader/ folder');
            process.exit(1);
        }

        const modsDir = path.join(this.gamePath, 'mods');
        if (!fs.existsSync(modsDir)) {
            fs.mkdirSync(modsDir, { recursive: true });
            console.log('   ✓ Created mods/ directory');
        }
    }

    flipFuse() {
        const exePath = path.join(this.gamePath, EXE_NAME);
        const exeBackup = path.join(this.gamePath, EXE_NAME + '.original');

        if (!fs.existsSync(exePath)) {
            console.log('⚠  Game exe not found — skipping fuse step');
            return;
        }

        // Backup the exe once
        if (!fs.existsSync(exeBackup)) {
            fs.copyFileSync(exePath, exeBackup);
            console.log('   ✓ Backed up original exe');
        }

        console.log('🔥 Checking Electron fuses...');
        let fuseState = '';
        try {
            fuseState = execSync(`npx @electron/fuses read --app "${exePath}"`, { encoding: 'utf8' });
        } catch (e) {
            console.log('   ⚠ Could not read fuses:', e.message.split('\n')[0]);
            return;
        }

        if (/EnableEmbeddedAsarIntegrityValidation is Disabled/.test(fuseState)) {
            console.log('   ✓ Integrity fuse already disabled');
            return;
        }

        try {
            execSync(`npx @electron/fuses write --app "${exePath}" EnableEmbeddedAsarIntegrityValidation=off`, { stdio: 'inherit' });
            console.log('   ✓ Asar integrity fuse disabled');
        } catch (e) {
            console.error('   ❌ Failed to flip fuse — game will crash on launch!');
            console.error('      Run manually: npx @electron/fuses write --app "' + EXE_NAME + '" EnableEmbeddedAsarIntegrityValidation=off');
            process.exit(1);
        }
    }

    savePatchState() {
        const statePath = path.join(this.gamePath, '.hw-mod-state.json');
        const state = {
            patched: true,
            patchedAt: new Date().toISOString(),
            backupExists: fs.existsSync(this.backupPath),
            modLoaderVersion: '1.0.0'
        };
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        console.log('   ✓ Saved patch state');
    }

    isPatched() {
        const statePath = path.join(this.gamePath, '.hw-mod-state.json');
        if (fs.existsSync(statePath)) {
            try {
                const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                return state.patched === true;
            } catch {
                return false;
            }
        }
        return false;
    }

    async restore() {
        console.log('🔄 Restoring original game...\n');
        
        let restored = false;

        // Method 0: Restore original exe (undoes the fuse flip)
        const exePath = path.join(this.gamePath, EXE_NAME);
        const exeBackup = path.join(this.gamePath, EXE_NAME + '.original');
        if (fs.existsSync(exeBackup)) {
            fs.copyFileSync(exeBackup, exePath);
            console.log(`   ✓ ${EXE_NAME} restored (fuse re-enabled)`);
            restored = true;
        }

        // Method 1: Restore from asar backup
        if (fs.existsSync(this.backupPath)) {
            console.log('📦 Restoring app.asar from backup...');
            fs.copyFileSync(this.backupPath, this.asarPath);
            console.log('   ✓ app.asar restored');
            restored = true;
        } else {
            console.log('⚠️  No app.asar backup found');
        }

        // Method 2: Restore main.js backup if extracted dir exists
        const mainPath = path.join(this.extractedPath, 'electron', 'out', 'main.js');
        const mainBackupPath = path.join(this.extractedPath, 'electron', 'out', 'main.js.original');
        if (fs.existsSync(mainBackupPath)) {
            fs.copyFileSync(mainBackupPath, mainPath);
            console.log('   ✓ main.js restored');
            restored = true;
        }

        // Remove patch state file
        const statePath = path.join(this.gamePath, '.hw-mod-state.json');
        if (fs.existsSync(statePath)) {
            fs.unlinkSync(statePath);
        }

        // Ask about mods folder
        const modsPath = path.join(this.gamePath, 'mods');
        if (fs.existsSync(modsPath)) {
            const mods = fs.readdirSync(modsPath);
            if (mods.length > 0) {
                console.log(`\n📁 Mods folder still exists with ${mods.length} item(s)`);
                console.log('   Your mods are preserved - delete manually if needed:');
                console.log(`   ${modsPath}`);
            }
        }

        if (restored) {
            console.log('\n✅ Original game restored!');
            console.log('   You can now play without mods.');
        } else {
            console.error('\n❌ No backups found!');
            console.error('   You may need to verify game files in Steam.');
        }
    }
}

// CLI
const args = process.argv.slice(2);
let command = 'patch';
let gamePath = DEFAULT_GAME_PATH;

// Parse args
for (let i = 0; i < args.length; i++) {
    if (args[i] === 'restore' || args[i] === 'status' || args[i] === 'patch') {
        command = args[i];
    } else if (args[i] && !args[i].startsWith('-')) {
        gamePath = args[i];
    }
}

const patcher = new GamePatcher(gamePath);

switch (command) {
    case 'restore':
        patcher.restore();
        break;
    case 'status':
        if (patcher.isPatched()) {
            console.log('🟢 Game is patched and mod-ready');
            console.log(`   Backup exists: ${fs.existsSync(patcher.backupPath) ? 'Yes' : 'No'}`);
        } else {
            console.log('🔴 Game is not patched');
        }
        break;
    default:
        patcher.patch();
        break;
}