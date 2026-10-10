# ADR 0002: The Sanitize Chokepoint Spans Server and Client

## Status

✅ Accepted — 2026-10-10. Adopts Le Truc
[ADR 0010](https://github.com/zeixcom/le-truc/blob/main/adr/0010-trusted-types-support-via-sanitize-hook.md)
as the decision's record of authority: the library owns no sanitizer and
exactly one `innerHTML` sink, gated by a single consumer-supplied
`sanitize` hook. Its LT-138 amendment is constitutive for this repository:
it defined the *compiled* `truc:html` binding's contract. This ADR states
what the compiler adopts.

## Context

The compiler emits two halves that can carry the same reactive
`truc:html` site: the server module renders its initial state, the
client factory binds its updates. If the two halves sanitized differently,
a reactive site would flip behavior at the server→client boundary —
escaped text before activation, live markup after. That bug shipped once
(fixed by LT-138); the contract below closes it structurally.

## Decision

Every dynamic HTML site the compiler emits rides the library's single
sanitize chokepoint, on both halves:

1. **One sink, one hook.** Emitted code never introduces a second
   `innerHTML` sink or a second sanitization knob. The compiler may add
   wiring around the hook; never an alternative to it.
2. **Client half.** A compiled `truc:html` thunk lowers to a binding that
   passes `{ sanitize: sanitizeHtml }` — the exported fail-closed
   wrapper — and never takes the raw-passthrough branch
   (`src/emit-client.ts`).
3. **Server half.** The emitted server module's `sanitizeHtml` delegates
   to the library's implementation, and `configureHtmlSanitizer` is
   re-exported alongside it (`src/runtime.ts`), so one app-wide
   configuration governs both halves.
4. **Fail closed.** Unconfigured, the wrapper escapes (`escapeHTML`) on
   both halves: a reactive `truc:html` renders escaped text before and
   after client activation — never a flip from escaped to live markup.
5. **Template targets.** A `truc:html` aimed at a template target whose
   sanitizer hook is unregistered fails at render (ADR 0021 s3).

Channel and tier (ADR 0007):
the wiring is compiler-guaranteed (tier 1 — no emitted call site can
bypass the hook); whether a hook is registered at all is render-time
(tier 3) by design, because sanitization posture is consumer-owned.

## Consequences

**Good:**

- The security posture of every emitted HTML site is auditable at one
  chokepoint, on both halves at once.
- The escaped-vs-live flip class of bug is structurally closed: the two
  emitters share one wrapper, one default, one configuration.

**Bad / accepted tradeoffs:**

- A Trusted-Types-enforced consumer must bring a `TrustedHTML`-producing
  sanitizer (e.g. DOMPurify); the compiler ships none — the library
  boundary it inherits.

## Related

- Requirements: §3.7 (Dynamic HTML and trust)
- Authority: Le Truc ADR 0010 (linked above)
- Related: ADR 0021 (the target-emitter interface)
