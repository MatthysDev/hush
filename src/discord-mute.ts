import { DiscordMuter } from './types';
import { dbg } from './debug';

// Real-flow Discord muting over the local RPC/IPC socket — the approach that
// actually works, unlike synthesizing Discord's mute hotkey (Discord ignores
// session-level CGEvents). Talks to Discord via `SET_VOICE_SETTINGS { mute }`.
//
// Best-effort by design: if Discord is closed or the RPC never connected,
// setMute is a logged no-op so dictation (Wispr) still proceeds.

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

export type RpcState = 'disconnected' | 'connecting' | 'connected';

export class DiscordRpcMuter implements DiscordMuter {
  private client: RpcClient | null = null;
  private state: RpcState = 'disconnected';
  private lastError: string | null = null;

  // discord-rpc ships no bundled types and pulls a native transport; require it
  // lazily so the app still boots if the dependency is somehow missing.
  private load(): RpcModule {
    return require('discord-rpc') as RpcModule;
  }

  getState(): RpcState {
    return this.state;
  }

  getError(): string | null {
    return this.lastError;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  // Connect (or reconnect) with the given credentials. Never throws — connection
  // failures are captured in state/error so the caller can surface them without
  // breaking the dictation flow.
  async connect(clientId: string, clientSecret: string): Promise<boolean> {
    if (!clientId || !clientSecret) {
      this.state = 'disconnected';
      this.lastError = 'client_id / client_secret manquants';
      return false;
    }
    this.state = 'connecting';
    this.lastError = null;
    try {
      await this.disconnect();
      const RPC = this.load();
      const client = new RPC.Client({ transport: 'ipc' });
      await client.login({
        clientId,
        clientSecret,
        scopes: ['rpc', 'rpc.voice.write'],
        redirectUri: 'http://localhost',
      });
      this.client = client;
      this.state = 'connected';
      dbg('rpc: connected');
      return true;
    } catch (err) {
      this.client = null;
      this.state = 'disconnected';
      this.lastError = err instanceof Error ? err.message : String(err);
      dbg('rpc: connect failed', this.lastError);
      return false;
    }
  }

  async setMute(on: boolean): Promise<void> {
    if (!this.client || this.state !== 'connected') {
      dbg('rpc: setMute skipped (not connected)', { on });
      return;
    }
    try {
      await this.client.setVoiceSettings({ mute: on });
      dbg('rpc: setMute', { on });
    } catch (err) {
      // A dropped socket (Discord quit mid-session) lands here — degrade to
      // disconnected so the next launch/attempt reconnects instead of throwing.
      this.state = 'disconnected';
      this.lastError = err instanceof Error ? err.message : String(err);
      dbg('rpc: setMute failed', this.lastError);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.destroy(); } catch { /* noop */ }
    }
    this.client = null;
    if (this.state === 'connected') this.state = 'disconnected';
  }
}
