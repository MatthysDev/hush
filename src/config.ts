import { HushConfig } from './types';
import { combosDistinct } from './combo';

export const DEFAULT_CONFIG: HushConfig = {
  // If your keyboard has no F13, change to { mods: ['ctrl', 'alt', 'cmd'], key: 'D' }
  // (or set it from the Hush settings window).
  trigger: { mods: [], key: 'F13' },
  discordCombo: { mods: ['ctrl', 'alt', 'cmd'], key: '1' },
  wisprCombo: { mods: ['ctrl', 'alt', 'cmd'], key: '2' },
  mode: 'hold',
  muteDictateGapMs: 25,
  unmuteDelayMs: 0,
};

export function validateConfig(cfg: HushConfig): void {
  // Discord/Wispr are SYNTHESIZED hotkeys — they need a real key. A modifier-only
  // combo (key: '') just taps ⌃⌥⌘ and does nothing, which is exactly how the
  // "Discord ne se mute jamais" bug slipped in (capture finalized on an early
  // modifier release, losing the key). The trigger may be modifier-only; these
  // two may not.
  if (!cfg.discordCombo.key) {
    throw new Error('Hush config invalid: discordCombo must include a key (e.g. ⌘⌥X), not modifiers only');
  }
  if (!cfg.wisprCombo.key) {
    throw new Error('Hush config invalid: wisprCombo must include a key (e.g. ⌃⌥Z), not modifiers only');
  }
  if (!combosDistinct([cfg.trigger, cfg.discordCombo, cfg.wisprCombo])) {
    throw new Error('Hush config invalid: trigger, discordCombo and wisprCombo must all be distinct');
  }
}

export function getConfig(): HushConfig {
  validateConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}
