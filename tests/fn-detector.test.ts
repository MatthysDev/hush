import { describe, it, expect } from 'vitest';
import { FnDetector, CONFIRM_POLLS } from '../src/fn-detector';

// uiohook keycodes for Fn-region keys — each of these ALSO sets the macOS Fn flag
// and leaves it lingering after release.
const LEFT = 57419; // ← arrow
const UP = 57416;
const DELETE = 57427; // forward delete (⌦)

// No modifiers in these tests, so the classifier is a constant false.
function harness() {
  const events: string[] = [];
  const d = new FnDetector(
    () => events.push('press'),
    () => events.push('release'),
    () => false,
  );
  return { d, events };
}

// Confirm a real press: needs an armed baseline then CONFIRM_POLLS high polls.
function confirmPolls(d: FnDetector) {
  for (let i = 0; i < CONFIRM_POLLS; i++) d.poll(true);
}

describe('FnDetector — genuine Fn / Globe key', () => {
  it('presses on a clean rising edge from idle, releases when the flag clears', () => {
    const { d, events } = harness();
    d.poll(false); // idle baseline → armed
    confirmPolls(d); // flag rises with no key down → real press
    expect(events).toEqual(['press']);
    d.poll(false); // flag clears → release
    expect(events).toEqual(['press', 'release']);
  });

  it('does not fire before the confirm window is met', () => {
    const { d, events } = harness();
    d.poll(false);
    for (let i = 0; i < CONFIRM_POLLS - 1; i++) d.poll(true);
    expect(events).toEqual([]); // still one poll short
  });
});

describe('FnDetector — Fn-region keys must NOT trigger (the bug)', () => {
  it('ignores the flag lingering after an arrow release', () => {
    const { d, events } = harness();
    d.poll(false); // idle → armed
    d.keyDown(LEFT); // ← pressed: flag goes high because it is a Fn-region key
    d.poll(true); // key down → disarm
    d.keyUp(LEFT); // ← released, but the Fn flag LINGERS high
    // Several polls while the flag decays, key already up. Old code muted here.
    d.poll(true);
    d.poll(true);
    d.poll(true);
    expect(events).toEqual([]); // no false press
  });

  it('ignores the flag lingering after a Delete release', () => {
    const { d, events } = harness();
    d.poll(false);
    d.keyDown(DELETE);
    d.poll(true);
    d.keyUp(DELETE);
    d.poll(true);
    d.poll(true);
    expect(events).toEqual([]);
  });

  it('stays silent through rapid arrow mashing', () => {
    const { d, events } = harness();
    d.poll(false);
    for (const k of [LEFT, UP, LEFT, DELETE, UP, LEFT]) {
      d.keyDown(k);
      d.poll(true);
      d.keyUp(k);
      d.poll(true); // lingering flag between keys
    }
    expect(events).toEqual([]);
  });

  it('re-arms after the lingering flag decays, so a real Fn press still works', () => {
    const { d, events } = harness();
    d.poll(false);
    d.keyDown(LEFT);
    d.poll(true);
    d.keyUp(LEFT);
    d.poll(true); // lingering — ignored
    expect(events).toEqual([]);
    d.poll(false); // flag finally decays → re-armed
    confirmPolls(d); // now a genuine Fn press
    expect(events).toEqual(['press']);
  });

  it('a real Fn hold that spans arrow taps stays muted (no spurious release)', () => {
    const { d, events } = harness();
    d.poll(false);
    confirmPolls(d); // Fn held (real press)
    expect(events).toEqual(['press']);
    // While Fn is held the flag stays high even as an arrow is tapped.
    d.keyDown(LEFT);
    d.poll(true);
    d.keyUp(LEFT);
    d.poll(true);
    expect(events).toEqual(['press']); // still just the one press, no release
    d.poll(false); // Fn released
    expect(events).toEqual(['press', 'release']);
  });
});

describe('FnDetector — reset', () => {
  it('clears all state', () => {
    const { d, events } = harness();
    d.poll(false);
    confirmPolls(d);
    d.reset();
    expect(events).toEqual(['press']); // reset does not emit
    // After reset, a fresh baseline + rising edge works again.
    d.poll(false);
    confirmPolls(d);
    expect(events).toEqual(['press', 'press']);
  });
});
