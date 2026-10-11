# Le Truc Compiler — Requirements

> This document is the north star for Le Truc Compiler's design and
> development. It captures the problem, the users, the constraints, and
> the success criteria from which all architectural decisions should be
> derived. It is not a changelog or a roadmap — it describes *what* and
> *why*, not *when*.

Sections 2–12 use MUST / SHOULD / MAY normatively. Section 13 maps every
architectural decision to the requirements it serves; the decision
records themselves live in `adr/` (index: `adr/adr-index.md`).

## 1. Positioning

### 1.1 The problem

Le Truc is a library for reactive web components (Custom Elements v1)
with one reactive dependency, `@zeix/cause-effect`. Its runtime rests on
one rule, **DOM-is-truth**: the server renders the initial HTML, and the
browser library never generates initial markup. A component **adopts**
the markup it finds at connect, **harvests** its initial state from it,
wires fine-grained effects, and from then on updates exactly the nodes
that need it. There is no hydration, no virtual DOM, no serialized state
payload, and no subtree re-rendering. Data-driven DOM creation happens
only through keyed template cloning: lists (`reconcile()`, ADR 0004) and
reactive-condition arms (ADR 0015).

| | Industry default | Le Truc |
| --- | --- | --- |
| Server | DB → a JS server renders HTML | DB → CMS fills compiled templates, in any backend language |
| Sent to client | HTML + CSS + JS + serialized state | HTML + CSS + JS |
| Client work | **Hydrate**, then **re-render** | **Adopt** and harvest at connect, then update only affected nodes |

The CMS in this chain does not have to run JavaScript. That constraint
drives everything below. The compiler exists because Le Truc 2.x made
authors edit three hand-maintained files per component — server module,
client factory, stylesheet — that drifted against each other, with
contract errors caught only at runtime. The compiler turns one
isomorphic component source into those three artifacts, checking the
contract at build time, and renders the initial HTML by evaluating the
component it compiled — so the same source that enhances the client
answers for the server, tiered by cost (§5.2), in any backend language
(§9).

On Ryan Carniato's map of frontend architecture, Le Truc holds the
**minimal-client-state, request/response** quadrant next to HTMX, with
first-class, typed, component-scoped affordances. We hold this
coordinate on purpose: not upward (client-rendered content is the
failure mode the runtime avoids), not rightward (a live server
connection needs a stateful JS process our CMS personas cannot run).
One admission comes with it: a **bounded client content-read channel** —
components fetch JSON through `Task` signals and render it through keyed
cloning and named arms, never whole-page content.

### 1.2 The users

| User | What they need |
| --- | --- |
| The framework team | To build Le Truc, its docs and its example corpus through the compiler's own published path — the compiler repo is self-contained and its corpus is the verification base |
| The SSG developer | A Node-capable build that emits complete, correct no-JS pages per locale |
| The CMS developer (PHP, Java, …) | Backend template partials with holes, guaranteed escaping, and no requirement to run JavaScript — the folding has to travel to a language the compiler does not execute |
| The installing developer | An npm package whose build path runs on any JS runtime, with zero config working out of the box |
| The component author | One `.tsx` file per component, checked by stock `tsc`, with compile-time contract enforcement and structured, source-mapped diagnostics |
| Agents and tooling | Machine-checkable guarantees: gates, censuses, a closed diagnostic vocabulary, and a self-contained decision record |

### 1.3 Why TSX

TSX gives the best authoring experience because it allows local
reasoning: everything about a component lives in one file — structure,
server data, client state and behaviour, styles and source-locale
messages together, bindings attached where they act, composition at the
component level. TSX is known and mature, checked by the TypeScript we
use anyway, and agent-friendly for the same reasons as for humans:
locality plus a large presence in training data. The alternative —
statement-oriented component grammars — stays supported as a second
first-class surface (ADR 0010); betting the primary surface on a pre-1.0
language was rejected.

### 1.4 Goals

- **One authoring format, many server targets.** SSG and CMS templates
  share one IR.
- **Server-first.** HTML is the source of truth; client JS only
  enhances it.
- **Fine-grained client updates** through Le Truc components and Cause &
  Effect signals.
- **Plain TSX.** Sources are standard TSX that stock TypeScript checks
  without extensions.
- **Compile-time contract checking.** Every check decidable from source
  and template is a compiler diagnostic; the runtime is the backstop
  (ADR 0007).
- **One public language.** The authored dialect is also the contract
  third-party adapters target. Everything below it is internal.
- **Readable output.** The generated client is idiomatic Le Truc a team
  can eject and maintain.

### 1.5 Non-goals — and what must stay reachable

| Non-goal | Note |
| --- | --- |
| Per-request SSR as our target | Legitimate for a third party stacking a router, database, bundler and streaming server on this compiler. **No decision may close that road**; §9.3 lists the invariants that keep it open. |
| Bundling | One ES module per component plus a manifest; chunking, inlining and critical CSS belong to the consumer's toolchain. |
| Data loading and routing | Frameworks or the CMS own them; the compiler renders given server args. |
| Running React, Vue, Solid or Lit at runtime | No runtime framework adapters; the compiler-side exception is §4. |
| Arbitrary server-side JS in template targets | Only the portable subset (§3.8) lowers. |

### 1.6 Terms

| Term | Meaning |
| --- | --- |
| Host profile | The TSX dialect of §3: standard TSX plus the closed `truc:` vocabulary, typed by a shipped ambient declaration |
| Component module | One `.tsx` file exporting one component function, its styles and its source-locale messages |
| Server args | The component function's first parameter: rendered on the server, never reactive |
| Setup | The statements before the single `return` |
| Template | The returned JSX, rooted at the host element |
| Lowering | The rewrite from host-profile constructs to IR nodes |
| Reactivity class | Every template expression is `static`, `server` or `reactive` (§8.2) |
| Fold | Build-time evaluation of reactive initial values (§5.2) |
| Target emitter | A backend of the IR walk producing one HTML artifact kind (HTML, Twig, HTL, …) |
| Adapter | A source-to-source translator from another component format into host-profile TSX |
| Census | A build-report record that reports without asserting wrongness (tier, translation) |

## 2. Pipeline architecture

One input contract (host-profile TSX), one IR, several emitters. Every
output is a function of IR, the corpus registry, catalogs and config.

| Stage | Input | Output | Must be |
| --- | --- | --- | --- |
| Adapter | Foreign source | Host-profile TSX + source map | Outside the compiler; conformance-tested (§4) |
| Front end | `.tsx` module, `tsconfig` | IR, message table, style table, diagnostics | Deterministic; no I/O beyond reading sources; per module, cacheable by content hash |
| Corpus pass | Every module's IR | Registry, compose-checked IR, tiers | The one stage that sees more than one component |
| Emitters | IR, registry, catalogs, config | Artifacts | Independent of each other; one IR walk with many backends |
| Diagnostics | Events from all stages | Report + censuses | Stable codes, source-mapped to the pre-adapter file |

**Outputs depend on other components.** A component's artifacts are not
a function of its own source alone: `truc:pass` legality reads the
child's registry entry; `@scope … to (…)` needs the tags the template
renders; selector exclusions read each child's rendered shapes; tier
contamination is a fixpoint over the compose graph. Incremental builds
therefore MUST invalidate per module **and** along compose edges; a
catalog change MUST NOT re-run the front end. An incremental API, where
a dev loop builds on it, is additive and never part of the initial
contract.

**Engine.** The machinery walks estree; parser access is confined to one
converter leaf, so the TypeScript engine can move underneath without a
public break. `ts.Node` and all TypeScript types MUST stay out of every
public contract. Supporting native parsers after TypeScript is a stated
goal.

## 3. Authoring: the TSX host profile

### 3.1 Component module

A module exports **one component function**. Its first parameter is the
destructured **server args**; their TypeScript type is what compose
sites check against. The optional second parameter is the **typed
factory context** (`FactoryContext<Props>`, `FormFactoryContext<Props>`
for form-associated) — when present, factory names SHOULD be
destructured from it; the wide ambients remain legal for migration.
`Props` is the element's public reactive surface and MUST be declared
explicitly. Reserved server args the compiler supplies and callers never
pass: `children` (composed content) and `i18n` (the locale record).

The template's **root is the host element**, spelled as its
custom-element tag — the tag MUST be unique per corpus (LTC048) and is
the component's identity; there is no fragment root. The `<style>` block
nests inside the root. **Setup** runs on the server (in the fold) and is
carried verbatim into the client factory; real `@zeix/le-truc` exports
MUST be imported explicitly (LTC036) and factory vocabulary MUST NOT be
imported (LTC037). The effect machinery — `watch`, `on`, `pass`, `each`,
every `bind*` — is **never authored**: template syntax lowers to it.
`export const i18n` (§6), `export const config`, type declarations and
the `HTMLElementTagNameMap` entry are module-level declarations the
compiler reads.

### 3.2 DOM mode

Light DOM is the default (children directly under the root; the
stylesheet extracted at build time, §7). Shadow DOM is opt-in via a
declarative shadow template as the root's first child; the stylesheet is
authored identically in both modes, composed content is inserted at
`{children}` — never `<slot>`, which would need its own ADR — and shadow
mode's boundary governs harvest and ID references. Declarative Shadow
DOM is Baseline 2024.

### 3.3 Bindings: what runs where

Reactivity is author-declared, never marked. For an attribute the
spelling decides; for a text child, what the expression reads:

| Spelling | Class | Meaning |
| --- | --- | --- |
| `attr="literal"`, literal text | `static` | Known at build |
| `attr={expr}`, `{expr}` over server args only | `server` | Rendered once; never updates |
| `attr={() => expr}` | `reactive` | Rendered at its initial value, then `watch()`-bound |
| `{expr}` reading a signal or `host.<prop>` | `reactive` | Text binding; initial value rendered |
| `on<Event>={handler}` | — | `on()` listener; never serialized to HTML |

- **Reactive attributes MUST be arrow thunks** — the only spelling that
  expresses a derived binding, and it keeps what is evaluated where
  readable at a glance. `null`/`false` removes an attribute; a boolean
  toggles it.
- The compiler picks the DOM channel: a `host.<prop>` mirror or a
  dirty-flag IDL attribute binds as a property, everything else as an
  attribute. There is no `prop:` prefix.
- **Reactive text MUST own its element's whole text content** — a hole
  inside mixed content is not addressable on its own (LTC005); wrap the
  reactive part in an element.
- A per-document `id` in a template MUST come from a server arg
  (LTC042).

### 3.4 The closed `truc:` vocabulary

A compiler-consumed construct gets a `truc:` name only when its
JavaScript spelling would misstate its meaning, it needs no generic type
parameter, and it joins this closed list (ADR 0019). Growth goes through
that gate, which under §4 is also the adapter-facing API gate.

| Construct | Form | Semantics |
| --- | --- | --- |
| Boundary | `<truc:try pending={…} catch={e => …}>` | Error boundary with `catch` only; async boundary with `pending`. Three arms, no stale arm; the winning arm renders live, the others as inert templates (ADR 0015 s4) |
| Signal pass | `truc:pass={{ key: () => …, other: { get, set } }}` | Replaces the child's Slot-backed signal; read-only thunk or mediated descriptor only (ADR 0003). Legality is checked against the child's registry entry |
| Dynamic HTML | `truc:html={expr \| () => expr}` | Inner HTML through the application's sanitize policy (§3.7) |
| Dynamic tag | `<truc:element tag={expr}>` | A **server-known** expression naming an **HTML** element; built when a migration needs it |

### 3.5 Control flow

Whatever JSX expresses stays JSX — no `truc:if`/`truc:for`. Ternary and
`&&` lower as conditionals, an IIFE switch as a switch, `.map()` over
server data as `each()`, over a declared `createList` as keyed
`reconcile()` (ADR 0004), and a length-checked empty arm lowers as the
loop's empty arm.

- **Server-known conditions** render only the winning arm; no client
  construct.
- **Reactive conditions** (reading a signal) render the initial winner
  live beside inert arm templates keyed by compile-time names
  (`then`/`else`, `case:` + the literal's JSON — value-typed — plus
  `default`) and switch through `reconcile()` over the current arm key
  (ADR 0015). Arms own their effects; re-entry re-clones; a losing
  arm's template bakes client-written sites empty.
- A reactive loop MUST iterate a `createList` (LTC001). A `key` on a
  server-data loop is an error (LTC052). Every branch arm MUST return
  JSX; statements live in setup.

### 3.6 Element references

An author declares `const el = first(selector, reason?)` /
`all(selector)` only when the factory reads the element. One literal is
optional (guarded effects); a second makes it required, with the reason
flowing into the runtime `MissingElementError`. A composed child is
addressed by its tag plus the compose site's own discriminator. There is
no `ref={}`.

### 3.7 Dynamic HTML and trust

`truc:html` never assigns raw. The library ships no sanitizer; the
**application provides one policy**, configured once and applied by
every target: the server fold, template targets (through the backend's
implementation of the same policy), and the client. Two sanitizers with
different allowlists would be a hydration diff in the one place where a
diff is a security question (ADR 0002). Without a configured policy,
`truc:html` fails closed: the client's `sanitizeHtml` falls back to
`escapeHTML`, and a template target's unregistered sanitizer hook fails
at render (ADR 0021 s3).

### 3.8 The portable subset and closed fold inputs

| Restriction | Rule |
| --- | --- |
| **Closed inputs** (the partial-readiness invariant, ADR 0012 s4) | Anything the server evaluates may read only the component's own server args and the reserved `i18n` record's declared members. A page-context read in a server-evaluated position is an error (LTC054). Widening the set is a reviewed act. |
| **Portable expressions** | `server`-class expressions that must survive into a template target MUST lie in the closed hole grammar every target must translate (ADR 0021 s1): static member paths over args and loop items, literals, `!`, strict equality, numeric comparison, `&&`/`\|\|`/`??`, the ternary, and message calls. Calls to arbitrary functions are outside the subset, so emittability is target-independent. |

## 4. Input adapters

Adapters let other component formats author for Le Truc. The seam is
**source-to-source**: an adapter translates its format into host-profile
TSX for a declared profile version, with a source map back to its input;
diagnostics remap through that map, so an author sees their own file.
Only components an adapter translated with **no error** may mix with
native components. No plugin machinery. **Translate and refuse; never
emulate** — a construct whose meaning cannot be stated as
*server-rendered markup + connect-time effects + keyed cloning as the
only data-driven creation* MUST be refused with a diagnostic naming why.
Adapters never mint compiler codes and never produce routing signals.
The seam ships experimental until a first-class reference adapter
exists.

## 5. Composition and server evaluation

### 5.1 The data account

Binding on every component, compiled or hand-written:

1. **Compiled server components receive all data as server args.**
2. **A client component may place server-known initial data anywhere in
   its owned markup** and harvest it there.
3. **Reaching into a child's owned markup is forbidden** — composition
   goes through the child's public props, methods and declared roles
   (ADR 0026).
4. **One site, three roles.** A harvested prop renders into its site
   from the server arg, harvests back out of that site at connect, and
   rebinds it afterwards. Rendering the same value through a second
   channel is the duplication smell (LTC039); `formAssociated()`'s reset
   baseline is the sanctioned exception.
5. **Formatted values keep a raw source.** Text formatted for display
   does not parse back; a formatted reactive value MUST have a canonical
   raw value source.

### 5.2 Evaluation tiers

What a reactive expression renders before JavaScript loads is resolved
by the cheapest phase that can answer it, decided statically and
conservatively (ADR 0008):

| Tier | Mechanism | When |
| --- | --- | --- |
| **Folded** | DOM-less value harness | Every reactive initial value resolves from server args, initializers, `i18n`, or Parser-backed `host.<prop>` reads |
| **Simulated** | The generated client executes against a simulated DOM (ADR 0006) | Folding is incomplete **and** the realm can plausibly answer. **SSG only** (ADR 0013) |
| **Static** | Skeleton only; the client corrects at connect | Nothing the realm could answer |

- **Unresolvability is per expression; tier is per component.** An
  unresolvable expression is **omitted in every tier**: a build-time
  timestamp is a stale value served for the life of the page, not a
  flash the client corrects.
- A shape the fold cannot follow is **not an author error**; it routes.
  The tier census records it.
- **Composition contaminates on reads, not containment.**
- In every tier the client is ground truth, and **no
  framework-synthesized hydration payload ever ships**. Serialized data
  is a matter of scope and authorship, not a ban: where serialization is
  genuinely unavoidable, a component-local payload on one of the
  component's own attributes, parsed by `asJSON`, stays legal.
- **The emitted markup is byte-identical across tiers**, and CI renders
  every Folded component through the realm as well, requiring identical
  output.
- The simulation substrate (jsdom) is an **optional peer**; without it
  Simulated components route Static and record it in the census. The
  simulation seam is DOM-free and designed as a package boundary
  (ADR 0013).

### 5.3 Context

`requestContext(Context, fallback)` is a signal constructor: the
fallback MUST be server-known and is what the server renders; the client
resolves the provider at connect. `provideContexts([...])` is
client-only and renders nothing.

## 6. Internationalization

Locale is **build-time server data** (ADR 0009). It reaches a component
as the reserved `i18n` server arg, which callers never pass.

- Source-locale messages live in the component module as `export const
  i18n`, an object literal where every value MUST be an **ICU
  MessageFormat 1** pattern. `t.<key>` is typed per key from the
  pattern; calls are checked against it (LTC055). Keys are namespaced by
  tag at build. Literal prose in a catalog-using component warns
  (LTC047).
- One catalog file per locale, component-namespaced; no override stack —
  a key resolves in exactly one place. The **translation census** checks
  both directions, argument sets, plural-arm coverage, and staleness. A
  missing translation falls back to the source string and is **censused,
  not diagnosed**. An explicit `i18n:sync` script, never the build,
  writes placeholders, prunes orphans and refreshes the manifest.
- Locale precedence, first match wins: explicit `lang` arg > parent's
  effective locale > component default > page locale. The effective
  locale renders onto the root `lang` attribute; the client materializes
  it at connect. The locale is a build-time constant, so `Intl` folds.
- SSG pages are per locale; template dimensionality is locale ×
  component. **The catalog never reaches the browser**: a message with a
  client-reactive argument is recomputed from the pattern through an
  inlined evaluator — one bundle serves every locale.
- **Template targets** emit one partial per locale, with no locale hole
  (ADR 0021 s6): argument-independent text folds at build; a message
  whose arguments read server args emits a formatter call over the
  already-localized pattern literal. The MF2 exit stays pinned by a
  round-trip suite.

## 7. Styling

A compiled stylesheet is **platform CSS** (ADR 0011): it means what the
same sheet would mean as an inline `<style>` in its host. Scoping is
authored with native `@scope`, and the compiler adds no limits of its
own. Style content MUST be static (a `css`-tagged literal without
substitutions); dynamic values go through custom properties. The sheet
is parsed (`lightningcss`); a parse error is an error.

`@scope { … }` with authored `to (<limits>)` is scoped to the host; a
top-level rule led by the component's own tag emits verbatim; any other
top-level rule applies page-wide and warns. Native emission gives the
sheet its platform meaning; the lowering for CSS targets without
`@scope` produces flat selectors with matching specificity and zero-
specificity guards. The CSS target is `cssTargets`, defaulting to
Baseline widely available. In light DOM mode the `<style>` never reaches
the HTML or client bundle; in Shadow DOM mode it unwraps into each
declarative shadow root. **Hash classes are not used**, in CSS or in
locators.

Errors (Prevented): a rule inside `@scope` led by the own tag; `:host`
in a light-mode sheet; `::slotted()` in light mode; `:host-context()`;
`:global` anywhere; a dead rule; an inexpressible `@scope` form on a
lowered target. Warnings (Contained): a downward leak; an unscoped rule.
Checks over the parsed sheet (ADR 0020, on hold) — dead-rule detection,
typed custom properties, the typed class handle — wait for real
consumers. Documented, fixture-pinned differences from the platform: page
CSS can still reach light-DOM internals, and the lowered form has no
scope proximity.

## 8. Intermediate representation

The IR is the **lowering**: the one place that interprets the template.
It is a closed union of owned nodes (element, text, attribute, event,
conditional, loop, try, compose, raw HTML, dynamic element); setup
statements stay verbatim slices with source positions. Messages are
expressions, not a separate node.

- Every expression carries a **reactivity class** (`static`/`server`/
  `reactive`) plus its dependency closure; emitters and the tier
  classifier read the class and never re-derive it (ADR 0018 s7).
- **The IR is internal** and may change in any release (ADR 0012 s8);
  `ts.Node` never appears in a public contract.
- Lowering preserves source positions on every node, which keeps the
  span tables — and the source maps adapters chain onto — sound.
- No lowered node depends on a specific target. A published, narrower
  emitter-facing shape is a separate decision from the internal IR.

## 9. Output: HTML

All HTML targets serialize the same template walk; they differ in when
`server`-class expressions are evaluated and in what syntax.

| Target | `server` expressions | Emits | Scope |
| --- | --- | --- | --- |
| SSG | At build, per page × locale | `.html` pages, via `render<Name>(args)` modules | 3.0 |
| Template | By the CMS at request time | A partial with holes per component and locale (ADR 0021 s6) | Twig first; HTL next |
| SSR | Per request, by a third-party stack | — (the render module is the building block) | Not ours; kept reachable (§9.3) |

### 9.2 Template emitter contract

A target emitter is **a backend of the same IR walk** as the SSG render,
never a sibling interpretation. The shared walk owns every decision —
hole classification, escaping contexts, refused positions, tier — and a
target owns only syntax (ADR 0021). The fold resolves everything
independent of server args; **every server arg becomes a hole**.

- **The escaping contract is a security boundary.** Escaping contexts
  are a closed union assigned by the shared walk; every hole gets one;
  refused positions are compile-time errors, never a silent unsafe emit.
  Per-target escaping corpora, including negative cases, are part of
  each target.
- Initial reactive values are never serialized separately: the client
  harvests them from the nodes they were rendered into.
- **Equivalence:** rendering a partial with given args MUST match the
  SSG fold for the same args, checked on the real engine (ADR 0021 s8).

Required mappings — reactive conditionals as a backend conditional plus
inert arm templates; reactive lists as the seed arg's native loop plus
the inert `data-list` item shape; compose as include with args; children
as a capture in the composed-markup context (raw, with the child writing
`data-children` from the implicit `owner` arg); message calls as
translation calls; raw HTML through the backend's implementation of the
application's policy; the async boundary as the **boundary operation**
over a three-state **result arg**. Not emittable (routing the partial
Static in the census): the synchronous `Try` and a key-alias harvest
(ADR 0025 s4 — no render witness).

### 9.3 Keeping per-request SSR reachable

Per-request SSR is out of scope for us, but these invariants keep it one
integration away for a third party: `render<Name>(args, locale)` is a
**pure function** of args and locale (closed fold inputs, §3.8); render
modules run on Node, Deno, Bun and edge workers (**web-standard APIs
only**, ADR 0016); boundaries render in document order so a streaming
server can flush without our help; any server links exactly the modules
and styles a page uses (the manifest, §11.1).

## 10. Output: client JS

Each component with at least one reactive binding or event handler
compiles to one Le Truc module that adopts server HTML; fully static
components ship no JS.

- Output MUST be **readable and ejectable**: idiomatic Le Truc, source
  names, JSDoc and comments preserved.
- **Initial state is harvested** from the server-rendered DOM (formatted
  values from their raw source, §5.1), never recomputed. The first
  effect run MUST NOT change the DOM; connect is a fixed point.
- **Locators are generated**, with uniqueness proven structurally
  against the template the compiler renders (ADR 0023). An ambiguous
  author selector is an error (LTC027). No hash classes; ejected code
  depends only on authored markup.
- One effect per binding site; lists and reactive arms clone from
  `<template>` skeletons. Props reach composed children as properties or
  `pass()`, never as stringified attributes.
- One module per component; `@zeix/le-truc` is an external peer import.
- **Versioning.** The compiler declares the runtime as a peer range.
  Raising the floor is a compiler minor; the browser baseline belongs to
  the runtime major.

## 11. Output: CSS, manifest and diagnostics

### 11.1 CSS and manifest

One stylesheet per light-DOM component. The compiler emits a manifest
(`{ tag → client module, stylesheet, render module, templates }`) so
SSG, SSR stacks and template targets link only what a page uses. Critical
CSS, bundling and minification are left to the consumer.

### 11.2 Diagnostics

Every stage reports into one stream. **Errors fail the build.** Warnings
are author-fixable, and the baseline target is zero. Censuses are
separate records that report without asserting wrongness.

| Field | Type | Notes |
| --- | --- | --- |
| `code` | `LTC###` | Closed vocabulary; public API from first publish; a number is never reused |
| `severity` | `'error' \| 'warning'` | Follows the rule's recorded tier |
| `message` | `string` | Copy follows `writer` → error-messages |
| `location` | `{ file, start, end }` | Source-mapped to the pre-adapter file |
| `related` | `location[]` | E.g. the catalog entry behind a mismatched argument |
| `fix` | `{ description, edits }?` | Machine-applicable where safe |

- **Tiered surfacing** (ADR 0007): every runtime check decidable from
  source and template MUST have a compiler rule (Prevented). The runtime
  stays the Contained backstop for hand-written components, foreign
  markup and DOM changed after render; only definition-time failures and
  the Trusted Types re-throw escalate.
- The record is public API from first publish (ADR 0022). Formats:
  terminal, JSON, and SARIF for CI; a language-service plugin may
  follow.
- Authored `.tsx` is checked by plain `tsc` against the host profile;
  generated modules are checked emit-then-check, with positions remapped
  to the authored source.

## 12. Public contract

Emitted bytes are not contract. Everything else under the compiler is
internal.

What a change to emission must preserve is the **rendered result in the
browser** and the **content-security footprint**. A change must not make
the output need a content security policy relaxation that the previous
output did not need: no `eval` or `new Function`, and no inline script,
inline handler or `style` attribute the render did not already carry.
Generated source may change shape freely within those bounds (owner
ruling, 2026-10-11).

| Published | Role |
| --- | --- |
| The host-profile TSX dialect, versioned | What authors write and adapters target; grows only through the ADR 0019 gate |
| The corpus entry point (`compileCorpus(config)`) | The one entry point: compiles a whole corpus and writes the artifacts to `outDir` |
| The corpus result, `RegistryEntry` (public projection) | The consumer half: diagnostics and the registry the run wrote |
| The diagnostic record and its types | Diagnostics (ADR 0022) |
| `le-truc.config.json` and its type | The configuration surface (ADR 0014) |
| The generated-module API | `render<Name>`, the client module's default export, the `i18n` module's shape, the `registry.json` schema |

**The entry point is the corpus, not the file.** A component's artifacts
depend on other components (§2): compose legality, tier contamination
over the compose graph, variant sets. The published entry point runs
both corpus passes and writes the artifacts, `registry.json` and the
`i18n` modules to the configured `outDir`; the artifacts are files, not
return values. The per-file front end stays internal, as does the
incremental API until it ships as an additive minor.

**`RegistryEntry` is narrowed, not widened.** The public type carries
what a consumer reads — tag, name, module paths, CSS path, props type,
`exposedProps`, tier, composed tags; compiler-only fields stay on an
internal type, serialized to the internal sidecar. The public projection
is also the `registry.json` schema.

**The generated-module API is under semver.** It covers names and
signatures, never bytes. A rename, a removal or a tightened signature is
a major; no TypeScript type appears in a public contract, so the engine
can move without a major.

## 13. The decisions

Every architectural decision is recorded as an ADR in `adr/`, derived
from the requirements above and re-read against them. The records were
adopted from the Le Truc repository's decision record (adapter records
cite their source of authority; ported records are this repository's
own). Each requirement area lists the decisions that serve it; each
record names the areas it traces to.

| ADR | Decision | Serves |
| --- | --- | --- |
| 0001 | The connect-time attribute model is a compiler invariant *(adapts Le Truc ADR 0003)* | §1.1, §5.1, §5.2 |
| 0002 | The sanitize chokepoint spans server and client *(adapts Le Truc ADR 0010)* | §3.7 |
| 0003 | Pass bindings accept only mediated forms *(adapts Le Truc ADR 0012)* | §3.4, §10 |
| 0004 | List emission targets the keyed reconcile contract *(adapts Le Truc ADR 0017)* | §3.5, §9 |
| 0005 | Adopt TSRX as the isomorphic component format | §1.1, §2, §3, §5, §12 |
| 0006 | Server simulation — render initial HTML by executing the client module | §1.1, §5.2, §11.2, §12 |
| 0007 | Tiered error surfacing — compiler first, contained runtime | §1.5, §11.2, §12 |
| 0008 | Tiered server evaluation — the cheapest phase that can answer | §1.1, §5.2, §9 |
| 0009 | Internationalization as build-time server data | §5.2, §6, §9 |
| 0010 | `.tsx` as the primary authored surface (`.tsrx` retained) | §1.3, §3 |
| 0011 | Compiled component CSS is platform CSS | §7 |
| 0012 | Distribution — `@zeix/le-truc-compiler` and template emission | §9.2, §9.3, §12 |
| 0013 | The simulation seam — SSG-scoped tier, DOM-free boundary, substrate package | §5.2, §12 |
| 0014 | The corpus configuration surface — `le-truc.config.json` | §1.2, §12 |
| 0015 | Reactive conditions as template-cloned arms | §3.5, §5.2 |
| 0016 | The runtime-neutral build path | §2, §12 |
| 0017 | Canonical-plus-variants — one tag, build-selected spellings | §1.3, §3 |
| 0018 | Typed IR contracts — discriminated unions and pass signatures | §8 |
| 0019 | `truc:` intrinsic elements for compiler-consumed constructs | §3.4 |
| 0020 | The component stylesheet as a compiler artifact — ⏸️ on hold | §11.1 |
| 0021 | The target-emitter interface — shared decisions, per-target syntax | §3.8, §6.3, §9.2 |
| 0022 | Structured, source-mapped diagnostics | §11.2, §12 |
| 0023 | The structural-uniqueness proof runs on a materialized probe | §10, §11.2 |
| 0024 | Reactive-list items as Mount Scopes | §3.5, §5.2 |
| 0025 | Harvest through a key alias, witnessed by the render | §3.5, §5.2, §9.2 |
| 0026 | The children contract — parent-owned content, child-declared roles | §3, §11.2 |
| 0027 | The compiler lives in its own repository | §1.1, §12 |

**Status.** All 26 mapped records are ✅ Accepted — accepted at this
consolidation (owner, 2026-10-10) — except 0020, ⏸️ on hold. Any record
a future re-read against these requirements materially changes goes back
through Proposed with the change recorded.

## 14. What this document is not

It is not a changelog: decision history, alternatives weighed and
supersession chains live in the ADR records. It is not a roadmap: build
order, release staging and pioneer plans live in the task queue and the
release conventions. It does not track progress: the board and the queue
do. When this document and an ADR disagree, the ADR is wrong or this
document is — reconcile by amending one of them, never by citing the
other stale.
