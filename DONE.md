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

- [x] TC-002: Sweep stale repo-move comments and repair check-package's pack paths — reviewed ✓
  **Area:** tooling
  **Gates:** check:package, typecheck
  **Context:** Two residues of the repo move in one pass: the comment-only drift under `src/` and `tests/`, and the pack-path breakage TC-001's NOTES.md entry found in `scripts/check-package.ts` (Architect fold 2026-10-10 — the entry is re-homed here).

  **Part 1 — repair `scripts/check-package.ts`'s pack step.** Post-move the script packs both tarballs from the wrong roots (`scripts/check-package.ts:262` packs the "runtime" tarball in `ROOT`, which now IS the compiler package; `:267` packs the "compiler" tarball in `join(ROOT, 'compiler')`, a directory the move removed — ENOENT once npm is spawnable). The runtime peer exists only as the sibling `../le-truc` checkout (v3 branch), dev-resolved through `"file:../le-truc"`. Repair: the compiler tarball packs in `ROOT`; the runtime tarball packs in the sibling checkout at `join(ROOT, '..', 'le-truc')`, with a clear error when the sibling is absent. Nothing else in the script's body changes.

  The gate's verification environment has two needs the worktree must meet: `npm` on PATH (the pack step spawns it — TC-001's review run died at `posix_spawn 'npm'` before reaching the pack-path bug), and registry network for step 2's scratch install (`npm install` of the two tarballs plus `typescript`).

  **Part 2 — comment-only sweep.** In files `ARCHITECTURE.md` echoes — the doc was corrected on 2026-10-10; these code comments still tell the old story. No behavior may change: comments and JSDoc only.

  - `src/core.ts:5` and the `src/frontend/tsrx/compiler.ts` header — say the `@tsrx/core` pin is "0.1.63"; it is 0.2.3 (`package.json`; the TSRX020 entry in `src/diagnostics.ts` records the LT-210 bump).
  - `src/frontend/tsx/compiler-tsx.ts:10` — says the parse goes through `ts.createSourceFile`, `ScriptKind.TSX`; parsing is `@typescript-eslint/typescript-estree`'s own `parse()` in `to-estree.ts`, and no module under `src/` imports the `typescript` package.
  - `src/contract.ts:73`, `src/core-shim.d.ts:6`, `src/fold-inputs.ts:75`, `tests/contract.test.ts:5`, the `tests/globals.test.ts` header, and the `src/frontend/tsrx/index.ts` + `src/frontend/tsx/index.ts` headers — cite `server/compiler/…` paths; the compiler is flat under `src/`.
  - `scripts/check-package.ts:9` and `scripts/check-runtime-peer.ts:12` headers — `build:compiler` → `build`, `compiler/package.json` → `package.json` (ownership settled here by the fold; TC-001's entry and this one previously contradicted each other).

  **Verification:** `bun run check:package` green end to end (build, both packs, scratch install, compile, render); `bun run typecheck` clean; `bun test tests/contract.test.ts tests/globals.test.ts` green; Part 2's `git diff` shows comment lines only; `bun run lint` residue cleaned.

  **Changed:** `scripts/check-package.ts`'s pack step repaired for the post-move layout — the compiler tarball packs from the repo root, the runtime peer from the sibling `le-truc` checkout, located by an upward walk from `ROOT` keyed on the manifest name `@zeix/le-truc` (the entry's literal `join(ROOT, '..', 'le-truc')` is main-checkout-shaped and cannot resolve from a worktree gate run, where ROOT is `.worktrees/TC-NNN`), with a thrown `package check failed:` error when no sibling checkout exists; plus the entry's comment-only sweep — pin 0.1.63 → 0.2.3 in `src/core.ts`, the `src/frontend/tsrx/compiler.ts` header and `src/core-shim.d.ts` (listed under the path bullet, but its sentence carries the version too), the `.tsx` parse story corrected to `@typescript-eslint/typescript-estree`'s own `parse()` with no `typescript` import anywhere under `src/` (`src/frontend/tsx/compiler-tsx.ts`), and `server/compiler/…` citations flattened to `src/…` (`src/contract.ts`, `src/fold-inputs.ts`, `tests/contract.test.ts`, `tests/globals.test.ts`, both `frontend/*/index.ts` headers, both script headers — `check-runtime-peer.ts`'s "in lockstep from one checkout" shortened to "in lockstep": two checkouts since the move).

  **Review:** approved 2026-10-10 — all gates green in the worktree: `check:package` end to end (both tarballs packed from their true roots, scratch install, Node compile, Bun render — the gate TC-001's NOTES entry flagged as broken is fully repaired), typecheck, contract+globals tests (11/0), lint, clean tree. Part 2 verified mechanically comment-lines-only and faithful to every entry bullet; the two flagged judgment calls (core-shim's version sentence, runtime-peer's "one checkout" phrase) are within the sweep's intent. The one deviation is an improvement the entry owed the contributor: the sibling located by an upward walk keyed on the manifest name instead of the literal `join(ROOT, '..', 'le-truc')`, which is main-checkout-shaped and cannot resolve from a worktree gate run — adopted as the pattern for any future sibling-reference tooling. No nit fixes needed.

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
