import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusCompact } from '../src/status-renderer.js';

// The default `aipool status`, for the person using the fleet: can I keep
// working, what is each account doing, how much is LEFT, anything to act on.
// The full breakdown (renderStatus) stays behind -v and has its own tests.

const NOW = Date.parse('2026-09-30T00:00:00Z');
const inMs = ms => new Date(NOW + ms).toISOString();
const H = 3600_000;

function status(overrides = {}) {
  return {
    currentAccount: 'b@example.com',
    switchThreshold: 0.98,
    server: { uptimeSeconds: 300 },
    sessions: { active: 2, known: 3, mode: 'adaptive' },
    probe: { enabled: false },
    routes: [{ match: ['*fable*'], autocreated: true, accounts: [] }],
    accounts: [
      { name: 'off@example.com', type: 'oauth', disabled: true, unavailable: 'disabled', quota: { unified7d: 0.96, unified7dReset: inMs(5 * 24 * H) } },
      { name: 'a@example.com', type: 'oauth', unavailable: 'quota', quota: { unified5h: 0, unified7d: 1, unified7dReset: inMs(52 * H), unified7dFable: 0.85 } },
      { name: 'b@example.com', type: 'oauth', sessions: 2, quota: { unified5h: 0.22, unified5hReset: inMs(3 * H), unified7d: 0.34, unified7dFable: 0 } },
      { name: 'c@example.com', type: 'oauth', quota: { unified5h: 0.1, unified7d: 0.8 } },
    ],
    ...overrides,
  };
}

const render = s => renderStatusCompact(s, { color: false, now: NOW });
// An account's card: its header line and the bar lines under it.
const cardOf = (out, name) => {
  const all = out.split('\n');
  const start = all.findIndex(l => l.slice(2).startsWith(`${name}@`));
  if (start < 0) return '';
  const end = all.findIndex((l, i) => i > start && l === '');
  return all.slice(start, end < 0 ? undefined : end).join('\n');
};
const rowOf = (out, name) => cardOf(out, name).split('\n')[0];

test('the header answers whether work can go on', () => {
  assert.match(render(status()), /● 2 of 4 accounts available · 2 sessions active · up 5m/);
});

test('with nothing available the header says so and when the first account is back', () => {
  const s = status();
  s.accounts = [s.accounts[0], s.accounts[1]];
  assert.match(render(s), /● no account available — next back in 2d4h/);
});

test('each window is a bar with how full it is and when it resets', () => {
  const b = cardOf(render(status()), 'b');
  assert.match(b, /5h {6}\[█{7}░{23}\]  22%  resets in 3h/);
  assert.match(b, /Weekly {2}\[█{10}░{20}\]  34%$/m);
  assert.match(b, /Fable {3}\[░{30}\]   0%/);
  assert.match(cardOf(render(status()), 'a'), /Weekly {2}\[█{30}\] 100%  resets in 2d4h/);
});

test('a window with no reading yet says so instead of drawing zero', () => {
  assert.match(cardOf(render(status()), 'off'), /5h {6}\[·{30}\] {4}–  no reading yet/);
});

test('the fleet line averages the weekly window over enabled accounts', () => {
  // a 100%, b 34%, c 80% — the disabled account's 96% is left out.
  assert.match(render(status()), /Fleet weekly \[█+░+\] 71% used · average of 3 enabled accounts/);
});

test('each account states what it is doing, and a blocked one when it is back', () => {
  const out = render(status());
  assert.match(rowOf(out, 'b'), /in use · 2 active/);
  assert.match(rowOf(out, 'c'), /ready/);
  assert.match(rowOf(out, 'a'), /limit reached · back in 2d4h/);
  assert.match(rowOf(out, 'off'), /disabled/);
});

test('accounts are listed most useful first: in use, ready, out, disabled', () => {
  const out = render(status());
  const at = ['b', 'c', 'a', 'off'].map(n => out.indexOf(`${n}@example.com`));
  assert.ok(at.every(i => i > 0), out);
  assert.deepEqual([...at].sort((x, y) => x - y), at);
});

test('the state dot is filled for in use and out, hollow for ready and disabled', () => {
  const out = render(status());
  assert.match(rowOf(out, 'b'), /^● /);
  assert.match(rowOf(out, 'a'), /^● /);
  assert.match(rowOf(out, 'c'), /^○ /);
  assert.match(rowOf(out, 'off'), /^○ /);
});

test('rotation settings and learner internals are left to -v', () => {
  const out = render(status());
  for (const noise of ['Adaptive', 'adaptive', 'Probe', 'Usage', 'Models', 'oauth', 'prio', 'Routing', 'switch at', '98%']) {
    assert.ok(!out.includes(noise), `unexpected "${noise}" in:\n${out}`);
  }
  assert.match(out, /aipool status -v/);
  assert.doesNotMatch(out, /Needs attention/, 'nothing here needs a person');
});

test('a rate-limited account is back when its hold ends', () => {
  const s = status();
  s.accounts[3].unavailable = 'throttled';
  s.accounts[3].rateLimitedUntil = inMs(3 * 60_000);
  assert.match(rowOf(render(s), 'c'), /rate limited · back in 3m/);
});

test('money, a broken account and a stale probe land under Needs attention', () => {
  const s = status({ probe: { enabled: true, accounts: [{ name: 'c@example.com', status: 'failed', error: 'HTTP 500' }] } });
  s.accounts[2].quota.spend = { enabled: true, usedMinor: 1234, currency: 'USD' };
  s.accounts.push({ name: 'err@example.com', type: 'oauth', status: 'error', unavailable: 'error', quota: {} });
  const out = render(s);
  const section = out.slice(out.indexOf('Needs attention'));
  assert.match(section, /b@example\.com: ⚠ billing real money/);
  assert.match(section, /err@example\.com: account error/);
  assert.match(section, /c@example\.com: quota figures are not refreshing \(HTTP 500\)/);
  assert.match(rowOf(out, 'err'), /error/);
});

test('configured routes and blocked models are still shown', () => {
  const out = render(status({
    blockedModels: ['*fable*'],
    routes: [{ match: ['*opus*'], accounts: [{ name: 'b@example.com', eligible: true }] }],
  }));
  assert.match(out, /blocked models \*fable\*/);
  assert.match(out, /Routes\n {2}\*opus\* → b@example\.com/);
});

test('a window no account reports is not drawn', () => {
  assert.doesNotMatch(render(status()), /Sonnet/);
});

test('an account without the unified windows carries its own figure in its state', () => {
  const s = status();
  s.accounts.push({ name: 'key@example.com', type: 'apikey', quota: { tokensLimit: 100, tokensRemaining: 60 } });
  const card = cardOf(render(s), 'key');
  assert.match(card, /ready · tokens 60% left/);
  assert.equal(card.split('\n').length, 1, 'no empty bars for windows it does not have');
});

test('an empty fleet points at login', () => {
  assert.match(render({ accounts: [] }), /no accounts — add one with: aipool login/);
});

test('expiry routing, when on, is named in the header', () => {
  assert.doesNotMatch(render(status()), /soonest-expiring/);
  assert.match(render(status({ expiryRouting: { enabled: true, tolerance: 1.5 } })), /spending soonest-expiring quota first/);
});
