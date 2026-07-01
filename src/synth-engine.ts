import { keyboard, Key } from '@nut-tree-fork/nut-js';
import { Combo, SynthEngine } from './types';
import { comboToKeyTokens } from './synth-map';

// Token -> nut-js Key. Mods + digits explicit; letters and F-keys filled by name.
const TOKEN_TO_KEY: Record<string, number> = {
  LeftControl: Key.LeftControl,
  LeftAlt: Key.LeftAlt,
  LeftSuper: Key.LeftSuper,
  LeftShift: Key.LeftShift,
  Num0: Key.Num0, Num1: Key.Num1, Num2: Key.Num2, Num3: Key.Num3, Num4: Key.Num4,
  Num5: Key.Num5, Num6: Key.Num6, Num7: Key.Num7, Num8: Key.Num8, Num9: Key.Num9,
};
const KEY_TABLE = Key as unknown as Record<string, number>;
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') TOKEN_TO_KEY[c] = KEY_TABLE[c];
for (let i = 1; i <= 24; i++) TOKEN_TO_KEY[`F${i}`] = KEY_TABLE[`F${i}`];

function toKeys(combo: Combo): number[] {
  return comboToKeyTokens(combo).map((t) => {
    const k = TOKEN_TO_KEY[t];
    if (k === undefined) throw new Error(`No nut-js Key for token ${t}`);
    return k;
  });
}

// The two native ops the engine needs. Injectable so the press/hold/release
// sequencing is unit-testable without loading nut-js' native backend.
export interface KeyDriver {
  pressKey(...keys: number[]): Promise<unknown>;
  releaseKey(...keys: number[]): Promise<unknown>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function nutDriver(): KeyDriver {
  keyboard.config.autoDelayMs = 0; // snappy taps
  return {
    pressKey: (...keys) => keyboard.pressKey(...keys),
    releaseKey: (...keys) => keyboard.releaseKey(...keys),
  };
}

export class NutSynthEngine implements SynthEngine {
  constructor(
    private readonly driver: KeyDriver = nutDriver(),
    // Discord (and most apps with global keybinds) register on key-down only if
    // the chord stays down long enough to be observed. With autoDelayMs=0 a
    // press+release is posted back-to-back, so the key is "down" for microseconds
    // and the keybind never fires — that was the "Hush doesn't mute Discord" bug
    // (Wispr worked because holdDown keeps its chord pressed). Holding briefly
    // mirrors a human keypress and makes the synthesized mute actually land.
    private readonly tapHoldMs = 30,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  async tapCombo(combo: Combo): Promise<void> {
    const keys = toKeys(combo);
    await this.driver.pressKey(...keys);
    if (this.tapHoldMs > 0) await this.sleep(this.tapHoldMs);
    await this.driver.releaseKey(...keys);
  }

  async holdDown(combo: Combo): Promise<void> {
    await this.driver.pressKey(...toKeys(combo));
  }

  async holdUp(combo: Combo): Promise<void> {
    await this.driver.releaseKey(...toKeys(combo));
  }
}
