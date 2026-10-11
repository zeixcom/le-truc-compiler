import { type AstNode, forEachChild, isNode } from './ast-utils'
import { type DiagnosticLocation, rangeOf, type Site } from './diagnostics'
import { type ImpureAmbientCause, impureAmbientCauses } from './evaluability'
import type { SourceRange } from './ir'
import {
	UNANSWERABLE_GLOBAL_NAMES,
	UNANSWERABLE_MEMBERS,
	unanswerableGlobalReason,
	unanswerableMemberReason,
} from './simulation/capabilities'

/* === Types === */

export type EvaluationTier =
	/** Tier 1: template lowering + `runtime.ts`'s value harness. No jsdom. */
	| 'folded'
	/** Tier 2: phase-1 skeleton, then pre-play in the jsdom realm. */
	| 'simulated'
	/** Tier 0: phase-1 skeleton only; the client corrects at connect. */
	| 'static'

export type UnresolvableLimb =
	/** (a) Every read routes through something the capability table names. */
	| 'stubbed-api'
	/** (b) The input is the viewing moment or the build machine's state. */
	| 'not-a-server-fact'

export type RoutingSignalOrigin =
	| 'LTC004'
	| 'LTC013'
	| 'LTC034'
	| 'LTC043'
	| 'compose-read'
	| 'unavailable-substrate'

/** Whether some server phase can answer an unresolved expression. */
export type Resolution =
	/** The realm executes it for real against a simulated document. */
	| { by: 'realm' }
	/** No phase can answer it; omitted in every tier. */
	| { by: 'none'; limb: UnresolvableLimb; reason: string }
	| { by: 'substrate-unavailable' }

export type RoutingSignal = {
	origin: RoutingSignalOrigin
	/** The name or expression the signal is about, for the census line. */
	detail: string
	location?: DiagnosticLocation
	resolution: Resolution
}

export type LocalRoutingSignal = Omit<RoutingSignal, 'location'> & {
	range?: SourceRange
}

/** A component's tier and the reasons behind it — one census record. */
export type TierClassification = {
	tag: string
	tier: EvaluationTier
	signals: readonly RoutingSignal[]
}

/* === Internal Functions === */

/** Census copy for each unresolvable impurity, in the table's own terms. */
const IMPURITY_REASONS: Record<ImpureAmbientCause, string> = {
	date: 'reads the wall clock, which is a fact about the viewing moment',
	rng: 'reads the RNG, which has no server answer to bake in',
	'locale-method':
		'formats through a locale/timezone-reading method, so the value is the build machine’s',
	'intl-default-locale':
		'resolves its locale to the runtime default, which is the build machine’s own setting',
	'intl-dom-locale':
		'reads its locale from the DOM — realm-answerable, never unresolvable',
}

/* === Exported Functions === */

export const rangeFields = (
	source: string,
	at: Site,
): { range: SourceRange } => ({ range: rangeOf(source, at) })

/** Publish a stage's routing signal against `file`. */
export const locateSignal = (
	signal: LocalRoutingSignal,
	file: string,
): RoutingSignal => {
	const { range, ...rest } = signal
	return range === undefined ? rest : { ...rest, location: { file, ...range } }
}

export const stubbedApiRead = (node: AstNode): string | null => {
	let reason: string | null = null
	const visit = (current: unknown): void => {
		if (reason !== null) return
		if (Array.isArray(current)) {
			for (const child of current) visit(child)
			return
		}
		if (!isNode(current)) return
		if (
			current.type === 'Identifier' &&
			UNANSWERABLE_GLOBAL_NAMES.has(String(current.name))
		) {
			reason = unanswerableGlobalReason(String(current.name))
			return
		}
		if (current.type === 'MemberExpression' && !current.computed) {
			const property = current.property
			if (isNode(property) && property.type === 'Identifier') {
				const patch = UNANSWERABLE_MEMBERS.get(String(property.name))
				// A capability row scoped to a receiver only fires on that receiver: `internals.states` is unanswerable, a component's own `states` const is not.
				const object = current.object
				const receiverMatches =
					patch?.receiver === undefined ||
					(isNode(object) &&
						object.type === 'Identifier' &&
						String(object.name) === patch.receiver)
				if (patch && receiverMatches) {
					reason = unanswerableMemberReason(patch)
					return
				}
			}
		}
		// Type positions are skipped: a `ResizeObserver` annotation or a `typeof window` query reads nothing the realm would have to answer.
		forEachChild(current, visit)
	}
	visit(node)
	return reason
}

export const resolutionOf = (
	node: AstNode,
	scope: ReadonlySet<string>,
): Resolution => {
	const stubbed = stubbedApiRead(node)
	if (stubbed !== null)
		return { by: 'none', limb: 'stubbed-api', reason: stubbed }
	const causes = impureAmbientCauses(node, scope)
	// Only SOME impurity is unresolvable: an `Intl` call whose locale is read from the DOM is impure for folding — the value harness has no document — but the realm executes that read against a real simulated element, so it is a Simulated-tier routing signal rather than an omitted expression.
	const unresolvable = causes.filter(cause => cause !== 'intl-dom-locale')
	if (unresolvable.length > 0)
		return {
			by: 'none',
			limb: 'not-a-server-fact',
			reason: IMPURITY_REASONS[unresolvable[0] as ImpureAmbientCause],
		}
	// Everything else the harness could not fold, the realm executes for real against a simulated document.
	return { by: 'realm' }
}

export const classifyTier = (
	signals: readonly { resolution: Resolution }[],
): EvaluationTier => {
	if (signals.length === 0) return 'folded'
	return signals.some(signal => signal.resolution.by === 'realm')
		? 'simulated'
		: 'static'
}

export const contaminateComposeReads = (
	classifications: ReadonlyMap<string, TierClassification>,
	composeReads: (tag: string) => readonly string[],
): Map<string, TierClassification> => {
	const result = new Map(classifications)
	let changed = true
	while (changed) {
		changed = false
		for (const [tag, classification] of result) {
			if (classification.tier === 'simulated') continue
			for (const child of composeReads(tag)) {
				const childTier = result.get(child)?.tier
				if (childTier === undefined || childTier === 'folded') continue
				const signal: RoutingSignal = {
					origin: 'compose-read',
					detail: `reads composed <${child}> (${childTier}-tier) at a compose site`,
					resolution: { by: 'realm' },
				}
				const signals = [...classification.signals, signal]
				result.set(tag, {
					...classification,
					tier: classifyTier(signals),
					signals,
				})
				changed = true
				break
			}
		}
	}
	return result
}
