/**
 * The board's live channel (client-only). Called from the component's setup,
 * like examples/_common/reorder.ts: the compiler keeps the statement out of
 * the server module, so EventSource is never referenced server-side.
 *
 * One EventSource, one rule: every message replaces the whole payload. The
 * server debounces queue/ writes and always sends a complete snapshot, so the
 * client never merges, diffs or reorders — it sets each lane, and each lane's
 * reactive list reconciles its cards by task id.
 */

import type { BoardSnapshot, BoardTask } from '../types.ts'

/** A lane's seeded list, as the component hands it over. */
interface LaneList {
	set(next: BoardTask[]): void
}

/** What the component hands over: the six lane lists plus the meta cells. */
export interface BoardHandles {
	lanes: {
		waiting: LaneList
		ready: LaneList
		inProgress: LaneList
		reviewPending: LaneList
		inReview: LaneList
		done: LaneList
	}
	heading: {
		set(next: string): void
	}
	updated: {
		set(next: string): void
	}
	issues: {
		set(next: string): void
	}
}

export const connectBoard = (
	handles: BoardHandles,
	source = '/events',
): void => {
	const events = new EventSource(source)
	events.addEventListener('message', (event: MessageEvent<string>) => {
		try {
			const snapshot = JSON.parse(event.data) as BoardSnapshot
			for (const lane of snapshot.lanes) {
				const list =
					lane.key === 'waiting'
						? handles.lanes.waiting
						: lane.key === 'ready'
							? handles.lanes.ready
							: lane.key === 'in-progress'
								? handles.lanes.inProgress
								: lane.key === 'review-pending'
									? handles.lanes.reviewPending
									: lane.key === 'in-review'
										? handles.lanes.inReview
										: handles.lanes.done
				list.set(lane.tasks)
			}
			handles.heading.set(snapshot.meta.title)
			handles.updated.set(snapshot.meta.generatedAt)
			handles.issues.set(snapshot.meta.problems.join('\n'))
		} catch {
			// A malformed frame is dropped; the next snapshot wins.
		}
	})
}
