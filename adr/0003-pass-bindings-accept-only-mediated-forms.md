# ADR 0003: Pass Bindings Accept Only Mediated Forms

## Status

✅ Accepted — 2026-10-10. Adopts Le Truc
[ADR 0012](https://github.com/zeixcom/le-truc/blob/main/adr/0012-deprecate-unrestricted-write-short-forms-in-pass.md)
as the decision's record of authority: the unrestricted-write short forms
of `pass()` (property key, bare writable signal) were deprecated in 2.2
and removed in v3.0 — a thunk or a `{ get, set }` descriptor is the only
accepted input. This ADR states what the compiler adopts.

## Context

`pass={{ … }}` is the sole client-signal interop channel between a
composed parent and its child (ADR 0005 s10). The runtime validates
pass entries eagerly and completely at connect, and throws on failure —
an uncaught `connectedCallback` exception, outside the author's control
flow. That is the right backstop for hand-written components, but a
compiled component's authored source already decides the entry form: the
failure is statically decidable, so the compiler refuses it before
anything ships.

## Decision

1. **Two mediated forms parse; nothing else.** A `pass={{ … }}` entry is
   a read-only thunk (`() => expr`) or a two-way descriptor
   (`{ get, set }`). Every other shape is an outright invalid entry with
   a named reason — one parser (`classifyPassEntries`,
   `src/classify-attributes.ts`) shared by raw dashed tags and composed
   PascalCase elements, so there is exactly one dispatch path.
2. **Channel and tier** (ADR 0007):
   compiler, tier 1 (Prevented) — the LTC012 family. The runtime's eager
   connect-time validation remains the backstop (tier 3) for components
   that never pass through this compiler.
3. **Emission.** A thunk lowers to a read-only `pass()` accessor; a
   descriptor to a two-way one. The emitted call never grants the child
   an unmediated writable signal, so the parent's update policy stays
   interceptable at runtime exactly as the source promised.

## Consequences

**Good:**

- The ownership rule — every write a child makes passes through its
  owner's code — is enforced in CI, not discovered at connect.
- One dispatch path for both element kinds cannot drift between them.

**Bad / accepted tradeoffs:**

- Retired forms fail hard at compile time; there is no migration
  shim — by design, matching the runtime's v3 removal.

## Related

- Requirements: §3.4 (the closed `truc:` vocabulary), §10 (Output:
  client JS)
- Authority: Le Truc ADR 0012 (linked above)
