# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-07-15

### Fixed

- Stopped shipping TypeScript declarations. n8n's own package scanner lints the published files and read `MetaConversionsApi.credentials.d.ts` as a credential file with the wrong extension, which failed the check that verification requires. Nothing consumed the declarations: n8n loads the compiled `.js` entrypoints named in `package.json`. The tarball drops from 29 files to 22.

## [0.1.0] - 2026-07-15

Initial release.

### Added

- **Meta Conversions API** node with a Send Event operation.
- **Meta Conversions API** credential holding the access token and API version, with a credential test that resolves the token owner through the Graph API. Dataset ID is a node parameter rather than a credential field, since it is data rather than auth: one token often covers several datasets, and a node-level value can be an expression.
- Normalization and SHA-256 hashing for `em`, `ph`, `fn`, `ln`, `ct`, `st`, `zp`, `country`, `db`, `ge` and `external_id`, following Meta's customer information parameters reference. Every rule is unit-tested against the examples in Meta's own documentation.
- Absent identifiers are omitted rather than sent as a hash of an empty string, which is a well-formed hash of nobody.
- Already-hashed values are detected and passed through instead of being hashed twice. The check runs before normalization, because a normalizer applied to a digest destroys it.
- Bare `fbclid` values are upgraded to the `fb.1.<timestamp>.<fbclid>` format.
- `X-Forwarded-For` chains are reduced to the client IP, and invalid IPs are dropped.
- Optional value: an empty value omits `custom_data` entirely, a value of `0` is still sent, and a non-numeric value raises rather than booking the conversion at `0`.
- Event name dropdown covering the 17 standard events plus `PageView`, with a Custom Event option.
- Validation before sending, because Meta answers `events_received: 1` to events that will never match anyone: Event Source URL required for website events, event time within Meta's 7 day window, a value required for `Purchase`, and at least one usable identifier per event.
- `test_event_code` is reported in the node output, so a test send is distinguishable from a real one.
- Optional batching, off by default, chunked at Meta's limit of 1000 events per request and grouped by dataset. Meta rejects an entire batch if any single event in it is invalid, so a bad row would otherwise take the good ones with it.
- Limited Data Use, opt out, referrer URL, test event code and per-node API version options.
- Usable as an AI tool.

[Unreleased]: https://github.com/nocode-expert/n8n-nodes-meta-conversions-api/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/nocode-expert/n8n-nodes-meta-conversions-api/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nocode-expert/n8n-nodes-meta-conversions-api/releases/tag/v0.1.0
