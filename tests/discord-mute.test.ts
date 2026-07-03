import { describe, it, expect, vi } from 'vitest';
import { DiscordRpcMuter } from '../src/discord-mute';

describe('DiscordRpcMuter best-effort behaviour', () => {
  it('starts disconnected', () => {
    const m = new DiscordRpcMuter();
    expect(m.isConnected()).toBe(false);
    expect(m.getState()).toBe('disconnected');
  });

  it('refuses to connect without credentials and records why', async () => {
    const m = new DiscordRpcMuter();
    const ok = await m.connect('', '');
    expect(ok).toBe(false);
    expect(m.getState()).toBe('disconnected');
    expect(m.getError()).toMatch(/manquant/);
  });

  it('setMute is a silent no-op when not connected (dictation must still proceed)', async () => {
    const m = new DiscordRpcMuter();
    await expect(m.setMute(true)).resolves.toBeUndefined();
    await expect(m.setMute(false)).resolves.toBeUndefined();
    expect(m.isConnected()).toBe(false);
  });

  it('disconnect is safe to call when never connected', async () => {
    const m = new DiscordRpcMuter();
    await expect(m.disconnect()).resolves.toBeUndefined();
    expect(m.getState()).toBe('disconnected');
  });
});

// --- FAKE RPC client for testing the new refresh-token / drop-watchdog flow ---
// Mirrors the subset of discord-rpc's real Client API our code depends on:
// connect(clientId), request(cmd, args), authenticate(accessToken),
// setVoiceSettings(settings), destroy(), and on(event, cb) — including firing
// a 'disconnected' event when the transport drops.

class FakeRpcClient {
  calls: { name: string; args: unknown[] }[] = [];
  handlers: Record<string, (...args: unknown[]) => void> = {};
  authorizeResponse: { code: string } = { code: 'fake-code' };

  on(event: string, cb: (...args: unknown[]) => void): void {
    this.handlers[event] = cb;
  }

  fireDisconnected(): void {
    this.handlers['disconnected']?.();
  }

  async connect(clientId: string): Promise<unknown> {
    this.calls.push({ name: 'connect', args: [clientId] });
    return undefined;
  }

  async request(cmd: string, args: Record<string, unknown>): Promise<any> {
    this.calls.push({ name: 'request', args: [cmd, args] });
    if (cmd === 'AUTHORIZE') return this.authorizeResponse;
    return {};
  }

  async authenticate(accessToken: string): Promise<unknown> {
    this.calls.push({ name: 'authenticate', args: [accessToken] });
    return undefined;
  }

  async setVoiceSettings(settings: { mute?: boolean; deaf?: boolean }): Promise<unknown> {
    this.calls.push({ name: 'setVoiceSettings', args: [settings] });
    return undefined;
  }

  async destroy(): Promise<void> {
    this.calls.push({ name: 'destroy', args: [] });
  }
}

function makeFakeOauth(overrides: Partial<{
  isExpired: (expiresAt: number | undefined, nowMs: number) => boolean;
  refreshTokens: (...args: any[]) => Promise<any>;
  exchangeCode: (...args: any[]) => Promise<any>;
}> = {}) {
  return {
    isExpired: overrides.isExpired ?? vi.fn(() => true),
    refreshTokens: overrides.refreshTokens ?? vi.fn(async () => {
      throw new Error('refreshTokens should not be called');
    }),
    exchangeCode: overrides.exchangeCode ?? vi.fn(async () => {
      throw new Error('exchangeCode should not be called');
    }),
  };
}

describe('DiscordRpcMuter refresh-token login flow (fake RPC client)', () => {
  it('reuses a still-valid cached access token without any network call', async () => {
    let capturedClient: FakeRpcClient | null = null;
    const oauth = makeFakeOauth({ isExpired: vi.fn(() => false) });
    const m = new DiscordRpcMuter({
      createClient: () => {
        capturedClient = new FakeRpcClient();
        return capturedClient as any;
      },
      oauth: oauth as any,
      fetchImpl: (async () => {
        throw new Error('fetchImpl should not be called');
      }) as any,
      now: () => 1000,
    });

    const ok = await m.connect('cid', 'secret', { accessToken: 'tok', tokenExpiresAt: 999999 });

    expect(ok).toBe(true);
    expect(m.getState()).toBe('connected');
    expect(oauth.refreshTokens).not.toHaveBeenCalled();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    const client = capturedClient!;
    expect(client.calls.find((c) => c.name === 'request' && c.args[0] === 'AUTHORIZE')).toBeUndefined();
    expect(client.calls.some((c) => c.name === 'authenticate' && c.args[0] === 'tok')).toBe(true);
    expect(m.getTokens()?.accessToken).toBe('tok');
  });

  it('refreshes an expired access token via the refresh token', async () => {
    let capturedClient: FakeRpcClient | null = null;
    const oauth = makeFakeOauth({
      isExpired: vi.fn(() => true),
      refreshTokens: vi.fn(async () => ({ accessToken: 'new', refreshToken: 'r2', expiresAt: 999 })),
    });
    const m = new DiscordRpcMuter({
      createClient: () => {
        capturedClient = new FakeRpcClient();
        return capturedClient as any;
      },
      oauth: oauth as any,
      fetchImpl: (async () => {
        throw new Error('unused fetch');
      }) as any,
      now: () => 1000,
    });

    const ok = await m.connect('cid', 'secret', {
      accessToken: 'old',
      tokenExpiresAt: 1,
      refreshToken: 'r',
    });

    expect(ok).toBe(true);
    expect(oauth.refreshTokens).toHaveBeenCalledTimes(1);
    const client = capturedClient!;
    expect(client.calls.find((c) => c.name === 'request' && c.args[0] === 'AUTHORIZE')).toBeUndefined();
    expect(client.calls.some((c) => c.name === 'authenticate' && c.args[0] === 'new')).toBe(true);
    expect(m.getTokens()).toEqual({ accessToken: 'new', refreshToken: 'r2', tokenExpiresAt: 999 });
  });

  it('falls back to the AUTHORIZE popup flow when there are no tokens at all', async () => {
    let capturedClient: FakeRpcClient | null = null;
    const oauth = makeFakeOauth({
      exchangeCode: vi.fn(async (_fetch: unknown, opts: { code: string }) => ({
        accessToken: `exchanged-${opts.code}`,
        refreshToken: 'r3',
        expiresAt: 555,
      })),
    });
    const m = new DiscordRpcMuter({
      createClient: () => {
        capturedClient = new FakeRpcClient();
        return capturedClient as any;
      },
      oauth: oauth as any,
      fetchImpl: (async () => {
        throw new Error('unused fetch');
      }) as any,
      now: () => 1000,
    });

    const ok = await m.connect('cid', 'secret', {});

    expect(ok).toBe(true);
    const client = capturedClient!;
    expect(client.calls.some((c) => c.name === 'request' && c.args[0] === 'AUTHORIZE')).toBe(true);
    expect(oauth.exchangeCode).toHaveBeenCalledTimes(1);
    expect(client.calls.some((c) => c.name === 'authenticate' && c.args[0] === 'exchanged-fake-code')).toBe(true);
    expect(m.getTokens()?.accessToken).toBe('exchanged-fake-code');
  });

  it('falls back to AUTHORIZE when refreshTokens rejects', async () => {
    let capturedClient: FakeRpcClient | null = null;
    const oauth = makeFakeOauth({
      isExpired: vi.fn(() => true),
      refreshTokens: vi.fn(async () => {
        throw new Error('refresh token revoked');
      }),
      exchangeCode: vi.fn(async () => ({ accessToken: 'fromAuthorize', refreshToken: 'r4', expiresAt: 777 })),
    });
    const m = new DiscordRpcMuter({
      createClient: () => {
        capturedClient = new FakeRpcClient();
        return capturedClient as any;
      },
      oauth: oauth as any,
      fetchImpl: (async () => {
        throw new Error('unused fetch');
      }) as any,
      now: () => 1000,
    });

    const ok = await m.connect('cid', 'secret', { accessToken: 'old', tokenExpiresAt: 1, refreshToken: 'r' });

    expect(ok).toBe(true);
    expect(m.getState()).toBe('connected');
    const client = capturedClient!;
    expect(client.calls.some((c) => c.name === 'request' && c.args[0] === 'AUTHORIZE')).toBe(true);
    expect(client.calls.some((c) => c.name === 'authenticate' && c.args[0] === 'fromAuthorize')).toBe(true);
  });
});

describe('DiscordRpcMuter drop watchdog', () => {
  it('fires onDrop and flips to disconnected when the transport drops, but not after an intentional disconnect', async () => {
    let capturedClient: FakeRpcClient | null = null;
    const oauth = makeFakeOauth({ isExpired: vi.fn(() => false) });
    const m = new DiscordRpcMuter({
      createClient: () => {
        capturedClient = new FakeRpcClient();
        return capturedClient as any;
      },
      oauth: oauth as any,
      fetchImpl: (async () => {
        throw new Error('unused fetch');
      }) as any,
      now: () => 1000,
    });

    const onDrop = vi.fn();
    m.setOnDrop(onDrop);

    const ok = await m.connect('cid', 'secret', { accessToken: 'tok', tokenExpiresAt: 999999 });
    expect(ok).toBe(true);
    expect(m.getState()).toBe('connected');

    const client = capturedClient!;
    client.fireDisconnected();

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(m.getState()).toBe('disconnected');

    await m.disconnect();
    onDrop.mockClear();
    client.fireDisconnected();

    expect(onDrop).not.toHaveBeenCalled();
  });
});
