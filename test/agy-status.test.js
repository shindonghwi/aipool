import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgyStatus } from '../src/agy-status.js';

test('formats observed quotas and marks old observations', () => {
  const data = { email: 'user@example.com', observedAt: 1000, quota: {
    'gemini-weekly': { remaining_fraction: 0.42 },
    unknown: { remaining_fraction: null },
  } };
  assert.equal(formatAgyStatus(data, 1000), 'Antigravity: user@example.com · gemini-weekly 42% left');
  assert.match(formatAgyStatus(data, 700_000), /last observed/);
});
