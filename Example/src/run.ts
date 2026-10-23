/**
 * Rivium Storage Node.js SDK - every feature, against the real service, using the SDK source in ../ (file:../).
 *
 *   npm start               tour: each step with its explanation and result
 *   npm run check           self-test: PASS / FAIL per step, cleanup, exit code 1 on any failure
 *   npm run setup-buckets   only create the test buckets + rules the app examples need
 *
 * What it touches: the two shared test buckets (kept), files under example-node/<run id>/ in them (deleted at the
 * end), and one temporary bucket rivium-example-tmp-<run id> (deleted at the end; the Console keeps a deleted
 * bucket restorable for 7 days).
 */
import {
  RiviumStorage,
  RiviumStorageError,
  SDK_NAME,
  SDK_VERSION,
  StorageErrorCode,
  contentTypeForPath,
  publicImageUrl,
} from '@rivium/storage-node';
import type { Bucket, BucketPolicy, StorageFile, TransformOptions, PolicyRule } from '@rivium/storage-node';
import { readEnv, serverStorage, SetupError, STORAGE_API, ExampleEnv } from './env';
import { setupTestBuckets, TestBucketsResult, TestBucketInfo, IMAGE_TYPES } from './test-buckets';
import { BucketSetup, BucketFacts, SETUP_ONE_LINER } from './bucket-setup';
import { makePng, pngSize, makePdf, makeFakeExe, makeHtml, makeBlob, makeNoisePng } from './sample-files';
import { Step, runStep, printResult, printSection, colors, describeError, SkipStep, WarnStep, TransformRefusal } from './runner';

const args = process.argv.slice(2);
const mode: 'tour' | 'check' = args.includes('--check') ? 'check' : 'tour';
const setupOnly = args.includes('--setup-only');

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new SkipStep(`needs ${what} from an earlier step`);
  return value;
}

function facts(b: TestBucketInfo): BucketFacts {
  return { name: b.name, found: true, visibility: b.visibility, allowedMimeTypes: b.allowedMimeTypes, maxFileSize: b.maxFileSize, blockExecutables: b.blockExecutables };
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1] || '';
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

function summary(file: StorageFile) {
  return { id: file.id, path: file.path, fileName: file.fileName, mimeType: file.mimeType, size: Number(file.size), metadata: file.metadata };
}

function sameBytes(a: Buffer, b: Buffer, what: string): void {
  if (!a.equals(b)) throw new Error(`${what}: ${a.length} bytes differ from the ${b.length} bytes uploaded`);
}

async function main(): Promise<void> {
  let env: ExampleEnv;
  try {
    env = readEnv();
  } catch (e) {
    if (e instanceof SetupError) {
      console.error(colors.red(`\n${e.message}\n`));
      process.exit(1);
    }
    throw e;
  }

  const server = serverStorage(env); // public key + server secret: skips access rules
  const runId = `${Date.now().toString(36)}`;
  const prefix = `example-node/${runId}/`;
  const demoUser = 'demo-user-node';

  // State shared by the steps (captured from answers, never hard-coded).
  let buckets: TestBucketsResult | null = null;
  // The "Bucket setup" result. null (that step failed) = the dependent checks run as they are.
  let setup: BucketSetup | null = null;
  const when = (test: (b: BucketSetup) => string | null) => () => (setup ? test(setup) : null);
  let tmpBucket: Bucket | null = null;
  let customPolicy: BucketPolicy | null = null;
  const files: Record<string, StorageFile> = {};
  const bytes: Record<string, Buffer> = {};
  const toDelete = new Set<string>();
  const png = makePng(64, 48);

  const pub = () => need(buckets, 'the test buckets').public;
  const priv = () => need(buckets, 'the test buckets').private;
  const remember = (key: string, file: StorageFile, data: Buffer) => {
    files[key] = file;
    bytes[key] = data;
    toDelete.add(file.id);
    return file;
  };
  const file = (key: string) => need(files[key], `the "${key}" upload`);
  const serverHeaders = { 'x-api-key': env.apiKey, 'x-server-secret': env.serverSecret };

  const steps: Step[] = [];
  const add = (
    section: string,
    title: string,
    explain: string,
    run: () => Promise<unknown>,
    expectError?: Step['expectError'],
    precondition?: Step['precondition'],
  ) => steps.push({ section, title, explain, run, expectError, precondition });

  // ================================================================
  add('Bucket setup', 'Bucket setup: test buckets + access rules, compared with what the checks expect', `Creates what is missing (${env.publicBucket}: public, any type; ${env.privateBucket}: private, images only, max ${env.privateBucketMaxSize} bytes; both with executables blocked and the "users' own folders" rules), keeps what exists, then compares both buckets with that setup. WARN lists every difference with the Console setting to change; the checks that need a setting SKIP with the same hint instead of failing.`, async () => {
    buckets = await setupTestBuckets(server, env);
    setup = new BucketSetup(facts(buckets.public), facts(buckets.private));
    // Visibility / types / size are compared by BucketSetup; keep setup's other notes (extra access rules).
    const diffs = [...setup.differences(), ...buckets.warnings.filter((w) => w.includes('access rules'))];
    const unknown = setup.unknowns();
    if (diffs.length) {
      throw new WarnStep([`${diffs.length} difference(s) from the expected bucket setup:`, ...diffs.map((d) => `- ${d}`), ...unknown.map((u) => `- ${u}`), SETUP_ONE_LINER].join('\n'));
    }
    return { ...buckets, matchesExpectedSetup: true, unknown };
  });

  // ================================================================
  add('Setup', 'SDK name and version', 'The SDK sends "X-Rivium-SDK: <name>/<version>" on every request. This is the local source (file:../).', async () => ({
    SDK_NAME,
    SDK_VERSION,
  }));

  add('Setup', 'new RiviumStorage({ apiKey: "" }) is refused', 'The public key is required; the constructor throws before any request.', async () => new RiviumStorage({ apiKey: '', serverSecret: env.serverSecret }), {
    message: /API key is required/,
  });

  add('Setup', 'new RiviumStorage({ apiKey }) without serverSecret is refused', 'The Node SDK runs on your server and always needs the server secret; apps use the Web / React Native / mobile SDKs with a user token. The constructor throws INVALID_ARGUMENT before any request.', async () =>
    new RiviumStorage({ apiKey: env.apiKey } as unknown as ConstructorParameters<typeof RiviumStorage>[0]), {
    status: 400,
    code: 'INVALID_ARGUMENT',
    message: /needs serverSecret/,
  });

  if (!setupOnly) {
    // ================================================================
    add('User tokens', 'createUserToken(userId)', 'Your server mints a Rivium user token for its signed-in user; the app SDKs get it through tokenProvider and send it as x-user-token. Default lifetime 1 hour.', async () => {
      const t = await server.createUserToken(demoUser);
      const claims = decodeJwt(t.token);
      if (claims.sub !== demoUser) throw new Error(`token subject is ${claims.sub}, expected ${demoUser}`);
      return { userId: t.userId, expiresIn: t.expiresIn, expiresAt: t.expiresAt, token: `${t.token.slice(0, 24)}...`, claims: { sub: claims.sub, pid: claims.pid, iss: claims.iss, aud: claims.aud, exp: claims.exp } };
    });

    add('User tokens', 'createUserToken(userId, 900)', 'Custom lifetime in seconds (60 to 86400).', async () => {
      const t = await server.createUserToken(demoUser, 900);
      if (t.expiresIn !== 900) throw new Error(`expiresIn is ${t.expiresIn}, expected 900`);
      return { expiresIn: t.expiresIn, expiresAt: t.expiresAt };
    });

    add('User tokens', 'createUserToken("") is refused', 'A user id is required.', async () => server.createUserToken(''), { status: 400, code: 'INVALID_ARGUMENT' });

    add('User tokens', 'createUserToken with a wrong server secret', 'Rivium Auth answers 401 with its message; the SDK keeps status and message.', async () =>
      new RiviumStorage({ apiKey: env.apiKey, serverSecret: 'rv_srv_wrong_secret_for_the_example', authUrl: env.authUrl }).createUserToken(demoUser), {
      status: [401, 403],
    });

    // ================================================================
    const tmpName = `rivium-example-tmp-${runId}`;
    add('Buckets', 'createBucket(name, options)', 'Server secret. Every option: visibility, allowedMimeTypes, maxFileSize, description (+ blockExecutables, which the SDK type does not list yet - see SDK gaps).', async () => {
      tmpBucket = await server.createBucket(tmpName, {
        visibility: 'private',
        allowedMimeTypes: ['text/*', 'image/*'],
        maxFileSize: 2 * 1024 * 1024,
        description: 'Temporary bucket of the Node example (deleted at the end of the run)',
        ...({ blockExecutables: true } as object),
      });
      return tmpBucket;
    });

    add('Buckets', 'listBuckets()', "All of the project's buckets.", async () => {
      const list = await server.listBuckets();
      if (!list.some((b) => b.name === tmpName)) throw new Error(`${tmpName} is not in the list`);
      return list.map((b) => ({ id: b.id, name: b.name, visibility: b.visibility }));
    });

    add('Buckets', 'getBucket(id)', 'One bucket by its id.', async () => {
      const b = await server.getBucket(need(tmpBucket, 'the temporary bucket').id);
      return { id: b.id, name: b.name, visibility: b.visibility, allowedMimeTypes: b.allowedMimeTypes, maxFileSize: b.maxFileSize };
    });

    add('Buckets', 'getBucketByName(name)', 'One bucket by its name (names are unique in a project). Every file method also takes a bucket name instead of an id.', async () => {
      const b = await server.getBucketByName(tmpName);
      if (b.id !== need(tmpBucket, 'the temporary bucket').id) throw new Error('a different bucket came back');
      return { id: b.id, name: b.name };
    });

    // ================================================================
    add('Access rules', 'getPolicyTemplates(bucketId)', 'The ready-made rule sets: publicRead, private, userFolders, imagesOnly, closed.', async () => {
      const t = await server.getPolicyTemplates(need(tmpBucket, 'the temporary bucket').id);
      return Object.fromEntries(Object.entries(t).map(([k, rules]) => [k, `${rules.length} rule(s)`]));
    });

    add('Access rules', "applyPolicyTemplate(bucketId, 'userFolders', name)", "Signed-in users read and list; they write and delete only under users/{their id}/.", async () => {
      const p = await server.applyPolicyTemplate(need(tmpBucket, 'the temporary bucket').id, 'userFolders', 'example: users own folders');
      return { id: p.id, name: p.name, rules: p.rules.map((r) => `${r.effect ?? 'allow'} ${r.action} ${JSON.stringify(r.condition)}`) };
    });

    add('Access rules', 'createPolicy(bucketId, rules, { name, description })', 'Your own rules: every condition field (authenticated, pathPattern, matchUserId, maxSize, allowedMimeTypes, validAfter / validBefore, allowedIPs), allow and deny, priority.', async () => {
      const rules: PolicyRule[] = [
        { name: 'Signed-in users read', action: 'read', condition: { authenticated: true }, effect: 'allow', priority: 10 },
        { name: 'Own folder, images up to 1 MB', action: 'write', condition: { authenticated: true, pathPattern: 'users/{userId}/**', matchUserId: true, allowedMimeTypes: IMAGE_TYPES, maxSize: 1024 * 1024 }, effect: 'allow', priority: 20 },
        { name: 'Only during 2026', action: 'list', condition: { authenticated: true, validAfter: '2026-01-01T00:00:00Z', validBefore: '2027-01-01T00:00:00Z' }, effect: 'allow', priority: 5 },
        { name: 'Office network may delete', action: 'delete', condition: { allowedIPs: ['203.0.113.0/24'] }, effect: 'allow', priority: 5 },
        { name: 'Nobody touches archive/', action: '*', condition: { pathPattern: 'archive/**' }, effect: 'deny', priority: 100 },
      ];
      customPolicy = await server.createPolicy(need(tmpBucket, 'the temporary bucket').id, rules, { name: 'example: custom rules', description: 'Made by the Node example' });
      return { id: customPolicy.id, name: customPolicy.name, rules: customPolicy.rules.length };
    });

    add('Access rules', 'listPolicies(bucketId)', 'Both rule sets are on the bucket.', async () => {
      const list = await server.listPolicies(need(tmpBucket, 'the temporary bucket').id);
      if (list.length < 2) throw new Error(`expected 2 policies, got ${list.length}`);
      return list.map((p) => ({ id: p.id, name: p.name, rules: p.rules.length }));
    });

    add('Access rules', 'deletePolicy(bucketId, policyId)', 'Removes one rule set.', async () => {
      const b = need(tmpBucket, 'the temporary bucket');
      await server.deletePolicy(b.id, need(customPolicy, 'the custom policy').id);
      const left = await server.listPolicies(b.id);
      if (left.some((p) => p.id === customPolicy!.id)) throw new Error('the policy is still there');
      return { remaining: left.map((p) => p.name) };
    });

    // ================================================================
    add('Upload', 'upload(bucket, path, Buffer, { contentType, metadata })', 'From a Buffer, with a content type and your own metadata. Your server uploads with the secret, so the access rules are skipped.', async () => {
      const data = Buffer.from(`Hello from the Rivium Storage Node example, run ${runId}\n`, 'utf8');
      const f = await server.upload(pub().name, `${prefix}hello.txt`, data, { contentType: 'text/plain', metadata: { source: 'node-example', runId } });
      return summary(remember('text', f, data));
    }, undefined, when((b) => b.publicAllows('text/plain')));

    add('Upload', 'upload(bucket, path, string)', 'From a string (sent as UTF-8).', async () => {
      const text = JSON.stringify({ hello: 'world', runId });
      const f = await server.upload(pub().name, `${prefix}data.json`, text, { contentType: 'application/json' });
      return summary(remember('json', f, Buffer.from(text, 'utf8')));
    }, undefined, when((b) => b.publicAllows('application/json')));

    add('Upload', 'upload(bucket, path, Uint8Array) - an image', 'From a Uint8Array: a real 64x48 PNG, used below for links and transforms.', async () => {
      const f = await server.upload(pub().id, `${prefix}gradient.png`, new Uint8Array(png), { contentType: 'image/png' });
      return summary(remember('png', f, png));
    }, undefined, when((b) => b.publicAllows('image/png')));

    add('Upload', 'upload(..., { path }) - the path option', 'options.path overrides the path argument (the argument then only names the form field).', async () => {
      const data = Buffer.from('path option', 'utf8');
      const f = await server.upload(pub().name, 'ignored-name.txt', data, { contentType: 'text/plain', path: `${prefix}from-path-option.txt` });
      if (f.path !== `${prefix}from-path-option.txt`) throw new Error(`stored at ${f.path}`);
      return summary(remember('pathOption', f, data));
    }, undefined, when((b) => b.publicAllows('text/plain')));

    add('Upload', 'Unicode file name: رسید-۸۸۱۲.pdf', 'Paths may use any language (stored in Unicode NFC). A real PDF.', async () => {
      const data = makePdf('receipt 8812');
      const f = await server.upload(pub().name, `${prefix}رسید-۸۸۱۲.pdf`, data, { contentType: 'application/pdf' });
      return summary(remember('unicode', f, data));
    }, undefined, when((b) => b.publicAllows('application/pdf')));

    add('Upload', 'File name with spaces: my holiday photo.png', 'Spaces are fine too.', async () => {
      const f = await server.upload(pub().name, `${prefix}my holiday photo.png`, png, { contentType: 'image/png' });
      return summary(remember('spaces', f, png));
    }, undefined, when((b) => b.publicAllows('image/png')));

    add('Upload', 'An image in the private bucket', 'Private files are never public: read them with download(), a signed link, or (in apps) with the user token.', async () => {
      const f = await server.upload(priv().name, `${prefix}private.png`, png, { contentType: 'image/png' });
      return summary(remember('private', f, png));
    }, undefined, when((b) => b.privateAllowsPng()));

    // ================================================================
    add('Read', 'listFiles(bucket, { prefix, limit }) + cursor paging', 'Lists under a prefix, 2 per page, following nextCursor until the end.', async () => {
      const pages: string[][] = [];
      let cursor: string | null | undefined;
      do {
        const page = await server.listFiles(pub().name, { prefix, limit: 2, cursor });
        pages.push(page.files.map((f) => f.path.slice(prefix.length)));
        cursor = page.nextCursor;
      } while (cursor && pages.length < 20);
      const total = pages.flat().length;
      const expected = ['text', 'json', 'png', 'pathOption', 'unicode', 'spaces'].filter((k) => files[k]).length;
      if (total !== expected) throw new Error(`listed ${total} files, uploaded ${expected}`);
      return { pages };
    });

    add('Read', 'getFile(id)', 'A file by its id: path, type, size, metadata, who uploaded it.', async () => summary(await server.getFile(file('text').id)));

    add('Read', 'getFileByPath(bucket, path) - Unicode path', 'A file by bucket + path.', async () => {
      const f = await server.getFileByPath(pub().name, file('unicode').path);
      if (f.id !== file('unicode').id) throw new Error('a different file came back');
      return summary(f);
    });

    add('Read', 'download(id) -> Buffer', 'The bytes, identical to what was uploaded.', async () => {
      const data = await server.download(file('unicode').id);
      sameBytes(data, bytes.unicode, 'download');
      return { bytes: data.length, startsWith: data.subarray(0, 8).toString('latin1') };
    });

    add('Read', 'download(id) of a private file', 'Your server reads private files with the secret.', async () => {
      const data = await server.download(file('private').id);
      sameBytes(data, bytes.private, 'download');
      return { bytes: data.length };
    });

    // ================================================================
    add('File types', 'file types: .json / .csv / .md upload with no contentType', "No contentType: the SDK sends the type the Rivium Storage file types table lists for the extension (the formats the Console offers in a bucket's allowed types), and the server stores exactly that. contentTypeForPath(path) shows the type the SDK would send.", async () => {
      const cases: Array<[string, Buffer | string, string]> = [
        ['data.json', JSON.stringify({ runId }), 'application/json'],
        ['table.csv', Buffer.from('name,score\nada,3\n', 'utf8'), 'text/csv'],
        ['notes.md', `# Notes\n\nrun ${runId}\n`, 'text/markdown'],
      ];
      const out: Record<string, string> = {};
      for (const [name, data, want] of cases) {
        if (contentTypeForPath(name) !== want) throw new Error(`contentTypeForPath(${name}) is ${contentTypeForPath(name)}, expected ${want}`);
        let f: StorageFile;
        try {
          f = await server.upload(pub().name, `${prefix}types/${name}`, data);
        } catch (e) {
          if (e instanceof RiviumStorageError && e.code === StorageErrorCode.TypeNotAllowed) {
            throw new SkipStep(`${pub().name} doesn't allow ${want}: allow ${name.split('.').pop()!.toUpperCase()} in the Console (Bucket › Settings › Allowed file types) to run this check.`);
          }
          throw e;
        }
        remember(`type-${name}`, f, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
        if (f.mimeType !== want) throw new Error(`${name} stored as ${f.mimeType}, expected ${want}`);
        out[name] = f.mimeType;
      }
      return out;
    }, undefined, when((b) => b.publicAllows('application/json', 'text/csv', 'text/markdown')));

    // ================================================================
    add('Upload progress', 'upload(..., { onProgress }) - 5 MB PNG, progress reaches 100%', 'A real PNG of noise pixels (image/png, so image-only buckets accept it). onProgress gets { bytesSent, totalBytes } while the body is sent: at most every 50 ms or every 1%, and once at the end with bytesSent === totalBytes. totalBytes is the whole request (file + form fields), a little more than the file.', async () => {
      const data = makeNoisePng(1300, 1300);
      const header = pngSize(data);
      if (header?.width !== 1300 || header?.height !== 1300) throw new Error(`generated PNG header says ${JSON.stringify(header)}, expected 1300x1300`);
      if (data.length < 2 * 1024 * 1024) throw new Error(`generated PNG is only ${data.length} bytes`);
      const events: { bytesSent: number; totalBytes: number; ms: number }[] = [];
      const started = Date.now();
      let nextTenth = 0;
      const upload = server.upload(pub().name, `${prefix}progress-test.png`, data, {
        contentType: 'image/png',
        onProgress: ({ bytesSent, totalBytes }) => {
          events.push({ bytesSent, totalBytes, ms: Date.now() - started });
          // The tour prints a line every 10%, live.
          const percent = Math.floor((bytesSent / totalBytes) * 100);
          if (mode === 'tour' && percent >= nextTenth) {
            console.log(colors.dim(`   upload progress: ${String(percent).padStart(3)}%  ${bytesSent} of ${totalBytes} bytes  (${Date.now() - started} ms)`));
            nextTenth = Math.floor(percent / 10) * 10 + 10;
          }
        },
      });
      const f = await upload.catch((e: unknown) => {
        if (e instanceof RiviumStorageError && e.code === StorageErrorCode.TypeNotAllowed) {
          throw new SkipStep("This bucket doesn't allow image/png. Allow PNG in the Console (Bucket › Settings › Allowed file types) to run this check.");
        }
        throw e;
      });
      remember('large', f, data);
      if (!events.length) throw new Error('onProgress was never called');
      const last = events[events.length - 1];
      if (last.bytesSent !== last.totalBytes) throw new Error(`last event: ${last.bytesSent} of ${last.totalBytes}`);
      if (last.totalBytes < data.length) throw new Error(`totalBytes ${last.totalBytes} is smaller than the file (${data.length})`);
      events.forEach((e, i) => {
        if (e.bytesSent > e.totalBytes || e.totalBytes !== last.totalBytes) throw new Error(`event ${i}: ${e.bytesSent} of ${e.totalBytes}`);
        if (i > 0 && e.bytesSent <= events[i - 1].bytesSent) throw new Error(`event ${i} went backwards`);
      });
      if (events.filter((e) => e.bytesSent === e.totalBytes).length !== 1) throw new Error('more than one final event');
      if (Number(f.size) !== data.length) throw new Error(`stored ${f.size} bytes, sent ${data.length}`);
      return { events: events.length, totalBytes: last.totalBytes, fileBytes: data.length, ms: Date.now() - started, file: f.path };
    }, undefined, when((b) => b.publicAllows('image/png')));

    // ================================================================
    add('Links', 'getUrl(id) -> public link (public bucket)', 'getUrl() builds the API address GET /files/:id/url, which needs the x-api-key header and answers { url }. That url is the public link: no headers, use it anywhere (<img src>, Image.network...).', async () => {
      const api = server.getUrl(file('png').id);
      const res = await fetch(api, { headers: { 'x-api-key': env.apiKey } });
      const body = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !body.url) throw new Error(`${res.status} ${body.message ?? ''}`);
      const pubRes = await fetch(body.url);
      const data = Buffer.from(await pubRes.arrayBuffer());
      sameBytes(data, png, 'public link');
      return { api, publicUrl: body.url, status: pubRes.status, contentType: pubRes.headers.get('content-type'), bytes: data.length };
    });

    add('Links', 'getUrl(id) of a private file -> 403', 'A private file has no public link: the API answers 403 "File is not in a public bucket".', async () => {
      const res = await fetch(server.getUrl(file('private').id), { headers: { 'x-api-key': env.apiKey } });
      const body = (await res.json()) as { message?: string };
      if (res.status !== 403) throw new Error(`expected 403, got ${res.status} ${JSON.stringify(body)}`);
      return { status: res.status, message: body.message };
    });

    add('Links', 'getDownloadUrl(id)', 'The API download address. It needs headers (x-api-key, and the secret or a user token), so it is for code, not for <img src>.', async () => {
      const url = server.getDownloadUrl(file('json').id);
      const res = await fetch(url, { headers: serverHeaders });
      const data = Buffer.from(await res.arrayBuffer());
      sameBytes(data, bytes.json, 'getDownloadUrl');
      return { url, status: res.status, contentDisposition: res.headers.get('content-disposition') };
    });

    add('Links', 'getSignedUrl(id, { expiresIn })', 'Server secret. A time-limited link to a PRIVATE file that needs no headers - the right way to show a private image in an <img>.', async () => {
      const url = await server.getSignedUrl(file('private').id, { expiresIn: 600 });
      const res = await fetch(url);
      const data = Buffer.from(await res.arrayBuffer());
      sameBytes(data, png, 'signed link');
      return { url: `${url.split('?')[0]}?...(signature)`, status: res.status, bytes: data.length };
    });

    let signedPath: string | null = null;
    add('Links', 'createSignedUploadUrl(bucket, path, { contentType, expiresIn }) + PUT', 'Server secret. A link a client uploads to directly (PUT with the same Content-Type), so big files skip your server. The bucket limits, executable check and rules are checked again when it arrives.', async () => {
      signedPath = `${prefix}signed-upload.txt`;
      const data = Buffer.from('uploaded through a signed link', 'utf8');
      const link = await server.createSignedUploadUrl(pub().name, signedPath, { contentType: 'text/plain', expiresIn: 300 });
      const put = await fetch(link.url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: data });
      if (!put.ok) throw new Error(`PUT answered ${put.status}: ${await put.text()}`);
      bytes.signed = data;
      return { link: { ...link, url: `${link.url.split('?')[0]}?...(signature)` }, put: put.status };
    }, undefined, when((b) => b.publicAllows('text/plain')));

    add('Links', 'Confirm the signed upload (raw API: SDK gap)', 'POST /buckets/:bucket/files/confirm-upload registers it now (otherwise: on the next read or listing, or within ~20 s). The Node SDK has no method for it yet.', async () => {
      const path = need(signedPath, 'the signed upload');
      const res = await fetch(`${STORAGE_API}/api/v1/buckets/${encodeURIComponent(pub().name)}/files/confirm-upload`, {
        method: 'POST',
        headers: { ...serverHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const body = (await res.json()) as StorageFile & { message?: string };
      if (!res.ok) throw new Error(`${res.status} ${body.message ?? ''}`);
      remember('signed', body, bytes.signed);
      const data = await server.download(body.id);
      sameBytes(data, bytes.signed, 'signed upload');
      return summary(body);
    });

    // ================================================================
    const transforms: Array<{ name: string; t: TransformOptions; expect?: (b: Buffer) => string | null }> = [
      { name: 'width', t: { width: 32, format: 'png' }, expect: (b) => dims(b, 32, 24) },
      { name: 'height', t: { height: 24, format: 'png' }, expect: (b) => dims(b, 32, 24) },
      { name: 'fit: cover', t: { width: 40, height: 40, fit: 'cover', format: 'png' }, expect: (b) => dims(b, 40, 40) },
      { name: 'fit: contain', t: { width: 40, height: 40, fit: 'contain', format: 'png' }, expect: (b) => dims(b, 40, 40) },
      { name: 'fit: fill', t: { width: 40, height: 20, fit: 'fill', format: 'png' }, expect: (b) => dims(b, 40, 20) },
      { name: 'fit: inside', t: { width: 40, height: 40, fit: 'inside', format: 'png' }, expect: (b) => dims(b, 40, 30) },
      { name: 'fit: outside', t: { width: 40, height: 40, fit: 'outside', format: 'png' } },
      { name: 'format: jpeg', t: { format: 'jpeg' } },
      { name: 'format: png', t: { format: 'png' } },
      { name: 'format: webp', t: { format: 'webp' } },
      { name: 'format: avif', t: { format: 'avif' } },
      { name: 'quality: 20', t: { format: 'jpeg', quality: 20 } },
      { name: 'quality: 95', t: { format: 'jpeg', quality: 95 } },
      { name: 'blur: 10', t: { blur: 10, format: 'png' } },
      { name: 'sharpen: 50', t: { sharpen: 50, format: 'png' } },
      { name: 'rotate: 90', t: { rotate: 90, format: 'png' }, expect: (b) => dims(b, 48, 64) },
      { name: 'everything', t: { width: 800, height: 600, fit: 'contain', format: 'webp', quality: 85, blur: 1, sharpen: 10, rotate: 180 } },
    ];
    function dims(b: Buffer, w: number, h: number): string | null {
      const s = pngSize(b);
      return s && s.width === w && s.height === h ? null : `expected ${w}x${h}, got ${s ? `${s.width}x${s.height}` : 'not a PNG'}`;
    }

    add('Image transforms', 'getTransformUrl(id, options) - every option', 'Builds /api/v1/transform/:id?w=&h=&fit=&f=&q=&blur=&sharpen=&rotate=. Like getUrl it needs the x-api-key header (and a user token where the rules ask for one), so fetch it with headers. Original: 64x48 PNG.', async () => {
      const out: Record<string, unknown> = {};
      for (const { name, t, expect } of transforms) {
        const url = server.getTransformUrl(file('png').id, t);
        const res = await fetch(url, { headers: serverHeaders });
        // A refusal reads code + message from the JSON body: a title and a hint, never the raw body.
        if (!res.ok) {
          const refusal = await TransformRefusal.from(res);
          refusal.message = `${name}: ${refusal.message}`; // which option set failed
          throw refusal;
        }
        const data = Buffer.from(await res.arrayBuffer());
        const problem = expect?.(data);
        if (problem) throw new Error(`${name}: ${problem}`);
        const size = pngSize(data);
        out[name] = `${res.headers.get('content-type')} ${data.length} B${size ? ` ${size.width}x${size.height}` : ''}  ${url.split('?')[1]}`;
      }
      return out;
    });

    add(
      'Image transforms',
      'Transform of a file that is not an image',
      'The API answers 400 with code not_an_image (StorageErrorCode.NotAnImage); the body\'s message names the file\'s type. Read code and message from the JSON body to tell the user why.',
      async () => {
        const res = await fetch(server.getTransformUrl(file('text').id, { width: 10 }), { headers: serverHeaders });
        if (!res.ok) throw await TransformRefusal.from(res);
        return `HTTP ${res.status}, ${res.headers.get('content-type')}`;
      },
      { status: 400, code: StorageErrorCode.NotAnImage },
    );

    /**
     * GET a public image URL with no headers at all (no key, no secret, no user token), as an <img> or an image view
     * does. A 503 transform_busy is retried once after its Retry-After seconds; other refusals throw a TransformRefusal.
     */
    const fetchPublicImage = async (url: string, onBusy?: (seconds: number) => void): Promise<Response> => {
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(url);
        if (res.ok) return res;
        const refusal = await TransformRefusal.from(res);
        if (refusal.code === StorageErrorCode.TransformBusy && attempt === 1) {
          const wait = refusal.retryAfter ?? 2;
          onBusy?.(wait);
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        throw refusal;
      }
    };
    /** getPublicUrl(id, options), with a SKIP hint when the test bucket isn't public. */
    const publicImageLink = async (t: TransformOptions): Promise<string> => {
      try {
        return await server.getPublicUrl(file('png').id, t);
      } catch (e) {
        if (e instanceof RiviumStorageError && e.statusCode === 403) {
          throw new SkipStep(`${pub().name} isn't public (getPublicUrl answered 403): set its Visibility to Public in the Console to run this check.`);
        }
        throw e;
      }
    };
    const planLocked = (e: unknown) => e instanceof TransformRefusal && e.code === StorageErrorCode.PlanFeatureLocked;

    add('Image transforms', 'Public bucket: header-free link - getPublicUrl(id, options)', 'For a file in a PUBLIC bucket, getPublicUrl(id, { width, format, ... }) returns the public link with the options (.../public/<bucketId>/<path>?w=48&f=webp). It needs no headers, so it goes into <img src>, e-mails and API answers, and the CDN caches it. publicImageUrl(link, options) builds the same URL from a stored link without a request. Use a few fixed sizes: one image keeps at most 50 variants (429 too_many_variants). Refusals: 403 plan_feature_locked, 429 too_many_variants, 503 transform_busy (retried once after Retry-After).', async () => {
      const t: TransformOptions = { width: 48, format: 'webp', quality: 80 };
      const url = await publicImageLink(t);
      const plain = await server.getPublicUrl(file('png').id);
      if (publicImageUrl(plain, t) !== url) throw new Error(`publicImageUrl gave ${publicImageUrl(plain, t)}, getPublicUrl ${url}`);
      let busy = '';
      let res: Response;
      try {
        res = await fetchPublicImage(url, (s) => { busy = `Busy, retried after ${s} s`; });
      } catch (e) {
        if (planLocked(e)) throw new SkipStep(`${(e as TransformRefusal).message} (403 plan_feature_locked): this check needs a plan with image transforms.`);
        throw e;
      }
      const data = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('image/webp')) throw new Error(`content type ${type}`);
      return { url, sameAsPublicImageUrl: true, status: res.status, contentType: type, bytes: data.length, cache: res.headers.get('x-transform-cache'), ...(busy ? { busy } : {}), headersSent: 'none' };
    }, undefined, when((b) => b.publicAllows('image/png')));

    add('Image transforms', 'Public transform link loads without headers (and a second load is a cache hit)', 'Fetches the same public image URL twice with no headers: 200 image both times, X-Transform-Cache: miss (made and counted once), then hit (served from the cache, not counted again; a CDN copy counts as a hit too).', async () => {
      const url = await publicImageLink({ width: 32, format: 'webp' });
      const load = async () => {
        let res: Response;
        try {
          res = await fetchPublicImage(url);
        } catch (e) {
          if (planLocked(e)) throw new SkipStep(`${(e as TransformRefusal).message} (403 plan_feature_locked): this check needs a plan with image transforms.`);
          throw e;
        }
        const data = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get('content-type') ?? '';
        if (res.status !== 200 || !type.startsWith('image/webp')) throw new Error(`HTTP ${res.status}, ${type}`);
        return { cache: res.headers.get('x-transform-cache'), cdn: res.headers.get('cf-cache-status'), bytes: data.length };
      };
      const first = await load();
      const second = await load();
      if (first.cache !== 'miss') throw new Error(`first load: X-Transform-Cache ${first.cache}, expected miss`);
      if (second.cache !== 'hit' && second.cdn !== 'HIT') throw new Error(`second load: X-Transform-Cache ${second.cache}${second.cdn ? `, CDN ${second.cdn}` : ''}, expected hit`);
      return { url, first, second, headersSent: 'none' };
    }, undefined, when((b) => b.publicAllows('image/png')));

    // ================================================================
    add('Errors', 'Not found: getFile(unknown id)', '404 for an id that does not exist (or is in another project).', async () => server.getFile('00000000-0000-4000-8000-000000000000'), {
      status: 404,
      message: /not found/i,
    });

    add('Errors', 'Bad id: getFile("not-a-uuid")', '400 "Invalid file ID format".', async () => server.getFile('not-a-uuid'), { status: 400, message: /Invalid file ID/i });

    add('Errors', 'Not found: download(unknown id)', "download() keeps the server's message, status and code, like every other call.", async () => server.download('00000000-0000-4000-8000-000000000000'), {
      status: 404,
      message: /not found/i,
    });

    add('Errors', 'Type not allowed: a PDF in the images-only bucket', '400, code "type_not_allowed" (StorageErrorCode.TypeNotAllowed).', async () =>
      server.upload(priv().name, `${prefix}not-an-image.pdf`, makePdf(), { contentType: 'application/pdf' }), {
      status: 400,
      code: StorageErrorCode.TypeNotAllowed,
    }, when((b) => b.privateRefuses('application/pdf')));

    add('Errors', 'Too big: one byte over the bucket limit', `400, code "file_too_large" (StorageErrorCode.FileTooLarge; ${env.privateBucket} allows ${env.privateBucketMaxSize} bytes).`, async () =>
      server.upload(priv().name, `${prefix}too-big.png`, makeBlob(priv().maxFileSize ? priv().maxFileSize! + 1 : env.privateBucketMaxSize + 1), { contentType: 'image/png' }), {
      status: 400,
      code: StorageErrorCode.FileTooLarge,
    }, when((b) => b.privateHasMaxSize()));

    add('Errors', 'Executable blocked: a tiny fake setup.exe', 'Buckets refuse programs, installers and scripts (by name, by content, inside ZIPs) - 400, code "executable_blocked" (StorageErrorCode.ExecutableBlocked). Even the server secret cannot store one.', async () =>
      server.upload(pub().name, `${prefix}setup.exe`, makeFakeExe(), { contentType: 'application/octet-stream' }), {
      status: 400,
      code: StorageErrorCode.ExecutableBlocked,
    }, when((b) => b.blocksExecutables('public')));

    add('Errors', 'Content mismatch: HTML bytes declared as image/png', 'The type comes from the real content, not the declared one: HTML is refused in the images-only bucket: code "type_not_allowed", and the message names text/html (declared image/png).', async () =>
      server.upload(priv().name, `${prefix}fake.png`, makeHtml(), { contentType: 'image/png' }), {
      status: 400,
      code: StorageErrorCode.TypeNotAllowed,
      message: /text\/html/,
    }, when((b) => b.privateRefuses('text/html')));

    add('Errors', 'Timeout', 'timeout: 1 ms -> 408, code TIMEOUT.', async () => new RiviumStorage({ apiKey: env.apiKey, serverSecret: env.serverSecret, timeout: 1 }).listBuckets(), {
      status: 408,
      code: 'TIMEOUT',
    });

    // ================================================================
    add('Delete', 'delete(id)', 'Server secret. Deletes one file.', async () => {
      const id = file('json').id;
      await server.delete(id);
      toDelete.delete(id);
      try {
        await server.getFile(id);
      } catch (e) {
        if (e instanceof RiviumStorageError && e.statusCode === 404) return { deleted: id, thenGetFile: '404' };
        throw e;
      }
      throw new Error('the file is still there');
    });

    add('Delete', 'deleteByPath(bucket, path) - path with spaces', 'Server secret. Deletes by bucket + path.', async () => {
      const f = file('spaces');
      await server.deleteByPath(pub().name, f.path);
      toDelete.delete(f.id);
      return { deleted: f.path };
    });

    add('Delete', 'deleteMany(ids)', 'Server secret. Deletes several at once and says how many went.', async () => {
      const ids = [...toDelete];
      const r = await server.deleteMany(ids);
      if (r.deleted !== ids.length) throw new Error(`deleted ${r.deleted} of ${ids.length}`);
      toDelete.clear();
      return r;
    });

    add('Buckets', 'deleteBucket(id)', 'Server secret. Deletes the temporary bucket (restorable from the Console for 7 days).', async () => {
      const b = need(tmpBucket, 'the temporary bucket');
      await server.deleteBucket(b.id);
      tmpBucket = null;
      return { deleted: b.name };
    });
  }

  // ================================================================
  console.log(colors.bold(`\nRivium Storage Node.js SDK example - ${mode === 'check' ? 'self-test' : 'tour'} (${SDK_NAME}/${SDK_VERSION}, local source)`));
  console.log(colors.dim(`run id ${runId}; files under ${prefix}\n`));

  let section = '';
  let index = 0;
  let failed = 0;
  let skipped = 0;
  let warned = 0;
  for (const step of steps) {
    if (step.section !== section) {
      section = step.section;
      printSection(section, mode);
    }
    const r = await runStep(step);
    if (!r.ok) failed++;
    if (r.skipped) skipped++;
    if (r.warned) warned++;
    printResult(r, mode, ++index);
  }

  // Cleanup: always, also after failures. Reported, never silent.
  const cleanup: string[] = [];
  if (toDelete.size) {
    try {
      const r = await server.deleteMany([...toDelete]);
      cleanup.push(`deleted ${r.deleted} of ${toDelete.size} leftover file(s)`);
    } catch (e) {
      failed++;
      cleanup.push(colors.red(`could not delete leftover files ${[...toDelete].join(', ')}: ${describeError(e)}`));
    }
  }
  if (tmpBucket) {
    try {
      await server.deleteBucket((tmpBucket as Bucket).id);
      cleanup.push(`deleted the temporary bucket ${(tmpBucket as Bucket).name}`);
    } catch (e) {
      failed++;
      cleanup.push(colors.red(`could not delete the temporary bucket: ${describeError(e)}`));
    }
  }
  if (cleanup.length) console.log(colors.dim(`\nCleanup: ${cleanup.join('; ')}`));

  console.log('');
  if (failed) {
    console.log(colors.red(colors.bold(`${failed} of ${index} step(s) failed.`)));
    process.exitCode = 1;
  } else {
    const extra = [skipped && `${skipped} skipped`, warned && `${warned} warning`].filter(Boolean).join(', ');
    console.log(colors.green(colors.bold(extra ? `All ${index} step(s) passed, warned or were skipped (${extra}).` : `All ${index} step(s) passed.`)));
  }
  if (warned) console.log(colors.magenta('The bucket setup differs from what the checks expect: see the WARN line above for what to change.'));
}

main().catch((e) => {
  console.error(colors.red(`\nUnexpected error: ${describeError(e)}`));
  process.exit(1);
});
