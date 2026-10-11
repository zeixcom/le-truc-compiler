import { lineOf } from './diagnostics'
import type { EvaluationTier, RoutingSignal } from './tier'

/* === Types === */

export type CensusKind = 'tier' | 'translation'

export type CensusEntry = {
	/** What the record is about — the component tag in both planned censuses. */
	subject: string
	/** The value the census records for the subject (the tier name, here). */
	value: string
	reasons: readonly string[]
}

/** A named census riding the build-report channel. */
export type Census = {
	kind: CensusKind
	/** The human label the formatted section opens with. */
	name: string
	values: readonly string[]
	entries: readonly CensusEntry[]
}

export type TierCensusSubject = {
	tag: string
	tier: EvaluationTier
	routingSignals: readonly RoutingSignal[]
}

export type TranslationGap = {
	key: string
	/** The locale the key is missing, stale, or orphaned in. */
	locale: string
	status: TranslationGapStatus
	/** What the pattern-integrity walks found (the arguments, the categories). */
	detail?: string
}

/** Every {@link TranslationGap} status, in report order. */
export const TRANSLATION_GAP_STATUSES = [
	'missing',
	'stale',
	'orphaned',
	'malformed',
	'argument-mismatch',
	'missing-arms',
	'client-fallback',
] as const

export type TranslationGapStatus = (typeof TRANSLATION_GAP_STATUSES)[number]

/** Census reasons per status — a record, not a fix-it. */
const TRANSLATION_GAP_REASONS: Record<TranslationGapStatus, string> = {
	missing:
		'missing — no entry in this locale’s catalog; the source-locale string renders',
	stale:
		'stale — the source string changed after this translation was recorded',
	orphaned:
		'orphaned — nothing in the corpus declares this key, so the entry never renders',
	malformed:
		'malformed — the entry is not a valid ICU pattern and never renders; a declared key falls back to its source-locale string',
	'argument-mismatch':
		'argument mismatch — the translation’s arguments differ from the source pattern’s',
	'missing-arms':
		'missing plural arms — a plural does not cover this locale’s categories; those counts render `other`',
	'client-fallback':
		'client fallback — the translation uses a construct its source does not, so the browser renders the source-locale string',
}

/** The line a signal's location starts on, unless it spans its whole file. */
const signalLine = (
	signal: RoutingSignal,
	sourceOf: (file: string) => string | undefined,
): number | undefined => {
	const location = signal.location
	if (!location) return undefined
	const source = sourceOf(location.file)
	if (
		source === undefined ||
		(location.start === 0 && location.end === source.length)
	)
		return undefined
	return lineOf(source, location.start)
}

/* === Exported Functions === */

export const tierCensus = (
	subjects: readonly TierCensusSubject[],
	sourceOf: (file: string) => string | undefined = () => undefined,
): Census => ({
	kind: 'tier',
	name: 'Tier census',
	values: ['folded', 'simulated', 'static'],
	entries: [...subjects]
		.sort((a, b) => (a.tag < b.tag ? -1 : 1))
		.map(subject => ({
			subject: subject.tag,
			value: subject.tier,
			reasons: subject.routingSignals.map(signal => {
				const line = signalLine(signal, sourceOf)
				return line === undefined
					? `${signal.origin}: ${signal.detail}`
					: `${signal.origin}: ${signal.detail} (line ${line})`
			}),
		})),
})

export const translationCensus = (
	gaps: readonly TranslationGap[],
	locales: readonly string[],
): Census => ({
	kind: 'translation',
	name: 'Translation census',
	values: [...locales].sort((a, b) => (a < b ? -1 : 1)),
	entries: gaps
		.map(gap => ({
			subject: gap.key,
			value: gap.locale,
			reasons: [
				gap.detail
					? `${TRANSLATION_GAP_REASONS[gap.status]} (${gap.detail})`
					: TRANSLATION_GAP_REASONS[gap.status],
			],
		}))
		.sort((a, b) =>
			a.subject < b.subject
				? -1
				: a.subject > b.subject
					? 1
					: a.value < b.value
						? -1
						: 1,
		),
})

export const formatCensus = (census: Census): string => {
	const counts = new Map<string, number>()
	for (const value of census.values) counts.set(value, 0)
	for (const entry of census.entries)
		counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1)
	const summary = [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.map(([value, n]) => `${n} ${value}`)
		.join(', ')
	const lines = [
		`${census.name} — ${census.entries.length} entries: ${summary}`,
	]
	for (const entry of census.entries) {
		if (entry.reasons.length === 0) continue
		lines.push(`  ${entry.subject}: ${entry.value}`)
		for (const reason of entry.reasons) lines.push(`    - ${reason}`)
	}
	return lines.join('\n')
}
