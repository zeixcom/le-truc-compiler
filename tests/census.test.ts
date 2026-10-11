/** Pins the census record itself — the named-census shape both consumers ride, and its formatting; a build-report record, not a diagnostic, so its wording stays factual and it never enters the diagnostic channel. */

import { describe, expect, test } from 'bun:test'
import { formatCensus, type TierCensusSubject, tierCensus } from '../src/census'
import type { RoutingSignal } from '../src/tier'

const signal = (
	origin: RoutingSignal['origin'],
	detail: string,
	location?: RoutingSignal['location'],
): RoutingSignal => ({
	origin,
	detail,
	resolution: { by: 'realm' },
	...(location === undefined ? {} : { location }),
})

/** An authored file whose line 7 starts at offset 12. */
const AUTHORED = 'a\nb\nc\nd\ne\nf\n<child-el></child-el>\n'
const LINE_7 = AUTHORED.indexOf('<child-el>')

const subject = (
	tag: string,
	tier: TierCensusSubject['tier'],
	routingSignals: RoutingSignal[] = [],
): TierCensusSubject => ({ tag, tier, routingSignals })

describe('tierCensus', () => {
	test('entries are sorted by tag, whatever order the registry emits them in', () => {
		const census = tierCensus([
			subject('form-b', 'simulated', [signal('LTC034', 'x')]),
			subject('basic-a', 'folded'),
		])
		expect(census.entries.map(entry => entry.subject)).toEqual([
			'basic-a',
			'form-b',
		])
	})

	test('every entry records its tier as the census value', () => {
		const census = tierCensus([
			subject('basic-a', 'folded'),
			subject('form-b', 'simulated'),
			subject('module-c', 'static'),
		])
		expect(census.entries.map(entry => entry.value)).toEqual([
			'folded',
			'simulated',
			'static',
		])
	})

	test('a routing signal becomes a factual reason: origin, detail, and the line when known', () => {
		const census = tierCensus(
			[
				subject('form-b', 'simulated', [
					signal('LTC004', 'no harvestable render site'),
					signal(
						'compose-read',
						'reads composed <basic-a> (folded-tier) at a compose site',
						{ file: 'form-b.tsx', start: LINE_7, end: LINE_7 + 10 },
					),
				]),
			],
			file => (file === 'form-b.tsx' ? AUTHORED : undefined),
		)
		expect(census.entries[0]?.reasons).toEqual([
			'LTC004: no harvestable render site',
			'compose-read: reads composed <basic-a> (folded-tier) at a compose site (line 7)',
		])
	})

	test('a location prints no line without its source, or when it spans the whole file', () => {
		const located = (start: number, end: number) =>
			subject('form-b', 'simulated', [
				signal('LTC004', 'no harvestable render site', {
					file: 'form-b.tsx',
					start,
					end,
				}),
			])
		const reasons = (
			census: ReturnType<typeof tierCensus>,
		): readonly string[] | undefined => census.entries[0]?.reasons
		expect(reasons(tierCensus([located(LINE_7, LINE_7 + 10)]))).toEqual([
			'LTC004: no harvestable render site',
		])
		expect(
			reasons(tierCensus([located(0, AUTHORED.length)], () => AUTHORED)),
		).toEqual(['LTC004: no harvestable render site'])
	})

	test('a Folded-tier subject carries no reasons — that is the fact', () => {
		const census = tierCensus([subject('basic-a', 'folded')])
		expect(census.entries[0]?.reasons).toEqual([])
	})
})

describe('formatCensus', () => {
	const census = tierCensus([
		subject('basic-a', 'folded'),
		subject('basic-b', 'folded'),
		subject('form-c', 'simulated', [
			signal('LTC004', 'no harvestable render site'),
		]),
	])

	test('the summary line counts every entry, including zero-count tiers', () => {
		// "0 static" is a meaningful fact, not a gap: the empty static census is the correct classification, and the count is what makes its emptiness visible.
		expect(formatCensus(census).split('\n')[0]).toBe(
			'Tier census — 3 entries: 2 folded, 1 simulated, 0 static',
		)
	})

	test('a reason-less entry is counted but not listed — its line would say nothing the count does not', () => {
		const text = formatCensus(census)
		expect(text).not.toContain('basic-a')
		expect(text).not.toContain('basic-b')
	})

	test('an entry with reasons lists them under its subject', () => {
		const text = formatCensus(census)
		expect(text).toContain('  form-c: simulated')
		expect(text).toContain('    - LTC004: no harvestable render site')
	})

	test('the format is stable — the census regression story reads this output', () => {
		expect(formatCensus(census)).toBe(
			'Tier census — 3 entries: 2 folded, 1 simulated, 0 static\n' +
				'  form-c: simulated\n' +
				'    - LTC004: no harvestable render site',
		)
	})

	test('census lines never carry the warning marker the counted baseline reads', () => {
		// `check:corpus` counts console.warn lines that start with ⚠️; the census is not a warning and must never be countable as one.
		expect(formatCensus(census)).not.toContain('⚠️')
	})
})
