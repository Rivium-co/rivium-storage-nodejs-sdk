// Upload progress: onProgress follows the body as it goes on the wire.
// Runs against the compiled build: `npm test` builds first. A local HTTP
// server reads the upload slowly, so progress has to arrive during the upload.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { RiviumStorage, RiviumStorageError } = require('../dist/index.js');
const { createProgressReporter } = require('../dist/progress.js');

const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'big.bin', fileName: 'big.bin', mimeType: 'application/octet-stream', size: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A server that takes `chunk` bytes every `everyMs`, records the request, then answers. */
async function slowServer({ chunk = 64 * 1024, everyMs = 15, status = 200, reply = fileJson } = {}) {
  const state = { received: 0, requests: [] };
  const server = http.createServer((req, res) => {
    const parts = [];
    req.pause();
    const pump = () => {
      let piece;
      let taken = 0;
      while (taken < chunk && (piece = req.read()) !== null) {
        parts.push(piece);
        taken += piece.length;
        state.received += piece.length;
      }
      if (req.readableEnded) return;
      setTimeout(pump, everyMs);
    };
    req.on('readable', () => {});
    req.on('end', () => {
      state.requests.push({ headers: req.headers, body: Buffer.concat(parts) });
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply));
    });
    setTimeout(pump, everyMs);
  });
  server.keepAliveTimeout = 1;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', serverSecret: 'rv_srv_test' });
  // Test-only: point the private base URL at the local server.
  storage.baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, state, storage };
}

/** The multipart body with the random boundary replaced, to compare two uploads. */
function normalize(request) {
  const boundary = /boundary=(.+)$/.exec(request.headers['content-type'])[1];
  return request.body.toString('latin1').split(boundary).join('BOUNDARY');
}

test('progress arrives during a slow 2 MB upload and ends at the total', async () => {
  const { server, state, storage } = await slowServer();
  const data = Buffer.alloc(2 * 1024 * 1024, 7);
  const events = [];
  try {
    const file = await storage.upload('b1', 'big.bin', data, {
      onProgress: (p) => events.push({ ...p, serverHad: state.received, at: Date.now() }),
    });
    assert.equal(file.id, 'f1');
  } finally {
    server.close();
  }

  const total = Number(state.requests[0].headers['content-length']);
  assert.ok(total > data.length, 'total covers the whole multipart body');
  assert.equal(state.requests[0].body.length, total);

  const during = events.filter((e) => e.bytesSent < total);
  assert.ok(during.length >= 3, `expected several events before the end, got ${during.length}`);
  // Some events happened while the server had not yet read the whole body.
  assert.ok(events.some((e) => e.bytesSent < total && e.serverHad < total));
  // Spread over time, not all fired at once.
  assert.ok(events[events.length - 1].at - events[0].at >= 50);

  for (const e of events) {
    assert.equal(e.totalBytes, total);
    assert.ok(e.bytesSent >= 0 && e.bytesSent <= e.totalBytes);
  }
  for (let i = 1; i < events.length; i++) assert.ok(events[i].bytesSent > events[i - 1].bytesSent);
  const last = events[events.length - 1];
  assert.equal(last.bytesSent, total);
  assert.equal(events.filter((e) => e.bytesSent === total).length, 1);
});

test('with and without onProgress the request is the same on the wire', async () => {
  const { server, state, storage } = await slowServer({ chunk: 1 << 30, everyMs: 1 });
  const data = Buffer.from('hello progress');
  let called = 0;
  try {
    await storage.upload('b1', 'docs/a.txt', data, { contentType: 'text/plain', metadata: { a: 1 } });
    await storage.upload('b1', 'docs/a.txt', data, {
      contentType: 'text/plain', metadata: { a: 1 }, onProgress: () => { called++; },
    });
  } finally {
    server.close();
  }

  const [plain, withProgress] = state.requests;
  for (const h of ['content-length', 'x-api-key', 'x-user-id', 'x-rivium-sdk', 'transfer-encoding']) {
    assert.equal(withProgress.headers[h], plain.headers[h], h);
  }
  assert.match(withProgress.headers['content-type'], /^multipart\/form-data;boundary=/);
  assert.equal(
    withProgress.headers['content-type'].replace(/boundary=.*/, ''),
    plain.headers['content-type'].replace(/boundary=.*/, ''),
  );
  assert.equal(normalize(withProgress), normalize(plain));
  assert.ok(called >= 1);
});

test('no callback, and no change, when onProgress is not given', async () => {
  const { server, state, storage } = await slowServer({ chunk: 1 << 30, everyMs: 1 });
  try {
    await storage.upload('b1', 'a.txt', 'hello');
  } finally {
    server.close();
  }
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].headers['content-length'], String(state.requests[0].body.length));
});

test('server errors are the same with onProgress', async () => {
  const { server, storage } = await slowServer({
    chunk: 1 << 30, everyMs: 1, status: 403, reply: { message: 'Denied by bucket rules', code: 'forbidden' },
  });
  try {
    for (const options of [{}, { onProgress: () => {} }]) {
      await assert.rejects(storage.upload('b1', 'a.txt', 'hello', options), (e) => {
        assert.ok(e instanceof RiviumStorageError);
        assert.equal(e.statusCode, 403);
        assert.equal(e.message, 'Denied by bucket rules');
        return true;
      });
    }
  } finally {
    server.close();
  }
});

test('timeout is the same with onProgress', async () => {
  const server = http.createServer(() => { /* never answers */ });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', serverSecret: 'rv_srv_test', timeout: 150 });
  storage.baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(
      storage.upload('b1', 'a.bin', Buffer.alloc(256 * 1024), { onProgress: () => {} }),
      (e) => e.code === 'TIMEOUT' && e.statusCode === 408,
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('reporter: throttled, capped at the total, final exactly once', () => {
  let t = 0;
  const seen = [];
  const report = createProgressReporter((p) => seen.push(p.bytesSent), 10000, () => t);
  report(10); // first event always passes (time since 0 >= 50)
  t = 10; report(20); // 10 ms and 0.1%: dropped
  t = 20; report(200); // 1.9% since last: passes
  t = 30; report(200); // same value: dropped
  t = 100; report(250); // 80 ms since last: passes
  report(20000); // over the total: becomes the final event
  report(10000, true); // already finished
  assert.deepEqual(seen, [10, 200, 250, 10000]);
});
