// Pure decision helpers for controller-side mDNS auto-connect. The controller
// browses continuously; each discovered host is fed through shouldRetarget to
// decide whether to (re)dial it. Kept dependency-free so it is unit-testable
// without a network stack.

export function hostAddr(h: { host: string; port: number }): string {
  return `${h.host}:${h.port}`;
}

// Only (re)connect when the discovered address differs from the one we already
// target. An unchanged address needs no action — the muter's own reconnect loop
// keeps retrying it. An empty discovered address is ignored.
export function shouldRetarget(currentTarget: string, discovered: string): boolean {
  return discovered !== '' && discovered !== currentTarget;
}
