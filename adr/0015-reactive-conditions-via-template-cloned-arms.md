# ADR 0015: Reactive Conditions — Conditional Arms as Template-Cloned Branches

## Status

✅ Accepted — 2026-10-10, adopted from Le Truc [ADR 0037](https://github.com/zeixcom/le-truc/blob/main/adr/0037-reactive-conditions-via-template-cloned-arms.md) (✅ Accepted there; accepted here at the REQUIREMENTS.md consolidation). Amends Le Truc ADR 0017 (the primitive's record — its emission consequences here are ADR 0004), ADR 0005, ADR 0008, ADR 0009, ADR 0010 and ADR 0012 (see Related); s5 amended by ADR 0024.

## Context

The compiler denies signal reads in every control-flow condition on both surfaces — `@if`/`@switch` tests and `.tsx` ternary/`&&` tests alike. The diagnostic's own message names the reason: "the DOM keeps the initially rendered branch, so a signal condition would silently stop matching."

The denial contains a real trap, but the trap is a property of *toggled* semantics, not of the syntax: one branch's DOM exists, and a flipping condition has nothing to switch to. Upstream, the two signals-based host profiles that render at least once on the client treat conditions over signals as legal (Octane, render-scope re-run) or idiomatic (Solid, create/dispose control flow). Identical authored syntax thus carries three different contracts across profiles. That is the confusion the upstream questions in `HOST_PROFILE.md` ("Branch DOM lifetime") demand each profile declare its way out of. Keeping the denial makes Le Truc the profile whose contract only the compiler knows. Owner ruling: legalize the syntax and give it Le Truc semantics.

## Decision

Conditions over signals are legal on both surfaces. Their arms are **template-cloned branches**: created from an inert `<template>` when the condition turns true, disposed when it turns false (the `reconcile()` precedent — the emission contract: ADR 0004; the primitive's record: [Le Truc ADR 0017](https://github.com/zeixcom/le-truc/blob/main/adr/0017-keyed-template-clone-reconciliation-for-lists.md)). They are not simultaneously rendered arms toggled via `hidden`.

1. **Legality and lowering.** A condition that reads a signal (`@if`/`@else`, `.tsx` ternary/`&&`, IIFE switch, `@switch`/`@case`) lowers as follows. Each arm is extracted to an inert `<template>`; client-written sites inside a *losing* arm's template bake **empty** — carrying the server's current value would flash stale state on every later clone — while server-known content bakes and the live winner keeps its values. The server folds the condition's **initial** value through the existing fold rules (every tier) and renders only the winner live beside the inert templates. The client lowers to `reconcile()`'s **arm form** over a reactive **current-arm-key source**: a thunk `() => string | null` — `null` is the no-current-arm state — plus an iterable of the arm templates, told from the list forms by the thunk. Forcing conditionals through the per-item list machinery would buy dead weight; the arm form is `reconcile()`'s only runtime addition. **Static (server-known) conditions are unchanged**: the Folded tier still renders the single winner and omits the rest, with no templates and no client construct. Byte-identity across tiers and the zero-warning baseline are untouched.

2. **Arm keys are named, compile-time constants.** Keys come from the construct's own vocabulary: `then`/`else` (ternary, `@if`/`@else`), `default` (`@switch`'s default arm), `case:` + the literal's JSON (`@switch`/`@case` — literals are the JSON scalars `string | number | boolean | null`, negatives included; a dynamic or duplicate case value is a compile diagnostic, no fallback), and `ok`/`nil`/`err` (the boundary, sub-design 4). The JSON names the key; the runtime comparison is `===`, and the serialization says what `===` says: `@case 1` and `@case '1'` are distinct, `@case 1` and `@case 1.0` share one. Server emit and generated client derive the same constant, which is what makes adoption work: the first reconcile run recognizes the server-rendered winner by key membership (the reconcile contract, ADR 0004). The key strings are a stable HTML contract — pinned in REQUIREMENTS §3.5 — so under partial deploys a cached page's HTML and a fresh client bundle agree on the mapping even after an arm's *content* is edited: identity is structural, not derived from content. Rejected: content hashes (an arm edit changes the hash, so every cached page adoption-misses and flash-reclones) and bare integers (fragile under arm reordering, opaque in the DOM). An arm set is a compile-time structural fact, not data; when identity is static, name it.

3. **Arm content owns its effects.** Per-arm mounts run under the keyed-scope discipline ([Le Truc ADR 0014](https://github.com/zeixcom/le-truc/blob/main/adr/0014-keyed-per-element-scopes-for-memo-collections.md); stays in Le Truc) with collector parity. `watch()`/`on()`/`pass()` are usable inside an arm; mounts are created on enter and disposed on leave (teardown-before-setup). The existing guarded emission (single-branch `@if`, effects under an existence guard) generalizes to per-arm mounts. Arms never re-render their content: a re-entry clones the server-baked template again. The only live writes are the boundary's value/error text (sub-design 4).

4. **The boundary switches to the same mechanism.** `@try`/`@pending`/`@catch` arms become templates plus adopted winner, keyed `ok`/`nil`/`err`. This retires machinery that exists only because both arms are live simultaneously: the fieldset wrappers at every arm root, the client's `hidden` + `disabled` sweep, and the fieldset-era `.parentElement` addressing (the fieldset existed to make disabling cheap). The ok arm's resolved-value text and the err arm's bound catch-param text move into the per-arm mount. The no-stale-arm ruling and the reactive `isPending` idiom are untouched. By that ruling boundary flips are rare, so re-clone cost is negligible.

5. **Scope rules.** An arm set sits directly in an element — not in composed content, not in a reactive list's container, not in a server-data loop body (diagnostic; channel compiler, Prevented); it nests inside arms and list items, both Mount Scopes (ADR 0024). Each arm has exactly one root element; a host-level `first()` does not resolve into an arm (the root is recreated on every flip). Arm templates inherit `@for`'s extracted-template container hygiene; this is pinned at implementation, not new machinery. `@for`'s `@empty` arm stays on the toggle path: it shares the item container's key namespace, and joining the keyed space buys nothing. A condition whose initial value is unresolvable in every Evaluation Tier (ADR 0008 sub-design 1) has no server-pickable winner. Unresolvability is a routing signal through the fold-refusal origin (ADR 0008 s5's list), never a guess: a test whose seed is not render-scope-resolvable — a Parser-backed prop whose instance is not re-declarable in render scope — routes the site off the host-derived fold. What remains unanswerable in every tier renders no live arm: the author supplies the default; the compiler does not guess.

## Alternatives Considered

- **Toggled arms (the boundary precedent generalized)**: resurrects the duplicate-`id`/duplicate-`name`/double-submit class the boundary emitter already fights with fieldsets and sweeps. Never-shown arms' nested components upgrade eagerly at connect. And the client semantics would *diverge* from Solid/Octane's create/dispose for the one construct being legalized. Toggled remains available where state-preserving arms are wanted: `hidden={() => …}` thunks, and the boundary until its migration.
- **Keeping the denial**: upstream pressure (identical syntax legal or idiomatic in the other signals hosts) plus the host-profile declaration demand make silent divergence the expensive outcome. The diagnostic's own message concedes the trap is in the old semantics, not the syntax.
- **Content-hash or integer-suffix keys**: rejected per sub-design 2.
- **A `Signal` as the arm-key source**: cause-effect signals hold no `null`, so the source could never return the none-state that non-exhaustive arm sets (`@if` without `@else`) carry. A thunk subsumes it (`() => signal.get()`), and the arm form is compiler-emitted, where one canonical source shape keeps the emitted contract tight. Accepting a non-nullable `Signal` for exhaustive sets stays available as an additive widening.
- **A heuristic choosing toggled vs cloned per arm**: one lowering with fixed semantics is preferred; the project's precedent is explicit over clever.

## Consequences

**Good:**

- The sanctioned subset gains client-side conditional rendering with one small runtime addition — `reconcile()`'s arm form, dispatched on the already-exported function — so the bundle-budget impact is bounded and checked at implementation.
- Duplicate-identity hazards (ids, form names, `for`/`aria` references, double submission) are structurally impossible for conditional arms; the boundary sheds its fieldset machinery.
- This host's branch-DOM-lifetime answer converges with Solid's (create/dispose), while the two-artifacts, no-state-shipped posture is untouched. The upstream declaration story gains an answer instead of an exception.
- `@else` already exists in the TSRX grammar — no upstream ask.

**Bad / accepted tradeoffs:**

- Le Truc now creates DOM from conditions as well as from lists — Le Truc ADR 0017's "bounded exception" widens (amended there; the emission consequences: ADR 0004).
- Uncommitted input state inside an arm is destroyed on flip. This matches Solid/Octane semantics; preservation remains available via toggle-shaped constructs.
- Adoption is the historically bug-prone seam. The equivalence audit's connect-diff classes grow (initial arm state is a new designed class), and the boundary migration churns every boundary-using component's goldens.
- The old condition diagnostic retires and new codes arrive, so the ADR 0007 error-message lifecycle runs; Writer owns final copy.

## Related

- Requirements: §3.5 (control flow — where the arm-key contract is pinned), §5.2 (tiers) — traces finalized at the consolidation
- Architecture: `ARCHITECTURE.md` §5.1 (server evaluation); list reconciliation
- Authority: Le Truc ADR 0037 (linked above)
- Amends: [Le Truc ADR 0017](https://github.com/zeixcom/le-truc/blob/main/adr/0017-keyed-template-clone-reconciliation-for-lists.md) (the DOM-creation exception widens to conditions; `reconcile()`'s arm form — the primitive's record; emission consequences: ADR 0004), ADR 0008 (arm extraction + initial arm state in the fold and the audit; the unfoldable-test routing signal joins s5's list), ADR 0005 (template extraction gains arm templates), ADR 0009 (`t` inside an extracted arm body is a build-time constant, per the template-baking precedent), ADR 0010 (parity covers reactive conditions), ADR 0012 (template emission carries a reactive condition as a backend conditional beside the inert arm templates, per ADR 0021)
- Related: [Le Truc ADR 0014](https://github.com/zeixcom/le-truc/blob/main/adr/0014-keyed-per-element-scopes-for-memo-collections.md) (arm-mount ownership; stays in Le Truc), ADR 0007 (diagnostic lifecycle), ADR 0001 (the client corrects at connect, arms included)
