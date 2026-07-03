import { describe, it, expect } from 'vitest';
import { resolveLocationSwitch } from '../src/location-switch';

describe('resolveLocationSwitch', () => {
  it('always allows switching to local, with or without a remote config', () => {
    expect(resolveLocationSwitch('local', false)).toEqual({ role: 'local' });
    expect(resolveLocationSwitch('local', true)).toEqual({ role: 'local' });
  });
  it('allows switching to controller when a remote config already exists', () => {
    expect(resolveLocationSwitch('controller', true)).toEqual({ role: 'controller' });
  });
  it('asks to configure when switching to controller with no remote config', () => {
    expect(resolveLocationSwitch('controller', false)).toEqual({ needsConfig: true });
  });
});
