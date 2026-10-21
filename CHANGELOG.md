# Changelog

## 0.2.0

### Added
- `createUserToken(userId, expiresIn?)` mints a Rivium user token through `POST https://auth.rivium.co/users/token` with the API key and server secret, returning `{ token, userId, expiresIn, expiresAt }`. Requires `serverSecret`. The token works in every Rivium product.
- `authUrl` config option (default `https://auth.rivium.co`).
- Tests (`npm test`, Node's built-in runner, no new dependencies). The old `jest` test script referenced a package that was never installed.

## 0.1.0

- Initial release.
