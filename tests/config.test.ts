import { describe, it, expect } from 'vitest';
import { getConfig, DEFAULT_CONFIG, validateConfig } from '../src/config';
import { combosDistinct } from '../src/combo';

describe('getConfig', () => {
  it('returns a config whose three combos are distinct', () => {
    const cfg = getConfig();
    expect(combosDistinct([cfg.trigger, cfg.discordCombo, cfg.wisprCombo])).toBe(true);
  });
  it('defaults to hold mode with no unmute delay', () => {
    expect(DEFAULT_CONFIG.mode).toBe('hold');
    expect(DEFAULT_CONFIG.unmuteDelayMs).toBe(0);
  });
});

describe('validateConfig', () => {
  it('throws when two combos collide', () => {
    expect(() => validateConfig({
      ...DEFAULT_CONFIG,
      discordCombo: { mods: [], key: 'F13' }, // same as trigger
    })).toThrow(/distinct/);
  });
});
