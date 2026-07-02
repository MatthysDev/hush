import { runSwiftHelper } from './swift-runner';
import { ExpResult } from './types';

// Experiment C — press Discord's mute button through the Accessibility tree.
export async function toggleMute(): Promise<ExpResult> {
  const res = await runSwiftHelper('hush-ax', []);
  const out = (res.stdout + res.stderr).trim();
  return { ok: res.ok, log: `AX: ${out || (res.ok ? 'ok' : `code ${res.code}`)}` };
}

// List the mute-like buttons found in Discord's AX tree — to debug labels when
// toggle can't find the button.
export async function dumpButtons(): Promise<ExpResult> {
  const res = await runSwiftHelper('hush-ax', ['--dump']);
  const out = (res.stdout + res.stderr).trim();
  return { ok: res.ok, log: out || `AX dump: code ${res.code}` };
}
