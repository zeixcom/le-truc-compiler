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

- [ ] TC-011: Generate the .tsx tag augmentation from compiler facts; retire the hand-maintained host-profile table
  **Area:** design
  **Context:** The strict per-tag `IntrinsicElements` table in
  `src/frontend/tsx/host-profile.d.ts` is hand-maintained and grows "in the
  same commit as the migration" (the Wave-4 rule, LT-203) — every new or
  changed component tag needs a manual edit to a file inside the compiler
  package, and nothing enforces the table's freshness: a drifted entry
  fails only when a human notices. Owner ruling 2026-10-10: this has to
  become automatic. The compiler already holds every fact the table
  states — the registry entry carries the tag, the props type, the types
  the component exports and `exposedProps`; the IR knows which attributes
  are reactive (thunk overloads) and which tags declare a `truc:pass`
  surface.

  **Goal:** generate the component-tag section of the JSX augmentation
  from compiler information, retiring the hand-maintained table; the
  static native-element surface and the `truc:` constructs stay authored
  in the host profile.

  **Design questions to settle (architect + owner) before implementation:**

  - Emission shape: one corpus-level augmentation `.d.ts` beside
    `registry.json`, or per-package output?
  - How much strictness derives: thunk overloads from reactive
    attributes, `'truc:pass'` keys from `exposedProps`, the light-DOM
    attribute names from the IR?
  - How consumer-side augmentation for *installed* packages composes with
    this — `src/registry.ts` already anticipates promoting internal fields
    onto the public projection for cross-corpus composition "as a minor".
  - What replaces the Wave-4 same-commit rule: a freshness check, or
    generation that makes freshness moot.

  **Affinity:** the demo corpus type-check (TC-012) exercises the same
  table; consumer-side typing becomes load-bearing with template emission
  (TC-006, TC-007).
## P3 — later

- [ ] TC-003: Migrate the ADR record — fresh corpus in this repo
  **Area:** design
  **Ruling (owner, 2026-10-10):** This repo starts a **fresh ADR record,
  numbered from 0001**. Each candidate gets one of two treatments, decided
  in the review pass:

  - **Adapter** — for runtime-owned decisions the compiler depends on. Do
    not duplicate the sibling's wording: a fresh ADR here cites the
    sibling record as the decision's authority (stable link to its GitHub
    source on `main`) and states the decisions that follow for the
    compiler and its emission. The sibling keeps these records; they are
    not deleted over there. Cross-references to le-truc-internal
    amendments reduce to the consequence that matters — e.g. 0019's
    `observedAttributes()` escape hatch: it exists, and here is what
    follows for emission.
  - **Port** — for compiler-native decisions. The record moves here under
    a fresh number, re-read and re-adopted; after the migration the
    sibling **deletes** these, so this repo is their only home.

  `REQUIREMENTS.md` is reworked into a high-level overview of requirements
  with each requirement's decisions mapped to the new numbers. The owner
  accepts the extra work deliberately: adopting decisions from an
  experimental branch is the one chance to look at every one of them
  again. Stable links target `main`; the sibling corpus sits on the `v3`
  branch until release, so the links resolve when v3 lands — accepted
  pre-release.

  **Acceptance convention (owner, 2026-10-10):** every migrated ADR stays
  🔄 Proposed until the `REQUIREMENTS.md` consolidation; acceptance is
  granted there, corpus-wide, once each record has been re-read against the
  reworked requirements.

  **Landed (all Proposed):** `adr/0001` — adapter of Le Truc ADR 0003
  (connect-time model as compiler invariant, five consequences). `adr/0002`
  — adapter of Le Truc ADR 0010 (sanitize chokepoint spans server and
  client). `adr/0003` — adapter of Le Truc ADR 0012 (pass bindings accept
  only mediated forms; LTC012 family, tier 1). `adr/0004` — adapter of
  Le Truc ADR 0017 (list emission targets the keyed reconcile contract).
  `adr/0005` — the first port: Le Truc ADR 0024 in full, sixteen
  sub-designs re-anchored, s2 sharpened with the corpus-level
  `registry.json`/D-32 wording; status carries the five amendments as
  forward references until their ports land. Template and index are in
  place (`adr/0000`, `adr/adr-index.md`).

  **Classification (ruled 2026-10-10).** Adapters are complete (0010,
  0012, 0017 → 0002–0004). **Dropped, citation repair only:** sibling 0011
  (superseded by sibling 0028 — its citations repoint to 0028's port) and
  sibling 0002 (factory form — folded as a named citation into the 0024
  port; no compiler decision of our own to record). **0024 is promoted to
  the port set** — the format decision is compiler-native and the
  citation graph's hub. Pending: 0025 (likely citation repair only — its
  one citation explains a retired script). Remaining port set:
  0027–0030, 0032–0049 — 22 records. Next free ADR number: 0006.

  **Renumbering:** one number sequence for both classes, relative original
  order preserved. The mapping table below is built as adapters and ports
  land and drives the citation sweep.

  | sibling | here | title | treatment | landed |
  | ------- | ---- | ----- | --------- | ------ |
  | 0003 | 0001 | The connect-time attribute model is a compiler invariant | adapter | 2026-10-10 (Proposed) |
  | 0010 | 0002 | The sanitize chokepoint spans server and client | adapter | 2026-10-10 (Proposed) |
  | 0012 | 0003 | Pass bindings accept only mediated forms | adapter | 2026-10-10 (Proposed) |
  | 0017 | 0004 | List emission targets the keyed reconcile contract | adapter | 2026-10-10 (Proposed) |
  | 0024 | 0005 | Adopt TSRX as the isomorphic component format | port | 2026-10-10 (Proposed) |

  **Execution order.**

  1. Review sessions (Architect + owner): classify each remaining
     candidate, land adapters and ports, fill the mapping table.
  2. Citation sweep: remap every `ADR NNNN` in `ARCHITECTURE.md`,
     `CONTEXT.md`, `HOST_PROFILE.md`, `REQUIREMENTS.md` to the new
     numbers — and in `src/`, where ~10 files cite ADR numbers in doc
     comments; fix the ~22 dangling `../../adr/` links and the
     `../../DONE.md` residue in `CONTEXT.md`; replace the two standing
     sibling pointers in `ARCHITECTURE.md`. One commit, after the table is
     complete.
  3. Rework `REQUIREMENTS.md` with the owner: high-level overview plus the
     requirement→decision map. Keeps its traceability role for the queue.
  4. Owner act, in `../le-truc`: delete the port-class records (adapter
     sources stay). Its "never delete" supersession discipline is the
     sibling repo's own call to adapt.

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

- [ ] TC-012: Type-check the demo corpus
  **Area:** tooling
  **Gates:** typecheck
  **Context:** `demo/` is the corpus behind the live board — rendered
  through the compiler's own output and built by `build:demo` into
  `server/generated/demo/`. It is deliberately separate from `examples/`
  (the golden-pinned test corpus), but that separation left it with no
  gate at all: `examples/` has `check:corpus` and the goldens, `demo/` has
  nothing — its components can drift type-wise with no check catching it.
  Owner ruling 2026-10-10: a gap to close.

  **Goal:** wire the demo corpus through typecheck — `tsc` over the
  authored `demo/` sources against the `.tsx` host profile, the same
  check authored sources get — as a `bun run` entry (e.g. `check:demo`),
  cited where the board's build is documented.

  **Scope notes:**

  - No goldens for `demo/` — it is not the test corpus; board-output
    correctness stays `build:demo`'s own concern.
  - Type errors the check surfaces in demo components are in scope to fix
    here: the board is product surface.
  - Until TC-011 generates the tag augmentation, new demo tags extend the
    hand-maintained `host-profile.d.ts` table in the same change (the
    Wave-4 rule, applied to demo).
