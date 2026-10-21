# Changelog

## 0.2.0

### Added
- `createUserToken(userId, expiresIn?)` mints a Rivium user token for one of your users (requires `serverSecret`). Return it to your app: the same token works in Rivium Storage, Sync, Chat, Push and A/B Testing.
- `authUrl` config option (defaults to `https://auth.rivium.co`).

## 0.1.0

- Initial release.
