# Changelog

## Unreleased

- Every request to Rivium Storage (and the `createUserToken` call to Rivium
  Auth) now names the SDK in an `X-Rivium-SDK: node/<version>` header (only
  the public SDK name and version), like the other Rivium SDKs. New exports
  `SDK_NAME` and `SDK_VERSION` (kept equal to the package.json version; a test
  checks it).

## 0.2.0

### Added
- `createUserToken(userId, expiresIn?)` mints a Rivium user token for one of your users (requires `serverSecret`). Return it to your app: the same token works in Rivium Storage, Sync, Chat, Push and A/B Testing.
- `authUrl` config option (defaults to `https://auth.rivium.co`).

## 0.1.0

- Initial release.
