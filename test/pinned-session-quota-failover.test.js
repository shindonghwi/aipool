// A conversation pinned by adaptive distribution must not be handed its
// account's 5-hour quota refusal while a sibling still has headroom: the
// refusal is resent on the sibling and the conversation re-pins there, and a
// pin whose 5-hour bucket already sits at the switch threshold is left before
// upstream is asked at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AccountManager } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';

const SESSION = 'sess-pinned-quota';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function oauth(name) {
  return { name, type: 'oauth', accessToken: `t-${name}`, refreshToken: 'r', expiresAt: Date.now() + 3600_000 };
}

// The headers a Max subscription's 429 carries when its 5-hour window is spent.
function sessionLimitHeaders() {
  const reset = Math.floor(Date.now() / 1000) + 2700;
  return {
    'retry-after': '2700',
    'anthropic-ratelimit-unified-status': 'rejected',
    'anthropic-ratelimit-unified-5h-status': 'rejected',
    'anthropic-ratelimit-unified-5h-utilization': '1.0',
    'anthropic-ratelimit-unified-5h-reset': String(reset),
    'anthropic-ratelimit-unified-7d-status': 'allowed',
    'anthropic-ratelimit-unified-7d-utilization': '0.96',
    'anthropic-ratelimit-unified-7d-reset': String(reset + 400_000),
    'anthropic-ratelimit-unified-representative-claim': 'five_hour',
    'anthropic-ratelimit-unified-reset': String(reset),
    'content-type': 'application/json',
  };
}

function okHeaders(u5h) {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  return {
    'anthropic-ratelimit-unified-status': 'allowed',
    'anthropic-ratelimit-unified-5h-status': 'allowed',
    'anthropic-ratelimit-unified-5h-utilization': String(u5h),
    'anthropic-ratelimit-unified-5h-reset': String(reset),
    'anthropic-ratelimit-unified-7d-status': 'allowed',
    'anthropic-ratelimit-unified-7d-utilization': '0.2',
    'anthropic-ratelimit-unified-7d-reset': String(reset + 400_000),
    'content-type': 'application/json',
  };
}

async function setup(respond) {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const who = String(req.headers.authorization || '').replace('Bearer t-', '');
    seen.push(who);
    req.resume();
    req.on('end', () => respond(who, res));
  });
  const upstreamPort = await listen(upstream);
  const am = new AccountManager([oauth('a'), oauth('b')], 0.98, { distributeSessions: 'adaptive' });
  const proxy = createProxyServer(am, { proxy: { apiKey: 'k' }, upstream: `http://127.0.0.1:${upstreamPort}` });
  const proxyPort = await listen(proxy);
  const send = async (stream = false) => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'k', 'x-claude-code-session-id': SESSION },
      body: JSON.stringify({ model: 'claude-x', stream, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const text = await res.text();
    return { status: res.status, text };
  };
  const close = () => { proxy.closeAllConnections?.(); proxy.close(); upstream.closeAllConnections?.(); upstream.close(); };
  return { am, seen, send, close };
}

for (const stream of [false, true]) {
  test(`a pinned conversation's 5h refusal is resent on the sibling (stream=${stream})`, async () => {
    let spent = false;
    const { am, seen, send, close } = await setup((who, res) => {
      if (who === 'a' && spent) {
        res.writeHead(429, sessionLimitHeaders());
        res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'This request would exceed your account\'s rate limit.' } }));
        return;
      }
      res.writeHead(200, okHeaders(who === 'a' ? 0.9 : 0.15));
      res.end(JSON.stringify({ type: 'message', role: 'assistant', content: [] }));
    });
    try {
      // Pin the conversation. Whichever account serves first is the pin; make
      // it `a` by routing the first request there.
      const first = await send(stream);
      assert.equal(first.status, 200);
      assert.equal(seen[0], 'a', 'a fresh fleet pins the first conversation on the first account');
      spent = true;
      seen.length = 0;
      const second = await send(stream);
      assert.equal(second.status, 200, `client must not see the quota 429: ${second.text}`);
      assert.deepEqual(seen, ['a', 'b'], 'refused on the pin, resent on the sibling');
      assert.equal(am.accounts[0].status, 'throttled');
      seen.length = 0;
      const third = await send(stream);
      assert.equal(third.status, 200);
      assert.deepEqual(seen, ['b'], 'conversation re-pinned to the sibling');
    } finally {
      close();
    }
  });
}

test('a pin whose 5h bucket reached the threshold is left before upstream is asked', async () => {
  let u5hA = 0.5;
  const { seen, send, close } = await setup((who, res) => {
    res.writeHead(200, okHeaders(who === 'a' ? u5hA : 0.15));
    res.end(JSON.stringify({ type: 'message', role: 'assistant', content: [] }));
  });
  try {
    await send();
    assert.equal(seen[0], 'a', 'a fresh fleet pins the first conversation on the first account');
    // The pinned account's next response reports its 5h bucket at 99%.
    u5hA = 0.99;
    await send();
    seen.length = 0;
    await send();
    assert.deepEqual(seen, ['b'], 'pinned account at the threshold is not asked again');
  } finally {
    close();
  }
});
