# ADR 0027: The Compiler Lives in Its Own Repository

## Status

✅ Accepted — 2026-10-10, adopted from Le Truc [ADR 0049](https://github.com/zeixcom/le-truc/blob/main/adr/0049-the-compiler-lives-in-its-own-repository.md) (✅ Accepted there — owner session, LT-523, 2026-10-10; accepted here at the REQUIREMENTS.md consolidation). Amends ADR 0012 s1 and ADR 0014 s2 (see Related). Rulings 6 and 7 are recorded as reversed by the owner on adoption day, with reasons; the reversals are events of record, folded into those rulings.

## Context

LT-254 stood `@zeix/le-truc-compiler` up inside the Le Truc monorepo: sources in `server/compiler/` (+ `server/runtimes/`, the runtime seam the compiler imported), assembled for publish from `compiler/`. The owner directed the split (2026-10-10): the compiler moves to a sibling folder and a separate public repository, `zeixcom/le-truc-compiler`. Three pressures: the package is real and wants its own issue tracker and release cadence; template emission (ADR 0021, LT-516) is about to grow a third front end that should be born in its final home; and Le Truc's docs build consuming the published package — not its own sources — is ADR 0014 s2's stated endgame.

## Decision

1. **Fresh history.** The new repository's first commit is the moved tree; Le Truc keeps the complete historical record. A `git filter-repo` subtree split was rejected (interleaved runtime/docs commits; the rewrite path was probed once with `cause-effect-gitreversed` and earned no repeat). The original ADR's merge commit is the cutover marker.

2. **What moves / what stays.** Moving: the compiler sources, the runtime seam modules, the compiler test suite with fixtures, the package scripts (`build:compiler` → `build`, `check:contract`, `check:peer`, `check:package`), the compiler tsconfig, the package assembly directory, the simulation portability check, and the compiler docs (now `ARCHITECTURE.md`, `HOST_PROFILE.md`, `CONTEXT.md`). Staying: the runtime, the docs site and dev server, the generated tree, CEM. Verified on adoption: the move list matches this repository's contents.

3. **The consumer relationship.** Le Truc depends on `@zeix/le-truc-compiler` — a `link:` to the built sibling for development, a pinned pre-release in CI and releases. At cutover Le Truc's `le-truc.config.json` **drops its `runtimeImport` pin**: generated server modules import `@zeix/le-truc-compiler/runtime` like any consumer's, and the goldens re-pin that one import line by design — byte-identity thereafter is measured **through the installed package**, converting the configuration anchor's falsifiability promise into a cross-repo proof.

4. **Defaults re-anchor by mirroring.** The compiler repository carries its fixture corpus at the same relative paths the defaults name (`examples/**`, the generated components directory, the locale list), so every default stays honest in its own tree and ADR 0014 s2 stands verbatim.

5. **`check:peer` reads the registry.** The runtime peer's export list and version come from the published `@zeix/le-truc` (installed devDependency / `npm view`), no longer from this repo's barrel. Lockstep becomes a release convention: the runtime publishes first; compiler CI fails until the floor is satisfiable from the registry.

6. **Test split — reversed at adoption (owner, 2026-10-10).** The original ruling sent the corpus-level integration suite (`check:corpus`, census, goldens) to le-truc; the suite moved with the fixture corpus instead. Reason: the compiler repository and package should be **self-contained** — the Le Truc example corpus exercises nearly every compiler check this repo guarantees, making it the right verification base inside the repository that ships those guarantees, and it must not break when Le Truc's docs change their components. The consumer-side proof remains le-truc's: its build consumes the published package (ruling 3).

7. **Repository posture.** Public from the first push, consistent with `zeixcom/le-truc` and the docs site; MIT `LICENSE` lands in the first commit (the manifest already claims it); typecheck, suite, contract, package, peer and lint are required checks; an NPM-token publish workflow ships disabled until the first pre-release. **The work tracker — reversed at adoption (owner, 2026-10-10):** the original ruling started this repo on plain GitHub issues, "reversible; revisit freely". Reversed the same day: GitHub issues stay fine for collaboration with other humans, but development here is mostly agent-driven, and the low-barrier in-repo task queue (`queue/`, `scripts/queue.ts`, the live board) beats an external tracker for it.

8. **Sequencing and prerequisite.** The source repository's iteration closed first; the split work and this record migrated; template-emission build tasks (LT-516's amendment) file against this repository and never against the monorepo's `server/compiler/`. **Prerequisite:** `@zeix/le-truc@3.0.0-next.1` on the registry — this repository types its peer against the published runtime and its `check:package` installs the peer from the registry; the first pre-release remains the owner's outward act, still outstanding.

## Alternatives Considered

- **Stay in the monorepo** (status quo): one checkout, one queue, tooling done — but the package's public life (issues, releases, contributors) is buried inside the runtime's repo, and the docs build keeps consuming its own sources, so the consumer proof never becomes real.
- **`git filter-repo` history split**: preserves per-module history; rejected in ruling 1.
- **npm-only dev loop**: the most honest consumer relationship, but every cross-repo change needs a registry round-trip before the docs site shows it.
- **Canary channel**: fast and npm-clean; canary drift becomes its own failure mode and litters the registry.
- **Genericized or required config fields**: friendlier defaults or more explicit ones, but the first breaks the configuration anchor and the second is a breaking change to the just-published config surface.

## Consequences

**Good:** Le Truc's build becomes the compiler's first real consumer, proven by goldens; the compiler gets its own cadence and public tracker; template emission is built in its final home; the two packages' version independence (ADR 0012 s8) gains the process boundary it always described.

**Bad / accepted tradeoffs:** cross-cutting changes become a two-repo dance (`link:` mitigates, not removes); lockstep discipline moves from tooling (one checkout) to convention (runtime-first publishing); Le Truc's CI now depends on registry availability; at decision time the source repo carried the compiler twice — once in-tree, once as the staged sibling — until the cutover landed.

## Related

- Requirements: §1.1, §12 — traces finalized at the consolidation
- Authority: Le Truc ADR 0049 (linked above)
- Amends: ADR 0012 s1 (the build home), ADR 0014 s2 (the configuration anchor — stands verbatim by ruling 4)
- Related: ADR 0016 (the seam that moved with it), ADR 0021 (the subsystem born here), ADR 0010 (the authored surface)
