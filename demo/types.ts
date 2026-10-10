/**
 * The board's shared data shapes — the contract between the queue store
 * (scripts/lib/queue-store.ts, which computes them), the dev server
 * (server/queue-board.ts, which renders and pushes them) and the component
 * (demo/queue-board.tsx, which displays them).
 *
 * Pure types: no imports, so the component, the emitted modules, the server
 * and the store can all reference one shape without a runtime edge.
 *
 * Every field is a primitive on purpose: the client harvests the initial
 * items from `data-*` raw sites on the rendered cards (ADR 0003), and only
 * strings and numbers round-trip that channel. Badges are one space-joined
 * string; anything the board does not render does not ride the snapshot.
 */

/** The six board lanes, in display order (owner ruling 2026-10-10). */
export type BoardLane =
	| 'waiting'
	| 'ready'
	| 'in-progress'
	| 'review-pending'
	| 'in-review'
	| 'done'

/** One task as the board shows it. Lane, order and badges are derived by the
 * store; the board never recomputes queue semantics. */
export type BoardTask = {
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

/** The full payload the dev server renders server-side and pushes over SSE.
 * Each lane carries its own task slice: the board seeds one list per lane,
 * so a lane's cards are one server-rendered, one-harvest, one-reconcile unit. */
export type BoardSnapshot = {
	meta: {
		title: string
		generatedAt: string
		problems: string[]
	}
	lanes: Array<{ key: BoardLane; count: number; tasks: BoardTask[] }>
}
