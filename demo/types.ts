export type BoardLane =
	| 'waiting'
	| 'ready'
	| 'in-progress'
	| 'review-pending'
	| 'in-review'
	| 'done'

// Lane, order and badges are derived by the store; the board never recomputes queue semantics.
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

// The full payload the dev server renders server-side and pushes over SSE.
export type BoardSnapshot = {
	meta: {
		title: string
		generatedAt: string
		problems: string[]
	}
	lanes: Array<{ key: BoardLane; count: number; tasks: BoardTask[] }>
}
