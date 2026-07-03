# Cross-machine Discord Muting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Hush mute Discord running on a *different* machine on the same LAN, by holding the dictation shortcut on the machine where you type.

**Architecture:** The same Hush app runs in one of three roles. `local` is today's behavior (Discord on this machine). `controller` detects the shortcut and sends `mute/unmute` over a LAN WebSocket to a `host`. `host` runs no shortcut listener; it receives commands and drives its local Discord RPC. The existing `DiscordMuter` interface is the seam: the orchestrator is untouched, we just plug a network-backed muter behind it on the controller and a WebSocket server in front of the RPC muter on the host.

**Tech Stack:** TypeScript, Electron 30, Node, `ws` (WebSocket, pure JS), `bonjour-service` (mDNS, pure JS, optional), vitest.

## Global Constraints

- **No new native dependencies.** Only pure-JS deps (`ws`, `bonjour-service`) — Windows/Mac builds must stay simple.
- **Zero regression on the `local` path.** Default `role` is `'local'`; existing configs migrate to it; the existing `local` wiring, orchestrator, and tests stay unchanged.
- **Fail-safe first.** The host must never leave Discord muted if the controller vanishes: on socket close, if that connection held the mute, unmute.
- **LAN-trust security.** A pairing code is mandatory in the handshake; the server binds to LAN interfaces only; no cloud, no UPnP, no WAN ports.
- **Protocol version:** `PROTOCOL_VERSION = 1`. Default port: `8698`. mDNS service type string: `hush` (advertised as `_hush._tcp`).
- **Test philosophy:** protocol + client + server logic are unit-tested against fakes (no real sockets/OS/Discord). Real `ws`/mDNS adapters and Electron wiring are verified manually.
- **Comment/copy style:** code comments in English (matching `src/`), user-facing strings in French (matching the renderer). End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- `src/types.ts` *(modify)* — add `Role`, `RemoteConfig`, `HostListenConfig`; extend `HushConfig`.
- `src/config.ts` *(modify)* — defaults + validation for the new fields.
- `src/store.ts` *(modify)* — migrate old configs to `role: 'local'` + new fields.
- `src/mute-protocol.ts` *(create)* — wire message types, `encode`/`decode`, socket seam interfaces, constants.
- `src/mute-client.ts` *(create)* — `RemoteDiscordMuter implements DiscordMuter` (controller).
- `src/mute-server.ts` *(create)* — `MuteServer` (host), relays to a `DiscordMuter`.
- `src/mute-transport.ts` *(create)* — real `ws` adapters implementing the seam interfaces.
- `src/discovery.ts` *(create)* — mDNS advertise/browse wrapper (`bonjour-service`), lazy + best-effort.
- `src/net.ts` *(create)* — small helpers: LAN IPv4 list + pairing-code generator.
- `src/main.ts` *(modify)* — role-based wiring + IPC for the new UI.
- `src/preload.ts` *(modify)* — expose the new IPC surface.
- `renderer/index.html`, `renderer/style.css`, `renderer/renderer.js` *(modify)* — role picker + host/controller screens.
- `package.json` *(modify)* — add `ws`, `bonjour-service`, `@types/ws`.
- `README.md` *(modify)* — document the dual-PC setup.
- Tests: `tests/config.test.ts` *(modify)*, `tests/mute-protocol.test.ts`, `tests/mute-client.test.ts`, `tests/mute-server.test.ts` *(create)*.

---

## Task 1: Config schema — role + remote/host fields + migration

**Files:**
- Modify: `src/types.ts:1-40`
- Modify: `src/config.ts:1-25`
- Modify: `src/store.ts:13-33`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `Role = 'local' | 'host' | 'controller'`; `RemoteConfig = { host: string; port: number; pairingCode: string }`; `HostListenConfig = { port: number; pairingCode: string }`; `HushConfig` gains `role: Role`, `remote: RemoteConfig`, `hostListen: HostListenConfig`. `DEFAULT_CONFIG.role === 'local'`.

- [ ] **Step 1: Write the failing tests** — append to `tests/config.test.ts`:

```ts
describe('role config', () => {
  it('defaults to the local role (no regression for existing users)', () => {
    expect(DEFAULT_CONFIG.role).toBe('local');
  });
  it('defaults remote/host to port 8698 with empty pairing codes', () => {
    expect(DEFAULT_CONFIG.remote).toEqual({ host: '', port: 8698, pairingCode: '' });
    expect(DEFAULT_CONFIG.hostListen).toEqual({ port: 8698, pairingCode: '' });
  });
  it('accepts a controller config with a host address and code', () => {
    expect(() => validateConfig({
      ...DEFAULT_CONFIG,
      role: 'controller',
      remote: { host: '192.168.1.20', port: 8698, pairingCode: 'ABC123' },
    })).not.toThrow();
  });
  it('rejects a controller with no host address', () => {
    expect(() => validateConfig({
      ...DEFAULT_CONFIG,
      role: 'controller',
      remote: { host: '', port: 8698, pairingCode: 'ABC123' },
    })).toThrow(/host address/);
  });
  it('rejects a host with an empty pairing code', () => {
    expect(() => validateConfig({
      ...DEFAULT_CONFIG,
      role: 'host',
      hostListen: { port: 8698, pairingCode: '' },
    })).toThrow(/pairing code/);
  });
  it('rejects an out-of-range port', () => {
    expect(() => validateConfig({
      ...DEFAULT_CONFIG,
      role: 'host',
      hostListen: { port: 70000, pairingCode: 'ABC123' },
    })).toThrow(/port/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (`DEFAULT_CONFIG.role` is undefined; `validateConfig` doesn't check the new fields).

- [ ] **Step 3: Extend the types** — in `src/types.ts`, add above `HushConfig`:

```ts
// Where Discord lives relative to this machine.
//  - 'local'      : Discord runs here — mute it directly over RPC (default).
//  - 'controller' : dictation happens here; mute a Discord on another machine.
//  - 'host'       : Discord runs here; accept mute commands from a controller.
export type Role = 'local' | 'host' | 'controller';

// Controller side: how to reach the host running Discord.
export interface RemoteConfig {
  host: string;      // LAN IP or hostname of the host machine
  port: number;      // host's listening port
  pairingCode: string;
}

// Host side: how this machine listens for a controller.
export interface HostListenConfig {
  port: number;
  pairingCode: string;
}
```

Then add three fields to the `HushConfig` interface (after `unmuteDelayMs`):

```ts
  // Cross-machine muting. 'local' keeps the original single-machine behavior.
  role: Role;
  remote: RemoteConfig;
  hostListen: HostListenConfig;
```

- [ ] **Step 4: Extend defaults + validation** — in `src/config.ts`, update the import and `DEFAULT_CONFIG`, and extend `validateConfig`:

```ts
import { HushConfig } from './types';

export const DEFAULT_PORT = 8698;

export const DEFAULT_CONFIG: HushConfig = {
  shortcut: { mods: ['ctrl', 'alt'], key: '' },
  discordRpc: { clientId: '', clientSecret: '' },
  mode: 'hold',
  unmuteDelayMs: 0,
  role: 'local',
  remote: { host: '', port: DEFAULT_PORT, pairingCode: '' },
  hostListen: { port: DEFAULT_PORT, pairingCode: '' },
};

export function validateConfig(cfg: HushConfig): void {
  if (cfg.shortcut.mods.length === 0 && !cfg.shortcut.key) {
    throw new Error('Hush config invalid: shortcut must have at least a key or a modifier');
  }
  const portOk = (p: number) => Number.isInteger(p) && p > 0 && p < 65536;
  if (cfg.role === 'controller') {
    if (!cfg.remote.host) {
      throw new Error('Hush config invalid: controller needs a host address');
    }
    if (!portOk(cfg.remote.port)) {
      throw new Error('Hush config invalid: remote port out of range');
    }
  }
  if (cfg.role === 'host') {
    if (!cfg.hostListen.pairingCode) {
      throw new Error('Hush config invalid: host needs a pairing code');
    }
    if (!portOk(cfg.hostListen.port)) {
      throw new Error('Hush config invalid: host port out of range');
    }
  }
}
```

- [ ] **Step 5: Migrate stored configs** — in `src/store.ts`, replace the `migrate` function body's return with the extended shape:

```ts
function migrate(raw: Record<string, unknown>): HushConfig {
  const shortcut = (raw.shortcut ?? raw.trigger ?? DEFAULT_CONFIG.shortcut) as Combo;
  return {
    shortcut,
    discordRpc: (raw.discordRpc as HushConfig['discordRpc']) ?? DEFAULT_CONFIG.discordRpc,
    mode: (raw.mode as HushConfig['mode']) ?? DEFAULT_CONFIG.mode,
    unmuteDelayMs: (raw.unmuteDelayMs as number) ?? DEFAULT_CONFIG.unmuteDelayMs,
    // New in the cross-machine build. Old configs predate these → default to
    // 'local', preserving the original single-machine behavior exactly.
    role: (raw.role as HushConfig['role']) ?? DEFAULT_CONFIG.role,
    remote: (raw.remote as HushConfig['remote']) ?? DEFAULT_CONFIG.remote,
    hostListen: (raw.hostListen as HushConfig['hostListen']) ?? DEFAULT_CONFIG.hostListen,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts && npx tsc --noEmit`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/config.ts src/store.ts tests/config.test.ts
git commit -m "feat(config): role + remote/host fields with local-default migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire protocol + socket seam

**Files:**
- Create: `src/mute-protocol.ts`
- Test: `tests/mute-protocol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Constants `PROTOCOL_VERSION = 1`, `DEFAULT_PORT = 8698`, `MDNS_SERVICE_TYPE = 'hush'`.
  - `WireMessage` union: `{t:'hello';v:number;code:string}` | `{t:'welcome';v:number}` | `{t:'reject';reason:string}` | `{t:'mute';on:boolean}` | `{t:'ping'}` | `{t:'pong'}`.
  - `encode(msg: WireMessage): string`, `decode(raw: string): WireMessage` (throws on malformed/unknown).
  - Seam interfaces `DuplexSocket`, `ClientSocket`, `ClientSocketFactory`, `ServerListener` (defined below; consumed by Tasks 3–5).

- [ ] **Step 1: Write the failing tests** — create `tests/mute-protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encode, decode, PROTOCOL_VERSION, WireMessage } from '../src/mute-protocol';

describe('mute-protocol encode/decode', () => {
  const roundtrip = (m: WireMessage) => decode(encode(m));

  it('round-trips every message type', () => {
    const msgs: WireMessage[] = [
      { t: 'hello', v: PROTOCOL_VERSION, code: 'ABC123' },
      { t: 'welcome', v: PROTOCOL_VERSION },
      { t: 'reject', reason: 'bad code' },
      { t: 'mute', on: true },
      { t: 'mute', on: false },
      { t: 'ping' },
      { t: 'pong' },
    ];
    for (const m of msgs) expect(roundtrip(m)).toEqual(m);
  });

  it('throws on non-JSON input', () => {
    expect(() => decode('not json')).toThrow();
  });

  it('throws on a missing or unknown type tag', () => {
    expect(() => decode(JSON.stringify({ foo: 1 }))).toThrow(/type/);
    expect(() => decode(JSON.stringify({ t: 'bogus' }))).toThrow(/type/);
  });

  it('throws when a mute frame lacks a boolean flag', () => {
    expect(() => decode(JSON.stringify({ t: 'mute' }))).toThrow(/mute/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mute-protocol.test.ts`
Expected: FAIL (`Cannot find module '../src/mute-protocol'`).

- [ ] **Step 3: Implement the protocol** — create `src/mute-protocol.ts`:

```ts
// Wire format for the LAN link between a controller (dictation machine) and a
// host (Discord machine). Deliberately tiny and versioned; JSON over WebSocket
// text frames. All network transport lives behind the seam interfaces below so
// the client/server logic can be unit-tested against fakes.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8698;
export const MDNS_SERVICE_TYPE = 'hush'; // advertised as _hush._tcp

export type WireMessage =
  | { t: 'hello'; v: number; code: string }
  | { t: 'welcome'; v: number }
  | { t: 'reject'; reason: string }
  | { t: 'mute'; on: boolean }
  | { t: 'ping' }
  | { t: 'pong' };

export function encode(msg: WireMessage): string {
  return JSON.stringify(msg);
}

export function decode(raw: string): WireMessage {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const t = obj.t;
  switch (t) {
    case 'hello':
      return { t, v: Number(obj.v), code: String(obj.code ?? '') };
    case 'welcome':
      return { t, v: Number(obj.v) };
    case 'reject':
      return { t, reason: String(obj.reason ?? '') };
    case 'mute':
      if (typeof obj.on !== 'boolean') throw new Error('mute frame missing boolean flag');
      return { t, on: obj.on };
    case 'ping':
      return { t };
    case 'pong':
      return { t };
    default:
      throw new Error(`unknown message type: ${String(t)}`);
  }
}

// ---- Transport seam ---------------------------------------------------------
// One live connection, from either side's point of view.
export interface DuplexSocket {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
}

// A controller dials out and learns when the connection opens.
export interface ClientSocket extends DuplexSocket {
  onOpen(cb: () => void): void;
}
export type ClientSocketFactory = (host: string, port: number) => ClientSocket;

// A host accepts inbound connections.
export interface ServerListener {
  onConnection(cb: (sock: DuplexSocket) => void): void;
  listen(port: number): void;
  close(): void;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mute-protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mute-protocol.ts tests/mute-protocol.test.ts
git commit -m "feat(net): mute wire protocol + transport seam interfaces

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: RemoteDiscordMuter (controller)

**Files:**
- Create: `src/mute-client.ts`
- Test: `tests/mute-client.test.ts`

**Interfaces:**
- Consumes: `DiscordMuter` (`src/types.ts`); `ClientSocket`, `ClientSocketFactory`, `encode`, `decode`, `PROTOCOL_VERSION` (`src/mute-protocol.ts`).
- Produces: `RemoteState = 'disconnected' | 'connecting' | 'connected'`; `class RemoteDiscordMuter implements DiscordMuter` with constructor `(factory: ClientSocketFactory, schedule?: (fn: () => void) => void)`; methods `connect(host: string, port: number, code: string): void`, `disconnect(): void`, `setMute(on: boolean): Promise<void>`, `getState(): RemoteState`, `getError(): string | null`, `isConnected(): boolean`.

**Design notes:** `setMute` records the *desired* state (`desiredMute`) and, if connected, sends a `mute` frame. On `welcome` the muter becomes `connected` and immediately **re-asserts `desiredMute`** (so a mid-hold reconnect restores the mute). On close, if the user still wants to be connected, it schedules a reconnect via the injected `schedule` (defaults to `setTimeout(fn, 3000)`; tests inject a capturing or immediate scheduler).

- [ ] **Step 1: Write the failing tests** — create `tests/mute-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RemoteDiscordMuter } from '../src/mute-client';
import { ClientSocket, encode, decode, PROTOCOL_VERSION } from '../src/mute-protocol';

// A controllable fake of one outbound connection.
class FakeClientSocket implements ClientSocket {
  sent: string[] = [];
  closed = false;
  private msgCb: (d: string) => void = () => {};
  private openCb: () => void = () => {};
  private closeCb: () => void = () => {};
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; this.closeCb(); }
  onMessage(cb: (d: string) => void) { this.msgCb = cb; }
  onOpen(cb: () => void) { this.openCb = cb; }
  onClose(cb: () => void) { this.closeCb = cb; }
  // test drivers:
  fireOpen() { this.openCb(); }
  fireMessage(raw: string) { this.msgCb(raw); }
  fireClose() { this.closeCb(); }
  lastMsg() { return this.sent.length ? decode(this.sent[this.sent.length - 1]) : null; }
}

function connected() {
  const sockets: FakeClientSocket[] = [];
  const factory = () => { const s = new FakeClientSocket(); sockets.push(s); return s; };
  const scheduled: Array<() => void> = [];
  const muter = new RemoteDiscordMuter(factory, (fn) => { scheduled.push(fn); });
  muter.connect('192.168.1.20', 8698, 'ABC123');
  const s = sockets[0];
  s.fireOpen();                                   // controller sends hello
  s.fireMessage(encode({ t: 'welcome', v: PROTOCOL_VERSION }));
  return { muter, sockets, scheduled, factory };
}

describe('RemoteDiscordMuter', () => {
  it('sends hello with the pairing code on open', () => {
    const { sockets } = connected();
    expect(sockets[0].sent.map((r) => decode(r))[0])
      .toEqual({ t: 'hello', v: PROTOCOL_VERSION, code: 'ABC123' });
  });

  it('becomes connected after welcome', () => {
    const { muter } = connected();
    expect(muter.isConnected()).toBe(true);
    expect(muter.getState()).toBe('connected');
  });

  it('sends a mute frame when connected', async () => {
    const { muter, sockets } = connected();
    await muter.setMute(true);
    expect(sockets[0].lastMsg()).toEqual({ t: 'mute', on: true });
    await muter.setMute(false);
    expect(sockets[0].lastMsg()).toEqual({ t: 'mute', on: false });
  });

  it('is a silent no-op when not connected (dictation must still proceed)', async () => {
    const factory = () => new FakeClientSocket();
    const muter = new RemoteDiscordMuter(factory, () => {});
    await expect(muter.setMute(true)).resolves.toBeUndefined();
    expect(muter.isConnected()).toBe(false);
  });

  it('records error and disconnects on reject', () => {
    const sockets: FakeClientSocket[] = [];
    const muter = new RemoteDiscordMuter(
      () => { const s = new FakeClientSocket(); sockets.push(s); return s; },
      () => {},
    );
    muter.connect('h', 8698, 'wrong');
    sockets[0].fireOpen();
    sockets[0].fireMessage(encode({ t: 'reject', reason: 'bad code' }));
    expect(muter.isConnected()).toBe(false);
    expect(muter.getError()).toMatch(/bad code/);
  });

  it('re-asserts the desired mute after a reconnect', async () => {
    const { muter, sockets, scheduled } = connected();
    await muter.setMute(true);                // muted, connection #0
    sockets[0].fireClose();                   // link drops → reconnect scheduled
    expect(scheduled.length).toBe(1);
    scheduled[0]();                           // run the reconnect → connection #1
    sockets[1].fireOpen();
    sockets[1].fireMessage(encode({ t: 'welcome', v: PROTOCOL_VERSION }));
    // On reconnect it re-sends the desired mute state.
    expect(sockets[1].sent.map((r) => decode(r)))
      .toContainEqual({ t: 'mute', on: true });
  });

  it('does not reconnect after an explicit disconnect', () => {
    const { muter, sockets, scheduled } = connected();
    muter.disconnect();
    expect(sockets[0].closed).toBe(true);
    expect(scheduled.length).toBe(0);
    expect(muter.isConnected()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mute-client.test.ts`
Expected: FAIL (`Cannot find module '../src/mute-client'`).

- [ ] **Step 3: Implement the client** — create `src/mute-client.ts`:

```ts
import { DiscordMuter } from './types';
import { dbg } from './debug';
import {
  ClientSocket, ClientSocketFactory, encode, decode, PROTOCOL_VERSION,
} from './mute-protocol';

export type RemoteState = 'disconnected' | 'connecting' | 'connected';

const RECONNECT_MS = 3000;

// Controller-side muter: instead of a local Discord RPC socket, it forwards the
// orchestrator's mute/unmute to a host over the LAN. Best-effort by design — when
// the host is unreachable, setMute is a logged no-op so dictation still works.
export class RemoteDiscordMuter implements DiscordMuter {
  private sock: ClientSocket | null = null;
  private state: RemoteState = 'disconnected';
  private lastError: string | null = null;
  private desiredMute = false;   // last state the orchestrator asked for
  private wanted = false;        // user wants a connection (until disconnect())
  private host = '';
  private port = 0;
  private code = '';

  constructor(
    private readonly factory: ClientSocketFactory,
    private readonly schedule: (fn: () => void) => void =
      (fn) => { setTimeout(fn, RECONNECT_MS); },
  ) {}

  getState(): RemoteState { return this.state; }
  getError(): string | null { return this.lastError; }
  isConnected(): boolean { return this.state === 'connected'; }

  connect(host: string, port: number, code: string): void {
    this.host = host; this.port = port; this.code = code;
    this.wanted = true;
    this.open();
  }

  private open(): void {
    if (!this.wanted) return;
    this.state = 'connecting';
    this.lastError = null;
    const sock = this.factory(this.host, this.port);
    this.sock = sock;

    sock.onOpen(() => {
      sock.send(encode({ t: 'hello', v: PROTOCOL_VERSION, code: this.code }));
    });
    sock.onMessage((raw) => {
      let msg;
      try { msg = decode(raw); } catch { return; }
      if (msg.t === 'welcome') {
        this.state = 'connected';
        this.lastError = null;
        dbg('remote: connected');
        // Re-assert whatever the orchestrator currently wants (mid-hold reconnect).
        sock.send(encode({ t: 'mute', on: this.desiredMute }));
      } else if (msg.t === 'reject') {
        this.lastError = msg.reason || 'rejected by host';
        dbg('remote: rejected', this.lastError);
        this.wanted = false;         // a bad code won't fix itself — stop retrying
        sock.close();
      } else if (msg.t === 'ping') {
        sock.send(encode({ t: 'pong' }));
      }
    });
    sock.onClose(() => {
      this.sock = null;
      if (this.state === 'connected') dbg('remote: link dropped');
      this.state = 'disconnected';
      if (this.wanted) this.schedule(() => this.open());
    });
  }

  async setMute(on: boolean): Promise<void> {
    this.desiredMute = on;
    if (this.state !== 'connected' || !this.sock) {
      dbg('remote: setMute skipped (not connected)', { on });
      return;
    }
    try {
      this.sock.send(encode({ t: 'mute', on }));
      dbg('remote: setMute', { on });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      dbg('remote: setMute failed', this.lastError);
    }
  }

  disconnect(): void {
    this.wanted = false;
    if (this.sock) { try { this.sock.close(); } catch { /* noop */ } }
    this.sock = null;
    this.state = 'disconnected';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mute-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mute-client.ts tests/mute-client.test.ts
git commit -m "feat(net): RemoteDiscordMuter — controller-side muter over the LAN

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: MuteServer (host)

**Files:**
- Create: `src/mute-server.ts`
- Test: `tests/mute-server.test.ts`

**Interfaces:**
- Consumes: `DiscordMuter` (`src/types.ts`); `DuplexSocket`, `ServerListener`, `encode`, `decode`, `PROTOCOL_VERSION` (`src/mute-protocol.ts`).
- Produces: `class MuteServer` with constructor `(muter: DiscordMuter, listener: ServerListener, code: string)`; methods `start(port: number): void`, `stop(): void`.

**Design notes:** A connection is unauthenticated until it sends a valid `hello` (matching `code` and `PROTOCOL_VERSION`) → server replies `welcome`; a bad code/version → `reject` then close, and the muter is never touched. `mute` frames are honored only from authed connections. The server tracks which authed connections currently hold the mute in a set; on `mute{on:false}` or on socket close it removes the connection and, when the set becomes empty, calls `muter.setMute(false)` — this is the fail-safe that guarantees the host is never stuck muted.

- [ ] **Step 1: Write the failing tests** — create `tests/mute-server.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { MuteServer } from '../src/mute-server';
import { DiscordMuter } from '../src/types';
import {
  DuplexSocket, ServerListener, encode, decode, PROTOCOL_VERSION,
} from '../src/mute-protocol';

class FakeConn implements DuplexSocket {
  sent: string[] = [];
  closed = false;
  private msgCb: (d: string) => void = () => {};
  private closeCb: () => void = () => {};
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; this.closeCb(); }
  onMessage(cb: (d: string) => void) { this.msgCb = cb; }
  onClose(cb: () => void) { this.closeCb = cb; }
  fireMessage(raw: string) { this.msgCb(raw); }
  fireClose() { this.closeCb(); }
  msgs() { return this.sent.map((r) => decode(r)); }
}

class FakeListener implements ServerListener {
  private connCb: (s: DuplexSocket) => void = () => {};
  listened = 0;
  closed = false;
  onConnection(cb: (s: DuplexSocket) => void) { this.connCb = cb; }
  listen(port: number) { this.listened = port; }
  close() { this.closed = true; }
  connect(): FakeConn { const c = new FakeConn(); this.connCb(c); return c; }
}

function setup(code = 'ABC123') {
  const muter: DiscordMuter & { calls: boolean[] } = {
    calls: [],
    setMute: vi.fn(async (on: boolean) => { (muter.calls as boolean[]).push(on); }),
  } as any;
  const listener = new FakeListener();
  const server = new MuteServer(muter, listener, code);
  server.start(8698);
  return { muter, listener, server };
}

describe('MuteServer', () => {
  it('listens on the given port', () => {
    const { listener } = setup();
    expect(listener.listened).toBe(8698);
  });

  it('welcomes a controller with the right code', () => {
    const { listener } = setup();
    const c = listener.connect();
    c.fireMessage(encode({ t: 'hello', v: PROTOCOL_VERSION, code: 'ABC123' }));
    expect(c.msgs()).toContainEqual({ t: 'welcome', v: PROTOCOL_VERSION });
  });

  it('rejects a bad code, closes, and never mutes', () => {
    const { listener, muter } = setup();
    const c = listener.connect();
    c.fireMessage(encode({ t: 'hello', v: PROTOCOL_VERSION, code: 'WRONG' }));
    expect(c.msgs().some((m) => m.t === 'reject')).toBe(true);
    expect(c.closed).toBe(true);
    expect(muter.setMute).not.toHaveBeenCalled();
  });

  it('rejects an incompatible protocol version', () => {
    const { listener } = setup();
    const c = listener.connect();
    c.fireMessage(encode({ t: 'hello', v: 999, code: 'ABC123' }));
    expect(c.msgs().some((m) => m.t === 'reject')).toBe(true);
    expect(c.closed).toBe(true);
  });

  it('relays a mute frame from an authed controller', () => {
    const { listener, muter } = setup();
    const c = listener.connect();
    c.fireMessage(encode({ t: 'hello', v: PROTOCOL_VERSION, code: 'ABC123' }));
    c.fireMessage(encode({ t: 'mute', on: true }));
    expect(muter.setMute).toHaveBeenCalledWith(true);
  });

  it('ignores mute frames before authentication', () => {
    const { listener, muter } = setup();
    const c = listener.connect();
    c.fireMessage(encode({ t: 'mute', on: true }));
    expect(muter.setMute).not.toHaveBeenCalled();
  });

  it('auto-unmutes when a muted controller disconnects (fail-safe)', () => {
    const { listener, muter } = setup();
    const c = listener.connect();
    c.fireMessage(encode({ t: 'hello', v: PROTOCOL_VERSION, code: 'ABC123' }));
    c.fireMessage(encode({ t: 'mute', on: true }));
    c.fireClose();
    expect((muter as any).calls).toEqual([true, false]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mute-server.test.ts`
Expected: FAIL (`Cannot find module '../src/mute-server'`).

- [ ] **Step 3: Implement the server** — create `src/mute-server.ts`:

```ts
import { DiscordMuter } from './types';
import { dbg } from './debug';
import {
  DuplexSocket, ServerListener, encode, decode, PROTOCOL_VERSION,
} from './mute-protocol';

// Host-side relay: accepts controller connections over the LAN and drives the
// local Discord mute. Only the DiscordMuter interface is used, so the concrete
// RPC muter is injected (and faked in tests). A connection must present the
// right pairing code before any mute is honored.
export class MuteServer {
  private authed = new Set<DuplexSocket>();
  private holdingMute = new Set<DuplexSocket>(); // authed conns currently muting

  constructor(
    private readonly muter: DiscordMuter,
    private readonly listener: ServerListener,
    private readonly code: string,
  ) {}

  start(port: number): void {
    this.listener.onConnection((sock) => this.onConnection(sock));
    this.listener.listen(port);
    dbg('mute-server: listening', { port });
  }

  stop(): void {
    try { this.listener.close(); } catch { /* noop */ }
    this.authed.clear();
    this.holdingMute.clear();
  }

  private onConnection(sock: DuplexSocket): void {
    sock.onMessage((raw) => {
      let msg;
      try { msg = decode(raw); } catch { return; }

      if (msg.t === 'hello') {
        if (msg.v !== PROTOCOL_VERSION) {
          sock.send(encode({ t: 'reject', reason: 'incompatible version' }));
          sock.close();
          return;
        }
        if (msg.code !== this.code) {
          sock.send(encode({ t: 'reject', reason: 'bad pairing code' }));
          sock.close();
          return;
        }
        this.authed.add(sock);
        sock.send(encode({ t: 'welcome', v: PROTOCOL_VERSION }));
        dbg('mute-server: controller authorized');
        return;
      }

      if (!this.authed.has(sock)) return; // ignore anything before hello

      if (msg.t === 'mute') {
        this.applyMute(sock, msg.on);
      } else if (msg.t === 'ping') {
        sock.send(encode({ t: 'pong' }));
      }
    });

    sock.onClose(() => {
      this.authed.delete(sock);
      // Fail-safe: a muted controller vanished — drop its hold and unmute if it
      // was the last one holding the mute, so Discord is never stuck muted.
      if (this.holdingMute.has(sock)) this.applyMute(sock, false);
    });
  }

  private applyMute(sock: DuplexSocket, on: boolean): void {
    const before = this.holdingMute.size;
    if (on) this.holdingMute.add(sock);
    else this.holdingMute.delete(sock);
    const after = this.holdingMute.size;
    // Only touch Discord on a real edge: first holder mutes, last release unmutes.
    if (before === 0 && after > 0) void this.muter.setMute(true);
    else if (before > 0 && after === 0) void this.muter.setMute(false);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mute-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mute-server.ts tests/mute-server.test.ts
git commit -m "feat(net): MuteServer — host-side relay with disconnect fail-safe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Real WebSocket adapters + net helpers

**Files:**
- Create: `src/mute-transport.ts`
- Create: `src/net.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `ClientSocket`, `ClientSocketFactory`, `DuplexSocket`, `ServerListener` (`src/mute-protocol.ts`).
- Produces: `wsClientFactory: ClientSocketFactory`; `class WsServerListener implements ServerListener` (constructor `()`); `lanAddresses(): string[]`; `generatePairingCode(): string`.

**Verification:** manual (real sockets/`ws`) — no unit test. Typecheck must pass.

- [ ] **Step 1: Add dependencies**

Run:
```bash
npm install ws@^8.18.0 bonjour-service@^1.3.0
npm install -D @types/ws@^8.5.0
```
Expected: `package.json` gains `ws` + `bonjour-service` under `dependencies` and `@types/ws` under `devDependencies`. (Both runtime deps are pure JS — no native rebuild.)

- [ ] **Step 2: Implement the net helpers** — create `src/net.ts`:

```ts
import * as os from 'os';
import * as crypto from 'crypto';

// Non-internal IPv4 addresses of this machine — shown on the host screen so the
// user can tell the controller where to connect.
export function lanAddresses(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

// A short, human-copyable pairing code. Base32-ish, no ambiguous chars.
export function generatePairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}
```

- [ ] **Step 3: Implement the ws adapters** — create `src/mute-transport.ts`:

```ts
import WebSocket, { WebSocketServer } from 'ws';
import { ClientSocket, ClientSocketFactory, DuplexSocket, ServerListener } from './mute-protocol';
import { dbg } from './debug';

const HEARTBEAT_MS = 5000; // ping every 5s; terminate a socket that misses a pong

// ---- Controller side: dial out to a host --------------------------------
export const wsClientFactory: ClientSocketFactory = (host, port): ClientSocket => {
  const ws = new WebSocket(`ws://${host}:${port}`);
  return {
    send: (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
    close: () => { try { ws.close(); } catch { /* noop */ } },
    onOpen: (cb) => ws.on('open', cb),
    onMessage: (cb) => ws.on('message', (d) => cb(d.toString())),
    onClose: (cb) => { ws.on('close', cb); ws.on('error', () => { /* close follows */ }); },
  };
};

// ---- Host side: accept controllers --------------------------------------
export class WsServerListener implements ServerListener {
  private wss: WebSocketServer | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private connCb: (s: DuplexSocket) => void = () => {};

  onConnection(cb: (s: DuplexSocket) => void): void { this.connCb = cb; }

  listen(port: number): void {
    // Bind on all interfaces; the LAN firewall/router blocks WAN. Pairing code
    // still gates every connection.
    const wss = new WebSocketServer({ port });
    this.wss = wss;
    wss.on('error', (err) => dbg('ws-server: error', err.message));

    // Liveness: a client that drops off the network never sends FIN, so ping and
    // terminate the ones that miss a pong — that terminate fires 'close', which
    // is what triggers the MuteServer auto-unmute fail-safe.
    const alive = new WeakMap<WebSocket, boolean>();
    wss.on('connection', (ws) => {
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      this.connCb({
        send: (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
        close: () => { try { ws.close(); } catch { /* noop */ } },
        onMessage: (cb) => ws.on('message', (d) => cb(d.toString())),
        onClose: (cb) => ws.on('close', cb),
      });
    });
    this.heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (alive.get(ws) === false) { ws.terminate(); continue; }
        alive.set(ws, false);
        try { ws.ping(); } catch { /* noop */ }
      }
    }, HEARTBEAT_MS);
  }

  close(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    if (this.wss) { try { this.wss.close(); } catch { /* noop */ } this.wss = null; }
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/net.ts src/mute-transport.ts package.json package-lock.json
git commit -m "feat(net): ws transport adapters + LAN address / pairing-code helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: mDNS discovery wrapper

**Files:**
- Create: `src/discovery.ts`

**Interfaces:**
- Consumes: `MDNS_SERVICE_TYPE`, `DEFAULT_PORT` (`src/mute-protocol.ts`).
- Produces: `advertiseHost(port: number, name: string): () => void` (returns a stop fn); `browseHosts(onFound: (h: DiscoveredHost) => void): () => void` (returns a stop fn); `type DiscoveredHost = { name: string; host: string; port: number }`.

**Design notes:** `bonjour-service` is required lazily inside a try/catch so a missing/broken mDNS stack can never block app boot — discovery simply becomes a no-op and the user falls back to typing the IP. Verification is manual.

- [ ] **Step 1: Implement discovery** — create `src/discovery.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/discovery.ts
git commit -m "feat(net): best-effort mDNS advertise/browse for host discovery

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Role-based wiring in main.ts + IPC

**Files:**
- Modify: `src/main.ts`
- Modify: `src/preload.ts`

**Interfaces:**
- Consumes: `RemoteDiscordMuter` (`src/mute-client.ts`); `MuteServer` (`src/mute-server.ts`); `wsClientFactory`, `WsServerListener` (`src/mute-transport.ts`); `lanAddresses`, `generatePairingCode` (`src/net.ts`); `advertiseHost`, `browseHosts` (`src/discovery.ts`).
- Produces: IPC handlers `net:lan-info`, `net:gen-code`, `net:discover`, `net:remote-status`; status payload gains `role`, `remote` (state+error), `hostClients` (count).

**Design notes:** the muter the orchestrator drives depends on the role. `local` keeps everything as-is. `controller` drives a `RemoteDiscordMuter` (input engine + orchestrator still run; no local Discord RPC). `host` runs no input engine/orchestrator — it connects local Discord RPC and starts the `MuteServer` + advertises over mDNS. Verification is manual on a two-machine setup.

- [ ] **Step 1: Add imports** — at the top of `src/main.ts`, after the existing `discord-mute` import:

```ts
import { RemoteDiscordMuter } from './mute-client';
import { MuteServer } from './mute-server';
import { wsClientFactory, WsServerListener } from './mute-transport';
import { lanAddresses, generatePairingCode } from './net';
import { advertiseHost, browseHosts, DiscoveredHost } from './discovery';
import { DiscordMuter } from './types';
```

- [ ] **Step 2: Add role-scoped module state** — after `const discord = new DiscordRpcMuter();` (around `src/main.ts:53`):

```ts
// Controller-side muter (role === 'controller'). Talks to a remote host over the LAN.
const remote = new RemoteDiscordMuter(wsClientFactory);
// Host-side relay (role === 'host'). Lazily created in startHost().
let muteServer: MuteServer | null = null;
let stopAdvertise: (() => void) | null = null;
```

- [ ] **Step 3: Select the muter by role** — in `applyConfig`, change the orchestrator construction (`src/main.ts:110`) to pick the muter, and skip the input engine on the host:

```ts
function applyConfig(next: HushConfig) {
  void orchestrator?.forceRelease();
  input?.stop();
  input = null;

  cfg = next;
  active = false;

  // The host never runs a shortcut listener — it only relays remote commands.
  if (cfg.role === 'host') {
    orchestrator = null;
    engineReady = true; // nothing to arm; report ready so the UI isn't alarmed
    dbg('engine: host role — no local shortcut listener');
    pushStatus();
    return;
  }

  // local → mute the Discord on this machine; controller → mute the remote host.
  const muter: DiscordMuter = cfg.role === 'controller' ? remote : discord;
  orchestrator = new Orchestrator(muter, cfg, (isActive) => {
    active = isActive;
    pushStatus();
  });
  input = isFnCombo(cfg.shortcut) ? new FnInputEngine() : new UiohookInputEngine(cfg.shortcut);
  input.onPress(() => { if (capturing) return; void orchestrator?.onPress(); });
  input.onRelease(() => { if (capturing) return; void orchestrator?.onRelease(); });

  try {
    input.start();
    engineReady = true;
  } catch {
    engineReady = false;
  }
  dbg('engine start', {
    logFile: LOG_FILE, mode: cfg.mode, role: cfg.role,
    shortcut: comboLabel(cfg.shortcut), engineReady,
  });
  pushStatus();
}
```

- [ ] **Step 4: Add host + remote lifecycle functions** — after `connectDiscord` (around `src/main.ts:162`):

```ts
// Host role: connect local Discord RPC, start the LAN relay, advertise via mDNS.
function startHost(): void {
  stopHost();
  muteServer = new MuteServer(discord, new WsServerListener(), cfg.hostListen.pairingCode);
  muteServer.start(cfg.hostListen.port);
  stopAdvertise = advertiseHost(cfg.hostListen.port, `Hush @ ${os.hostname()}`);
  dbg('host: started', { port: cfg.hostListen.port });
}

function stopHost(): void {
  if (muteServer) { muteServer.stop(); muteServer = null; }
  if (stopAdvertise) { stopAdvertise(); stopAdvertise = null; }
}

// Controller role: (re)connect the remote muter from config.
function connectRemote(): void {
  remote.disconnect();
  if (cfg.role !== 'controller' || !cfg.remote.host) return;
  remote.connect(cfg.remote.host, cfg.remote.port, cfg.remote.pairingCode);
  pushStatus();
}
```

Add `import * as os from 'os';` near the top imports if not already present (it is used by `startHost`).

- [ ] **Step 5: Extend status + role bring-up** — update `pushStatus` (`src/main.ts:67`) to include role/remote/host info:

```ts
function pushStatus() {
  win?.webContents.send('status', {
    active,
    engineReady,
    role: cfg.role,
    rpc: discord.getState(),
    rpcError: discord.getError(),
    remote: { state: remote.getState(), error: remote.getError() },
  });
  if (tray) tray.setImage(trayImage(active ? 'trayActiveTemplate' : 'trayIdleTemplate'));
  refreshTrayMenu();
}
```

Then in `app.whenReady().then(...)`, replace the single `void connectDiscord();` bring-up (`src/main.ts:291`) with role-aware bring-up:

```ts
    applyConfig(cfg);
    if (cfg.role === 'host') { void connectDiscord(); startHost(); }
    else if (cfg.role === 'controller') { connectRemote(); }
    else { void connectDiscord(); }
```

- [ ] **Step 6: Re-bring-up on config change** — in the `config:set` IPC handler (`src/main.ts:299-315`), after `applyConfig(saved);`, replace the RPC-only reconnect block with role-aware handling:

```ts
        const prev = cfg; // note: cfg is reassigned inside applyConfig(saved)
        const saved = saveConfig(next);
        applyConfig(saved);

        // Tear down anything from the previous role, then bring up the new one.
        stopHost();
        if (saved.role === 'host') { void connectDiscord(); startHost(); }
        else if (saved.role === 'controller') { void discord.disconnect(); connectRemote(); }
        else {
          remote.disconnect();
          if (
            saved.discordRpc.clientId !== prev.discordRpc.clientId ||
            saved.discordRpc.clientSecret !== prev.discordRpc.clientSecret
          ) void connectDiscord();
        }
        return { ok: true, config: saved };
```

- [ ] **Step 7: Add IPC for the UI** — inside `app.whenReady().then(...)`, alongside the other `ipcMain.handle` calls:

```ts
    ipcMain.handle('net:lan-info', () => ({
      addresses: lanAddresses(),
      hostname: os.hostname(),
    }));
    ipcMain.handle('net:gen-code', () => generatePairingCode());
    ipcMain.handle('net:remote-status', () => ({
      state: remote.getState(), error: remote.getError(),
    }));
    // Browse for hosts for a bounded window, collecting unique results.
    ipcMain.handle('net:discover', () => new Promise<DiscoveredHost[]>((resolve) => {
      const found = new Map<string, DiscoveredHost>();
      const stop = browseHosts((h) => found.set(`${h.host}:${h.port}`, h));
      setTimeout(() => { stop(); resolve([...found.values()]); }, 2500);
    }));
```

- [ ] **Step 8: Clean up host on quit** — in `cleanup` (`src/main.ts:263`), also stop the host and remote:

```ts
function cleanup() {
  void orchestrator?.forceRelease();
  input?.stop();
  remote.disconnect();
  stopHost();
}
```

- [ ] **Step 9: Expose the new IPC in preload** — in `src/preload.ts`, add these to the exposed API object (match the file's existing `ipcRenderer.invoke` style):

```ts
  lanInfo: () => ipcRenderer.invoke('net:lan-info'),
  genCode: () => ipcRenderer.invoke('net:gen-code'),
  discoverHosts: () => ipcRenderer.invoke('net:discover'),
  remoteStatus: () => ipcRenderer.invoke('net:remote-status'),
```

- [ ] **Step 10: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (typecheck clean; all unit tests green — the `local`-path tests prove no regression).

- [ ] **Step 11: Manual smoke (single machine)**

Run: `npm start`
Expected: app launches in the tray with default `role: 'local'`; holding the shortcut still mutes local Discord exactly as before. (Cross-machine is verified in Task 8's manual step.)

- [ ] **Step 12: Commit**

```bash
git add src/main.ts src/preload.ts
git commit -m "feat(app): role-based wiring — local / controller / host + net IPC

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Renderer UI — role picker + host/controller screens

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/style.css`
- Modify: `renderer/renderer.js`

**Interfaces:**
- Consumes (via `window` preload API): `lanInfo()`, `genCode()`, `discoverHosts()`, `remoteStatus()`, plus the existing `config:get`/`config:set` bridge and the `status` event now carrying `role`/`remote`.
- Produces: no new module exports (UI only).

**Design notes:** add a "Où est Discord ?" section. Selecting **Sur une autre machine** reveals the controller panel (discovered-host list + manual `IP` + port + pairing code + Connect + live status). A separate **Cette machine héberge Discord** toggle reveals the host panel (LAN IP list + port + generated pairing code + regenerate). The role + relevant sub-config are written through the existing `config:set`. Verification is manual (two machines).

- [ ] **Step 1: Add the markup** — in `renderer/index.html`, add a section (place it near the existing Discord/shortcut settings; match the surrounding class names):

```html
<section class="card" id="roleCard">
  <h2>Où est Discord ?</h2>
  <label><input type="radio" name="role" value="local" /> Sur cette machine</label>
  <label><input type="radio" name="role" value="controller" /> Sur une autre machine (setup double PC)</label>

  <div id="controllerPanel" hidden>
    <p class="hint">Choisis le PC qui fait tourner Discord, ou saisis son IP.</p>
    <button id="discoverBtn" type="button">Rechercher les hôtes…</button>
    <ul id="hostList"></ul>
    <label>Adresse (IP) <input id="remoteHost" type="text" placeholder="192.168.1.20" /></label>
    <label>Port <input id="remotePort" type="number" value="8698" /></label>
    <label>Code d'appairage <input id="remoteCode" type="text" placeholder="ABC123" /></label>
    <button id="remoteConnectBtn" type="button">Connecter</button>
    <p id="remoteStatus" class="hint"></p>
  </div>

  <hr />

  <label><input type="checkbox" id="hostToggle" /> Cette machine héberge Discord pour un autre appareil</label>
  <div id="hostPanel" hidden>
    <p class="hint">Recopie ces infos sur l'autre machine (le contrôleur) :</p>
    <p>Adresse(s) : <strong id="hostAddrs">—</strong></p>
    <label>Port <input id="hostPort" type="number" value="8698" /></label>
    <label>Code d'appairage <input id="hostCode" type="text" readonly /></label>
    <button id="regenCodeBtn" type="button">Régénérer le code</button>
  </div>
</section>
```

- [ ] **Step 2: Wire the behavior** — in `renderer/renderer.js`, add (adapt `api`/config-read/write names to the file's existing helpers):

```js
// --- Cross-machine role UI ---------------------------------------------------
const $ = (id) => document.getElementById(id);

function reflectRole(cfg) {
  const role = cfg.role || 'local';
  const hosting = role === 'host';
  // The radio picks local vs controller; the host toggle is orthogonal in the UI
  // but maps onto role === 'host' when checked.
  document.querySelectorAll('input[name="role"]').forEach((r) => {
    r.checked = r.value === (role === 'controller' ? 'controller' : 'local');
  });
  $('controllerPanel').hidden = role !== 'controller';
  $('hostToggle').checked = hosting;
  $('hostPanel').hidden = !hosting;
  $('remoteHost').value = cfg.remote?.host ?? '';
  $('remotePort').value = cfg.remote?.port ?? 8698;
  $('remoteCode').value = cfg.remote?.pairingCode ?? '';
  $('hostPort').value = cfg.hostListen?.port ?? 8698;
  $('hostCode').value = cfg.hostListen?.pairingCode ?? '';
}

async function refreshHostAddrs() {
  const info = await window.hush.lanInfo();
  $('hostAddrs').textContent = info.addresses.length ? info.addresses.join(', ') : 'aucune IP LAN';
}

// Build the config patch the current UI state represents, then save it.
async function saveRole() {
  const controller = document.querySelector('input[name="role"]:checked')?.value === 'controller';
  const hosting = $('hostToggle').checked;
  const role = hosting ? 'host' : controller ? 'controller' : 'local';
  const cfg = await window.hush.getConfig();      // existing config:get bridge
  const next = {
    ...cfg,
    role,
    remote: {
      host: $('remoteHost').value.trim(),
      port: Number($('remotePort').value) || 8698,
      pairingCode: $('remoteCode').value.trim(),
    },
    hostListen: {
      port: Number($('hostPort').value) || 8698,
      pairingCode: $('hostCode').value.trim(),
    },
  };
  await window.hush.setConfig(next);              // existing config:set bridge
}

document.querySelectorAll('input[name="role"]').forEach((r) =>
  r.addEventListener('change', () => { reflectRole({ role: r.value, remote: {}, hostListen: {} }); }));

$('hostToggle').addEventListener('change', async (e) => {
  $('hostPanel').hidden = !e.target.checked;
  if (e.target.checked) {
    await refreshHostAddrs();
    if (!$('hostCode').value) $('hostCode').value = await window.hush.genCode();
  }
});

$('regenCodeBtn').addEventListener('click', async () => {
  $('hostCode').value = await window.hush.genCode();
});

$('discoverBtn').addEventListener('click', async () => {
  $('hostList').innerHTML = '<li>Recherche…</li>';
  const hosts = await window.hush.discoverHosts();
  $('hostList').innerHTML = '';
  if (!hosts.length) { $('hostList').innerHTML = '<li>Aucun hôte trouvé — saisis l\'IP.</li>'; return; }
  for (const h of hosts) {
    const li = document.createElement('li');
    li.textContent = `${h.name} — ${h.host}:${h.port}`;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => { $('remoteHost').value = h.host; $('remotePort').value = h.port; });
    $('hostList').appendChild(li);
  }
});

$('remoteConnectBtn').addEventListener('click', async () => {
  await saveRole();
  $('remoteStatus').textContent = 'Connexion…';
});

// Live status from the main process (reuse the existing 'status' subscription).
window.hush.onStatus?.((s) => {
  if (s.role === 'controller' && s.remote) {
    $('remoteStatus').textContent =
      s.remote.state === 'connected' ? 'Connecté ✓'
      : s.remote.state === 'connecting' ? 'Connexion…'
      : (s.remote.error ? `Échec : ${s.remote.error}` : 'Hôte injoignable');
  }
});
```

> If the existing renderer uses different bridge names (e.g. `window.api.getConfig`), match them — the point is: read config, patch role/remote/hostListen, write via the existing `config:set`, and subscribe to the existing `status` event. Also call `reflectRole(cfg)` from wherever the renderer first loads config on startup.

- [ ] **Step 3: Minimal styling** — in `renderer/style.css`, add:

```css
#hostList { list-style: none; padding: 0; margin: 8px 0; }
#hostList li { padding: 6px 8px; border-radius: 6px; }
#hostList li:hover { background: rgba(255,255,255,0.06); }
#roleCard hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 16px 0; }
```

- [ ] **Step 4: Build + manual verification (two machines, same LAN)**

Run on both machines: `npm start` (or install the built app).
Expected, end to end:
1. **Windows PC** (Discord): open Hush → check *Cette machine héberge Discord* → note its LAN IP + generated code → also connect its local Discord RPC (existing flow).
2. **Mac** (dictation): select *Sur une autre machine* → click *Rechercher les hôtes* (host appears via mDNS) or type the IP → paste the code → *Connecter* → status shows **Connecté ✓**.
3. Hold your Wispr shortcut on the Mac → **Discord on the Windows PC mutes**; release → it unmutes.
4. Kill Hush on the Mac while muted → within ~5s the Windows Discord **auto-unmutes** (fail-safe).

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/style.css renderer/renderer.js
git commit -m "feat(ui): role picker + host/controller pairing screens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the dual-PC setup** — add a subsection under "How it works" (or after "Setup"):

```markdown
### Dual-PC setup (Discord on another machine)

Coding on one machine but running Discord on another? Hush can mute the *remote*
Discord over your LAN:

1. **On the machine with Discord** — open Hush, tick **"This machine hosts Discord
   for another device"**, note the shown **LAN IP** + **pairing code**, and connect
   its Discord RPC as usual.
2. **On the machine where you dictate** — choose **"Discord is on another machine"**,
   pick the discovered host (or type its IP), paste the **pairing code**, and click
   **Connect**.
3. Hold your shortcut as always — the *other* machine's Discord mutes, and unmutes on
   release. If the link drops, the host auto-unmutes so you're never stuck muted.

Both machines must be on the **same local network**. The link is LAN-only and gated
by the pairing code — no cloud, nothing exposed to the internet.
```

- [ ] **Step 2: Note the new architecture files** — in the `src/` tree block in `README.md`, add:

```
├── mute-protocol.ts # LAN wire protocol + transport seam (controller ↔ host)
├── mute-client.ts   # RemoteDiscordMuter: controller-side muter over the LAN
├── mute-server.ts   # MuteServer: host-side relay to local Discord (fail-safe)
├── mute-transport.ts# Real WebSocket adapters (ws) for the seam
├── discovery.ts     # Optional mDNS host advertise/browse (bonjour-service)
├── net.ts           # LAN IPv4 list + pairing-code generator
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the dual-PC (cross-machine) muting setup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** roles + seam (Tasks 1,3,4,7) · protocol (Task 2) · discovery (Task 6) · config+migration (Task 1) · UX (Task 8) · fail-safe auto-unmute (Task 4 + Task 5 heartbeat) · security/pairing code (Tasks 2,4,5) · tests (Tasks 1–4) · docs (Task 9). All spec sections map to a task.
- **Type consistency:** `RemoteDiscordMuter(factory, schedule?)`, `MuteServer(muter, listener, code)`, `ClientSocketFactory = (host, port) => ClientSocket`, `ServerListener.listen(port)` are used identically across tasks 3–7.
- **No-regression proof:** default `role: 'local'`, the untouched `Orchestrator`/`DiscordMuter` interface, and the unchanged `orchestrator.test.ts`/`discord-mute.test.ts` together guarantee the original single-machine path is unaffected.
```
