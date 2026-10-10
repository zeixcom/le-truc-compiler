# Agent Context — Le Truc Compiler

> Non-obvious facts and easy-to-get-wrong behaviors only. Structure: `ARCHITECTURE.md`. Host decisions and authoring rules: `HOST_PROFILE.md`. Vocabulary: `CONTEXT.md`. API details: JSDoc in `src/`.

## Surprising Behaviors

- **The queue's iteration view is a live Le Truc app, not a markdown file (owner ruling 2026-10-10).** `bun run queue:serve` renders the kanban from `queue/*.md` through the compiler's own output and pushes SSE snapshots on every store write. The static shell lives in `demo/` (a corpus SEPARATE from `examples/` — examples is the test corpus behind golden baselines; internal tooling stays out of it), built by `bun run build:demo` into `server/generated/demo/`. Changing board components means rebuild + server restart, by design. `queue:build` still renders the `BACKLOG.md`/`DONE.md` markdown views; there is no `TODO.md`.

- **All queue semantics live in `scripts/lib/queue-store.ts` — one library, three consumers.** The CLI pick, `check:queue`, and the board's lanes all call the same readiness and lane functions, so they can never disagree. `closed` (moot/won't-do) and `parked` (backlog-only, not iteration-eligible) are contract statuses; `closed` satisfies prerequisites. Store writes are atomic (temp + rename), and the board's watcher debounces at 150ms.

- **The runtime peer is unpublished, and bun copies it — it does not symlink it.** `@zeix/le-truc@3.0.0-next.1` exists only as the sibling `le-truc` checkout (v3 branch), dev-resolved through `"file:../le-truc"`. After any change in the sibling, run `bun install` here before it is visible. This package's version is set to `3.0.0-next.1` in lockstep with the runtime (owner ruling 2026-10-10); neither is published yet — the first pre-release remains the owner's outward act (ADR 0027 ruling 8).

- **`src/` is runtime-neutral (ADR 0038 s2): no `Bun` global, no `import.meta`, anywhere in shipped source.** The emitted package must run on plain Node ESM. `tests/runtime-neutrality.test.ts` enforces the scan; Bun-only behavior belongs in `tests/runtimes/` behind the runtime abstraction.

- **The package self-references through two resolutions of the same specifier.** In this repo, `@zeix/le-truc-compiler/macros` and `…/runtime` resolve through the root tsconfig `paths` to `src/`; in the published package they resolve through the `exports` map to `dist/`. Tests exercise the first, `check:contract` the second. `tsconfig.compiler.json` deliberately has no `paths` — the build resolves the runtime peer through `node_modules`.

- **TypeScript is pinned by the peer range `>=5.8.0 <6.1.0`, and the ceiling is real.** TS 7 builds the package but its types drop the compiler JS API the tests use (`ts.createCompilerHost` & co.), so `handler-args.test.ts` and kin fail under it. The devDependency stays on 6.x until that gap closes.

- **Emitted test modules land in `server/generated/<mkdtemp>/` (gitignored) and import the runtime through a relative path calibrated to that depth.** Moving files under `tests/` changes the emitted specifiers (`../../../src/runtime`) and breaks module re-evaluation — the `?v=` cache-bust trick depends on the path staying resolvable.

- **The snapshot files under `tests/__snapshots__/` are goldens ported byte-identical from the source repo.** A snapshot "added" by a test run is a masked drift, not a convenience: never regenerate to make a test pass. A mismatch is a finding to diagnose.

- **`bun test` writes its results to stderr.** Capture gate output as `> file 2>&1`; the reverse order `2>&1 > file` silently loses the report.

- **The lint gate rewrites whole trees.** `bun run lint` runs `biome check --write` over `./src ./tests ./scripts`; expect fixes outside your changed paths and treat them as residue.
