# Done

The compaction ledger. When the Architect prunes consumed tasks after a
changelog pass, rulings with no other home land here under a dated note. A
TC-ID this file mentions satisfies a `needs:` prerequisite, which is how a
compacted task keeps its dependents pickable.

**Compaction policy.** An approved task is compacted in place (`status:
reviewed`) until the iteration's changelog is recorded; then its file is
deleted and its durable rulings carried here.

- [x] TC-001: Restore the repo-move-broken scripts and wire their bun run entries — reviewed ✓
  **Area:** tooling
  **Context:** The repo move left three scripts broken and three cited `bun run` commands unwired, so `ARCHITECTURE.md` § 2 (published package, acceptance run), § 6 (`check:corpus`) and § 7 (consumers) name gates that currently cannot run.

  Broken imports (none of the `../server/*` modules exist after the move):

  - `scripts/check-corpus.ts` — imports `../server/corpus-compile` and `../server/runtimes`; also its line-10 comment cites `server/tests/compiler/client.golden.test.ts` (now `tests/client.golden.test.ts`).
  - `scripts/i18n-sync.ts` — imports `../server/corpus-compile`, `../server/corpus-sources`, `../server/runtimes`.
  - `scripts/check-baseline.ts` — imports `../server/corpus-compile`.

  The ported twins live at `tests/corpus-compile.ts` and `tests/corpus-sources.ts`; the runtime abstraction lives under `tests/runtimes/`. Repoint the imports to the post-move modules — this is mechanical, no redesign. Fix stale header comments in these three script files in the same pass (`build:compiler` → `build`, `compiler/dist` → `dist`, `server/…` test paths).

  Then wire exactly these `package.json` entries (these three are doc-cited; nothing else gets wired — `check-baseline.ts` gets its imports fixed but NO entry, nothing cites it):

  ```json
  "check:corpus": "bun run scripts/check-corpus.ts",
  "check:package": "bun run scripts/check-package.ts",
  "i18n:sync": "bun run scripts/i18n-sync.ts"
  ```

  `scripts/check-package.ts` and `scripts/check-runtime-peer.ts` already exist and work off `dist/`; only their header comments are stale (owned by TC-002, out of scope here).

  **Verification:** each of the three wired commands completes past module resolution against a fresh `bun run build`; `bun run check:queue` stays green; `bun run lint` residue cleaned. If `check-corpus.ts` surfaces real corpus-type errors once it runs, report them in `NOTES.md` — do not fix compiler code in this task.

  **Changed:** Repointed the three moved scripts' imports to `tests/corpus-compile`, `tests/corpus-sources`, `tests/runtimes`, fixed check-corpus's stale `server/tests/…` comment, and wired `check:corpus`, `check:package`, `i18n:sync`; check:corpus and i18n:sync ran green end to end (0 corpus type errors, 162 keys confirmed, no catalog writes), check:package clears module resolution but fails in its own pre-existing body — it packs from the removed `compiler/` dir (TC-002's file; NOTES.md entry filed).

  **Review:** approved 2026-10-10 — diff is exactly the scoped repoints plus the three doc-cited entries (check-baseline correctly left unwired); no stale header patterns remain in the touched scripts and every repointed export exists; all gates green in the worktree (build, check:corpus, i18n:sync, check:queue, lint, clean tree). check:package's pack-step failure re-confirmed against the script source and folded into TC-002's widened scope (NOTES.md entry consumed). No nit fixes needed.

- [x] TC-004: Collapse the analysis import cycles into leaf modules — reviewed ✓
  **Area:** compiler
  **Context:** From the 2026-10-10 architecture review. `src/analysis/` contains three intertwined value-import cycles — effects↔loops, effects↔harvest, harvest↔list-harvest — that work only because every cross-module call sits inside a function body. The cause is almost entirely symbols homed in the wrong pass: `reportServerOnlyNames` (the LTC005 server-only-name check) is a stateless diagnostic utility needed by every pass but lives in pass 4 (`effects.ts`), and `returnsNumber` lives in pass 2 (`harvest.ts`) while pass 1 (`loops.ts`) imports it backwards.

  Three moves, all mechanical:

  - New leaf `src/analysis/server-only-names.ts`: move `reportServerOnlyNames`, its private helper `managedPropRead` and the `SUBMITTABLE_FORM_CONTROL_TAGS` table from `src/analysis/effects.ts`, unchanged. Its only dependencies are `diagnostic.serverOnlyNames` (`../diagnostics`), `renderOnlyBindings` (`./naming`) and IR types — verify no effects.ts module state is read. Keep the `Pick<…>` context-parameter shape as is.
  - New leaf `src/analysis/thunk-types.ts`: move `returnsNumber` and its private dependencies (`NUMBER_PARSERS`, `hasNumberMarker`) from `src/analysis/harvest.ts`, unchanged.
  - Delete the re-export hop: `src/analysis/list-harvest.ts` re-exports `harvestsPerField` (it imports it from `../key-alias`) solely so `harvest.ts` can import it through list-harvest. Point `harvest.ts` at `../key-alias` directly and drop the re-export.

  Update the importers (`plan.ts`, `harvest.ts`, `loops.ts`, `list-harvest.ts`, `effects.ts`). Then extend `effects.ts`'s module doc: the two remaining back-edges are intentional — effects→loops (`planEachLoop`: nested Mount-Scope loops re-run pass-1 planning, ADR 0046 s2 / LT-424) and harvest↔list-harvest (the pass-2/pass-3 planning pair) — and every cross-call must stay inside a function body.

  No behavior change of any kind. ARCHITECTURE.md § 3's dependency-shape paragraph is updated in review, not in this task.

  **Verification:** `bun run test`, `bun run typecheck`, `bun run lint` green; zero snapshot/golden changes (`git status` clean under `tests/__snapshots__/` — a changed snapshot is a masked drift, never regenerated); `tests/diagnostics.test.ts` untouched (no message changes).

  **Changed:** collapsed the three `src/analysis/` value-import cycles — the LTC005 check (`reportServerOnlyNames`, `managedPropRead`, `SUBMITTABLE_FORM_CONTROL_TAGS`) and the `returnsNumber` predicate (with `NUMBER_PARSERS`, `hasNumberMarker`) moved unchanged into the new leaves `server-only-names.ts` and `thunk-types.ts`, and `harvest.ts` now imports `harvestsPerField` from `../key-alias` directly, deleting the `list-harvest.ts` re-export hop; `effects.ts`'s module doc records the two intentional back-edges (effects→loops for `planEachLoop`, harvest↔list-harvest) and the function-body rule. Pure moves, no behavior change — ARCHITECTURE.md § 3's dependency-shape paragraph stays for the review pass, per the entry.

  **Review:** approved 2026-10-10 — verified move-for-move against the entry: no imports of the moved symbols remain from the old homes, no test file touched (comment mentions only), zero snapshot changes, and the full gate set green in the worktree (build, 2896 tests / 0 fail, typecheck, lint, clean tree). The leaf's named `ServerOnlyNamesContext` preserves the former `Pick<EffectsContext, …>` four-field shape structurally — the right way to keep the parameter contract without the leaf referencing pass 4, and it honors the no-branding context-typing ruling. ARCHITECTURE.md § 3 updated in this review: module rows for both leaves, dependency-shape paragraph rewritten to the two documented back-edges. No nit fixes needed.
