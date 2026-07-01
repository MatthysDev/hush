import { Combo, Mod } from './types';

const MOD_TOKENS: Record<Mod, string> = {
  ctrl: 'LeftControl',
  alt: 'LeftAlt',
  cmd: 'LeftSuper',
  shift: 'LeftShift',
};

const DIGIT_TOKENS: Record<string, string> = {
  '0': 'Num0', '1': 'Num1', '2': 'Num2', '3': 'Num3', '4': 'Num4',
  '5': 'Num5', '6': 'Num6', '7': 'Num7', '8': 'Num8', '9': 'Num9',
};

export function keyToToken(key: string): string {
  const k = key.toUpperCase();
  if (k in DIGIT_TOKENS) return DIGIT_TOKENS[k];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return k; // F1..F24
  if (/^[A-Z]$/.test(k)) return k;                  // A..Z
  throw new Error(`Unsupported key: ${key}`);
}

export function comboToKeyTokens(combo: Combo): string[] {
  const mods = combo.mods.map((m) => MOD_TOKENS[m]);
  if (!combo.key) return mods; // modifier-only combo
  return [...mods, keyToToken(combo.key)];
}
