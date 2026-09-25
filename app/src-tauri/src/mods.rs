//! Mod scanning, persisted state (state.json), and the hot command channel
//! (.hw-commands.jsonl) that mod-host.js polls to toggle mods / push settings
//! into the live game page.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::game;

/// Per-mod persisted state, keyed by mod folder id.
#[derive(Serialize, Deserialize, Default)]
pub struct ModState {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub settings: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct StateFile {
    pub mods: HashMap<String, ModState>,
}

pub fn state_path(app: &AppHandle) -> PathBuf {
    game::resolve(app).mods_dir.join("state.json")
}

pub fn load_state(app: &AppHandle) -> StateFile {
    fs::read_to_string(state_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_state(app: &AppHandle, state: &StateFile) -> Result<(), String> {
    let path = state_path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Append one command line to the hot channel consumed by mod-host.js.
/// Truncates when the file grows huge (host consumes within ~250ms anyway).
pub fn enqueue(app: &AppHandle, cmd: &serde_json::Value) -> Result<(), String> {
    let path = game::resolve(app).mods_dir.join(".hw-commands.jsonl");
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = fs::write(&path, "");
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(format!("{}\n", cmd).as_bytes())
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub hot_toggle: bool,
    pub requires: Vec<String>,
    pub manifest_ok: bool,
    /// Raw settings schema from mod.json "settings" (rendered client-side).
    pub settings_schema: Vec<serde_json::Value>,
    /// Saved values from state.json.
    pub settings: HashMap<String, serde_json::Value>,
}

/// Scan the game's mods dir. Skips `_lib` and folders without mod.js.
pub fn list_mods(app: &AppHandle) -> Result<Vec<ModEntry>, String> {
    let mods_dir = game::resolve(app).mods_dir;
    let state = load_state(app);
    let mut out: Vec<ModEntry> = Vec::new();

    let entries = match fs::read_dir(&mods_dir) {
        Ok(e) => e,
        Err(_) => return Ok(out), // missing mods dir = no mods installed
    };

    for entry in entries.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id == "_lib" || !entry.path().join("mod.js").exists() {
            continue;
        }

        let mut manifest = serde_json::Map::new();
        if let Ok(txt) = fs::read_to_string(entry.path().join("mod.json")) {
            if let Ok(serde_json::Value::Object(v)) = serde_json::from_str(&txt) {
                manifest = v;
            }
        }
        let str_field = |k: &str, d: &str| manifest.get(k).and_then(|v| v.as_str()).unwrap_or(d).to_string();
        let vec_field = |k: &str| -> Vec<String> {
            manifest.get(k).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
        };

        let st = state.mods.get(&id);
        out.push(ModEntry {
            enabled: st.and_then(|s| s.enabled).unwrap_or(true),
            hot_toggle: manifest.get("hotToggle").and_then(|v| v.as_bool()).unwrap_or(false),
            id: id.clone(),
            name: str_field("name", &id),
            version: str_field("version", "1.0.0"),
            description: str_field("description", ""),
            author: str_field("author", "unknown"),
            tags: vec_field("tags"),
            requires: vec_field("requires"),
            manifest_ok: !manifest.is_empty(),
            settings_schema: manifest
                .get("settings")
                .and_then(|v| v.as_array())
                .map(|a| a.to_vec())
                .unwrap_or_default(),
            settings: st.map(|s| s.settings.clone()).unwrap_or_default(),
        });
    }

    out.sort_by(|a, b| b.enabled.cmp(&a.enabled).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

pub fn set_mod_enabled(app: &AppHandle, id: &str, enabled: bool) -> Result<(), String> {
    let mut state = load_state(app);
    state.mods.entry(id.to_string()).or_default().enabled = Some(enabled);
    write_state(app, &state)?;
    enqueue(app, &serde_json::json!({ "op": "toggle", "id": id, "enabled": enabled }))
}

pub fn set_mod_settings(
    app: &AppHandle,
    id: &str,
    settings: &HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let mut state = load_state(app);
    state.mods.entry(id.to_string()).or_default().settings = settings.clone();
    write_state(app, &state)?;
    enqueue(app, &serde_json::json!({ "op": "settings", "id": id, "settings": settings }))
}

/// Tail of the mod host's in-game log (mods/hw-mod-host.log).
pub fn tail_host_log(app: &AppHandle, lines: u32) -> Vec<String> {
    let path = game::resolve(app).mods_dir.join("hw-mod-host.log");
    let content = fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(lines as usize);
    all[start..].iter().map(|s| s.to_string()).collect()
}
