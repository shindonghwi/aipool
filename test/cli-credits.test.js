import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountManager } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';
import { syncAccountsFromDisk } from '../src/sync-accounts.js';

const cliPath = fileURLToPath(new URL('../src/index.js', import.meta.url));
const WEEK = 7 * 24 * 3600_000;
const pick = manager => manager.getActiveAccount(null, 'gpt-6.1-sol', null, null, 'codex');

function runCli(configPath, args) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: { ...process.env, AIPOOL_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI did not exit')); }, 10_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function withServer(t, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'aipool-credits-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  const config = {
    proxy: { apiKey: 'tc-test' },
    upstreamProxy: false,
    accounts: [
      {
        name: 'codex', provider: 'codex', type: 'oauth',
        accessToken: 'test-token', refreshToken: 'test-refresh', expiresAt: Date.now() + WEEK,
        useCredits: true, useCreditsUntil: Date.now() - 1000,
      },
      {
        name: 'claude', type: 'oauth', accessToken: 'claude-token',
        refreshToken: 'claude-refresh', expiresAt: Date.now() + WEEK,
      },
    ],
  };
  const manager = new AccountManager(config.accounts, 0.98);
  const account = manager.accounts[0];
  account.quota.unified7d = 1;
  account.quota.unified7dReset = Date.now() + WEEK;
  account.quota.credits = { hasCredits: true, balance: 100, seenAt: Date.now() };
  const server = createProxyServer(manager, config, {
    reload: async () => syncAccountsFromDisk(JSON.parse(await readFile(path, 'utf8')), config, manager),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  config.proxy.port = server.address().port;
  await writeFile(path, JSON.stringify(config));
  await fn({ path, manager, account });
}

test('credits on replaces an expired answer and keeps serving across weekly resets and restart', async t => {
  await withServer(t, async ({ path, manager, account }) => {
    assert.equal(pick(manager), null, 'expired permission stops the conversation');
    const result = await runCli(path, ['credits', 'on']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /until you run aipool credits off/);
    assert.match(result.stdout, /Reloaded running server/);
    assert.equal(pick(manager), account, 'live reload resumes credit-backed routing');
    assert.equal(manager.onCredits(account), true);

    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.accounts[0].useCreditsUntil, undefined);
    assert.equal(saved.accounts[1].useCredits, undefined, 'Claude settings stay untouched');
    const reset = account.quota.unified7dReset;
    assert.equal(manager.creditsAnswer(account, reset + WEEK), true, 'permission survives future resets');
    account.quota.unified7d = 0;
    account.quota.unified7dReset = reset + WEEK;
    assert.equal(pick(manager), account);
    assert.equal(manager.onCredits(account), false, 'refilled plan is used first');
    account.quota.unified7d = 1;
    assert.equal(pick(manager), account);
    assert.equal(manager.onCredits(account), true, 'next exhausted week switches automatically');

    const restarted = new AccountManager(saved.accounts, 0.98);
    Object.assign(restarted.accounts[0].quota, account.quota);
    assert.equal(pick(restarted)?.name, 'codex', 'saved choice survives restart');
    const listing = await runCli(path, ['credits']);
    assert.match(listing.stdout, /credits on/);
    assert.doesNotMatch(listing.stdout, /until the weekly reset/);
  });
});

test('credits off persists a refusal and removes an old expiration', async t => {
  await withServer(t, async ({ path, manager, account }) => {
    const result = await runCli(path, ['credits', 'off', 'codex']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /until you run aipool credits on/);
    assert.equal(pick(manager), null);
    assert.equal(manager.creditsQuestionPending(account), false);
    assert.equal(manager.creditsAnswer(account, Date.now() + 2 * WEEK), false);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.accounts[0].useCredits, false);
    assert.equal(saved.accounts[0].useCreditsUntil, undefined);
  });
});
