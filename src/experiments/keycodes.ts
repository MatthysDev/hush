import { Combo, Mod } from '../types';

// macOS virtual keycodes (kVK_*). Only the subset Hush combos can use
// (letters, digits, F1–F20) plus the left-hand modifiers.
const LETTERS: Record<string, number> = {
  A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11,
  Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17, O: 31, U: 32, I: 34, P: 35,
  L: 37, J: 38, K: 40, N: 45, M: 46,
};

const DIGITS: Record<string, number> = {
  '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25,
};

const FKEYS: Record<string, number> = {
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109,
  F11: 103, F12: 111, F13: 105, F14: 107, F15: 113, F16: 106, F17: 64, F18: 79, F19: 80, F20: 90,
};

export const MOD_KEYCODE: Record<Mod, number> = {
  cmd: 55, // kVK_Command
  shift: 56, // kVK_Shift
  alt: 58, // kVK_Option
  ctrl: 59, // kVK_Control
};

export function keyToMacKeycode(key: string): number {
  const k = key.toUpperCase();
  if (k in DIGITS) return DIGITS[k];
  if (k in FKEYS) return FKEYS[k];
  if (k in LETTERS) return LETTERS[k];
  throw new Error(`No macOS keycode for key "${key}"`);
}

// Resolve a combo into the modifier keycodes + the (optional) key keycode
// the Swift HID helper expects. Order of mods is normalized upstream.
export function comboToMacKeycodes(combo: Combo): { mods: number[]; key: number } {
  const mods = combo.mods.map((m) => MOD_KEYCODE[m]);
  const key = combo.key ? keyToMacKeycode(combo.key) : -1;
  return { mods, key };
}
