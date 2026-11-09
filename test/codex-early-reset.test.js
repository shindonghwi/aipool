import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountManager } from '../src/account-manager.js';
import { Prober } from '../src/prober.js';
import { normalizeCodexUsagePayload } from '../src/codex-usage.js';

// Codex resets limits ahead of schedule now and then, and an account owner can
// redeem a free reset credit by hand. A live response would carry the new
// figures, but an account aipool holds back gets no live request — so the
// prober reads its zero-spend usage endpoint while it is held.

const MODEL = 'gpt-6.1-sol';
const DAY = 24 * 3600_000;

function codex(name, extra = {}) {
  return {
    name, type: 'oauth', provider: 'codex', accountId: 'acct-' + name,
    accessToken: 't-' + name, refreshToken: 'r', expiresAt: Date.now() + 3600_000, ...extra,
  };
}

function spent(account, credits = { hasCredits: true, balance: 500 }) {
  account.quota.unified7d = 1.0;
  account.quota.unified7dReset = Date.now() + 4 * DAY;
  if (credits) account.quota.credits = { ...credits, seenAt: Date.now() };
}

const pick = am => am.getActiveAccount(null, MODEL, null, null, 'codex');
const freshWeek = { sevenDay: { utilization: 0.0, resetAt: Date.now() + 7 * DAY }, limitReached: false };

test('the usage payload says whether the limit is reached', () => {
  assert.equal(normalizeCodexUsagePayload({ rate_limit: { allowed: true, limit_reached: false } }).limitReached, false);
  assert.equal(normalizeCodexUsagePayload({ rate_limit: { limit_reached: true } }).limitReached, true);
  assert.equal(normalizeCodexUsagePayload({ rate_limit: {} }).limitReached, null);
});

test('an account held at its spent plan is watched; one with live traffic is not', () => {
  const am = new AccountManager([codex('c')], 0.98);
  spent(am.accounts[0]);
  assert.equal(am.codexHeldBack(am.accounts[0]), true, 'nothing is being sent to it');

  am.accounts[0].usage.lastUsed = new Date().toISOString();
  assert.equal(am.codexHeldBack(am.accounts[0], Date.now() - 60_000), false, 'a response just came back');

  // Serving on the rest of its plan, or on allowed credits: responses carry the figures.
  const remainder = new AccountManager([codex('r')], 0.98);
  remainder.accounts[0].quota.unified7d = 0.99;
  remainder.accounts[0].quota.unified7dReset = Date.now() + DAY;
  assert.equal(remainder.codexHeldBack(remainder.accounts[0]), false);
  const onCredits = new AccountManager([codex('o', { useCredits: true })], 0.98);
  spent(onCredits.accounts[0]);
  assert.equal(onCredits.codexHeldBack(onCredits.accounts[0]), false);
});

test('a healthy, disabled, or Claude account is not watched', () => {
  const claude = { name: 'claude', type: 'oauth', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600_000 };
  const am = new AccountManager([codex('fine'), codex('off', { disabled: true }), claude], 0.98);
  spent(am.accounts[1]);
  spent(am.accounts[2], null);
  for (const account of am.accounts) assert.equal(am.codexHeldBack(account), false, account.name);
});

test('an early reset found by the watch puts the account straight back on its plan', async () => {
  const am = new AccountManager([codex('c')], 0.98);
  spent(am.accounts[0]);
  assert.equal(pick(am), null, 'held: plan spent, credits not allowed');

  let calls = 0;
  const prober = new Prober(am, { codexProbeFn: async () => { calls++; return freshWeek; }, log: () => {} });
  await prober.watchCodex();
  assert.equal(calls, 1);
  assert.equal(am.accounts[0].quota.unified7d, 0);
  assert.equal(pick(am)?.name, 'c');
  assert.equal(am.creditsQuestionPending(am.accounts[0]), false);
});

test('the watch lifts a 429 hold the early reset made obsolete', async () => {
  const am = new AccountManager([codex('c')], 0.98);
  spent(am.accounts[0], null);
  am.markRateLimited(0, 4 * 24 * 3600);
  assert.equal(am.unavailableReason(am.accounts[0]), 'throttled');

  const prober = new Prober(am, { codexProbeFn: async () => freshWeek, log: () => {} });
  await prober.watchCodex();
  assert.equal(am.accounts[0].status, 'active');
  assert.equal(pick(am)?.name, 'c');
});

test('a reading that still says spent changes nothing', async () => {
  const am = new AccountManager([codex('c')], 0.98);
  spent(am.accounts[0]);
  const prober = new Prober(am, {
    codexProbeFn: async () => ({ sevenDay: { utilization: 1.0, resetAt: Date.now() + 4 * DAY }, limitReached: true }),
    log: () => {},
  });
  await prober.watchCodex();
  assert.equal(pick(am), null);
});

test('nothing is read for accounts that are not held, nor while the opt-in probe covers it', async () => {
  const am = new AccountManager([codex('c')], 0.98);
  am.accounts[0].quota.unified7d = 0.3;
  am.accounts[0].quota.unified7dReset = Date.now() + DAY;
  let calls = 0;
  const idle = new Prober(am, { codexProbeFn: async () => { calls++; return freshWeek; }, log: () => {} });
  await idle.watchCodex();
  assert.equal(calls, 0);

  spent(am.accounts[0]);
  const covered = new Prober(am, { intervalMs: 60_000, codexProbeFn: async () => { calls++; return freshWeek; }, log: () => {} });
  await covered.watchCodex();
  assert.equal(calls, 0);
  covered.stop();
});

test('start arms the watch and stop disarms it', () => {
  const am = new AccountManager([codex('c')], 0.98);
  const prober = new Prober(am, { log: () => {} });
  prober.start();
  assert.ok(prober.codexWatchTimer);
  prober.stop();
  assert.equal(prober.codexWatchTimer, null);
  const off = new Prober(am, { codexWatchMs: 0, log: () => {} });
  off.start();
  assert.equal(off.codexWatchTimer, null);
});
