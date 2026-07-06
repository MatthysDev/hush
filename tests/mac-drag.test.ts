import { describe, it, expect } from 'vitest';
import { appBundlePath, canDragPermissions } from '../src/mac-drag';

describe('appBundlePath', () => {
  it('extracts the .app bundle from an installed executable path', () => {
    expect(appBundlePath('/Applications/Hush.app/Contents/MacOS/Hush'))
      .toBe('/Applications/Hush.app');
  });
  it('extracts the dev Electron.app bundle', () => {
    expect(appBundlePath('/Users/x/hush/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))
      .toBe('/Users/x/hush/node_modules/electron/dist/Electron.app');
  });
  it('returns null for a plain binary not inside a .app', () => {
    expect(appBundlePath('/usr/local/bin/whatever')).toBeNull();
  });
});

describe('canDragPermissions', () => {
  it('is true on macOS for a packaged app with a bundle', () => {
    expect(canDragPermissions('darwin', true, '/Applications/Hush.app')).toBe(true);
  });
  it('is false in dev (not packaged) even on macOS', () => {
    expect(canDragPermissions('darwin', false, '/x/Electron.app')).toBe(false);
  });
  it('is false off macOS', () => {
    expect(canDragPermissions('win32', true, 'C:/Hush/Hush.exe')).toBe(false);
  });
  it('is false when no bundle could be resolved', () => {
    expect(canDragPermissions('darwin', true, null)).toBe(false);
  });
});
