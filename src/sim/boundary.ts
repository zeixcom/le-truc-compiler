/** The serialization boundary: a strictly synchronous instantiate→parse step, followed by a bounded, microtask-only drain of the realm to hermetic quiescence. */

/** Thrown when the instantiate→parse window itself was not synchronous. */
export class SimulationBoundaryError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SimulationBoundaryError'
	}
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	(typeof value === 'object' || typeof value === 'function') &&
	value !== null &&
	typeof (value as { then?: unknown }).then === 'function'

/**
 * Run the instantiate→parse step and assert it never yielded on its own.
 *
 * @param work - the step: parse markup, replay definitions, let the
 *   upgrade run
 * @param label - what is being rendered, for the error message
 * @returns whatever `work` returned
 * @throws {SimulationBoundaryError} if `work` awaited or returned a promise
 */
export function assertSynchronousWindow<T>(work: () => T, label: string): T {
	let drained = false
	queueMicrotask(() => {
		drained = true
	})

	const result = work()

	if (isThenable(result))
		throw new SimulationBoundaryError(
			`Serialization boundary for ${label} returned a promise. ` +
				'The instantiate→parse step must be synchronous (ADR 0006 ' +
				'sub-design 9). Await build-time data in the resolution phase, ' +
				'before the simulation.',
		)
	if (drained)
		throw new SimulationBoundaryError(
			`Serialization boundary for ${label} awaited. The microtask queue ` +
				'drained during the parse+upgrade pass itself, before quiescence ' +
				'draining even began (ADR 0006 sub-design 9). Await build-time ' +
				'data in the resolution phase, before the simulation.',
		)

	return result
}

export type QuiescenceResult = {
	/** The value `read()` returned once it stopped changing. */
	value: string
	/** Microtask turns elapsed until stability (>= 1). */
	turns: number
	/** False when `maxTurns` expired with the value still changing. */
	quiescent: boolean
}

/**
 * Drain the realm's microtask queue to quiescence, reading `read()` after every turn.
 *
 * @param read - reads the current serialized state (e.g. the component's
 *   `outerHTML`); called once per turn, including turn 0 before draining
 * @param maxTurns - drain bound; `form-colorgraph` (the composing case that
 *   motivated this) quiesces after exactly one turn, so the default is
 *   generous
 */
export async function drainToQuiescence(
	read: () => string,
	maxTurns = 10,
): Promise<QuiescenceResult> {
	let previous = read()
	for (let turns = 1; turns <= maxTurns; turns++) {
		await Promise.resolve()
		const next = read()
		if (next === previous) return { value: next, turns, quiescent: true }
		previous = next
	}
	return { value: previous, turns: maxTurns, quiescent: false }
}
