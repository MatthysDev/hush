import { Combo, Mod } from './types';

const MOD_ORDER: Mod[] = ['ctrl', 'alt', 'cmd', 'shift'];

export function normalizeMods(mods: Mod[]): Mod[] {
  return MOD_ORDER.filter((m) => mods.includes(m));
}

export function comboEquals(a: Combo, b: Combo): boolean {
  if (a.key.toUpperCase() !== b.key.toUpperCase()) return false;
  const na = normalizeMods(a.mods);
  const nb = normalizeMods(b.mods);
  return na.length === nb.length && na.every((m, i) => m === nb[i]);
}

export function combosDistinct(combos: Combo[]): boolean {
  for (let i = 0; i < combos.length; i++) {
    for (let j = i + 1; j < combos.length; j++) {
      if (comboEquals(combos[i], combos[j])) return false;
    }
  }
  return true;
}

const MOD_SYMBOL: Record<Mod, string> = { ctrl: '⌃', alt: '⌥', cmd: '⌘', shift: '⇧' };
// Off macOS the 'cmd' modifier is the Windows key (uiohook reports it as Meta).
const MOD_NAME: Record<Mod, string> = { ctrl: 'Ctrl', alt: 'Alt', cmd: 'Win', shift: 'Shift' };

// The macOS Fn / Globe key, stored as key === 'Fn' with no modifiers.
export function isFnCombo(combo: Combo): boolean {
  return combo.mods.length === 0 && combo.key.toUpperCase() === 'FN';
}

// macOS shows the compact glyphs (⌃⌥K); Windows spells them out (Ctrl + Alt + K).
export function comboLabel(combo: Combo, platform: string = process.platform): string {
  if (isFnCombo(combo)) return '🌐 Fn';
  const mods = normalizeMods(combo.mods);
  if (platform !== 'darwin') {
    const parts = mods.map((m) => MOD_NAME[m]);
    if (combo.key) parts.push(combo.key.toUpperCase());
    return parts.join(' + ') || '—';
  }
  const glyphs = mods.map((m) => MOD_SYMBOL[m]).join('');
  if (!combo.key) return glyphs || '—';
  return glyphs + combo.key.toUpperCase();
}
