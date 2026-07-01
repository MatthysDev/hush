import { describe, it, expect } from 'vitest';
import { TriggerDetector } from '../src/input-engine';
import { Combo } from '../src/types';

type Edge = 'press' | 'release';

function detectorFor(trigger: Combo) {
  const edges: Edge[] = [];
  const d = new TriggerDetector(trigger);
  d.onPress(() => edges.push('press'));
  d.onRelease(() => edges.push('release'));
  return { d, edges };
}

describe('TriggerDetector — modifier-only trigger', () => {
  const trigger: Combo = { mods: ['ctrl', 'alt'], key: '' };

  it('latches once on the full modifier set and releases when one lifts', () => {
    const { d, edges } = detectorFor(trigger);
    d.modDown('ctrl');
    d.modDown('alt');   // full set -> press
    d.modUp('ctrl');    // broken    -> release
    d.modUp('alt');
    expect(edges).toEqual(['press', 'release']);
  });

  it('REPRO: feeding the synthesized cmd back in flaps the latch (the bug)', () => {
    const { d, edges } = detectorFor(trigger);
    d.modDown('ctrl');
    d.modDown('alt');   // press
    // Simulate the global hook re-observing Hush's own ⌃⌥⌘ injection:
    d.modDown('cmd');   // set is now {ctrl,alt,cmd} != {ctrl,alt} -> release
    d.modUp('cmd');     // back to {ctrl,alt}                      -> press
    d.modDown('cmd');   // -> release
    d.modUp('cmd');     // -> press
    // Without filtering, every injection toggles -> coupe / pas coupe / coupe...
    expect(edges).toEqual(['press', 'release', 'press', 'release', 'press']);
  });

  it('FIX: dropping the synthetic events (as the adapter does) keeps it stable', () => {
    const { d, edges } = detectorFor(trigger);
    d.modDown('ctrl');
    d.modDown('alt');   // press
    // The adapter calls guard.isSynthetic() and returns early, so the cmd
    // up/down bursts never reach the detector at all -> no toggling.
    d.modUp('alt');     // user lifts a key -> release
    expect(edges).toEqual(['press', 'release']);
  });
});

describe('TriggerDetector — key trigger', () => {
  const trigger: Combo = { mods: ['ctrl', 'alt', 'cmd'], key: 'D' };

  it('fires on the key with the exact modifiers held, ignores auto-repeat', () => {
    const { d, edges } = detectorFor(trigger);
    d.modDown('ctrl');
    d.modDown('alt');
    d.modDown('cmd');
    d.keyDown('D'); // press
    d.keyDown('D'); // OS auto-repeat -> ignored
    d.keyUp('D');   // release
    expect(edges).toEqual(['press', 'release']);
  });

  it('does not fire without the full modifier set', () => {
    const { d, edges } = detectorFor(trigger);
    d.modDown('ctrl');
    d.keyDown('D'); // missing alt+cmd -> nothing
    expect(edges).toEqual([]);
  });

  it('is unaffected by other keys (e.g. the held Wispr digit)', () => {
    const { d, edges } = detectorFor(trigger);
    d.modDown('ctrl');
    d.modDown('alt');
    d.modDown('cmd');
    d.keyDown('D'); // press
    d.keyDown('2'); // unrelated key -> ignored
    d.keyUp('2');
    d.keyUp('D');   // release
    expect(edges).toEqual(['press', 'release']);
  });
});
