import { describe, it, expect } from 'vitest';
import { SynthGuard, GuardedSynth } from '../src/synth-guard';
import { Combo, SynthEngine } from '../src/types';

class FakeSynth implements SynthEngine {
  syntheticDuring: boolean[] = [];
  constructor(private readonly guard: SynthGuard) {}
  async tapCombo(_c: Combo) { this.syntheticDuring.push(this.guard.isSynthetic()); }
  async holdDown(_c: Combo) { this.syntheticDuring.push(this.guard.isSynthetic()); }
  async holdUp(_c: Combo) { this.syntheticDuring.push(this.guard.isSynthetic()); }
}

const combo: Combo = { mods: ['ctrl', 'alt', 'cmd'], key: '1' };

describe('SynthGuard', () => {
  it('is synthetic only inside the injection window + grace', () => {
    let now = 1000;
    const guard = new SynthGuard(60, () => now);

    expect(guard.isSynthetic()).toBe(false);
    guard.enter();
    expect(guard.isSynthetic()).toBe(true);
    guard.leave();
    expect(guard.isSynthetic()).toBe(true); // still inside grace
    now += 59;
    expect(guard.isSynthetic()).toBe(true);
    now += 1;
    expect(guard.isSynthetic()).toBe(false); // grace elapsed
  });

  it('nested enter/leave stays synthetic until depth returns to zero', () => {
    let now = 0;
    const guard = new SynthGuard(10, () => now);
    guard.enter();
    guard.enter();
    guard.leave();
    expect(guard.isSynthetic()).toBe(true); // depth still 1
    guard.leave();
    now += 100;
    expect(guard.isSynthetic()).toBe(false);
  });

  it('GuardedSynth marks the guard for the whole injection', async () => {
    const guard = new SynthGuard(0); // no grace -> isolates the in-call window
    const inner = new FakeSynth(guard);
    const synth = new GuardedSynth(inner, guard);

    await synth.tapCombo(combo);
    await synth.holdDown(combo);
    await synth.holdUp(combo);

    expect(inner.syntheticDuring).toEqual([true, true, true]);
    expect(guard.isSynthetic()).toBe(false); // settled afterwards
  });
});
