import { describe, it, expect } from 'vitest';
import { comboToKeyTokens, keyToToken } from '../src/synth-map';

describe('keyToToken', () => {
  it('maps digits to Num tokens', () => expect(keyToToken('1')).toBe('Num1'));
  it('maps letters uppercased', () => expect(keyToToken('m')).toBe('M'));
  it('passes function keys through', () => expect(keyToToken('F13')).toBe('F13'));
  it('throws on an unsupported key', () => expect(() => keyToToken('=')).toThrow());
});

describe('comboToKeyTokens', () => {
  it('prepends mod tokens in canonical order then the key', () => {
    expect(comboToKeyTokens({ mods: ['ctrl', 'alt', 'cmd'], key: '1' }))
      .toEqual(['LeftControl', 'LeftAlt', 'LeftSuper', 'Num1']);
  });
  it('returns only mod tokens for a modifiers-only combo', () => {
    expect(comboToKeyTokens({ mods: ['ctrl', 'alt'], key: '' }))
      .toEqual(['LeftControl', 'LeftAlt']);
  });
});
