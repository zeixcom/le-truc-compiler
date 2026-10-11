# Backlog

Every task not named by the current iteration's chain. The Architect bands
work here (`band: P1`…`P7`, lettered sub-bands as needed); an open, unbanded,
unchained task shows up as a note in `bun run check:queue`. A `parked` task
stays here until the Architect and the owner refine it back to `open`.

## P1 — committed next

The v3.0 emission track: template emission against the ruled target-emitter
interface (ADR 0021). The shared walk (TC-021 → TC-059/TC-060/TC-061) runs in
iteration 3. Two design sessions come before Twig: TC-062 (SSG as a backend of the
walk) and TC-063 (optional chaining, the URL context). The Twig target (TC-022)
and its PHP CI job (TC-023, after TC-025) follow.


- [ ] TC-022: Template emission — the Twig target (ADR 0021): syntax table, exhaustive escaping map, boundary/list/children emission, one partial per component × locale, byte-equivalence on the real engine
  **Area:** compiler
  **Needs:** TC-021, TC-059, TC-060, TC-061, TC-062, TC-063
  **Gates:** typecheck, test
  **Context:** REQUIREMENTS §9.2 and ADR 0021. The target owns only syntax: a syntax
  table plus an escaping map, switching exhaustively over the operation set and the
  eight-member escaping-context union (tsc flags a missing case — that is the
  interface's safety property).

  **Do:**

  - The Twig syntax table for every operation: native `if`/`for` (loop sources include
    enclosing-item member paths), the boundary as a three-test conditional over the
    result arg, the list template stamped `data-list="N"` at host level, includes with
    `only` and the captured children arg in the composed-markup context (raw emit, no
    hook, with a generated comment naming why it is safe), the conditional's initial
    winner beside inert arm templates.
  - The exhaustive escaping map — text, quoted attribute, URL attribute (the
    safe-protocol allowlist as a Twig check), boolean attribute, class token, style
    value, HTML (through `le_truc_sanitize_html`), composed markup (raw).
  - The `owner` arg: minted collision-free against every component's props; passed by
    compiled compose sites with children; absent for page-rendered instances and
    pass-less includes.
  - One partial per component × locale; argument-less messages and the client `i18n`
    attribute folded; message calls as `le_truc_format` over the localized pattern
    literal (ADR 0021 s6 unchanged).
  - The host-helpers manifest for the integrator: URL allowlist check,
    `le_truc_sanitize_html`, `le_truc_format` over `MessageFormatter`.
  - Byte-equivalence against SSG on the real engine (`twig/twig`, `intl`) for every
    emittable fixture × locale, the boundary fixture included; the adversarial escaping
    corpus, negative cases included.

  **Diagnostics:** none new — LTC057/LTC058/LTC090 are the walk's (TC-021); a target
  that fails exhaustiveness is a tsc error, not a diagnostic.

  **Check:** Twig renders are byte-identical to SSG for every emittable fixture ×
  locale; the escaping corpus passes with negative cases; no change to the walk or the
  dump target (the interface's second-target proof holds).

  *Adopted from Le Truc LT-528, 2026-10-11.*

- [ ] TC-023: Template emission — the PHP CI job (twig/twig + intl): Twig equivalence, the adversarial escaping corpus and the ICU equivalence corpus on the real engine; local runs skip without php
  **Area:** compiler
  **Needs:** TC-022, TC-025
  **Context:** ADR 0021 s8 and REQUIREMENTS §9.2: equivalence is byte identity with SSG,
  checked on the real engine — `twig.js` was rejected as the reference renderer
  (divergent escaping, no ICU).

  **Do:**

  - A CI workflow (this repository has none yet — TC-025 stands it up) installing `php`
    with `twig/twig` and `intl`, running the Twig byte-equivalence suite, the
    adversarial escaping corpus (negative cases included) and the ICU equivalence
    corpus.
  - The job is required-check eligible but tolerant locally: without `php` on the
    machine the suites skip, never fail (the dump target is the PHP-free equivalence
    check).
  - State the exact local invocation in `CONTRIBUTING.md`.
  - If the split's closing publish/CI task (Le Truc LT-526, mirrored here as TC-025) is
    still configuring branch protection when this lands, add the job to the
    required-checks list in the same change rather than after.

  **Diagnostics:** none.

  **Check:** CI runs the three suites on the real engine and passes; a local run
  without `php` exits green with an explicit skip line; nothing in the compiler's
  output changes.

  *Adopted from Le Truc LT-529, 2026-10-11.*

- [ ] TC-062: Converge emit-server.ts onto the shared template walk — SSG as a backend of the walk (ADR 0021, REQUIREMENTS §9.2)
  **Area:** design
  **Needs:** TC-061
  **Context:** REQUIREMENTS §9.2: a target emitter is "a backend of the same IR walk as the
  SSG render, never a sibling interpretation". ADR 0021 s8 relies on this ("holes render
  where the client harvests because it is one walk"). TC-021 landed `template/walk.ts` as a
  sibling of `emit-server.ts` that copies its decisions construct by construct. The two are
  held in step only by the dump-target byte comparison (owner ruling at TC-021's review,
  2026-10-11). TC-059–TC-061 add the boundary, lists and children to the walk, so after
  TC-061 the operation set is complete and the convergence can be designed against all of
  it.

  **Design questions** (Architect and owner, before this becomes an implementation task):

  - How does SSG carry an expression outside the portable subset? Options: an SSG-only
    opaque-code operation that no template target accepts, a second expression layer, or
    SSG keeps its own expression lowering under a shared structural walk.
  - Generated-code shape: the render module's output must stay byte-identical, since the
    goldens are unchanged. Does SSG become an ops → JS target, or does the walk call an
    emitter interface that both implement?
  - What the walk must learn that only `emit-server.ts` knows today: Simulated and Static
    skeleton retention (`retainReferenced`), key-alias witness calls, span recording.
  - Does this amend ADR 0021, or does it only make the code match it?

  **Check (for the implementation task this design produces):** one walk. `emit-server.ts`
  no longer decides markup structure, goldens are byte-identical, and the dump comparison
  keeps passing.

- [ ] TC-063: Portable-subset and escaping edges before Twig — optional chaining, and the URL context's allowlist (ADR 0021 s1, s3)
  **Area:** design
  **Context:** Two questions came out of TC-021's review (2026-10-11). TC-022 cannot
  proceed without the answers, because both decide what Twig must translate or check.

  1. **Optional chaining.** ADR 0021 s1's subset, `initial-winner.ts` and TC-021's
     `portable.ts` all leave out `?.`. As a result, form-listbox, form-radiogroup and
     module-listnav route Static (`options[0]?.value`, which also uses a computed member).
     Should `?.` join the subset, and should a literal index join it alongside? How do
     Twig and HTL translate it with byte identity to JS semantics, given that `null` and
     `undefined` both short-circuit to `undefined`? Adding it amends ADR 0021 s1, either in
     place or by superseding it (`references/adr.md`).
  2. **The URL context.** ADR 0021 s3 says the target "must reject exactly what the fold
     rejects", but the SSG fold rejects no protocol: a URL attribute value passes through
     `attr()` unchanged. TC-022's bullet "the safe-protocol allowlist as a Twig check"
     contradicts that. Should the fold gain the runtime's allowlist (a behavior change to
     SSG output, with its own channel and tier), or should the Twig URL context escape like
     a quoted attribute, with ADR 0021 s3 and TC-022 corrected to match?

  **Outcome:** rulings recorded on TC-022, which is then edited, plus an ADR 0021 edit or
  supersede if either answer changes s1 or s3. Any SSG behavior change becomes its own
  compiler task.
## P2 — soon

The two-repo machinery and the release program: CI, branch protection and the
publish path (TC-025); the 2.x codemod design (TC-050, held in `design` until the
owner rules its drift-cost metric).


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

- [ ] TC-050: The 2.x → 3.0 codemod, and the drift-cost measurement it instruments
  **Area:** design
  **Context:** ADR 0012 s6. Pioneer 1 is a Zeix SSG project migrated from Le Truc 2.x,
  and nothing covered `.ts` + `.html` + `.css` → `.tsx` before now. The owner's read,
  recorded because it scopes the task: the conversion is always possible — JSX reflects
  the static HTML, the factory body copies over verbatim and already runs, and
  deterministic transforms (inline event handlers, 1:1 effects) do ~80%.

  **It is codemod-assisted, not push-button, and must be documented as such.** The
  residue is chiefly resolving `first()` selectors to structural JSX — the hard cases
  land exactly where the old code was sloppiest, which is the drift the compiler exists
  to eliminate. Deliverable shape: a compiling `.tsx` plus a **report of what it could
  not resolve**, for judgement. At pioneer scale (~50 components) that residue is
  affordable; sold as push-button it disappoints on pioneer 1.

  **Fit here:** the codemod is a §4-shaped source-to-source translator into host-profile
  TSX — the adapter seam's first real consumer shape (the seam itself is parked as
  TC-018; this can ship as a standalone script before the seam).

  **Second job — it is the measurement instrument.** The drift-cost data point is a
  before/after on the same components, so the 2.x baseline must be captured **before
  the codemod runs**. Define what is measured (the metric is the task's first decision,
  not an afterthought). OWNER RULING NEEDED on the metric before this leaves `design`:
  the source repo's 2026-10-10 planning explicitly held the task out for exactly this
  reason, and this repository's REQUIREMENTS has no pioneer success criterion to cite
  it against yet.

  **Check:** the codemod run over the remaining hand-written twins and over pioneer 1
  produces compiling sources plus an honest residue report; the baseline exists before
  either run.

  *Adopted from Le Truc LT-259, 2026-10-11. ESCALATED: placement (here vs. the
  sibling's release program) and the unruled drift-cost metric.*
## P2b — Compiler product-readiness

The equivalence contract between the authored surfaces, the diagnostics and the
shared walks: TC-024 (boundary-arm construct parity), TC-026 (the census names the
compose edge), TC-027 (the shared estree walk hardened), TC-028 (the `.tsrx`
client-stmt name check converged); the parked TC-053 (`magic-string`, demand-gated).
Standing rule carried from the source repo's review: adopt a maintained library
where one exists instead of authoring version twelve; memoising the redundant estree
traversals and restructuring `sim/` stay declined, so future reviews do not
re-propose them.


- [ ] TC-024: Boundary-arm construct parity — the async boundary's arms plan client constructs exactly like reactive-conditional arms (ADR 0015 s3/s4)
  **Area:** compiler
  **Gates:** typecheck, test
  **Context:** Ruled 2026-10-10 in the LT-484 session (owner — option A, full parity):
  the refusals were residue of the channel-by-channel build-out, not a recorded
  decision. ADR 0015 s3 ("arm content owns its effects… `watch()`/`on()`/`pass()` are
  usable inside an arm") and s4 ("the boundary switches to the same mechanism") already
  grant the vocabulary, and the refusal's own citation (ADR 0005 s13, "deeper elements
  have no addressing") was superseded by the arm-scope machinery (the ADR 0023 proof,
  Mount-Scope recursion). `isClientConstructAttr` covers client-only attributes, so
  retry/cancel handlers in catch/pending arms do not compile today — the gap parity
  closes.

  **Do:**

  - Factor the conditional arm-content planner out of `handleReactiveConditional`
    (`src/analysis/branch-effects.ts`): root-construct emission
    (`emitConstructEffects`), the `mountScope` + `localFor` addressing for nested
    elements, `collectKeyAttrs`, and the `planNested` recursion for nested arm sets and
    reactive lists. Thread it through `handleAsyncBoundary`'s three arm plans
    (`ok`/`nil`/`err`), same file.
  - Retire `boundaryDeepConstructOf` (`src/boundary-arms.ts`) and the four refusal
    faces: the ok-root-via-child-channel refusal (root constructs + the lazy signal
    child now coexist, as the `truc:html` thunk channel already proved), the err-root
    refusal, the pending-arm refusal, and the deep-construct refusal ("Deeper elements
    have no addressing"). These are faces of existing codes, not codes — no LTC
    retires; the arm-scope proof's existing unaddressable-element face covers nested
    elements inside boundary arms.
  - Keep the value-channel disciplines untouched: driver-channel detection (direct
    lazy child or `truc:html` thunk), the one-catch-read rule, the message-element
    discriminator inside composed content, and the compose-arg catch-read refusal. The
    ok arm's value write and construct effects coexist in one mount, as the thunk
    channel already does.
  - Fixtures on both surfaces: a retry handler in a catch arm, a cancel handler in a
    pending arm, a reactive attribute on a nested element inside each arm, a nested
    conditional and a nested reactive list inside an arm, beside the existing
    driver-channel/one-read/discriminator cases staying green. Goldens re-pin.
  - Rewrite `HOST_PROFILE.md`'s boundary section (the driver channels and
    one-catch-read rule stay; the sanctioned-channel-only model goes) and check
    `AGENTS.md`'s boundary bullet still reads true (a proposal through
    `.agents-proposals/` if copy must move).

  **Channel/tier (ADR 0007):** no new checks. Four refusal faces retire; none arrive.

  Parallel to the emission chain (TC-021 → TC-023): this touches
  `src/analysis/branch-effects.ts`; the emission chain adds new code. TC-021's boundary
  fixture may exercise an arm construct if this lands first.

  **Check:** every fixture compiles and behaves on both surfaces; the arm-scope
  selector proof holds inside boundary arms (nested elements addressable, unique-class
  failures report); the server render and the zero-warning baseline are unchanged
  (client-written sites inside inert arm templates already bake empty); the four faces
  no longer fire anywhere in the corpus.

  *Adopted from Le Truc LT-530, 2026-10-11; the effects carve (TC-005) moved the named
  functions into `branch-effects.ts`/`boundary-arms.ts`.*

- [ ] TC-026: Make tier contamination legible at the compose edge — the census names the re-routing edge
  **Area:** compiler
  **Context:** The external review's recommendation, promoted under the framework
  premise: the compose contamination fixpoint (ARCHITECTURE.md § 5.2, the classifier;
  the fixpoint runs in the registry-aware second corpus pass) means a parent that
  *reads* a child — `first()` addressing a compose site, or `truc:pass` into it —
  inherits the child's tier, so "I added a `first()` and my component left the Folded
  tier" is a different-tier outcome whose only footprint is the census. In-house that
  is an inconvenience; for thousands of external users it is a support ticket
  generator. The fixpoint already knows the edge it traverses — record it: the census
  reason for a contaminated component names the compose edge (parent file/tag → child
  tag) that caused the re-route.

  **Channel (ADR 0008 sub-design 6 posture):** build report / census record — not a
  warning, no new diagnostic code; the warning baseline and the census's regression
  signal are untouched.

  **Verification:** a fixture whose parent re-routes via a compose edge shows the edge
  in the census reason; the corpus census stays 36/7/0 with reasons extended, not
  changed; goldens byte-identical (census text is not emitted code); full gates
  (`build`, `test`, `typecheck`, `lint`, `check:corpus`, `check:contract`).

  *Adopted from Le Truc LT-246, 2026-10-11; its prerequisites (the corpus-port
  migrations) landed before the split.*

- [ ] TC-027: Harden the shared estree walk for constructs the corpus never saw
  **Area:** compiler
  **Context:** The shared walk's guarantee that the borrowed keys reach everything the
  old per-front-end walks reached rests on a one-off audit of 51 corpus files (the
  2026-10-01 estree convergence). Nothing pins it, and the corpus is exactly the input
  the framework premise says to distrust. REQUIREMENTS §2 (Engine): the machinery walks
  estree; parser access is confined to one converter leaf. Three parts:

  1. **Pin the key-coverage invariant.** Add a construct-zoo fixture for both parsers
     (classes with `implements`/decorators/parameter properties, enums, namespaces,
     `satisfies`, generics, overloads, `declare`, abstract members, accessors, labeled
     loops) plus the corpus. Assert that every node-valued key on a type
     `eslint-visitor-keys` knows is in `KEYS`, `TYPE_POSITION_KEYS`, or a comment key.
     An exception needs an explicit allowlist entry with a decision. A `@tsrx/core`
     bump that adds a key then fails a test instead of silently dropping a subtree.
  2. **Make `'skip'` mean "erased".** Today it only drops type-position *keys*, so TS
     type-only declarations nested in code still leak. `freeIdentifiers` over
     `() => { type Row = {…}; interface Box { width: number } … }` returns `Row`,
     `Box`, `width` on `.tsrx`, and only `Row`, `Box` on `.tsx`. Under `'skip'`, skip
     `TSTypeAliasDeclaration`, `TSInterfaceDeclaration`, `TSDeclareFunction` and
     `declare`-flagged nodes wholesale. Keep the runtime-bearing TS nodes walked:
     `TSEnumDeclaration`, non-`declare` `TSModuleDeclaration`, `TSParameterProperty`,
     and the expression wrappers `as`/`satisfies`/`!`/`<T>x`/instantiation.
  3. **Complete the scope walk.** `ClassDeclaration`/`ClassExpression`/
     `TSEnumDeclaration` bind their id. Non-computed `MethodDefinition`/
     `PropertyDefinition`/accessor keys are not reads (today `class K { m() {} }`
     reports `K` and `m`). **Mostly landed 2026-10-01:** class ids, member keys,
     labels, function hoisting, named function expressions and parameter defaults are
     done and pinned in `tests/converged-answers.test.ts`. What remains:
     `TSEnumDeclaration` binding its id, and a class declared later in a block but
     read from an earlier closure (`function f() { return new C() }; class C {}`),
     which is legal JS and still reports `C`. That is the same sequential-binding
     model `const` uses, so fix both or neither, and state which.

  Then add a surface-parity assertion: `freeIdentifiers` agrees on every zoo construct
  across `.tsrx` and `.tsx` (`src/walk.ts` vs the `typescript-estree` path;
  `src/frontend/tsx/to-estree.ts` is the converter leaf). Weigh
  `@typescript-eslint/visitor-keys` (a superset of `eslint-visitor-keys` with TS node
  keys) for the fallback path — same maintainer, same pure-data shape; it would turn
  the TS fallback into borrowed keys too.

  **Channel/tier:** none. No diagnostic is added; each changed answer is a correctness
  fix to an existing analysis, pinned per site.

  **Verification:** goldens + parity byte-identical (the corpus has no nested
  type-only declarations; prove it); the invariant and parity tests; full gates.

  *Adopted from Le Truc LT-363, 2026-10-11; its runtime-neutrality prerequisite
  landed before the split.*

- [ ] TC-028: Converge the `.tsrx` in-template client-statement name check onto the setup one
  **Area:** compiler
  **Context:** A bare client-only statement beside conditionally rendered `.tsrx`
  markup (`src/frontend/tsrx/lower-template.ts`, the `client-stmt` lowering) accepts
  only `JS_GLOBALS`, `CONTEXT_NAMES` and signals. The same statement at top level goes
  through `src/setup-extraction.ts`'s `clientKnownName`, which also accepts refs, setup
  consts, authored imports, expose ambients and the `CLIENT_ONLY_PRIMITIVES`. The 2026-10-01
  scope-analysis convergence left them apart on purpose. Widening the narrow one is
  only sound if the client module actually EMITS what the statement reads at its
  guarded position, and `computeClientNeededNames` (`src/emit-client.ts`) does not walk
  `client-stmt` nodes today. So: extend the client-need walk to `client-stmt` nodes,
  then share one predicate. Pin a ref read and a plain-import read, each compiling and
  running in the generated client. Check the `.tsx` surface's equivalent (an expression
  statement in a branch) for the same answer; ADR 0010 s6 parity applies.

  **Channel/tier:** compiler. This removes false rejections; no diagnostic is added.
  Any reworded rejection copy follows `writer` → error-messages.

  **Verification:** corpus byte-identical; diagnostic parity (equal code, severity and
  message after the allowlist, plus the `.tsrx`-vocabulary leak scan); the new pins;
  full gates.

  *Adopted from Le Truc LT-369, 2026-10-11.*

- [ ] TC-051: Widen `first()` verification — authored selectors verified against the materialized probe — **Parked 2026-10-11** (adopted ruling): authoring-visible by design — the tier census and warning baseline change when it lands, so it enters an iteration only by iteration planning with the owner's sign-off on the behavior.
  **Area:** compiler
  **Context:** ADR 0023's staged follow-up: once the probe is the engine (landed before
  the split), an authored `first('nav a.active')` — descendant combinators, `:not()`,
  attribute operators, all shapes `parseSimpleSelector` returns "cannot verify" for —
  can be structurally verified by querying the SAME materialized probe, and then used
  as the addressed contract verbatim (the authored-first rule) instead of falling back
  to synthesis. **Authoring-visible change:** selectors that previously fell back to
  synthesis become the addressed contract, and a verified-but-unmatched authored
  selector fires LTC026 where a silent miss (and synthesis fallback) happened before —
  the census and warning baseline change BY DESIGN, so this task enters an iteration
  only by iteration planning, with the owner's sign-off on the behavior. Scope the
  first landing to descendant combinators, `:not()` and attribute operators;
  child/sibling combinators (`>`, `+`, `~`) cannot cross the probe's exclusivity
  wrappers (ADR 0023's Consequences) — keep them "cannot verify" unless a follow-up
  first extends the wrapper model.

  **Channel/tier:** no new runtime check; verification widening strengthens tier 1
  (Prevented). LTC026's existing wording stands unless it must distinguish
  verified-miss from unverifiable — if it does, the copy follows `writer` →
  error-messages.

  **Verification:** new pins (authored selector used verbatim when verified; LTC026 on
  verified-miss; synthesis fallback unchanged for child/sibling and unparseable);
  goldens change ONLY where a corpus component's authored selector newly verifies —
  assert none today, or enumerate the delta in the handoff; full gates.

  *Adopted from Le Truc LT-381, 2026-10-11; its engine-prerequisite landed before the
  split.*

- [ ] TC-053: Adopt `magic-string` under `spans.ts` — reopened only by a real source-map consumer — **Parked 2026-10-01** (Architect, carried over the split): the output-neutral-swap route is closed by ruling; reopens only when a real source-map consumer exists.
  **Area:** compiler
  **Context:** `magic-string` would replace `src/spans.ts`'s hand bookkeeping (~−150
  lines) and buy real source maps free — which output source maps (TC-019's deferred
  concern) and the playground idea both want eventually. **Ruling (2026-10-01, from the
  contributor's evaluation, carried):** the "output-neutral swap that retires code"
  route is closed — `magic-string` edits one original string, but a generated statement
  is emitter glue with source slices interpolated and reindented over the assembled
  text, so the swap would add a `Bundle` and a mappings → `SourceSpan` conversion
  (every consumer reads `SourceSpan`) instead of deleting the recorder; the CodeBuilder
  work already took the span bookkeeping; and it would turn a transitive dependency
  (via `@tsrx/core`, repo-internal) into a direct one of the published compiler.
  **Reopens only when** a real source-map consumer exists: the playground accepted, or
  editor tooling that reads standard source maps. The task is then "emit a standard
  source map", and `magic-string` is one candidate among several (deriving a v3 map
  from `SourceSpan` directly is the other).

  **Verification (when reopened):** goldens + parity byte-identical; the span table's
  remapped positions unchanged on a diagnostic-sample fixture; full gates.

  *Adopted from Le Truc LT-247, 2026-10-11, with its parked ruling.*
## P3 — later

Latent correctness and diagnostic-precision items, independent of the release track
and of each other. The one ordering rule inside the band is TC-030 after TC-029 (the
`internals` routing builds on TC-029's reverse IDL name table); everything else is
freely pickable and safe to interleave with any band: TC-031, TC-032, TC-033.


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
  `adr/0022`–`adr/0027` — the final batch (Le Truc 0044–0049): the
  corpus is **complete at 27 records**. 0027 records the owner's two
  reversals of the split ADR with their reasons (ruling 6: the corpus
  suite migrated for self-containment; ruling 7: the queue beat GitHub
  issues for agent-driven work). Every in-corpus forward reference now
  resolves; only the authority links and stay-in-Le-Truc references
  remain external. Template and index are in place (`adr/0000`,
  `adr/adr-index.md`).

  **Classification (ruled 2026-10-10).** Adapters are complete (0010,
  0012, 0017 → 0002–0004). **Dropped, citation repair only:** sibling 0011
  (superseded by sibling 0028 — its citations repoint to 0028's port) and
  sibling 0002 (factory form — folded as a named citation into the 0024
  port; no compiler decision of our own to record). **0024 is promoted to
  the port set** — the format decision is compiler-native and the
  citation graph's hub. Pending: 0025 (likely citation repair only — its
  one citation explains a retired script). **Port set complete** — 27
  records, 0001–0027 (0020 on hold). Next free ADR number: 0028.

  **Citation sweep COMPLETE (step 2).** Every in-repo citation maps to
  this repo's numbering (docs, `src/`, `tests/`); the dangling
  `../../adr/` links are remapped, the standing sibling pointers in
  `ARCHITECTURE.md` replaced, stale sibling-doc mentions repaired, and the
  old decision-log/tracker ids (D-NN, M-NN, LT-NNN) removed from the
  living docs and JSDoc comments. Deliberately left: LT references inside
  diagnostic message strings and generated-file banners (product text the
  goldens may pin) — owner may rule. **Consolidation COMPLETE (step 3):**
  `REQUIREMENTS.md` is rewritten as the north-star document — problem,
  users, constraints, success criteria, then the per-area requirements
  (citation anchors preserved) and the §13 decisions map covering all 27
  records.

  **Acceptance DONE (owner, 2026-10-10):** all records flipped to
  ✅ Accepted except 0020 (on hold); the REQUIREMENTS §13 status note and
  the index reflect it.

  **Remaining.** The owner deletes the ported records in `../le-truc`
  (step 4, the migration's last act).

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
  | 0044 | 0022 | Structured, source-mapped diagnostics | port | 2026-10-10 (Proposed) |
  | 0045 | 0023 | The structural-uniqueness proof runs on a materialized probe | port | 2026-10-10 (Proposed) |
  | 0046 | 0024 | Reactive-list items as Mount Scopes | port | 2026-10-10 (Proposed) |
  | 0047 | 0025 | Harvest through a key alias, witnessed by the render | port | 2026-10-10 (Proposed) |
  | 0048 | 0026 | The children contract | port | 2026-10-10 (Proposed) |
  | 0049 | 0027 | The compiler lives in its own repository | port | 2026-10-10 (Proposed) |

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

- [ ] TC-015: Diagnostic report views — JSON and SARIF (ADR 0022 s4)
  **Area:** compiler
  **Gates:** typecheck
  **Context:** REQUIREMENTS §11.2 and ADR 0022 s4: the diagnostic record is
  public API and its views are projections of one stream, so the views
  cannot disagree. The record shape is live in `src/diagnostics.ts`
  (`code`/`severity`/`message`/`location`/`related`/`fix?`); only the
  terminal reporter exists.

  **Scope:** a JSON report (the records as data, for scripts and tests)
  and a SARIF report (for CI code scanning), each a pure projection of the
  same stream. Additive — the record shape does not change. A TypeScript
  language-service plugin is explicitly out of scope.

- [ ] TC-016: Shadow DOM mode (REQUIREMENTS §3.2) — parked ⏸
  **Area:** compiler
  **Context:** REQUIREMENTS §3.2 defines the opt-in mode — a declarative
  shadow template as the root's first child; the `@scope` block unwraps
  into the shadow root (`:scope` becomes `:host`, authored limits drop),
  top-level rules move to the document stylesheet, `::slotted()` becomes
  legal; harvest and ID references stop at the boundary. Unbuilt and
  unscheduled. Filed so the requirement's one missing mode is tracked.

  Opens with a design pass: the mode touches emission (ADR 0011 s9's
  translation step), harvest scoping, generated locators and the children
  contract's boundary rules.

- [ ] TC-017: `truc:element` dynamic tag (REQUIREMENTS §3.4) — parked ⏸
  **Area:** compiler
  **Context:** ADR 0019 member 2 / REQUIREMENTS §3.4: the spelling of
  `.tsrx`'s dynamic-tag expression — a server-known tag expression naming
  an HTML element, folded in the Folded tier. Recorded, built when a
  migration needs it. Until then both surfaces reject it with LTC053, and
  in `.tsx` it is additionally a `tsc` error (no `IntrinsicElements`
  entry). Filed so the recorded-but-unbuilt vocabulary member is tracked.

- [ ] TC-018: The adapter seam — first-class reference adapter (REQUIREMENTS §4) — parked ⏸
  **Area:** design
  **Context:** REQUIREMENTS §4: source-to-source translation into
  host-profile TSX for a declared profile version, with a source map back
  to the input; diagnostics remap so authors see their own file;
  translate-or-refuse; no plugin machinery. Experimental until a
  first-class reference adapter exists — the seam's first design session
  picks it (the old D-04 question: `.tsrx`-as-adapter versus an external
  format) and the conformance shape. Includes the `.tsx.map` sidecar
  pickup in the corpus entry point.

- [ ] TC-019: Deferred dev loop — incremental API, watch plugins, output source maps — parked ⏸
  **Area:** compiler
  **Context:** REQUIREMENTS §2: the incremental API is additive and never
  part of the initial contract — invalidation must run per module AND
  along compose edges when it lands; whether Bun and Vite plugins are
  first-party is undecided; output source maps for emitted files are a
  separate deferred concern. Filed so the three deferrals are tracked in
  one place.

- [ ] TC-020: Complete the shared sanitize policy — server half configurable — parked ⏸
  **Area:** compiler
  **Context:** REQUIREMENTS §3.7 / ADR 0002: one application-provided
  sanitize policy across both halves. The fail-closed defaults work today
  on both halves; the configurable server-side policy is blocked on
  TypeScript's DOM library shipping `TrustedHTML`-complete typings. Parked
  on that external blocker; unblocks when the lib lands or a consumer asks
  with a workaround proposal.

- [ ] TC-029: Lower reactive `aria-*` on element targets to `bindAria()`, with a reverse IDL name table
  **Area:** compiler
  **Gates:** typecheck, test, check:corpus
  **Context:** Owner decision, 2026-09-02. About which binding helper the compiler
  emits, not about server-execution tiering. Le Truc v2.6 added `bindAria()` (Le Truc
  ADR 0026 — the runtime record, authority for the helper's semantics) and the compiler
  does not know about it: the corpus's reactive ARIA bindings (seven at filing —
  `String(selected.get() === pid)` in module-tabgroup, `String(host.value ===
  optValue)` in form-listbox, `String(parseOklch(host.value).h ?? 0)` in
  form-colorgraph, …) lower to `bindAttribute` with a **compiler-synthesized
  `String()`** — precisely the hand-rolled coercion the helper exists to remove.

  **Fix:** lower a reactive `aria-*` attribute on an element target to
  `watch(<thunk>, bindAria(el, '<idlName>'))`, dropping the synthetic `String()` and
  letting the helper apply ARIA's own coercion (boolean → `'true'`/`'false'`, number →
  decimal, `nil` → clear). **Two hard constraints.**

  1. The attribute→IDL mapping is a **lookup table, not a transform**: ARIA attribute
     names carry no inner hyphens, so `aria-valuenow` gives no clue where the camel
     hump falls (`ariaValueNow`). Build the table by enumerating `ARIAMixin`'s names
     and applying the library's own forward rule (`ariaAttributeName`) — do not
     hand-maintain a second list that can drift from the platform.
  2. `ARIAMixin` splits into **44 string-valued props and 8 element-reference props**
     (`ariaActiveDescendantElement`, `ariaControlsElements`, `ariaDescribedByElements`,
     `ariaDetailsElements`, `ariaErrorMessageElements`, `ariaFlowToElements`,
     `ariaLabelledByElements`, `ariaOwnsElements`) that take `Element`/`Element[]`. An
     IDREF *string* must NEVER be routed to one — `aria-describedby="x"` is not
     `ariaDescribedByElements`. Map string-valued props only; leave the IDREF
     attributes on `bindAttribute`. All of the corpus's IDREF ARIA is server-static
     today, so nothing regresses.

  **Acceptance:** the reactive ARIA sites lower to `bindAria` with no `String()`; the
  golden clients update; the example corpus's behavior gates stay green (the Playwright
  spec suite is the Le Truc corpus's — here the equivalence audit's connect diffs, the
  goldens, `check:corpus` and `typecheck` carry that proof); the compile-warning
  baseline holds (ARCHITECTURE.md § 6: zero target, the module-dialog LTC088
  contract-rule exception).

  *Adopted from Le Truc LT-147, 2026-10-11.*

- [ ] TC-030: Route the component's OWN host ARIA to `internals`, and diagnose CSS that depends on host ARIA attributes
  **Area:** compiler
  **Needs:** TC-029
  **Gates:** typecheck, test, check:corpus
  **Context:** Owner decision, 2026-09-02. Per Le Truc ADR 0026 §1, host semantics
  belong on `internals.aria*`: invisible in markup, unclobberable by framework
  attribute rewriting, and still overridable by the consumer's own attribute. **Fix:** a
  reactive `aria-*` on the ROOT element lowers to `watch(<thunk>, bindAria(internals,
  '<idlName>'))` rather than to an attribute write on the host. **The two halves must
  land in the same commit,** because the routing is what makes the diagnostic
  necessary: `bindAria()` on an `ElementInternals` target **removes the shadowing
  content attribute** at its first value assertion (Le Truc ADR 0026 §1,
  stale-attribute rule), so a server-rendered `aria-expanded="false"` on the host is
  deleted at connect — by design, and fatal to any CSS selecting on it. **So:** diagnose
  a selector in the component's own `<style>` block that matches the HOST on an
  `aria-*` content attribute (e.g. `module-tabgroup[aria-expanded="true"]`), with the
  fix-it naming `:state()` (Le Truc ADR 0016 §8 — the custom-states record) as the
  component-owned styling hook. **The distinction is load-bearing and the diagnostic is
  wrong without it:** ARIA on CHILD elements stays on the attribute channel (native IDL
  reflection mirrors element-target writes), so the corpus's existing
  `&[aria-selected="true"]` selectors nested under tab buttons and option buttons in
  module-tabgroup and form-listbox are CORRECT and must NOT warn. Only host-matching
  selectors do. **Zero corpus sites exercise either half today**, so write both
  fixtures first; this is a forward-looking guard.

  **Carried from the LT-177 deferral.** (1) This task owns the serialization pin that
  was deferred: a corpus fixture whose root `aria-*` binding serializes WITH the
  attribute under simulation — the realm-level test pins the mechanism only, and a
  `.tsrx` fixture was meaningless before any root ARIA binding existed. (2) Under
  simulation `internals` is now non-null for non-form-associated components, so an
  imperative `internals.states.add(…)` in a factory throws a `TypeError`; route custom
  states through `bindState()`, which capability-probes and no-ops on skeletal
  internals.

  **Acceptance:** a root `aria-*` thunk lowers to the internals form; a host `[aria-*]`
  style selector warns; the child selectors stay silent; the simulation serialization
  pin holds; the compile-warning baseline holds.

  *Adopted from Le Truc LT-148, 2026-10-11.*

- [ ] TC-031: Strengthen two gate-wave assertions in gate-wave-verification.test.ts that don't test what they claim
  **Area:** compiler
  **Gates:** test
  **Context:** Filed by the 2026-09-03 gate-wave review, re-confirmed present
  2026-09-17. Two tests in `tests/gate-wave-verification.test.ts` pass today but don't
  verify the behavior their name/comment claims — a regression in the underlying
  compiler behavior would fail neither.

  1. **'the reactive spelling plans a client binding the static spelling does not'**
     (line ~440) only asserts `hostVariant.spans`/`bareVariant.spans` are truthy — true
     of any compiled component. Fix: assert on the actual compiled `clientCode`, e.g.
     `hostVariant.clientCode` contains a `watch(...host.count...bindText(` call and
     `bareVariant.clientCode` does not (confirmed by hand at review: the distinction is
     real and present today).
  2. **'composed under form-combobox, initial render stays hermetic'** (line ~483) only
     asserts the string `<form-listbox` appears in the composed output — trivially
     true. `form-combobox` composes its listbox with `filterable={false}`, so there is
     no clear button to check; the acceptance-relevant behavior is the other known
     composed-filter case (the combobox's selected-but-`hidden` inner option is authored
     `truc:pass` filter wiring). Assert the first option renders both
     `aria-selected="true"` AND `hidden=""` in the initial (pre-`truc:pass`) render,
     matching `tests/sim-driver.test.ts`'s own corpus snapshot for `form-combobox`.

  **Acceptance:** both tests fail if the underlying compiled/rendered behavior
  regresses; `bun test tests` stays green.

  *Adopted from Le Truc LT-170, 2026-10-11.*

- [ ] TC-032: LTC033 sees only the expression written at the site — an impure read through a setup const, helper or loop const folds
  **Area:** compiler
  **Context:** Confirmed at review on `.tsx` (`.tsrx` is the same code path). All of
  these compile clean and bake one build-time reading into the page:
  `const shuffled = [...items].sort(() => Math.random() - 0.5)` then a loop over
  `shuffled`; `const shuffle = (xs) => [...xs].sort(() => Math.random() - 0.5)` then
  `shuffle(items)`; a `const id = crypto.randomUUID()` hoisted inside an `@for` body;
  `{id}` or `{rid()}` as a static text child over such a const or helper. Only the
  inline spelling fails LTC033, because `containsImpureAmbient` (`src/fold-inputs.ts`)
  checks the site's own node. The setup-const and helper forms are how a shuffle is
  usually written, so the earlier fix closed only the least common spelling.

  **Rule:** report LTC033 at the server-evaluated position that *reads* the impurity,
  not at the declaration. A setup const whose value never reaches markup is harmless.
  Reuse LTC054's mechanism in `src/fold-inputs.ts`: the `tainted` fixpoint over setup
  helpers, extended to non-function setup consts and hoisted loop consts, with
  impure-ambient causes in place of page-context reads. Keep the `Intl` scope rule: a
  helper's locale argument resolves in the caller's scope. Static positions only. A
  reactive thunk reading a tainted const keeps today's omit-and-correct behaviour (the
  retention-pool ruling).

  **Channel:** compiler. **Tier:** 1 Prevented (existing LTC033). **Copy:** follows
  `writer` → error-messages, if the builders need a "through `name`" clause naming the
  carrier. LTC054 reports reads through helpers without one, so decide by consistency
  with it.

  **Check:** the five probes above fail LTC033 on both surfaces. A resolvable-locale
  `Intl` helper still folds. A setup const holding `Math.random()` that is read only in
  client code compiles. Corpus output byte-identical; census unchanged.

  *Adopted from Le Truc LT-340, 2026-10-11.*

- [ ] TC-033: Move the discriminated-compose probe to the positive config as an in-place `@ts-expect-error`
  **Area:** compiler
  **Gates:** typecheck, test
  **Context:** `tests/fixtures/tsx/discriminated-compose.tsx` is a must-fail file in
  `tests/fixtures/tsx/tsconfig.neg.json`. Its point is that the second
  `<DiscriminatedChild collapsed={true} />` (no `id`) errors and the first (`id="ok"
  collapsed={true}`) doesn't. The test pins this by line number and message text in
  `tests/tsx/typecheck.test.ts`, and the editor shows the intended error as a live
  squiggle. A JSX-comment directive on the line before the element says it in place,
  and was verified 2026-10-01: `{/* @ts-expect-error — collapsed ⇒ id */}` suppresses
  the error. An unused directive is TS2578, so a regression to a flattening
  `Omit<P, 'i18n'>` fails the positive config. The attribute-line form
  (`// @ts-expect-error` between attributes of a multi-line tag) does NOT work: a
  missing-prop error is reported at the tag name, so that directive goes unused.

  **Do:** add the directive above the failing element; drop the file from the root
  `tsconfig.json`'s `exclude` and from `tsconfig.neg.json`'s `include`; delete the two
  `discriminated-compose.tsx(…)` assertions from the negative test; update the file's
  header comment (it says "must FAIL tsc") and the positive-config comment in
  `typecheck.test.ts`.

  **Trade-off accepted:** `@ts-expect-error` accepts *any* error on that line, so the
  exact `LibraryManagedAttributes<` message is no longer pinned. The probe is about
  which line fails, so that's acceptable. The other negative probes (`async-bad-arms`,
  `bad-host-typo`, `i18n-bad-reads`, `combobox-bad-args`) depend on their exact
  messages and stay in the neg config.

  **Verification:** `bun test tests/tsx/typecheck.test.ts` green. Then, temporarily,
  swap `LibraryManagedAttributes`'s distributive omission in
  `src/frontend/tsx/host-profile.d.ts` for a plain `Omit`: the positive config must
  fail with TS2578. Revert.

  *Adopted from Le Truc LT-365, 2026-10-11; fixture paths adapted.*
## P4 — Migration guards for 2.x authors

Guards for hand-written 2.x components migrating to 3.0: TC-034 (flag a non-void
factory return — authored-surface rule plus the `DEV_MODE` warning, whose runtime
half is Le Truc-repository work). The band grows only if migration feedback surfaces
new sharp edges — deliberately small, so it never competes with the emission track.


- [ ] TC-034: Flag a non-void factory return — authored-surface rule + DEV_MODE warning
  **Area:** compiler
  **Gates:** typecheck, test
  **Context:** TypeScript's void-return assignability means a legacy 2.x `return [...]`
  factory still compiles against the `(context) => void` factory type while its value
  is silently ignored — a migration trap the types cannot catch (pinned by the "a
  factory return value is ignored" test; locate its home in `tests/` — if the pin did
  not move with the split, this task re-pins it). ADR 0007 s1: a factory
  `return`-with-value is statically decidable, so a runtime check owes a compiler rule.

  **Channel and tier (ADR 0007 s1):** compiler — an `LTC` rule (the next free code at
  pick time; LTC057/LTC058/LTC090 are TC-021's) for a `return` statement carrying a
  value in factory-body position on authored surfaces, tier 1 Prevented; runtime — a
  `DEV_MODE` warn in `connectedCallback` for hand-authored `.ts` consumers, tier 2
  Contained (the component still enhances; the return is ignored). **The runtime half
  is Le Truc-repository work** — file it there (or waive it) so the two halves ship
  together. Not urgent for the compiler-authored corpus (generated clients never
  return); aimed at prerelease early adopters migrating 2.x hand-authored components.

  **Check:** catalog rows added (`CONTEXT.md`'s diagnostic vocabulary +
  `.agents/skills/` error-message references if they list codes); compile-warning
  baseline holds; batch the copy with the `writer` → error-messages pass.

  *Adopted from Le Truc LT-281, 2026-10-11.*
## P5 — Migration-review residue

Compose-site and setup-const ergonomics the wave-4 example migrations surfaced:
TC-035, TC-037, TC-039, TC-040, and the band's one design session, TC-043 (reactive
attributes on the component root — an ADR 0005 s3 check and an owner ruling before
any implementation).


- [ ] TC-035: Pin the last compose-site children typing leg — JSX children passed to a child with no `children` arg fail tsc
  **Area:** compiler
  **Gates:** typecheck, test
  **Context:** The children-typing design landed before the split:
  `LibraryManagedAttributes` in `src/frontend/tsx/host-profile.d.ts` maps a string
  `children` arg to `ComposeChildren`. `tests/fixtures/tsx/string-children-compose.tsx`
  pins the positive case, and `tests/fixtures/tsx/string-children-bad.tsx` pins two
  negatives: a function child, and a missing required `children`. One leg of the
  original check is still unpinned: JSX children passed to a child that declares no
  `children` arg must fail tsc, because the compiler has no `{children}` site to
  substitute them into.

  **Do:** add that case to `tests/fixtures/tsx/string-children-bad.tsx`, and assert its
  TS error in `tests/tsx/typecheck.test.ts` beside the existing legs. If tsc accepts it
  today, stop and write a `NOTES.md` entry: that would be a typing gap, not a fixture.

  **Channel/tier:** TypeScript, tier 1 Prevented. No compiler or runtime change.

  **Check:** `typecheck` and `test` green; the negative fixture program fails with
  exactly the expected errors.

  *Adopted from Le Truc LT-331, 2026-10-11.*

- [ ] TC-037: Extend the client-only credit to plain setup consts (LTC013 over-routing)
  **Area:** compiler
  **Needs:** TC-036
  **Gates:** test, check:corpus
  **Context:** The client-only-credit rule (LT-323, landed pre-split) stopped a
  *signal* whose consumers are all client-only from routing Simulated. A *plain setup
  const* gets no such credit. `const panels = all(…)` routes on LTC013 even when the
  only readers are `on`/`watch`/`each` statements and no value reaches markup. That
  lands `module-carousel` (three LTC013 sites) Simulated with no reactive render site.
  (The task's other original target, `module-lazyload`, already folds by the Task-only
  ruling — a component whose only async state is a `Task` folds, so its LTC043 leg is
  moot.)

  **Rule:** the same credit, "at least one client-only read, none a render read". It
  must be transitive through consts (the LT-327 ruling) and through `expose()`
  initializers, which the server module evaluates. A const read by `expose()` is a
  render read for this purpose. The Folded-tier emitter already drops an unreferenced
  unevaluable const (`dropUnreferencedUnevaluable`), so this is a routing change only.

  **Channel/tier:** none (routing).

  **Check:** carousel routes Folded, or the entry records the residual reason. Its
  sim-driver and equivalence snapshots stay append-only. The census moves from 36/7/0
  to 37/6/0 if carousel folds. carousel's inline `all()` in its `index` initializer
  stays, since that is an `expose()` read.

  **Cluster:** with TC-036 and TC-038 (one contributor, in that order).

  *Adapted from Le Truc LT-333, 2026-10-11 — the lazyload leg had already folded at
  the source repo; only the carousel leg remains.*

- [ ] TC-039: `argsFromAttrs` attribute lookup — the kebab-case convention, its case-insensitive fallback, and its documentation
  **Area:** compiler
  **Gates:** test, check:corpus
  **Context:** **Ruling (2026-09-25):** a server arg's page-occurrence attribute is its
  **kebab-case** name (`readingTime` ← `reading-time`), the HTML convention every
  Parser attribute already follows (`allow-scripts`). A `number` arg gets a numeric
  channel, where a blank value is absent and a non-numeric one leaves the occurrence
  unrenderable. Both landed before the split. **Residue:** form-spinbutton's markup
  writes `bigStep`, which parse5 lowercases to `bigstep`, so the occurrence matches
  neither the old camelCase lookup nor the new kebab one. Either fall back to the
  lowercased name when the kebab name is absent (HTML's own case-insensitive matching),
  or port spinbutton's markup to `big-step`. The contributor decides from how many
  authored occurrences exist.

  **Absorbed residue:** the page-occurrence helper keyed a camelCase arg by its
  camelCase name (`attrs["bigStep"]`), so an authored occurrence never matched, because
  HTML attribute names serialize lowercase. That is the same lookup this task rules.
  Key by the kebab-case attribute the client Parser reads at connect, apply the chosen
  fallback, and pin both with a camelCase-arg fixture: it renders its authored
  attribute value, and the goldens are unchanged. Check first whether form-spinbutton's
  markup already writes `big-step`; if it does, the residue above is only the fallback
  decision. `argsFromAttrs` stays internal (the internal-registry ruling — the public
  projection excludes it), so the helper's signature is free to change.

  **Docs:** state the convention in `HOST_PROFILE.md` (the i18n/page-render section)
  and `ARCHITECTURE.md` § 5.3 (page occurrences).

  **Channel/tier:** none.

  **Check:** a page-render test for the chosen spinbutton spelling; corpus output
  byte-identical.

  *Adopted from Le Truc LT-336 (absorbing LT-297), 2026-10-11.*

- [ ] TC-040: A destructuring setup const is diagnosed at its reader, not at itself
  **Area:** compiler
  **Gates:** test, check:corpus
  **Context:** `const { ok: setHTML } = dangerouslyBindInnerHTML(…)` compiled without a
  diagnostic at the declaration. The generic LTC005 "other than const declarations"
  message then fired at the *next* statement reading `setHTML`, the `watch`, which
  sends the author to the wrong line. Either accept object- and array-pattern consts
  in the setup subset (bind every pattern name as a setup init, which
  `collectBoundNames` already supports), or diagnose the declaration itself with a
  fix-it (`const x = expr.ok`). Prefer accepting them: the rewrite is mechanical and
  authors write destructuring by habit.

  **Channel/tier:** compiler, tier 1, if diagnosed; none if accepted. Any new copy
  follows `writer` → error-messages.

  **Check:** lazyload's original destructuring spelling compiles, or fails at its own
  line.

  *Adopted from Le Truc LT-337, 2026-10-11.*

- [ ] TC-043: Reactive attributes on the component root element
  **Area:** design
  **Context:** `collapsed={() => host.collapsed}` on a template root is LTC005 today
  ("reactive constructs on the component root"). So reflecting a Parser-exposed prop
  back onto the host stays a hand-written setup `watch('collapsed',
  bindAttribute(host, 'collapsed'))`, the last non-template statement module-codeblock
  needs besides the copy wiring. The pattern recurs (open/collapsed/expanded state on
  hosts).

  **Design first:** the server renders the root attribute from the arg, the Parser
  seeds from it at connect, and the thunk rebinds it. That is one channel, but
  LTC039's root-attribute exemption and the fold of `host.<prop>` on the root need
  checking against ADR 0005 s3 before implementation. Needs an ADR amendment or a
  short ADR; new diagnostics' copy follows `writer` → error-messages.

  *Adopted from Le Truc LT-310, 2026-10-11.*
## P7 — Backlog (not scheduled)

Owner-parked designs, explicit 3.0 non-goals, and items gated on a real need. The
setup-const cluster's outer halves TC-036 and TC-038 sit here (with TC-037 they run
as one contributor's sequence, chained by `needs:`), beside TC-041 and TC-042. The
design-session family holds TC-044 → TC-049 (owner-timed). Gated-on-need items (TC-052,
TC-055, TC-056) wake when ADR 0020 leaves hold or a consumer appears; TC-054,
TC-057 and TC-058 move only by owner direction.

- [ ] TC-036: A setup const referenced only from client positions stays out of the server module
  **Area:** compiler
  **Gates:** test, check:corpus
  **Context:** `module-ticker`'s random tick and its add-rows handler were first
  authored as setup consts (`const tick = () => …`, `const addRows = () =>
  tickers.splice(…)`) referenced only from `watch` and `onClick`. They read no
  client-only name, so the server module kept them, and `check:corpus` failed its
  typecheck: the server harness's `ServerCell`/`ServerList` carry no `update`/`splice`.
  The corpus inlines both bodies into their client positions instead.

  **Problem:** the server module's membership is decided by what a const *reads*, not
  by where it is *used*; a portable helper used only by handlers is dead code on the
  server and, when it mutates a signal, a type error there.

  **Better shape:** a setup const (and its transitive setup-const dependencies) whose
  every reference sits in a client position — handler, `watch`/effect body, `expose()`
  method, client-only setup statement — is classified client-only and omitted from the
  server module, the same way a const that reads a client-only name already is. A const
  with any server-position reference keeps today's placement. **Channel/tier:**
  compiler only; no new runtime check and no new LTC rule (the change removes a
  failure, it diagnoses nothing).

  **Then:** optionally hoist `module-ticker`'s tick and add-rows bodies back to named
  consts.

  **Verification:** `test` with a unit leg (handler-only const absent from the server
  module; a const also read in a rendered thunk still present); `check:corpus`.

  **Cluster ruling (2026-10-09, carried from the LT-110 review):** this task, TC-037
  and TC-038 all decide how a setup const is classified: whether it is client-only, a
  render read, or substitutable into a verbatim derivation. Schedule them together for
  one contributor, in the order TC-036 → TC-037 → TC-038 (placement, then routing
  credit, then substitution), so the three rules land on one classifier, not three —
  expressed here as the `needs:` chain.

  *Adopted from Le Truc LT-459, 2026-10-11.*

- [ ] TC-038: A literal-initialized setup const is readable in a verbatim client derivation
  **Area:** compiler
  **Needs:** TC-037
  **Gates:** test, check:corpus
  **Context:** `module-ticker`'s host-level block derivation
  (`deriveList(() => Array.from({ length: Math.ceil(tickers.length / BLOCK_SIZE) }, …))`)
  cannot read `const BLOCK_SIZE = 100`: `substituteArgExpr` refuses any free
  setup-const name in a verbatim derivation, so `blocks` gets LTC004 (no harvest
  route) and the whole component routes Simulated. The corpus spells `100` out there
  and reads `BLOCK_SIZE` at three other sites.

  **Problem:** a pure literal constant is server- and client-known, yet reading it
  costs the component its tier; authors duplicate the literal and the copies can drift.

  **Better shape:** a setup const whose initializer is a literal (number, string,
  boolean, `null`, or a `const` chain of them; no call, no reference to args or
  signals) is inlined into the verbatim derivation by `substituteArgExpr`, exactly as
  an arg is substituted. Any other initializer keeps today's refusal and LTC004
  wording. **Channel/tier:** compiler only; no new runtime check; the existing LTC004
  narrows, its message unchanged.

  **Then:** restore `BLOCK_SIZE` in `module-ticker`'s block derivation, delete the
  spelled-out comment; the tier stays Folded and the clients stay identical.

  **Verification:** `test` with a unit leg (literal const inlined; a call-initialized
  const still LTC004); `check:corpus`; the ticker's tier-corpus entry unchanged.

  **Cluster:** with TC-036 and TC-037 (one contributor, in that order).

  *Adopted from Le Truc LT-458, 2026-10-11.*

- [ ] TC-041: A base URL for the simulation realm, so the arm-adoption audit stops pinning lazyload's realm-only `err` flip
  **Area:** compiler
  **Gates:** test
  **Context:** The realm's document is `about:blank`, so `module-lazyload`'s relative
  `src` fails `isValidURL` after adoption and the task rejects — the adopted `nil` arm
  flips to `err`, which no browser does at connect. The arm-adoption block in
  `tests/equivalence-audit.test.ts` therefore pins it in `SETTLED_IN_REALM`
  (`module-lazyload`, `module-listnav`).

  **Problem:** the pin hard-codes a realm artifact; a real adoption regression that
  happened to land on `err` would pass.

  **Better shape:** the realm (`src/sim/realm.ts`) takes a document base URL (an
  http(s) origin; the fetch itself never needs to resolve during the connect drain), so
  the relative `src` validates and the task stays pending — `nil` stays live. Then
  delete `SETTLED_IN_REALM` and let the final-key assertion compare against the
  server's live keys for every entry. Check that no sim-driver or golden snapshot
  depends on the `about:blank` behavior; re-pin any that move, by design.

  **Verification:** `test`; the adoption block passes for lazyload/listnav with no
  per-tag override.

  *Adopted from Le Truc LT-457, 2026-10-11.*

- [ ] TC-042: Name the cause when a parent's reference into its content is unaddressable because no region marks it
  **Area:** compiler
  **Gates:** test, check:corpus
  **Context:** In two shapes, ADR 0026 s1 gives the parent's content no marked region,
  and a parent `first()` into it falls through to LTC007's generic "matches nothing /
  unaddressable" message:

  1. **Mixed-content forward:** the child forwards the content beside its own markup
     (`<E><b/>{children}</E>`). E's region belongs to the forwarder, and no element
     encloses the original owner's content alone.
  2. **Declared, never inserted:** the child declares `children` but its template never
     inserts them.

  **Ruling:** both stay refused. Each is correct under s1: there is no region to
  re-include, and inventing a wrapper element would change the child's DOM. Only the
  message changes. Keep code LTC007 and add two message variants that name the cause
  and the fix:

  - for 1: "`<E>` forwards this content beside its own markup, so no region marks it as
    yours; wrap `{children}` in an element in E's template".
  - for 2: "`<C>` never inserts its children".

  The `childrenRegion.unmarked` flag (`src/children-region.ts`) and a missing
  `childrenRegion` already carry the facts. Final copy goes through `writer` →
  error-messages.

  **Check:** `test` pins both messages, on both surfaces.

  **Channel/tier:** compiler, tier 1 Prevented (unchanged). No new code.

  *Adopted from Le Truc LT-497, 2026-10-11.*

- [ ] TC-044: A generated fallback `id` for an element whose ARIA relation needs one
  **Area:** design
  **Context:** The children contract's strictness makes module-codeblock's `id`
  required when collapsed, so the overlay's `aria-controls` always points at something.
  The ergonomic alternative the owner named is the one several JS frameworks ship:
  derive a stable id when the author omits one. The hand-authored docs fence and the
  tab-panel fragments would benefit most, because they render collapsed blocks with no
  id and no `aria-controls` at all.

  **Design questions first.** Where is the id minted: compiler, server runtime, or page
  renderer? What makes it stable across builds: a content hash of the tag, source path
  and occurrence index? How do we guarantee uniqueness per page when the same component
  composes twice? Does it serialize into the client, or is it DOM-is-truth once
  rendered? Is it opt-in per argument or a general facility? Not before a second
  consumer beyond codeblock appears, or the docs fence wants `aria-controls`.

  **Constraint (2026-10-01):** the data account (REQUIREMENTS §5.1, LTC039/LTC042) and
  REQUIREMENTS §3.3 ("A per-document `id` in a template MUST come from a server arg")
  rule out a compiler-generated id. A design either mints it outside the compiler (the
  page renderer or the authoring schema) or amends that rule explicitly — an owner
  decision.

  **Channel:** none until designed. The design names its own.

  *Adopted from Le Truc LT-345, 2026-10-11.*

- [ ] TC-045: Design session — fetched partials that bring new components to the page (script admission and loading; the compiled `allow-scripts` gap)
  **Area:** design
  **Goal (owner, 2026-10-06):** allow a fetched HTML partial to bring *new* components
  to the page — components the build did not know. The origin constraint: partials come
  from the same origin, or from origins the page's CSP policy approves. Decouple-point:
  split out of the lazyload boundary migration so it does not wait on a security
  design.

  **Constraint the ruling must satisfy:** code-splitting for components. A rarely-used,
  huge component (a video player) must not be pulled into the main JS bundle; whatever
  mechanism rules must load component code lazily, on the partial's arrival.

  **Ground truth established in the 2026-10-06 dive** (verify before ruling; facts may
  have moved — note that `dangerouslyBindInnerHTML` and its `SCRIPT_ATTRS` handling are
  RUNTIME code, in the Le Truc repository; the lazyload mocks live in this corpus):
  1. The platform's free mechanism: `customElements` upgrades any matching element
     inserted into the document — a partial carrying *known* component markup needs no
     script at all. The script in `examples/module/lazyload/mocks/snippet.html` exists
     only because `shake-hands` is not yet *registered* (a guarded
     `customElements.define` shim).
  2. The runtime escape hatch (`dangerouslyBindInnerHTML({ allowScripts })`) re-creates
     script nodes naively: `SCRIPT_ATTRS` copied, inline text re-created verbatim,
     appended after the content, **no dedup and no cleanup — every `ok` update
     re-executes every script** (snippet's define-guard is what keeps the demo
     correct).
  3. Sanitizer and `allowScripts` are mutually exclusive in the runtime: sanitization
     runs first, so a configured sanitizer strips `<script>` before the re-creation
     pass sees it; the escape hatch works only raw-passthrough. The compiled
     `truc:html` path always passes `sanitizeHtml` (fail-closed, ADR 0002), so scripts
     never survive it.
  4. `allowScripts` has exactly one consumer in the corpus: `module-lazyload`. The demo
     page authors `allow-scripts`; `mocks/module-with-type.html` is a pure
     script-execution fixture.

  **Options discussed (no direction picked — rule, then record):**
  - **A. Registry pattern.** Behavior in partials = custom elements; the page
    pre-registers the tags its partials use; no script execution, no new mechanism.
    Fails the stated goal for genuinely build-unknown components and strains the
    code-splitting constraint (pre-registration means main-bundle weight).
  - **A′. Lazy registry.** A tag→chunk manifest; after a partial inserts markup, a
    loader fetches the unknown tags' component chunks and registers them —
    code-splitting native. Tension: the manifest is build-known; a partial bringing an
    unknown component needs a way to *declare* its components (a manifest beside the
    partial, fetched with it?) — that softening is part of the question, not settled.
  - **B. Policy-driven client loader.** The authored `allow-scripts` opt-in teaches the
    compiled `truc:html` a script policy running *inside* the sanitize step (mends
    finding 3): external-`src` re-created deduped by src, `type="application/json"`
    passthrough, `type="importmap"` refused, inline per policy. CSP cost: re-created
    inline scripts need `unsafe-inline` or a render-injected nonce.
  - **C. Arm-lifecycle execution semantics.** Orthogonal to B (foldable into its
    policy): scripts execute as arm effects — run on arm adoption, cleanup on arm exit,
    no re-execution on re-render. The compiler knows the arm boundary; the runtime
    never could.
  - **D. Build/serve-time extraction.** For same-origin partials the build can see, the
    server strips scripts and ships them as proper external, hashed module URLs; the
    client loads them as ordinary deferred scripts (CSP-clean, no `unsafe-inline`,
    browser-managed order and dedup). Genuinely dynamic URLs fall back to B/C.

  **Trust framing to carry:** no mechanism makes an untrusted script safe; sandboxing
  untrusted code is origin isolation (iframes), a different product. `allow-scripts`
  stays a page-author trust grant at the component boundary, origin-constrained per the
  goal. What a full-stack design adds over the runtime is hygiene and defaults, not
  safety.

  **Held state:** `shake-hands` stays broken until this rules (owner, 2026-10-06) — the
  lazyload demo shows it inert; do not paper over it with pre-registration (that is
  option A, and it strains the code-splitting constraint). The script-execution spec
  legs are this session's test input.

  **Exit:** rule the direction (an option, a combination, or a new one); decide whether
  it needs an ADR or an `ARCHITECTURE.md`/`HOST_PROFILE.md` record; write the
  follow-up implementation task — the one that transforms `shake-hands` from inert to
  alive per the ruled design — including the compiled-path wiring and the runtime
  binding's adoption of the same policy function (one policy, two hosts, no drift).
  Nothing in the lazyload track waits on this session.

  *Adopted from Le Truc LT-448, 2026-10-11. PLACEMENT FLAG FOR THE OWNER: the session's
  ground truth spans both repositories — the escape hatch and its spec legs are runtime
  code (Le Truc), the corpus fixtures and the compiled `truc:html` path are here. Which
  repository leads the session is an owner call; escalate before scheduling.*

- [ ] TC-046: Design session — lists too large to server-render at once, as HTML partials of item blocks loaded on demand (optimistically, as the user scrolls)
  **Area:** design
  **Context:** ADR 0025's key-alias harvest needs the server to render every item once
  (its render witness fails a partial render by design), and the owner rejected
  client-side rendering from a page-level data block (ADR 0025, Alternatives). For a
  dataset too large to render at once, the owner's direction is the HTML-first answer:
  the server renders the first blocks, and further blocks arrive as HTML partials
  fetched on demand, optimistically as the user starts to scroll.

  **Questions for the session:**

  1. **The data list's growth.** Items arriving in a partial are server-rendered markup
     after connect. ADR 0001 harvests at connect only, so does an arriving block
     harvest into the host-level list on insertion (a harvest-at-insertion rule), or is
     each block its own list? What about order and duplicate keys across blocks?
  2. **The fetch contract.** URL scheme per block (page index, cursor, key range), who
     owns it (a component attribute, an authored template, a server route convention),
     and how the partial is rendered: the compiled component's own render over a slice
     of server args, so that one render produces both the page and its partials?
  3. **Relation to existing machinery.** `module-lazyload`'s fetch-and-insert, the
     sanitize path, and TC-045 (partials that bring new components). Which of them
     carries this, and what does the sanitizer do to a partial's harvest sites?
  4. **The witness.** A partial is a render with its own scope. Does ADR 0025's witness
     apply per partial (every item of the slice rendered)?
  5. **Template targets** (ADR 0021): can a backend emit the partial route?
  6. **The probe component**: `module-ticker` past BLOCK_SIZE × N, or a new corpus
     example.

  Traces to REQUIREMENTS §3.5 (every pattern expressible), §5.2, §9.2.

  *Adopted from Le Truc LT-450, 2026-10-11.*

- [ ] TC-047: Key alias reached through an arm scope — let the client harvest walk into a live arm, or keep the LTC005 refusal
  **Area:** design
  **Context:** ADR 0025 s3 harvests "from every alias-scope root in document order,
  across all enclosing scopes", but the landed implementation reaches the alias roots
  through enclosing list items only. An alias scope behind a reactive conditional, an
  async boundary, a server-data loop or a composed child is refused with LTC005
  (`planKeyAliasHarvest`).

  **Problem:** a grouped view whose groups sit in an arm (a collapsed section, a tab
  panel) cannot use the key alias.

  **Better shape to decide:** the client path steps into the live arm root (`data-key`
  on the arm root, beside its `<template data-arms>`), proved unique by ADR 0023; the
  witness already covers an arm the server did not render. Open until a component needs
  it (ADR 0025: "Wider forms wait for a component that needs them").

  *Adopted from Le Truc LT-456, 2026-10-11.*

- [ ] TC-048: Lazy children in composed content — the reactive half of ADR 0026 s1's grant
  **Area:** design
  **Context:** ADR 0026 s1 grants a parent "structure, text, bindings and `first()`
  references" in the content it passes. Today the lowering substitutes compose content
  once, at compile time, into the child's `children` server arg.
  `validateComposedChildren` refuses any reactive child with LTC011 ("A lazy child
  (`{expr}`) in a composed element's content is not supported yet"), except an async
  boundary's catch parameter (the err-scope ruling). So a parent cannot pass live text,
  such as module-todo's `{() => item.label.get()}` per list item. The only live channel
  today is a pass-able prop beside the children.

  **Questions to settle before this becomes buildable:**

  - **Re-render:** how a lazy child in passed content updates through the substitution
    boundary, both at page level and per clone in a reactive list item (ADR 0024). The
    parent owns the content, so the parent's client binds it. The open part is how the
    parent's client addresses a text site inside the child's inserted region.
  - **Arms:** whether reactive conditionals in passed content become legal (arm
    emission inside a region the child inserts).
  - **LTC085:** its composed-component leg and the `interactive` flag once nesting is
    admitted.
  - **Channel/tier:** for whatever stays refused.

  **Not in scope:** interactive content and child-owned `id`/`for`, which stay the
  child's template (ADR 0026 s4).

  *Adopted from Le Truc LT-515, 2026-10-11 (filed at the owner's ask).*

- [ ] TC-049: AEM/HTL integration spike — ahead of pioneer 3, not during it
  **Area:** design
  **Context:** ADR 0012 s3 and its Bad consequence: AEM is a build-**integration**
  problem, not an emit problem. Component dialogs, the authoring model and clientlibs
  are undesigned, and the HTL emitter is the smallest part of it. Pioneer 3 is a client
  engagement, which is the wrong place to discover the shape.

  **Deliverable:** a spike answering how a compiler-emitted HTL partial reaches an AEM
  component, how clientlibs consume the generated client module and CSS, what the
  dialog/authoring model demands of the server-args surface, and what HTL's escaping
  contract requires that Twig's did not; the verdict written as tasks or as a recorded
  limitation. **Not release-gating for 3.0**, but scheduled well before pioneer 3
  commits.

  **Check:** the spike either produces the HTL target's task list or records, with
  reasons, that AEM needs something the current artifact set cannot give it.

  *Adopted from Le Truc LT-262, 2026-10-11 — the target-emitter interface this spike
  informs lives here (ADR 0021; Twig first via TC-021 → TC-023, HTL next).*

- [ ] TC-052: Dead-rule detection over the parsed stylesheet (ADR 0020 s1) — **Parked 2026-10-11**: ADR 0020 is ⏸️ on hold — the stylesheet checks "wait for real consumers" (REQUIREMENTS §7). Refine to open together with the ADR.
  **Area:** compiler
  **Context:** A rule under the component's own tag that matches **zero** elements of
  the rendered template warns: a typo, a renamed class, a rule left stale by a markup
  refactor. `matchesSelector`/`countForSelector` (`src/analysis/selectors.ts`) already
  answer it and are load-bearing for the branch-root collision check. **Channel
  compiler, tier 2 Contained**: light-DOM markup is not closed, so the check must
  **exempt** any subtree holding a compose node or `dangerouslyBindInnerHTML`, exempt
  `::slotted` and reaches into composed children, and respect the deliberate widening
  of class matching for page-authored enhancement. An over-eager version is worse than
  none. (The selector-prefix half of the original task was superseded by the ADR 0011
  ruling pre-split.)

  **Coordinate with the probe work:** `css-select` + `parse5` are pinned dependencies
  (ADR 0023), so do not hand-roll a CSS matcher.

  **Acceptance:** a fixture whose stylesheet names a class no element carries warns; a
  fixture with a compose site or `dangerouslyBindInnerHTML` in the matched subtree does
  **not** warn; the compile-warning baseline holds.

  *Adopted from Le Truc LT-214, 2026-10-11; gated on ADR 0020 leaving hold.*

- [ ] TC-054: Split `@zeix/le-truc-simulation` out of the compiler package — a later 3.x, once the seam has a consumer — **Parked 2026-10-11**: deliberately not a 3.0 deliverable (ADR 0013 s4) — a third npm name and release process on a release already gated on external projects. Refine to open when the seam has a consumer.
  **Area:** compiler
  **Context:** ADR 0013 s4. With the simulation seam in place (`src/simulation/
  contract.ts`, the DOM-free seam with `seamVersion`) the substrate can ship as its own
  package, so activation is installation: present or absent, no configuration flag, no
  dynamic import, no degradation path threaded through the compiler. Deliberately
  **not** scheduled for 3.0 — a third npm name, release process and changelog on a
  release already gated on two external projects (ADR 0012 s6), against a saving of
  ~50 KB of JavaScript over the optional peer dependency, since jsdom is the weight and
  an opted-out consumer never installs it either way.

  **Deliverable:** the package, an exact-range peer on `@zeix/le-truc-compiler`, and a
  CI matrix — the substrate executes *generated client modules*, so the two-phase
  load/render contract, the `define()` recording, the children-first compose ordering
  key and the emission shape all cross the boundary and the pair is in permanent
  version lockstep. **jsdom must be a regular `dependency` of the new package, not a
  devDependency** — a devDependency is not installed for consumers.

  **Check:** a consumer project installs the compiler alone and builds green with
  Simulated components routed Static; adding the substrate package alone re-enables the
  tier with no config change.

  *Adopted from Le Truc LT-264, 2026-10-11.*

- [ ] TC-055: Typed custom-property seam — `@property` registration derived from the signal's type (ADR 0020 s2) — **Parked 2026-10-11**: ADR 0020 is ⏸️ on hold, and the gate is a real consumer — `bindStyle`/`setStyle` appears **nowhere** in the corpus or the docs components, so this must follow a use, not precede one.
  **Area:** compiler
  **Context:** `bindStyle` (a Le Truc runtime helper) takes `string`, so every value
  crossing from a signal into CSS is stringly-typed at exactly the point where both
  sides are known at compile time — `src/infer-type.ts` has the signal's value type and
  the stylesheet is in the same corpus input. Where a signal drives a custom property,
  check the two agree and emit `@property --x { syntax: '<number>'; inherits: false;
  initial-value: … }`, which hands enforcement to the browser too
  (invalid-at-computed-value-time instead of a silently dead declaration) and brings
  interpolation and animation along. **The hard part is the syntax, not the plumbing:**
  `inferType` returns only `string`/`number`/`boolean`/`unknown`, and `<length>` vs
  `<number>` is precisely the distinction CSS makes and TypeScript does not — so infer
  the syntax from the **CSS side**, where the property is consumed (`width: var(--w)`
  implies `<length>`), reusing the parsed sheet rather than inventing author-facing
  branded types. Channel: compiler; **tier 2 Contained** for the TS↔CSS disagreement,
  with the emitted registration carrying the runtime half.

  **Check:** a fixture whose numeric signal drives a `<length>` property warns; the
  emitted `@property` block round-trips through the equivalence audit.

  *Adopted from Le Truc LT-269, 2026-10-11; gated on ADR 0020 leaving hold and on a
  real consumer.*

- [ ] TC-056: Typed style handle — stage 1 of style composition (ADR 0020 s3) — **Parked 2026-10-11**: ADR 0020 is ⏸️ on hold — recorded direction awaiting real consumers; refine to open with the ADR.
  **Area:** compiler
  **Context:** ADR 0011 s6 parked the whole composition package on TSRX 1.0 because
  `.tsx` "has no such construct". That holds for **standalone** blocks only — a
  `<style>` in a children list with raw CSS as template syntax, which JSX cannot spell
  and which Le Truc wants least anyway (one tag-scoped sheet per component leaves
  sibling-scoping no role). **Assigned blocks** (`const theme = <style>{css`…`}</style>`)
  and `class={theme.dark}` are ordinary TSX, and that is where the anti-drift property
  lives: the class map is minted from the sheet the compiler parsed, so `theme.dark`
  cannot name a class the sheet does not define — a typo becomes a compile error
  instead of a silently dead class. **Stage 1 is the whole benefit with none of the
  machinery:** `theme.dark` lowers to the literal `"dark"`, emission stays verbatim,
  output stays byte-identical, no hashing and no selector rewriting. The one real
  surface change is accepting a `<style>` in **setup** position — today the sheet must
  be a `<style>` child of the root (REQUIREMENTS §7) — and `.tsrx` must accept the same
  spelling or the two front ends drift (ADR 0010 s6). **Stage 2 (`apply={theme}`,
  several sheets merged, selectors regenerated into `my-element .dark` /
  `:host(.dark)`) stays backlogged on the original terms** — that is where ADR 0011
  s6's "CSS must be generated" cost actually sits.

  **Check:** a fixture naming a class absent from its own sheet fails the build; corpus
  output byte-identical; both front ends accept the same spelling.

  *Adopted from Le Truc LT-270, 2026-10-11; gated on ADR 0020 leaving hold.*

- [ ] TC-057: A dev-mode signal inlined into generated client code, and the dev drift assertion it enables — **Parked 2026-10-11**: FIT UNRESOLVED — the owner rules. The idea's plumbing starts in the Le Truc build (its docs bundle defines `DEV_MODE`), the assertion is runtime `DEV_MODE` code, and neither the closed fold inputs nor the diagnostics contract demands it. Adopt into REQUIREMENTS, keep in the sibling, or drop.
  **Area:** compiler
  **Context:** A 2026-08-29 architecture decision at the source repo: generation-time
  inlining. The compiler gains a `devMode` input from the build pipeline and INLINES the
  folded constant into generated client modules (generated code must never reference
  `process.env` — bundler-agnostic, constant-folded at generation, same philosophy as
  the library's own `--define`). With that signal in place, the drift assertion (the
  sibling checklist's §6 idea): on upgrade, recompute each folded expression and
  `console.warn` on mismatch — emitted only under the generation-time dev flag and
  folded away entirely otherwise. A dev-only guard that the server render matches the
  source, useful while hand-authored pages drift from compiled output.

  **Conflict noted (owner rules):** no REQUIREMENTS section demands a dev mode or the
  assertion, and the runtime half (the `DEV_MODE` warn on upgrade) is Le Truc
  repository code. The compiler-side half alone is a `devMode` config input plus one
  folded constant per module.

  *Adopted from Le Truc LT-076, 2026-10-11, parked pending the fit ruling.*

- [ ] TC-058: Conditional branch tree-shaking — omit an arm template the client can never select — **Parked 2026-10-11**: a performance optimization no requirement demands (a re-pinned premise confirmed the unconditional behavior is already safe). Wakes on owner direction or a size-driven consumer ask.
  **Area:** compiler
  **Context:** Performance optimization, not a bug fix (the early safety analysis
  confirmed the current unconditional behavior is safe). With template-cloned arms
  (ADR 0015) every arm ships as a template and the client clones on demand; the
  question is only whether to omit an arm template (and its mount) the client can never
  select. That needs a new usage-graph analysis: shake only when the resolved value is
  read nowhere outside its own arm AND the guarding promise depends solely on
  server-definitive args. The premise moved since filing: the async boundary's corpus
  consumer is `module-lazyload` (the Task-only fold), so build fixtures against it.

  **Channel/tier:** none — emission-only dead-code elimination; no diagnostic.

  **Check:** a shaken fixture's client carries no template for the unreachable arm; the
  server render and the equivalence audit are unchanged; goldens re-pin only where an
  arm template genuinely drops.

  *Adopted from Le Truc LT-078, 2026-10-11.*
