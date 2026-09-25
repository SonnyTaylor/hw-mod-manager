//! Game patcher — Rust port of tools/patch-game.js so the desktop manager is
//! standalone (no Node/npx needed on user machines).
//!
//! Steps (patch): fuse flip (with exe backup) → asar backup (+ Steam-update
//! refresh) → extract → patch main.js + preload.js → install mod-host.js →
//! save patch state → repack asar (steamworks.js stays unpacked).
//! restore(): exe backup → asar backup → main.js backup → remove state file.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::asar;
use crate::fuses;
use crate::game;

/// Embedded at compile time — the manager binary carries the loader it installs.
const MOD_HOST_SRC: &str = include_str!("../../../loader/mod-host.js");

const PRE_HOOK_MARKER: &str = "HW MOD PRE-HOOK";

#[derive(Serialize, Deserialize)]
struct PatchStateFile {
    patched: bool,
    patched_at: u64,
    mod_loader_version: String,
}

pub struct Patcher {
    pub game_path: PathBuf,
    pub asar_path: PathBuf,
    pub extracted_path: PathBuf,
    pub backup_path: PathBuf,
    pub exe_path: PathBuf,
    pub exe_backup: PathBuf,
}

impl Patcher {
    pub fn new(game_path: PathBuf) -> Self {
        Patcher {
            exe_path: game_path.join(game::exe_name()),
            exe_backup: game_path.join(format!("{}.original", game::exe_name())),
            asar_path: game_path.join("resources").join("app.asar"),
            backup_path: game_path.join("resources").join("app.asar.original"),
            extracted_path: game_path.join("asar_extracted"),
            game_path,
        }
    }

    pub fn is_patched(&self) -> bool {
        fs::read_to_string(self.game_path.join(".hw-mod-state.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<PatchStateFile>(&s).ok())
            .map(|s| s.patched)
            .unwrap_or(false)
    }

    /// Idempotent; mirrors tools/patch-game.js. Returns step log lines.
    pub fn patch(&self) -> Result<Vec<String>, String> {
        let mut log: Vec<String> = Vec::new();
        if !self.asar_path.exists() {
            return Err(format!("app.asar not found under {}", self.game_path.display()));
        }

        // 1. Fuse flip (exe backed up once, before any modification).
        let exe_backup_ok = if !self.exe_backup.exists() {
            fs::copy(&self.exe_path, &self.exe_backup)
                .map_err(|e| format!("backup exe: {e}"))?;
            log.push("Backed up original executable".into());
            true
        } else {
            false
        };
        let _ = exe_backup_ok;
        let already_disabled = fuses::set_fuse_disabled(
            &self.exe_path,
            fuses::FUSE_ENABLE_EMBEDDED_ASAR_INTEGRITY_VALIDATION,
        )
        .map_err(|e| format!("fuse flip failed: {e}"))?;
        log.push(if already_disabled {
            "Integrity fuse already disabled".into()
        } else {
            "Asar integrity fuse disabled".into()
        });

        // 2. asar backup — created once, never overwritten (pitfall 11).
        if !self.backup_path.exists() {
            fs::copy(&self.asar_path, &self.backup_path).map_err(|e| format!("backup asar: {e}"))?;
            log.push("Backed up original app.asar".into());
        }

        // 3. Steam-update refresh: live asar UNPATCHED (no mod-host marker) and
        //    different from the backup → new pristine build; refresh backup.
        let live = fs::read(&self.asar_path).map_err(|e| e.to_string())?;
        let asar_is_patched = live.windows(11).any(|w| w == b"mod-host.js");
        if !asar_is_patched && self.backup_path.exists() {
            let backup = fs::read(&self.backup_path).map_err(|e| e.to_string())?;
            if backup != live {
                log.push("Steam shipped a new pristine build — refreshing backup".into());
                fs::copy(&self.asar_path, &self.backup_path).map_err(|e| e.to_string())?;
            }
        } else if asar_is_patched && self.backup_path.exists() {
            // Re-runs start from pristine: restore first (pitfall 3)
            fs::copy(&self.backup_path, &self.asar_path).map_err(|e| e.to_string())?;
        }

        // 4. Extract from the LIVE asar (keeps the name-derived .unpacked sibling
        //    valid — pitfall 3).
        if self.extracted_path.exists() {
            fs::remove_dir_all(&self.extracted_path).map_err(|e| e.to_string())?;
        }
        asar::extract(&self.asar_path, &self.extracted_path)?;
        log.push("Extracted app.asar".into());

        // 5. main.js + preload.js patches (main.js backed up once, before patching)
        let out_dir = self.extracted_path.join("electron").join("out");
        let main_path = out_dir.join("main.js");
        let main_backup = out_dir.join("main.js.original");
        if !main_backup.exists() {
            fs::copy(&main_path, &main_backup).map_err(|e| format!("backup main.js: {e}"))?;
        }
        for line in self.patch_main_js(&main_path)? {
            log.push(line);
        }
        for line in self.patch_preload(&out_dir.join("preload.js"))? {
            log.push(line);
        }

        // 6. Install mod host into the asar tree + create mods dir
        fs::write(out_dir.join("mod-host.js"), MOD_HOST_SRC)
            .map_err(|e| format!("write mod-host.js: {e}"))?;
        fs::create_dir_all(self.game_path.join("mods")).map_err(|e| e.to_string())?;
        log.push("Mod host installed".into());

        // 7. State + repack
        self.save_state()?;
        log.push("Patch state saved".into());
        asar::pack(&self.extracted_path, &self.asar_path)?;
        log.push("Repacked app.asar (steamworks.js kept unpacked)".into());

        Ok(log)
    }

    fn patch_main_js(&self, path: &PathBuf) -> Result<Vec<String>, String> {
        let content = fs::read_to_string(path).map_err(|e| format!("read main.js: {e}"))?;
        let mut changed = Vec::new();

        let mut content = content.replace("devTools:!1", "devTools:!0");
        if content.contains("devTools:!0") {
            changed.push("DevTools enabled".into());
        }

        if content.contains("contextIsolation:!0") {
            content = content.replace("contextIsolation:!0", "contextIsolation:!1");
            content = content.replace("sandbox:!0", "sandbox:!1");
            changed.push("contextIsolation + sandbox disabled (preload pre-hook world)".into());
        }

        if !content.contains("mod-host.js") {
            content.push_str(HOOK_MAIN);
            changed.push("Mod host hook installed".into());
        }

        // Neutralize anti-tamper infinite loops in main.js (the real ones live
        // in the obfuscated index.js, which we never touch).
        let re = regex::Regex::new(r"while\([a-zA-Z_$]+\u{200C}\[42\]\)\{\}").unwrap();
        let neutralized = re.replace_all(&content, "/* MOD: anti-tamper disabled */").to_string();
        if neutralized != content {
            content = neutralized;
            changed.push("Anti-tamper loops neutralized".into());
        }

        fs::write(path, &content).map_err(|e| format!("write main.js: {e}"))?;
        Ok(changed)
    }

    fn patch_preload(&self, path: &PathBuf) -> Result<Vec<String>, String> {
        let mut changed = Vec::new();
        let content = fs::read_to_string(path).map_err(|e| format!("read preload.js: {e}"))?;
        let mut content = content;

        // Harden hwNative exposure (contextIsolation is off after the main.js patch)
        let expose = "e.contextBridge.exposeInMainWorld(\"hwNative\",n)";
        if content.contains(expose) && !content.contains("catch(err){window.hwNative=n}") {
            content = content.replace(
                expose,
                "try{e.contextBridge.exposeInMainWorld(\"hwNative\",n)}catch(err){window.hwNative=n}",
            );
            changed.push("hwNative exposure hardened".into());
        }

        if !content.contains(PRE_HOOK_MARKER) {
            content = format!("{PRE_HOOK}{content}");
            changed.push("Preload pre-hook installed".into());
        }

        fs::write(path, &content).map_err(|e| format!("write preload.js: {e}"))?;
        Ok(changed)
    }

    fn save_state(&self) -> Result<(), String> {
        let state = PatchStateFile {
            patched: true,
            patched_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            mod_loader_version: "1.1.0".into(),
        };
        let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
        fs::write(self.game_path.join(".hw-mod-state.json"), json).map_err(|e| e.to_string())
    }

    /// Undo fuse flip + asar + main.js; remove patch state. Mods dir is preserved.
    pub fn restore(&self) -> Result<Vec<String>, String> {
        let mut log = Vec::new();
        if self.exe_backup.exists() {
            fs::copy(&self.exe_backup, &self.exe_path).map_err(|e| e.to_string())?;
            log.push(format!("{} restored (fuse re-enabled)", game::exe_name()));
        }
        if self.backup_path.exists() {
            fs::copy(&self.backup_path, &self.asar_path).map_err(|e| e.to_string())?;
            log.push("app.asar restored from backup".into());
        } else {
            log.push("no app.asar backup found — verify files in Steam if issues".into());
        }
        let main = self.extracted_path.join("electron").join("out").join("main.js");
        let main_bak = self.extracted_path.join("electron").join("out").join("main.js.original");
        if main_bak.exists() {
            fs::copy(&main_bak, &main).map_err(|e| e.to_string())?;
            log.push("main.js restored".into());
        }
        let state = self.game_path.join(".hw-mod-state.json");
        if state.exists() {
            fs::remove_file(state).map_err(|e| e.to_string())?;
        }
        log.push("Mods folder preserved (delete manually if wanted)".into());
        Ok(log)
    }
}


const HOOK_MAIN: &str = r#";
// === HW MOD HOST HOOK (added by HW-ModManager) ===
try {
    const __hwModHost = require('node:path').join(__dirname, 'mod-host.js');
    const __hwLoadMods = require(__hwModHost);
    require('electron').app.on('web-contents-created', (e, wc) => {
        wc.on('did-finish-load', () => {
            try { __hwLoadMods(wc); }
            catch (err) { console.error('[HW Mod Host] failed:', err); }
        });
        // Diagnostics: main-frame failures surface in Steam's console log
        // (console-linux.txt) even when the mod-host log was never written.
        wc.on('did-fail-load', (ev, code, desc, url, isMain) => {
            if (isMain) console.error('[HW Mod Host] did-fail-load(main):', code, desc, url);
        });
        wc.on('did-start-navigation', (ev, url, isInPlace, isMain) => {
            if (isMain) console.log('[HW Mod Host] nav(main):', url);
        });
    });
    console.log('[HW Mod Host] hook installed');
} catch (err) { console.error('[HW Mod Host] hook error:', err); }
"#;

const PRE_HOOK: &str = r"// === HW MOD PRE-HOOK (added by HW-ModManager) ===
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
";

#[cfg(test)]
mod tests {
    use super::*;

    /// Live end-to-end: patches the real Steam install. Run with:
    ///   HW_TEST_LIVE_PATCH=1 cargo test live_patch -- --nocapture
    #[test]
    fn live_patch_real_game() {
        if std::env::var("HW_TEST_LIVE_PATCH").is_err() { return; }
        let root = PathBuf::from(std::env::var("HOME").unwrap())
            .join(".local/share/Steam/steamapps/common/Happy Wheels");
        let p = Patcher::new(root);
        let log = p.patch().unwrap();
        for l in &log { println!("step: {l}"); }
        assert!(p.is_patched());
    }
}
