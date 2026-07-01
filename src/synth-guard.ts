import { Combo, SynthEngine } from './types';
import { comboLabel } from './combo';
import { dbg } from './debug';

// uIOhook is a GLOBAL hook: it observes the very keystrokes Hush injects via
// nut-js. For a modifier-only trigger that is fatal — synthesizing the Discord
// combo (e.g. ⌃⌥⌘1) momentarily adds `cmd` to the live modifier set, which the
// trigger detector reads as "the trigger changed" and flaps mute on/off forever.
//
// SynthGuard marks the window during which we are injecting keys so the input
// engine can drop those self-generated events. `depth` covers the awaited synth
// calls; the small grace window absorbs the delivery lag between nut-js posting
// a CGEvent and uIOhook observing it back.
export class SynthGuard {
  private depth = 0;
  private lastEndAt = -Infinity;

  constructor(
    private readonly graceMs = 60,
    private readonly now: () => number = () => Date.now(),
  ) {}

  enter(): void {
    this.depth += 1;
    dbg('guard: enter -> depth', this.depth);
  }

  leave(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.lastEndAt = this.now();
    dbg('guard: leave -> depth', this.depth);
  }

  // True if a just-observed key event is (almost certainly) one we synthesized.
  isSynthetic(): boolean {
    return this.depth > 0 || this.now() - this.lastEndAt < this.graceMs;
  }

  // TEMP DEBUG: state at the moment the hook classifies an event. `sinceEndMs`
  // is how long ago the last injection window closed — if a leaked event shows
  // depth=0 and sinceEndMs > graceMs (60), the guard let it through.
  snapshot(): { depth: number; sinceEndMs: number } {
    return { depth: this.depth, sinceEndMs: this.now() - this.lastEndAt };
  }
}

// Decorates any SynthEngine so every injection brackets the guard. The
// orchestrator stays unaware of the guard — it just talks to a SynthEngine.
export class GuardedSynth implements SynthEngine {
  constructor(
    private readonly inner: SynthEngine,
    private readonly guard: SynthGuard,
  ) {}

  async tapCombo(combo: Combo): Promise<void> {
    dbg('synth: tapCombo', comboLabel(combo));
    this.guard.enter();
    try {
      await this.inner.tapCombo(combo);
    } finally {
      this.guard.leave();
    }
  }

  async holdDown(combo: Combo): Promise<void> {
    dbg('synth: holdDown', comboLabel(combo));
    this.guard.enter();
    try {
      await this.inner.holdDown(combo);
    } finally {
      this.guard.leave();
    }
  }

  async holdUp(combo: Combo): Promise<void> {
    dbg('synth: holdUp', comboLabel(combo));
    this.guard.enter();
    try {
      await this.inner.holdUp(combo);
    } finally {
      this.guard.leave();
    }
  }
}
