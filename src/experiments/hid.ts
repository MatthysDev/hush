import { Combo } from '../types';
import { comboLabel } from '../combo';
import { comboToMacKeycodes } from './keycodes';
import { runSwiftHelper } from './swift-runner';
import { ExpResult } from './types';

// Experiment B — send Discord's mute combo at the HID event tap (via the Swift
// helper) so it looks like real hardware, rather than the session-level CGEvent
// nut-js posts (which Discord ignores).
export async function tapCombo(combo: Combo): Promise<ExpResult> {
  let mods: number[];
  let key: number;
  try {
    ({ mods, key } = comboToMacKeycodes(combo));
  } catch (err) {
    return { ok: false, log: `HID: combo non mappable (${err instanceof Error ? err.message : String(err)})` };
  }
  const res = await runSwiftHelper('hush-hid', [mods.join(','), String(key)]);
  const out = (res.stdout + res.stderr).trim();
  return {
    ok: res.ok,
    log: `HID: envoi ${comboLabel(combo)} → ${out || (res.ok ? 'ok' : `code ${res.code}`)}`,
  };
}
