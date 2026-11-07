import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../src/orchestrator';
import { releaseBeforeQuit } from '../src/quit-release';
import { DiscordMuter, HushConfig } from '../src/types';
import { DEFAULT_CONFIG } from '../src/config';

// A muter whose unmute only lands when the test says so — models the RPC
// round-trip that the app used to abandon by exiting first.
class SlowMuter implements DiscordMuter {
  readonly calls: string[] = [];
  private pending: (() => void) | null = null;
  async setMute(on: boolean): Promise<void> {
    if (on) { this.calls.push('mute:true'); return; }
    await new Promise<void>((resolve) => { this.pending = resolve; });
    this.calls.push('mute:false');
  }
  land(): void { this.pending?.(); }
  get unmuteInFlight(): boolean { return this.pending !== null; }
}

// Auto mode with a manual clock, latched hands-free by a double-tap.
async function latchedHandsFree(muter: DiscordMuter) {
  let t = 0;
  const deps = {
    now: () => t,
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  };
  const cfg: HushConfig = { ...DEFAULT_CONFIG, mode: 'auto', unmuteDelayMs: 0 };
  const o = new Orchestrator(muter, cfg, undefined, undefined, deps);
  await o.onPress(); t += 60; await o.onRelease();
  t += 100; await o.onPress(); t += 60; await o.onRelease();
  await o.whenIdle();
  return o;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('releaseBeforeQuit', () => {
  it('waits for the unmute to land before letting the app quit (hands-free latched)', async () => {
    const muter = new SlowMuter();
    const o = await latchedHandsFree(muter);
    expect(o.isActive()).toBe(true);

    let done = false;
    const p = releaseBeforeQuit(o, 5000).then((waited) => { done = true; return waited; });
    await flush();
    expect(muter.unmuteInFlight).toBe(true);
    expect(done).toBe(false); // still waiting on Discord — must not quit yet

    muter.land();
    expect(await p).toBe(true);
    expect(muter.calls).toEqual(['mute:true', 'mute:false']);
  });

  it('does not wait when nothing is muted', async () => {
    const muter = new SlowMuter();
    const o = new Orchestrator(muter, { ...DEFAULT_CONFIG, mode: 'hold', unmuteDelayMs: 0 });
    expect(await releaseBeforeQuit(o)).toBe(false);
    expect(await releaseBeforeQuit(null)).toBe(false);
    expect(muter.calls).toEqual([]);
  });

  it('gives up after the timeout so a hung Discord can never block quitting', async () => {
    const muter = new SlowMuter(); // never lands
    const o = await latchedHandsFree(muter);
    let slept = 0;
    const waited = await releaseBeforeQuit(o, 2000, async (ms) => { slept = ms; });
    expect(waited).toBe(true);
    expect(slept).toBe(2000);
  });
});
