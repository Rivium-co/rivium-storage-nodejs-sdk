# Rivium Storage - Node.js example

Two things in one folder:

1. **Every feature of `@rivium/storage-node`**, run against the real service, as a readable tour (`npm start`) or a
   self-test with PASS / FAIL per step (`npm run check`).
2. **"Your server" for all the app examples** (Web, Android, iOS, Flutter, React Native): a small HTTP server
   (`npm run server`, port 4000) that mints user tokens, makes signed upload links and prepares the test buckets.
   The server secret stays here; apps only ever get the public key, user tokens and signed links.

It uses the SDK source in `../` (`"@rivium/storage-node": "file:../"`), never the published package, so it also
tests unreleased SDK changes.

## Setup

```bash
# 1. Build the SDK (the example loads ../dist)
cd sdk/nodejs
npm install
npm run build

# 2. Keys
cd Example
cp .env.example .env        # .env is git-ignored
#    RIVIUM_API_KEY=rv_live_...        Console > your project > API keys
#    RIVIUM_SERVER_SECRET=rv_srv_...   Console > your project > API keys > Server secret
npm install

# 3. Test buckets (once; safe to repeat)
npm run setup-buckets
```

Rivium Storage must be turned on for the project (Console > Project settings > Products > Rivium Storage).
After changing SDK code, run `npm run build` in `sdk/nodejs` again: the example runs the compiled `../dist`.

## Run

| Command | What it does |
| --- | --- |
| `npm start` | Tour: every SDK method with a short explanation and its real result or exact error |
| `npm run check` | Self-test: one PASS / FAIL line per step, cleanup, exit code 1 if anything failed |
| `npm run server` | The example server on `http://127.0.0.1:4000` for the app examples |
| `npm run setup-buckets` | Only create the test buckets and their access rules |
| `npm run build` | Type-check and compile to `dist/` |

`npm start` / `npm run check` upload files under `example-node/<run id>/` in the test buckets and create one
temporary bucket `rivium-example-tmp-<run id>`; all of it is deleted at the end (a deleted bucket stays restorable
in the Console for 7 days).

In `npm run check` the first step, **Bucket setup**, creates the test buckets and rules when missing, keeps what exists, and compares both buckets with the setup above (public: public, any type, or at least PNG, PDF, TXT, JSON, CSV and Markdown; private: private, images only, max 1 MB; both: Block executable files on). When they match it passes; otherwise it shows **WARN** (it doesn't fail the run) with each difference and the Console setting to change (`Console › Storage › Buckets › <name> › Settings › …`), and every step that needs that setting (type not allowed, too big, executable blocked, content mismatch, upload progress, file types, the PDF / text uploads) is skipped with the same hint. A field an older Storage API doesn't send (`blockExecutables`) counts as unknown, not wrong. Against an older Storage API that refuses without an error `code`, the error steps accept the 400 with the known message and add "server sent no code (older Storage API)".

## The example server

```
npm run server
```

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /token` | `{ "userId"?: string, "expiresIn"?: seconds }` | `{ token, userId, expiresIn, expiresAt }` |
| `POST /signed-upload` | `{ "contentType": string, "path"?: string, "userId"?: string, "fileName"?: string, "bucket"?: "public" \| "private", "expiresIn"?: seconds }` | `{ url, uploadId, path, expiresAt, maxSize, bucket, method: "PUT", headers }` |
| `POST /setup-test-buckets` | `{}` | `{ public: {...}, private: {...}, warnings: [...] }` |
| `POST /confirm-upload` (extra) | `{ "path": string, "bucket"?: "public" \| "private" }` | the registered file |
| `POST /signed-url` (extra) | `{ "fileId": string, "expiresIn"?: seconds }` | `{ url, expiresIn, fileId }` |
| `GET /health` | - | SDK version, endpoints, bucket names |

- **`/token`** is what the apps' `tokenProvider` calls. It returns a Rivium user token for the user id in the body
  (default `demo-user`), minted with `createUserToken()`. The same token works in every Rivium product.
- **`/signed-upload`**: without `path` the file goes to `users/{userId}/signed/{fileName}`. The app then sends the
  bytes with `PUT url` and the header `Content-Type: <the same contentType>`, and may call `/confirm-upload` to see
  it listed at once (otherwise it is registered on the next read or listing, or within about 20 seconds).
- **`/setup-test-buckets`** creates, when missing:
  - `PUBLIC_BUCKET` (default `rivium-example-public`): public, any type, max 10 MB, executables blocked;
  - `PRIVATE_BUCKET` (default `rivium-example-private-images`): private, JPEG / PNG / GIF / WebP only, max
    `PRIVATE_BUCKET_MAX_SIZE` (default 1 MB), executables blocked;
  - on both, the rule set **Users' own folders**: a signed-in user reads and lists, and writes or deletes only under
    `users/{their user id}/`. Existing buckets are kept; differences are reported as `warnings`.
- Errors come back as `{ error, code, status }` with the HTTP status of the failure.
- POSTs must be sent with `Content-Type: application/json` (otherwise `415`), so a plain cross-site form can't
  call the server. Requests whose `Host` isn't `localhost`, `127.0.0.1`, `[::1]`, `10.0.2.2` or an address in
  `ALLOWED_HOSTS` get `403` (a web page can't reach it through a DNS name it controls). With `DEMO_TOKEN` set, every
  POST must also carry `x-demo-token: <DEMO_TOKEN>` (`401` otherwise).

From an app: Android emulator `http://10.0.2.2:4000`, iOS simulator / web `http://localhost:4000`. For a real phone,
set `HOST=0.0.0.0` in `.env`, add this computer's LAN address to `ALLOWED_HOSTS` (e.g. `ALLOWED_HOSTS=192.168.1.20`)
and use that address in the app. The server then prints a warning: **anyone on that network can get user tokens for
this project — use a TEST project**, and set `DEMO_TOKEN` (the apps send it as the `x-demo-token` header: Web
`VITE_DEMO_TOKEN`; in the other examples add that header to the calls to this server).

> **Demo only, not for production.** It mints a token for whatever user id the request names, so anyone who can
> reach it can act as anyone. That is why it listens on `127.0.0.1` by default. A real server signs its user in
> first (session, your auth provider, Rivium Auth) and calls `createUserToken(thatUser.id)`; it also checks type and
> size before handing out a signed upload link.

### Environment (`.env`)

| Variable | Default | |
| --- | --- | --- |
| `RIVIUM_API_KEY` | - | public key `rv_live_...` (required) |
| `RIVIUM_SERVER_SECRET` | - | server secret `rv_srv_...` (required; server only) |
| `PORT` | `4000` | |
| `HOST` | `127.0.0.1` | `0.0.0.0` to reach it from a phone on your network (TEST project only; prints a warning) |
| `ALLOWED_HOSTS` | (empty) | extra `Host` names / addresses the server answers to, comma-separated, no port |
| `DEMO_TOKEN` | (empty) | when set, POSTs need the header `x-demo-token: <value>` |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://localhost:8081` | browser origins allowed to call the server |
| `PUBLIC_BUCKET` | `rivium-example-public` | |
| `PRIVATE_BUCKET` | `rivium-example-private-images` | |
| `PRIVATE_BUCKET_MAX_SIZE` | `1048576` | bytes |
| `RIVIUM_AUTH_URL` | `https://auth.rivium.co` | for `createUserToken` |

Missing keys stop every command with the exact fix.

## What the tour covers

| Section | SDK |
| --- | --- |
| Setup | `SDK_NAME`, `SDK_VERSION`, constructor (`apiKey` and `serverSecret` required: without the secret it throws `INVALID_ARGUMENT`; `timeout`, `authUrl`) |
| User tokens | `createUserToken(userId)`, `createUserToken(userId, expiresIn)`, `INVALID_ARGUMENT`, wrong secret. Apps that use Rivium Auth need no token endpoint: Storage accepts its tokens as is |
| Buckets | `createBucket(name, options)`, `listBuckets()`, `getBucket(id)`, `getBucketByName(name)`, `deleteBucket(id)` |
| Access rules | `getPolicyTemplates()`, `applyPolicyTemplate()`, `createPolicy()` (every condition field), `listPolicies()`, `deletePolicy()` |
| Upload | Buffer, string, Uint8Array, `contentType`, `metadata`, the `path` option, Unicode name `رسید-۸۸۱۲.pdf`, name with spaces, private bucket |
| Upload progress | `onProgress` on a ~5 MB PNG of noise pixels (a real image/png, so image-only buckets accept it; SKIP when the bucket doesn't allow PNG): a line every 10% in the tour, reaches 100% (checked in `npm run check`) |
| Read | `listFiles()` with `prefix` / `limit` / `cursor` paging, `getFile()`, `getFileByPath()`, `download()` |
| Links | `getUrl()` -> public link, 403 for a private file, `getDownloadUrl()`, `getSignedUrl()`, `createSignedUploadUrl()` + PUT + confirm |
| Image transforms | `getTransformUrl()` with every option (width, height, fit x5, format x4, quality, blur, sharpen, rotate), non-image -> 400 |
| File types | `.json` / `.csv` / `.md` uploaded with no `contentType` into the public bucket: the stored type is the one the file types table lists (SKIP with a Console hint when the bucket doesn't allow the format) |
| Errors | not found, bad id, type not allowed, too big, executable blocked, content mismatch (checked by the error's `code`: `type_not_allowed`, `file_too_large`, `executable_blocked`), timeout |
| Delete | `delete()`, `deleteByPath()`, `deleteMany()` |

`getUrl()`, `getDownloadUrl()` and `getTransformUrl()` build API addresses that need the `x-api-key` header, so
they are fetched with headers here; in a browser they never go straight into an `<img src>`.

## SDK gaps found while writing this (not changed in the SDK)

- No `confirmUpload()` for signed uploads (the example calls `POST /buckets/:bucket/files/confirm-upload` directly).
- `CreateBucketOptions` has no `blockExecutables` / `policiesEnabled` (the example passes them untyped).
- No `updateBucket()`, `getBucketStats()`, `getPolicy()`, `updatePolicy()`, nor transform metadata
  (`GET /transform/:id/metadata`), although the API has them.
- No header-free transform link: a transformed image of a private file needs the headers or a signed link of the original.
