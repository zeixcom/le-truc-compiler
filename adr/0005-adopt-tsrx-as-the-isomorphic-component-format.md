# ADR 0005: Adopt TSRX as the Isomorphic Component Format

## Status

✅ Accepted — 2026-10-10, adopted from Le Truc [ADR 0024](https://github.com/zeixcom/le-truc/blob/main/adr/0024-adopt-tsrx-as-isomorphic-component-format.md) (✅ Accepted there; accepted here at the REQUIREMENTS.md consolidation). Amended there by ADR 0008 (tiered server evaluation), ADR 0010 (`.tsx` primary), ADR 0011 (compiled CSS, sub-design 2), ADR 0015 (template-cloned arms, sub-design 13) and ADR 0024 (list items as Mount Scopes, sub-design 5) — the chain is complete.

## Context

Components were three hand-maintained files whose contract was checked only at runtime — `first()` failures the symptom, drift the disease. Server-rendered HTML with a thin reactive enhancement layer is the core insight (REQUIREMENTS §1.1); the library ships no SSR layer of its own. TSRX (Ripple ecosystem) provides a shared parser (`@tsrx/core`) with per-target codegen; Le Truc is its first server-oriented target, validated by spikes. The compiler this format feeds now lives in its own repository (ADR 0027).

## Decision

Adopt an **isomorphic single-file `.tsrx` format** — server args, signals, `expose()`, markup, handlers, and styles in one source, the single source of truth for server render and client enhancement — compiled by a **split compiler** in this repository on pinned `@tsrx/core`. Sub-design numbers are stable; other ADRs cite them. For `.tsx` components, ADR 0010 (above) supersedes sub-designs 4, 6 and 14 and amends 16. These surface sub-designs remain in force for `.tsrx`, which stays supported.

1. **Full expressiveness, no escape hatches** — every Le Truc feature is expressible in the format, so no author drops to hand-written TypeScript for want of syntax; hand-written components stay supported. Event delegation is a compiler optimization.

2. **Split compiler, isolated dependency** — per component it emits server markup, a generated `defineComponent()` client factory importing solely from `@zeix/le-truc`, component-scoped CSS (ADR 0011), and a registry entry — corpus-level since D-32: `registry.json`, the public semver'd projection, beside an internal sidecar (`src/registry.ts`). `@tsrx/core` is pinned behind a single emitter module.

3. **DOM-is-truth seeding, end to end** — the server renders initial values by the Evaluation Tier's mechanism; the client harvests them from that DOM at connect — no state payload (ADR 0001, the adopted connect-time invariant). Expressions no phase can resolve are omitted and client-corrected, never simulated (ADR 0008). **One site, three roles:** a child-harvested prop is rendered, harvested, and rebound in one authored site. Exclusions: declared signals; the root's own attributes (the root IS the host — that value is the channel, not a copy); Parser-exposed props (their channel is the host attribute — double-rendering warns).

4. **Author-declared reactivity, no markers** — a function-valued attribute is a reactive binding, an `on*` attribute an event, a reactive `{expr}` child the reactive child: reactivity is what the expression reads, never a marker. Reactive `aria-*` (IDREF ARIA excepted) lowers to `bindAria()` by target ([Le Truc ADR 0026](https://github.com/zeixcom/le-truc/blob/main/adr/0026-aria-reflection-via-elementinternals-and-bindaria.md)) — never style the host on `aria-*`; `:state()` ([Le Truc ADR 0016](https://github.com/zeixcom/le-truc/blob/main/adr/0016-element-internals-for-form-association-and-states.md)) is the styling hook.

5. **Dual `@for` lowering** — over server data: rendered once, enhanced via `each()` scopes ([Le Truc ADR 0014](https://github.com/zeixcom/le-truc/blob/main/adr/0014-keyed-per-element-scopes-for-memo-collections.md)); over a reactive List: keyed items plus an extracted `<template>` reconciled by `reconcile()` (ADR 0004 — the emission contract; the primitive's own record: [Le Truc ADR 0017](https://github.com/zeixcom/le-truc/blob/main/adr/0017-keyed-template-clone-reconciliation-for-lists.md)). Server-known expressions fold into every item; each item is a Mount Scope whose content lowers through the arm emission, the item a signal (ADR 0024).

6. **Type flow by emit-then-check** — CI `tsc`-checks both generated modules through the compiler's own span-table mappings.

7. **Library boundary unchanged** — compiler and driver are build-time tooling: `@zeix/le-truc` stays browser-only and never renders; jsdom never ships (ADR 0006); `reconcile()` remains the only DOM-creation primitive. The companion project anticipated in Le Truc's original scope is build-time compilation, not a server runtime.

8. **Extension activation via `export const config`** — a zero-import, statically analyzable third argument (form flag; `observedAttributes` names must be Parser-exposed props), compiler-validated; form variant first — [Le Truc ADR 0019](https://github.com/zeixcom/le-truc/blob/main/adr/0019-extension-based-dependency-injection-for-definecomponent.md)'s ordering, structurally enforced.

9. **CEM generation from the generated clients** — the analyzer and plugin read the generated clients, so the manifest needs no compiler support. The registry already holds every fact the manifest states, so a compiler-emitted CEM stays feasible — in the compiler or as an external emit target. (The CEM tooling itself stayed in Le Truc: ADR 0049.)

10. **Composition: PascalCase invocation, explicit `truc:pass`** — a capitalized tag bound to a sibling-module import composes that component; top-level attributes are the child's server args. `truc:pass` is the sole client-signal interop channel. Children become the child's reserved `children` parameter, inserted at a bare `{children}` — not `<slot>`, which collides with Declarative Shadow DOM. A required child without children is a type error. The children belong to the parent, and the child acts on them only through the roles its `children` type declares (ADR 0026 s1). A `truc:html` on an element in the content is the parent's own sanitized binding (LT-492, ADR 0026 s1): a data-reference arg splices into the children string through `sanitizeHtml`, and a reactive thunk binds from the parent's client against the Children Region — where the host walk reaches the site; inside an arm, a loop body or a server-rendered branch it is refused (LTC005). The content's other client constructs — events, reactive and `pass` attributes, nested control-flow, further composition — remain unsupported there (LTC011). **Handler args** are the one function-valued server arg: a parameter named `on[A-Z]…` with a function type, which the child places as an event attribute on a raw element it owns (`<button {onClick}>`). The server never renders it; the compose site lowers to an `on()` in the parent's client on the placement element, addressed by a compiler-synthesized selector, in the site's enclosing Mount Scope — the child's signature is the contract, so this is no reach-in. A placement the parent cannot address stably (not an event attribute on a raw element, or inside one of the child's arms or list items) is refused (LTC081, LT-461).

11. **Optional element references: the weaker of two claims** — site-inferred: a single-branch `@if` addresses its root as maybe-cardinality under one presence guard (with `@else`: union addressing); author-declared: one selector literal is optional (`T | undefined`), two are required, throwing the authored reason. **The template proves what a component renders, never what it will find** — required refs alone are structurally verified.

12. **Arg-to-site substitution** — an arg used only to compute a value may be traced to a descendant attribute the client reads back at connect; initializers stay one unconditional constructor call.

13. **Async boundaries route on `isPending`** — the guarded signal is the `@try` body's direct lazy child; arms are template-cloned branches keyed `ok`/`nil`/`err` (ADR 0015, s4): the shipped arm renders live beside inert templates, and a state change clones its arm in. The plain sync `@try`/`@catch` boundary stays a separate shape.

14. **Import placement is inferred** — only sibling-component imports are compose imports (sub-design 10); every other import re-emits verbatim into the modules that use it.

15. **Context protocol support** — `requestContext(Context, fallback)` is a recognized signal-constructor form and `provideContexts` an ambient call; the server renders the fallback, the client corrects once a provider resolves.

16. **Real exports explicit, Factory Context ambient** — real `@zeix/le-truc` exports are imported explicitly, keeping sources honest TypeScript; the Factory Context vocabulary stays ambient via `globals.d.ts` — an authored import would falsely declare a generated parameter.

## Alternatives Considered

- **Status quo (the hand-written trio)**: drift persists, with or without a server templating layer; runtime contract errors are the tax.
- **Authored split (client export beside the template)**: two truths coexist per component.
- **Compiler-inferred reactivity (taint walk)**: author-declared thunks eliminate the inference.
- **Extension hooks in setup (`useExtensions`, export arrays)**: a directive that never executes, or unvalidatable shapes; the closed `export const config` enforces ordering structurally.
- **Ripple's `createVolarMappingsResult`**: its every-token invariant is tied to Ripple's transforms; the compiler emits its own span table.
- **Binary "fold failed, therefore simulate" routing**: sends the largest cost driver into a realm that cannot answer it; ADR 0008 tiers instead.
- **An opt-in `enhancer` mode**: deletes the server half under a flag; widen the default path instead of exempting components from it.
- **Duplicating a harvested prop onto the host attribute**: ships template and data twice (sub-design 3).
- **Inferring `first()` cardinality from the site**: take the weaker claim (sub-design 11).
- **JSX instead of TSRX**: no first-class control flow, no host-owned styles, no shared parser; revisited by ADR 0010.
- **Shape-inferred `pass()` dispatch**: ambiguous once a name is both server arg and client prop.
- **`<slot>` as the children insertion marker**: a real DOM element; collides with Declarative Shadow DOM.

## Consequences

**Good:**

- Single source of truth; the HTML contract is compile-checked (root-tag match, selector uniqueness), not discovered as runtime errors.
- Generated clients are exactly idiomatic Le Truc — the corpus doubles as golden tests.
- No state payload — pages are correct before JavaScript loads; ref drift is build-caught.

**Bad / accepted tradeoffs:**

- The rewrite rules are product surface — goldens are mandatory; a wrong rewrite is a wrong component.
- `@tsrx/core` is 0.x: the pin holds, churn is expected; `.tsrx` stays untyped without the projection toolchain.
- Approximated values render client-corrected (the flash trade); two evaluation mechanisms coexist — the audit is a standing obligation (ADR 0008).
- The corpus migrated to compiled sources (hand-written twins kept as variants, ADR 0017); authors debug generated factories (`debug()` and tiered error surfacing mitigate).
- The one-site rule fires on a name coincidence with no opt-out; an optional reference turns a missing element into a silent no-op.
- An async boundary ships every arm's markup, the non-shipped ones as inert templates — heavier HTML, consistent with enhance-don't-render.

## Related

- Requirements: §1.1 (what Le Truc is), §2 (pipeline), §3 (authoring), §5 (composition and server evaluation), §12 (public contract) — traces finalized at the consolidation
- Host profile: `HOST_PROFILE.md` (this repository)
- Authority: Le Truc ADR 0024 (linked above)
