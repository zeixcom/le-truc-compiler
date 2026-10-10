# Error Messages

**Use when:** a diagnostic code in `src/diagnostics.ts` (`LTC###`, or `TSRX###` for a `.tsrx`-grammar rule) is added, reworded, or removed — or when the two lists need a consistency pass.

**Ownership:** whoever changes the condition writes the copy, to the criteria below — a contributor in the same change, or `writer` on request for a batch. The Architect fixes the channel and tier at task-writing time (ADR 0028); copy follows the tier.

**Required reading:**
- [ADR 0028](../../../../adr/0028-tiered-error-surfacing.md) — the tier contract these messages have to encode
- `ste100-style.md` — both lists are reference text and run STE at **Full** strength

---

## The acceptance criteria for any error message

These are not advice. A message that fails one of them is not done.

### 1. Three parts, in this order

1. **What failed** — the condition, in the author's vocabulary, not the implementation's.
2. **Which module and site** — `lineOf()` and the phase context supply this for compiler diagnostics. If the builder does not receive enough to name the site, that is a signature gap to raise with the developer, not something to write around.
3. **What the author should do** — an imperative fix. This is the part that goes missing. "X is not allowed" is not a message; "X is not allowed — do Y instead" is.

Where the fix genuinely depends on information the builder does not have, name the *decision* the author has to make rather than omitting part 3.

### 2. Name the paired rule

A compiler message whose condition also throws at connect **names the runtime error class**: the author who skips the compiler meets the class next, and the class is the actionable spelling there. The reverse direction — a runtime message naming a compiler code — is wrong, but that copy is owned by the sibling `le-truc` repo (ADR 0028 sub-design 1 — the runtime is a backstop, not the notification); raise a pairing gap in `NOTES.md` rather than editing across repos.

### 3. Do not imply a Tier 2 failure broke the page

A contained error means the component degraded to its server-rendered markup, which is *already correct* (ADR 0028 sub-design 4). "Broken", "crashed", "failed to render" are all wrong for Tier 2. "Did not enhance", "did not activate", "kept its server-rendered markup" are right. Tier 3 is the exception.

### 4. One voice across both lists

Message shape: a sentence stating the condition, an em-dash clause for the mechanism when the reader needs it, then an imperative fix. Backticks for code, `<angle-brackets>` for tags. No exclamation marks, no apology, no "please".

---

## Which prefix a new code gets

The `DiagnosticCode` union carries two prefixes, split by ownership ([ADR 0028](../../../../adr/0028-tiered-error-surfacing.md) sub-design 1, as amended 2026-09-19; full disposition in `CONTEXT.md`):

- **`LTC###` — the default.** Every rule the shared machinery emits on both authored surfaces.
- **`TSRX###` — the exception.** Only for a rule specific to `.tsrx` grammar with no `.tsx` counterpart. Today that is exactly `TSRX018`, `TSRX020` and `TSRX021`–`TSRX024`: the React idioms they guard against are `.tsx`'s *correct* spellings ([ADR 0032](../../../../adr/0032-adopt-tsx-as-the-authored-component-surface.md) s6), so those rules cannot be compiler-wide, and none of them is in the published package.

The number spaces do not overlap; both prefixes live in the one union. New codes are `LTC###` unless the rule is specific to `.tsrx` grammar — do not re-litigate the split per code; the ledger records the reasoning.

---

## Event: a new error

**Trigger:** a developer adds a code to `src/diagnostics.ts`.

1. **Confirm the tier is recorded.** The Architect decides the tier at task-writing time; if the task does not say, ask before writing copy — the tier decides the wording.
2. **Pick the prefix.** `LTC###` unless the rule is specific to `.tsrx` grammar — see *Which prefix a new code gets* above.
3. **Confirm the channel.** If the condition is statically decidable and the new error is a runtime class, ADR 0028 sub-design 1 obliges a compiler rule too. Flag its absence rather than writing a message that pretends the compiler covers it.
4. Write the message to the four criteria above.
5. Write or extend the JSDoc on the builder: the mechanism, the tier, and the paired channel.
6. Propagate (checklist below).

## Event: a revised message

**Trigger:** wording changes on an existing class or code.

1. Re-check all four criteria — a reword is the cheapest moment to close a missing part 3.
2. **Check the fragments assembled at the emit site.** A diagnostic's sentence is assembled from the builder plus the values passed where it is emitted — read the rendered message whole (`tests/diagnostics.test.ts` and the snapshot goldens show it) before judging it.
3. Propagate (checklist below). **Message-substring tests are the failure mode here:** they break silently in the sense that they were checking the right thing and now fail for the wrong reason.

## Event: a retired error

**Trigger:** a class is deleted, or a rule stops being emitted.

1. Search the whole repo for the name or code, not just the source file. A retired code often survives in a union type with no builder behind it — `LTC031` was exactly this. Mark it retired in the union comment rather than deleting the member silently, so the next reader knows the number is spent.
2. Remove its substring-test assertions (below), or mark them retired if authors may still meet the code in an older build.
3. Propagate (checklist below), including the ADR that decided the retirement.

## Event: periodic consistency review

**Trigger:** after a batch of error work, or when the list and its references have drifted.

1. Read the code list end to end in one sitting, against the ADR 0028 inventory. Every row must name a channel that exists — no code that no builder emits, no ✅ for a rule that was never written. The runtime classes live in the sibling `le-truc` repo; check the pairing only when a task touches it.
3. Check every message for part 3.
4. Check every Tier 2 message against criterion 3.
5. Record anything you cannot fix as copy — a missing rule, a builder that cannot name its site — in `NOTES.md` for the Architect to turn into a task, not as a hedge in the message.

---

## Propagation checklist

An error message has more downstream copies than any other string in the project. Every event above ends here.

| Target | What to do |
|---|---|
| `src/diagnostics.ts` | The builder and its JSDoc — the authoritative copy |
| The JSDoc of the emitting function, or `AGENTS.md` for a cross-cutting surprise | Any prose describing how the diagnostic surfaces |
| `ARCHITECTURE.md` | The diagnostic inventory, for a new or retired code. Architect-owned — propose the change in `NOTES.md` |
| **Message-substring tests** | See below — these fail the build, so find them first |
| `adr/0028-tiered-error-surfacing.md` | The inventory table, if the channel or tier changed. Follow `architect` → `references/adr.md` |
| `CHANGELOG.md` | A user-visible message change is a change. Follow `changelog.md` |

### Message-substring tests

These assert on fragments of the exact strings this workflow edits. Grep them before changing wording, and update the assertion to the new phrase — never weaken it to make it pass.

| File | Asserts on |
|---|---|
| `examples/test/audit/test-audit.spec.ts` | `'reserved word'` |
| `tests/diagnostics.test.ts` | `'reserved word or Object builtin'`, and code-specific fragments throughout |

Verify with `bun test tests`. When the audit spec's asserted fragment changes, its Playwright run is an owner browser gate.
