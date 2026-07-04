import { describe, it, expect } from 'vitest';
import { hostAddr, shouldRetarget } from '../src/host-discovery';

describe('hostAddr', () => {
  it('formats host:port', () => {
    expect(hostAddr({ host: '192.168.1.20', port: 8698 })).toBe('192.168.1.20:8698');
  });
});

describe('shouldRetarget', () => {
  it('retargets when the discovered address differs from the current one', () => {
    expect(shouldRetarget('192.168.1.20:8698', '192.168.1.33:8698')).toBe(true);
  });
  it('does not retarget the same address (the muter retries it on its own)', () => {
    expect(shouldRetarget('192.168.1.20:8698', '192.168.1.20:8698')).toBe(false);
  });
  it('retargets from no current target (first discovery)', () => {
    expect(shouldRetarget('', '192.168.1.20:8698')).toBe(true);
  });
  it('ignores an empty discovered address', () => {
    expect(shouldRetarget('192.168.1.20:8698', '')).toBe(false);
  });
});
