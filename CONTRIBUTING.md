# Contributing to `@zeix/le-truc-compiler`

This repository holds the Le Truc component compiler: it builds a corpus of
authored component sources (`.tsx` stable, `.tsrx` experimental) into server
render modules, client modules and scoped CSS. Contributions arrive either as
an issue or as a pull request against `main`. Development inside the
repository runs through a task queue with per-task git worktrees — both are
documented under [Development Setup](#development-setup).

## Code of Conduct

- Keep discussions about the work, not the people doing it. Personal attacks,
  harassment and discrimination are not welcome.
- Disagree in the open, on the issue or pull request. A dissenting opinion
  with reasons is a contribution; a dismissal is not.
- Security reports are the one thing that never goes public: see
  [SECURITY.md](SECURITY.md).

## How to Contribute

### Reporting Issues

File issues at
[github.com/zeixcom/le-truc-compiler/issues](https://github.com/zeixcom/le-truc-compiler/issues).

1. Search the open issues first; add your details to an existing report
   instead of opening a duplicate.
2. Check the documentation before concluding it is a bug. [README.md](README.md)
   covers install and peer requirements, [HOST_PROFILE.md](HOST_PROFILE.md)
   the authoring rules, [ARCHITECTURE.md](ARCHITECTURE.md) the compiler's
   behavior. Some reports describe documented, deliberate behavior.
3. Include in the report:
   - a minimal reproduction: the component source and the `compileCorpus()`
     config that triggers it,
   - the diagnostics verbatim — every compiler diagnostic carries a code such
     as `LTC023`; quote it rather than paraphrasing,
   - the versions of `@zeix/le-truc-compiler`, `@zeix/le-truc`, `typescript`,
     and your Bun or Node runtime.
4. Report security vulnerabilities by email to `support@zeix.com` — never
   through a public issue ([SECURITY.md](SECURITY.md)).

### Suggesting Enhancements

Open an issue that describes the use case and the outcome you need, not only
the solution you have in mind. Work is planned into iterations by the
maintainer, and an issue aligned with the design lands sooner than an
unreviewed implementation. Say which surface the suggestion targets: `.tsx`
is stable; `.tsrx` is experimental and may change or be removed in any minor
release while so labeled.

### Submitting Pull Requests

Pull requests are the path for contributions from outside; in-repo work
integrates as task branches in the maintainer's review pass.

- Branch from `main`, one concern per pull request.
- Run the [gates](#gates) for the area you touched and make them green
  before you ask for review.
- Never edit generated output: `dist/`, `server/generated/`, `BACKLOG.md`,
  `DONE.md`. The two markdown files render from the `queue/` store via
  `bun run queue:build` — change the store, not the views.
- [ARCHITECTURE.md](ARCHITECTURE.md), [REQUIREMENTS.md](REQUIREMENTS.md),
  [CONTEXT.md](CONTEXT.md), `queue/` and `NOTES.md` are maintainer-owned;
  propose a change to them in an issue instead of a pull request.
- Tell the reviewer in the description: what changes and why, how you
  verified it (commands and results), and any diagnostic you added, reworded
  or retired.
- Follow the [commit message guidelines](#commit-message-guidelines).

## Development Setup

### Prerequisites

- **Bun 1.x** — the whole toolchain runs on it (`bun run`, `bun test`);
  other package managers' lockfiles are ignored on purpose.
- **Git**.
- **TypeScript** resolves through the peer range `>=5.8.0 <6.1.0`; the
  devDependency is deliberately on 6.x. Do not bump past the ceiling.

The emitted package runs on plain Node ESM (`node >= 18.18`); Bun is a
development requirement, not a runtime one.

### The sibling runtime checkout

The runtime peer `@zeix/le-truc` is unpublished. Its devDependency resolves
through `"file:../le-truc"`, so the runtime must be checked out as a sibling
of this repository, on its `v3` branch:

```sh
git clone -b v3 https://github.com/zeixcom/le-truc.git ../le-truc
```

Bun copies the sibling into `node_modules` — it does not symlink it. After
any change in the `le-truc` checkout, run `bun install` here before the
change is visible.

### Install and verify

```sh
bun install
bun run build
bun run test
bun run typecheck
bun run lint
```

Tooling gotchas:

- `bun test` writes its report to stderr. Capture gate output as
  `> file 2>&1`; the reverse order silently loses the report.
- `bun run lint` runs Biome with `--write` over whole trees — expect fixes
  outside your changed paths. Check without writing with
  `bunx biome check <paths>`.
- `bun run check:contract` and `bun run check:peer` read `dist/`; run
  `bun run build` first.

### Repository layout

| Path | Holds |
|---|---|
| `src/` | the compiler package — runtime-neutral by contract |
| `tests/` | the test suite, including the snapshot goldens in `tests/__snapshots__/` |
| `examples/` | the example corpus behind the golden baselines — a test corpus, not a playground |
| `demo/` | the board's shell corpus — separate from `examples/`; internal tooling stays out of the test corpus |
| `scripts/` | build and check tooling, including the queue and worktree chain |
| `queue/` | the task store: one `queue/TC-NNN.md` per task |
| `server/` | the board server and its generated output (`server/generated/`, gitignored) |
| `BACKLOG.md`, `DONE.md` | generated views of `queue/` — never hand-edit |

Companion documents: [ARCHITECTURE.md](ARCHITECTURE.md) (design),
[HOST_PROFILE.md](HOST_PROFILE.md) (authoring rules), [CONTEXT.md](CONTEXT.md)
(vocabulary), [REQUIREMENTS.md](REQUIREMENTS.md) (scope),
[AGENTS.md](AGENTS.md) (non-obvious behaviors), `NOTES.md` (blockers and
deviations).

### The task queue

Work is planned as queue entries — one `queue/TC-NNN.md` per task, with YAML
front matter for the machine fields and a body that says what to do and why.
The chain in `queue/ITERATION.md` orders the current iteration. All queue
semantics live in `scripts/lib/queue-store.ts`; the CLI, the checks and the
board all call the same readiness and lane functions, so they cannot disagree.

- `bun run scripts/start-task.ts [TC-NNN]` — picks the first ready task from
  the chain (or takes the named one), claims it and bootstraps its worktree;
  prints the task and the worktree as one JSON object. Exit 1 means nothing
  started.
- `bun run scripts/queue.ts <command>` — the store commands: `pick`, `claim`,
  `annotate`, `review`, `reset`, `list`. Every write re-renders the markdown
  views.
- `bun run check:queue` — validates the store contract; run it after any
  queue change.
- `bun run queue:build` — renders `BACKLOG.md` and `DONE.md` from the store.
- `bun run queue:serve` — serves the live board: a kanban rendered by the
  compiler's own output from `demo/` (build it with `bun run build:demo`,
  type-check it with `bun run check:demo`), reading the store directly and
  pushing a fresh snapshot over SSE whenever `queue/` changes.

One session works one task from start to finish: start, implement, gate,
self-review, commit, annotate, report. Integration belongs to the
maintainer's review pass.

### Worktrees

Implementation never happens in the main checkout. The bootstrap creates
`.worktrees/TC-NNN` — a git worktree on branch `task/TC-NNN` cut from the
current HEAD:

- `node_modules` is symlinked from the main checkout; it is never staged.
- The agent and host config dirs (`.agents/`, `.claude/`, `.vscode/`,
  `.zcode/`) are not materialized in the worktree.
- Run gates inside the worktree as `bun run --cwd <worktree> <script>`. Never
  `bun --cwd <worktree> run <script>` — bun silently runs nothing and exits
  0. A fresh worktree has no built `dist/`: run `build` before a gate that
  reads it.
- Commit through `bun run scripts/worktree.ts commit TC-NNN --message-file <path> -- <paths>`:
  it stages exactly the paths you name, refuses the store, the views,
  `NOTES.md` and agent-config paths, and reports anything else as residue.
  Worktree commits are unsigned by design.
- `bun run scripts/worktree.ts integrate TC-NNN` merges the branch back and
  removes the worktree — maintainer's review pass only, one branch at a time.
- A session that died leaves its task claimed;
  `bun run scripts/queue.ts reset TC-NNN` releases it. The bootstrap is
  idempotent and continues the existing branch.

### Gates

Run the gates for the area you touched. A red gate is not done.

| Area | Gates |
|---|---|
| `src/**` | `build` · `test` · `typecheck` · `lint` · `check:contract` when the public contract can change · `check:peer` when runtime-peer imports change |
| `scripts/**`, root config | `lint` · `typecheck` · the changed script, run against the real corpus |
| `examples/**` | `build:corpus` · `lint` |
| `demo/**` | `build:demo` · `check:demo` |

The full gate, required before an iteration milestone, is `build`,
`typecheck`, `test`, `lint`, `check:contract` and `check:peer`, all green on
one commit.

## Coding Guidelines

- **Keep `src/` runtime-neutral.** No `Bun` global, no `import.meta` in
  shipped source — the emitted package must run on plain Node ESM.
  `tests/runtime-neutrality.test.ts` enforces the scan; Bun-only behavior
  belongs in `tests/runtimes/` behind the runtime abstraction.
- **Errors are returned, never thrown.** `compileCorpus()` returns
  diagnostics and a summary; the caller decides whether they fail its build.
- **Diagnostic codes carry ownership.** `LTC###` codes come from the shared
  machinery and fire on both surfaces; `TSRX###` codes diagnose the `.tsrx`
  grammar specifically. Every message names what failed, where, and what to
  do. Wording is pinned by message-substring tests — search the repo for a
  code before rewording it.
- **Cover both authored surfaces.** A compiler change is tested against
  `.tsx` and `.tsrx` alike; the corpus holds both.
- **Add a regression test with every fix.** Before treating a symptom as a
  bug, check [AGENTS.md](AGENTS.md) — many reports describe documented
  behavior.
- **Snapshots are goldens.** The files under `tests/__snapshots__/` are
  pinned byte-identical. Never regenerate a snapshot to make a test pass; a
  mismatch is a finding to diagnose. The same holds for the `examples/`
  corpus baselines.
- **Move the docs with the change.** Update JSDoc, [README.md](README.md) and
  [HOST_PROFILE.md](HOST_PROFILE.md) in the same change when your work makes
  them stale. `CHANGELOG.md` is recorded once per iteration by the
  maintainer — put user-facing facts in your pull request description.
- **Use the vocabulary.** Prose and identifiers follow [CONTEXT.md](CONTEXT.md),
  one word per concept.

## Commit Message Guidelines

- Subject: `<area>: TC-NNN — <what changed>` when working a queue task;
  `<area>: <what changed>` otherwise. Areas: `compiler`, `tooling`,
  `examples`, `demo`, `docs`.
- At most 72 characters, imperative, phrased to read in
  `git log --oneline`.
- Add a body only when it carries something the diff cannot show — a ruling,
  a deviation, a follow-up task, an unrunnable gate — in at most 3 lines. No
  file lists, no gate transcripts, no restatement of the subject.

## License

[MIT](LICENSE), © Zeix AG. By contributing to this repository, you license
your contribution under the same terms.
