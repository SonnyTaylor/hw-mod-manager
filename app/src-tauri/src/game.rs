//! Happy Wheels install detection — Rust port of tools/platform.js.
//! Priority: manager config override > HW_GAME_PATH env > auto-detect.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::config;

/// The Steam appid for Happy Wheels (Linux native build, see AGENTS.md pitfall 17).
pub const STEAM_APPID: &str = "4705510";

/// The file Electron actually boots (and the one carrying the asar-integrity fuse).
#[cfg(target_os = "windows")]
pub const EXE_NAME: &str = "Happy Wheels.exe";
#[cfg(not(target_os = "windows"))]
pub const EXE_NAME: &str = "happy-wheels-bin";

fn steam_tail() -> PathBuf {
    PathBuf::from("steamapps").join("common").join("Happy Wheels")
}

fn candidates(home: &std::path::Path) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            PathBuf::from("C:/SteamLibrary/steamapps/common/Happy Wheels"),
            PathBuf::from("C:/Program Files (x86)/Steam/steamapps/common/Happy Wheels"),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![
            home.join(".local/share/Steam").join(steam_tail()),
            home.join(".steam/steam").join(steam_tail()),
            home.join(".steam/root").join(steam_tail()),
            home.join(".var/app/com.valvesoftware.Steam/data/Steam").join(steam_tail()), // Flatpak
        ]
    }
}

fn auto_detect(home: &std::path::Path) -> PathBuf {
    let cands = candidates(home);
    cands.iter()
        .find(|p| p.join(EXE_NAME).exists())
        .cloned()
        .unwrap_or_else(|| cands[0].clone())
}

pub struct GamePaths {
    pub root: PathBuf,
    pub mods_dir: PathBuf,
}

pub fn resolve(app: &AppHandle) -> GamePaths {
    let home = app.path().home_dir().unwrap_or_else(|_| PathBuf::from("."));
    let root = config::load(app)
        .game_path
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var("HW_GAME_PATH").ok().filter(|s| !s.trim().is_empty()).map(PathBuf::from))
        .unwrap_or_else(|| auto_detect(&home));
    GamePaths { mods_dir: root.join("mods"), root }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub path: String,
    pub found: bool,
    /// app.asar.original backup exists → asar was patched with mod-host.
    pub asar_patched: bool,
    /// <boot binary>.original exists → fuse was flipped.
    pub binary_patched: bool,
    pub mods_dir: String,
}

pub fn info(app: &AppHandle) -> GameInfo {
    let g = resolve(app);
    GameInfo {
        path: g.root.display().to_string(),
        found: g.root.join(EXE_NAME).exists(),
        asar_patched: g.root.join("app.asar.original").exists(),
        binary_patched: g.root.join(format!("{EXE_NAME}.original")).exists(),
        mods_dir: g.mods_dir.display().to_string(),
    }
}

/// Launch the game. Linux must go through Steam (pitfall 17: direct exec gets
/// bounced back by steamworks restartAppIfNecessary).
pub fn launch(app: &AppHandle) -> Result<(), String> {
    let root = resolve(app).root;
    #[cfg(target_os = "windows")]
    {
        let exe = root.join(EXE_NAME);
        if !exe.exists() {
            return Err(format!("Game executable not found at {}", exe.display()));
        }
        std::process::Command::new(&exe)
            .spawn()
            .map_err(|e| format!("Failed to launch game: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = root;
        std::process::Command::new("steam")
            .args(["-applaunch", STEAM_APPID])
            .spawn()
            .map_err(|e| format!("Failed to launch Steam: {e}"))?;
        Ok(())
    }
}
