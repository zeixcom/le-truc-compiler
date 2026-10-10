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

**Next free task ID:** TC-059

**Reserved diagnostic codes:** LTC057, LTC058 and LTC090 are TC-021's (template
emission's shared walk); the next free code after those is LTC091.

**Rulings.**

- 2026-10-11 — Adopted the Le Truc queue's remaining compiler tasks to this
  repository's backlog (owner request): 38 entries, TC-021–TC-058, adapted from the
  source tickets the split's planning had earmarked for this tracker (the setup-const
  cluster, the estree-walk and client-stmt hardenings, the emission chain, the
  boundary parity, and the backlog bands). None is chained — iteration-3 planning
  still waits per the standing instruction. Placement calls and conflicts are
  escalated to the owner with the adoption report; the parked entries (TC-051,
  TC-052, TC-053, TC-054, TC-055, TC-056, TC-057, TC-058) refine to `open` only
  through the Architect and the owner.

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
- 2026-10-10 — Chain positions are first-mention: only a track's
  pick-order list names positions, and a prose citation of another chain
  task is not one — prerequisites ride the task's `needs:`. (Track 3's
  citation of TC-006 parsed as a second position and ghosted the board.)

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
  sequenced behind Track 1, whose lead task's helper dissolves the
  selector-adapter closures first:
  1. TC-009 — Carve planHarvests into named stages
- **Track 4 — Demo corpus hygiene.** The board's corpus gets the type
  gate the examples corpus already has:
  1. TC-012 — Type-check the demo corpus
