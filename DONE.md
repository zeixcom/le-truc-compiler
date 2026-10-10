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

- [x] TC-005: Split effects.ts into its subsystems — reviewed ✓
  **Area:** compiler
  **Needs:** TC-004
  **Context:** From the 2026-10-10 architecture review. `src/analysis/effects.ts` is 3,733 lines exporting one real entry point (`runEffects`) while bundling at least five independently nameable subsystems, and it leaks four runtime values to `emit-server.ts`. Split along the existing seams, after TC-004 has removed `reportServerOnlyNames`. The layout is decided — do not invent a different one:

  - `src/analysis/effects.ts` keeps: the `EffectsContext` type (export it for the submodules — internal export), the five selector forwarding adapters, `emitTopEffects` (the walk driver) and `runEffects` (the five-phase orchestration: `validateArmSetPlacement` → `emitTopEffects` → `planHostComposeHandlers` → `reportUnplannedHandlers` → `validateComposeIds`).
  - New `src/analysis/construct-effects.ts`: `emitConstructEffects`, the pass-entry twin `checkPassEntries`/`emitPassEntries`, the lazy-text cluster (`emitLazyTextChildren`, `directLazyIdentifier`, `lazyChildOf`, `startOf`, `directLazyCatchRef`), and the construct predicates (`hasOwnConstruct`, `hasDeepConstruct`, `constructSignatureOf`, `hasClientConstructs`, `isInsideCompose`).
  - New `src/analysis/branch-effects.ts`: `handleOptionalBranch` with its `handleOptionalIfEffects`/`handlePerBranchIfEffects`/`handleIfEffects`/`handleSwitchEffects`/`handleTryEffects` family, `handleAsyncBoundary`, `handleReactiveConditional`, and `validateArmSetPlacement` with `ServerBranch`/`serverBranchFix`/`contentRefFix`.
  - New `src/analysis/mount-scopes.ts`: `MountScope`, `mountScope`, `holderOf`, `planNested`/`planNestedList`/`planNestedEach`, `keyAttrsOf`, `collectKeyAttrs`, `collectBranchKeyAttrs`, `unmountableInArm`, `isReconcileContainer`, `armContainer`, `planReconcileItem`.
  - New `src/analysis/compose-effects.ts`: `passObjectKey`, `ownHandlersOf`, `planComposeHandlers`, `composeSiteSelector`, `reportUnplannedHandlers`, `planHostComposeHandlers`, `emitComposeEffects`, `composeArmRootTag`, `planArmRootComposePass`, `planArmComposeHandlers`, `planContentConstructs`, `validateComposeIds`.
  - New `src/boundary-arms.ts` — a sibling of `initial-winner.ts`, shared by the pass and the server emitter: `BoundaryArmRoot`, `isBoundaryArmRoot`, `boundaryDeepConstructOf`, `lazyCatchMessageEl`, `htmlThunkSignalName` and their private dependencies. `src/emit-server.ts` repoints its four effects imports here; the effects-side submodules import from here too. This ends the analysis→emitter value leak.

  Rules for the split: submodules take `Pick<EffectsContext, …>` slices naming exactly the fields they use (the precedent is `reportServerOnlyNames`); no symbol changes signature; no function body is rewritten — moves only, plus the `fx` threading the move implies. Fold in the context-typing ruling (iteration ruling, 2026-10-10): do NOT brand or nominalize the context types — the structural interchange (`PassShared` satisfying `EachLoopContext`, `EffectsContext` satisfying both) is load-bearing under ADR 0040 s5. Instead extend `PassShared`'s doc comment in `plan.ts` to state the hidden contract explicitly: `badFreeNames` appends to `clientMessageKeys` as a side effect of being called during later passes.

  No behavior change of any kind; the public contract cannot change (`tests/contract.test.ts` pins it). ARCHITECTURE.md § 3's module map is updated in review.

  **Verification:** `bun run build`, `bun run test`, `bun run typecheck`, `bun run lint` green; zero snapshot/golden changes; `tests/analysis.test.ts` and `tests/pass.test.ts` green unmodified.

  **Changed:** `src/analysis/effects.ts` (3,637 lines) split along the entry's layout, moves only — `effects.ts` keeps `EffectsContext` (now exported for the submodules' slices), the five selector adapters (params narrowed to `Pick<EffectsContext, 'component'>` so the slices can call them), `emitTopEffects` and `runEffects`; new `construct-effects.ts` (construct lowering, pass-entry twin, lazy-text cluster, predicates, plus the unnamed shared helpers `suppresses`/`selectorOf`), `branch-effects.ts` (branch/boundary handlers + `validateArmSetPlacement` with `ServerBranch`/fixes), `mount-scopes.ts` (Mount Scope machinery, `planReconcileItem`), `compose-effects.ts` (compose planning + `validateComposeIds`); new `src/boundary-arms.ts` carries the five arm-root symbols and `emit-server.ts` repoints its four effects imports there, ending the analysis→emitter value leak; `PassShared`'s doc comment in `plan.ts` now states the `badFreeNames`→`clientMessageKeys` side-effect contract (context-typing ruling); twelve stale `analysis/effects.ts` pointers in other modules' comments repointed to the new homes. No behavior, signature, diagnostic or emission change.

  **How:** Each new module was assembled from exact line ranges of the pre-split file; the moved bodies were then verified byte-identical against those ranges (whitespace/comma/trailing-`export`-normalized compare) — only `export` additions and the sanctioned `fx: <Module>Context` parameter narrowing differ. Each submodule takes a module-level `Pick<EffectsContext, …>` slice naming its transitive field set (own reads plus everything its forwarded `fx` calls need); `branch-effects` and `mount-scopes` share the same 26-field slice because they call into each other. That mutual recursion is the split's one new back-edge pair, documented in both module headers under the same every-cross-call-inside-a-function-body discipline as effects→loops.

  **Check:** All gates green in the worktree: `build` (180 modules), `test` (2,901 pass / 0 fail, 89 snapshots unchanged, zero golden drift; `tests/analysis.test.ts` + `tests/pass.test.ts` green unmodified), `typecheck`, `lint` (biome check over all four trees — no fixes needed), `check:contract` (public contract + D-33 hold; run as insurance though no surface change), `build:corpus` (43 components, needed once in a fresh worktree: the tsx host-profile tests shell out to `tsc -p examples/tsconfig.json`, whose `files` list includes the gitignored `server/generated/components/tsrx-imports.d.ts` — the two failures before that build were environmental, not the change). `check:peer` not run — no runtime-peer imports changed. Three placement calls the review pass should confirm: (1) `suppresses`/`selectorOf`, unnamed in the entry, live in construct-effects and are exported — their caller set (construct + branch bands) mirrors `startOf`'s; (2) `directLazyCatchRef` sits in construct-effects per the entry's explicit lazy-text cluster list, though nothing in construct-effects calls it — its callers are `lazyCatchMessageEl`/`boundaryDeepConstructOf` (boundary-arms) and `handleAsyncBoundary` (branch), both of which import it from there, so `src/boundary-arms.ts` pulls two analysis predicates (`hasDeepConstruct` likewise, explicitly listed in construct's predicates) and is not a pure leaf; (3) the five selector adapters' parameter type narrowed from `EffectsContext` to `Pick<EffectsContext, 'component'>` — call shapes unchanged, read as the "fx threading" the entry sanctions. ARCHITECTURE.md § 3's module map is untouched, per the entry — for the review pass to update.

  **Review:** approved 2026-10-10 — layout verified symbol-for-symbol against the decided one; five moved bodies (incl. `handleAsyncBoundary`, `planReconcileItem`, `emitConstructEffects`) byte-compared identical against the pre-split file; peripheral files verified comment-lines-only; all gates re-run green in the worktree (build, 2,901 tests / 0 fail, typecheck, lint, clean tree; the +5 count is the runtime-neutrality scan's per-file cases over the five new modules — no test file changed, `mount-scopes.test.ts` predates the branch). The three flagged placement calls all confirmed: (1) `suppresses`/`selectorOf` homed with `startOf`'s caller set; (2) `directLazyCatchRef`/`hasDeepConstruct` stay per the entry's explicit lists — the resulting `boundary-arms` → `construct-effects` edge is one-way and cycle-free, and `boundary-arms`' header owns the impurity; (3) the adapters' `Pick<EffectsContext, 'component'>` narrowing read as sanctioned fx threading. The pass-4 cluster's new cycles (effects↔submodules via the adapters, branch↔mount via `planNested`) are documented in each module header under the function-body discipline. ARCHITECTURE.md § 3 updated in this review: five module rows, `boundary-arms.ts` row beside `initial-winner.ts`, dependency-shape paragraph rewritten to the cluster shape. No nit fixes needed.
