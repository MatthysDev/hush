import Store from 'electron-store';
import { HushConfig } from './types';
import { DEFAULT_CONFIG, validateConfig } from './config';

const store = new Store<{ config: HushConfig }>({
  name: 'hush-config',
  defaults: { config: DEFAULT_CONFIG },
});

export function loadConfig(): HushConfig {
  const cfg = { ...DEFAULT_CONFIG, ...store.get('config') };
  try {
    validateConfig(cfg);
    return cfg;
  } catch {
    // Stored config is corrupt/duplicated combos — fall back to defaults.
    store.set('config', DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: HushConfig): HushConfig {
  validateConfig(cfg); // throws on duplicate combos -> surfaced to renderer
  store.set('config', cfg);
  return cfg;
}
