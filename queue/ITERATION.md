# Iteration 3 — Template emission begins: the operation layer and the dump target

Planned 2026-10-11 with the owner. Template emission is the v3.0 requirement on
pioneer 2's critical path (ADR 0012 s3), and iteration 2 deduplicated the emitters
it builds on (`emit-server.ts`'s shared helpers, the pinned dispatch and adapter
rules). The iteration builds ADR 0021's shared walk and proves it against SSG
through the test-only dump target, with no public surface yet. Twig (TC-022) and
its PHP CI job (TC-023) follow in iteration 4. Two small tracks ride along: the
contributor half of CI (TC-025), which TC-023 needs, and two gate-hygiene fixes.

**Next free task ID:** TC-064

**Reserved diagnostic codes:** LTC057 and LTC058 are TC-021's; LTC090 is
TC-059's. The next free code after those is LTC091.

**Rulings.**

- 2026-10-11: TC-021 is split into four serial tasks (owner). TC-021 is the
  operation layer, the portable-subset walk, the census routing and the dump
  target. TC-059 is the boundary, TC-060 reactive lists, TC-061 children
  capture. They form one track, not three parallel ones: each extends the same
  walk and the same dump interpreter, and parallel branches would conflict.
  TC-022 needs all four.
- 2026-10-11: The template target stays internal this iteration (owner). It is
  an optional internal options argument on `compileCorpusFiles`, not a
  `CorpusConfig` field, so `check:contract` stays unchanged. The public field
  and the partial output layout are decided with TC-022.
- 2026-10-11: TC-025 covers the contributor's half only: the workflows, the
  publish workflow with a dry run, the README lockstep note and the prepared
  required-check list. Branch protection, the npm secret and the first publish
  stay owner acts. CI running `check:demo` on every push answers half of
  TC-012's carried obligation (the ledger's iteration-2 note). Whether
  `AGENTS.md` cites it stays open with the owner.
- 2026-10-11, TC-021 review (owner): The sibling template walk is accepted as a
  tested, temporary gap. TC-062 (design, after TC-061) designs merging
  `emit-server.ts` into the walk. TC-063 (design) rules on optional chaining
  in the subset and on the URL context's allowlist. TC-022 needs both, so
  neither blocks Track 1. Each of TC-059–TC-061 keeps the dump byte
  comparison exhaustive over the constructs it adds.
- 2026-10-10 (carried): Chain positions are first-mention. Only a track's
  pick-order list names positions. A prose citation of another chain task is
  not one, and prerequisites ride the task's `needs:`.

**The chain.**

- **Track 1 — Template emission: the shared walk.** ADR 0021's operation layer
  and portable-subset walk, proven byte-identical to SSG through the dump
  target. Then each construct that needs its own operation semantics, in pick
  order:
  1. TC-021 — The operation layer, the portable-subset walk, the census routing and the dump target
  2. TC-059 — The boundary operation, the boundary fixture, LTC090
  3. TC-060 — Reactive lists and nested loop sources
  4. TC-061 — Children capture and the `owner` arg
- **Track 2 — CI.** Nothing enforces the gates on a push yet. TC-023's PHP job
  lands on this workflow next iteration:
  1. TC-025 — CI workflows, publish dry run, lockstep note
- **Track 3 — Gate hygiene.** Two small tooling fixes, both on the fast track:
  1. TC-013 — check:corpus refuses a root le-truc.config.json
  2. TC-014 — Wire check:portability
