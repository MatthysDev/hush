import { describe, it, expect } from 'vitest';
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
