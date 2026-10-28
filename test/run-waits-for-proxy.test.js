// `aipool run --auto-fallback` launched at the same moment the service
// starts the proxy (a terminal restored at login) must still route claude
// through the proxy. It used to probe once, find nothing listening, and launch
// claude direct for the rest of its life — no rotation, no failover, and the
// session hit its own login's 5-hour limit while the fleet had headroom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function runCli(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [ENTRY, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.stdout.resume();
    child.on('close', code => resolve({ code, stderr }));
  });
}

async function scenario({ listenAfterMs, waitMs }) {
  const dir = await mkdtemp(join(tmpdir(), 'tc-run-wait-'));
  const port = await freePort();
  const out = join(dir, 'claude-env.txt');
  // A stand-in for claude that records where it was told to send requests.
  const fake = join(dir, 'claude');
  await writeFile(fake, `#!/bin/sh\nprintf '%s' "\${ANTHROPIC_BASE_URL:-direct}" > "${out}"\n`);
  await chmod(fake, 0o755);
  const cfg = join(dir, 'aipool.json');
  await writeFile(cfg, JSON.stringify({ proxy: { port }, accounts: [], autoUpdate: false }));

  const env = { ...process.env };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'ANTHROPIC_BASE_URL', 'TC_ACCT']) delete env[k];
  Object.assign(env, {
    PATH: `${dir}:${process.env.PATH}`,
    HOME: dir,
    XDG_CONFIG_HOME: dir,
    AIPOOL_CONFIG: cfg,
    AIPOOL_DISABLE_AUTOUPDATE: '1',
    AIPOOL_RUN_WAIT_MS: String(waitMs),
  });

  // The proxy comes up late, as the service does at login.
  const listener = net.createServer(s => s.destroy());
  const timer = setTimeout(() => listener.listen(port, '127.0.0.1'), listenAfterMs);
  try {
    const { code, stderr } = await runCli(['run', '--no-mitm', '--auto-fallback', '--'], env);
    const target = await readFile(out, 'utf8').catch(() => '(claude not launched)');
    return { code, stderr, target, port };
  } finally {
    clearTimeout(timer);
    listener.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('run waits for a proxy that is still starting instead of launching claude direct', async () => {
  const { code, stderr, target, port } = await scenario({ listenAfterMs: 1_500, waitMs: 10_000 });
  assert.equal(code, 0, stderr);
  assert.equal(target, `http://localhost:${port}`, `claude must go through the proxy; stderr: ${stderr}`);
});

test('with no proxy coming, --auto-fallback still launches claude direct after the wait', async () => {
  const { code, stderr, target } = await scenario({ listenAfterMs: 60_000, waitMs: 600 });
  assert.equal(code, 0, stderr);
  assert.equal(target, 'direct');
  assert.match(stderr, /launching claude directly/);
});
