// createUserToken: mints a Rivium user token through Rivium Auth.
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const nodeFetch = require('node-fetch');
const { RiviumStorage, RiviumStorageError } = require('../dist/index.js');

const CONFIG = { apiKey: 'rv_live_test', serverSecret: 'rv_srv_secret' };
const MINTED = { token: 'signed.jwt.here', userId: 'user-1', expiresIn: 3600, expiresAt: '2026-10-21T12:00:00.000Z' };
let calls;
let reply;

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: MINTED };
  // The SDK calls node-fetch's default export at call time.
  nodeFetch.default = async (url, init) => {
    calls.push({ url: String(url), init });
    return new nodeFetch.Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
});

test('posts the userId to auth.rivium.co/users/token with key and server secret', async () => {
  const storage = new RiviumStorage(CONFIG);

  const result = await storage.createUserToken('user-1');

  assert.equal(calls[0].url, 'https://auth.rivium.co/users/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], CONFIG.apiKey);
  assert.equal(calls[0].init.headers['x-server-secret'], CONFIG.serverSecret);
  assert.deepEqual(JSON.parse(calls[0].init.body), { userId: 'user-1' });
  assert.deepEqual(result, MINTED);
});

test('passes a custom lifetime through', async () => {
  const storage = new RiviumStorage(CONFIG);

  await storage.createUserToken('user-1', 900);

  assert.deepEqual(JSON.parse(calls[0].init.body), { userId: 'user-1', expiresIn: 900 });
});

test('authUrl is configurable', async () => {
  const storage = new RiviumStorage({ ...CONFIG, authUrl: 'http://localhost:3005/' });

  await storage.createUserToken('user-1');

  assert.equal(calls[0].url, 'http://localhost:3005/users/token');
});

test('without the server secret it fails before any request', async () => {
  const storage = new RiviumStorage({ apiKey: CONFIG.apiKey });

  await assert.rejects(storage.createUserToken('user-1'), (e) => {
    assert.ok(e instanceof RiviumStorageError);
    assert.equal(e.code, 'SERVER_SECRET_REQUIRED');
    assert.match(e.message, /serverSecret/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('without a userId it fails before any request', async () => {
  const storage = new RiviumStorage(CONFIG);

  await assert.rejects(storage.createUserToken(''), RiviumStorageError);
  assert.equal(calls.length, 0);
});

test('a server error surfaces with its status and message', async () => {
  reply = { status: 401, body: { message: 'Invalid API key or server secret' } };
  const storage = new RiviumStorage(CONFIG);

  await assert.rejects(storage.createUserToken('user-1'), (e) => {
    assert.equal(e.statusCode, 401);
    assert.equal(e.message, 'Invalid API key or server secret');
    return true;
  });
});
