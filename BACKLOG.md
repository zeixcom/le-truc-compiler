# Backlog

Every task not named by the current iteration's chain. The Architect bands
work here (`band: P1`…`P7`, lettered sub-bands as needed); an open, unbanded,
unchained task shows up as a note in `bun run check:queue`. A `parked` task
stays here until the Architect and the owner refine it back to `open`.

## P1 — committed next

## P2 — soon


- [ ] TC-006: Pin the hand-copied emission rules (dispatch, adapters, vocabulary)
  **Area:** compiler
  **Context:** From the 2026-10-10 architecture review. Three duplications where copies must never drift but nothing enforces it:

  - **The watch-attribute dispatch rule** exists line-for-line twice: `planEachLoop`'s attribute walk in `src/analysis/loops.ts` and `emitConstructEffects` in `src/analysis/effects.ts` (post-TC-005: `src/analysis/construct-effects.ts`) — same `hostPropOf(mirror) || isDirtyFlagControlAttr(tag, name)` → `'property'` rule, same `coerceToString: returnsNumber(…)}`, and the LT-116 hazard comment copied verbatim. Extract one `dispatchOf(attr, tag)` helper in a new leaf `src/analysis/attr-dispatch.ts` that both call; the hazard comment moves with it and both call sites keep a one-line pointer.
  - **The selector-adapter closures** (`resolveSelector`, `selectorFor`, `loopFor` rebound over `component`) are re-spelled five times across `loops.ts` (×2), `harvest.ts` (×3) and as module-level wrappers in `effects.ts`. Add one parameterized helper in `src/analysis/selectors.ts` taking the component explicitly, and replace all five spellings.
  - **The form-control tag table** is duplicated: `SUBMITTABLE_FORM_CONTROL_TAGS` (post-TC-004 in `src/analysis/server-only-names.ts`) and `NAMED_FORM_CONTROL_TAGS` in `src/validate-lowered.ts`, with a comment in the analysis copy admitting the front-end→analysis import direction is the excuse. FIRST verify the two sets are semantically identical member-for-member; if they are not, stop and report the difference in `NOTES.md` (that is a finding, not a refactor premise). If identical, move the table to `src/vocabulary.ts` (which exists for exactly this) and import it from both.

  No behavior change of any kind.

  **Verification:** `bun run build`, `bun run test`, `bun run typecheck`, `bun run lint` green; zero snapshot/golden changes; no diagnostic message changes.

- [ ] TC-007: Deduplicate emit-server.ts and route serverTestExpr through initialFold
  **Area:** compiler
  **Context:** From the 2026-10-10 architecture review. The fold gate is implemented twice: `serverTestExpr` in `src/emit-server.ts` re-implements `initialFold` from `src/initial-winner.ts` inline (same `isServerEvaluable` gate, same `hostDerivedFold` fallback spliced by hand) — the all-or-nothing fold rule exists in two bodies that must not drift. Also inside `src/emit-server.ts`:

  - Route `serverTestExpr` through `initialFold` so the rule has one body; keep whatever thin adaptation the call site needs.
  - The host-derived splice callback (the ref→`foldableRefGuards` / prop→`hostSeedExpr` + `useSeedNames` lambda) appears three times (`hostDerivedExpr`, `serverTestExpr`, the setup host-fold) — one internal helper.
  - The `<template data-arms data-key>` stamping block appears twice (`emitAsyncBoundary`'s `templates()`, `emitReactiveConditional`'s tail), and the matching client query string `:scope > template[data-arms="…"]` is a repeated literal twice in `src/emit-client.ts` and once in `src/sim/realm.ts`. Give the stamping one emitter-side helper in `src/emit-server.ts` and the selector string one named constant in `src/codegen.ts` (the shared code-generation kit — import it in all three).
  - The identifier tokenizer (`text.match(/[A-Za-z_$][\w$]*/g)`) is defined twice and inlined four more times in `src/emit-server.ts`, plus twice in `src/imports.ts`. One helper in `src/ast-utils.ts`, imported everywhere.
  - The if/switch JS emission shape appears three times (`listTemplate.shape`, `emit`'s conditional arm, `emitReactiveConditional.renderLive`). Unify behind one internal emitter where the shapes are genuinely the same; where a site truly differs, leave it with a comment naming its twins — no forced unification.
  - `renderScopeNames` (emit-server) and `factoryScopeNames` (emit-client) are parallel name-collectors over `component.fors` with deliberately divergent extras, both feeding the shadow-alias policy. Extract the shared fors-walk core; keep the divergent extras in place, each doc comment naming the other and the shared contract.
  - The `isPending` presence scan: emit-server scans lines + setup + expose + root attrs; emit-client scans lines only. Check what the client actually consumes; if lines-only covers its use, document why on the scan; if it does not, unify on the stronger scan and say so in the handoff.

  No behavior change of any kind — this task's whole point is that the goldens prove it.

  **Verification:** `bun run build`, `bun run test`, `bun run typecheck`, `bun run lint` green; `tests/server.golden.test.ts`, `tests/client.golden.test.ts` and `tests/emit-tier.test.ts` green with zero snapshot changes.

- [ ] TC-008: Unify setup-extraction's twin loops
  **Area:** compiler
  **Context:** From the 2026-10-10 architecture review. `src/setup-extraction.ts` runs two classification loops — `extractSetup` (component setup, ~580 lines) and `extractItemSetup` (a reactive list item's setup, ~300 lines) — over the same grammar. They share some helpers (`seedHarvestOf`, `setupStatementRefusal`, `sensorSeedResolution`) but copy-paste five fragments:

  - `first()` call parsing + arity validation (identical selector/reason literal extraction and `diagnostic.invalidFirstCall` guard; only the success path differs);
  - the single-initialized-const guard (including the identical diagnostic string);
  - the ternary-of-constructors refusal (`consequentName`/`alternateName` over `SIGNAL_CONSTRUCTORS`, `diagnostic.conditionalSignalConstructor`);
  - the signal-IR construction shape (`MUTABLE_SIGNAL_CONSTRUCTORS.has(callee) ? declared : derived`);
  - micro: `extractSetup` inlines a `/Function(Expression)?$/` test instead of calling the file's own `isFunctionNode`.

  Extract each shared fragment as a file-local helper both loops call. The client-only gate stays TWO mechanisms by ruling (iteration ruling, 2026-10-10): the component loop's `clientKnownName` name-set membership and the item loop's `classOf` phase classification read genuinely different inputs — do not force them together; instead write the shared contract once as a doc comment on both gates (what a client-only statement may read; static `t.<key>` reads of declared keys admitted, LT-349).

  No behavior change of any kind.

  **Verification:** `bun run build`, `bun run test`, `bun run typecheck`, `bun run lint` green; zero snapshot/golden changes; `tests/item-setup.test.ts` and `tests/diagnostics.test.ts` green unmodified.
## P3 — later

- [ ] TC-003: Migrate the ADR record — fresh corpus in this repo
  **Area:** design
  **Ruling (owner, 2026-10-10):** This repo starts a **fresh ADR record,
  numbered from 0001**. Compiler-related ADRs port over from the sibling
  `le-truc` checkout (v3 branch, `../le-truc/adr/`) — each one re-read and
  re-adopted in a review pass, not copied blind. After the migration the
  sibling **deletes** the ported ADRs, so this repo becomes their only home.
  `REQUIREMENTS.md` is reworked into a high-level overview of requirements
  with each requirement's decisions mapped to the new ADR numbers. The owner
  accepts the extra work deliberately: adopting decisions from an
  experimental branch is the one chance to look at every one of them again.
  This amends sibling ADR 0049's "le-truc keeps the complete historical
  record" for the compiler corpus — moot anyway, since 0049 itself ports and
  is then deleted over there.

  **Port criterion** (scope ruling 2026-10-10): an ADR is compiler-related
  when it governs the compiler, its public contract, its generated modules,
  or its diagnostics. Provisional list, 29 of 49 — everything else stays in
  the sibling untouched:

  0003, 0010, 0011, 0012, 0017, 0024, 0025, 0027–0030, 0032–0049

  Seam cases the review pass must settle explicitly:

  - **0002** (factory form over builder) — runtime API decision, but the
    emitted client module *is* that factory form. Include-leaning.
  - **0009** (security validation in `bindAttribute`) — runtime enforcement;
    only compiler relevance is the diagnostics story it pairs with 0010 on.
    Stay-leaning.
  - **0025** (client-side playground) — cited here only for the rationale of
    a retired script (`CONTEXT.md`, `build:tsrx:browser`). Include-leaning,
    lowest value.

  **Renumbering:** relative original order is preserved, so the corpus stays
  chronological (0003→0001, 0010→0002, … 0049→0029; shifts if a seam case
  joins). Ported ADRs keep their original acceptance date and add an
  adoption line in the status; any ADR the review pass materially changes
  goes through Proposed→Accepted here. The template ports as `0000`. The
  mapping table below is built as ports land and drives the citation sweep.

  | sibling | here | title | ported |
  | ------- | ---- | ----- | ------ |

  **Execution order.**

  1. Port + review sessions (Architect + owner), building the mapping table.
  2. Citation sweep: remap every `ADR NNNN` in `ARCHITECTURE.md`,
     `CONTEXT.md`, `HOST_PROFILE.md`, `REQUIREMENTS.md` to the new numbers;
     fix the ~22 dangling `../../adr/` links and the `../../DONE.md`
     residue in `CONTEXT.md`; replace the two standing sibling pointers in
     `ARCHITECTURE.md`. One commit, after the table is complete.
  3. Rework `REQUIREMENTS.md` with the owner: high-level overview plus the
     requirement→decision map. Keeps its traceability role for the queue.
  4. Owner act, in `../le-truc`: delete the ported ADRs (its "never delete"
     supersession discipline is the sibling repo's own call to adapt).

  No gates touched — markdown only. Target: complete before the first
  lockstep publish, so the public repo never ships dangling citations.

- [ ] TC-009: Carve planHarvests into named stages
  **Area:** compiler
  **Needs:** TC-005
  **Context:** From the 2026-10-10 architecture review. `planHarvests` in `src/analysis/harvest.ts` is one ~877-line function containing roughly twelve inner closures (`reportUnharvestable`, `paramDomRead`, `unportableNames`, `substituteArgExpr`, its own `selectorFor`/`resolveSelector`/`loopFor` adapters, …) — the largest function in the codebase; the closures are modules without interfaces. Promote each closure to a named module-private function over explicit parameters, keeping `runHarvest` as the thin public entry (it is 5 lines today and stays 5 lines). No signature changes outside the module; nothing outside `harvest.ts` and its test imports change. Sequenced behind TC-005 so the analysis tree is stable first; if TC-006's selector-adapter helper has landed, the closures it replaces inside `planHarvests` dissolve into that helper instead of becoming functions.

  No behavior change of any kind.

  **Verification:** `bun run build`, `bun run test`, `bun run typecheck`, `bun run lint` green; zero snapshot/golden changes; `tests/scalar-harvest.test.ts`, `tests/list-harvest.test.ts`, `tests/key-alias-harvest.test.ts` green unmodified.

- [ ] TC-010: Architecture review pass over css-scope.ts and sim/
  **Area:** design
  **Context:** Coverage gap from the 2026-10-10 architecture review: the deepening sweep covered the front ends, pipeline, corpus, contract, analysis, emitters and setup extraction, but `src/css-scope.ts` (1,582 lines — the scoped-CSS lowering, ADR 0033) and `src/sim/` (`realm.ts` 894, `patch-table.ts` 276, `boundary.ts` 123 — the Server Simulation driver, ADR 0027/0035) got only a structural glance, and no findings are claimed there. Owner + Architect session, not contributor work: apply the deepening heuristics (deletion test, interface-vs-implementation, locality, seams, coupling leaks — `references/deepening.md`), present numbered candidates, triage with the owner. Outcome feeds a later iteration's chain or the backlog.
