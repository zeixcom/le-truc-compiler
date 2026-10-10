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

- [ ] TC-013: Gate the zero-config pin — check:corpus refuses a root le-truc.config.json
  **Area:** tooling
  **Context:** Incident 2026-10-10, during the iteration-2 review pass (owner-confirmed): a stale untracked `le-truc.config.json` sat at this repo's root, and the corpus run honored it — every corpus-executing test emitted modules importing the file's pre-TC-003 `runtimeImport` pin (`'../../compiler/runtime'`), failing 93 module resolutions deep in the suite instead of surfacing as a config problem. The root cause is now structural: ADR 0014 s2 pins this repository to a **zero-config setup** — "this repository carries no config file: it runs on the defaults"; in-tree harness overrides live per caller in code (`tests/helpers/generated-corpus.ts`, `scripts/build-demo.ts`). A root config file appearing at all violates the pin, and nothing in the gates would notice.

  **Goal:** `scripts/check-corpus.ts` gains a preflight before the corpus pass runs: if `le-truc.config.json` exists at the repo root, exit non-zero citing ADR 0014 s2 (zero-config owner ruling, 2026-10-10) — the repo runs on the defaults; per-caller overrides live in code, and a root config is either a leftover to delete or a proposal to the Architect. One unit test asserts the preflight trips on the file's presence and passes on its absence (fixture dirs, not the real root).

  No behavior change to compilation or emission; the default path keeps byte-identical output.
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
  `registry.json`/D-32 wording; status carries the remaining four
  amendments as forward references until their ports land. `adr/0006`–
  `adr/0009` — the simulation/tiering/i18n batch (Le Truc 0027–0030)
  ported together, so their intra-batch citations use final numbers;
  0005's reference to 0029 now resolves to 0008. `adr/0010`–`adr/0015` —
  the surface/CSS/distribution/seam/config/conditions batch (Le Truc
  0032–0037); 0005's amendment chain now holds only 0046, 0006's and
  0008's Le Truc links resolve, and 0004's 0037 reference resolves to
  0015. Owner rulings folded: 0014 records the zero-config posture (a
  root config copied from the sibling was deleted — its pre-cutover
  `runtimeImport` pin would have broken the main build; `check:corpus`
  green after). `adr/0016`–`adr/0021` — the build-path/variants/IR/
  intrinsics/stylesheet/emitter batch (Le Truc 0038–0043); every Le Truc
  link in 0002, 0010–0012 and 0014–0015 that this batch could resolve now
  points at our records. 0020 is ⏸️ On hold (owner ruling: recorded
  directions await real consumers; may land in a later minor).
  Template and index are in place (`adr/0000`, `adr/adr-index.md`).

  **Classification (ruled 2026-10-10).** Adapters are complete (0010,
  0012, 0017 → 0002–0004). **Dropped, citation repair only:** sibling 0011
  (superseded by sibling 0028 — its citations repoint to 0028's port) and
  sibling 0002 (factory form — folded as a named citation into the 0024
  port; no compiler decision of our own to record). **0024 is promoted to
  the port set** — the format decision is compiler-native and the
  citation graph's hub. Pending: 0025 (likely citation repair only — its
  one citation explains a retired script). Remaining port set:
  0044–0049 — 6 records (the final batch; closes 0005's last link and
  0021's Reads). Next free ADR number: 0022.

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
  | 0027 | 0006 | Server simulation — render initial HTML by executing the client module | port | 2026-10-10 (Proposed) |
  | 0028 | 0007 | Tiered error surfacing — compiler first, contained runtime | port | 2026-10-10 (Proposed) |
  | 0029 | 0008 | Tiered server evaluation — route each component to the cheapest phase that can answer | port | 2026-10-10 (Proposed) |
  | 0030 | 0009 | Internationalization as build-time server data | port | 2026-10-10 (Proposed) |
  | 0032 | 0010 | Adopt .tsx as the primary authored surface (.tsrx retained) | port | 2026-10-10 (Proposed) |
  | 0033 | 0011 | Compiled component CSS is platform CSS | port | 2026-10-10 (Proposed) |
  | 0034 | 0012 | Distribution — @zeix/le-truc-compiler and template emission | port | 2026-10-10 (Proposed) |
  | 0035 | 0013 | The simulation seam | port | 2026-10-10 (Proposed) |
  | 0036 | 0014 | The corpus configuration surface | port | 2026-10-10 (Proposed) |
  | 0037 | 0015 | Reactive conditions — conditional arms as template-cloned branches | port | 2026-10-10 (Proposed) |
  | 0038 | 0016 | Runtime-neutral build path | port | 2026-10-10 (Proposed) |
  | 0039 | 0017 | Canonical-plus-variants — one tag, build-selected surface spellings | port | 2026-10-10 (Proposed) |
  | 0040 | 0018 | Typed IR contracts — discriminated unions and pass signatures | port | 2026-10-10 (Proposed) |
  | 0041 | 0019 | truc: intrinsic elements for compiler-consumed constructs in .tsx | port | 2026-10-10 (Proposed) |
  | 0042 | 0020 | The component stylesheet as a compiler artifact | port (on hold) | 2026-10-10 (On hold) |
  | 0043 | 0021 | The target-emitter interface — shared decisions, per-target syntax | port | 2026-10-10 (Proposed) |

  **Execution order.**

  1. Review sessions (Architect + owner): classify each remaining
     candidate, land adapters and ports, fill the mapping table.
  2. Citation sweep: remap every `ADR NNNN` in `ARCHITECTURE.md`,
     `CONTEXT.md`, `HOST_PROFILE.md`, `REQUIREMENTS.md` to the new
     numbers — and in `src/`, where ~10 files cite ADR numbers in doc
     comments; fix the ~22 dangling `../../adr/` links and the
     `../../DONE.md` residue in `CONTEXT.md`; replace the two standing
     sibling pointers in `ARCHITECTURE.md`; catch stale sibling-doc
     mentions in our docs (`COMPILER_SPEC.md`, `LE_TRUC_COMPILER.md`,
     `VOCABULARY_LEDGER.md` — e.g. `HOST_PROFILE.md:108`). One commit,
     after the table is complete.
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

- [ ] TC-014: Wire check:portability and fix its stale header path
  **Area:** tooling
  **Gates:** typecheck
  **Context:** ADR 0016 s4 names `scripts/corpus-portability-check.ts`
  (LT-267) as the standing cross-runtime gate: bundle the published
  `compileCorpus` entry once, run the same bundle under every runtime
  found on PATH, compile the corpus into per-runtime scratch trees, and
  require byte-identical emitted `.ts`/`.css`/`.json`. The script exists;
  no `bun run` entry is wired — ADR 0016 records "the script is the gate
  of record; the `bun run` entry is not yet wired". Owner ruling
  2026-10-10: wire it.

  **Scope:**

  1. Add `"check:portability": "bun run scripts/corpus-portability-check.ts"`
     to `package.json` — the script's own usage line already documents
     that invocation; nothing else in the file changes.
  2. Fix the script's stale header comment: it says the runtime seam
     lives at `server/runtimes/` — post-move it is `tests/runtimes/`.
     One line, comment only.
  3. Run the wired entry and report the result. The check discovers
     runtimes on PATH; if fewer than two are found, report whether it
     skips or fails — that behavior is the script's own and is not this
     task's to change.
