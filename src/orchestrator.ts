import { HushConfig, SynthEngine } from './types';
import { dbg } from './debug';

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Orchestrator {
  private active = false;

  constructor(
    private readonly synth: SynthEngine,
    private readonly cfg: HushConfig,
    private readonly onActiveChange?: (active: boolean) => void,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  async onPress(): Promise<void> {
    if (this.cfg.mode === 'hold') return this.activate();
    return this.active ? this.deactivate() : this.activate();
  }

  async onRelease(): Promise<void> {
    if (this.cfg.mode === 'hold') return this.deactivate();
  }

  async forceRelease(): Promise<void> {
    if (this.active) return this.deactivate();
  }

  isActive(): boolean {
    return this.active;
  }

  private setActive(value: boolean): void {
    this.active = value;
    this.onActiveChange?.(value);
  }

  // A trigger that carries modifiers (e.g. the modifier-only ⌃⌥⇧, or ⌃⌥D) is
  // physically held while we inject. Those held modifiers leak into every
  // synthesized chord — Discord would see ⌃⌥⇧⌘X instead of ⌘⌥X and never match,
  // and the focused app gets stray accords (the "ça ferme mes fenêtres" bug).
  // Synth-releasing the trigger modifiers first neutralizes them at the OS level
  // (the physical key stays down but won't re-emit until released), so the combos
  // we inject land clean. No-op when the trigger has no modifiers (e.g. F13).
  private async maskTriggerMods(): Promise<void> {
    if (this.cfg.trigger.mods.length === 0) return;
    await this.synth.holdUp({ mods: this.cfg.trigger.mods, key: '' });
  }

  private async activate(): Promise<void> {
    if (this.active) return;
    dbg('orchestrator: activate (mute + dictate)');
    this.setActive(true);
    await this.maskTriggerMods();                     // clear held trigger modifiers
    await this.synth.tapCombo(this.cfg.discordCombo); // mute Discord
    // Let Discord's hotkey land before firing Wispr's — sequencing avoids the OS
    // coalescing two simultaneous global shortcuts and dropping the mute.
    if (this.cfg.muteDictateGapMs > 0) await this.sleep(this.cfg.muteDictateGapMs);
    await this.synth.holdDown(this.cfg.wisprCombo);   // start Wispr dictation
  }

  private async deactivate(): Promise<void> {
    if (!this.active) return;
    dbg('orchestrator: deactivate (stop dictate + unmute)');
    this.setActive(false);
    await this.maskTriggerMods();                     // toggle re-press: clear them again
    await this.synth.holdUp(this.cfg.wisprCombo);     // stop Wispr dictation
    if (this.cfg.unmuteDelayMs > 0) await this.sleep(this.cfg.unmuteDelayMs);
    await this.synth.tapCombo(this.cfg.discordCombo); // unmute Discord
  }
}
