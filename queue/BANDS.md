# Backlog

Every task not named by the current iteration's chain. The Architect bands
work here (`band: P1`…`P7`, lettered sub-bands as needed); an open, unbanded,
unchained task shows up as a note in `bun run check:queue`. A `parked` task
stays here until the Architect and the owner refine it back to `open`.

## P1 — committed next

The v3.0 emission track: template emission against the ruled target-emitter
interface (TC-021 → TC-022 → TC-023, ADR 0021).

## P2 — soon

The two-repo machinery and the release program: CI, branch protection and the
publish path (TC-025); the 2.x codemod design (TC-050, held in `design` until the
owner rules its drift-cost metric).

## P2b — Compiler product-readiness

The equivalence contract between the authored surfaces, the diagnostics and the
shared walks: TC-024 (boundary-arm construct parity), TC-026 (the census names the
compose edge), TC-027 (the shared estree walk hardened), TC-028 (the `.tsrx`
client-stmt name check converged); the parked TC-053 (`magic-string`, demand-gated).
Standing rule carried from the source repo's review: adopt a maintained library
where one exists instead of authoring version twelve; memoising the redundant estree
traversals and restructuring `sim/` stay declined, so future reviews do not
re-propose them.

## P3 — later

Latent correctness and diagnostic-precision items, independent of the release track
and of each other. The one ordering rule inside the band is TC-030 after TC-029 (the
`internals` routing builds on TC-029's reverse IDL name table); everything else is
freely pickable and safe to interleave with any band: TC-031, TC-032, TC-033.

## P4 — Migration guards for 2.x authors

Guards for hand-written 2.x components migrating to 3.0: TC-034 (flag a non-void
factory return — authored-surface rule plus the `DEV_MODE` warning, whose runtime
half is Le Truc-repository work). The band grows only if migration feedback surfaces
new sharp edges — deliberately small, so it never competes with the emission track.

## P5 — Migration-review residue

Compose-site and setup-const ergonomics the wave-4 example migrations surfaced:
TC-035, TC-037, TC-039, TC-040, and the band's one design session, TC-043 (reactive
attributes on the component root — an ADR 0005 s3 check and an owner ruling before
any implementation).

## P7 — Backlog (not scheduled)

Owner-parked designs, explicit 3.0 non-goals, and items gated on a real need. The
setup-const cluster's outer halves TC-036 and TC-038 sit here (with TC-037 they run
as one contributor's sequence, chained by `needs:`), beside TC-041 and TC-042. The
design-session family holds TC-044 → TC-049 (owner-timed). Gated-on-need items (TC-052,
TC-055, TC-056) wake when ADR 0020 leaves hold or a consumer appears; TC-054,
TC-057 and TC-058 move only by owner direction.
