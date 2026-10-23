// Upload content types and server refusals as the app sees them, against a
// local HTTP server: the type the multipart file part carries when no
// contentType is passed, and the server's `code`, `statusCode` and message on
// upload (plain and with onProgress), download and other requests.
// Runs against the compiled build: `npm test` builds first.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { RiviumStorage, RiviumStorageError, StorageErrorCode } = require('../dist/index.js');

const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.md', fileName: 'a.md', mimeType: 'text/markdown', size: 3,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

let server;
let baseUrl;
let plans;
let requests;

before(async () => {
  server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(parts) });
      const r = plans.shift() || { status: 201, body: fileJson };
      res.statusCode = r.status;
      if (r.raw !== undefined) {
        res.setHeader('Content-Type', 'text/plain');
        res.end(r.raw);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(r.body));
      }
    });
  });
  server.keepAliveTimeout = 1;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  plans = [];
  requests = [];
});

function client() {
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', serverSecret: 'rv_srv_test' });
  // Test-only: point the private base URL at the local server.
  storage.baseUrl = baseUrl;
  return storage;
}

/** The Content-Type header of the multipart `file` part of the last request. */
function filePartType() {
  const body = requests[requests.length - 1].body.toString('latin1');
  const m = /name="file"; filename="[^"]*"\r\nContent-Type: ([^\r\n]+)/.exec(body);
  assert.ok(m, 'file part found');
  return m[1];
}

// ---------- content type ----------

test('no contentType: the table type for the extension (before: always octet-stream)', async () => {
  const storage = client();
  const cases = [
    ['notes/a.md', '# hi', 'text/markdown'],
    ['data/a.CSV', Buffer.from('a,b'), 'text/csv'],
    ['a.json', '{}', 'application/json'],
    ['a.yml', new Uint8Array([97]), 'text/yaml'],
    ['photo.heic', Buffer.alloc(4), 'image/heic'],
    ['backup.tar.gz', Buffer.alloc(3), 'application/gzip'],
    ['clip.mkv', Buffer.alloc(3), 'video/x-matroska'],
  ];
  for (const [path, data, type] of cases) {
    await storage.upload('b1', path, data);
    assert.equal(filePartType(), type, path);
  }
});

test('unknown extension, no extension, dot folder: application/octet-stream', async () => {
  const storage = client();
  for (const path of ['README', 'a.unknownext', '.config/settings', 'a/.env']) {
    await storage.upload('b1', path, 'x');
    assert.equal(filePartType(), 'application/octet-stream', path);
  }
});

test('an explicit contentType always wins; onProgress sends the same type', async () => {
  const storage = client();
  await storage.upload('b1', 'a.md', '# x', { contentType: 'text/x-markdown' });
  assert.equal(filePartType(), 'text/x-markdown');
  await storage.upload('b1', 'a.json', '{}', { onProgress: () => {} });
  assert.equal(filePartType(), 'application/json');
});

// ---------- error codes ----------

const REFUSALS = [
  [400, StorageErrorCode.TypeNotAllowed, 'This bucket does not allow text/markdown files'],
  [400, StorageErrorCode.FileTooLarge, 'File is larger than the bucket limit (1 MB)'],
  [400, StorageErrorCode.ExecutableBlocked, 'Executable files are blocked in this bucket'],
  [401, StorageErrorCode.TokenRequired, 'User token required'],
  [401, StorageErrorCode.TokenInvalid, 'Invalid user token'],
  [401, StorageErrorCode.TokenExpired, 'User token expired - refresh it and retry'],
  [409, StorageErrorCode.PathTaken, 'A file already exists at this path'],
];

function refusal(status, code, message) {
  return { status, body: { statusCode: status, error: 'Bad Request', message, code } };
}

async function rejects(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  assert.fail('expected a rejection');
}

for (const progress of [false, true]) {
  test(`upload${progress ? ' with onProgress' : ''}: code, statusCode and server message reach the app`, async () => {
    const storage = client();
    for (const [status, code, message] of REFUSALS) {
      plans.push(refusal(status, code, message));
      const e = await rejects(storage.upload('b1', 'a.md', '# x', progress ? { onProgress: () => {} } : {}));
      assert.ok(e instanceof RiviumStorageError);
      assert.equal(e.code, code);
      assert.equal(e.statusCode, status);
      assert.equal(e.message, message);
    }
  });
}

test('upload: a 403 rule denial keeps its status and message (no code)', async () => {
  const storage = client();
  plans.push({ status: 403, body: { statusCode: 403, message: 'Access denied by bucket rules' } });
  const e = await rejects(storage.upload('b1', 'a.md', '# x'));
  assert.equal(e.statusCode, 403);
  assert.equal(e.code, undefined);
  assert.equal(e.message, 'Access denied by bucket rules');
});

test('upload: a validation message array is joined; a non-JSON body falls back to HTTP <status>', async () => {
  const storage = client();
  plans.push({ status: 400, body: { statusCode: 400, message: ['path is required', 'path too long'] } });
  let e = await rejects(storage.upload('b1', 'a.md', '# x'));
  assert.equal(e.message, 'path is required, path too long');
  plans.push({ status: 502, raw: 'Bad gateway' });
  e = await rejects(storage.upload('b1', 'a.md', '# x'));
  assert.equal(e.statusCode, 502);
  assert.equal(e.message, 'HTTP 502');
  assert.equal(e.code, undefined);
});

test('download: the server message and code are kept', async () => {
  const storage = client();
  for (const [status, code, message] of [
    [401, StorageErrorCode.TokenExpired, 'User token expired - refresh it and retry'],
    [403, undefined, 'Access denied by bucket rules'],
    [404, undefined, 'File not found'],
  ]) {
    plans.push({ status, body: { statusCode: status, message, ...(code ? { code } : {}) } });
    const e = await rejects(storage.download('f1'));
    assert.ok(e instanceof RiviumStorageError);
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  }
});

test('download: no JSON body falls back to "Download failed: <status>"', async () => {
  const storage = client();
  plans.push({ status: 502, raw: 'Bad gateway' });
  const e = await rejects(storage.download('f1'));
  assert.equal(e.statusCode, 502);
  assert.equal(e.message, 'Download failed: 502');
});

test('other requests: the code is kept (getFile)', async () => {
  const storage = client();
  plans.push(refusal(409, 'path_taken', 'A file already exists at this path'));
  const e = await rejects(storage.getFile('f1'));
  assert.equal(e.code, 'path_taken');
  assert.equal(e.statusCode, 409);
});

// ---------- image transform refusals ----------
// The SDK only builds transform URLs (the app fetches them); these are the
// bodies the transform route answers with. The SDK's own requests read them
// the same way, so code, statusCode and message reach the app.

const TRANSFORM_REFUSALS = [
  [415, StorageErrorCode.ImageFormatNotSupported,
    "This image format can't be resized: BMP. Supported: JPEG, PNG, WebP, GIF, AVIF, HEIC, TIFF, SVG."],
  [400, StorageErrorCode.NotAnImage, "This file isn't an image (application/pdf), so it can't be resized."],
  [422, StorageErrorCode.ImageDamaged, 'The image is damaged or incomplete (it may not have finished uploading).'],
  [413, StorageErrorCode.ImageTooLarge, 'This image is 12000×9000 (108 MP); images up to 50 MP can be resized.'],
];

test('transform refusals (415, 400, 422, 413): code, statusCode and message reach the app (download, getFile)', async () => {
  const storage = client();
  for (const [status, code, message] of TRANSFORM_REFUSALS) {
    plans.push(refusal(status, code, message));
    let e = await rejects(storage.download('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
    plans.push(refusal(status, code, message));
    e = await rejects(storage.getFile('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  }
});
