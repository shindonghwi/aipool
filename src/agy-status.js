import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const cacheDir = join(homedir(), '.cache', 'aipool');
const cachePath = join(cacheDir, 'agy-status.json');

/** @returns {{email: string, quota: Record<string, any>, observedAt: number}|null} */
export function readAgyStatus() {
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (!data || typeof data.observedAt !== 'number' || !data.email || !data.quota) return null;
    return data;
  } catch { return null; }
}

/**
 * @param {{email: string, quota: Record<string, any>, observedAt: number}|null} data
 * @param {number} [now]
 */
export function formatAgyStatus(data, now = Date.now()) {
  if (!data) return '';
  const buckets = Object.entries(data.quota).flatMap(([name, value]) => {
    if (value?.remaining_fraction == null) return [];
    const fraction = Number(value?.remaining_fraction);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return [];
    return [`${name.replace(/[^a-zA-Z0-9_-]/g, '')} ${Math.round(fraction * 100)}% left`];
  });
  const email = String(data.email).replace(/[^a-zA-Z0-9@._+-]/g, '').slice(0, 100);
  const stale = now - data.observedAt > 10 * 60_000 ? ' (last observed)' : '';
  return `Antigravity: ${email}${buckets.length ? ` · ${buckets.join(' · ')}` : ' · quota unavailable'}${stale}`;
}

// The CLI calls this status-line command with its current state on stdin.
async function capture() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1_000_000) return;
  }
  try {
    const state = JSON.parse(input);
    if (!state.email || !state.quota || typeof state.quota !== 'object') return;
    const data = { email: state.email, quota: state.quota, observedAt: Date.now() };
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const tmp = `${cachePath}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, cachePath);
  } catch { /* Never interrupt the user's CLI for a status update. */ }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await capture();
