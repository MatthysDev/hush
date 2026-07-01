import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../src/orchestrator';
import { Combo, HushConfig, SynthEngine } from '../src/types';

class FakeSynth implements SynthEngine {
  calls: string[] = [];
  async tapCombo(c: Combo) { this.calls.push(`tap:${c.key}`); }
  async holdDown(c: Combo) { this.calls.push(`down:${c.key}`); }
  async holdUp(c: Combo) { this.calls.push(`up:${c.key}`); }
}

const cfg = (over: Partial<HushConfig> = {}): HushConfig => ({
  trigger: { mods: [], key: 'F13' },
  discordCombo: { mods: ['ctrl', 'alt', 'cmd'], key: '1' },
  wisprCombo: { mods: ['ctrl', 'alt', 'cmd'], key: '2' },
  mode: 'hold',
  unmuteDelayMs: 0,
  muteDictateGapMs: 0,
  ...over,
});

describe('Orchestrator hold mode', () => {
  it('press mutes Discord then starts Wispr; release stops Wispr then unmutes', async () => {
    const s = new FakeSynth();
    const o = new Orchestrator(s, cfg());
    await o.onPress();
    await o.onRelease();
    expect(s.calls).toEqual(['tap:1', 'down:2', 'up:2', 'tap:1']);
  });
  it('ignores a duplicated press while active (no double mute)', async () => {
    const s = new FakeSynth();
    const o = new Orchestrator(s, cfg());
    await o.onPress();
    await o.onPress();
    expect(s.calls).toEqual(['tap:1', 'down:2']);
  });
});

describe('Orchestrator mute→dictate gap', () => {
  it('sleeps for muteDictateGapMs between muting Discord and starting Wispr', async () => {
    const s = new FakeSynth();
    const o = new Orchestrator(s, cfg({ muteDictateGapMs: 25 }), undefined, async (ms) => {
      s.calls.push(`sleep:${ms}`);
    });
    await o.onPress();
    expect(s.calls).toEqual(['tap:1', 'sleep:25', 'down:2']);
  });
  it('skips the gap when muteDictateGapMs is 0', async () => {
    const s = new FakeSynth();
    const o = new Orchestrator(s, cfg({ muteDictateGapMs: 0 }), undefined, async (ms) => {
      s.calls.push(`sleep:${ms}`);
    });
    await o.onPress();
    expect(s.calls).toEqual(['tap:1', 'down:2']);
  });
});

describe('Orchestrator toggle mode', () => {
  it('first press activates, release is ignored, second press deactivates', async () => {
    const s = new FakeSynth();
    const o = new Orchestrator(s, cfg({ mode: 'toggle' }));
    await o.onPress();
    await o.onRelease();
    await o.onPress();
    expect(s.calls).toEqual(['tap:1', 'down:2', 'up:2', 'tap:1']);
  });
});

describe('Orchestrator forceRelease (watchdog)', () => {
  it('deactivates when active so we never stay muted', async () => {
    const s = new FakeSynth();
    const o = new Orchestrator(s, cfg());
    await o.onPress();
    await o.forceRelease();
    expect(o.isActive()).toBe(false);
    expect(s.calls).toEqual(['tap:1', 'down:2', 'up:2', 'tap:1']);
  });
  it('is a no-op when idle', async () => {
    const s = new FakeSynth();
    const o = new Orchestrator(s, cfg());
    await o.forceRelease();
    expect(s.calls).toEqual([]);
  });
});

// A fake that records modifiers too, so we can assert the physical-modifier
// masking (synthetic release of the held trigger mods before each injection).
class ModSynth implements SynthEngine {
  calls: string[] = [];
  private label(c: Combo) {
    return (c.mods.join('+') || '∅') + (c.key ? `:${c.key}` : '');
  }
  async tapCombo(c: Combo) { this.calls.push(`tap:${this.label(c)}`); }
  async holdDown(c: Combo) { this.calls.push(`down:${this.label(c)}`); }
  async holdUp(c: Combo) { this.calls.push(`up:${this.label(c)}`); }
}

describe('Orchestrator physical-modifier masking', () => {
  // A modifier-only HOLD trigger (e.g. ⌃⌥⇧) shares modifiers with the injected
  // combos. While the user physically holds ⌃⌥⇧, every synthesized chord arrives
  // polluted (Discord would see ⌃⌥⇧⌘X instead of ⌘⌥X) and never matches. The fix:
  // synth-release the held trigger modifiers before injecting, so Discord/Wispr
  // get clean chords.
  const masked = (over: Partial<HushConfig> = {}): HushConfig => cfg({
    trigger: { mods: ['ctrl', 'alt', 'shift'], key: '' },
    discordCombo: { mods: ['alt', 'cmd'], key: 'X' },
    wisprCombo: { mods: ['ctrl', 'alt'], key: 'Z' },
    ...over,
  });

  it('releases the held trigger modifiers before muting on activate', async () => {
    const s = new ModSynth();
    const o = new Orchestrator(s, masked());
    await o.onPress();
    expect(s.calls).toEqual([
      'up:ctrl+alt+shift', // mask the physically-held trigger modifiers
      'tap:alt+cmd:X',     // clean Discord mute
      'down:ctrl+alt:Z',   // clean Wispr dictation
    ]);
  });

  it('masks again before unmuting on release (covers toggle re-press)', async () => {
    const s = new ModSynth();
    const o = new Orchestrator(s, masked());
    await o.onPress();
    s.calls = [];
    await o.onRelease();
    expect(s.calls).toEqual([
      'up:ctrl+alt+shift', // mask once more — modifiers may still be held
      'up:ctrl+alt:Z',     // stop Wispr
      'tap:alt+cmd:X',     // clean Discord unmute
    ]);
  });

  it('does not mask when the trigger has no modifiers (e.g. F13)', async () => {
    const s = new ModSynth();
    const o = new Orchestrator(s, masked({ trigger: { mods: [], key: 'F13' } }));
    await o.onPress();
    expect(s.calls).toEqual(['tap:alt+cmd:X', 'down:ctrl+alt:Z']);
  });
});

describe('Orchestrator onActiveChange', () => {
  it('notifies on activate and deactivate', async () => {
    const s = new FakeSynth();
    const seen: boolean[] = [];
    const o = new Orchestrator(s, cfg(), (a) => seen.push(a));
    await o.onPress();
    await o.onRelease();
    expect(seen).toEqual([true, false]);
  });
});
