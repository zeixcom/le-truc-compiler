# ADR Index

The template is `adr/0000-template.md`. ADRs are numbered from 0001 in
this repository; records adopted from the sibling `le-truc` repository
cite their source of authority (see TC-003 for the migration plan).

| Number | Title | Status | Last updated |
| ------ | ----- | ------ | ------------ |
| [0001](0001-the-connect-time-attribute-model-is-a-compiler-invariant.md) | The connect-time attribute model is a compiler invariant | ✅ Accepted | 2026-10-10 |
| [0002](0002-the-sanitize-chokepoint-spans-server-and-client.md) | The sanitize chokepoint spans server and client | ✅ Accepted | 2026-10-10 |
| [0003](0003-pass-bindings-accept-only-mediated-forms.md) | Pass bindings accept only mediated forms | ✅ Accepted | 2026-10-10 |
| [0004](0004-list-emission-targets-the-keyed-reconcile-contract.md) | List emission targets the keyed reconcile contract | ✅ Accepted | 2026-10-10 |
| [0005](0005-adopt-tsrx-as-the-isomorphic-component-format.md) | Adopt TSRX as the isomorphic component format | ✅ Accepted | 2026-10-10 |
| [0006](0006-server-simulation.md) | Server simulation — render initial HTML by executing the client module | ✅ Accepted | 2026-10-10 |
| [0007](0007-tiered-error-surfacing.md) | Tiered error surfacing — compiler first, contained runtime | ✅ Accepted | 2026-10-10 |
| [0008](0008-tiered-server-evaluation.md) | Tiered server evaluation — route each component to the cheapest phase that can answer | ✅ Accepted | 2026-10-10 |
| [0009](0009-internationalization-as-build-time-server-data.md) | Internationalization as build-time server data | ✅ Accepted | 2026-10-10 |
| [0010](0010-adopt-tsx-as-the-authored-component-surface.md) | Adopt .tsx as the primary authored surface (.tsrx retained) | ✅ Accepted | 2026-10-10 |
| [0011](0011-compiled-component-css-is-platform-css.md) | Compiled component CSS is platform CSS — authored @scope, emitted per CSS target | ✅ Accepted | 2026-10-10 |
| [0012](0012-distribution-compiler-package-and-template-emission.md) | Distribution — @zeix/le-truc-compiler and template emission | ✅ Accepted | 2026-10-10 |
| [0013](0013-the-simulation-seam.md) | The simulation seam — SSG-scoped Simulated tier, DOM-free realm boundary, substrate package | ✅ Accepted | 2026-10-10 |
| [0014](0014-the-corpus-configuration-surface.md) | The corpus configuration surface — le-truc.config.json | ✅ Accepted | 2026-10-10 |
| [0015](0015-reactive-conditions-via-template-cloned-arms.md) | Reactive conditions — conditional arms as template-cloned branches | ✅ Accepted | 2026-10-10 |
| [0016](0016-runtime-neutral-build-path.md) | Runtime-neutral build path — the RuntimeIO seam, one glob grammar, and the portability gate | ✅ Accepted | 2026-10-10 |
| [0017](0017-canonical-plus-variants-authored-surfaces.md) | Canonical-plus-variants — one tag, build-selected surface spellings | ✅ Accepted | 2026-10-10 |
| [0018](0018-typed-ir-contracts.md) | Typed IR contracts — discriminated unions and pass signatures | ✅ Accepted | 2026-10-10 |
| [0019](0019-truc-intrinsic-elements.md) | truc: intrinsic elements for compiler-consumed constructs in .tsx | ✅ Accepted | 2026-10-10 |
| [0020](0020-the-component-stylesheet-as-a-compiler-artifact.md) | The component stylesheet as a compiler artifact — checks over the parsed sheet | ⏸️ On hold | 2026-10-10 |
| [0021](0021-the-target-emitter-interface.md) | The target-emitter interface — shared decisions, per-target syntax | ✅ Accepted | 2026-10-10 |
| [0022](0022-structured-source-mapped-diagnostics.md) | Structured, source-mapped diagnostics — one record, machine-readable reports | ✅ Accepted | 2026-10-10 |
| [0023](0023-the-structural-uniqueness-proof-runs-on-a-materialized-probe.md) | The structural-uniqueness proof runs on a materialized probe | ✅ Accepted | 2026-10-10 |
| [0024](0024-reactive-list-items-as-mount-scopes.md) | Reactive-list items as Mount Scopes — signal items, a keyed map, recursive emission | ✅ Accepted | 2026-10-10 |
| [0025](0025-harvest-through-a-key-alias.md) | Harvest through a key alias, witnessed by the render | ✅ Accepted | 2026-10-10 |
| [0026](0026-the-children-contract.md) | The children contract — parent-owned content, child-declared roles | ✅ Accepted | 2026-10-10 |
| [0027](0027-the-compiler-lives-in-its-own-repository.md) | The compiler lives in its own repository | ✅ Accepted | 2026-10-10 |
