import { describe, it, expect } from 'vitest';
import { NutSynthEngine, KeyDriver } from '../src/synth-engine';
import { Combo } from '../src/types';

function recorder() {
  const calls: string[] = [];
  const driver: KeyDriver = {
    pressKey: async (...k: number[]) => { calls.push(`press:${k.join(',')}`); },
    releaseKey: async (...k: number[]) => { calls.push(`release:${k.join(',')}`); },
  };
  const sleep = async (ms: number) => { calls.push(`sleep:${ms}`); };
  return { calls, driver, sleep };
}

const combo: Combo = { mods: ['ctrl', 'alt', 'cmd'], key: '1' };

describe('NutSynthEngine.tapCombo', () => {
  // Discord registers its global keybind on key-down only if the chord stays
  // down long enough to be observed. A zero-width tap (press + release posted
  // back-to-back) gets dropped — that was the "Hush doesn't mute Discord" bug.
  it('holds the chord down before releasing so the keybind registers', async () => {
    const { calls, driver, sleep } = recorder();
    const e = new NutSynthEngine(driver, 30, sleep);
    await e.tapCombo(combo);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/^press:/);
    expect(calls[1]).toBe('sleep:30');
    expect(calls[2]).toMatch(/^release:/);
  });

  it('presses and releases exactly the same keys', async () => {
    const { calls, driver, sleep } = recorder();
    const e = new NutSynthEngine(driver, 30, sleep);
    await e.tapCombo(combo);
    const press = calls.find((c) => c.startsWith('press:'))!.slice('press:'.length);
    const release = calls.find((c) => c.startsWith('release:'))!.slice('release:'.length);
    expect(release).toBe(press);
  });
});
