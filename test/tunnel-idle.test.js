import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { AccountManager } from '../src/account-manager.js';
import { createConnectHandler, TUNNEL_CONNECT_TIMEOUT_MS, TUNNEL_IDLE_TIMEOUT_MS } from '../src/mitm.js';
import { allowLoopbackForward } from '../src/forward-target.js';

// A blind tunnel's connect bound used to stay armed for the life of the
// tunnel, so a server that said nothing for 30s — image generation, routinely —
// had its connection cut mid-request. The dial and the silence are bounded
// separately now. Scaled down here: connect bound 150ms, idle bound 1.5s.

const CONNECT_MS = 150;
const IDLE_MS = 1500;

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** A destination that reads one line, stays silent for `delayMs`, then answers. */
async function slowServer(delayMs) {
  const server = net.createServer(sock => {
    sock.once('data', () => setTimeout(() => sock.end('done\n'), delayMs));
    sock.on('error', () => {});
  });
  return { server, port: await listen(server) };
}

async function proxy() {
  const am = new AccountManager([{ name: 'alice', type: 'apikey', apiKey: 'k1' }], 0.98);
  const server = http.createServer();
  allowLoopbackForward(server);
  server.on('connect', createConnectHandler({
    config: { proxy: {}, upstream: 'https://api.anthropic.com' },
    accountManager: am,
    ensureLeaf: async () => { throw new Error('not reached: blind tunnel'); },
    tunnelConnectTimeoutMs: CONNECT_MS,
    tunnelIdleTimeoutMs: IDLE_MS,
  }));
  return { server, port: await listen(server) };
}

/** CONNECT through the proxy, send a request line, and collect what comes back. */
function throughTunnel(proxyPort, targetPort) {
  return new Promise(resolve => {
    let buf = '';
    const started = Date.now();
    const sock = net.connect(proxyPort, '127.0.0.1', () => {
      sock.write(`CONNECT localhost:${targetPort} HTTP/1.1\r\nHost: localhost:${targetPort}\r\n\r\n`);
    });
    sock.on('data', chunk => {
      const before = buf;
      buf += chunk.toString();
      if (!before.includes('\r\n\r\n') && buf.includes('\r\n\r\n')) sock.write('generate\n');
    });
    const done = () => resolve({ body: buf.split('\r\n\r\n')[1] ?? '', ms: Date.now() - started });
    sock.on('close', done);
    sock.on('error', done);
  });
}

test('a server silent for longer than the connect bound is not cut off', async () => {
  const target = await slowServer(CONNECT_MS * 4);
  const p = await proxy();
  try {
    const { body } = await throughTunnel(p.port, target.port);
    assert.equal(body, 'done\n');
  } finally {
    p.server.close();
    target.server.close();
  }
});

test('a tunnel silent past the idle bound is still reaped', async () => {
  const target = await slowServer(IDLE_MS * 3);
  const p = await proxy();
  try {
    const { body, ms } = await throughTunnel(p.port, target.port);
    assert.equal(body, '');
    assert.ok(ms >= IDLE_MS && ms < IDLE_MS * 3, `closed after ${ms}ms`);
  } finally {
    p.server.close();
    target.server.close();
  }
});

test('the real idle bound is long enough for an image to be generated', () => {
  assert.equal(TUNNEL_CONNECT_TIMEOUT_MS, 30_000);
  assert.ok(TUNNEL_IDLE_TIMEOUT_MS >= 5 * 60_000);
});
