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
  <a href="https://www.npmjs.com/package/@rivium-storage/node"><img src="https://img.shields.io/npm/v/@rivium-storage/node.svg" alt="npm" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.0+" />
  <img src="https://img.shields.io/badge/Node.js-16+-339933?logo=node.js&logoColor=white" alt="Node.js 16+" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
</p>

---

## Installation

```bash
npm install @rivium-storage/node
```

## Quick Start

### Client Mode (apiKey only)

```typescript
import { RiviumStorage } from '@rivium-storage/node';

const storage = new RiviumStorage({
  apiKey: 'rv_live_xxx',
  userId: 'user-123', // optional, for policy enforcement
});

// Upload a file
const file = await storage.upload('my-bucket-id', 'images/photo.jpg', imageBuffer, {
  contentType: 'image/jpeg',
});

// Download
const data = await storage.download(file.id);

// Transform URL
const url = storage.getTransformUrl(file.id, { width: 200, format: 'webp' });
```

### Server Mode (apiKey + serverSecret)

```typescript
const admin = new RiviumStorage({
  apiKey: 'rv_live_xxx',
  serverSecret: 'rv_srv_xxx', // bypasses all bucket policies
});

// Create bucket
const bucket = await admin.createBucket('user-uploads', {
  visibility: 'private',
  maxFileSize: 10 * 1024 * 1024,
});

// Generate signed upload URL for client-side uploads
const { url } = await admin.createSignedUploadUrl(bucket.id, 'uploads/photo.jpg', {
  contentType: 'image/jpeg',
  expiresIn: 300,
});

// Apply policy template
await admin.applyPolicyTemplate(bucket.id, 'publicRead');

// Delete files (requires serverSecret)
await admin.deleteMany(['file-id-1', 'file-id-2']);
```

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
It needs `serverSecret`. Using **Rivium Auth**? Its sign-in token is the same
token, so your app can pass it as is.

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
doesn't need a user token itself. `userId` here is only a legacy hint sent as
`x-user-id`; the server can't verify it.

## Features

- **File Upload & Download** — Upload from Buffer, Uint8Array, or string
- **Bucket Management** — Create, list, get, delete buckets
- **URL Generation** — Public, download, and transform URLs
- **Image Transformations** — Resize, crop, format conversion, blur, sharpen, rotate
- **Signed URLs** — Secure time-limited upload and download URLs
- **Bucket Policies** — Firebase-like access rules with templates (publicRead, private, userFolders, imagesOnly, closed)
- **Dual Mode** — Client mode (apiKey) and server mode (apiKey + serverSecret)
- **Rivium user tokens** — `createUserToken()` mints the one token every Rivium product accepts
- **Policy Enforcement** — User-scoped access control via `userId`
- **TypeScript First** — Full type definitions included

## Documentation

For full documentation, visit [rivium.co/docs](https://rivium.co/cloud/rivium-storage/docs/sdks-nodejs).
- [Rivium Cloud](https://rivium.co/cloud)
- [Rivium Console](https://console.rivium.co)

## License

MIT License — see [LICENSE](LICENSE) for details.
