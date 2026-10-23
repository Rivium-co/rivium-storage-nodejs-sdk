// App-facing answers carry only the documented fields (no storage keys,
// project/organisation ids or deletion flags). The SDK hands them over as is.
// Runs against the compiled build: `npm test` builds first.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { RiviumStorage } = require('../dist/index.js');

const FILE = {
  id: 'f1', bucketId: 'b1', path: 'docs/a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 5,
  checksum: 'sha256-x', metadata: { k: 'v' }, uploadedBy: 'user-1',
  uploadedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
/** The same file as an older upload: every `T | null` field present and null. */
const OLD_FILE = { ...FILE, id: 'f0', checksum: null, metadata: null, uploadedBy: null, uploadedAt: null };
const BUCKET = {
  id: 'b1', name: 'docs', description: null, visibility: 'private', maxFileSize: 1048576,
  allowedMimeTypes: ['text/plain'], blockExecutables: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const SIGNED_UPLOAD = { url: 'https://storage.rivium.co/u', uploadId: 'u1', path: 'docs/a.txt', expiresAt: '2026-01-01T00:05:00.000Z', maxSize: 1048576 };

let server;
let base;
let next;
before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(next));
    });
  });
  server.keepAliveTimeout = 1;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('file, bucket, list and signed-upload answers with only the whitelisted fields come back unchanged', async () => {
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', serverSecret: 'rv_srv_test' });
  storage.baseUrl = base; // test-only
  next = FILE;
  assert.deepEqual(await storage.getFile('f1'), FILE);
  assert.deepEqual(await storage.upload('b1', 'docs/a.txt', 'hello'), FILE);
  next = BUCKET;
  assert.deepEqual(await storage.getBucket('b1'), BUCKET);
  next = [BUCKET];
  assert.deepEqual(await storage.listBuckets(), [BUCKET]);
  next = { files: [FILE, OLD_FILE], nextCursor: 'c' };
  assert.deepEqual(await storage.listFiles('b1'), { files: [FILE, OLD_FILE], nextCursor: 'c' });
  next = { files: [], nextCursor: null };
  assert.deepEqual(await storage.listFiles('b1', { cursor: 'c' }), { files: [], nextCursor: null });
  next = SIGNED_UPLOAD;
  assert.deepEqual(await storage.createSignedUploadUrl('b1', 'docs/a.txt', { contentType: 'text/plain' }), SIGNED_UPLOAD);
});
