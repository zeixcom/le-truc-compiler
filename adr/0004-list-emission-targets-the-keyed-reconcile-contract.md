# ADR 0004: List Emission Targets the Keyed Reconcile Contract

## Status

✅ Accepted — 2026-10-10. Adopts Le Truc
[ADR 0017](https://github.com/zeixcom/le-truc/blob/main/adr/0017-keyed-template-clone-reconciliation-for-lists.md)
as the decision's record of authority: `reconcile()` is the runtime's one
data-driven DOM-creation primitive — keyed template cloning, one-way
data→DOM sync, adoption of server-rendered keyed children on first run.
This ADR states what emitting toward it commits the compiler to.

## Context

A reactive-list `@for` produces markup and client code that the runtime
will key, position, adopt, and dispose against. The emitted output is
correct only if it satisfies the reconcile contract exactly — the runtime
does not adapt to emission; emission adapts to it. The contract's
attribute vocabulary (`data-key`, `data-unreconciled`) is permanent
public surface, and this compiler adds `data-list` on top.

## Decision

1. **One lowering.** A reactive-list `@for` lowers to exactly one
   extracted `<template>` (single root by construction) plus a
   `reconcile()` call — and only declared `createList(…)` / `deriveList(…)`
   sources lower; any other reactive source is refused and the file is
   skipped (`src/diagnostics.ts`).
2. **Permanent markup contracts.** Item roots carry `data-key`; the
   hoisted list template is stamped `data-list="N"`, its compile-time
   document-order index (LT-423; ADR 0024 s2), so repeated and sibling lists
   share no selector.
3. **Adoption stance.** The first run adopts server-rendered keyed
   children as-is; the emitted client never reads item data back from
   the DOM. This is consequence 1 of ADR 0001 applied to lists.
4. **The `@empty` arm is compiler-owned on both attributes.** Its roots
   are server-rendered inside the container carrying `data-unreconciled`
   — exempt from reconciliation — and the client toggles their `hidden`
   from the list's length (LT-212; ADR 0015 s5). An authored `hidden` or `data-unreconciled` on such a
   root is refused (LT-301), since the compiler sets that attribute
   itself (`src/analysis/plan.ts`, `src/lower-shared.ts`).

Channel and tier (ADR 0007):
both the source restriction (decision 1) and the authored-attribute
refusal (decision 4) are compiler checks, tier 1 (Prevented).

## Consequences

**Good:**

- DOM creation stays the runtime's single bounded primitive; emission
  grows no reconciler of its own.
- The markup contracts are golden-pinned: a wrong stamp is a wrong
  component, caught by the corpus check rather than discovered in
  production.

**Bad / accepted tradeoffs:**

- Three permanent attribute contracts are baked into every list-bearing
  output; renaming any of them is a breaking emission change.

## Related

- Requirements: §3.5 (Control flow), §9 (Output: HTML)
- Authority: Le Truc ADR 0017 (linked above)
- Ours: ADR 0001 (DOM is truth — the adoption stance)
