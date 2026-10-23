<p align="center">
  <a href="https://rivium.co">
    <img src="https://rivium.co/logo.png" alt="Rivium" width="120" />
  </a>
</p>

<h3 align="center">Rivium Storage Node.js SDK</h3>

<p align="center">
  Server-side file storage and image transformation SDK for Node.js with admin operations, signed URLs, and bucket policies.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rivium/storage-node"><img src="https://img.shields.io/npm/v/@rivium/storage-node.svg" alt="npm" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.0+" />
  <img src="https://img.shields.io/badge/Node.js-16+-339933?logo=node.js&logoColor=white" alt="Node.js 16+" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
</p>

---

## Installation

```bash
npm install @rivium/storage-node
```

## Quick Start

This is the **server** SDK: it always needs your server secret (`rv_srv_...`,
from an environment variable). Without `serverSecret` the constructor throws
`INVALID_ARGUMENT`. Calls made with the secret skip bucket rules. Apps use
`@rivium/storage-web`, `@rivium/storage-react-native` or the mobile SDKs with
a signed user token.

```typescript
import { RiviumStorage } from '@rivium/storage-node';

const storage = new RiviumStorage({
  apiKey: process.env.RIVIUM_API_KEY!,
  serverSecret: process.env.RIVIUM_SERVER_SECRET!, // server only, never in an app
});

// Create bucket
const bucket = await storage.createBucket('user-uploads', {
  visibility: 'private',
  maxFileSize: 10 * 1024 * 1024,
});

// Upload a file
const file = await storage.upload(bucket.id, 'images/photo.jpg', imageBuffer, {
  contentType: 'image/jpeg',
});

// Download
const data = await storage.download(file.id);

// Transform URL
const url = storage.getTransformUrl(file.id, { width: 200, format: 'webp' });

// Generate signed upload URL for client-side uploads
const { url: uploadUrl } = await storage.createSignedUploadUrl(bucket.id, 'uploads/photo.jpg', {
  contentType: 'image/jpeg',
  expiresIn: 300,
});

// Apply policy template
await storage.applyPolicyTemplate(bucket.id, 'publicRead');

// Delete files
await storage.deleteMany(['file-id-1', 'file-id-2']);
```

## Show images

**Public buckets: one link, no headers.** `getPublicUrl` with image options
returns the file's public link with those options, for example
`https://storage.rivium.co/public/<bucketId>/<path>?w=600&f=webp`. It needs no
key, user token or header, so it goes straight into the `<img src>` of the pages, e-mails or API answers your server sends:

```typescript
import { publicImageUrl } from '@rivium/storage-node';

// A 600 px wide WebP for an <img src>: no headers
const url = await storage.getPublicUrl(file.id, { width: 600, format: 'webp' });
html += `<img src="${url}" width="600" alt="">`;

// A public link you stored earlier: the same URL, no request
const thumb = publicImageUrl(savedLink, { width: 200, height: 200, fit: 'cover', format: 'webp' });
```

- **Cached.** The same options always give the same URL (the SDK writes them in
  a fixed order), and the CDN and Rivium Storage keep each size / format of an
  image once: later views come from the cache and don't count as a new
  transform. Replacing the file's content updates the image (copies already in
  a browser or CDN cache can show the old one for up to a day).
- **Use a few fixed sizes.** One image keeps at most 50 variants (different
  option combinations). A new combination beyond that is refused with
  `too_many_variants` (429); the existing ones keep working. Pick a few sizes
  (for example 200, 600 and 1200 wide) instead of the exact size of every view.
- **Plan.** On a plan without image transforms (Free) the image URL answers
  `plan_feature_locked` (403). The plain public link, without options, always
  works.
- **Busy.** When image processing is busy the URL answers `transform_busy`
  (503, with a `Retry-After` header in seconds). Browsers and image components show their error image; when you fetch the URL yourself, retry after `Retry-After` seconds.
- **Already have the public link?** `publicImageUrl` builds the same URL from it
  without a request: store the public link once and make sizes as you need
  them. It checks the options the same way.
- **Private buckets** have no public link (`getPublicUrl` fails with 403).
  Fetch the image with `getTransformUrl` and the `x-api-key` header (unchanged, see below), `download` it, or hand out a signed link (`getSignedUrl`).

## Upload progress

Pass `onProgress` to follow an upload, for example to log or report it:

```typescript
await storage.upload('my-bucket-id', 'videos/clip.mp4', videoBuffer, {
  contentType: 'video/mp4',
  onProgress: ({ bytesSent, totalBytes }) => {
    console.log(`${Math.round((bytesSent / totalBytes) * 100)}%`);
  },
});
```

It is called at most every 50 ms or every 1% of the upload, and always once at
the end with `bytesSent === totalBytes`. `totalBytes` is the size of the whole
request (the file plus the form fields), so it is a little larger than the file.

## File types

When you don't pass `contentType`, the SDK picks it from the path's extension,
using the same list of formats the Console offers in a bucket's allowed types
(`.md` → `text/markdown`, `.csv` → `text/csv`, `.heic` → `image/heic`,
`.wav` → `audio/vnd.wave`, …). An explicit `contentType` always wins. An extension
that isn't in the list is sent as `application/octet-stream`, and Rivium Storage
then goes by the extension and the file's content. `contentTypeForPath(path)`
returns the type the SDK would send.

A format the bucket doesn't allow is refused with the `type_not_allowed` code
(see below): turn it on in the Console under Storage › your bucket › Settings.

## Handling errors

A refused request throws a `RiviumStorageError` with the server's `message`, the HTTP
`statusCode` and a `code` you can switch on:

```typescript
import { RiviumStorageError, StorageErrorCode } from '@rivium/storage-node';

try {
  await storage.upload('my-bucket-id', 'notes/today.md', Buffer.from('# Today'));
} catch (e) {
  if (!(e instanceof RiviumStorageError)) throw e;
  switch (e.code) {
    case StorageErrorCode.TypeNotAllowed:    // 400: the bucket doesn't allow this format
    case StorageErrorCode.FileTooLarge:      // 400: larger than the bucket's size limit
    case StorageErrorCode.ExecutableBlocked: // 400: the bucket blocks executable files
      console.warn(e.message);
      break;
    case StorageErrorCode.PathTaken:         // 409: a file already exists at this path
      break;
    case StorageErrorCode.InvalidPath:       // 400, nothing sent: a '.' / '..' / empty path segment
      break;
    case StorageErrorCode.TokenRequired:     // 401: the project requires a signed-in user
    case StorageErrorCode.TokenInvalid:
    case StorageErrorCode.TokenExpired:
      break;
    default:
      if (e.code === StorageErrorCode.AccessDenied) { /* denied by the bucket's access rules */ }
  }
}
```

The SDK never follows a redirect. Paths, ids and image transform options are checked before anything is
sent: see [Paths, links and image transforms](#paths-links-and-image-transforms).

The server secret is kept in a private field (it never shows up in `console.log(storage)` or in error
reports), the constructor refuses it in a browser, and `authUrl` must be `https://` (`http://` only for localhost).

## What the answers contain

A `StorageFile` has `id`, `bucketId`, `path`, `fileName`, `mimeType`, `size`, `checksum`, `metadata`,
`uploadedBy`, `uploadedAt`, `createdAt` and `updatedAt` (`checksum`, `metadata`, `uploadedBy` and `uploadedAt` are
`null` when empty). A `Bucket` has `id`, `name`, `description`, `visibility`, `allowedMimeTypes` (`null` = every
type), `maxFileSize`, `blockExecutables`, `createdAt` and `updatedAt`. Dates are ISO 8601 strings. `listFiles()`
answers `{ files, nextCursor }`, with `nextCursor` `null` on the last page.

## Paths, links and image transforms

- **Paths.** Pass paths as you write them: each part is percent-encoded for you,
  so spaces, `?`, `#`, `%` and other scripts are fine when you read or delete by
  path. Leading, trailing and repeated `/` are dropped, as the server stores
  paths (`/a//b/` is `a/b`). A `.` or `..` part (also written `%2e`) is refused
  with `invalid_path` before anything is sent. An empty bucket, file id or path
  fails at once with `bucket_required`, `file_id_required` or `path_required`.
- **New files.** An upload path can't contain `?`, `#`, `%`, text-direction
  characters or a `.` / `..` part: the SDK refuses it with `invalid_path` (and
  the server's message) before sending anything.
- **Public link.** `await storage.getPublicUrl(fileId)` returns
  `https://storage.rivium.co/public/<bucketId>/<path>` for a file in a
  **public** bucket. Anyone can open it without a key or token, so it goes
  straight into an `<img src>`, an e-mail or a browser. A file in a private bucket has no public link
  (`403`): use `download`, or a signed link from your server.
- **Public image links.** With image options, `getPublicUrl` returns a
  resized / converted image URL that needs no headers, and `publicImageUrl`
  builds it from a stored public link: see [Show images](#show-images).
- **API addresses.** `getUrl`, `getDownloadUrl` and `getTransformUrl` return
  `/api/v1` addresses. They need the `x-api-key` header (and the user token
  where your rules ask for one), so load them with an HTTP client that sends
  headers, never as a plain image URL.
- **Image transforms.** `format`: `jpeg` (default), `png`, `webp` or `avif`;
  `fit`: `cover`, `contain`, `fill`, `inside` or `outside`; `width` / `height`:
  1 or more (above 4096 sent as 4096); `quality`: 1-100; `blur`: 0-20;
  `sharpen`: 0-10; `rotate`: degrees. `getTransformUrl` throws `invalid_transform` for anything else, before building the URL. Images over 25 MB can't be
  transformed (`source_too_large`); see [Handling transform errors](#handling-transform-errors) for why else a transform can fail.
- **Signed upload links.** `createSignedUploadUrl(bucketId, path, { contentType, expiresIn })`
  gives your app a link to `PUT` one file to, without a key. It lives 5 minutes
  by default and at most 15 minutes (a longer `expiresIn` is cut to 15 minutes);
  the path follows the rules for new files above. The file is registered when
  it is first read or listed, or within about 20 seconds.

```typescript
const link = await storage.getPublicUrl(file.id); // public bucket only
// "https://storage.rivium.co/public/<bucketId>/photos/my%20cat.png"

const thumb = storage.getTransformUrl(file.id, { width: 200, height: 200, fit: 'cover', format: 'webp' });
// fetch with the x-api-key header
```

### Handling transform errors

The SDK builds the transform URL; your app fetches it. When the image can't be
made, the answer is JSON instead of an image, with `statusCode`, `code` and a
`message` you can show to your users. Read `code` to decide what to do:

```typescript
const res = await fetch(thumb, {
  headers: { 'x-api-key': process.env.RIVIUM_API_KEY!, 'x-server-secret': process.env.RIVIUM_SERVER_SECRET! },
});
if (!res.ok) {
  const { code, message } = await res.json().catch(() => ({}));
  switch (code) {
    case StorageErrorCode.NotAnImage: return reply(400, 'Pick an image file.');
    case StorageErrorCode.ImageDamaged: return reply(422, 'Upload it again.');
    default: return reply(res.status, message ?? `HTTP ${res.status}`);
  }
}
```

| Status | `code` | What the message says |
| --- | --- | --- |
| 415 | `image_format_not_supported` | This image format can't be resized: BMP. Supported: JPEG, PNG, WebP, GIF, AVIF, HEIC, TIFF, SVG. |
| 400 | `not_an_image` | This file isn't an image (application/pdf), so it can't be resized. |
| 422 | `image_damaged` | The image is damaged or incomplete (it may not have finished uploading). |
| 413 | `image_too_large` | This image is 12000×9000 (108 MP); images up to 50 MP can be resized. |
| 413 | `source_too_large` | The image is over 25 MB. |
| 400 | `invalid_transform` | An option isn't allowed (the message names it). |
| 503 | `transform_busy` | Image processing is busy. Try again in a moment. (Retry after the `Retry-After` header's seconds.) |
| 429 | `too_many_variants` | Public image URLs: this image already has 50 sizes / formats. Use one of the sizes you already use. |
| 403 | `plan_feature_locked` | Image transforms aren't included in this project's plan. Upgrade to use them. |

## Sign users in (one token for every Rivium product)

One Rivium user token identifies your signed-in user in every Rivium product
(Storage, Sync, Chat, Push, A/B Testing). Your server mints it with the server
secret and hands it to your app; the app SDKs (`@rivium/storage-web`,
`@rivium/storage-react-native`, and the other Rivium SDKs) take it through
their `tokenProvider` option.

```typescript
import { RiviumStorage } from '@rivium/storage-node';

const storage = new RiviumStorage({
  apiKey: process.env.RIVIUM_API_KEY!,
  serverSecret: process.env.RIVIUM_SERVER_SECRET!, // server only
});

// Express example, behind your own session check
app.post('/rivium-token', async (req, res) => {
  const { token, expiresAt } = await storage.createUserToken(req.session.userId);
  // optional lifetime in seconds: createUserToken(userId, 900)
  res.json({ token, expiresAt });
});
```

`createUserToken(userId, expiresIn?)` posts to `https://auth.rivium.co/users/token`
(set `authUrl` to change it) and returns `{ token, userId, expiresIn, expiresAt }`.
Apps that sign users in with **Rivium Auth** need no endpoint: its sign-in
token is the same Rivium user token, and Storage accepts it as is
(`tokenProvider: () => auth.getToken()` in the Web and React Native SDKs).
Both kinds of token work; keep one source of user ids per app.

In the app:

```typescript
const storage = new RiviumStorage({
  apiKey: 'YOUR_API_KEY',
  tokenProvider: async () => {
    const res = await fetch('https://your-server.example/rivium-token', { method: 'POST' });
    return res.ok ? (await res.json()).token : null;
  },
});
```

Server-side calls made with the server secret skip bucket rules, so this SDK
doesn't need a user token itself. App file requests always need one: the app
SDKs wait for a token until a user is signed in.

## Features

- **File Upload & Download** — Upload from Buffer, Uint8Array, or string, with upload progress
- **Bucket Management** — Create, list, get, delete buckets
- **Links** — Public links for public buckets (`getPublicUrl`), plus download and transform addresses
- **Image Transformations** — Resize, crop, format conversion, blur, sharpen, rotate
- **Signed URLs** — Time-limited download links and upload links (at most 15 minutes)
- **Bucket Policies** — Firebase-like access rules with templates (publicRead, private, userFolders, imagesOnly, closed)
- **Server SDK** — Always runs with your server secret (apiKey + serverSecret)
- **Rivium user tokens** — `createUserToken()` mints the one token every Rivium product accepts
- **TypeScript First** — Full type definitions included

## Documentation

For full documentation, visit [rivium.co/docs](https://rivium.co/cloud/rivium-storage/docs/nodejs).
- [Rivium Cloud](https://rivium.co/cloud)
- [Rivium Console](https://console.rivium.co)

## License

MIT License — see [LICENSE](LICENSE) for details.
