// `aipool peer` — messages between the Claude Code and Codex sessions on this
// machine.
//
// The two have no channel to each other, and each takes a message differently:
//
//   to Codex   `codex queue` hands the text to Codex's shared app-server daemon,
//              which runs it as the session's next turn, in the open window.
//   to Claude  Claude Code has no such entry point, so the text goes into a
//              mailbox file for that session. A hook that `aipool peer install`
//              adds to ~/.claude/settings.json watches it: an asyncRewake hook
//              that exits 2 wakes the session, idle or not, with the message as
//              its input.
//
// Claude sessions are found with `claude agents --json`, Codex sessions are the
// threads the daemon has loaded, read over its control socket. A Codex window
// that has not had a turn yet is loaded too, so it can be reached by thread id
// before anyone types into it.

import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { aipoolRef, writeFileAtomic } from './alias.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The hook's own timeout in settings.json, and how long a waiter lets itself
// run: a little less, so it ends on its own terms rather than being killed.
const HOOK_TIMEOUT_SECONDS = 604800;
const WAITER_MAX_MS = 600_000_000;
// `codex queue` only talks to the local daemon; a proxy inherited from the
// calling session has no business on that path.
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
const NOTE_START = '<!-- aipool peer -->';
const NOTE_END = '<!-- /aipool peer -->';

const USAGE = [
  'Usage: aipool peer list                         live Claude and Codex sessions',
  '       aipool peer send <session> <message|->   deliver a message (- reads stdin)',
  '            [--wait [--timeout <secs>]]         to Codex: also wait for and print its reply',
  '            [--from <name>]                     sender name, when it cannot be worked out',
  '       aipool peer read [<session>]             unread messages for a Claude session',
  '       aipool peer wait [<session>] [--timeout <secs>]',
  '       aipool peer whoami                       the session running this shell',
  '       aipool peer name <thread> <name>         name a Codex session',
  '       aipool peer install | uninstall          the wake hook and the agents\' notes',
  '',
  'A Codex session gets the message as its next turn. A Claude session gets it',
  'in its mailbox, and the hook from `aipool peer install` wakes it.',
].join('\n');

// ── paths ───────────────────────────────────────────────────

/**
 * Mailboxes, read positions and waiter locks, next to the config file. The
 * path is worked out as getConfigPath() does rather than imported: config.js
 * brings the upstream-proxy code along, and the waiter, which stays up in every
 * open Claude session, would carry it for nothing.
 */
export function peerDir() {
  const config = process.env.AIPOOL_CONFIG || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'aipool.json');
  return join(dirname(config), 'aipool-peer');
}

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

export function codexSocketPath() {
  return join(codexHome(), 'app-server-control', 'app-server-control.sock');
}

/**
 * A path as one shell word, quoted the way aipoolRef quotes one: inside double
 * quotes the shell still reads `\`, `"`, `$` and a backtick.
 * @param {string} path
 */
function quotePath(path) {
  return `"${path.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`;
}

const besideThis = (file) => realpathSync(fileURLToPath(new URL(file, import.meta.url)));

/**
 * How the agents should call aipool in the commands this module hands them:
 * the bare name when it is on PATH, else this checkout's CLI. Not aipoolRef
 * alone, which names whatever script is running, and the hook runs its own.
 */
export function cliRef() {
  const ref = aipoolRef();
  return ref === 'aipool' ? ref : quotePath(besideThis('./index.js'));
}

/**
 * The command the hook runs. It names peer-hook.js rather than the CLI: a
 * waiter stays up in every open Claude session, and loading only this module
 * keeps one close to a bare Node process instead of carrying the whole proxy.
 * @param {string} [hookPath]
 */
export function rewakeCommand(hookPath = besideThis('./peer-hook.js')) {
  return quotePath(hookPath);
}

// ── Claude sessions ─────────────────────────────────────────

/**
 * @typedef {{ name: string, sessionId: string, pid: number, cwd?: string, status?: string }} ClaudeSession
 * @typedef {{ id: string, name: string, cwd: string, status: string, path: string }} CodexThread
 */

/**
 * Interactive Claude Code sessions. Background and `-p` sessions are left out:
 * no hook watches a mailbox for them.
 * @returns {ClaudeSession[]}
 */
export function claudeSessions() {
  const r = spawnSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 20_000 });
  let list;
  try { list = JSON.parse(r.stdout || '[]'); } catch { return []; }
  return Array.isArray(list) ? list.filter(s => s?.kind === 'interactive' && s.name && UUID_RE.test(s.sessionId || '')) : [];
}

// ── Codex daemon ────────────────────────────────────────────

/**
 * One client frame. Clients must mask what they send (RFC 6455 §5.3).
 * @param {Buffer} payload
 * @param {number} [op]
 */
function wsFrame(payload, op = 1) {
  const n = payload.length;
  let head;
  if (n < 126) {
    head = Buffer.from([0x80 | op, 0x80 | n]);
  } else if (n < 65536) {
    head = Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 0xff]);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | op;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  const mask = randomBytes(4);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/**
 * A JSON-RPC connection to the Codex app-server daemon: a WebSocket on a unix
 * socket, the same one `codex queue` and `codex agents` use. Node's WebSocket
 * cannot dial a unix socket, so the few framing rules a client needs are here.
 * @param {string} [socketPath]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ request: (method: string, params?: object) => Promise<any>, notify: (method: string, params?: object) => void, close: () => void }>}
 */
export function connectCodexDaemon(socketPath = codexSocketPath(), { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
    const pending = new Map();
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let nextId = 1;
    /** @type {Buffer[]} */
    let fragments = [];

    const send = (obj) => sock.write(wsFrame(Buffer.from(JSON.stringify(obj))));
    const failAll = (err) => {
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
      pending.clear();
    };
    const client = {
      request(method, params = {}) {
        const id = nextId++;
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`codex daemon: ${method} timed out`)); }, timeoutMs);
          pending.set(id, { resolve: res, reject: rej, timer });
          send({ jsonrpc: '2.0', id, method, params });
        });
      },
      notify(method, params = {}) { send({ jsonrpc: '2.0', method, params }); },
      close() {
        try { sock.write(wsFrame(Buffer.alloc(0), 8)); } catch { /* already gone */ }
        sock.end();
      },
    };

    const handshake = setTimeout(() => { sock.destroy(); reject(new Error('codex daemon: no answer to the handshake')); }, timeoutMs);
    sock.on('connect', () => {
      const key = randomBytes(16).toString('base64');
      sock.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    sock.on('error', (err) => {
      clearTimeout(handshake);
      if (!upgraded) reject(err);
      failAll(err);
    });
    sock.on('close', () => failAll(new Error('codex daemon closed the connection')));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const status = buf.subarray(0, buf.indexOf('\r\n')).toString();
        buf = buf.subarray(end + 4);
        clearTimeout(handshake);
        if (!/^HTTP\/1\.1 101\b/.test(status)) {
          sock.destroy();
          reject(new Error(`codex daemon refused the upgrade: ${status}`));
          return;
        }
        upgraded = true;
        resolve(client);
      }
      for (let frame = readFrame(); frame; frame = readFrame()) onFrame(frame);
    });

    function readFrame() {
      if (buf.length < 2) return null;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return null;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return null;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      const maskAt = at;
      if (masked) at += 4;
      if (buf.length < at + len) return null;
      const data = Buffer.from(buf.subarray(at, at + len));
      if (masked) for (let i = 0; i < data.length; i++) data[i] ^= buf[maskAt + (i & 3)];
      buf = buf.subarray(at + len);
      return { fin, op, data };
    }

    function onFrame({ fin, op, data }) {
      if (op === 8) { sock.end(); return; }
      if (op === 9) { sock.write(wsFrame(data, 10)); return; }
      if (op === 10) return;
      // A message may arrive in pieces: a text frame without FIN, then
      // continuation frames (op 0) up to the one with FIN.
      if (op !== 0) fragments = [];
      fragments.push(data);
      if (!fin) return;
      const text = Buffer.concat(fragments).toString('utf8');
      fragments = [];
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      const p = pending.get(msg?.id);
      if (!p) return; // a notification, or an answer we stopped waiting for
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`codex daemon: ${msg.error.message || JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
    }
  });
}

/**
 * Run `fn` against an initialized daemon connection, and close it after.
 * @template T
 * @param {(rpc: Awaited<ReturnType<typeof connectCodexDaemon>>) => Promise<T>} fn
 * @param {{ socketPath?: string }} [opts]
 * @returns {Promise<T>}
 */
export async function withCodexDaemon(fn, { socketPath } = {}) {
  const rpc = await connectCodexDaemon(socketPath);
  try {
    await rpc.request('initialize', { clientInfo: { name: 'aipool-peer', version: '1' } });
    rpc.notify('initialized');
    return await fn(rpc);
  } finally {
    rpc.close();
  }
}

/**
 * The Codex sessions the daemon has loaded, or null when the daemon is not
 * running (nothing listens on its socket).
 * @param {{ socketPath?: string }} [opts]
 * @returns {Promise<CodexThread[] | null>}
 */
export async function codexThreads(opts) {
  try {
    return await withCodexDaemon(async (rpc) => {
      const ids = (await rpc.request('thread/loaded/list'))?.data || [];
      const out = [];
      for (const id of ids) {
        const t = (await rpc.request('thread/read', { threadId: id }).catch(() => null))?.thread || {};
        out.push({ id: t.id || id, name: t.name || '', cwd: t.cwd || '', status: t.status?.type || '', path: t.path || '' });
      }
      return out;
    }, opts);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') return null;
    throw err;
  }
}

/** A session's rollout file, for a thread the daemon did not report a path for. */
function findRollout(threadId) {
  const root = join(codexHome(), 'sessions');
  const desc = (dir) => { try { return readdirSync(dir).sort().reverse(); } catch { return []; } };
  for (const y of desc(root)) for (const m of desc(join(root, y))) for (const d of desc(join(root, y, m))) {
    const hit = desc(join(root, y, m, d)).find(f => f.endsWith(`-${threadId}.jsonl`));
    if (hit) return join(root, y, m, d, hit);
  }
  return '';
}

// ── who is who ──────────────────────────────────────────────

/** Process ids from this process's parent up to launchd/init. */
function ancestorPids() {
  const r = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const parent = new Map();
  for (const line of (r.stdout || '').split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid) parent.set(pid, ppid);
  }
  const out = [];
  for (let pid = process.ppid; pid > 1 && out.length < 64 && !out.includes(pid); pid = parent.get(pid)) out.push(pid);
  return out;
}

/**
 * The session this shell runs in. Codex puts its thread id in every command's
 * environment; a Claude session is the one whose process is an ancestor.
 * @param {{ env?: NodeJS.ProcessEnv, sessions?: () => ClaudeSession[], threads?: () => Promise<CodexThread[] | null>, ancestors?: () => number[] }} [deps]
 * @returns {Promise<{ kind: 'claude' | 'codex' | null, id: string, name: string } | null>}
 */
export async function whoami({ env = process.env, sessions = claudeSessions, threads = codexThreads, ancestors = ancestorPids } = {}) {
  if (env.CODEX_THREAD_ID) {
    const id = env.CODEX_THREAD_ID;
    const t = (await threads().catch(() => null))?.find(x => x.id === id);
    return { kind: 'codex', id, name: t?.name || id };
  }
  const anc = new Set(ancestors());
  const s = sessions().find(x => anc.has(x.pid));
  if (s) return { kind: 'claude', id: s.sessionId, name: s.name };
  if (env.AIPOOL_PEER_NAME) return { kind: null, id: env.AIPOOL_PEER_NAME, name: env.AIPOOL_PEER_NAME };
  return null;
}

/**
 * What a name on the command line points at: a Claude session by name, session
 * id or pid, or a Codex session by thread id or name. A bare UUID nobody lists
 * is taken for a Codex thread that is saved but not open; `codex queue` can
 * still reach it.
 * @param {string} target
 * @param {ClaudeSession[]} sessions
 * @param {CodexThread[] | null} threads
 */
export function resolveTarget(target, sessions, threads) {
  const s = sessions.find(x => target === x.name || target === x.sessionId || target === String(x.pid));
  if (s) return { kind: 'claude', id: s.sessionId, name: s.name };
  const t = (threads || []).find(x => target === x.id || (x.name && target === x.name));
  if (t) return { kind: 'codex', id: t.id, name: t.name || t.id, path: t.path };
  if (UUID_RE.test(target)) return { kind: 'codex', id: target, name: target, path: '' };
  return null;
}

// ── mailboxes (to Claude) ───────────────────────────────────

function mailboxPath(sessionId) {
  if (!UUID_RE.test(sessionId)) throw new Error(`not a session id: ${sessionId}`);
  return join(peerDir(), 'inbox', `${sessionId}.jsonl`);
}

function cursorPath(sessionId) {
  return join(peerDir(), 'cursor', sessionId);
}

/**
 * @param {string} sessionId
 * @param {{ from: string, replyTo?: string, text: string }} msg  `from` names the
 *   sender for people; `replyTo` is what `peer send` takes to answer it
 */
export function postToMailbox(sessionId, { from, replyTo = from, text }) {
  const path = mailboxPath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), from, replyTo, text }) + '\n');
}

/**
 * The messages that arrived since the last call, which become read. A line
 * still being written (no newline yet) is left for the next call.
 * @param {string} sessionId
 * @returns {{ ts: string, from: string, replyTo?: string, text: string }[]}
 */
export function takeFromMailbox(sessionId) {
  const path = mailboxPath(sessionId);
  let pos = 0;
  try { pos = Number(readFileSync(cursorPath(sessionId), 'utf8')) || 0; } catch { /* nothing read yet */ }
  let fd;
  try { fd = openSync(path, 'r'); } catch { return []; }
  let chunk;
  try {
    const size = fstatSync(fd).size;
    if (size < pos) pos = 0; // the file was replaced
    chunk = Buffer.alloc(size - pos);
    readSync(fd, chunk, 0, chunk.length, pos);
  } finally {
    closeSync(fd);
  }
  const end = chunk.lastIndexOf(0x0a) + 1;
  if (end === 0) return [];
  const msgs = [];
  for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
    if (!line) continue;
    try { msgs.push(JSON.parse(line)); } catch { /* a torn line is skipped, not fatal */ }
  }
  mkdirSync(dirname(cursorPath(sessionId)), { recursive: true });
  writeFileSync(cursorPath(sessionId), String(pos + end));
  return msgs;
}

/**
 * A session address as one shell word. Codex names a session after its first
 * message, spaces and all, and an unquoted one in a reply command would split.
 * @param {string} s
 */
export function shellWord(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'"'"'`)}'`;
}

/** An ISO time as local `YYYY-MM-DD HH:MM:SS`. */
function localTime(ts) {
  const d = new Date(ts || NaN);
  if (Number.isNaN(d.getTime())) return ts || '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** @param {{ ts?: string, from?: string, text?: string }[]} msgs */
export function formatMessages(msgs) {
  return msgs.map(m => `[peer from ${m.from || '?'} · ${localTime(m.ts)}]\n${m.text || ''}\n`).join('\n');
}

// ── to Codex ────────────────────────────────────────────────

/**
 * What lands in the Codex session: the text, marked as coming from another
 * agent, and how the answer gets back.
 * @param {{ from: string, replyTo?: string, text: string, wait: boolean, ref?: string }} m
 */
export function codexMessage({ from, replyTo = from, text, wait, ref = cliRef() }) {
  const how = wait
    ? `Your answer in this turn goes back to ${from} as is.`
    : `To answer it: ${ref} peer send ${shellWord(replyTo)} "..."`;
  return `[peer from ${from}] ${text}\n(Sent by another agent session, not the user. ${how})`;
}

/**
 * The reply to a message queued into a Codex session: the final answer of the
 * turn that carried it, read from the session's rollout file from `offset` on.
 * The turn is found by the message text, so another sender's queued turn in
 * between is not mistaken for ours.
 * @param {string} path
 * @param {number} offset  the file's size before the message was queued
 * @param {string} body    the queued text
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function waitForCodexReply(path, offset, body, { timeoutMs = 900_000, pollMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let rest = Buffer.alloc(0);
  let queuedTurn = null;
  let turn = null;
  for (;;) {
    let fd = null;
    try { fd = openSync(path, 'r'); } catch { /* not written yet */ }
    if (fd !== null) {
      try {
        const size = fstatSync(fd).size;
        if (size > offset) {
          const chunk = Buffer.alloc(size - offset);
          readSync(fd, chunk, 0, chunk.length, offset);
          offset = size;
          rest = Buffer.concat([rest, chunk]);
        }
      } finally {
        closeSync(fd);
      }
    }
    const end = rest.lastIndexOf(0x0a) + 1;
    const lines = rest.subarray(0, end).toString('utf8').split('\n');
    rest = rest.subarray(end);
    for (const line of lines) {
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const p = r?.payload || {};
      if (p.type === 'task_started' && p.turn_attribution?.turn_trigger === 'queue') {
        queuedTurn = p.turn_id || p.turn_attribution.turn_id;
      } else if (!turn && p.type === 'message' && p.role === 'user'
        && (p.content || []).some(c => typeof c?.text === 'string' && c.text.includes(body))) {
        turn = p.internal_chat_message_metadata_passthrough?.turn_id || queuedTurn;
      } else if (turn && p.type === 'task_complete' && p.turn_id === turn) {
        return p.last_agent_message || '';
      }
    }
    if (Date.now() >= deadline) throw new Error(`no reply within ${Math.round(timeoutMs / 1000)}s (the turn may still be running)`);
    await new Promise(r => setTimeout(r, pollMs));
  }
}

function queueToCodex(threadId, body) {
  const env = { ...process.env };
  for (const k of PROXY_VARS) delete env[k];
  return spawnSync('codex', ['queue', '--thread', threadId, '--message', body], { encoding: 'utf8', env });
}

// ── the wake hook ───────────────────────────────────────────

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * One waiter per session: the hook runs again at the end of every turn, and a
 * waiter already watching the mailbox is left to it. A lock left by a waiter
 * that died is taken over.
 * @returns {(() => void) | null}  releases the lock, or null when another holds it
 */
function takeWaiterLock(sessionId) {
  const path = join(peerDir(), 'waiter', `${sessionId}.lock`);
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' });
      return () => { try { if (readFileSync(path, 'utf8') === String(process.pid)) rmSync(path); } catch { /* gone */ } };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = Number(readFileSync(path, 'utf8')) || 0;
      if (holder && alive(holder)) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

/**
 * The asyncRewake hook (SessionStart and Stop). Watches this session's mailbox
 * and, when something arrives, writes it to stderr and returns 2: Claude Code
 * hands that to the model and wakes the session. Returns 0 without waiting for
 * a session that is not interactive, and when the session's process is gone.
 * @param {string} input  the hook's JSON from stdin
 * @param {{ sessions?: () => ClaudeSession[], write?: (s: string) => void, pollMs?: number, findTries?: number, findGapMs?: number, maxMs?: number }} [deps]
 * @returns {Promise<number>}
 */
export async function rewake(input, { sessions = claudeSessions, write = s => process.stderr.write(s), pollMs = 1000, findTries = 3, findGapMs = 10_000, maxMs = WAITER_MAX_MS } = {}) {
  let sessionId = '';
  try { sessionId = JSON.parse(input)?.session_id || ''; } catch { return 0; }
  if (!UUID_RE.test(sessionId)) return 0;
  const release = takeWaiterLock(sessionId);
  if (!release) return 0;
  // A waiter is usually ended by a signal, when its session closes; the lock
  // goes with it rather than waiting to be found stale.
  process.on('exit', release);
  try {
    // A session that has only just started may not be listed yet.
    let pid = 0;
    for (let i = 0; i < findTries && !pid; i++) {
      if (i) await new Promise(r => setTimeout(r, findGapMs));
      pid = sessions().find(s => s.sessionId === sessionId)?.pid || 0;
    }
    if (!pid) return 0;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline && alive(pid)) {
      const msgs = takeFromMailbox(sessionId);
      if (msgs.length) {
        const to = [...new Set(msgs.map(m => m.replyTo || m.from).filter(Boolean))].map(shellWord);
        const how = to.length === 1 ? `peer send ${to[0]} "..."` : `peer send <sender> "..." (senders: ${to.join(', ')})`;
        write(`[aipool peer] A message from another agent session (not the user). To answer it: ${cliRef()} ${how}\n\n${formatMessages(msgs)}`);
        return 2;
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    return 0;
  } finally {
    process.off('exit', release);
    release();
  }
}

/** peer-hook.js: the hook's JSON on stdin, and an exit on the usual signals. */
export async function rewakeMain() {
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(sig, () => process.exit(0));
  return rewake(await readStdin());
}

// ── install ─────────────────────────────────────────────────

// Ours, and the `peer rewake` hook of the standalone tool this replaces.
const isOurHook = (h) => typeof h?.command === 'string' && /(peer-hook\.js"?|(^|\s)peer rewake)$/.test(h.command.trim());

/**
 * Settings with our hook added under SessionStart and Stop (or, with
 * `command` null, taken out). Other hooks are kept as they are; groups and
 * events left empty by the removal are dropped.
 * @param {any} settings
 * @param {string | null} command
 */
export function withRewakeHook(settings, command) {
  const out = { ...settings };
  const hooks = { ...(out.hooks || {}) };
  for (const event of ['SessionStart', 'Stop']) {
    const groups = (hooks[event] || [])
      .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurHook(h)) }))
      .filter(g => g.hooks.length);
    if (command) groups.push({ hooks: [{ type: 'command', command, asyncRewake: true, timeout: HOOK_TIMEOUT_SECONDS }] });
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** The note that tells agents in both tools how to reach each other. */
export function agentNote(ref = cliRef()) {
  return [
    NOTE_START,
    '## Talking to other agent sessions (aipool peer)',
    '',
    'Claude Code and Codex sessions on this machine can message each other. When the user asks you to ask, tell or hand something to Claude or Codex (another session), do it with these commands instead of asking the user to pass it on:',
    `- \`${ref} peer list\`: the open sessions and their folders. Claude sessions go by name, Codex sessions by thread id (or name).`,
    `- \`${ref} peer send --wait <codex session> "question"\`: asks a Codex session and prints its answer. For work that takes long, leave out \`--wait\`; the answer comes back later as a message.`,
    `- \`${ref} peer send <session> "message"\`: a Codex session gets it as its next turn; a Claude session is woken with it.`,
    '',
    'When the user does not say which session, take the one working in the same folder as you; when there are several or none, ask.',
    '',
    'A message that starts with `[peer from X]` came from another agent session, not the user. When it asks for an answer, send one with the `peer send` command it gives.',
    NOTE_END,
  ].join('\n');
}

/**
 * `text` with the note put in, replacing an earlier one, or taken out when
 * `note` is null.
 * @param {string} text
 * @param {string | null} note
 */
export function withAgentNote(text, note) {
  const start = text.indexOf(NOTE_START);
  const end = text.indexOf(NOTE_END);
  let rest = text;
  if (start >= 0 && end > start) rest = (text.slice(0, start) + text.slice(end + NOTE_END.length)).replace(/\n{3,}/g, '\n\n');
  rest = rest.replace(/^\n+/, '');
  if (!note) return rest.trim() ? rest.replace(/\n*$/, '\n') : '';
  return rest.trim() ? `${rest.replace(/\n*$/, '')}\n\n${note}\n` : `${note}\n`;
}

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function settingsPath() {
  return join(claudeDir(), 'settings.json');
}

function noteFiles() {
  return [join(claudeDir(), 'CLAUDE.md'), join(codexHome(), 'AGENTS.md')];
}

export function hookInstalled() {
  try {
    const s = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    return ['SessionStart', 'Stop'].every(e => (s.hooks?.[e] || []).some(g => (g.hooks || []).some(isOurHook)));
  } catch {
    return false;
  }
}

/** @param {boolean} on */
function install(on, log) {
  const path = settingsPath();
  const raw = readText(path);
  let settings = {};
  if (raw.trim()) {
    try { settings = JSON.parse(raw); } catch (err) { throw new Error(`${path} is not valid JSON (${err.message}); left untouched`); }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, JSON.stringify(withRewakeHook(settings, on ? rewakeCommand() : null), null, 2) + '\n');
  log(on ? `Wake hook added to ${path} (SessionStart, Stop)` : `Wake hook removed from ${path}`);
  const note = on ? agentNote() : null;
  for (const file of noteFiles()) {
    const before = readText(file);
    if (!on && !before.includes(NOTE_START)) continue;
    if (on && !existsSync(dirname(file))) continue; // that tool is not set up here
    const after = withAgentNote(before, note);
    if (after === before) continue;
    if (after) writeFileAtomic(file, after);
    else rmSync(file, { force: true });
    log(on ? `Note for agents written to ${file}` : `Note for agents removed from ${file}`);
  }
}

// ── command ─────────────────────────────────────────────────

/**
 * Pull the known options out of argv, wherever they stand; anything else,
 * and everything after `--`, is left as words.
 * @param {string[]} argv
 * @param {{ values?: string[], flags?: string[] }} known
 */
function parseOpts(argv, { values = [], flags = [] }) {
  /** @type {Record<string, string | boolean>} */
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    const key = a.startsWith('--') ? a.slice(2) : '';
    if (values.includes(key)) opts[key] = argv[++i] ?? '';
    else if (flags.includes(key)) opts[key] = true;
    else rest.push(a);
  }
  return { opts, rest };
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/**
 * The Claude session a read or wait is for: the one named, or this shell's.
 * @param {string | undefined} name
 */
async function mailboxOwner(name) {
  if (name) {
    const t = resolveTarget(name, claudeSessions(), []);
    if (t?.kind === 'claude') return t;
    throw new Error(`no Claude session called ${name} (see: aipool peer list)`);
  }
  const me = await whoami({ threads: async () => null });
  if (me?.kind === 'claude') return me;
  throw new Error('this shell is not inside a Claude session; name one (see: aipool peer list)');
}

/**
 * @param {string[]} argv  what follows `aipool peer`
 * @returns {Promise<number>} the exit code
 */
export async function peerCommand(argv) {
  const [sub, ...args] = argv;
  try {
    switch (sub) {
      case 'list': {
        const [sessions, threads] = [claudeSessions(), await codexThreads()];
        console.log('Claude sessions');
        if (!sessions.length) console.log('  (none)');
        for (const s of sessions) console.log(`  ${s.name.padEnd(36)} ${String(s.status || '').padEnd(5)}  ${s.cwd || ''}`);
        console.log('Codex sessions');
        if (threads === null) console.log('  (the Codex daemon is not running: codex app-server daemon start)');
        else if (!threads.length) console.log('  (none open)');
        for (const t of threads || []) console.log(`  ${t.id}  ${(t.name || '-').padEnd(20)} ${String(t.status).padEnd(6)} ${t.cwd}`);
        return 0;
      }
      case 'whoami': {
        const me = await whoami();
        if (!me) { console.error('aipool peer: cannot tell which session this shell belongs to (set AIPOOL_PEER_NAME)'); return 1; }
        console.log(me.kind ? `${me.name} (${me.kind === 'claude' ? 'Claude' : 'Codex'} ${me.id})` : me.name);
        return 0;
      }
      case 'send': {
        const { opts, rest } = parseOpts(args, { values: ['from', 'timeout'], flags: ['wait'] });
        if (rest.length < 2) { console.error(USAGE); return 2; }
        const [target, ...words] = rest;
        let text = words.join(' ');
        if (text === '-') text = (await readStdin()).trim();
        if (!text) { console.error('aipool peer: empty message'); return 2; }
        const sessions = claudeSessions();
        const threads = await codexThreads();
        const to = resolveTarget(target, sessions, threads);
        if (!to) { console.error(`aipool peer: no session called ${target} (see: aipool peer list)`); return 2; }
        const named = typeof opts.from === 'string' ? opts.from : '';
        const me = named ? null : await whoami({ sessions: () => sessions, threads: async () => threads });
        const from = named || me?.name || 'unknown';
        // Answers come back by session id: it survives the renames a name does not.
        const replyTo = named || me?.id || from;
        if (to.kind === 'claude') {
          if (opts.wait) console.error('aipool peer: --wait is for Codex sessions; a Claude session answers with its own peer send');
          postToMailbox(to.id, { from, replyTo, text });
          console.log(hookInstalled()
            ? `Delivered to Claude session ${to.name}; its hook wakes it within a second.`
            : `Left in the mailbox of Claude session ${to.name}. No wake hook is installed (aipool peer install), so it is seen on: aipool peer read ${to.name}`);
          return 0;
        }
        const wait = Boolean(opts.wait);
        const body = codexMessage({ from, replyTo, text, wait });
        const path = to.path || findRollout(to.id);
        let offset = 0;
        try { offset = path ? fstatSize(path) : 0; } catch { /* no turns yet */ }
        const q = queueToCodex(to.id, body);
        if (q.status !== 0) {
          console.error(`aipool peer: codex queue failed: ${(q.stderr || q.stdout || q.error?.message || '').trim()}`);
          return 1;
        }
        if (!wait) { console.log(`Queued for Codex session ${to.name}.`); return 0; }
        // A window with no turns yet has its rollout file written by this one.
        let rollout = path;
        for (let i = 0; i < 20 && !rollout; i++) {
          await new Promise(r => setTimeout(r, 500));
          rollout = (await codexThreads())?.find(t => t.id === to.id)?.path || findRollout(to.id);
        }
        if (!rollout) { console.error(`aipool peer: queued, but no session file for ${to.id} to read the reply from`); return 1; }
        const timeoutMs = (Number(opts.timeout) || 900) * 1000;
        console.log(await waitForCodexReply(rollout, offset, body, { timeoutMs }));
        return 0;
      }
      case 'read':
      case 'wait': {
        const { opts, rest } = parseOpts(args, { values: ['timeout'] });
        const owner = await mailboxOwner(rest[0]);
        const deadline = Date.now() + (Number(opts.timeout) || Infinity) * 1000;
        for (;;) {
          const msgs = takeFromMailbox(owner.id);
          if (msgs.length) { console.log(formatMessages(msgs)); return 0; }
          if (sub === 'read') { console.log('(no new messages)'); return 0; }
          if (Date.now() >= deadline) { console.log(`(nothing for ${owner.name} within ${opts.timeout}s)`); return 3; }
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      case 'name': {
        if (args.length < 2) { console.error(USAGE); return 2; }
        const [threadId, ...words] = args;
        await withCodexDaemon(rpc => rpc.request('thread/name/set', { threadId, name: words.join(' ') }));
        console.log(`Named ${threadId}: ${words.join(' ')}`);
        return 0;
      }
      case 'install':
      case 'uninstall':
        install(sub === 'install', console.log);
        if (sub === 'install') console.log('Claude sessions started from now on watch their mailbox; restart open ones to include them.');
        return 0;
      case 'rewake':
        return await rewakeMain();
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(USAGE);
        return 0;
      default:
        console.error(`Unknown peer command: ${sub}\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    console.error(`aipool peer: ${err.message}`);
    return 1;
  }
}

function fstatSize(path) {
  const fd = openSync(path, 'r');
  try { return fstatSync(fd).size; } finally { closeSync(fd); }
}
