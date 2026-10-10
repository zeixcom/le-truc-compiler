# ADR 0001: The Connect-Time Attribute Model Is a Compiler Invariant

## Status

✅ Accepted — 2026-10-10. Adopts Le Truc
[ADR 0003](https://github.com/zeixcom/le-truc/blob/main/adr/0003-attributes-drive-state-at-connect-time-only.md)
as the decision's record of authority. That ADR owns the runtime ruling:
attributes drive state only at connect time via parsers,
`static observedAttributes = []`, properties carry reactivity. Le Truc
[ADR 0019](https://github.com/zeixcom/le-truc/blob/main/adr/0019-extension-based-dependency-injection-for-definecomponent.md)
later shipped the escape hatch 0003 had reserved as the opt-in
`observedAttributes()` extension; the ruling itself is unchanged. This ADR
states what the compiler adopts from both.

## Context

The compiler does not implement the element lifecycle it emits toward —
the runtime does. But its three central contracts are coherent only
because of the connect-time ruling: the server can bake initial state
into markup only if the client adopts markup as its initial state;
harvest can be the only server→client channel only if nothing else
crosses it; and emitted parser initializers can run once only if
attributes never re-drive state. The compiler therefore adopts the
ruling as an invariant on its analysis and emission.

## Decision

The compiler treats connect-time initialization as an invariant:

1. **DOM is truth.** The server module renders every reactive value's
   initial state as real markup (`emit-server.ts`). There is no
   alternative client-side channel for initial state.
2. **Harvest at connect.** A Parser-exposed prop is seeded by its host
   attribute and harvested from rendered markup at connect
   (`ParserExposeDecl`, `src/ir.ts`). One site, three roles — the
   server's render target, the client's harvest source, the binding
   target after connect. A second channel for the same value is the
   duplication smell (LTC039); `formAssociated()`'s reset baseline is
   the sanctioned exception.
3. **No state crosses the server→client boundary.** No hydration payload
   ships in any tier (REQUIREMENTS §5.2). A component-local payload on
   the component's own attribute, parsed by `asJSON`, stays legal
   authorship (REQUIREMENTS §5.2) — a matter of scope, not a ban.
4. **Reactive binding never rides attributes.** The compiler picks the
   DOM channel per binding — a `host.<prop>` mirror or a dirty-flag IDL
   property — and emits an attribute write only as initial config.
5. **The escape hatch is compiled, not duplicated.** A component opts in
   through `export const config` — zero-import and statically
   analyzable (ADR 0005 sub-design 8). The compiler validates
   the keys — `config.observedAttributes` must name Parser-exposed
   props, or the extension would be silently inert
   (`src/validate-lowered.ts`) — and lowers `config` to
   `defineComponent`'s third argument. Re-parsing on mutation is runtime
   behavior; the emitted module shape is unchanged.

## Consequences

**Good:**

- Tiered server evaluation and template emission stay coherent: a non-JS
  backend can render a component completely, because initial state lives
  in markup and nothing else must ship.
- The whole extension surface is statically visible (`config` is data),
  so an inert declaration fails at compile time instead of silently at
  runtime.

**Bad / accepted tradeoffs:**

- Attribute changes from outside are invisible to a component that did
  not opt in; the compiler never synthesizes observation.

## Related

- Requirements: REQUIREMENTS §5.2
- Authority: Le Truc ADR 0003 (linked above); escape hatch existence:
  Le Truc ADR 0019 (linked above) — tracked here only as decision 5
