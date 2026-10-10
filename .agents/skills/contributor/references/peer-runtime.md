# The runtime peer (`@zeix/le-truc`)

The compiler compiles **against** the Le Truc runtime; it never vendors it. Everything here is a consequence of that split.

## The dependency

- The peer range is `@zeix/le-truc@^3.0.0-next.1` — currently unpublished. Until both packages publish in lockstep as `3.0.0-next.1`, this repo's own version stays at `0.1-next.1`.
- Development resolves the peer through `"@zeix/le-truc": "file:../le-truc"` in `devDependencies`. **Bun copies a `file:` dependency, it does not symlink it**: after a change in the sibling `le-truc` checkout, run `bun install` here before the change is visible.
- The runtime's types come from its barrel `index.ts`; the compiler's host decisions (`styles`, `truc:pass`, element references) live in this repo's `HOST_PROFILE.md`, not in the sibling.
- `bun run check:peer` guards the floor: every `@zeix/le-truc` import the compiler emits must exist at the peer version. Run it whenever emission or the peer surface changes.

## Where the runtime's own truth lives

The sibling `le-truc` checkout (v3 branch) owns the runtime's `ARCHITECTURE.md`, `CONTEXT.md`, ADRs, error classes and diagnostics pairing. When a task needs runtime internals — the effect system, the query system, connect-time containment — read them there, and record cross-repo decisions as ADRs here when they constrain the compiler.

Do not import runtime internals here: the compiler consumes the peer through its public surface only, and `src/` stays runtime-neutral (no `Bun` globals, no `import.meta`; ADR 0038 s2).
