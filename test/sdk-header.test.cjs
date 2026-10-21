// X-Rivium-SDK: every Rivium request this SDK makes names it (node/<version>).
// Runs against the compiled build: `npm test` builds first. A local HTTP
// server records what really goes on the wire (multipart uploads included).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { version } = require('../package.json');
const { RiviumStorage, SDK_NAME, SDK_VERSION } = require('../dist/index.js');

const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 5,
  storageKey: 'k', isDeleted: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

test('SDK_NAME is node and SDK_VERSION matches package.json', () => {
  assert.equal(SDK_NAME, 'node');
  assert.equal(SDK_VERSION, version);
});

test('bucket, upload, download, signed URL and user token requests send X-Rivium-SDK', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      if (req.url.endsWith('/download')) return res.end('hello');
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/users/token') return res.end(JSON.stringify({ token: 't', userId: 'u1', expiresIn: 60, expiresAt: 'x' }));
      if (req.url.endsWith('/signed-url')) return res.end(JSON.stringify({ url: 'https://signed' }));
      res.end(JSON.stringify(req.method === 'POST' ? fileJson : []));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const storage = new RiviumStorage({ apiKey: 'rv_live_test', serverSecret: 'rv_srv_test', authUrl: base });
    // Test-only: point the private base URL at the local server.
    storage.baseUrl = base;

    await storage.listBuckets();
    await storage.upload('b1', 'a.txt', 'hello');
    await storage.download('f1');
    await storage.getSignedUrl('f1');
    await storage.createUserToken('u1');
  } finally {
    server.close();
  }

  assert.equal(seen.length, 5);
  for (const request of seen) {
    assert.equal(request.headers['x-rivium-sdk'], `node/${SDK_VERSION}`, `${request.method} ${request.url}`);
    assert.equal(request.headers['x-api-key'], 'rv_live_test');
  }
});
