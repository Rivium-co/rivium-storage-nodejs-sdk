// Paths and ids in request URLs, redirects, and the server secret.
// A path or id must reach the server as the exact text the app passed: dot
// segments (also `%2e`) are refused before anything is sent, everything else
// is percent-encoded. Runs against the compiled build: `npm test` builds first.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const util = require('node:util');
const { RiviumStorage, RiviumStorageError, StorageErrorCode } = require('../dist/index.js');

const BUCKET_UUID = '6f1c2a9e-1111-4222-8333-444455556666';
const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

let server;
let baseUrl;
let requests;
let redirectTo;

before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      if (redirectTo) {
        res.statusCode = 302;
        res.setHeader('Location', redirectTo);
        return res.end();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url.endsWith('/signed-url') ? { url: 'https://signed' } : fileJson));
    });
  });
  server.keepAliveTimeout = 1;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  requests = [];
  redirectTo = undefined;
});

function client() {
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', serverSecret: 'rv_srv_test_secret' });
  // Test-only: point the private base URL at the local server.
  storage.baseUrl = baseUrl;
  return storage;
}

const isInvalidPath = (e) =>
  e instanceof RiviumStorageError && e.statusCode === 400 && e.code === StorageErrorCode.InvalidPath;

async function assertInvalidPath(promise) {
  await assert.rejects(promise, isInvalidPath);
}

test('deleteByPath with %2e%2e segments is refused and never reaches the bucket endpoint', async () => {
  const storage = client();
  await assertInvalidPath(storage.deleteByPath('b1', `x/%2e%2e/%2e%2e/%2e%2e/${BUCKET_UUID}`));
  await assertInvalidPath(storage.deleteByPath('b1', `x/../../../${BUCKET_UUID}`));
  assert.equal(requests.length, 0);
});

test('dot and encoded-dot segments are refused for every path method, nothing is sent (empty segments: alignment.test.cjs)', async () => {
  const storage = client();
  const bad = ['..', '.', '../a', 'a/./b', 'a/../b', 'a/%2E%2e/b', 'a/%2e/b', '%2E'];
  for (const path of bad) {
    await assertInvalidPath(storage.getFileByPath('b1', path));
    await assertInvalidPath(storage.deleteByPath('b1', path));
  }
  assert.equal(requests.length, 0);
  assert.equal(StorageErrorCode.InvalidPath, 'invalid_path');
});

test('?, #, % and spaces in a path reach the server encoded, segment by segment', async () => {
  const storage = client();
  await storage.getFileByPath('b1', 'dir one/a?b#c%d.txt');
  await storage.deleteByPath('b1', 'x/%41 100%.png');
  assert.equal(requests[0].url, '/api/v1/buckets/b1/files/dir%20one/a%3Fb%23c%25d.txt');
  assert.equal(requests[1].method, 'DELETE');
  assert.equal(requests[1].url, '/api/v1/buckets/b1/files/x/%2541%20100%25.png');
});

test('ids and bucket names are one encoded segment; a / stays inside it', async () => {
  const storage = client();
  await storage.getFile('a/b');
  await storage.getBucketByName('my bucket/x');
  await storage.deletePolicy('b 1', '../p');
  await storage.getSignedUrl('f?1');
  await storage.upload('bucket/../x', 'a.txt', 'x');
  assert.deepEqual(requests.map((r) => r.url), [
    '/api/v1/files/a%2Fb',
    '/api/v1/buckets/name/my%20bucket%2Fx',
    '/api/v1/buckets/b%201/policies/..%2Fp',
    '/api/v1/files/f%3F1/signed-url',
    '/api/v1/buckets/bucket%2F..%2Fx/files',
  ]);
});

test('ids that are . or .. are refused (also as %2e%2e), nothing is sent (empty ids: alignment.test.cjs)', async () => {
  const storage = client();
  for (const id of ['.', '..', '%2e%2e']) {
    await assertInvalidPath(storage.getFile(id));
    await assertInvalidPath(storage.delete(id));
    await assertInvalidPath(storage.download(id));
    await assertInvalidPath(storage.deleteBucket(id));
    await assertInvalidPath(storage.getBucketByName(id));
    await assertInvalidPath(storage.deletePolicy('b1', id));
    await assertInvalidPath(storage.upload(id, 'a.txt', 'x'));
    assert.throws(() => storage.getUrl(id), isInvalidPath);
    assert.throws(() => storage.getTransformUrl(id, { width: 10 }), isInvalidPath);
  }
  assert.equal(requests.length, 0);
  assert.equal(storage.getDownloadUrl('a b'), `${baseUrl}/api/v1/files/a%20b/download`);
});

test('upload refuses CR and LF in the path (multipart header injection), nothing is sent', async () => {
  const storage = client();
  for (const path of ['a\r\nX-Injected: 1.txt', 'a\n.txt']) {
    await assertInvalidPath(storage.upload('b1', path, 'x'));
  }
  await assertInvalidPath(storage.upload('b1', 'ok.txt', 'x', { path: 'dir/\r\nbad.txt' }));
  assert.equal(requests.length, 0);
});

test('a redirect is never followed (the secret would go to the next host)', async () => {
  const other = [];
  const target = http.createServer((req, res) => {
    other.push(req.headers);
    res.end('{}');
  });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  try {
    redirectTo = `http://127.0.0.1:${target.address().port}/steal`;
    const storage = client();
    await assert.rejects(storage.getFile('f1'), RiviumStorageError);
    await assert.rejects(storage.deleteByPath('b1', 'a.txt'), RiviumStorageError);
    await assert.rejects(storage.download('f1'), RiviumStorageError);
    await assert.rejects(storage.upload('b1', 'a.txt', 'x', { onProgress: () => {} }), RiviumStorageError);
    assert.equal(other.length, 0);
  } finally {
    target.close();
  }
});

test('the server secret is not printed by console.log, JSON.stringify or Object.keys', async () => {
  const storage = client();
  assert.doesNotMatch(util.inspect(storage, { depth: 5, showHidden: true }), /rv_srv_test_secret/);
  assert.doesNotMatch(JSON.stringify(storage), /rv_srv_test_secret/);
  assert.ok(!Object.keys(storage).some((k) => /secret/i.test(k)));
  // ...and still sent where needed.
  await storage.listBuckets();
  assert.equal(requests[0].headers['x-server-secret'], 'rv_srv_test_secret');
});

test('refuses a server secret in a browser bundle', () => {
  globalThis.window = {};
  try {
    assert.throws(
      () => new RiviumStorage({ apiKey: 'rv_live_test', serverSecret: 'rv_srv_x' }),
      (e) => e instanceof RiviumStorageError && /browser/.test(e.message),
    );
    // Without a secret the Node SDK can't be created at all.
    assert.throws(() => new RiviumStorage({ apiKey: 'rv_live_test' }), (e) => e.code === 'INVALID_ARGUMENT');
  } finally {
    delete globalThis.window;
  }
});

test('authUrl must be https, http only for localhost', () => {
  for (const authUrl of ['http://auth.example.com', 'http://192.168.1.5:3005', 'ftp://x', 'not a url']) {
    assert.throws(() => new RiviumStorage({ apiKey: 'k', serverSecret: 's', authUrl }), RiviumStorageError, authUrl);
  }
  for (const authUrl of ['https://auth.example.com/', 'http://localhost:3005', 'http://127.0.0.1:1', 'http://[::1]:2']) {
    new RiviumStorage({ apiKey: 'k', serverSecret: 's', authUrl });
  }
});

test('form-data minimum is the version that escapes multipart names (GHSA-hmw2-7cc7-3qxx)', () => {
  const range = require('../package.json').dependencies['form-data'];
  assert.equal(range, '^4.0.6');
});
