# Document Map

Every document this skill maintains, with its audience, scope, what triggers an update, and what to check in a consistency review.

## README.md
**Audience:** Developers discovering or evaluating the compiler on GitHub or npm
**Register:** Concise overview — what the compiler does, installation with the runtime peer, a minimal `compileCorpus()` walkthrough, links to the authoritative docs
**Scope:** What Le Truc's component compiler is, peer requirements (runtime, TypeScript), a minimal working example, feature overview

**Update triggers:**
- Package name, version scheme or install command changes
- Quick-start example uses a changed API (`compileCorpus()`, config shape)
- The peer requirement changes (runtime version, TypeScript range)
- Major new capability worth surfacing in the overview

**Consistency checks:**
- Install command and peer requirements match `package.json`
- Quick-start example compiles against the current `src/contract.ts` surface
- Claims about emitted output match what `bun run build:corpus` produces

## ARCHITECTURE.md
**Audience:** Contributors to the compiler; AI agents reasoning about internals
**Register:** Technical, precise, internal-facing — implementation details expected and correct
**Ownership:** the Architect. This skill never edits it; propose changes in `NOTES.md`.
**Scope:** The compiler's design: pipeline stages, the two authored surfaces, IR, emission, CSS scoping, diagnostics inventory, the build and check tooling

**Update triggers:**
- The Architect rules on a design change (this skill only flags staleness it meets)

**Consistency checks (report, do not edit):**
- File map matches actual files in `src/`
- Diagnostic inventory matches the `DiagnosticCode` union in `src/diagnostics.ts`
- Pipeline description matches the stage order in the code

## REQUIREMENTS.md
**Audience:** The owner, the Architect, and anyone challenging scope
**Register:** Declarative requirements with stable IDs
**Ownership:** the Architect, with the owner. This skill never edits it.
**Scope:** Goals, personas, constraints — the source of truth every task traces to

**Update triggers:**
- The owner changes scope (never a writer initiative)

**Consistency checks (report, do not edit):**
- None routine; cite it, do not audit it

## CONTEXT.md
**Audience:** Everyone writing prose or code in this repo
**Register:** Vocabulary ledger — one definition per term
**Ownership:** the Architect. This skill never edits it; challenge a term in `NOTES.md`.
**Scope:** Domain vocabulary, names and prefixes (`LTC###` vs `TSRX###` disposition)

**Update triggers:**
- A term is sharpened or added by an Architect ruling

**Consistency checks:**
- Prose you touch uses `CONTEXT.md` terms one-to-one (this is always in force, in every document)

## HOST_PROFILE.md
**Audience:** Authors of compiled components and contributors changing host decisions
**Register:** Reference — decisions per host concern (styles, `truc:pass`, element references), contrasted with the only other TSRX host profile
**Scope:** This project's host decisions on both authored surfaces, and the authoring rules that follow from them

**Update triggers:**
- A host decision changes (styles handling, pass semantics, element references)
- An authoring rule changes on either surface (`.tsx`, `.tsrx`)
- A new contrast with Ripple's profile becomes load-bearing

**Consistency checks:**
- Surface rules match what `src/frontend/` enforces
- Style claims match the emitted CSS (`bun run build:corpus`, then read the output)
- No rule contradicts `ARCHITECTURE.md` or the ADR it cites

## AGENTS.md
**Audience:** AI agents at inference time
**Register:** Terse, direct, AI-optimized — every token has a cost; no explanatory padding
**Scope:** Non-obvious behaviors that a competent Le Truc developer would not predict from the public API alone

**Update triggers:**
- A non-obvious behavior is introduced, changed, or resolved
- An existing entry becomes inaccurate
- A new source of subtle bugs is identified

**Consistency checks:**
- Every entry is still accurate for the current implementation
- No entry describes behavior that has since changed or been removed
- The peer-dependency, runtime-neutrality, self-reference and snapshot-golden entries all hold

## JSDoc in src/
**Audience:** IDE users (hover documentation); the published type surface
**Register:** Brief, typed, precise — one-line summaries; `@param`/`@returns` only
**Scope:** Public API functions and their parameters, return values, and non-obvious constraints (`compileCorpus()`, config types, the macros and runtime entry points). Internal helpers do not require JSDoc.

**Update triggers:**
- A public function's parameter is added, removed, renamed, or retyped
- A public function's return value or semantics change
- A public function is removed

**Consistency checks (spot-check):**
- `@param` names match current parameter names in the function signature
- `@returns` descriptions match current return type semantics
- No `@param` tags reference removed parameters
- No `@example` blocks use deprecated API
- `@since` tags are present on all exported functions

## The demo page (once it exists)
**Audience:** Developers evaluating Le Truc through the compiler's output
**Register:** Instructional — small, runnable, honest about what the compiler does
**Scope:** A small page that runs example corpus components through the compiler, showcasing features

**Update triggers:**
- A showcased feature changes or is removed
- The example corpus component it renders changes materially

**Consistency checks:**
- The page renders from real compiler output, not hand-written mimicry
- Every showcased feature works at the current version

## CHANGELOG.md
**Audience:** Integrators deciding whether a change affects them
**Register:** Keep a Changelog, project style — see `references/changelog.md`
**Scope:** User-facing behavior changes per release

**Update triggers:**
- An iteration completes (the Architect asks; `references/changelog.md` → *Recording an iteration*)
- A release is cut

**Consistency checks:**
- `## [Unreleased]` exists only while unreleased changes exist
- Version headings match `package.json` history

## SECURITY.md, LICENSE
**Audience:** Reporters and licensees
**Register:** Static boilerplate
**Scope:** Reporting policy and license

**Update triggers:**
- Reporting channel or license changes (owner decision)

## Change to Document Matrix
Quick reference for update-after-change:

| Change type | JSDoc | HOST_PROFILE | AGENTS | README | CHANGELOG |
|---|---|---|---|---|---|
| New exported function/type | ✓ | — | — | — | ✓ |
| Removed export | ✓ | ✓ if a host rule named it | ✓ if was non-obvious | ✓ if in quick-start | ✓ |
| Changed public API signature | ✓ | — | — | ✓ if in quick-start | ✓ |
| New/changed non-obvious behavior | — | ✓ if author-facing | ✓ | — | ✓ if user-visible |
| Internal implementation change | — | — | ✓ if tricky | — | — |
| Diagnostic code added/reworded/retired | ✓ | — | ✓ if surprising | — | ✓ |
| New example in the corpus | — | — | — | — | — (demo pages it, once it exists) |
| Installation/peer/package change | — | — | ✓ if surprising | ✓ | ✓ |
| Docs restructure | — | — | — | ✓ links | — |

Any pipeline *code* a docs change needs goes to a task in the queue store, `queue/TC-NNN.md` with a `band:`, rendered into `BACKLOG.md` by `bun run queue:build` (see `../architect/references/task-queue.md`).
