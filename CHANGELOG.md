# Changelog

## 0.2.1

- **Breaking:** `serverSecret` is required: this SDK runs on your server. Apps use the Web, React Native or mobile SDKs. `userId` / `setUserId` are removed.
- **Added:** `createUserToken(userId)` mints a Rivium user token for your app's signed-in user.
- **Added:** Upload progress: `upload(..., { onProgress })` reports `{ bytesSent, totalBytes }`.
- **Added:** `getPublicUrl(fileId, transforms)` returns a file's public link (public buckets only). Pass image transform options to get a resized or converted image link that needs no key, ready for an image view. `publicImageUrl()` builds the same link from a saved public URL without a request.
- **Added:** Errors carry the server's error code and HTTP status (`code` and `statusCode` on `RiviumStorageError`), with constants in `StorageErrorCode`.
- **Added:** Uploads without a content type now get the right type for common formats (`.md`, `.csv`, `.heic`, `.m4a`, `.7z`, ...).
- **Changed:** `StorageFile` and `Bucket` contain only the fields the API returns.
- **Changed:** Paths, ids and image transform options are checked before a request is sent; invalid values fail with `invalid_path` or `invalid_transform`.
- **Changed:** A call that needs the server secret fails with `server_secret_required` (was `SERVER_SECRET_REQUIRED`).
- **Fixed:** File paths with spaces, `#`, `?` or non-Latin characters are encoded correctly.
- **Fixed:** Redirects are no longer followed.

## 0.2.0

### Added
- `createUserToken(userId, expiresIn?)` mints a Rivium user token for one of your users (requires `serverSecret`). Return it to your app: the same token works in Rivium Storage, Sync, Chat, Push and A/B Testing.
- `authUrl` config option (defaults to `https://auth.rivium.co`).

## 0.1.0

- Initial release.
