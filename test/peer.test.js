import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentNote,
  cliRef,
  codexMessage,
  codexThreads,
  postToMailbox,
  resolveTarget,
  rewake,
  rewakeCommand,
  shellWord,
  takeFromMailbox,
  waitForCodexReply,
  whoami,
  withAgentNote,
  withRewakeHook,
} from '../src/peer.js';

const SID = '3f2b6c1e-8d4a-4e5f-9a7b-1c2d3e4f5a6b';
const TID = '0198a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b';

// Mailboxes live next to the config file; point it at a scratch directory.
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'aipool-peer-'));
  const prev = process.env.AIPOOL_CONFIG;
  process.env.AIPOOL_CONFIG = join(dir, 'aipool.json');
  return { dir, done: () => { process.env.AIPOOL_CONFIG = prev; if (prev === undefined) delete process.env.AIPOOL_CONFIG; rmSync(dir, { recursive: true, force: true }); } };
}

test('a mailbox hands each message over once, in order', () => {
  const s = scratch();
  try {
    assert.deepEqual(takeFromMailbox(SID), []);
    postToMailbox(SID, { from: 'codex-a', text: 'one' });
    postToMailbox(SID, { from: 'codex-a', text: 'two\nlines' });
    assert.deepEqual(takeFromMailbox(SID).map(m => m.text), ['one', 'two\nlines']);
    assert.deepEqual(takeFromMailbox(SID), []);
    postToMailbox(SID, { from: 'b', text: 'three' });
    assert.deepEqual(takeFromMailbox(SID).map(m => [m.from, m.text]), [['b', 'three']]);
  } finally { s.done(); }
});

test('a line still being written waits for the next read', () => {
  const s = scratch();
  try {
    postToMailbox(SID, { from: 'a', text: 'whole' });
    const box = join(s.dir, 'aipool-peer', 'inbox', `${SID}.jsonl`);
    appendFileSync(box, '{"from":"a","text":"half');
    assert.deepEqual(takeFromMailbox(SID).map(m => m.text), ['whole']);
    appendFileSync(box, '"}\n');
    assert.deepEqual(takeFromMailbox(SID).map(m => m.text), ['half']);
  } finally { s.done(); }
});

test('a mailbox name must be a session id, so it cannot point outside the inbox', () => {
  const s = scratch();
  try {
    assert.throws(() => postToMailbox('../../etc/x', { from: 'a', text: 'b' }), /not a session id/);
  } finally { s.done(); }
});

test('a target is a Claude session by name, id or pid, else a Codex session', () => {
  const sessions = [{ name: 'aipool-95', sessionId: SID, pid: 16845 }];
  const threads = [{ id: TID, name: 'web-codex', cwd: '/w', status: 'idle', path: '/r.jsonl' }];
  for (const t of ['aipool-95', SID, '16845']) assert.deepEqual(resolveTarget(t, sessions, threads), { kind: 'claude', id: SID, name: 'aipool-95' });
  assert.equal(resolveTarget('web-codex', sessions, threads).id, TID);
  assert.equal(resolveTarget(TID, sessions, threads).path, '/r.jsonl');
  // A saved Codex session nobody has open is still reachable by its id.
  const other = '0198a2b5-1d2e-7f3a-9b4c-5d6e7f8a9b0c';
  assert.deepEqual(resolveTarget(other, sessions, null), { kind: 'codex', id: other, name: other, path: '' });
  assert.equal(resolveTarget('nobody', sessions, threads), null);
});

test('whoami: a Codex shell by its thread id, a Claude shell by its ancestor process', async () => {
  const threads = async () => [{ id: TID, name: 'web-codex', cwd: '', status: '', path: '' }];
  const sessions = () => [{ name: 'aipool-95', sessionId: SID, pid: 16845 }];
  assert.deepEqual(await whoami({ env: { CODEX_THREAD_ID: TID }, threads, sessions, ancestors: () => [] }), { kind: 'codex', id: TID, name: 'web-codex' });
  assert.deepEqual(await whoami({ env: {}, threads, sessions, ancestors: () => [900, 16845, 1] }), { kind: 'claude', id: SID, name: 'aipool-95' });
  assert.equal((await whoami({ env: { AIPOOL_PEER_NAME: 'me' }, threads, sessions, ancestors: () => [] })).name, 'me');
  assert.equal(await whoami({ env: {}, threads, sessions, ancestors: () => [] }), null);
});

test('a message for Codex says who sent it and how the answer gets back', () => {
  const ref = '"/opt/aipool/src/index.js"';
  const plain = codexMessage({ from: 'aipool-95', replyTo: SID, text: 'hello', wait: false, ref });
  assert.match(plain, /^\[peer from aipool-95\] hello\n/);
  assert.match(plain, /not the user/);
  assert.ok(plain.includes(`To answer it: "/opt/aipool/src/index.js" peer send ${SID} "..."`), plain);
  assert.match(codexMessage({ from: 'aipool-95', text: 'hello', wait: true, ref }), /answer in this turn goes back to aipool-95/);
});

// Codex names a session after its first message; an address with spaces in a
// reply command has to reach the shell as one word.
test('a session address is quoted for the shell when it needs to be', () => {
  assert.equal(shellWord(SID), SID);
  assert.equal(shellWord('aipool-95'), 'aipool-95');
  assert.equal(shellWord('응답하기 PONG-1 연결 테스트'), "'응답하기 PONG-1 연결 테스트'");
  assert.equal(shellWord("it's"), `'it'"'"'s'`);
});

// The rollout lines a queued turn writes, trimmed to the fields that matter.
const turn = (id, text, answer, trigger = 'queue') => [
  { type: 'event_msg', payload: { type: 'task_started', turn_id: id, turn_attribution: { turn_id: id, turn_trigger: trigger } } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { turn_id: id } } },
  { type: 'event_msg', payload: { type: 'task_complete', turn_id: id, last_agent_message: answer } },
].map(r => JSON.stringify(r) + '\n').join('');

test('the reply is the answer of the turn that carried the message, not of another queued one', async () => {
  const s = scratch();
  try {
    const path = join(s.dir, 'rollout.jsonl');
    writeFileSync(path, turn('t0', 'mine', 'old answer'));
    const offset = readFileSync(path).length;
    appendFileSync(path, turn('t1', 'someone else', 'not this'));
    const waiting = waitForCodexReply(path, offset, 'mine', { timeoutMs: 5000, pollMs: 10 });
    setTimeout(() => appendFileSync(path, turn('t2', 'prefix mine', 'PONG')), 50);
    assert.equal(await waiting, 'PONG');
    await assert.rejects(waitForCodexReply(path, readFileSync(path).length, 'never', { timeoutMs: 50, pollMs: 10 }), /no reply within/);
  } finally { s.done(); }
});

test('the hook goes under SessionStart and Stop, once, beside hooks already there', () => {
  const theirs = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] }, model: 'x' };
  const once = withRewakeHook(theirs, '"/a/index.js" peer rewake');
  const twice = withRewakeHook(once, '"/b/index.js" peer rewake');
  assert.equal(twice.model, 'x');
  assert.deepEqual(twice.hooks.Stop[0], theirs.hooks.Stop[0]);
  for (const event of ['SessionStart', 'Stop']) {
    const ours = twice.hooks[event].flatMap(g => g.hooks).filter(h => h.command.endsWith('peer rewake'));
    assert.deepEqual(ours, [{ type: 'command', command: '"/b/index.js" peer rewake', asyncRewake: true, timeout: 604800 }]);
  }
  const removed = withRewakeHook(twice, null);
  assert.deepEqual(removed, theirs);
  assert.deepEqual(withRewakeHook({ hooks: {} }, null), {});
});

test('the agents note goes in once, replaces an older one, and comes out cleanly', () => {
  const note = agentNote('aipool');
  assert.match(note, /aipool peer send <session> "message"/);
  assert.equal(withAgentNote('', note), `${note}\n`);
  const mine = '# My notes\n\nkeep this\n';
  const added = withAgentNote(mine, note);
  assert.equal(added, `# My notes\n\nkeep this\n\n${note}\n`);
  const replaced = withAgentNote(added, agentNote('other'));
  assert.equal(replaced.match(/<!-- aipool peer -->/g).length, 1);
  assert.match(replaced, /`other peer list`/);
  assert.equal(withAgentNote(added, null), mine);
  assert.equal(withAgentNote(`${note}\n`, null), '');
});

test('the wake hook hands over what arrives and exits 2; a session it cannot find ends it', async () => {
  const s = scratch();
  try {
    const sessions = () => [{ name: 'aipool-95', sessionId: SID, pid: process.pid }];
    let said = '';
    const waiting = rewake(JSON.stringify({ session_id: SID }), { sessions, write: t => { said += t; }, pollMs: 10, findGapMs: 1 });
    // A second waiter for the same session leaves it to the first.
    assert.equal(await rewake(JSON.stringify({ session_id: SID }), { sessions, write: () => {}, pollMs: 10, findGapMs: 1, maxMs: 1000 }), 0);
    setTimeout(() => postToMailbox(SID, { from: 'web codex', replyTo: TID, text: 'done, see out.png' }), 30);
    assert.equal(await waiting, 2);
    assert.match(said, /not the user/);
    assert.ok(said.includes(`peer send ${TID} "..."`), said);
    assert.match(said, /\[peer from web codex · .*\]\ndone, see out\.png/);
    assert.ok(!existsSync(join(s.dir, 'aipool-peer', 'waiter', `${SID}.lock`)), 'the lock is released');
    // A background or -p session is never listed as interactive.
    assert.equal(await rewake(JSON.stringify({ session_id: SID }), { sessions: () => [], pollMs: 10, findTries: 2, findGapMs: 1 }), 0);
    assert.equal(await rewake('not json'), 0);
  } finally { s.done(); }
});

// A stand-in for the Codex daemon's control socket: the WebSocket handshake,
// then JSON-RPC answers sent the awkward ways a server may send them — a large
// frame and a message split over continuation frames.
function fakeDaemon(socketPath, threads) {
  const frame = (data, op, fin = true) => {
    const n = data.length;
    const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, n])
      : n < 65536 ? Buffer.from([(fin ? 0x80 : 0) | op, 126, n >> 8, n & 0xff])
      : Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
    return Buffer.concat([head, data]);
  };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let open = false;
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!open) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const key = /Sec-WebSocket-Key: (.*)\r\n/.exec(buf.toString())[1];
        const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        buf = buf.subarray(end + 4);
        open = true;
      }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, at = 2;
        if (len === 126) { len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + 4 + len) return;
        assert.ok(buf[1] & 0x80, 'client frames are masked');
        const mask = buf.subarray(at, at + 4);
        const data = Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((b, i) => b ^ mask[i % 4]);
        const op = buf[0] & 0x0f;
        buf = buf.subarray(at + 4 + len);
        if (op !== 1) continue;
        const msg = JSON.parse(Buffer.from(data).toString());
        if (msg.id === undefined) continue;
        let result = {};
        if (msg.method === 'thread/loaded/list') result = { data: threads.map(t => t.id) };
        if (msg.method === 'thread/read') result = { thread: { ...threads.find(t => t.id === msg.params.threadId), turns: 'x'.repeat(70_000) } };
        const out = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
        sock.write(frame(Buffer.alloc(0), 9)); // a ping, which the client answers
        if (msg.method === 'thread/loaded/list') {
          const cut = Math.floor(out.length / 2);
          sock.write(frame(out.subarray(0, cut), 1, false));
          sock.write(frame(out.subarray(cut), 0, true));
        } else {
          sock.write(frame(out, 1));
        }
      }
    });
  });
  return new Promise(r => server.listen(socketPath, () => r(server)));
}

test('the Codex daemon is read over its WebSocket control socket', async () => {
  const s = scratch();
  try {
    const socketPath = join(s.dir, 'd.sock');
    const threads = [
      { id: TID, name: '', cwd: '/w', status: { type: 'idle' }, path: '/r1.jsonl' },
      { id: '0198a2b5-1d2e-7f3a-9b4c-5d6e7f8a9b0c', name: 'two', cwd: '/x', status: { type: 'active' }, path: '/r2.jsonl' },
    ];
    const server = await fakeDaemon(socketPath, threads);
    try {
      assert.deepEqual(await codexThreads({ socketPath }), [
        { id: TID, name: '', cwd: '/w', status: 'idle', path: '/r1.jsonl' },
        { id: '0198a2b5-1d2e-7f3a-9b4c-5d6e7f8a9b0c', name: 'two', cwd: '/x', status: 'active', path: '/r2.jsonl' },
      ]);
    } finally { server.close(); }
    assert.equal(await codexThreads({ socketPath: join(s.dir, 'none.sock') }), null, 'no daemon, no list');
  } finally { s.done(); }
});

test('the hook runs peer-hook.js, and install recognises it to replace or remove', () => {
  const command = rewakeCommand();
  assert.match(command, /^".*\/src\/peer-hook\.js"$/);
  const settings = withRewakeHook({}, command);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, command);
  assert.deepEqual(withRewakeHook(settings, null), {});
  // The hook of the standalone `peer` tool goes too, rather than waking twice.
  assert.deepEqual(withRewakeHook({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'peer rewake' }] }] } }, null), {});
  assert.equal(rewakeCommand('/a "b"/$x`y`.js'), '"/a \\"b\\"/\\$x\\`y\\`.js"');
});

// The real entry point, as Claude Code runs it: hook JSON on stdin, a waiting
// message, exit 2 with the message on stderr. The reply it suggests names the
// CLI, not the hook script that happens to be running.
test('peer-hook.js wakes the session with what is waiting for it', async () => {
  const s = scratch();
  try {
    const bin = join(s.dir, 'bin');
    const { mkdirSync, chmodSync } = await import('node:fs');
    mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho '[{"kind":"interactive","name":"aipool-95","sessionId":"${SID}","pid":${process.pid}}]'\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    postToMailbox(SID, { from: 'web codex', replyTo: TID, text: 'PONG-2' });
    const hook = new URL('../src/peer-hook.js', import.meta.url).pathname;
    const child = spawn(process.execPath, [hook], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.stdin.end(JSON.stringify({ session_id: SID, hook_event_name: 'Stop' }));
    const code = await new Promise(r => child.on('close', r));
    assert.equal(code, 2, err);
    assert.match(err, /\[peer from web codex · .*\]\nPONG-2/);
    assert.ok(err.includes(`${cliRef()} peer send ${TID} "..."`), err);
    assert.match(cliRef(), /index\.js"$|^aipool$/);
  } finally { s.done(); }
});
