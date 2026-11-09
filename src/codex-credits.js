// What the operator is told about a Codex account's credits.
//
// Two different things share the word, and the operator is told about both in
// the same breath:
//
//  - Purchased credits (`quota.credits`) are bought, and ChatGPT spends them on
//    traffic once the plan's usage limit is reached. aipool does not spend them
//    until the operator says so: the first time an account would need them, the
//    question goes out (`aipool status`, the refusal Codex sees), and the answer
//    is kept as `accounts[].useCredits` by `aipool credits on|off`.
//  - Free rate-limit reset credits (`quota.resetCredits`) reset a spent window.
//    aipool only reports that an account holds some; it never redeems one.
//
// Kept apart from status-renderer.js so the proxy can phrase its refusal with
// the same words without importing the status screen.

import { safeLine } from './safe-text.js';

// How long a reset-credit reading is worth showing. Nothing refreshes the count
// but the usage probe, and the probe is off by default, so a credit that was
// redeemed or expired would otherwise stay on screen indefinitely. A week is the
// longest Codex window: past it, every window the credit could have reset has
// reset on its own, and the reading describes a situation that is gone.
export const RESET_CREDIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many reset credits to REPORT for this quota: the held count while the
 * reading is fresh, 0 once it is older than RESET_CREDIT_MAX_AGE_MS or states
 * no positive count. One rule for the status screen and the TUI row, so the two
 * cannot disagree about whether a credit is there (the dashboard page applies
 * the same cut-off in its own serialized helper).
 *
 * A reading with no `seenAt` is shown: its age is unknown rather than old, and
 * every reading the proxy stores itself is stamped.
 *
 * @param {Record<string, any>|null|undefined} quota
 * @param {number} [now]  ms epoch the age is measured from
 * @returns {number}
 */
export function heldResetCredits(quota, now = Date.now()) {
  const credits = quota?.resetCredits;
  const available = credits?.available;
  if (!Number.isFinite(available) || available <= 0) return 0;
  if (Number.isFinite(credits.seenAt) && now - credits.seenAt > RESET_CREDIT_MAX_AGE_MS) return 0;
  return available;
}

/**
 * A credit balance as a person reads it: whole credits, thousands grouped.
 * Null when there is no balance to show.
 * @param {unknown} balance
 * @returns {string|null}
 */
export function formatCredits(balance) {
  const n = Number(balance);
  if (balance == null || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n).toLocaleString('en-US');
}

/**
 * "59,934 credits left" — or "credits" alone when the balance is unknown or the
 * workspace pays for overage without one.
 * @param {Record<string, any>|null|undefined} quota
 */
export function creditsLeftText(quota) {
  const c = quota?.credits;
  if (c?.unlimited === true) return 'unlimited credits';
  const balance = formatCredits(c?.balance);
  return balance ? `${balance} credits left` : 'credits';
}

/**
 * The aside about free reset credits that rides along with the credit
 * question: they are there, and aipool will not use them. Empty when the
 * account holds none.
 * @param {Record<string, any>|null|undefined} quota
 * @param {number} [now]
 */
export function resetCreditsAside(quota, now = Date.now()) {
  const held = heldResetCredits(quota, now);
  if (!held) return '';
  return `${held} free limit reset${held === 1 ? '' : 's'} held, not used by aipool`;
}

/**
 * The sentence appended to the proxy's refusal when an account out of plan
 * quota holds credits nobody has said it may spend. Codex shows the refusal to
 * the person who just got stopped, which is exactly who can answer. Empty when
 * no account is waiting on the question.
 *
 * @param {Record<string, any>[]} accounts  the accounts whose question is pending
 * @param {number} [now]
 * @returns {string}
 */
export function creditsQuestionText(accounts, now = Date.now()) {
  if (!accounts.length) return '';
  const answer = 'run `aipool credits on` to keep going on them, or `aipool credits off` to stop asking.';
  if (accounts.length === 1) {
    const [account] = accounts;
    const aside = resetCreditsAside(account.quota, now);
    return ` "${safeLine(account.name, 64)}" has ${creditsLeftText(account.quota)}: ${answer}`
      + (aside ? ` (${aside}.)` : '');
  }
  return ` ${accounts.length} accounts hold purchased credits: ${answer}`;
}
