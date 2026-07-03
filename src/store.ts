import Store from 'electron-store';
import { Combo, HushConfig } from './types';
import { DEFAULT_CONFIG, validateConfig } from './config';

const store = new Store<{ config: HushConfig }>({
  name: 'hush-config',
  defaults: { config: DEFAULT_CONFIG },
});

// Older builds stored a separate `trigger` + `wisprCombo` (Hush used to
// synthesize the Wispr chord). The model is now a single shortcut you press
// yourself, so migrate `trigger` (the key the user physically pressed) into it.
function migrate(raw: Record<string, unknown>): HushConfig {
  const shortcut = (raw.shortcut ?? raw.trigger ?? DEFAULT_CONFIG.shortcut) as Combo;
  return {
    shortcut,
    discordRpc: (raw.discordRpc as HushConfig['discordRpc']) ?? DEFAULT_CONFIG.discordRpc,
    mode: (raw.mode as HushConfig['mode']) ?? DEFAULT_CONFIG.mode,
    unmuteDelayMs: (raw.unmuteDelayMs as number) ?? DEFAULT_CONFIG.unmuteDelayMs,
    // New in the cross-machine build. Old configs predate these → default to
    // 'local', preserving the original single-machine behavior exactly.
    role: (raw.role as HushConfig['role']) ?? DEFAULT_CONFIG.role,
    remote: (raw.remote as HushConfig['remote']) ?? DEFAULT_CONFIG.remote,
    hostListen: (raw.hostListen as HushConfig['hostListen']) ?? DEFAULT_CONFIG.hostListen,
    // New: launch-at-login. Old configs predate it → default to true (start
    // with the machine), matching DEFAULT_CONFIG.
    launchAtLogin: (raw.launchAtLogin as boolean) ?? DEFAULT_CONFIG.launchAtLogin,
  };
}

export function loadConfig(): HushConfig {
  const cfg = migrate(store.get('config') as unknown as Record<string, unknown>);
  try {
    validateConfig(cfg);
    return cfg;
  } catch {
    // Stored config is corrupt — fall back to defaults.
    store.set('config', DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: HushConfig): HushConfig {
  validateConfig(cfg); // throws on an empty shortcut -> surfaced to the renderer
  store.set('config', cfg);
  return cfg;
}
