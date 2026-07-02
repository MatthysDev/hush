import { ExpResult } from './types';

// Experiment A — the "correct" path: talk to Discord's local IPC socket and set
// the mute state directly via SET_VOICE_SETTINGS. No synthesized keystroke at
// all, so the whole "Discord ignores injected keys" problem disappears.
//
// Caveat: SET_VOICE_SETTINGS needs the `rpc.voice.write` OAuth scope, which
// Discord gates behind app whitelisting. If your app isn't approved, AUTHORIZE
// returns an error — the log will say so plainly.

interface RpcClient {
  login(options: {
    clientId: string;
    clientSecret: string;
    scopes: string[];
    redirectUri: string;
  }): Promise<unknown>;
  setVoiceSettings(settings: { mute?: boolean; deaf?: boolean }): Promise<unknown>;
  getVoiceSettings(): Promise<{ mute?: boolean; deaf?: boolean }>;
  destroy(): Promise<void>;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

interface RpcModule {
  Client: new (opts: { transport: 'ipc' }) => RpcClient;
}

let client: RpcClient | null = null;

function load(): RpcModule {
  // discord-rpc ships no bundled types; require it lazily so the app still boots
  // if the dependency is missing.
  return require('discord-rpc') as RpcModule;
}

export async function connect(clientId: string, clientSecret: string): Promise<ExpResult> {
  if (!clientId || !clientSecret) {
    return { ok: false, log: 'RPC: renseigne client_id ET client_secret (portail dev Discord).' };
  }
  try {
    if (client) await client.destroy().catch(() => undefined);
    const RPC = load();
    client = new RPC.Client({ transport: 'ipc' });
    await client.login({
      clientId,
      clientSecret,
      scopes: ['rpc', 'rpc.voice.write'],
      redirectUri: 'http://localhost',
    });
    const vs = await client.getVoiceSettings().catch(() => ({} as { mute?: boolean }));
    return {
      ok: true,
      log: `RPC: connecté ✓ (mute actuel = ${vs.mute === undefined ? '?' : vs.mute}). Tu peux Mute/Unmute.`,
    };
  } catch (err) {
    client = null;
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /scope|unauthorized|invalid|forbidden/i.test(msg)
      ? ' → probablement le scope rpc.voice.write non whitelisté par Discord.'
      : ' → Discord est-il lancé et connecté ?';
    return { ok: false, log: `RPC: échec connexion: ${msg}${hint}` };
  }
}

export async function setMute(mute: boolean): Promise<ExpResult> {
  if (!client) return { ok: false, log: 'RPC: pas connecté — clique “Connecter” d’abord.' };
  try {
    await client.setVoiceSettings({ mute });
    return { ok: true, log: `RPC: setVoiceSettings({ mute: ${mute} }) ✓ — regarde l’icône micro de Discord.` };
  } catch (err) {
    return { ok: false, log: `RPC: setVoiceSettings a échoué: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function disconnect(): Promise<ExpResult> {
  if (!client) return { ok: true, log: 'RPC: déjà déconnecté.' };
  try {
    await client.destroy();
  } catch {
    /* noop */
  }
  client = null;
  return { ok: true, log: 'RPC: déconnecté.' };
}
