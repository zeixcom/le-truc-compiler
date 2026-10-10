# Changelog

## [Unreleased]

### Added

- **`<h1>` and `<section>` now type-check in authored `.tsx`**: `src/frontend/tsx/host-profile.d.ts` admits both intrinsics; the demo board's `queue-board` component tag is declared alongside.
- **`check:demo` type-checks the demo corpus**: `demo/`'s authored `.tsx` sources go through the same host-profile type check `examples/` gets. The errors it surfaced are fixed: the six `harvest()` lane fields share a declared `parseLane` parser, so an unknown lane key falls to `'waiting'`.

### Fixed

- **`check:corpus`, `check:package` and `i18n:sync` run again**: previously all three failed on stale imports and pack paths left by the repository move. Now the gates run green; `check:package` packs the compiler from the repo root and the runtime peer from the sibling `le-truc` checkout.
