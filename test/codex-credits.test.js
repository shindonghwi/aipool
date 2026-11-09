import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountManager, accountUseCredits, accountUseCreditsUntil } from '../src/account-manager.js';
import { parseCodexCredits } from '../src/codex-quota.js';
import { normalizeCodexUsagePayload } from '../src/codex-usage.js';
import { creditsQuestionText, creditsLeftText, resetCreditsAside, formatCredits } from '../src/codex-credits.js';
import { exhaustedMessage } from '../src/server.js';
import { renderStatusCompact, renderStatus, purchasedCreditLine, creditStanding } from '../src/status-renderer.js';

// Codex purchased credits: ChatGPT keeps serving an account past its plan
// limit by spending them. aipool asks once before relying on that, keeps the
// answer as `accounts[].useCredits`, and only reports free limit resets.

const MODEL = 'gpt-6.1-sol';

function codex(name, extra = {}) {
  return {
    name, type: 'oauth', provider: 'codex', accountId: 'acct-' + name,
    accessToken: 't-' + name, refreshToken: 'r', expiresAt: Date.now() + 3600_000, ...extra,
  };
}

/** The weekly plan spent (100%), with the window still running. */
function atPlanLimit(account, used = 1.0) {
  account.quota.unified7d = used;
  account.quota.unified7dReset = Date.now() + 4 * 24 * 3600_000;
}

function withCredits(account, credits = { hasCredits: true, unlimited: false, balance: 59933.9 }) {
  account.quota.credits = { ...credits, seenAt: Date.now() };
}

const pick = am => am.getActiveAccount(null, MODEL, null, null, 'codex');

// ── reading the credits ─────────────────────────────────────────────────────

test('response headers yield the purchased credits, and only what they state', () => {
  assert.deepEqual(parseCodexCredits({
    'x-codex-credits-has-credits': 'true',
    'x-codex-credits-unlimited': 'false',
    'x-codex-credits-balance': '59933.9047185000',
  }), { hasCredits: true, unlimited: false, balance: 59933.9047185 });
  assert.deepEqual(parseCodexCredits({ 'x-codex-credits-has-credits': 'False' }), { hasCredits: false });
  assert.equal(parseCodexCredits({ 'x-codex-primary-used-percent': '98' }), null);
  assert.equal(parseCodexCredits({ 'x-codex-credits-balance': 'lots' }), null);
  assert.equal(parseCodexCredits({ 'x-codex-credits-balance': '-1' }), null);
});

test('the usage payload yields the purchased credits beside the reset credits', () => {
  const usage = normalizeCodexUsagePayload({
    plan_type: 'pro',
    rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 98, limit_window_seconds: 604800, reset_at: 1794582194 }, secondary_window: null },
    credits: { has_credits: true, unlimited: false, overage_limit_reached: false, balance: '59933.9047185000' },
    rate_limit_reset_credits: { available_count: 2, applicable_available_count: 0 },
  });
  assert.deepEqual(usage.credits, { hasCredits: true, unlimited: false, overageLimitReached: false, balance: 59933.9047185 });
  assert.deepEqual(usage.resetCredits, { available: 2, applicable: 0 });
  assert.equal(normalizeCodexUsagePayload({ rate_limit: {} }).credits, null);
});

test('a response merges into the stored credits without erasing the spend-control flag', () => {
  const am = new AccountManager([codex('c')], 0.98);
  am.applyCodexUsageData(0, { credits: { hasCredits: true, overageLimitReached: false, balance: 100 } });
  am.updateQuota(0, { 'x-codex-credits-has-credits': 'true', 'x-codex-credits-balance': '90' });
  const c = am.accounts[0].quota.credits;
  assert.equal(c.balance, 90);
  assert.equal(c.overageLimitReached, false);
  assert.ok(Number.isFinite(c.seenAt));
});

test('the setting reads true, false, or not asked — and a typo is not asked', () => {
  assert.equal(accountUseCredits({ useCredits: true }), true);
  assert.equal(accountUseCredits({ useCredits: false }), false);
  assert.equal(accountUseCredits({}), null);
  assert.equal(accountUseCredits({ useCredits: 'yes' }), null);
});

// ── selection ───────────────────────────────────────────────────────────────

test('not asked yet: the account is held at its plan limit and the question is pending', () => {
  const am = new AccountManager([codex('c')], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);

  // Not even the revalidation probe: upstream would bill it to the credits.
  assert.equal(pick(am), null);
  assert.equal(pick(am), null);
  assert.equal(am.creditsQuestionPending(am.accounts[0]), true);
  assert.equal(am.onCredits(am.accounts[0]), false);
});

test('allowed: every request is served on credits, not one probe a minute', () => {
  const am = new AccountManager([codex('c', { useCredits: true })], 0.98);
  atPlanLimit(am.accounts[0], 1.0);
  withCredits(am.accounts[0]);

  for (let i = 0; i < 5; i++) assert.equal(pick(am)?.name, 'c');
  assert.equal(am.onCredits(am.accounts[0]), true);
  assert.equal(am.creditsQuestionPending(am.accounts[0]), false);
});

test('declined: the account stops at its plan limit and nobody is asked again', () => {
  const am = new AccountManager([codex('c', { useCredits: false })], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  assert.equal(pick(am), null);
  assert.equal(am.creditsQuestionPending(am.accounts[0]), false);
});

test('credits are the last resort: an account with plan headroom is used first', () => {
  const am = new AccountManager([codex('spent', { useCredits: true }), codex('fresh')], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  am.accounts[1].quota.unified7d = 0.2;
  am.accounts[1].quota.unified7dReset = Date.now() + 3600_000;
  assert.equal(pick(am)?.name, 'fresh');
  assert.equal(am.onCredits(am.accounts[0]), false, 'not spending while another account has headroom');
});

// ── past the threshold, before the plan is spent ───────────────────────────

test('past its threshold with plan left, the last account keeps serving for free', () => {
  const am = new AccountManager([codex('c')], 0.98);
  atPlanLimit(am.accounts[0], 0.985);
  withCredits(am.accounts[0]);
  for (let i = 0; i < 5; i++) assert.equal(pick(am)?.name, 'c');
  assert.equal(am.onPlanRemainder(am.accounts[0]), true);
  assert.equal(am.onCredits(am.accounts[0]), false);
  assert.equal(am.creditsQuestionPending(am.accounts[0]), false, 'no question before the plan is spent');
});

test('the rest of a plan is spent before anyone\'s credits', () => {
  const am = new AccountManager([codex('credits', { useCredits: true, priority: -1 }), codex('remainder')], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  atPlanLimit(am.accounts[1], 0.99);
  assert.equal(pick(am)?.name, 'remainder');
  assert.equal(am.onCredits(am.accounts[0]), false);
  // Once that plan is spent too, the allowed credits take over.
  atPlanLimit(am.accounts[1]);
  assert.equal(pick(am)?.name, 'credits');
  assert.equal(am.onCredits(am.accounts[0]), true);
});

test('the rest of a plan stays Codex-only: a Claude fleet past its threshold still probes', () => {
  const claude = { name: 'claude', type: 'oauth', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600_000 };
  const am = new AccountManager([claude], 0.98);
  atPlanLimit(am.accounts[0], 0.99);
  assert.ok(am.getActiveAccount(null, 'claude-opus-5-5'), 'one probe');
  assert.equal(am.getActiveAccount(null, 'claude-opus-5-5'), null);
});

// ── an answer holds for one week ────────────────────────────────────────────

test('an answer lapses at the weekly reset it was given for, and the question returns', () => {
  const am = new AccountManager([codex('c', { useCredits: true, useCreditsUntil: Date.now() - 1 })], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  assert.equal(am.creditsAnswer(am.accounts[0]), null);
  assert.equal(pick(am), null, 'last week\'s yes does not spend this week');
  assert.equal(am.creditsQuestionPending(am.accounts[0]), true);
  assert.equal(am.getStatus().accounts[0].useCredits, null);
});

test('an answer holds until that reset', () => {
  const am = new AccountManager([codex('c', { useCredits: true, useCreditsUntil: Date.now() + 3600_000 })], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  assert.equal(am.creditsAnswer(am.accounts[0]), true);
  assert.equal(pick(am)?.name, 'c');
  assert.equal(accountUseCreditsUntil({ useCreditsUntil: 'soon' }), null);
  assert.equal(accountUseCreditsUntil({}), null);
});

test('a refilled week serves on the plan, never on credits', () => {
  const am = new AccountManager([codex('c', { useCredits: true })], 0.98);
  withCredits(am.accounts[0]);
  am.accounts[0].quota.unified7d = 0.01;
  am.accounts[0].quota.unified7dReset = Date.now() + 7 * 24 * 3600_000;
  assert.equal(pick(am)?.name, 'c');
  assert.equal(am.onCredits(am.accounts[0]), false);
  assert.equal(am.onPlanRemainder(am.accounts[0]), false);
});

test('nobody is asked while another account still has plan headroom', () => {
  const am = new AccountManager([codex('spent'), codex('fresh')], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  am.accounts[1].quota.unified7d = 0.2;
  am.accounts[1].quota.unified7dReset = Date.now() + 3600_000;
  assert.equal(am.creditsQuestionPending(am.accounts[0]), false);
  atPlanLimit(am.accounts[1]);
  assert.equal(am.creditsQuestionPending(am.accounts[0]), true);
});

test('no balance, or the owner\'s spend control tripped: credits change nothing', () => {
  for (const credits of [
    { hasCredits: false, unlimited: false, balance: 0 },
    { hasCredits: true, unlimited: false, overageLimitReached: true, balance: 500 },
  ]) {
    const am = new AccountManager([codex('c', { useCredits: true })], 0.98);
    atPlanLimit(am.accounts[0]);
    withCredits(am.accounts[0], credits);
    // Nothing to bill, so the ordinary revalidation probe goes out, then the
    // fleet refuses until the window resets.
    assert.equal(pick(am)?.name, 'c', 'one probe');
    assert.equal(pick(am), null, JSON.stringify(credits));
    assert.equal(am.creditsQuestionPending(am.accounts[0]), false);
  }
});

test('unlimited overage serves without a balance', () => {
  const am = new AccountManager([codex('c', { useCredits: true })], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0], { hasCredits: false, unlimited: true });
  assert.equal(pick(am)?.name, 'c');
  assert.equal(pick(am)?.name, 'c');
});

test('a usage cap the operator set is not overridden by credits', () => {
  const am = new AccountManager([codex('c', { useCredits: true, maxUsage: 0.9 })], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  assert.equal(pick(am), null);
  assert.equal(am.onCredits(am.accounts[0]), false);
});

test('an upstream 429 hold is not overridden by credits', () => {
  const am = new AccountManager([codex('c', { useCredits: true })], 0.98);
  atPlanLimit(am.accounts[0]);
  withCredits(am.accounts[0]);
  am.markRateLimited(0, 300);
  assert.equal(pick(am), null);
});

test('credits never touch a Claude request', () => {
  const claude = { name: 'claude', type: 'oauth', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600_000 };
  const am = new AccountManager([claude, codex('c', { useCredits: true })], 0.98);
  atPlanLimit(am.accounts[0]);
  atPlanLimit(am.accounts[1]);
  withCredits(am.accounts[1]);
  am.getActiveAccount(null, 'claude-opus-5-5');
  assert.equal(am.getActiveAccount(null, 'claude-opus-5-5'), null);
});

test('the status payload carries the setting and both derived states', () => {
  const asked = new AccountManager([codex('asked')], 0.98);
  atPlanLimit(asked.accounts[0]);
  withCredits(asked.accounts[0]);
  const a = asked.getStatus().accounts[0];
  assert.equal(a.useCredits, null);
  assert.equal(a.creditsQuestion, true);
  assert.equal(a.onCredits, false);

  // With one account already serving on its allowed credits, the other is not
  // asked: traffic flows, and nothing is waiting on an answer.
  const am = new AccountManager([codex('asked'), codex('on', { useCredits: true })], 0.98);
  for (const acc of am.accounts) { atPlanLimit(acc); withCredits(acc); }
  const rows = Object.fromEntries(am.getStatus().accounts.map(r => [r.name, r]));
  assert.equal(rows.on.useCredits, true);
  assert.equal(rows.on.onCredits, true);
  assert.equal(rows.on.creditsQuestion, false);
  assert.equal(rows.asked.creditsQuestion, false);
});

// ── what the operator is told ───────────────────────────────────────────────

test('balances are whole credits, grouped', () => {
  assert.equal(formatCredits(59933.9047185), '59,933');
  assert.equal(formatCredits(null), null);
  assert.equal(creditsLeftText({ credits: { balance: 59933.9 } }), '59,933 credits left');
  assert.equal(creditsLeftText({ credits: { unlimited: true } }), 'unlimited credits');
});

test('free limit resets are reported as held, never offered', () => {
  assert.equal(resetCreditsAside({ resetCredits: { available: 2, applicable: 0, seenAt: Date.now() } }),
    '2 free limit resets held, not used by aipool');
  assert.equal(resetCreditsAside({ resetCredits: { available: 0 } }), '');
});

test('the refusal Codex sees asks the question, with the resets alongside', () => {
  const account = { name: 'shin (codex)', quota: {
    credits: { hasCredits: true, balance: 59933.9 },
    resetCredits: { available: 2, applicable: 0, seenAt: Date.now() },
  } };
  const text = exhaustedMessage([account], MODEL, 3600) + creditsQuestionText([account]);
  assert.match(text, /"shin \(codex\)" has 59,933 credits left/);
  assert.match(text, /aipool credits on/);
  assert.match(text, /aipool credits off/);
  assert.match(text, /2 free limit resets held, not used by aipool/);
  assert.equal(creditsQuestionText([]), '');
});

function statusWith(account) {
  return {
    currentAccount: account.name, switchThreshold: 0.98, routes: [], sessions: {},
    accounts: [{ type: 'oauth', provider: 'codex', status: 'active', usage: {}, sessions: 0, ...account }],
  };
}

test('`aipool status` puts the question and the resets on one line', () => {
  const out = renderStatusCompact(statusWith({
    name: 'c', unavailable: 'quota', creditsQuestion: true, useCredits: null,
    quota: { unified7d: 0.98, credits: { hasCredits: true, balance: 59933.9 }, resetCredits: { available: 2, seenAt: Date.now() } },
  }), { color: false });
  const lines = out.split('\n').filter(l => l.includes('c: '));
  assert.equal(lines.length, 1, out);
  assert.match(lines[0], /plan limit reached, 59,933 credits left — keep going on credits\? aipool credits on \| off/);
  assert.match(lines[0], /2 free limit resets held, not used by aipool/);
});

test('`aipool status` shows an account on credits as available, and warns', () => {
  const out = renderStatusCompact(statusWith({
    name: 'c', unavailable: 'quota', onCredits: true, useCredits: true,
    quota: { unified7d: 1, credits: { hasCredits: true, balance: 1200 } },
  }), { color: false });
  assert.match(out, /on credits · 1,200 left/);
  assert.match(out, /1 of 1 account available/);
  assert.match(out, /⚠ spending purchased credits — 1,200 credits left/);
});

test('`aipool status -v` names the credits and the decision', () => {
  const paint = { dim: s => s, cyan: s => s, gray: s => s };
  const quota = { credits: { hasCredits: true, balance: 10 } };
  assert.match(purchasedCreditLine({ quota, useCredits: null }, paint), /10 credits left — not allowed yet/);
  assert.match(purchasedCreditLine({ quota, useCredits: true }, paint), /used once the plan is spent/);
  assert.match(purchasedCreditLine({ quota, useCredits: true, useCreditsUntil: Date.now() + 1000 }, paint), /until the weekly reset/);
  assert.match(purchasedCreditLine({ quota, useCredits: true, onCredits: true }, paint), /spending now/);
  assert.match(purchasedCreditLine({ quota, useCredits: false }, paint), /not used/);
  assert.equal(purchasedCreditLine({ quota: {} }, paint), null);
  assert.match(renderStatus(statusWith({ name: 'c', quota: { ...quota, unified7d: 0.5 } }), { color: false }), /Credits/);
});

test('`aipool status` keeps the balance on the card, with the setting beside it', () => {
  const quota = { unified7d: 0.4, unified7dReset: Date.now() + 3600_000, credits: { hasCredits: true, balance: 59933.9 } };
  const out = renderStatusCompact(statusWith({ name: 'c', useCredits: null, quota }), { color: false });
  assert.match(out, /Credits 59,933 left · not asked yet/);
  assert.equal(creditStanding({ quota, useCredits: true }).decision, 'on');
  assert.equal(creditStanding({ quota, useCredits: true, onCredits: true }).decision, 'spending now');
  assert.equal(creditStanding({ quota, useCredits: false }).decision, 'off');
  assert.equal(creditStanding({ quota: { credits: { ...quota.credits, overageLimitReached: true } } }).decision, 'spend limit reached');
  assert.equal(creditStanding({ quota: { credits: { hasCredits: false, balance: 0 } } }), null);
  assert.equal(/Credits/.test(renderStatusCompact(statusWith({ name: 'c', quota: { unified7d: 0.4 } }), { color: false })), false);
});

test('`aipool status` shows an account using the rest of its plan as available', () => {
  const out = renderStatusCompact(statusWith({
    name: 'c', unavailable: 'quota', onPlanRemainder: true,
    quota: { unified7d: 0.99, credits: { hasCredits: true, balance: 10 } },
  }), { color: false });
  assert.match(out, /using the rest of its plan/);
  assert.match(out, /1 of 1 account available/);
  assert.equal(/keep going on credits/.test(out), false);
});
