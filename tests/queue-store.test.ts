/** The queue store contract (scripts/lib/queue-store.ts): parsing, the chain, the lane rulings, readiness, and the write operations — against scratch stores under a temp dir. */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	annotateTaskStore,
	boardSnapshot,
	buildViews,
	chainOrder,
	checkStore,
	claimTaskStore,
	flatChain,
	loadStore,
	parseTaskFile,
	pickByIdStore,
	pickStore,
	renderTaskFile,
} from '../scripts/lib/queue-store'

const task = (
	id: string,
	fields: Record<string, string> = {},
	body = 'Body prose.',
): string =>
	renderTaskFile({
		id,
		title: fields.title ?? `Task ${id}`,
		area: fields.area ?? 'compiler',
		status: (fields.status ?? 'open') as never,
		...(fields.note ? { note: fields.note } : {}),
		needs: (fields.needs ?? '')
			.split(',')
			.map(part => part.trim())
			.filter(Boolean),
		gates: [],
		band: fields.band ?? '',
		body,
		path: `queue/${id}.md`,
	})

const ITERATION = `# Iteration — test

**Next free task ID:** TC-900

**The chain.**

- **First track** The first purpose. In pick order:
  1. TC-101 — First
  2. TC-102 — Second
  3. TC-103 — Third
- **Second track** The second purpose:
  1. TC-104 — Fourth
`

// The double-card bug's shape: the second track cites TC-101 in prose —
// a citation is not a position; TC-104's is the only one the track names.
const CITED_ITERATION = `# Iteration — test

**Next free task ID:** TC-900

**The chain.**

- **First track** The first purpose. In pick order:
  1. TC-101 — First
  2. TC-102 — Second
  3. TC-103 — Third
- **Second track** Behind TC-101, whose helper dissolves the closures
  first; TC-102 lands alongside:
  1. TC-104 — Fourth, after TC-103's census
`

// The TC-065 stall: an open design task cited only in a track's description
// stood ahead of the track's first numbered item.
const PROSE_DESIGN_ITERATION = `# Iteration — test

**Next free task ID:** TC-900

**The chain.**

- **Track 1 — The walk.** The construct becomes projectable. TC-059 (the
  boundary's authored form) is design work outside the chain. In pick order:
  1. TC-021 — The operation layer
  2. TC-065 — One walk
`

// A genuine duplicate: one id leads numbered items in two tracks.
const DOUBLED_ITERATION = `# Iteration — test

**Next free task ID:** TC-900

**The chain.**

- **First track** The first purpose:
  1. TC-101 — First
  2. TC-102 — Second
- **Second track** The second purpose:
  1. TC-101 — First, again
  2. TC-104 — Fourth
`

const scaffold = (iteration: string = ITERATION): string => {
	const root = mkdtempSync(join(tmpdir(), 'queue-store-'))
	mkdirSync(join(root, 'queue'))
	writeFileSync(join(root, 'queue', 'ITERATION.md'), iteration)
	writeFileSync(join(root, 'queue', 'BANDS.md'), '# Backlog\n\n## P1 — next\n')
	writeFileSync(join(root, 'queue', 'LEDGER.md'), '# Done\n')
	return root
}

const write = (
	root: string,
	id: string,
	fields: Record<string, string>,
): void => writeFileSync(join(root, 'queue', `${id}.md`), task(id, fields))

const cleanup: string[] = []
afterAll(() => {
	for (const root of cleanup) rmSync(root, { recursive: true, force: true })
})

const store = (iteration: string = ITERATION): string => {
	const root = scaffold(iteration)
	cleanup.push(root)
	return root
}

describe('task file round-trip', () => {
	test('parse and render are inverse', () => {
		const text = task('TC-001', { needs: 'TC-002, TC-003', note: 'moot' })
		const parsed = parseTaskFile(text, 'queue/TC-001.md')
		expect(parsed.needs).toEqual(['TC-002', 'TC-003'])
		expect(parsed.note).toBe('moot')
		expect(renderTaskFile(parsed)).toBe(text)
	})

	test('a TC id is required', () => {
		expect(() => parseTaskFile(task('LT-001'), 'queue/LT-001.md')).toThrow(
			/id: TC-NNN/,
		)
	})

	test('an unknown area is refused', () => {
		expect(() =>
			parseTaskFile(task('TC-001', { area: 'runtime' }), 'queue/TC-001.md'),
		).toThrow(/area/)
	})
})

describe('chain parsing', () => {
	test('numbered items reduce to id sequences per track', () => {
		const { tracks, duplicates } = chainOrder(ITERATION)
		expect(tracks.map(t => t.name)).toEqual(['First track', 'Second track'])
		expect(tracks[0]?.ids).toEqual(['TC-101', 'TC-102', 'TC-103'])
		expect(tracks[1]?.ids).toEqual(['TC-104'])
		expect(duplicates).toEqual([])
	})

	test('an item led by a struck id is closed, not a position', () => {
		const struck = ITERATION.replace(
			'  1. TC-104 — Fourth',
			'  1. ~~TC-104~~ — Fourth',
		)
		const { tracks, closed } = chainOrder(struck)
		expect(tracks.map(t => t.name)).toEqual(['First track'])
		expect([...closed]).toEqual(['TC-104'])
	})
})

describe('first-mention chain positions (2026-10-10)', () => {
	test('a TC-ID in track description prose is not a position', () => {
		const { tracks, duplicates } = chainOrder(CITED_ITERATION)
		expect(tracks.map(t => t.name)).toEqual(['First track', 'Second track'])
		expect(tracks[0]?.ids).toEqual(['TC-101', 'TC-102', 'TC-103'])
		expect(tracks[1]?.ids).toEqual(['TC-104'])
		expect(duplicates).toEqual([])
		expect(flatChain(loadStore(store(CITED_ITERATION)))).toEqual([
			'TC-101',
			'TC-102',
			'TC-103',
			'TC-104',
		])
	})

	test('a TC-ID cited in an item title after the leading id is not a position', () => {
		const { tracks } = chainOrder(CITED_ITERATION)
		// `1. TC-104 — Fourth, after TC-103's census` names TC-104 only
		expect(tracks[1]?.ids).toEqual(['TC-104'])
	})

	test('an open design task cited only in prose does not stall the track', () => {
		const root = store(PROSE_DESIGN_ITERATION)
		write(root, 'TC-021', { status: 'reviewed' })
		write(root, 'TC-059', { area: 'design' })
		write(root, 'TC-065', {})
		expect(chainOrder(PROSE_DESIGN_ITERATION).tracks[0]?.ids).toEqual([
			'TC-021',
			'TC-065',
		])
		const pick = pickByIdStore('TC-065', root)
		expect(pick.reason ?? '').not.toContain('TC-059')
		expect(pick.picked).toBe(true)
		expect(pick.task?.id).toBe('TC-065')
		expect(pickStore(root).task?.id).toBe('TC-065')
	})

	test('an id leading two numbered items keeps its first position', () => {
		const { tracks, duplicates } = chainOrder(DOUBLED_ITERATION)
		expect(tracks[0]?.ids).toEqual(['TC-101', 'TC-102'])
		expect(tracks[1]?.ids).toEqual(['TC-104'])
		expect(duplicates).toEqual([
			{ id: 'TC-101', tracks: ['First track', 'Second track'] },
		])
	})

	test('the board renders a cited task exactly once', () => {
		const root = store(CITED_ITERATION)
		write(root, 'TC-101', { status: 'in-progress' })
		write(root, 'TC-102', {})
		write(root, 'TC-104', { needs: 'TC-101' })
		const snap = boardSnapshot(loadStore(root))
		const placed = snap.lanes.flatMap(l => l.tasks)
		expect(placed.filter(t => t.id === 'TC-101')).toHaveLength(1)
		const inProgress = snap.lanes.find(l => l.key === 'in-progress')?.tasks
		expect(inProgress?.map(t => t.id)).toEqual(['TC-101'])
	})

	test('check flags an id leading two numbered items', () => {
		const root = store(DOUBLED_ITERATION)
		for (const id of ['TC-101', 'TC-102', 'TC-103', 'TC-104'])
			write(root, id, {})
		buildViews(root)
		const { problems } = checkStore(root)
		expect(
			problems.some(
				p =>
					p.includes('TC-101 at more than one position') &&
					p.includes('First track') &&
					p.includes('Second track'),
			),
		).toBe(true)
	})

	test('check stays silent for a duplicate-free chain', () => {
		const root = store()
		for (const id of ['TC-101', 'TC-102', 'TC-103', 'TC-104'])
			write(root, id, {})
		buildViews(root)
		expect(checkStore(root).problems).toEqual([])
	})
})

describe('the lane rulings (2026-10-10)', () => {
	test('waiting, ready and done lanes land as ruled', () => {
		const root = store()
		write(root, 'TC-101', {})
		write(root, 'TC-102', { status: 'in-progress', needs: 'TC-101' })
		write(root, 'TC-103', { status: 'reviewed' })
		write(root, 'TC-104', { status: 'closed', note: 'moot' })
		const snap = boardSnapshot(loadStore(root))
		const lane = (key: string) =>
			snap.lanes.find(l => l.key === key)?.tasks.map(t => t.id)
		expect(lane('ready')).toEqual(['TC-101'])
		expect(lane('in-progress')).toEqual(['TC-102'])
		// reviewed leads done; closed trails it
		expect(lane('done')).toEqual(['TC-103', 'TC-104'])
		const badges = Object.fromEntries(
			snap.lanes.flatMap(l => l.tasks).map(t => [t.id, t.badges]),
		)
		expect(badges['TC-103']).toBe('reviewed')
		expect(badges['TC-104']).toBe('closed moot')
	})

	test('rework leads ready; blocked leads in-progress', () => {
		const root = store()
		write(root, 'TC-101', { status: 'changes-requested' })
		write(root, 'TC-102', {})
		write(root, 'TC-103', { status: 'in-progress' })
		write(root, 'TC-104', { status: 'blocked' })
		const snap = boardSnapshot(loadStore(root))
		const lane = (key: string) =>
			snap.lanes.find(l => l.key === key)?.tasks.map(t => t.id)
		expect(lane('ready')).toEqual(['TC-101', 'TC-102'])
		expect(lane('in-progress')).toEqual(['TC-104', 'TC-103'])
	})

	test('a waiting card carries why it is not ready', () => {
		const root = store()
		write(root, 'TC-101', {})
		write(root, 'TC-102', { needs: 'TC-101' })
		const snap = boardSnapshot(loadStore(root))
		const waiting = snap.lanes
			.flatMap(l => l.tasks)
			.find(t => t.id === 'TC-102')
		expect(waiting?.hint).toContain('TC-101')
	})
})

describe('pick and writes', () => {
	test('pick takes the first ready task in track order', () => {
		const root = store()
		write(root, 'TC-101', {})
		write(root, 'TC-102', {})
		const pick = pickStore(root)
		expect(pick.picked).toBe(true)
		expect(pick.task?.id).toBe('TC-101')
	})

	test('rework is picked first, in chain order', () => {
		const root = store()
		write(root, 'TC-101', {})
		write(root, 'TC-102', { status: 'changes-requested' })
		const pick = pickStore(root)
		expect(pick.picked).toBe(true)
		expect(pick.task?.id).toBe('TC-102')
	})

	test('claim and annotate walk the status contract', () => {
		const root = store()
		write(root, 'TC-101', {})
		write(root, 'TC-102', { needs: 'TC-101' })
		expect(claimTaskStore(root, 'TC-101').ok).toBe(true)
		// A claimed task stalls its track: nothing behind it picks until it
		// settles (the double-pickup guard), and a claim does not satisfy needs.
		const stalled = pickStore(root)
		expect(stalled.picked).toBe(false)
		expect(stalled.reason).toContain('in progress ⚙')
		expect(
			annotateTaskStore(root, 'TC-101', 'done', '**Changed:** something'),
		).toMatchObject({ ok: true })
		const done = loadStore(root).tasks.get('TC-101')
		expect(done?.status).toBe('done')
		expect(done?.body).toContain('**Changed:** something')
		expect(pickStore(root).task?.id).toBe('TC-102')
	})

	test('check flags a parked task the chain names', () => {
		const root = store()
		write(root, 'TC-101', { status: 'parked' })
		const { problems } = checkStore(root)
		expect(problems.some(p => p.includes('TC-101 is parked'))).toBe(true)
	})

	test('build renders the markdown views and check accepts them', () => {
		const root = store()
		for (const id of ['TC-101', 'TC-102', 'TC-103', 'TC-104'])
			write(root, id, {})
		const built = buildViews(root)
		expect(built.written).toEqual(['BACKLOG.md', 'DONE.md'])
		expect(checkStore(root).problems).toEqual([])
	})
})
