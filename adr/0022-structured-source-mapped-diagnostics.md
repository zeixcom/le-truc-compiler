# ADR 0022: Structured, Source-Mapped Diagnostics — One Record, Machine-Readable Reports

## Status

✅ Accepted — 2026-10-10, adopted from Le Truc [ADR 0044](https://github.com/zeixcom/le-truc/blob/main/adr/0044-structured-source-mapped-diagnostics.md) (✅ Accepted there; accepted here at the REQUIREMENTS.md consolidation).

## Context

ADR 0007 makes the compiler the primary failure channel and its `LTC###` codes public API from the first publish. It does not define the record those codes travel in. The pre-decision record carried a code, a severity, a message and an optional line, and only a terminal reporter read it. That shape is too thin for the consumers a framework has: CI annotations need a file and a range, an editor needs a span to underline, and an adapter's author needs positions in their own source rather than in the `.tsx` the adapter emitted (ADR 0010 s6). The record is published with the codes, so its shape has to be settled before the first publish, when changing it is still free.

## Decision

**Every stage reports into one stream of structured records, and every location is a range in the file the author wrote.**

1. **One record shape.** A diagnostic carries `code` (the closed `LTC` vocabulary of ADR 0007), `severity` (`error` or `warning`, following the rule's recorded tier), `message`, `location` (`{ file, start, end }`), `related` (further locations, such as the catalog entry behind a mismatched message argument) and an optional `fix` (`{ description, edits }`). A fix is attached only where applying it is safe without author judgement. Where a rule has two equally valid repairs, the message names both and there is no `fix`.

2. **Locations are source-mapped to the authored file.** A position inside a generated module maps back through the span table to the authored source. A position inside adapter-emitted `.tsx` maps back through the adapter's source map to the adapter's input. A diagnostic whose position cannot be mapped is reported against the nearest mapped enclosing span, never dropped and never reported against an intermediate file.

3. **Censuses stay separate.** Tier and translation censuses are their own records: they report without asserting wrongness (ADR 0007 s1), so they never take a severity and never fail the build.

4. **Reports are views of the stream.** The terminal reporter is one view. A JSON report (the records as data) and a SARIF report (for CI code scanning) are the others. They are additive: each can land after the record shape without changing it. A TypeScript language-service plugin may follow as a further view.

5. **The record is public API from the first publish.** Adding an optional field is a minor. Removing or retyping a field, or reusing a code number, is a major.

## Alternatives Considered

- **Keep `line` and add fields later**: the record is published with the codes, so replacing `line` with a range after the first publish is a breaking change to every consumer that reads it.
- **Report against the emitted `.tsx` for adapted components**: shows authors a file they did not write and may never have opened; the adapter seam would then make every diagnostic the adapter author's support burden.
- **Fixes on every rule that has an advisory repair**: some repairs need author judgement (which of two ids to keep, which arm to restructure), and a machine-applied wrong fix is worse than none.
- **SARIF as the only machine format**: SARIF suits code-scanning services but is heavy for scripts and tests; plain JSON of the same records costs nothing extra.

## Consequences

**Good:**

- CI, editors and adapters consume one shape; every view is a projection of the same records, so the views cannot disagree.
- Adapted components report in their author's own file, which the adapter seam needs.
- The tiering rule of ADR 0007 stays the single source of a rule's severity.

**Bad / accepted tradeoffs:**

- Every diagnostic producer must supply a range instead of a line — a wide, mechanical change across the compiler before the first publish.
- Source mapping is only as good as the span table and the adapter's map; an imprecise adapter map yields imprecise positions, and that quality is the adapter's to own.

## Related

- Requirements: §11.2 (diagnostics), §12 (public contract) — traces finalized at the consolidation
- Architecture: `ARCHITECTURE.md` §6 (type checking & diagnostics — the stability policy)
- Authority: Le Truc ADR 0044 (linked above)
- Related: ADR 0007 (codes, tiers, censuses), ADR 0010 s6 (the adapter seam), ADR 0012 s8 (the public API)
