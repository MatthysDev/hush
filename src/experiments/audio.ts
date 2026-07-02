import { execFile } from 'child_process';
import { ExpResult } from './types';

function sh(cmd: string, args: string[], timeoutMs = 8000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || stderr) });
    });
  });
}

const VIRTUAL_HINTS = ['blackhole', 'loopback', 'vb-audio', 'vb-cable', 'soundflower', 'aggregate', 'multi-output'];

// Experiment D — the real fix needs a virtual audio device so Discord's input
// can be muted independently of the real mic Wispr listens to. We can't create
// one without third-party software, so this tab (a) detects whether such a
// device exists, and (b) offers a *degraded* test that mutes the whole system
// input (which also mutes Wispr — hence degraded).
export async function detect(): Promise<ExpResult> {
  const { ok, out } = await sh('/usr/sbin/system_profiler', ['SPAudioDataType']);
  if (!ok) return { ok: false, log: 'Audio: impossible de lister les périphériques (system_profiler).' };

  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  // Device names are the indented "Name:" headers in SPAudioDataType output.
  const names = lines
    .filter((l) => l.endsWith(':') && !l.includes('  ') && l !== 'Audio:' && l !== 'Devices:')
    .map((l) => l.slice(0, -1));
  const virtual = names.filter((n) => VIRTUAL_HINTS.some((h) => n.toLowerCase().includes(h)));

  if (virtual.length > 0) {
    return {
      ok: true,
      log:
        `Audio: device virtuel détecté ✓ → ${virtual.join(', ')}\n` +
        `Étapes: dans Discord › Voix, choisis ce device en entrée ; envoie ton vrai micro dedans ; coupe-le pendant la dictée. ` +
        `Wispr garde le vrai micro.`,
    };
  }
  return {
    ok: false,
    log:
      `Audio: aucun device virtuel installé (${names.length} périphériques vus).\n` +
      `Pour le vrai test D: installe BlackHole (brew install blackhole-2ch) ou Loopback, ` +
      `puis relance la détection. Sinon utilise le test dégradé ci-dessous.`,
  };
}

// Degraded: toggle the system input volume. Honest caveat — this mutes Wispr too.
export async function degradedInputMute(mute: boolean): Promise<ExpResult> {
  const value = mute ? '0' : '100';
  const { ok, out } = await sh('/usr/bin/osascript', ['-e', `set volume input volume ${value}`]);
  if (!ok) return { ok: false, log: `Audio (dégradé): échec (${out.trim()})` };
  return {
    ok: true,
    log:
      `Audio (dégradé): entrée système ${mute ? 'coupée' : 'rétablie'} (volume=${value}). ` +
      `⚠️ ça coupe AUSSI Wispr — c’est la limite de l’approche sans device virtuel.`,
  };
}
