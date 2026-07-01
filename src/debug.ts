import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Opt-in runtime tracing. Off by default. Enable EITHER with HUSH_DEBUG=1 (when
// you launch from a terminal) OR by creating the marker file `~/.hush-debug`
// (works for the installed menu-bar app, which is launched from Finder and has
// no env vars). Used to diagnose the modifier-only feedback loop.
const MARKER = path.join(os.homedir(), '.hush-debug');
function markerExists(): boolean {
  try { return fs.existsSync(MARKER); } catch { return false; }
}

export const DEBUG =
  process.env.HUSH_DEBUG === '1' ||
  process.env.HUSH_DEBUG === 'true' ||
  markerExists();

// A menu-bar app has no terminal, so logs also go to a file you can `tail -f`.
export const LOG_FILE = path.join(os.homedir(), 'Library', 'Logs', 'Hush', 'hush-debug.log');

let logReady = false;
function ensureLog(): void {
  if (logReady) return;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // Truncate at session start so each launch gives a clean repro.
    fs.writeFileSync(LOG_FILE, `=== hush debug session ${new Date().toISOString()} ===\n`);
    logReady = true;
  } catch { /* fall back to console only */ }
}

// Monotonic ms since process start — lets the timeline show the gap between a
// synth injection and when uiohook re-observes it (the >60ms grace overrun that
// lets self-generated events leak back into the detector).
const START = typeof performance !== 'undefined' ? performance.now() : 0;
function stamp(): string {
  const rel = (typeof performance !== 'undefined' ? performance.now() : 0) - START;
  const wall = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  return `${wall} +${rel.toFixed(1)}ms`;
}

function fmt(a: unknown): string {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

export function dbg(...args: unknown[]): void {
  if (!DEBUG) return;
  const line = `[hush] ${stamp()} ${args.map(fmt).join(' ')}`;
  console.error(line);
  ensureLog();
  if (logReady) {
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* noop */ }
  }
}
