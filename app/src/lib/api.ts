import { invoke } from '@tauri-apps/api/core';

export interface ModEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  enabled: boolean;
  hotToggle: boolean;
  requires: string[];
  manifestOk: boolean;
  settingsSchema: SettingField[];
  settings: SettingsValues;
}

export interface GameInfo {
  path: string;
  found: boolean;
  asarPatched: boolean;
  binaryPatched: boolean;
  patchState: boolean;
  modsDir: string;
}

export type SettingField = {
  id: string;
  type: 'text' | 'number' | 'slider' | 'toggle' | 'select' | 'color';
  label: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
};

export type SettingsValues = Record<string, unknown>;

export const api = {
  gameInfo: () => invoke<GameInfo>('get_game_info'),
  setGamePath: (path: string | null) => invoke<GameInfo>('set_game_path', { path }),
  listMods: () => invoke<ModEntry[]>('list_mods'),
  setModEnabled: (id: string, enabled: boolean) => invoke<void>('set_mod_enabled', { id, enabled }),
  setModSettings: (id: string, settings: SettingsValues) => invoke<void>('set_mod_settings', { id, settings }),
  launch: () => invoke<void>('launch_game'),
  openModsDir: () => invoke<void>('open_mods_dir'),
  tailHostLog: (lines: number) => invoke<string[]>('tail_host_log', { lines }),
  patchGame: () => invoke<string[]>('patch_game'),
  restoreGame: () => invoke<string[]>('restore_game'),
};
