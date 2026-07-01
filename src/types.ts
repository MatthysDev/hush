export type Mod = 'ctrl' | 'alt' | 'cmd' | 'shift';
export type Combo = { mods: Mod[]; key: string };
export type Mode = 'hold' | 'toggle';

export interface SynthEngine {
  tapCombo(combo: Combo): Promise<void>;
  holdDown(combo: Combo): Promise<void>;
  holdUp(combo: Combo): Promise<void>;
}

export interface InputEngine {
  start(): void;
  stop(): void;
  onPress(cb: () => void): void;
  onRelease(cb: () => void): void;
}

export interface HushConfig {
  trigger: Combo;
  discordCombo: Combo;
  wisprCombo: Combo;
  mode: Mode;
  // Gap after muting Discord before starting Wispr dictation. Sequencing the two
  // global hotkeys (rather than firing them in the same instant) stops the OS
  // from coalescing them and dropping one — the "only the last app reacts" bug.
  muteDictateGapMs: number;
  unmuteDelayMs: number;
}
