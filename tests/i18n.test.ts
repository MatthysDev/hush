import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveLanguage, TRAY, LANGUAGES } from '../src/i18n';

// renderer/i18n.js is a plain browser script that also exports via CommonJS.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UI: Record<string, Record<string, string>> = require('../renderer/i18n.js');
const RENDERER = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('resolveLanguage', () => {
  it('uses the saved choice when there is one', () => {
    expect(resolveLanguage('fr', 'en-US')).toBe('fr');
    expect(resolveLanguage('en', 'fr-FR')).toBe('en');
  });
  it('follows the system language when nothing is saved', () => {
    expect(resolveLanguage(undefined, 'fr-FR')).toBe('fr');
    expect(resolveLanguage(undefined, 'fr')).toBe('fr');
    expect(resolveLanguage(undefined, 'en-US')).toBe('en');
    expect(resolveLanguage(undefined, 'de-DE')).toBe('en');
  });
  it('ignores a garbage saved value', () => {
    expect(resolveLanguage('xx', 'fr-CA')).toBe('fr');
  });
});

describe('tray strings', () => {
  it('every language defines the same keys', () => {
    for (const l of LANGUAGES) expect(Object.keys(TRAY[l]).sort()).toEqual(Object.keys(TRAY.en).sort());
  });
});

describe('settings window strings (renderer/i18n.js)', () => {
  it('has a table for each language with the same keys and placeholders', () => {
    for (const l of LANGUAGES) {
      expect(Object.keys(UI[l]).sort()).toEqual(Object.keys(UI.en).sort());
      for (const k of Object.keys(UI.en)) expect([l, k, placeholders(UI[l][k])]).toEqual([l, k, placeholders(UI.en[k])]);
    }
  });

  it("every t('key') in renderer.js and data-i18n key in index.html exists", () => {
    const used = new Set<string>([
      ...[...RENDERER.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]),
      // t(cond ? 'a' : 'b')
      ...[...RENDERER.matchAll(/\bt\([^()']*\? '(\w+)' : '(\w+)'\)/g)].flatMap((m) => [m[1], m[2]]),
      ...[...HTML.matchAll(/data-i18n(?:-title)?="(\w+)"/g)].map((m) => m[1]),
    ]);
    const missing = [...used].filter((k) => !(k in UI.en));
    expect(missing).toEqual([]);
  });
});
