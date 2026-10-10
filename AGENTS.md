# Agent Context — Le Truc Compiler

> Non-obvious facts and easy-to-get-wrong behaviors only. Structure: `ARCHITECTURE.md`. Host decisions and authoring rules: `HOST_PROFILE.md`. Vocabulary: `CONTEXT.md`. API details: JSDoc in `src/`.

## Surprising Behaviors

- **The runtime peer is unpublished, and bun copies it — it does not symlink it.** `@zeix/le-truc@3.0.0-next.1` exists only as the sibling `le-truc` checkout (v3 branch), dev-resolved through `"file:../le-truc"`. After any change in the sibling, run `bun install` here before it is visible. This package's own version stays at `0.1-next.1` until both packages publish in lockstep as `3.0.0-next.1` (owner ruling 2026-10-10).

- **`src/` is runtime-neutral (ADR 0038 s2): no `Bun` global, no `import.meta`, anywhere in shipped source.** The emitted package must run on plain Node ESM. `tests/runtime-neutrality.test.ts` enforces the scan; Bun-only behavior belongs in `tests/runtimes/` behind the runtime abstraction.

- **The package self-references through two resolutions of the same specifier.** In this repo, `@zeix/le-truc-compiler/macros` and `…/runtime` resolve through the root tsconfig `paths` to `src/`; in the published package they resolve through the `exports` map to `dist/`. Tests exercise the first, `check:contract` the second. `tsconfig.compiler.json` deliberately has no `paths` — the build resolves the runtime peer through `node_modules`.

- **TypeScript is pinned by the peer range `>=5.8.0 <6.1.0`, and the ceiling is real.** TS 7 builds the package but its types drop the compiler JS API the tests use (`ts.createCompilerHost` & co.), so `handler-args.test.ts` and kin fail under it. The devDependency stays on 6.x until that gap closes.

- **Emitted test modules land in `server/generated/<mkdtemp>/` (gitignored) and import the runtime through a relative path calibrated to that depth.** Moving files under `tests/` changes the emitted specifiers (`../../../src/runtime`) and breaks module re-evaluation — the `?v=` cache-bust trick depends on the path staying resolvable.

- **The snapshot files under `tests/__snapshots__/` are goldens ported byte-identical from the source repo.** A snapshot "added" by a test run is a masked drift, not a convenience: never regenerate to make a test pass. A mismatch is a finding to diagnose.

- **`bun test` writes its results to stderr.** Capture gate output as `> file 2>&1`; the reverse order `2>&1 > file` silently loses the report.

- **The lint gate rewrites whole trees.** `bun run lint` runs `biome check --write` over `./src ./tests ./scripts`; expect fixes outside your changed paths and treat them as residue.
