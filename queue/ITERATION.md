# Iteration 1 — Repair the gates, straighten the analysis core

Planned 2026-10-10, from the first architecture review pass (deepening
heuristics over the front ends, pipeline, corpus, contract, the `analysis/`
cluster, the emitters and setup extraction; candidates triaged with the
owner). The review's headline: the architecture is healthy at its seams —
the front-end driver, the corpus entry point, the pipeline are the deep
modules the ADRs asked for — while the rot concentrates in three places:
repo-move residue that killed two quality gates, import cycles and a
3,733-line mega-module in `src/analysis/`, and hand-copied rules that must
not drift between passes and emitters. This iteration takes the first two;
the emission and setup deduplication is banded P2 as the presumptive
iteration 2, and the remaining review coverage (css-scope, sim) is P3.

**Next free task ID:** TC-013

**Rulings.**

- 2026-10-10 — The iteration's working view is the live board (`bun run
  queue:serve`), not a generated TODO.md. `queue:build` renders only the
  BACKLOG and DONE markdown views.
- 2026-10-10 — Iteration scope was set on the Architect's recommendation
  (the triage questions went unanswered): repair + analysis tracks in this
  iteration; the emission track (TC-006, TC-007) and the setup dedup
  (TC-008) stay banded P2 for the next iteration; the planHarvests carve
  (TC-009) and the css-scope/sim review (TC-010) are P3.
- 2026-10-10 — Context typing in `analysis/`: no branded or nominalized
  context types. The structural interchange (`PassShared` satisfying
  `EachLoopContext`, `EffectsContext` satisfying both) is load-bearing
  under ADR 0040 s5's typed pass order. The hidden coupling is documented
  instead: `PassShared`'s doc comment names the `badFreeNames` →
  `clientMessageKeys` side-effect contract. (Folded into TC-005.)
- 2026-10-10 — After TC-004, the two remaining analysis back-edges are
  intentional and documented on `effects.ts`: effects→loops (`planEachLoop`
  — nested Mount-Scope loops re-run pass-1 planning, ADR 0046 s2 / LT-424)
  and harvest↔list-harvest (the pass-2/pass-3 planning pair). Every
  cross-module call in them stays inside a function body.
- 2026-10-10 — `ARCHITECTURE.md`'s fact-check fold (repo-move layer,
  factual drifts, nine missing module rows) was applied the same day; ADRs
  are cited by number with a standing pointer to the sibling `le-truc`
  checkout until TC-003 rules where this repo's ADR record lives.
- 2026-10-10 — TC-003 ruled (owner): this repo starts a **fresh ADR record
  at 0001**. Compiler-related ADRs port from the sibling with a
  per-decision review pass; the sibling deletes them after migration;
  `REQUIREMENTS.md` is reworked into a requirements overview with each
  requirement's decisions mapped. New compiler ADRs number from the next
  free number after the ported set. The sibling pointer stands until the
  citation sweep lands; the port plan and mapping table live in
  `queue/TC-003.md`.

**The chain.**

- **Track 1 — Repair the gates.** The repo move left `check:corpus`,
  `check:package` and `i18n:sync` dead or unwired; `check:corpus` is the
  only gate between an emitter bug and a harness signature break, so every
  refactor below needs it back first. In pick order:
  1. TC-001 — Restore the repo-move-broken scripts and wire their bun run entries
  2. TC-002 — Sweep stale repo-move comments and repair check-package's pack paths
- **Track 2 — Straighten the analysis core.** Collapse the import cycles,
  then split the mega-module; byte-identical by goldens throughout. In pick
  order:
  1. TC-004 — Collapse the analysis import cycles into leaf modules
  2. TC-005 — Split effects.ts into its subsystems
