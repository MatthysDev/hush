import { describe, it, expect } from 'vitest';
import { comboLabel } from '../src/combo';
import { defaultShortcut } from '../src/config';

describe('comboLabel', () => {
  it('uses compact glyphs on macOS', () => {
    expect(comboLabel({ mods: ['alt', 'ctrl'], key: '' }, 'darwin')).toBe('⌃⌥');
    expect(comboLabel({ mods: ['cmd'], key: 'k' }, 'darwin')).toBe('⌘K');
  });

  it('spells modifiers out on Windows, with cmd as the Win key', () => {
    expect(comboLabel({ mods: ['cmd', 'ctrl'], key: '' }, 'win32')).toBe('Ctrl + Win');
    expect(comboLabel({ mods: ['shift', 'alt'], key: 'f13' }, 'win32')).toBe('Alt + Shift + F13');
    expect(comboLabel({ mods: [], key: 'F8' }, 'win32')).toBe('F8');
  });

  it('shows a dash for an empty combo and keeps the Fn label', () => {
    expect(comboLabel({ mods: [], key: '' }, 'win32')).toBe('—');
    expect(comboLabel({ mods: [], key: '' }, 'darwin')).toBe('—');
    expect(comboLabel({ mods: [], key: 'Fn' }, 'darwin')).toBe('🌐 Fn');
  });
});

describe('defaultShortcut', () => {
  it("matches Wispr Flow's push-to-talk default per OS", () => {
    expect(defaultShortcut('darwin')).toEqual({ mods: ['ctrl', 'alt'], key: '' });
    expect(defaultShortcut('win32')).toEqual({ mods: ['ctrl', 'cmd'], key: '' });
  });
});
