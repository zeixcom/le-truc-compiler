# Tone Guide

Style rules for each document this skill maintains. Violating the tone is as wrong as a factual error — each document has a distinct primary reader and serves a distinct purpose.

Style runs on two dials. **Precision** governs how strictly sentences are controlled. **Voice** governs how much journey, rhythm, and opinion the text carries. The dials move in opposite directions: reference material runs full precision and no rhetorical voice; narrative runs loose precision and full voice. Most pages mix types section by section — a tutorial page can hold a persuasive hero, reference tables, and hands-on steps. Set the dials per section, not per file.

## The Three Style Layers

Every document is written in all of Layer 1, plus the Layer 2 and Layer 3 strengths its text type calls for.

1. **Plain English — everywhere.** Active voice. Present tense for behavior. Plain words ("use", not "utilize"; "fix", not "remediate"). One word per concept, using the `CONTEXT.md` domain vocabulary. All code in backticks.
2. **Sentence discipline — scaled by text type.** The rules in references/ste100-style.md: one idea per sentence, short sentences, lists over compound sentences. Full strength where a misread costs the reader — instructions, steps, warnings, callouts, reference entries. Relaxed for connective prose in explanations, `README.md`.
3. **Voice — scaled by text type, inverse to discipline.** Journey, rhythm, and opinion, defined in Voice Techniques below. Reference entries carry none. Explanations and narratives carry a lot.

## Text Types

Classify the section before writing or editing it. The type sets the dials.

| Type | Job | Where | Discipline | Voice |
|---|---|---|---|---|
| Landing | Convince | `README.md` opening; the demo page hero | Low | High — claims, rhythm, opinions |
| Tutorial | Teach by doing | The quick-start in `README.md`; hands-on fragments elsewhere | High on steps and warnings, relaxed between them | Low — the sequence is the story; opinions in callouts |
| How-to | Guide a task or decision | Authoring how-tos in `HOST_PROFILE.md` | High on instructions | Medium — trade-off opinions |
| Explanation | Build understanding | Concept sections of `HOST_PROFILE.md` and `README.md` | Medium | High — journey, rhythm, opinions |
| Reference | Answer a lookup | JSDoc, `ARCHITECTURE.md`, `HOST_PROFILE.md` | Full | None — except trade-off notes in `ARCHITECTURE.md` |
| AI-optimized | Feed a model | `AGENTS.md`, skill files, `TODO.md`, `NOTES.md` | Full (articles may drop) | Directives only — no rhythm, no journey |

When one page holds several types, each section keeps its own dials.

## Voice Techniques

Voice is a toolkit, not a license. Each technique has a job and a failure mode.

### Journey

Give explanations and narratives an arc: a situation the reader recognizes, a complication, and the resolution the concept provides.

- Open explanation sections from the reader's problem, not from the API. Name a situation the reader recognizes, then follow that one scenario end to end.
- Let the sequence carry tutorials. Each section hands the reader to the next: the markup the reader just wrote is already on the page; the next sentence adds the definition that makes it reactive.
- Story-frame code examples. Real component names and realistic data — `basic-counter`, a menu with sections — never `foo`, `bar`, `test1`. A bare example teaches syntax; a framed one teaches usage.
- End sections with somewhere to go: the next section, a runnable example, the API entry.
- The journey is the reader's, not the project's. The no-history rule below still holds — never narrate the project's own past outside `CHANGELOG.md` and ADRs.

### Rhythm

Vary sentence length on purpose. A short sentence after two long ones lands the point.

- If three consecutive sentences share the same length and shape, rewrite one.
- The two-beat pattern works at every strength but Full: a statement, then a short sentence that draws the conclusion. In-house exemplars:
  - "Neither choice is good when the backend is a CMS. Neither choice is good when the initial HTML is already correct." (`README.md`) — parallel build, flat close.
  - "No custom events are needed. State flows naturally."
- Rhythm lives in landing, explanation, and narrative. Steps, reference entries, and `AGENTS.md` stay uniform — there, sameness reads as reliability.

### Opinions

Dare to recommend. "Always let the compiler scope the CSS, never by hand." "Avoid reaching inside sub-components." A document that only describes is a catalog; the reader came for judgment.

- Every opinion carries a reason the reader can check: "Styling its inner elements creates tight coupling."
- Commit or cut. "This may be considered somewhat complex" is a hedge. Either say "That's a lot to hold in your head" and back it, or delete it.
- A "Best when / Avoid if" table is the in-house exemplar for trade-off opinions.
- Opinions belong wherever guidance belongs: `AGENTS.md` directives, `ARCHITECTURE.md` trade-off notes, explanations, `README.md`. They are banned only in neutral lookup material.

## Shared Rules

These apply to every document without exception:

- **Concise over comprehensive.** Every sentence must add information the reader needs. Cut throat-clearing, transitional padding, and restatements of what the code already shows.
- **Technically accurate over reassuring.** Do not soften edge cases, paper over constraints, or omit behavior that is surprising but correct.
- **Current shape, timeless rationale.** Documents state current truth: what the API is, not what it was. Never write "previously", "as of version X", "we changed", "now supports", or "will eventually". Timeless rationale — why the design is the way it is — is content in explanations and `ARCHITECTURE.md`; it is noise in reference entries and JSDoc. No ticket, issue, or task IDs (e.g. `TC-123`) — they reset every sprint and mean nothing to a future reader; a stable identifier like an ADR number is fine where the rationale genuinely lives in that ADR. `CHANGELOG.md` and the ADRs own the timeline.
- **No meta-commentary.** Do not write "This section explains…" or "See below for…". Say the thing directly.
- **Backtick all code.** Every API name, file name, type name, option key, tag name, and shell command is wrapped in backticks, even mid-sentence.
- **Surgical edits only.** Update what changed. Do not rewrite accurate sections, and do not add commentary about what was updated.
- **Vocabulary is always disciplined.** One word per concept, defined in `CONTEXT.md` — in every text type.

## Demo page

**Primary audience:** Developers evaluating Le Truc through the compiler's output (see references/document-map.md). Classify each section's text type (see Text Types above) and set the dials accordingly.

**Register:** Approachable, direct address ("The compiler turns this corpus into…", "Use `.tsrx` when…"). Present tense. Active voice. Conversational without being casual.

**Structure rules:**
- The hero states what the page shows, not what it covers — one bold claim sentence plus at most two plain sentences.
- The page renders from real compiler output (`bun run build:corpus` over the example corpus), never hand-written mimicry. Every showcased feature works at the current version.
- Use a callout for non-obvious constraints or caveats the reader is likely to miss. Do not overuse — one per major section at most.
- Code examples are realistic — they show actual patterns from `examples/`, not toy snippets, and name the component they come from.

## README

**Primary audience:** Developers encountering the compiler on GitHub or npm for the first time.

**Register:** A doorway, not a manual. The opening section is Landing type — rhythm and one committed opinion are welcome there. Installation and quick-start are precision-leaning Tutorial. Everything deeper links to `HOST_PROFILE.md`, `ARCHITECTURE.md` and the runtime repo's docs.

**Structure rules:**
- No section should require scrolling to see — `README.md` is a doorway, not a manual.
- The quick-start example is minimal: one complete `compileCorpus()` call that demonstrates the essential pattern.

**What to cut:**
- Comparison prose beyond the opening — let the authoritative docs handle positioning
- Options tables or API details — those live in JSDoc and `ARCHITECTURE.md`
- Anything the authoritative docs already carry that the README would just duplicate

## ARCHITECTURE

**Primary audience:** Contributors and AI agents that need to understand internals.

**Register:** Reference type, full discipline. Technical and precise. Third person, present tense. Implementation details are expected and welcome. Internal function names, type names, flag names, and field names are used freely without definition — this document assumes the reader has the source open.

**Structure rules:**
- Describe mechanisms, not intentions. Not "this enables efficient updates" but "the scanner emits one corpus entry per authored component source, keyed by tag name."
- File maps, dependency graphs, and pipeline stage diagrams are appropriate. Match actual source structure exactly.
- Trade-off rationale lives in the Key Decisions table and ADRs, not in mechanism prose.

**What to cut:**
- Motivational framing ("The design optimizes for…")
- Public API description — that belongs in JSDoc
- Any sentence replaceable by reading the source directly

## AGENTS.md

**Primary audience:** AI agents at inference time. Every token has a cost.

**Register:** AI-optimized type. Terse, declarative, maximally dense. No hand-holding. No transitions. Bold key terms. Bullet lists over prose. Code examples only when the correct pattern is non-obvious from the statement. Directives are opinions — "removing a provider is an anti-pattern" is the right register — but no rhythm and no journey.

**Non-obvious behavior entry structure:**
1. **Bold statement** of the behavior — one sentence, declarative, specific.
2. Implication or consequence — one or two sentences maximum.
3. Code example — only if the correct pattern cannot be inferred from the statement.

**The bar for "non-obvious":** A competent Le Truc developer would not predict this behavior from reading the public API. If they would, it does not belong here.

**What to cut:**
- Any sentence that restates what the bold statement already said
- Explanations of standard reactive concepts
- "Note that…", "Keep in mind…", "Be aware that…" — state it directly

## JSDoc

**Reference type, full discipline.** Follows references/ste100-style.md at Full strength: one short sentence per summary line, active voice, present tense, `CONTEXT.md` domain terms.

**Primary audience:** Developers reading function signatures in an IDE.

**Register:** Brief, typed, precise. One-line summaries. No narrative. Fragments are acceptable if they read naturally as a tooltip. No opinions — JSDoc states behavior, not preference.

**Structure rules:**
- Summary line: one sentence. Describes what the function does. "Sets text content of an element by replacing child nodes." not "A factory for text-setting effects."
- `@param` tags: one line each. Describe semantics and constraints, not the TypeScript type.
- `@returns`: one line.
- `@since`: required on all exported functions; use the version the function was introduced.
- `@throws`: only for errors that occur in correct, non-erroneous usage. Do not document programmer-error throws.
- `@example`: only if usage is non-obvious enough that a developer would misuse the function without one.

**What to cut:**
- `@param type` annotations — TypeScript already shows the type
- JSDoc that restates the TypeScript signature in prose
- Multi-paragraph descriptions
