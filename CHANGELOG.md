# Changelog

## [Unreleased]

### Fixed

- **`check:corpus`, `check:package` and `i18n:sync` run again**: previously all three failed on stale imports and pack paths left by the repository move. Now the gates run green; `check:package` packs the compiler from the repo root and the runtime peer from the sibling `le-truc` checkout.
