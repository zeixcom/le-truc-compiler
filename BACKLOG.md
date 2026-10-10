# Backlog

Every task not named by the current iteration's chain. The Architect bands
work here (`band: P1`…`P7`, lettered sub-bands as needed); an open, unbanded,
unchained task shows up as a note in `bun run check:queue`. A `parked` task
stays here until the Architect and the owner refine it back to `open`.

## P1 — committed next

## P2 — soon


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

- [ ] TC-010: Architecture review pass over css-scope.ts and sim/
  **Area:** design
  **Context:** Coverage gap from the 2026-10-10 architecture review: the deepening sweep covered the front ends, pipeline, corpus, contract, analysis, emitters and setup extraction, but `src/css-scope.ts` (1,582 lines — the scoped-CSS lowering, ADR 0033) and `src/sim/` (`realm.ts` 894, `patch-table.ts` 276, `boundary.ts` 123 — the Server Simulation driver, ADR 0027/0035) got only a structural glance, and no findings are claimed there. Owner + Architect session, not contributor work: apply the deepening heuristics (deletion test, interface-vs-implementation, locality, seams, coupling leaks — `references/deepening.md`), present numbered candidates, triage with the owner. Outcome feeds a later iteration's chain or the backlog.
