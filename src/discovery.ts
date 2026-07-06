import { MDNS_SERVICE_TYPE } from './mute-protocol';
import { dbg } from './debug';

export type DiscoveredHost = { name: string; host: string; port: number };

// bonjour-service pulls a UDP multicast stack; load it lazily so a failure here
// degrades to "type the IP manually" instead of breaking the whole app.
function loadBonjour(): any | null {
  try {
    const mod = require('bonjour-service');
    const Ctor = mod.Bonjour ?? mod.default ?? mod;
    return new Ctor();
  } catch (err) {
    dbg('discovery: bonjour unavailable', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Host: advertise this machine as a Hush host on the LAN. Returns a stop fn.
export function advertiseHost(port: number, name: string): () => void {
  const bonjour = loadBonjour();
  if (!bonjour) return () => {};
  const service = bonjour.publish({ name, type: MDNS_SERVICE_TYPE, port });
  dbg('discovery: advertising', { name, port });
  return () => {
    try { service?.stop?.(); bonjour.destroy(); } catch { /* noop */ }
  };
}

// Controller: browse for Hush hosts. Calls onFound for each. Returns a stop fn.
export function browseHosts(onFound: (h: DiscoveredHost) => void): () => void {
  const bonjour = loadBonjour();
  if (!bonjour) return () => {};
  const browser = bonjour.find({ type: MDNS_SERVICE_TYPE }, (service: any) => {
    const host = (service.addresses ?? []).find((a: string) => a.includes('.')) // IPv4
      ?? service.host;
    if (host) onFound({ name: service.name, host, port: service.port });
  });
  return () => {
    try { browser?.stop?.(); bonjour.destroy(); } catch { /* noop */ }
  };
}
