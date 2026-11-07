// What quitting needs from the orchestrator: whether Discord is muted by us,
// and a way to release that mute and wait for the RPC call to actually land.
export interface Releasable {
  isActive(): boolean;
  forceRelease(): Promise<void>;
  whenIdle(): Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Release a mute Hush is holding and wait until the unmute has been sent, so
// quitting never leaves Discord muted. Bounded by timeoutMs: a hung RPC/LAN
// call must not stop the app from quitting. Resolves true if a release was
// needed (i.e. the caller had to wait), false if nothing was held.
export async function releaseBeforeQuit(
  target: Releasable | null,
  timeoutMs = 2000,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<boolean> {
  if (!target || !target.isActive()) return false;
  const released = (async () => {
    await target.forceRelease();
    await target.whenIdle(); // forceRelease only queues the unmute in auto mode
  })().catch(() => { /* best-effort: never block quitting on an RPC error */ });
  await Promise.race([released, sleep(timeoutMs)]);
  return true;
}
