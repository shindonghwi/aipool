import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForProxy, resolveRunWaitMs, DEFAULT_RUN_WAIT_MS } from '../src/proxy-wait.js';

// A virtual clock: sleep advances it, nothing waits in real time.
function clock() {
  let t = 0;
  return { now: () => t, sleep: async ms => { t += ms; } };
}

// The incident: the terminal ran the alias at 21:22:11, the launchd service
// started at 21:22:13, the one probe was refused, and --auto-fallback launched
// claude direct for the rest of its life. A proxy that comes up inside the
// wait must be found.
test('a proxy that starts a couple of seconds after run is waited for', async () => {
  const c = clock();
  const up = await waitForProxy(async () => c.now() >= 2_000, { waitMs: DEFAULT_RUN_WAIT_MS, ...c });
  assert.equal(up, true);
  assert.ok(c.now() >= 2_000 && c.now() < 2_500, `stopped polling once up (t=${c.now()})`);
});

test('a proxy that never comes up costs the bounded wait, then falls back', async () => {
  const c = clock();
  let probes = 0;
  const up = await waitForProxy(async () => { probes++; return false; }, { waitMs: 1_000, pollMs: 250, ...c });
  assert.equal(up, false);
  assert.equal(c.now(), 1_000);
  assert.equal(probes, 4);
});

test('a zero wait probes nothing', async () => {
  const c = clock();
  let probes = 0;
  assert.equal(await waitForProxy(async () => { probes++; return true; }, { waitMs: 0, ...c }), false);
  assert.equal(probes, 0);
});

test('the wait applies only when a service is installed, unless the env says otherwise', () => {
  assert.equal(resolveRunWaitMs({ serviceInstalled: true, env: {} }), DEFAULT_RUN_WAIT_MS);
  assert.equal(resolveRunWaitMs({ serviceInstalled: false, env: {} }), 0);
  assert.equal(resolveRunWaitMs({ serviceInstalled: true, env: { AIPOOL_RUN_WAIT_MS: '0' } }), 0);
  assert.equal(resolveRunWaitMs({ serviceInstalled: false, env: { AIPOOL_RUN_WAIT_MS: '5000' } }), 5000);
  assert.equal(resolveRunWaitMs({ serviceInstalled: true, env: { AIPOOL_RUN_WAIT_MS: 'soon' } }), DEFAULT_RUN_WAIT_MS);
  assert.equal(resolveRunWaitMs({ serviceInstalled: true, env: { AIPOOL_RUN_WAIT_MS: '-1' } }), DEFAULT_RUN_WAIT_MS);
});
