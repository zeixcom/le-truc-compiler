# Done

The compaction ledger. When the Architect prunes consumed tasks after a
changelog pass, rulings with no other home land here under a dated note. A
TC-ID this file mentions satisfies a `needs:` prerequisite, which is how a
compacted task keeps its dependents pickable.

**Compaction policy.** An approved task is compacted in place (`status:
reviewed`) until the iteration's changelog is recorded; then its file is
deleted and its durable rulings carried here.

- 2026-10-10 — Iteration 1 pruned after the changelog pass: TC-001, TC-002
  (the gates bullet in `CHANGELOG.md [Unreleased]`), TC-004, TC-005
  (byte-identical refactors, judged internal). Durable ruling carried from
  TC-002's review: tooling that references the sibling `le-truc` checkout
  locates it by an upward walk from ROOT keyed on the manifest name
  `@zeix/le-truc` — a literal `join(ROOT, '..', 'le-truc')` is
  main-checkout-shaped and breaks gate runs from task worktrees. The
  analysis dependency-shape rulings live on in `ARCHITECTURE.md` § 3 and
  the `src/analysis/` module headers.
