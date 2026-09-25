// HW Mod Manager — desktop app (Tauri 2). See ../README.md and root AGENTS.md.

mod asar;
mod config;
mod fuses;
mod game;
mod mods;
mod patcher;

use config::Config;
use tauri::AppHandle;

#[tauri::command]
fn get_game_info(app: AppHandle) -> game::GameInfo {
    game::info(&app)
}

#[tauri::command]
fn patch_game(app: AppHandle) -> Result<Vec<String>, String> {
    let p = patcher::Patcher::new(game::resolve(&app).root);
    p.patch()
}

#[tauri::command]
fn restore_game(app: AppHandle) -> Result<Vec<String>, String> {
    let p = patcher::Patcher::new(game::resolve(&app).root);
    p.restore()
}

#[tauri::command]
fn set_game_path(app: AppHandle, path: Option<String>) -> Result<game::GameInfo, String> {
    let cfg = Config { game_path: path.filter(|p| !p.trim().is_empty()) };
    config::save(&app, &cfg)?;
    Ok(game::info(&app))
}

#[tauri::command]
fn get_config(app: AppHandle) -> Config {
    config::load(&app)
}

#[tauri::command]
fn list_mods(app: AppHandle) -> Result<Vec<mods::ModEntry>, String> {
    mods::list_mods(&app)
}

#[tauri::command]
fn set_mod_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    mods::set_mod_enabled(&app, &id, enabled)
}

#[tauri::command]
fn set_mod_settings(
    app: AppHandle,
    id: String,
    settings: std::collections::HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    mods::set_mod_settings(&app, &id, &settings)
}

#[tauri::command]
fn launch_game(app: AppHandle) -> Result<(), String> {
    game::launch(&app)
}

#[tauri::command]
fn open_mods_dir(app: AppHandle) -> Result<(), String> {
    let dir = game::resolve(&app).mods_dir;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn tail_host_log(app: AppHandle, lines: u32) -> Vec<String> {
    mods::tail_host_log(&app, lines)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_game_info,
            set_game_path,
            get_config,
            list_mods,
            set_mod_enabled,
            set_mod_settings,
            launch_game,
            open_mods_dir,
            tail_host_log,
            patch_game,
            restore_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
