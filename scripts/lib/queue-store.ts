/**
 * The queue store: one file per task under queue/, with BACKLOG.md and
 * DONE.md as generated markdown views and the live board as the iteration's
 * working view (owner ruling 2026-10-10).
 *
 * Source files (hand-edited):
 *   queue/TC-NNN.md    One task. YAML front matter carries the machine fields;
 *                      the body is the entry prose, dedented.
 *   queue/BANDS.md     The BACKLOG view's prose: the static explainer and the
 *                      band preambles, one `## <band>` section each.
 *   queue/ITERATION.md The iteration header, the rulings, and the chain.
 *   queue/LEDGER.md    The DONE view's prose: compaction policy, rulings
 *                      carried, open obligations, standing notes.
 *
 * Generated views (committed, by `bun run queue:build`):
 *   BACKLOG.md         BANDS.md with each band's open, unchained entries appended.
 *   DONE.md            LEDGER.md with every settled task appended.
 *
 * Live view (not a file): `bun run queue:serve` renders the board — a small
 * Le Truc app compiled from demo/ by this repo's own compiler — straight from
 * this store, and pushes a fresh snapshot over SSE whenever queue/ changes.
 * It replaces the TODO.md view: lanes are derived, never stored.
 *
 * A task's position is derived, never stored: the chain names the iteration,
 * the status names the lane. `check` fails when a markdown view is stale or a
 * task file is malformed. IDs are unique by construction (the filename is the
 * ID). Every write is atomic (temp file + rename) so the board's watcher and
 * a concurrent reader never parse half a file.
 */

import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type TaskStatus =
	| 'open'
	| 'in-progress'
	| 'pending-review'
	| 'in-review'
	| 'done'
	| 'changes-requested'
	| 'reviewed'
	| 'blocked'
	| 'closed'
	| 'parked'

export interface QueueTask {
	id: string
	title: string
	area: string
	status: TaskStatus
	/** Free-form tail for `parked`/`closed` ("moot, demand-gated"). */
	note?: string | undefined
	needs: string[]
	gates: string[]
	/** The BACKLOG band the task belongs to (P1…P7); iteration tasks keep their origin band. */
	band: string
	/** Body prose, dedented. Empty when the entry has none. */
	body: string
	/** Source path, for problem messages. */
	path: string
}

const STATUSES: TaskStatus[] = [
	'open',
	'in-progress',
	'pending-review',
	'in-review',
	'done',
	'changes-requested',
	'reviewed',
	'blocked',
	'closed',
	'parked',
]

/** The ` — suffix` text each status renders as on a title line. */
export const STATUS_TAILS: Record<TaskStatus, string | null> = {
	open: null,
	'in-progress': 'in progress ⚙',
	'pending-review': 'done, pending review ⏳',
	'in-review': 'in review 🔍',
	done: 'done ✓',
	'changes-requested': 'changes requested ↩',
	reviewed: 'reviewed ✓',
	blocked: 'blocked ⛔',
	closed: 'closed ✕',
	parked: 'parked ⏸',
}

const AREAS = ['compiler', 'tooling', 'examples', 'demo', 'docs', 'design']

/** A `closed` task never happened (moot, won't do) but its number is spent. */
export const TERMINAL: TaskStatus[] = [
	'pending-review',
	'in-review',
	'done',
	'reviewed',
	'closed',
]

/** A prerequisite is satisfied by any of these statuses, or by a LEDGER mention. */
const SATISFIED: TaskStatus[] = [
	'pending-review',
	'in-review',
	'done',
	'changes-requested',
	'reviewed',
	'closed',
]

// ── Front matter ──────────────────────────────────────────────────────────────

function parseFrontMatter(
	text: string,
	path: string,
): { fields: Map<string, string>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
	if (!match || !match[1] || match[2] === undefined)
		throw new StoreError(path, 'no YAML front matter block')
	const fields = new Map<string, string>()
	for (const line of match[1].split('\n')) {
		const field = /^([a-z]+):\s*(.*)$/.exec(line)
		if (!field || !field[1] || field[2] === undefined)
			throw new StoreError(
				path,
				'front matter line is not "key: value" — ' + JSON.stringify(line),
			)
		fields.set(field[1], field[2].trim())
	}
	return { fields, body: match[2].replace(/^\n+/, '').replace(/\n$/, '') }
}

export class StoreError extends Error {
	constructor(path: string, message: string) {
		super(`${path}: ${message}`)
	}
}

export function parseTaskFile(text: string, path: string): QueueTask {
	const { fields, body } = parseFrontMatter(text, path)
	const id = fields.get('id')
	const title = fields.get('title')
	const area = fields.get('area')
	const status = fields.get('status') as TaskStatus | undefined
	if (!id || !/^TC-\d+$/.test(id))
		throw new StoreError(path, 'front matter has no `id: TC-NNN`')
	if (!title) throw new StoreError(path, 'front matter has no `title:`')
	if (!area || !AREAS.includes(area)) {
		throw new StoreError(
			path,
			`front matter has no known \`area:\` (${AREAS.join(', ')}); got ${JSON.stringify(area ?? '')}`,
		)
	}
	if (!status || !STATUSES.includes(status)) {
		throw new StoreError(
			path,
			`front matter has no known \`status:\` (${STATUSES.join(', ')}); got ${JSON.stringify(status ?? '')}`,
		)
	}
	const note = fields.get('note')
	const list = (key: string): string[] => {
		const raw = fields.get(key)
		if (!raw) return []
		const inner = /^\[(.*)\]$/.exec(raw)
		if (!inner || inner[1] === undefined)
			throw new StoreError(
				path,
				`\`${key}:\` must be a bracketed list — ${JSON.stringify(raw)}`,
			)
		return inner[1]
			.split(',')
			.map(s => s.trim())
			.filter(Boolean)
	}
	return {
		id,
		title,
		area,
		status,
		note,
		needs: list('needs'),
		gates: list('gates'),
		band: fields.get('band') ?? '',
		body,
		path,
	}
}

export function renderTaskFile(task: QueueTask): string {
	const fields = [
		`id: ${task.id}`,
		`title: ${task.title}`,
		`area: ${task.area}`,
		`status: ${task.status}`,
		...(task.note ? [`note: ${task.note}`] : []),
		`needs: [${task.needs.join(', ')}]`,
		`gates: [${task.gates.join(', ')}]`,
		`band: ${task.band}`,
	]
	return `---\n${fields.join('\n')}\n---\n\n${task.body ? `${task.body}\n` : ''}`
}

/** Every TC-ID a text mentions — how a compacted LEDGER entry satisfies a Needs line. */
export const mentionedIds = (text: string): Set<string> =>
	new Set(text.match(/\bTC-\d+\b/g) ?? [])

/** Write atomically: a watcher or concurrent reader never sees half a file. */
export function writeFileAtomic(path: string, text: string): void {
	const temp = `${path}.tmp`
	writeFileSync(temp, text)
	renameSync(temp, path)
}

// ── The store ─────────────────────────────────────────────────────────────────

export interface Store {
	tasks: Map<string, QueueTask>
	/** queue/BANDS.md, queue/ITERATION.md, queue/LEDGER.md — raw text. */
	bands: string
	iteration: string
	ledger: string
	problems: string[]
}

export function loadStore(root: string): Store {
	const dir = join(root, 'queue')
	const tasks = new Map<string, QueueTask>()
	const problems: string[] = []
	for (const name of readdirSync(dir).sort()) {
		if (!/^TC-\d+\.md$/.test(name)) continue
		const path = join(dir, name)
		try {
			const task = parseTaskFile(readFileSync(path, 'utf8'), `queue/${name}`)
			if (task.id !== name.replace(/\.md$/, '')) {
				problems.push(
					`queue/${name}: front matter id ${task.id} does not match the filename`,
				)
			}
			const existing = tasks.get(task.id)
			if (existing)
				problems.push(
					`${task.id} is stored twice: ${existing.path} and queue/${name}`,
				)
			else tasks.set(task.id, task)
		} catch (e) {
			problems.push(String(e))
		}
	}
	const read = (name: string): string => {
		try {
			return readFileSync(join(dir, name), 'utf8')
		} catch {
			problems.push(`queue/${name} is missing`)
			return ''
		}
	}
	return {
		tasks,
		bands: read('BANDS.md'),
		iteration: read('ITERATION.md'),
		ledger: read('LEDGER.md'),
		problems,
	}
}

// ── The chain ─────────────────────────────────────────────────────────────────

const byIdNumber = (a: QueueTask, b: QueueTask): number =>
	Number(a.id.slice(3)) - Number(b.id.slice(3))

/** The chain's bare TC-IDs in pick order: parentheticals, possessive citations and
 * `∥`/`→` structure reduced to one flat sequence per track. */
export function chainOrder(iteration: string): {
	tracks: { name: string; ids: string[] }[]
	closed: Set<string>
} {
	const lines = iteration.split('\n')
	const start = lines.findIndex(l => /^\*\*The chain\.\*\*/.test(l))
	const tracks: { name: string; ids: string[] }[] = []
	const closed = new Set<string>()
	if (start === -1) return { tracks, closed }
	let raw: string | null = null
	let name = ''
	const flush = () => {
		if (raw === null) return
		const rest = raw
		raw = null
		for (const m of rest.matchAll(/~~\s*(TC-\d+)/g)) if (m[1]) closed.add(m[1])
		let flat = rest
		let prev = ''
		while (flat !== prev) {
			prev = flat
			flat = flat.replace(/\([^()]*\)/g, ' ').replace(/~~.*?~~/g, ' ')
		}
		const ids: string[] = []
		for (const segment of flat.split(/\s*[→∥]\s*/)) {
			for (const m of segment.matchAll(/TC-\d+/g)) {
				const after = segment.slice((m.index ?? 0) + m[0].length)
				if (/^'s|^’s/.test(after) || /^\s+step\s+\d+['’]s/.test(after)) continue
				ids.push(m[0])
			}
		}
		// A track whose ids are all struck is closed (the gate-zero pattern) and
		// contributes nothing; a track with live positions stays open even when
		// it also strikes one id (`~~TC-371~~ → TC-375 → …`).
		if (ids.length) tracks.push({ name, ids })
	}
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? ''
		if (line.trim() === '') continue
		const bullet = /^- \*\*(.+?)\*\*(.*)$/.exec(line)
		if (bullet) {
			flush()
			name = bullet[1] ?? ''
			raw = bullet[2] ?? ''
		} else if (raw !== null && /^\s/.test(line)) {
			raw += ` ${line.trim()}`
		} else break
	}
	flush()
	return { tracks, closed }
}

export const flatChain = (store: Store): string[] =>
	chainOrder(store.iteration).tracks.flatMap(t => t.ids)

// ── Readiness (the single source the pick, the check and the board share) ─────

const needSatisfied = (id: string, store: Store): boolean => {
	const target = store.tasks.get(id)
	if (target) return SATISFIED.includes(target.status)
	return mentionedIds(store.ledger).has(id)
}

function unsatisfiedNeeds(task: QueueTask, store: Store): string | null {
	const missing = task.needs.filter(id => !needSatisfied(id, store))
	if (!missing.length) return null
	const detail = missing
		.map(id => {
			const target = store.tasks.get(id)
			if (!target) return `${id} (compacted record absent from LEDGER.md)`
			return `${id} is ${target.status === 'open' ? 'open' : STATUS_TAILS[target.status]}`
		})
		.join('; ')
	return `its Needs are unsatisfied: ${detail}`
}

/** A track position is passable when the task standing there is satisfied or
 * blocked — the chain rule that lets a blocked task's track continue. */
const passable = (task: QueueTask | undefined): boolean =>
	!!task && (SATISFIED.includes(task.status) || task.status === 'blocked')

/** The documented ready rule, verbatim: no suffix, not design, Needs satisfied,
 * and every earlier task in its track satisfied or blocked. */
function readyReason(task: QueueTask, store: Store): string | null {
	if (task.area === 'design')
		return 'it is Area: design — the queue never auto-picks it'
	const needs = unsatisfiedNeeds(task, store)
	if (needs) return needs
	for (const track of chainOrder(store.iteration).tracks) {
		const at = track.ids.indexOf(task.id)
		if (at === -1) continue
		const earlier = track.ids
			.slice(0, at)
			.map(id => store.tasks.get(id))
			.find(t => t && !passable(t))
		if (earlier)
			return `${earlier.id} stands ahead of it in track "${track.name}" and is ${earlier.status === 'open' ? 'open' : STATUS_TAILS[earlier.status]}`
	}
	return null
}

// ── The board snapshot (what queue:serve renders and pushes) ──────────────────

export type BoardLane =
	| 'waiting'
	| 'ready'
	| 'in-progress'
	| 'review-pending'
	| 'in-review'
	| 'done'

export const BOARD_LANES: readonly BoardLane[] = [
	'waiting',
	'ready',
	'in-progress',
	'review-pending',
	'in-review',
	'done',
]

export interface BoardTask {
	id: string
	title: string
	area: string
	lane: BoardLane
	/** Position within the lane; the board sorts by it. */
	order: number
	/** Space-joined badge words: `rework`, `blocked`, `reviewed`, `closed`, … */
	badges: string
	/** Why a waiting task is not ready; empty when the store cannot say. */
	hint: string
}

export interface BoardSnapshot {
	meta: {
		title: string
		generatedAt: string
		problems: string[]
	}
	/** Each lane carries its own task slice: the board seeds one list per lane. */
	lanes: Array<{ key: BoardLane; count: number; tasks: BoardTask[] }>
}

/** The lane a chain task sits in. The odd statuses, by owner ruling
 * 2026-10-10: `changes-requested` is rework — ready, picked first; `blocked`
 * stays in-progress; `closed` and `reviewed` are done-lane facts. */
const laneOf = (
	task: QueueTask,
	store: Store,
): { lane: BoardLane; badge?: string; hint?: string } => {
	switch (task.status) {
		case 'changes-requested':
			return { lane: 'ready', badge: 'rework' }
		case 'in-progress':
			return { lane: 'in-progress' }
		case 'blocked':
			return { lane: 'in-progress', badge: 'blocked' }
		case 'pending-review':
			return { lane: 'review-pending' }
		case 'in-review':
			return { lane: 'in-review' }
		case 'done':
			return { lane: 'done' }
		case 'reviewed':
			return { lane: 'done', badge: 'reviewed' }
		case 'closed':
			return { lane: 'done', badge: 'closed' }
		case 'open': {
			const reason = readyReason(task, store)
			return reason ? { lane: 'waiting', hint: reason } : { lane: 'ready' }
		}
		case 'parked':
			return { lane: 'waiting', badge: 'parked', hint: 'parked — backlog only' }
	}
}

/** Lane-local ordering, by the same ruling: rework leads ready, blocked leads
 * in-progress, reviewed leads done, closed trails it; everything else follows
 * the chain. */
const laneRank = (task: QueueTask): number => {
	switch (task.status) {
		case 'changes-requested':
			return 0
		case 'blocked':
			return 0
		case 'reviewed':
			return 0
		case 'closed':
			return 2
		default:
			return 1
	}
}

/** The board's data: chain tasks only (the BACKLOG owns the rest), each with
 * its lane, order and badges. Invalid store files are skipped by loadStore;
 * their problems ride in meta.problems so the board can show them. */
export function boardSnapshot(store: Store): BoardSnapshot {
	const chain = flatChain(store)
	const chainAt = new Map(chain.map((id, i) => [id, i]))
	const placed: Array<{ task: QueueTask } & ReturnType<typeof laneOf>> = []
	for (const id of chain) {
		const task = store.tasks.get(id)
		if (!task) continue
		placed.push({ task, ...laneOf(task, store) })
	}
	const sorted = [...placed].sort((a, b) => {
		const rank = laneRank(a.task) - laneRank(b.task)
		if (rank !== 0) return rank
		const lane = a.lane.localeCompare(b.lane)
		if (lane !== 0) return lane
		// Within one lane and rank: rework/blocked/reviewed by chain order
		// (done-lane reviewed by id when pruned) — chain order is the default.
		if (a.lane === 'done' && a.task.status !== 'in-progress')
			return byIdNumber(a.task, b.task)
		return (chainAt.get(a.task.id) ?? 0) - (chainAt.get(b.task.id) ?? 0)
	})
	const order = new Map(sorted.map((p, i) => [p.task.id, i]))
	const tasks: BoardTask[] = sorted.map(p => ({
		id: p.task.id,
		title: p.task.title,
		area: p.task.area,
		lane: p.lane,
		order: order.get(p.task.id) ?? 0,
		badges: [
			...(p.badge ? [p.badge] : []),
			...(p.task.note ? [p.task.note] : []),
		].join(' '),
		hint: p.hint ?? '',
	}))
	const lanes = BOARD_LANES.map(key => ({
		key,
		count: tasks.filter(t => t.lane === key).length,
		tasks: tasks.filter(t => t.lane === key),
	}))
	const title =
		(/^#\s+(.+)$/m.exec(store.iteration)?.[1] ?? '').trim() || 'Task queue'
	return {
		meta: {
			title,
			generatedAt: new Date().toISOString(),
			problems: store.problems,
		},
		lanes,
	}
}

// ── Markdown views ────────────────────────────────────────────────────────────

/** `- [x] TC-410: Title — done ✓` — the title line exactly as the markdown views write it. */
export function renderTitleLine(task: QueueTask): string {
	const settled = TERMINAL.includes(task.status)
	const tail =
		task.status === 'parked' || task.status === 'closed'
			? (task.note ?? STATUS_TAILS[task.status])
			: STATUS_TAILS[task.status]
	return `- [${settled ? 'x' : ' '}] ${task.id}: ${task.title}${tail ? ` — ${tail}` : ''}`
}

/** The entry block as it appears in a markdown view: title line, the machine
 * fields as body lines (they live in front matter in the store), then the
 * prose body — indented two spaces, blank lines collapsed away. */
export function renderEntry(task: QueueTask): string {
	const fields = [
		`**Area:** ${task.area}`,
		...(task.needs.length ? [`**Needs:** ${task.needs.join(', ')}`] : []),
		...(task.gates.length ? [`**Gates:** ${task.gates.join(', ')}`] : []),
	]
	const body = [...fields, ...task.body.split('\n')]
		.map(line => (line.trim() === '' ? '' : `  ${line}`))
		.filter((line, i, all) => !(line === '' && all[i - 1] === ''))
		.join('\n')
	return `${renderTitleLine(task)}${body ? `\n${body}` : ''}`
}

export function renderBacklog(store: Store): string {
	const chainIds = new Set(flatChain(store))
	const open = [...store.tasks.values()]
		.filter(t => !TERMINAL.includes(t.status) && !chainIds.has(t.id))
		.sort(byIdNumber)
	// Insert each band's tasks at the end of its `##` section. A task matches its
	// band by whole-word prefix, so P2 does not swallow a P2b heading.
	const sections = [...store.bands.matchAll(/^## (.+)$/gm)].map(m => m[1] ?? '')
	const inBand = (task: QueueTask, section: string): boolean =>
		Boolean(task.band) &&
		(section === task.band || section.startsWith(`${task.band} `))
	let out = store.bands.replace(/\n?$/, '\n')
	for (const section of sections) {
		const members = open.filter(t => inBand(t, section))
		if (members.length) {
			out = insertUnderHeading(
				out,
				section,
				members.map(renderEntry).join('\n\n'),
			)
		}
	}
	const unbanded = open.filter(
		t => !sections.some(section => inBand(t, section)),
	)
	if (unbanded.length) {
		out += `\n## Unbanded\n\n${unbanded.map(renderEntry).join('\n\n')}\n`
	}
	return out
}

function insertUnderHeading(
	markdown: string,
	heading: string,
	block: string,
): string {
	const at = markdown.indexOf(`## ${heading}`)
	if (at === -1) return markdown
	let end = markdown.length
	for (const m of markdown.slice(at + 3).matchAll(/^## /gm)) {
		end = at + 3 + (m.index ?? 0)
		break
	}
	const before = markdown.slice(0, end).replace(/\n?$/, '\n')
	return `${before}\n${block}\n${markdown.slice(end).replace(/^\n+/, '\n')}`
}

export function renderDone(store: Store): string {
	const done = [...store.tasks.values()]
		.filter(t => TERMINAL.includes(t.status))
		.sort(byIdNumber)
	const base = store.ledger.replace(/\n?$/, '\n')
	if (!done.length) return base
	return `${base}\n${done.map(renderEntry).join('\n\n')}\n`
}

/** Regenerate the markdown views from the store. The board is live and needs
 * no build. `outDir` defaults to the repo root; tests pass a scratch dir. */
export function buildViews(
	root: string,
	outDir: string = root,
): { written: string[]; problems: string[] } {
	const store = loadStore(root)
	const problems = [...store.problems]
	if (problems.length) return { written: [], problems }
	const views: [string, string][] = [
		['BACKLOG.md', renderBacklog(store)],
		['DONE.md', renderDone(store)],
	]
	for (const [name, text] of views) {
		writeFileAtomic(join(outDir, name), text)
	}
	return { written: views.map(([name]) => name), problems }
}

// ── Store validation (the `check` meaning) ────────────────────────────────────

export function checkStore(root: string): {
	problems: string[]
	notes: string[]
} {
	const store = loadStore(root)
	const problems = [...store.problems]
	const notes: string[] = []
	const ids = new Set(store.tasks.keys())
	const ledgerMentions = mentionedIds(store.ledger)
	const tracks = chainOrder(store.iteration).tracks

	for (const task of store.tasks.values()) {
		for (const need of task.needs) {
			if (!ids.has(need) && !ledgerMentions.has(need)) {
				problems.push(
					`${task.id} needs ${need}, which no task file declares or LEDGER.md mentions`,
				)
			}
		}
		if (
			!task.band &&
			task.status === 'open' &&
			!tracks.some(t => t.ids.includes(task.id))
		) {
			notes.push(
				`${task.id} is open, unbanded and unchained — give it a band or a chain position`,
			)
		}
		// Parked is a backlog state by ruling: not eligible for the iteration
		// until the Architect and the owner refine it back to open.
		if (task.status === 'parked' && flatChain(store).includes(task.id)) {
			problems.push(
				`${task.id} is parked but named by the chain — refine it (status: open) or remove it from the chain`,
			)
		}
	}
	for (const track of tracks) {
		for (const id of track.ids) {
			if (!ids.has(id) && !ledgerMentions.has(id)) {
				problems.push(
					`The chain names ${id} (${track.name}), which no task file declares or LEDGER.md mentions`,
				)
			}
		}
	}
	let stale: Record<string, string>
	try {
		stale = {
			'BACKLOG.md': renderBacklog(store),
			'DONE.md': renderDone(store),
		}
	} catch (e) {
		problems.push(String(e))
		return { problems, notes }
	}
	for (const [name, rendered] of Object.entries(stale)) {
		try {
			const current = readFileSync(join(root, name), 'utf8')
			if (current !== rendered)
				problems.push(
					`${name} is stale against queue/ — run bun run queue:build`,
				)
		} catch {
			problems.push(`${name} is missing — run bun run queue:build`)
		}
	}
	return { problems, notes }
}

// ── Pick and writes (the contributor queue operations) ────────────────────────
// The chain lives in ITERATION.md, statuses in front matter, and every write
// re-renders the markdown views so `check` never sees a stale one. NOTES.md is
// not a view — blocked prose lands in the main checkout's file as before.

export interface StorePick {
	picked: boolean
	task: QueueTask | null
	reason: string
}

export interface WriteResult {
	ok: boolean
	error?: string
}

export function pickStore(root: string): StorePick {
	const store = loadStore(root)
	if (store.problems.length)
		return {
			picked: false,
			task: null,
			reason: `the store is invalid: ${store.problems[0] ?? 'unknown problem'}`,
		}

	// Rework first, in chain order — the board's ready lane leads with it too.
	for (const id of flatChain(store)) {
		const task = store.tasks.get(id)
		if (task?.status === 'changes-requested')
			return {
				picked: true,
				task,
				reason: 'rework: the task carries — changes requested ↩',
			}
	}

	// First ready task, tracks in order. Same stall rule as the chain: a
	// claimed or unpassable task standing first ends its own track, and the
	// scan falls through to the next.
	let firstStall: string | null = null
	for (const track of chainOrder(store.iteration).tracks) {
		for (const id of track.ids) {
			const task = store.tasks.get(id)
			// Only a declared task picks or blocks here; compacted ids ride the
			// task's Needs line instead.
			if (!task) continue
			if (task.area === 'design') continue
			if (passable(task)) continue
			const notReady =
				task.status === 'in-progress'
					? 'it is in progress ⚙ (claimed by a running session)'
					: task.status === 'blocked'
						? 'it is blocked ⛔ (the track continues past it)'
						: readyReason(task, store)
			if (notReady) {
				firstStall ??= `${id} (${track.name}) stands first and ${notReady}`
				break
			}
			return {
				picked: true,
				task,
				reason: `first ready task in track "${track.name}"`,
			}
		}
	}

	const openCount = [...store.tasks.values()].filter(
		t =>
			t.status === 'open' &&
			t.area !== 'design' &&
			flatChain(store).includes(t.id),
	).length
	return {
		picked: false,
		task: null,
		reason: firstStall
			? `no ready task: ${firstStall}`
			: openCount > 0
				? `no ready task: ${openCount} open non-design chain task${openCount === 1 ? ' is' : 's are'} not first-ready in ${openCount === 1 ? 'its' : 'their'} track`
				: 'no open non-design chain tasks: the iteration needs planning',
	}
}

/** Pick a named task instead of the chain's first ready one: stored, not
 * design, named by the chain (a BACKLOG task is not pickable), Needs satisfied. */
export function pickByIdStore(id: string, root: string): StorePick {
	const store = loadStore(root)
	if (store.problems.length)
		return {
			picked: false,
			task: null,
			reason: `the store is invalid: ${store.problems[0] ?? 'unknown problem'}`,
		}
	const task = store.tasks.get(id)
	if (!task)
		return {
			picked: false,
			task: null,
			reason: `${id} is stored by no task file`,
		}
	if (!flatChain(store).includes(id))
		return {
			picked: false,
			task: null,
			reason: `${id} is not named by the chain; it is a BACKLOG task`,
		}
	if (task.status === 'changes-requested')
		return {
			picked: true,
			task,
			reason: 'named task carrying — changes requested ↩ (rework)',
		}
	if (task.status !== 'open')
		return {
			picked: false,
			task: null,
			reason: `${id} is not open (status: ${task.status})`,
		}
	if (task.area === 'design')
		return {
			picked: false,
			task: null,
			reason: `${id} is Area: design; the queue never auto-picks it`,
		}
	const notReady = readyReason(task, store)
	if (notReady)
		return {
			picked: false,
			task: null,
			reason: `${id} is not ready: ${notReady}`,
		}
	return { picked: true, task, reason: 'named task, ready per the contract' }
}

// Every store write: re-read the task file, guard the expected status, mutate
// the front matter or body, rewrite atomically, then rebuild the markdown
// views. The board needs no rebuild — it reads the store live.

const writeTask = (root: string, task: QueueTask): string | null => {
	try {
		writeFileAtomic(join(root, 'queue', `${task.id}.md`), renderTaskFile(task))
	} catch (e) {
		return String(e)
	}
	const built = buildViews(root)
	return built.problems.length ? built.problems.join('; ') : null
}

/** Claim an open or changes-requested task: its status becomes `in-progress`. */
export function claimTaskStore(root: string, id: string): WriteResult {
	const store = loadStore(root)
	const task = store.tasks.get(id)
	if (!task) return { ok: false, error: `${id} is stored by no task file` }
	if (!flatChain(store).includes(id))
		return {
			ok: false,
			error: `${id} is not named by the chain; only chain tasks are pickable`,
		}
	if (task.status !== 'open' && task.status !== 'changes-requested')
		return {
			ok: false,
			error: `${id} carries "${task.status}"; only open or changes-requested tasks are claimable`,
		}
	const error = writeTask(root, { ...task, status: 'in-progress' })
	return error ? { ok: false, error } : { ok: true }
}

/** Write the run's outcome: flip the status and append the handoff prose to
 * the task body — except blocked, whose prose is a NOTES.md entry in the main
 * checkout. A claimed task takes its first outcome; a `pending-review` task
 * takes an addendum (an owner-requested change after the hand-off, owner
 * ruling 2026-10-06). Once the Architect has claimed the review (`in-review`),
 * the entry is the reviewer's until the verdict. */
export function annotateTaskStore(
	root: string,
	id: string,
	suffix: 'pending-review' | 'done' | 'blocked',
	prose: string,
): WriteResult {
	const store = loadStore(root)
	const task = store.tasks.get(id)
	if (!task) return { ok: false, error: `${id} is stored by no task file` }
	if (task.status === 'in-review')
		return {
			ok: false,
			error: `${id} is in review (claimed by the Architect); its entry takes no annotation until the verdict`,
		}
	if (task.status !== 'in-progress' && task.status !== 'pending-review')
		return {
			ok: false,
			error: `${id} carries "${task.status}"; annotate only a claimed (in-progress) or pending-review task`,
		}

	if (suffix === 'blocked') {
		const notesPath = join(root, 'NOTES.md')
		const notes = readFileSync(notesPath, 'utf8')
		const separator = notes.indexOf('\n---\n')
		if (separator === -1)
			return {
				ok: false,
				error: 'NOTES.md has no `---` separator to insert below',
			}
		const insertAt = separator + '\n---\n'.length
		writeFileAtomic(
			notesPath,
			`${notes.slice(0, insertAt)}\n${prose.trim()}\n${notes.slice(insertAt)}`,
		)
	} else if (prose.trim()) {
		task.body = task.body ? `${task.body}\n\n${prose.trim()}` : prose.trim()
	}
	const error = writeTask(root, { ...task, status: suffix })
	return error ? { ok: false, error } : { ok: true }
}

/** Claim a `pending-review` task for review: its status becomes `in-review`,
 * which freezes the entry against annotation until the Architect's verdict
 * (a `status:` edit to `reviewed` or `changes-requested`). */
export function reviewTaskStore(root: string, id: string): WriteResult {
	const store = loadStore(root)
	const task = store.tasks.get(id)
	if (!task) return { ok: false, error: `${id} is stored by no task file` }
	if (task.status !== 'pending-review')
		return {
			ok: false,
			error: `${id} carries "${task.status}"; only pending-review tasks are claimable for review`,
		}
	const error = writeTask(root, { ...task, status: 'in-review' })
	return error ? { ok: false, error } : { ok: true }
}

/** Release a claim (the recover path when a session dies): a claimed task
 * returns to open, a claimed review to pending-review. */
export function resetTaskStore(root: string, id: string): WriteResult {
	const store = loadStore(root)
	const task = store.tasks.get(id)
	if (!task) return { ok: false, error: `${id} is stored by no task file` }
	if (task.status !== 'in-progress' && task.status !== 'in-review')
		return { ok: false, error: `${id} is not claimed (status: ${task.status})` }
	const error = writeTask(root, {
		...task,
		status: task.status === 'in-review' ? 'pending-review' : 'open',
	})
	return error ? { ok: false, error } : { ok: true }
}
