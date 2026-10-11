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
- 2026-10-10 — Iteration 2 pruned after the changelog pass: TC-006, TC-007,
  TC-008, TC-009 (byte-identical refactors, judged internal — the changelog
  carries TC-012's two user-visible additions), TC-012. The kept-pieces
  rulings from the dedup track live in `ARCHITECTURE.md` § 3 and the
  module headers (`effects.ts`'s forwarding adapters stay the
  fx-parameterized export surface; the LT-122 synthesized-mirror branch
  keeps its own dirty-flag call; the client-only gate stays two mechanisms,
  contract documented on both gates). Open obligations carried from TC-012,
  awaiting an owner ruling: whether `check:demo` also runs as a standing
  test (nothing in `bun test tests` runs it — demo type drift is caught
  only when a contributor runs the demo gates), and whether `AGENTS.md`'s
  board paragraph cites it.
- 2026-10-11 — Planned consumers (owner), the context for template-target and
  boundary decisions. Each one needs server-seeded async boundaries sooner or
  later. Components that need one may wait for the design, but the general
  form is settled before 3.0 is published (no breaking change from a
  half-designed form).
  1. An SSG site whose client calls a PHP-based API. This is the first
     confirmed consumer.
  2. A Craft CMS project with Twig templates.
  3. A future AEM backend with HTL templates, whose client-side apps are Vue
     components today.
  4. A site that is SSG with Handlebars templates today, ported by hand to AEM
     with HTL templates.
