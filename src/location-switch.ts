// Where the dictation machine sends its mute: this machine's Discord ('local')
// or a Discord running on another machine we control ('controller').
export type LocationTarget = 'local' | 'controller';

export type SwitchDecision =
  | { role: 'local' | 'controller' }
  | { needsConfig: true };

// Decide what a fast location switch should do.
//  - 'local' is always applicable (mute the Discord on this machine).
//  - 'controller' only applies when a usable remote config (host + pairing code)
//    is already stored; otherwise the window must be opened to enter it.
export function resolveLocationSwitch(
  target: LocationTarget,
  hasRemoteConfig: boolean,
): SwitchDecision {
  if (target === 'local') return { role: 'local' };
  return hasRemoteConfig ? { role: 'controller' } : { needsConfig: true };
}
