# Iteration 2 — Pin the hand-copied rules, deduplicate the emitters and setup

Planned 2026-10-10, from the architecture review's third concentration:
hand-copied rules that must never drift — between passes (the
watch-attribute dispatch, the selector adapters, the form-control tag
table), between emitter sites inside `emit-server.ts`, and between
setup-extraction's twin loops. Iteration 1 restored the gates that prove
every one of these tasks behavior-neutral (the corpus gate, the goldens)
and stabilized the analysis tree they touch (the import cycles, the
effects split) — which is why the dedup runs now: every task in this
iteration is byte-identical output by goldens.

**Next free task ID:** TC-013

**Rulings.**

- 2026-10-10 — Iteration scope set with the owner: the emission track
  (TC-006 → TC-007) and the setup dedup (TC-008) form the core; TC-009
  (the `planHarvests` carve) is sequenced behind TC-006 as a hard
  prerequisite — its selector-adapter closures dissolve into TC-006's
  helper rather than becoming promoted functions — and TC-012 (the demo
  corpus type-check) rides along as a small independent track, added by
  the owner. Design work stays outside the chain: the TC-003 remainder
  (the 0024 port, the citation sweep, the REQUIREMENTS rework), the
  css-scope/sim review (TC-010), and TC-011 until the owner rules its
  shape.

**The chain.**

- **Track 1 — Pin the hand-copied rules.** The watch-attribute dispatch
  rule, the selector-adapter closures and the form-control tag table
  exist as hand-copied copies nothing enforces against drift; one body
  each, every call site pointing at it. In pick order:
  1. TC-006 — Pin the hand-copied emission rules (dispatch, adapters, vocabulary)
  2. TC-007 — Deduplicate emit-server.ts and route serverTestExpr through initialFold
- **Track 2 — Straighten setup extraction.** The component loop and the
  item loop classify the same grammar through five copy-pasted
  fragments:
  1. TC-008 — Unify setup-extraction's twin loops
- **Track 3 — Carve the largest function.** `planHarvests` is one
  ~877-line function of twelve closures — modules without interfaces;
  behind TC-006, whose helper dissolves the selector-adapter closures
  first:
  1. TC-009 — Carve planHarvests into named stages
- **Track 4 — Demo corpus hygiene.** The board's corpus gets the type
  gate the examples corpus already has:
  1. TC-012 — Type-check the demo corpus
