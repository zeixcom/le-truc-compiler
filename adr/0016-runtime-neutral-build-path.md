# ADR 0016: Runtime-Neutral Build Path — the `RuntimeIO` Seam, One Glob Grammar, and the Portability Gate

## Status

✅ Accepted — 2026-10-10, adopted from Le Truc [ADR 0038](https://github.com/zeixcom/le-truc/blob/main/adr/0038-runtime-neutral-build-path.md) (✅ Accepted there; amended there 2026-10-10, LT-480/D-32 — the amendment is folded into sub-design 2; accepted here at the REQUIREMENTS.md consolidation).

## Context

The compiler's build path executes JavaScript. The corpus compile imports and runs the emitted server modules to fold (ADR 0008), reads the configured sources, writes the output tree, and spawns typechecking. In the source repository every one of those steps reached for Bun's globals. That is fine for repo tooling, but ADR 0012 s1 commits the compiler to shipping as `@zeix/le-truc-compiler`, and the dependency-weight constraint makes the installing developer a persona. Once the package exists, its build path's runtime requirement is consumer-visible. "Requires Bun" would prescribe a toolchain to every consumer, when the honest floor for executing a JS package's build is already *a* JS runtime.

Two standing constraints already pulled the same direction. The compiler was already pure computation over strings, with config resolution split from discovery (ADR 0014 s5). The corpus config is JSON rather than an executable module precisely so no runtime-specific loader couples to it (ADR 0014 s1). The file-IO, glob and spawn layer was the last Bun-coupled surface. The decision precedes the package's first publication, because the contract below is consumer-visible the moment the package exists.

## Decision

1. **The build path requires a JS runtime, not Bun specifically.** All file IO, globbing and process spawning on the in-repo build tooling goes through one interface, `RuntimeIO` (`tests/runtimes/` — repo-side, never shipped): `readTextFile`, `fileExists`, `writeTextFile`, `copyFile`, `scanGlob`, `matchGlob`, `spawn`. Two implementations exist side by side: Bun natives, and `node:fs`/`node:child_process` (which Bun and Deno both implement). Each is loadable under any runtime. Runtime-specific APIs are touched only inside method bodies, never at module scope, so both import statically and a single `typeof Bun` check selects at load. The interface fixes the contract the checks rely on: glob results are sorted relative paths with forward slashes, scan and match share one rule set, and `spawn` never throws on a non-zero exit. Its consumers here are the check and build scripts (`check:corpus`, `i18n:sync`) and the corpus-compile orchestration in `tests/`. The demo and board server stays Bun-only — repo tooling, never published — and the emitted files were already runtime-neutral standard output.

2. **The shipped package owns one file-system seam and is otherwise pure.** `src/` — both front ends and the shared machinery — touches no `Bun` global, no `import.meta`-anchored path and no IO module: it is pure computation over strings, checked at the source level by `tests/runtime-neutrality.test.ts` (LT-366). Portable path math (`node:path`) is allowed. Since the corpus pass moved into the package as its published entry point (`compileCorpus`, LT-480/D-32), a published entry point must discover sources and write artifacts itself — so the package owns ONE file-system seam, `src/fs.ts`: the single module under `src/` that touches a disk, importing only portable `node:` built-ins (`node:fs`, `node:fs/promises`; plus `node:crypto` in `i18n-catalog.ts` for catalog hashing), implemented by Bun, Node and Deno alike. The neutrality gate carves the seam out BY MODULE — a `node:` import anywhere else under `src/` fails — so widening the seam's list is a review-visible decision. The shared glob translator lives in `fs.ts`, with the `RuntimeIO` glob re-exporting it: sub-design 3's one grammar is one implementation too. Third-party dependencies only have to run under a JS runtime, which the gate in sub-design 4 proves end to end. Whether anything loads in a browser is the playground's question ([Le Truc ADR 0025](https://github.com/zeixcom/le-truc/blob/main/adr/0025-client-side-component-playground.md); stays in Le Truc), not the compiler's.

3. **Glob pattern semantics are one grammar, decided once.** One shared translator serves both implementations. The supported grammar is what the corpus configuration surface (ADR 0014) needs: `*` (within a segment), `?`, `**/` (zero or more directories), a trailing `**`, and literal text. Braces and character classes match literally. Semantics are pinned against the Bun scanner the walk replaces: wildcards never cross `/` and never match a leading dot; `**/` matches zero directories; a hidden file is addressable only by a pattern segment starting with one. The ruling is "one grammar", not "one implementation".

   Three known edges exist where the categorical no-divergence claim overreaches today. Each is unreachable with any realistic glob, and each needs its own ruling:
   - The trailing-`**` matcher compiles to an unguarded wildcard admitting dot-prefixed paths no scanner yields.
   - Explicit-dot pattern segments diverge per runtime: a dotfile is matched by the Bun scanner and skipped by the shared walk. Until ruled, dot-prefixed patterns are outside the grammar; ruling them out would be Prevented at config resolution (ADR 0007 s1).
   - Node's `fileExists` answers true for directories, where the contract says regular file.

4. **The standing gate: the cross-runtime corpus check.** `scripts/corpus-portability-check.ts` (LT-267) bundles a minimal entry built from the PUBLISHED corpus entry point — the same `compileCorpus(config)` an installing project calls — and runs the *same* bundle under every runtime found on PATH (Bun, Node, Deno). Each compiles this repo's corpus into its own scratch tree. All emitted bytes must be identical, and any disagreement fails the check. The bundle exists for module resolution only: the source graph's extensionless imports are a bundler-facing fact the packaging step will normalize. What the gate proves is that the build behaves identically once the graph is resolvable — a leak would sit in the glob, the file IO, or the compiler itself. The `bun run` entry is not yet wired; the script is the gate of record.

## Alternatives Considered

- **Stay Bun-only; the published package requires Bun**: the cheapest state, but it prescribes the consumer's toolchain as a condition of compiling at all. The seam-plus-gate cost is one script over a claim a published package cannot avoid making.
- **Per-runtime glob semantics** (each implementation keeps its native glob): a consumer's configured globs could match one file set under Bun and another under Node. The corpus would silently differ per runtime, and no test could catch it for patterns outside this repo's own.
- **Consumer-registered runtime adapters**: premature. The seam has one consumer and there is no demand for custom IO; the `RuntimeIO` type is already the extension point if one is ever needed.
- **Hold the compiler to browser loadability, dependencies included**: a requirement only the proposed playground has. It made every parser or library swap answer to a bundle the build never produces, and a CommonJS dependency's load-time `node:` requires fail it even when the parse path never touches them. The playground owns that gate if it is accepted.
- **Fold the file-system seam out of the package**: "IO beside the compiler" was the original rule, and the published entry point broke it — a package boundary cannot depend on repo-side machinery. *(Superseded 2026-10-10, LT-480/D-32 — see sub-design 2's amendment.)*

## Consequences

**Good:**

- The package's install story states a floor every JS project already meets instead of prescribing a toolchain. The pioneer builds (ADR 0012 s6) can run the compiler under whatever the host project uses.
- Runtime-specific behavior has exactly one home per seam: `src/fs.ts` for the shipped package, `tests/runtimes/` for in-repo tooling. Neutrality is a standing one-command check rather than a claim.
- The corpus configuration surface gets glob semantics that cannot drift per runtime; a consumer's configured globs mean one thing everywhere.

**Bad / accepted tradeoffs:**

- Two glob code paths must be kept honest forever. The parity tests and the gate carry that weight, and the recorded edges show the categorical claims can silently overreach.
- `node:` API parity on Bun/Deno is implemented by others, and the seam papers over genuine behavioral differences by hand. The gate covers the build path's emitted bytes, not every method's every input.
- Every new `RuntimeIO` capability costs two implementations and a gate row, not one. The neutrality claim is only as current as the last gate run.

## Related

- Requirements: §2 (the engine constraint), §12 (dependency weight) — traces finalized at the consolidation
- Architecture: `ARCHITECTURE.md` §8 (cross-cutting invariants — runtime neutrality is CI-pinned)
- Authority: Le Truc ADR 0038 (linked above)
- Related: ADR 0012 s1 (the publication that makes this contract consumer-visible), ADR 0013 (the sibling build-path seam), ADR 0014 s1/s5 (the pure/IO split this seam completes), ADR 0007 s1 (the Surfacing Tier for the config-resolution ruling)
