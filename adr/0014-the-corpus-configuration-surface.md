# ADR 0014: The Corpus Configuration Surface — `le-truc.config.json`

## Status

✅ Accepted — 2026-10-10, adopted from Le Truc [ADR 0036](https://github.com/zeixcom/le-truc/blob/main/adr/0036-corpus-configuration-surface.md) (✅ Accepted there; accepted here at the REQUIREMENTS.md consolidation). Amended there 2026-10-10 (LT-480, D-32): the `locales` field; discovery moved into the compiler package; `registry.json` narrowed to a public projection.

## Context

The compiler compiled the Le Truc repository. Its source scan was a literal `examples/**` glob and its output root a literal generated directory. Less visibly, its emitted module specifiers encoded how deep that output root sat: `'../../../'` appeared as a constant in two emitter modules, and the render-harness specifier was hard-coded in the pipeline. ADR 0012 s1 commits the compiler to shipping as `@zeix/le-truc-compiler`, and the dependency-weight constraint makes the installing developer a persona. A package whose scan and emit are shaped like one repo's layout cannot serve one. The ratio test ([COMPILER_REFLECTION.md](https://github.com/zeixcom/le-truc/blob/6d0544a6/COMPILER_REFLECTION.md) §1, §7 — stays in Le Truc) stays unanswered until something outside the source corpus compiles through it.

The config surface is a shape problem; the package is a distribution one, and the second does not inform the first. So where the configuration lives is decided here, not behind the packaging task.

## Decision

### 1. A project-root `le-truc.config.json`, discovered upward

An installing project places a `le-truc.config.json` at its root. The runner searches upward from the working directory. **The directory holding the file is the project root**: every glob is scanned with it as cwd, and every relative path field resolves against it.

The file is JSON rather than an executable `.ts` config module, deliberately: no import, no transpile, no runtime-specific loader. The file-IO neutrality work therefore inherits nothing from this decision.

Every field is optional. The field table and worked example are documented for an installing reader in `ARCHITECTURE.md`'s configuration section, the surface's reference. This ADR records only what is architectural about it.

### 2. The source corpus's paths are the defaults, so the source repo is a consumer

Every default is the source corpus's own path. `sources` defaults to **both** authored extensions (`examples/**/*.tsrx` and `examples/**/*.tsx`, per ADR 0010 s6), and `outDir` to the generated components directory. The first non-path field, `cssTargets` (ADR 0011 s7), defaults to a fixed version set pinned at 3.0 — a build the same checkout compiles twice emits byte-identical CSS, whatever the platform shipped since. The second, `locales` (amended 2026-10-10, LT-480), names the locales the corpus builds for, the first the default page locale — the list the generated `i18n` module enumerates (`I18N_LOCALES`). It needed a configuration home when the corpus pass moved into the compiler package (D-32): the site config that owned the list is repo-side and off-limits inside the package. Its default is the source corpus's site locales, like every default, and deliberately not derived from the catalogs on disk — the catalogs record every locale a translator has ever filed, while the site builds a chosen subset.

In the monorepo era the source repo carried one config field (`runtimeImport`, pinned to the repo-relative harness path, LT-254); the cutover dropped it (ADR 0027), and **this repository carries no config file: it runs on the defaults** (owner ruling 2026-10-10, zero-config). The main corpus build emits the published `./runtime` specifier; in-tree harness overrides live per caller in code (`tests/helpers/generated-corpus.ts`, `scripts/build-demo.ts` pin the repo-relative `'../../../src/runtime'`), keeping the in-tree harness in those generated modules.

This is the load-bearing half. Defaults that reproduce the source corpus make the generalization *falsifiable*: the corpus's own output must stay byte-identical through the configured path. Two consumer shapes exercise the mechanism from the first commit, rather than one consumer that does not exist yet.

### 3. The output root's depth is derived, and must sit inside the project root

Every generated module lands flat in the output root, whatever the authored source's nesting. An author's relative import is therefore rewritten as "`../` back to the project root, then a root-relative path". That prefix is `../` once per path segment of the configured `outDir` — **derived, never assumed**. Deriving it is what makes the output root configurable; the glob was the easy half.

An `outDir` **outside** the project root (or equal to it) is therefore refused: the scheme cannot address a directory the root does not contain. This is a **configuration** error, thrown at startup — **channel: none** under ADR 0007. It is read before any component is parsed, so there is no source span and no author-fixable component mistake for a Surfacing Tier to grade. No `LTC` code is owed, and none should be minted for config validation. As a corollary, such messages are untiered and unreviewed by the diagnostic machinery, so their text carries the whole user experience on its own.

### 4. The corpus, not the repo, is the registry's scope

`registry.json` is a **project's** corpus index. Its `source` paths are relative to the configured project root. The duplicate-tag rule (LTC048, `src/diagnostics.ts`) is corpus-scoped: two same-surface files, or two folders, declaring the same tag fail the compile naming both (folder-local variant sets excepted, ADR 0017), because the tag is the registry's key. Since LT-480 (D-32) the file carries the **public projection** of the entry only — that projection is its schema; the compile's fuller record serializes to the `registry.internal.json` sidecar beside it, for the repo's own build passes.

### 5. Configuration is pure; discovery is IO

Config resolution and path math live in `src/corpus-config.ts` and touch no disk and no runtime-specific API. Config reading and globbing moved into the package at LT-480 (D-32): `src/corpus-scan.ts` discovers sources over `src/fs.ts`, the package's own file-system seam — the ONE module in the package that touches a disk, through portable `node:` built-ins only (ADR 0016 s2, as amended). This repo's own facts (`REPO_ROOT`, `REPO_CONFIG`) stay in `tests/corpus-sources.ts`, repo-side. The emitter-facing subset is a third leaf, `src/emit-paths.ts`, so the emitters depend on two path facts rather than on config resolution.

The configuration reaches the emitters as one trailing optional argument threaded through both front ends, defaulting to the source corpus's layout. It is not module-scoped mutable state: that would put a hidden global under a compiler whose soundness claim is that it is a pure function of its inputs.

## Alternatives Considered

- **Wait for the packaging task to decide where the config lives**: the packaging task does not inform the file format or the discovery rule, and the repo-shaped scan blocks the ratio test in the meantime.
- **An executable `le-truc.config.ts`**: more expressive (computed globs, conditional output roots), but it needs a loader — exactly the runtime-specific coupling the runtime-neutrality work exists to remove — and nothing in the surface needs computation.
- **Defaults that are neutral rather than the source corpus's**: would force a config file into this repo. The build would then be a configured special case instead of the mechanism's first consumer, and byte-identity would stop being the check that proves the generalization.
- **Module-scoped active configuration, set once per run**: avoids threading an argument through two front ends, but it is hidden global state under a pure compiler, and it makes two differently-configured compiles in one process impossible — which the test suite already does.
- **Keep the emitted depth prefix constant and require consumers to match the layout**: cheapest, but "your output directory must be exactly three levels deep" is not a configurable output root, it is a rename.

## Consequences

**Good:**

- The compiler compiles a project's components from a project's configuration. A build is one consumer of the mechanism rather than the mechanism itself.
- Byte-identity of the corpus's output is a standing, falsifiable check on the generalization — not a claim.
- The single configured glob list is the one place to widen: the corpus build, `check:corpus` and the build effect can no longer glob different extension sets.
- The pure/IO split gives the runtime-neutrality work one seam for the corpus scan instead of four call sites, and keeps IO out of the compiler.
- An outside-the-repo compile is a runnable check, and it surfaces a class of defect an in-repo check cannot see. For example, an `import.meta.dir`-anchored catalog path made a consumer's build census this repo's translation keys as their orphans.

**Bad / accepted tradeoffs:**

- **The config file is public API before publication.** Unknown keys and mistyped fields are rejected at startup rather than defaulted, but under sub-design 3's untiered channel the message text is the entire remedy.
- The upward config search stops at the project boundary (the nearest `package.json` or `.git`, LT-273) — an earlier draft shipped without one, and a stray config file above a checkout could capture that checkout's build.
- Configuration flows through both front ends' signatures, adding a parameter to the per-component entry points that most callers never pass.
- Generalization is not complete: the watch path and `scripts/i18n-sync.ts` still hard-code this repository's layout. This is deliberate — neither has an external consumer before pioneer 1 — but the surface is configured, not the whole build.

## Related

- Requirements: §12 (the config file and its type are published API), §1.1 — traces finalized at the consolidation
- Architecture: `ARCHITECTURE.md` (the configuration section is the field table's reference)
- Authority: Le Truc ADR 0036 (linked above)
- Related: ADR 0012 s1–s2 (the package this configures), ADR 0010 s6 (why the default glob is dual-extension), ADR 0007 s1 (why a config error is untiered), ADR 0009 s5 (the i18n surface), ADR 0005 s9 (the registry the CEM build reads)
