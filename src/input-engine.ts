import { uIOhook, UiohookKey } from 'uiohook-napi';
import { Combo, InputEngine, Mod } from './types';
import { normalizeMods } from './combo';
import { SynthGuard } from './synth-guard';
import { dbg } from './debug';

interface UiohookEvent {
  keycode: number;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const table = UiohookKey as Record<string, number>;

function keyToUiohook(key: string): number {
  const k = key.toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k) && table[k] !== undefined) return table[k];
  if (/^[A-Z]$/.test(k) && table[k] !== undefined) return table[k];
  if (/^[0-9]$/.test(k) && table[k] !== undefined) return table[k];
  throw new Error(`Unsupported trigger key: ${key}`);
}

// modifier keycode -> Mod
const MODIFIER_MAP: Record<number, Mod> = {};
function regMod(name: string, mod: Mod) {
  const c = table[name];
  if (typeof c === 'number') MODIFIER_MAP[c] = mod;
}
regMod('Ctrl', 'ctrl'); regMod('CtrlRight', 'ctrl');
regMod('Alt', 'alt'); regMod('AltRight', 'alt');
regMod('Meta', 'cmd'); regMod('MetaRight', 'cmd');
regMod('Shift', 'shift'); regMod('ShiftRight', 'shift');

export function uiohookModifierOf(keycode: number): Mod | null {
  return MODIFIER_MAP[keycode] ?? null;
}
export function isUiohookModifier(keycode: number): boolean {
  return keycode in MODIFIER_MAP;
}
export function isUiohookEscape(keycode: number): boolean {
  return keycode === table.Escape;
}

// Reverse map a raw uiohook keycode to our supported key string (A-Z, 0-9, F1-F24), or null.
export function uiohookKeyToKey(keycode: number): string | null {
  for (const name of Object.keys(table)) {
    if (table[name] !== keycode) continue;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(name)) return name;
    if (/^[A-Z]$/.test(name)) return name;
    if (/^[0-9]$/.test(name)) return name;
  }
  return null;
}

function sameMods(required: Mod[], pressed: Set<Mod>): boolean {
  if (required.length !== pressed.size) return false;
  return required.every((m) => pressed.has(m));
}

// Pure latch: maps abstract key/modifier events to press/release callbacks.
// No native dependency, so it is unit-testable in isolation. The adapter below
// translates raw uiohook keycodes and filters out the keystrokes Hush itself
// synthesizes (via SynthGuard).
export class TriggerDetector {
  private pressed = new Set<Mod>(); // currently-held modifiers (live, physical)
  private keyLatched = false;       // key-mode latch
  private modActive = false;        // modifier-only latch
  private pressCb: () => void = () => {};
  private releaseCb: () => void = () => {};

  private readonly reqMods: Mod[];
  private readonly modOnly: boolean;
  private readonly key: string; // uppercased; '' when modifier-only

  constructor(trigger: Combo) {
    this.reqMods = normalizeMods(trigger.mods);
    this.modOnly = !trigger.key;
    this.key = trigger.key ? trigger.key.toUpperCase() : '';
  }

  onPress(cb: () => void): void { this.pressCb = cb; }
  onRelease(cb: () => void): void { this.releaseCb = cb; }

  modDown(mod: Mod): void {
    this.pressed.add(mod);
    if (this.modOnly) this.evalModOnly();
  }

  modUp(mod: Mod): void {
    this.pressed.delete(mod);
    if (this.modOnly) this.evalModOnly();
  }

  keyDown(key: string): void {
    if (this.modOnly) return;
    if (key.toUpperCase() !== this.key) return;
    if (!sameMods(this.reqMods, this.pressed)) return;
    if (this.keyLatched) return; // ignore OS auto-repeat
    this.keyLatched = true;
    dbg('detector: press (key)', this.key);
    this.pressCb();
  }

  keyUp(key: string): void {
    if (this.modOnly) return;
    if (key.toUpperCase() !== this.key) return;
    if (!this.keyLatched) return;
    this.keyLatched = false;
    dbg('detector: release (key)', this.key);
    this.releaseCb();
  }

  reset(): void {
    this.pressed.clear();
    this.keyLatched = false;
    this.modActive = false;
  }

  private evalModOnly(): void {
    const active = this.reqMods.length > 0 && sameMods(this.reqMods, this.pressed);
    if (active && !this.modActive) {
      this.modActive = true;
      dbg('detector: press (mod-only)', [...this.pressed]);
      this.pressCb();
    } else if (!active && this.modActive) {
      this.modActive = false;
      dbg('detector: release (mod-only)', [...this.pressed]);
      this.releaseCb();
    }
  }
}

export class UiohookInputEngine implements InputEngine {
  private started = false;
  private readonly detector: TriggerDetector;

  private readonly onKeyDown: (e: UiohookEvent) => void;
  private readonly onKeyUp: (e: UiohookEvent) => void;

  constructor(trigger: Combo, private readonly guard?: SynthGuard) {
    if (trigger.key) keyToUiohook(trigger.key); // validate eagerly (throws on unsupported)
    this.detector = new TriggerDetector(trigger);

    this.onKeyDown = (e) => {
      // Drop the keystrokes we just injected — otherwise a modifier-only trigger
      // feeds back on itself and flaps mute on/off forever.
      const synthetic = this.guard?.isSynthetic() ?? false;
      this.logHook('keydown', e, synthetic);
      if (synthetic) return;
      const mod = MODIFIER_MAP[e.keycode];
      if (mod) { this.detector.modDown(mod); return; }
      const key = uiohookKeyToKey(e.keycode);
      if (key) this.detector.keyDown(key);
    };

    this.onKeyUp = (e) => {
      const synthetic = this.guard?.isSynthetic() ?? false;
      this.logHook('keyup', e, synthetic);
      if (synthetic) return;
      const mod = MODIFIER_MAP[e.keycode];
      if (mod) { this.detector.modUp(mod); return; }
      const key = uiohookKeyToKey(e.keycode);
      if (key) this.detector.keyUp(key);
    };
  }

  // TEMP DEBUG: one line per raw hook event. The smoking gun for the feedback
  // loop is a modifier/digit event with verdict PASS while depth=0 and age>60ms
  // right after a `synth:` burst — that's a self-injected key the guard failed
  // to drop, now hitting the detector and toggling mute on its own.
  private logHook(type: 'keydown' | 'keyup', e: UiohookEvent, synthetic: boolean): void {
    const mod = MODIFIER_MAP[e.keycode];
    const key = uiohookKeyToKey(e.keycode);
    const name = mod ?? key ?? `code:${e.keycode}`;
    const snap = this.guard?.snapshot();
    const age = snap ? (snap.sinceEndMs === Infinity ? '∞' : `${snap.sinceEndMs.toFixed(0)}ms`) : 'n/a';
    const depth = snap ? snap.depth : 'n/a';
    dbg(`hook: ${type} ${name}`, synthetic ? 'DROP(synthetic)' : 'PASS→detector', `depth=${depth} age=${age}`);
  }

  onPress(cb: () => void): void { this.detector.onPress(cb); }
  onRelease(cb: () => void): void { this.detector.onRelease(cb); }

  start(): void {
    if (this.started) return;
    uIOhook.on('keydown', this.onKeyDown);
    uIOhook.on('keyup', this.onKeyUp);
    uIOhook.start();
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    uIOhook.off('keydown', this.onKeyDown);
    uIOhook.off('keyup', this.onKeyUp);
    try { uIOhook.stop(); } catch { /* already stopped */ }
    this.started = false;
    this.detector.reset();
  }
}
