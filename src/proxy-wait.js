// `aipool run` decides once, at launch, whether claude goes through the
// proxy, and a session launched direct stays direct for its whole life: no
// rotation, no failover, the client's own login spent to its limit. At login
// the service manager starts the proxy and a restored terminal runs the alias
// at the same moment, so the one probe can lose that race by a second and
// strand a long-lived session outside the proxy. When a service is installed
// the proxy is expected, so `run` waits a bounded while for it before falling
// back or refusing.

// Long enough for a launchd/systemd start to reach listen() on a loaded
// machine; short enough that a service that has actually died costs one pause.
export const DEFAULT_RUN_WAIT_MS = 15_000;
const POLL_MS = 250;

/**
 * How long `run` may wait for the proxy to come up. An explicit
 * AIPOOL_RUN_WAIT_MS wins (0 turns the wait off); otherwise wait only when
 * a service is installed, since with none nothing is going to start it.
 * @param {{ serviceInstalled: boolean, env?: Record<string, string|undefined> }} opts
 */
export function resolveRunWaitMs({ serviceInstalled, env = process.env }) {
  const raw = env.AIPOOL_RUN_WAIT_MS;
  if (raw != null && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return serviceInstalled ? DEFAULT_RUN_WAIT_MS : 0;
}

/**
 * Poll `isUp` until it answers true or `waitMs` has passed. Resolves to the
 * last answer.
 * @param {() => Promise<boolean>} isUp
 * @param {{ waitMs: number, pollMs?: number, sleep?: (ms: number) => Promise<void>, now?: () => number }} opts
 */
export async function waitForProxy(isUp, {
  waitMs, pollMs = POLL_MS,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = Date.now,
}) {
  const deadline = now() + waitMs;
  while (now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    if (await isUp()) return true;
  }
  return false;
}
