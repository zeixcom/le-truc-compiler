/** Helpers over a diagnostic's range: its start line and covered text, in either the published (`location`) or local (`range`) shape. */

import { lineOf } from '../src/diagnostics'

type Ranged =
	| { location: { start: number; end: number } }
	| { range: { start: number; end: number } }

const rangeOf = (d: Ranged): { start: number; end: number } =>
	'location' in d ? d.location : d.range

/** The 1-based line `d` starts on in `source`. */
export const lineAt = (source: string, d: Ranged | undefined) =>
	d ? lineOf(source, rangeOf(d).start) : undefined

/** The authored text `d` covers in `source`. */
export const textAt = (source: string, d: Ranged | undefined) =>
	d ? source.slice(rangeOf(d).start, rangeOf(d).end) : undefined
