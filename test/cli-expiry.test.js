import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same shape as cli-distribute.test.js: the real CLI against a throwaway
// AIPOOL_CONFIG, on a port nothing listens on so the post-write reload
// notification is a no-op.

const cliPath = fileURLToPath(new URL('../src/index.js', import.meta.url));

async function writeConfig(expiryRouting) {
  const dir = await mkdtemp(join(tmpdir(), 'aipool-expiry-'));
  const path = join(dir, 'config.json');
  const config = {
    proxy: { port: 3, apiKey: 'tc-test' },
    upstream: 'https://api.anthropic.com',
    upstreamProxy: false,
    accounts: [{ name: 'a@example.com', type: 'apikey', apiKey: 'k1' }],
  };
  if (expiryRouting !== undefined) config.expiryRouting = expiryRouting;
  await writeFile(path, JSON.stringify(config));
  return path;
}

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

const readExpiry = async path => JSON.parse(await readFile(path, 'utf8')).expiryRouting;

test('expiry with no argument reports the setting', async () => {
  const path = await writeConfig();
  const res = await runCli(path, ['expiry']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Expiry routing: off \(tolerance 1\.5\)/);
});

test('expiry on writes the setting and keeps preempt', async () => {
  const path = await writeConfig({ enabled: false, preempt: false });
  const res = await runCli(path, ['expiry', 'on']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Expiry routing on/);
  assert.deepEqual(await readExpiry(path), { enabled: true, preempt: false });
});

test('expiry on --tolerance sets the band width', async () => {
  const path = await writeConfig();
  const res = await runCli(path, ['expiry', 'on', '--tolerance', '2']);
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(await readExpiry(path), { enabled: true, tolerance: 2 });
});

test('expiry off turns it off', async () => {
  const path = await writeConfig({ enabled: true, tolerance: 1.5 });
  const res = await runCli(path, ['expiry', 'off']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal((await readExpiry(path)).enabled, false);
});

test('a bad argument or tolerance is refused and writes nothing', async () => {
  const path = await writeConfig();
  for (const argv of [['expiry', 'sometimes'], ['expiry', 'on', '--tolerance', '0.5'], ['expiry', 'on', '--tolerance', 'wide']]) {
    const res = await runCli(path, argv);
    assert.equal(res.code, 1, `${argv.join(' ')}: ${res.stdout}`);
  }
  assert.equal(await readExpiry(path), undefined);
});
