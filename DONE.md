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

- [x] TC-021: Template emission — the operation layer, the portable-subset walk, the census routing and the test-only dump target (ADR 0021) — reviewed ✓
  **Area:** compiler
  **Gates:** typecheck, test, check:contract
  **Changed:** This lands template emission's operation layer and changes no public
  contract. `src/template/operations.ts` holds the `TemplateOp` union: text, hole, segment
  list, message, conditional, loop, include and arm template, plus boundary and list
  template, which are declared but not emitted yet. It also holds the eight-member
  `EscapeContext` and the internal `TemplateTarget`. `src/template/portable.ts` classifies
  holes into the portable subset. `src/template/walk.ts` (`walkPartial`) assigns escaping
  contexts, refuses positions and records routing. `compileCorpusFiles` takes an internal
  third argument, `CorpusRunOptions { templateTarget }`, and runs the walk only when that
  option is set. A run with a target returns the partials and a `template` census
  (`templateCensus`). The census routing rows are `non-portable initial`, `synchronous
  try`, `key-alias harvest`, `not yet emittable` (async boundary, reactive list, children
  at a compose site) and `simulated tier`/`static tier`. New diagnostics, both in the
  compiler channel at tier 1 Prevented and only with a target configured: LTC057 (a hole
  outside the portable subset; the `Intl` face names the ICU fix) and LTC058 (a hole in a
  refused position). Supporting changes: `HtmlWriter<E>` is generic, `ComponentParam`
  gained `binding`/`defaultValue`, `CompiledComponent` gained `ir`, `localeMessages` was
  added to `i18n-catalog.ts`, and `src/icu/client-record.ts` is shared by the runtime and
  the walk. The test-only dump target is `tests/targets/dump.ts`.

  **Review:** Approved 2026-10-11, with no nits. Gates re-run by the reviewer: typecheck,
  `tests/template-emission.test.ts` (68 pass), `check:contract`. Rulings (owner, from the
  NOTES entry):

  1. **The sibling walk is accepted as a tested, temporary gap.** `walk.ts` copies
     `emit-server.ts`'s decisions, and the dump-target byte comparison holds the two in
     step. Merging them is TC-062 (design), and TC-022 needs it. TC-059–TC-061 extend the
     walk meanwhile. Each must keep the byte comparison exhaustive over the constructs it
     adds.
  2. **Children at a compose site routes `not yet emittable`.** This is accepted, and
     TC-061 retires the reason.
  3. **The subset edges are accepted:** const substitution, literal folding, no computed
     members. Whether optional chaining joins the subset is TC-063 (design, together with
     the URL-context question below), and TC-022 needs it.

  Handoffs:

  - To TC-063: the URL context passes values through as SSG does, because the fold
    rejects no protocol. That makes TC-022's "safe-protocol allowlist as a Twig check"
    contradict ADR 0021 s3's "reject exactly what the fold rejects".
  - To TC-022: a literal hole stays a hole, because the runtime's `esc` and `HtmlWriter`'s
    static escaping differ on `'`.
  - To the iteration's `writer` pass: the LTC057/LTC058 copy. The LTC058 `name` face has a
    builder but no site, since the IR carries only static names.
  - In a fresh worktree, run `build:corpus` before the full suite, because
    `tests/tsx/typecheck.test.ts` needs the generated `tsrx-imports.d.ts`.
