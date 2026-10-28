import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountManager } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';
import { clearRemovedAccountIds, mergeAccountsForSave, removedAccountIds } from '../src/account-pairing.js';

// `aipool remove` used to edit only the file. A running server kept the
// account (a reload never drops one), so it stayed in rotation and in `status`
// until a restart — and the server's next save wrote it back from memory. Now
// the CLI asks the running server to drop it first. These run the real CLI
// against a real proxy server.

const cliPath = fileURLToPath(new URL('../src/index.js', import.meta.url));

const ACCTS = [
  { id: 'id-alice', name: 'alice@example.com', type: 'apikey', apiKey: 'k1' },
  { id: 'id-bob', name: 'bob@example.com', type: 'apikey', apiKey: 'k2' },
];

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function closedPort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function writeConfig(port, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aipool-remove-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({
    proxy: { port, apiKey: 'tc-test', ...extra },
    upstream: 'https://api.anthropic.com',
    upstreamProxy: false,
    accounts: ACCTS,
  }));
  return path;
}

const diskNames = async path => JSON.parse(await readFile(path, 'utf8')).accounts.map(a => a.name);

function runCli(configPath, cliArgs) {
  const child = spawn(process.execPath, [cliPath, ...cliArgs], {
    env: { ...process.env, AIPOOL_CONFIG: configPath },
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

// A server wired the way `aipool server` wires it: an in-memory config
// the save is built from, merged onto whatever is on disk.
async function withProxy(fn, proxyExtra = {}) {
  const config = {
    proxy: { apiKey: 'tc-test', ...proxyExtra },
    upstream: 'https://api.anthropic.com',
    accounts: ACCTS.map(a => ({ ...a })),
  };
  const am = new AccountManager(config.accounts, 0.98);
  let path;
  const hooks = {
    persistAccounts: async () => {
      const disk = JSON.parse(await readFile(path, 'utf8'));
      disk.accounts = mergeAccountsForSave(config.accounts, am.accounts, disk.accounts, removedAccountIds(config));
      clearRemovedAccountIds(config);
      await writeFile(path, JSON.stringify(disk));
    },
  };
  const proxy = createProxyServer(am, config, hooks);
  const port = await listen(proxy);
  path = await writeConfig(port, proxyExtra);
  try {
    await fn({ am, config, hooks, path, port });
  } finally {
    proxy.close();
  }
}

test('remove drops the account from a running server and from the file', async () => {
  await withProxy(async ({ am, hooks, path }) => {
    const res = await runCli(path, ['remove', 'bob@example.com']);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Removed account "bob@example\.com"/);
    assert.match(res.stdout, /running server too/);
    assert.deepEqual(am.accounts.map(a => a.name), ['alice@example.com']);
    assert.deepEqual(await diskNames(path), ['alice@example.com']);
    // The server's next save — a token refresh, a TUI edit — must not bring it back.
    await hooks.persistAccounts();
    assert.deepEqual(await diskNames(path), ['alice@example.com']);
  });
});

test('the endpoint refuses a client key and leaves the fleet alone', async () => {
  await withProxy(async ({ am, port }) => {
    const res = await fetch(`http://127.0.0.1:${port}/aipool/remove`, {
      method: 'POST',
      headers: { 'x-api-key': 'tc-client-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'id-bob' }),
    });
    assert.equal(res.status, 403);
    assert.equal(am.accounts.length, 2);
  }, { clientKeys: [{ name: 'laptop', key: 'tc-client-1' }] });
});

test('the endpoint refuses a key-less loopback caller', async () => {
  await withProxy(async ({ am, port }) => {
    const res = await fetch(`http://127.0.0.1:${port}/aipool/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'id-bob' }),
    });
    assert.equal(res.status, 403);
    assert.equal(am.accounts.length, 2);
  });
});

test('an id the server does not run is reported, not treated as an error', async () => {
  await withProxy(async ({ am, port }) => {
    const res = await fetch(`http://127.0.0.1:${port}/aipool/remove`, {
      method: 'POST',
      headers: { 'x-api-key': 'tc-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'id-nobody' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, removed: false });
    assert.equal(am.accounts.length, 2);
  });
});

test('with no server running, remove edits the file and warns about nothing', async () => {
  const path = await writeConfig(await closedPort());
  const res = await runCli(path, ['remove', 'bob@example.com']);
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(await diskNames(path), ['alice@example.com']);
  assert.doesNotMatch(res.stderr, /Restart/);
});

test('a server too old for the endpoint gets a restart warning, and the file is still edited', async () => {
  const old = http.createServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown aipool control route (check the path and the method)' }));
  });
  const port = await listen(old);
  try {
    const path = await writeConfig(port);
    const res = await runCli(path, ['remove', 'bob@example.com']);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(await diskNames(path), ['alice@example.com']);
    assert.match(res.stderr, /Restart the server/);
  } finally {
    old.close();
  }
});
