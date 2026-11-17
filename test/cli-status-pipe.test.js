import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `aipool status --json` is read through a pipe by anything that is not a
// terminal (`| jq`, a script), and process.stdout.write is asynchronous on a
// pipe: the process.exit that follows the write used to cut the payload to its
// first few hundred bytes. The status served here is bigger than any pipe
// buffer, so a truncated write cannot hide behind a lucky synchronous flush.

const cliPath = fileURLToPath(new URL('../src/index.js', import.meta.url));

function bigStatus() {
  const reset = Date.now() + 3_600_000;
  const accounts = Array.from({ length: 400 }, (_, i) => ({
    name: `account-${i}@example.com`, type: 'oauth', orgName: `Org ${i}`, priority: 0, disabled: false,
    status: 'active', sessions: 0,
    quota: { unified5h: 0.4, unified5hReset: reset, unified7d: 0.2, unified7dReset: reset },
    usage: { totalRequests: i }, rateLimitedUntil: null, pausedUntil: null,
  }));
  return {
    server: { startedAt: new Date(reset - 3_600_000).toISOString(), uptimeSeconds: 42, port: 3456 },
    probe: { enabled: false, intervalSeconds: 0, running: false, accounts: [] },
    warm: { enabled: false, intervalSeconds: 0, running: false, accounts: [] },
    currentAccount: accounts[0].name,
    switchThreshold: 0.98,
    sessions: { active: 0, known: 0, distribute: false, perAccount: {} },
    routes: [],
    accounts,
  };
}

async function fakeControlPlane(status, { onProbe = () => {}, onStatus = () => {}, probeStatus = 200 } = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'] });
    if (req.method === 'POST' && req.url === '/aipool/probe') {
      await onProbe();
      res.writeHead(probeStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: probeStatus === 200 }));
      return;
    }
    if (req.method !== 'GET' || req.url !== '/aipool/status') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }
    onStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  return { seen, port: server.address().port, close };
}

async function writeConfig(port) {
  const dir = await mkdtemp(join(tmpdir(), 'aipool-status-pipe-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({
    proxy: { port, apiKey: 'tc-test' },
    upstream: 'https://api.anthropic.com',
    upstreamProxy: false,
    accounts: [{ name: 'a@example.com', type: 'apikey', apiKey: 'k1' }],
  }));
  return { dir, path };
}

function runCli(configPath, cliArgs) {
  const child = spawn(process.execPath, [cliPath, ...cliArgs], {
    env: { ...process.env, AIPOOL_CONFIG: configPath, AIPOOL_DISABLE_AUTOUPDATE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', c => { stdout += c; });
  child.stderr.on('data', c => { stderr += c; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI did not exit')); }, 10_000);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test('status --json through a pipe delivers the whole payload before exiting', async () => {
  const status = bigStatus();
  const expected = JSON.stringify(status, null, 2);
  assert.ok(Buffer.byteLength(expected) > 64 * 1024, 'fixture must outgrow the pipe buffer to prove anything');

  const fake = await fakeControlPlane(status);
  const config = await writeConfig(fake.port);
  try {
    const res = await runCli(config.path, ['status', '--json']);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(fake.seen, [
      { method: 'POST', url: '/aipool/probe', key: 'tc-test' },
      { method: 'GET', url: '/aipool/status', key: 'tc-test' },
    ]);
    assert.equal(res.stdout.length, expected.length + 1, `got ${res.stdout.length} of ${expected.length + 1} bytes`);
    assert.deepEqual(JSON.parse(res.stdout), status);
  } finally {
    await fake.close();
    await rm(config.dir, { recursive: true, force: true });
  }
});

async function withStatus(fn, options = {}) {
  const status = bigStatus();
  status.accounts = status.accounts.slice(0, 1);
  const fake = await fakeControlPlane(status, options);
  const config = await writeConfig(fake.port);
  try { await fn({ status, fake, config }); }
  finally { await fake.close(); await rm(config.dir, { recursive: true, force: true }); }
}

test('status waits for account refresh before rendering the new quota', async () => {
  let status;
  await withStatus(async fixture => {
    status = fixture.status;
    const result = await runCli(fixture.config.path, ['status']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /73%/);
    assert.doesNotMatch(result.stdout, /20%/);
    assert.match(result.stdout, /Updated/);
  }, { onProbe: async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    status.accounts[0].quota.unified7d = 0.73;
    status.probe.accounts = [{ name: status.accounts[0].name, status: 'ok', lastProbedAt: new Date().toISOString() }];
  } });
});

test('status --cached --json reads the snapshot without any upstream refresh', async () => {
  await withStatus(async ({ status, fake, config }) => {
    const result = await runCli(config.path, ['status', '--cached', '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), status);
    assert.deepEqual(fake.seen, [{ method: 'GET', url: '/aipool/status', key: 'tc-test' }]);
  });
});

test('an unsupported refresh still prints the snapshot with an explicit warning', async () => {
  await withStatus(async ({ status, config }) => {
    const result = await runCli(config.path, ['status', '--json']);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), status, 'warnings must not corrupt JSON output');
    assert.match(result.stderr, /Could not refresh account quotas \(HTTP 501\); showing last known readings/);
  }, { probeStatus: 501 });
});

test('status joins an already running refresh instead of returning its old readings', async () => {
  let status;
  let reads = 0;
  await withStatus(async fixture => {
    status = fixture.status;
    status.probe.running = true;
    const result = await runCli(fixture.config.path, ['status', '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).accounts[0].quota.unified7d, 0.88);
    assert.equal(reads, 2);
    assert.equal(fixture.fake.seen.filter(r => r.method === 'POST').length, 1);
  }, { onStatus: () => {
    if (++reads === 2) { status.probe.running = false; status.accounts[0].quota.unified7d = 0.88; }
  } });
});

test('a failed on-demand account refresh is visible even when background probing is off', async () => {
  let status;
  await withStatus(async fixture => {
    status = fixture.status;
    const result = await runCli(fixture.config.path, ['status']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Needs attention/);
    assert.match(result.stdout, /quota figures are not refreshing \(HTTP 429\)/);
    assert.doesNotMatch(result.stdout, /Updated/);
  }, { onProbe: () => {
    status.probe.accounts = [{ name: status.accounts[0].name, status: 'error', error: 'HTTP 429' }];
  } });
});
