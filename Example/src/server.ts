/**
 * "Your server" for every Rivium Storage example (Web, Android, iOS, Flutter, React Native).
 *
 *   npm run server        ->  http://127.0.0.1:4000
 *
 *   POST /token               mint a Rivium user token (what the apps' tokenProvider fetches)
 *   POST /signed-upload       create a signed upload link (the app then PUTs the file to it)
 *   POST /setup-test-buckets  create the test buckets + their access rules (idempotent)
 *   POST /confirm-upload      extra: register a signed upload right away (raw API call, see SDK gaps)
 *   POST /signed-url          extra: a time-limited download link for a file in a test bucket
 *   GET  /health              is the server up, which SDK version, which buckets
 *
 * The server secret stays here, read from .env. Apps and browsers only ever get the public key, user tokens and
 * signed links.
 *
 * NOT FOR PRODUCTION AS IS. A real server signs in its own user first (session cookie, your auth provider, Rivium
 * Auth...) and mints a token for THAT user. This demo takes the user id from the request body so you can test as
 * any user - which means anyone who can reach it can act as anyone. That is why it listens on 127.0.0.1 by default.
 * It also answers only to known Host names (localhost, 127.0.0.1, [::1], 10.0.2.2 and ALLOWED_HOSTS: DNS-rebinding
 * defence), takes POSTs only with Content-Type: application/json (so a plain cross-site form can't call it), and
 * with DEMO_TOKEN set, only from callers that send it in the x-demo-token header.
 * Plain node:http, no framework, so it is easy to copy into Express / Fastify / Next.js route handlers.
 */
import http from 'http';
import crypto from 'crypto';
import os from 'os';
import { RiviumStorageError, SDK_VERSION } from '@rivium/storage-node';
import { readEnv, serverStorage, SetupError, STORAGE_API, ExampleEnv } from './env';
import { setupTestBuckets } from './test-buckets';

let env: ExampleEnv;
try {
  env = readEnv();
} catch (e) {
  if (e instanceof SetupError) {
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

const server = serverStorage(env);

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Demo user ids: letters, digits and . _ - @ : (1-128 chars). Your real server uses its own signed-in user. */
const USER_ID = /^[A-Za-z0-9._@:-]{1,128}$/;

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `"${key}" is required`, 'invalid_request');
  return v;
}

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `"${key}" must be a positive number of seconds`, 'invalid_request');
  return Math.floor(n);
}

function demoUserId(body: Record<string, unknown>): string {
  const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : 'demo-user';
  if (!USER_ID.test(userId)) {
    throw new HttpError(400, 'userId: 1-128 characters, letters, digits and . _ - @ : only', 'invalid_request');
  }
  return userId;
}

/** Only the two test buckets: "public" / "private" or their names. Keeps the demo from handing out links elsewhere. */
function testBucket(body: Record<string, unknown>): string {
  const b = typeof body.bucket === 'string' && body.bucket ? body.bucket : 'public';
  if (b === 'public' || b === env.publicBucket) return env.publicBucket;
  if (b === 'private' || b === env.privateBucket) return env.privateBucket;
  throw new HttpError(400, `bucket must be "public", "private", "${env.publicBucket}" or "${env.privateBucket}"`, 'invalid_request');
}

// ------------------------------------------------------------------
// Endpoints
// ------------------------------------------------------------------

type Handler = (body: Record<string, unknown>) => Promise<unknown>;

const routes: Record<string, Handler> = {
  /**
   * Body: { "userId"?: string, "expiresIn"?: seconds (60 - 86400, default 3600) }
   * Answer: { token, userId, expiresIn, expiresAt }   <- the apps' tokenProvider returns `token`
   *
   * In your real server: no userId from the body. Use the user your own sign-in established, e.g.
   *   const { token } = await storage.createUserToken(req.session.userId);
   */
  '/token': async (body) => {
    const userId = demoUserId(body);
    return server.createUserToken(userId, optionalNumber(body, 'expiresIn'));
  },

  /**
   * Body: { "contentType": string, "path"?: string, "userId"?: string, "fileName"?: string,
   *         "bucket"?: "public" | "private", "expiresIn"?: seconds (max 3600, default 300) }
   * Without `path` the file goes to users/{userId}/signed/{fileName}.
   * Answer: { url, uploadId, path, expiresAt, maxSize, bucket, method: "PUT", headers }
   * The app then sends the bytes:  PUT url  with header  Content-Type: <the same contentType>.
   *
   * In your real server: check who the user is, and the file's type and size, BEFORE you hand out a link.
   */
  '/signed-upload': async (body) => {
    const bucket = testBucket(body);
    const contentType = requireString(body, 'contentType');
    let path = typeof body.path === 'string' && body.path.trim() ? body.path.trim() : '';
    if (!path) {
      const userId = demoUserId(body);
      const fileName = requireString(body, 'fileName').replace(/[\\/]/g, '_');
      path = `users/${userId}/signed/${fileName}`;
    }
    const link = await server.createSignedUploadUrl(bucket, path, {
      contentType,
      expiresIn: optionalNumber(body, 'expiresIn') ?? 300,
    });
    return {
      ...link,
      path: (link as { path?: string }).path ?? path,
      bucket,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    };
  },

  /**
   * Body: { "bucket"?: "public" | "private", "path": string }
   * Registers a file uploaded through a signed link now (otherwise the service does it on the next read or listing,
   * or within about 20 seconds). Answer: the file.
   * SDK gap: no confirmUpload() method in @rivium/storage-node yet, so this is a raw call to the documented route.
   */
  '/confirm-upload': async (body) => {
    const bucket = testBucket(body);
    const path = requireString(body, 'path');
    const res = await fetch(`${STORAGE_API}/api/v1/buckets/${encodeURIComponent(bucket)}/files/confirm-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.apiKey, 'x-server-secret': env.serverSecret },
      body: JSON.stringify({ path }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    if (!res.ok) throw new HttpError(res.status, data.message || `HTTP ${res.status}`, data.code);
    return data;
  },

  /**
   * Body: { "fileId": string, "expiresIn"?: seconds (max 86400, default 600) }
   * A signed download link (no headers needed: works in <img src>, a download link, Image.network...).
   * Only for files in the two test buckets.
   */
  '/signed-url': async (body) => {
    const fileId = requireString(body, 'fileId');
    const file = await server.getFile(fileId);
    const [pub, priv] = await Promise.all([
      server.getBucketByName(env.publicBucket).catch(() => null),
      server.getBucketByName(env.privateBucket).catch(() => null),
    ]);
    if (file.bucketId !== pub?.id && file.bucketId !== priv?.id) {
      throw new HttpError(403, 'The demo server only signs links for files in the test buckets', 'not_a_test_bucket');
    }
    const expiresIn = optionalNumber(body, 'expiresIn') ?? 600;
    return { url: await server.getSignedUrl(fileId, { expiresIn }), expiresIn, fileId };
  },

  /** Body: none. Answer: { public: {...}, private: {...}, warnings: [...] }. Safe to call again. */
  '/setup-test-buckets': async () => setupTestBuckets(server, env),
};

// ------------------------------------------------------------------
// HTTP plumbing (Host check, CORS, JSON, errors)
// ------------------------------------------------------------------

/** Loopback, the Android emulator's address for this computer, and the address the server listens on. */
const KNOWN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '10.0.2.2', ...env.allowedHosts]);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '']);
if (!WILDCARD_HOSTS.has(env.host)) KNOWN_HOSTS.add(env.host.toLowerCase());
// Listening on every interface (HOST=0.0.0.0, for a phone): this computer's own network addresses are known too, so
// a phone calling http://<your LAN IP>:4000 works without ALLOWED_HOSTS. Domain names (DNS rebinding) stay refused.
if (WILDCARD_HOSTS.has(env.host)) {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal) continue;
      KNOWN_HOSTS.add(a.family === 'IPv6' ? `[${a.address.toLowerCase()}]` : a.address);
    }
  }
}

/** The host name of a Host header, without the port ("[::1]:4000" -> "[::1]", "a.b:4000" -> "a.b"). */
function hostName(header: string | undefined): string {
  const h = (header || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const colon = h.lastIndexOf(':');
  return colon >= 0 ? h.slice(0, colon) : h;
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function cors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  // Native apps send no Origin. Browsers: only the origins in CORS_ORIGINS.
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-demo-token');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new HttpError(413, 'Body too large', 'invalid_request'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(new HttpError(400, 'Body must be JSON', 'invalid_request'));
      }
    });
    req.on('error', reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || '/', 'http://localhost');

  // DNS rebinding: a page on attacker.example can point its own name at this computer; the browser then sends
  // `Host: attacker.example`. Only known names get an answer.
  if (!KNOWN_HOSTS.has(hostName(req.headers.host))) {
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} -> 403 (unknown Host; add it to ALLOWED_HOSTS if it is yours)`);
    return send(res, 403, { error: 'Unknown Host. Add this address to ALLOWED_HOSTS in .env if it is yours.', code: 'host_not_allowed', status: 403 });
  }
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  let status = 200;
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      return send(res, 200, {
        ok: true,
        sdk: `@rivium/storage-node ${SDK_VERSION} (local source)`,
        endpoints: ['POST /token', 'POST /signed-upload', 'POST /setup-test-buckets', 'POST /confirm-upload', 'POST /signed-url'],
        buckets: { public: env.publicBucket, private: env.privateBucket, privateMaxSize: env.privateBucketMaxSize },
      });
    }
    const handler = routes[url.pathname];
    if (!handler) throw new HttpError(404, `No route ${req.method} ${url.pathname}`, 'not_found');
    if (req.method !== 'POST') throw new HttpError(405, `Use POST ${url.pathname}`, 'method_not_allowed');
    // A cross-site <form> can only send text/plain, urlencoded or multipart; requiring JSON forces a CORS preflight.
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      throw new HttpError(415, 'Send the body as JSON with Content-Type: application/json', 'unsupported_media_type');
    }
    if (env.demoToken && !sameSecret(req.headers['x-demo-token'], env.demoToken)) {
      throw new HttpError(401, 'Missing or wrong x-demo-token header (DEMO_TOKEN in the server .env)', 'demo_token_required');
    }
    const body = await readJson(req);
    send(res, 200, await handler(body));
  } catch (e) {
    if (e instanceof HttpError) {
      status = e.status;
      send(res, status, { error: e.message, code: e.code ?? null, status });
    } else if (e instanceof RiviumStorageError) {
      status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 502;
      send(res, status, { error: e.message, code: e.code ?? null, status });
    } else {
      status = 500;
      console.error(e);
      send(res, 500, { error: (e as Error).message || 'Internal error', code: null, status });
    }
  } finally {
    // Never log bodies: they can hold user ids and tokens.
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} -> ${status} (${Date.now() - started} ms)`);
  }
});

httpServer.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${env.port} is in use. Stop the other process or set PORT in .env.\n`);
  else console.error(e);
  process.exit(1);
});

httpServer.listen(env.port, env.host, () => {
  const where = `http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}`;
  console.log(`
Rivium Storage example server (@rivium/storage-node ${SDK_VERSION}, local source)
  ${where}
  POST /token               { userId?, expiresIn? }                     -> { token, expiresAt, ... }
  POST /signed-upload       { contentType, path? | userId + fileName, bucket?, expiresIn? }
  POST /setup-test-buckets  {}                                          -> test buckets + rules
  POST /confirm-upload      { path, bucket? }      (extra)
  POST /signed-url          { fileId, expiresIn? } (extra)
  CORS origins: ${env.corsOrigins.join(', ') || '(none)'}
  Test buckets: ${env.publicBucket}, ${env.privateBucket}
  Demo only: anyone who can reach this server can get a token for any user id.
  Answers to Host: ${[...KNOWN_HOSTS].join(', ')}${env.demoToken ? '\n  POSTs need the x-demo-token header (DEMO_TOKEN).' : ''}
`);
  if (!isLoopback(env.host)) {
    console.warn(`
  !!! WARNING: listening on ${env.host}, not only on this computer.
  !!! Anyone on this network can get user tokens for this project - use a TEST project
  !!! (and set DEMO_TOKEN in .env, sent by your apps as x-demo-token).
`);
  }
});
