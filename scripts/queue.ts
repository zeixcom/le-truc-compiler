/**
 * Queue tool — deterministic operations over the TC task queue.
 *
 * Subcommands:
 *   check     Validate the store against the contract (entry format, ID
 *             uniqueness, Needs resolution, chain references, parked-in-chain,
 *             stale markdown views). Exit 1 listing every problem; non-fatal
 *             notes are listed too.
 *   pick      Print the pick decision as JSON (read-only; claims nothing).
 *             An optional second argument names a task instead of the chain's
 *             first ready one.
 *   claim     Mark a task — in progress ⚙ (scripts/start-task.ts claims it for a session).
 *   annotate  Write a run's outcome: flip the status, insert the handoff prose
 *             after the entry (or a NOTES.md entry when blocked). Accepts a
 *             claimed task and, for an addendum, a pending-review one; refuses
 *             a task in review.
 *   review    Claim a pending-review task for the Architect's review (in-review).
 *   reset     Release a claim: a claimed task to open, a review to pending-review.
 *   list      The store's tasks as JSON, optionally filtered by status
 *             (read-only discovery for the review pass).
 *   build     Regenerate the markdown views (BACKLOG.md, DONE.md). The board
 *             is live and builds nothing.
 *   snapshot  The board snapshot as JSON — the same payload `queue:serve`
 *             renders and pushes over SSE.
 *
 * The parsing and the writes live in scripts/lib/queue-store.ts. The queue
 * contract is .agents/skills/architect/references/task-queue.md; this tool
 * never moves entries between queue files, never edits ARCHITECTURE.md and
 * never commits.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
	annotateTaskStore,
	boardSnapshot,
	buildViews,
	checkStore,
	claimTaskStore,
	loadStore,
	pickByIdStore,
	pickStore,
	type QueueTask,
	renderEntry,
	resetTaskStore,
	reviewTaskStore,
	type StorePick,
} from './lib/queue-store.ts'

const ROOT = realpathSync(`${import.meta.dir}/..`)

/** The pick decision's task, as scripts/start-task.ts and the contributor skill consume it. */
const taskInfo = (task: QueueTask) => ({
	id: task.id,
	title: task.title,
	area: task.area,
	suffix: task.status,
	rework: task.status === 'changes-requested',
	needs: task.needs,
	gates: task.gates,
	entryText: renderEntry(task),
})

const storeDecision = (p: StorePick): string =>
	JSON.stringify({
		picked: p.picked,
		reason: p.reason,
		...(p.picked && p.task ? { task: taskInfo(p.task) } : {}),
	})

const write = (result: { ok: boolean; error?: string }): number => {
	if (result.ok) return 0
	console.error(result.error)
	return 1
}

const usage = (): number => {
	console.error(
		'usage: queue.ts check | pick [TC-NNN] | claim TC-NNN | annotate TC-NNN <pending-review|done|blocked> <prose-file> | review TC-NNN | reset TC-NNN | list [--status <status>] | build | snapshot',
	)
	return 2
}

const [command, ...args] = process.argv.slice(2)

let exit: number
switch (command) {
	case 'check': {
		const { problems, notes } = checkStore(ROOT)
		for (const note of notes) console.log(`note: ${note}`)
		for (const problem of problems) console.error(`problem: ${problem}`)
		exit = problems.length > 0 ? 1 : 0
		break
	}
	case 'pick': {
		const [id] = args
		if (id && !/^TC-\d+$/.test(id)) {
			exit = usage()
			break
		}
		console.log(storeDecision(id ? pickByIdStore(id, ROOT) : pickStore(ROOT)))
		exit = 0
		break
	}
	case 'claim': {
		const [id] = args
		if (!id) {
			exit = usage()
			break
		}
		exit = write(claimTaskStore(ROOT, id))
		break
	}
	case 'annotate': {
		const [id, suffix, prosePath] = args
		if (
			!id ||
			!suffix ||
			!prosePath ||
			(suffix !== 'pending-review' && suffix !== 'done' && suffix !== 'blocked')
		) {
			exit = usage()
			break
		}
		const prose = readFileSync(prosePath, 'utf8')
		exit = write(annotateTaskStore(ROOT, id, suffix, prose))
		break
	}
	case 'review': {
		const [id] = args
		if (!id) {
			exit = usage()
			break
		}
		exit = write(reviewTaskStore(ROOT, id))
		break
	}
	case 'reset': {
		const [id] = args
		if (!id) {
			exit = usage()
			break
		}
		exit = write(resetTaskStore(ROOT, id))
		break
	}
	case 'list': {
		// Read-only discovery for the review pass and other sweeps: the store's
		// tasks as JSON, optionally filtered by status. Refuses an invalid
		// store, exactly like pick.
		const [flag, value] = args
		if (flag && flag !== '--status') {
			exit = usage()
			break
		}
		const store = loadStore(ROOT)
		if (store.problems.length) {
			for (const problem of store.problems) console.error(`problem: ${problem}`)
			exit = 1
			break
		}
		const tasks = [...store.tasks.values()]
			.filter(t => !flag || t.status === value)
			.sort((a, b) => (a.id < b.id ? -1 : 1))
			.map(t => ({
				id: t.id,
				title: t.title,
				area: t.area,
				status: t.status,
				note: t.note,
				band: t.band,
				needs: t.needs,
				gates: t.gates,
				entry: renderEntry(t),
			}))
		console.log(JSON.stringify({ tasks }))
		exit = 0
		break
	}
	case 'build': {
		const result = buildViews(ROOT)
		if (result.problems.length > 0) {
			for (const problem of result.problems)
				console.error(`problem: ${problem}`)
			exit = 1
			break
		}
		console.log(`built ${result.written.join(', ')}`)
		exit = 0
		break
	}
	case 'snapshot': {
		const store = loadStore(ROOT)
		console.log(JSON.stringify(boardSnapshot(store)))
		exit = 0
		break
	}
	default:
		exit = usage()
		break
}

process.exit(exit)
