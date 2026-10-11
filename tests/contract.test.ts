/** The designated export surface pin: widening or shrinking `src/contract.ts`'s symbol set must be a deliberate act — the value set is pinned at runtime, the type set textually against the module's own `export type` re-exports; both lists change in the same commit as the module and its stability policy. */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as designated from '../src/contract'

/** The one published entry point: the corpus pass. */
const DESIGNATED_VALUES = ['compileCorpus'].sort()

/** The corpus entry point's exchange types, the public `RegistryEntry` projection and its `ExposeKind` vocabulary, the five diagnostic record shapes, and `EvaluationTier`. */
const DESIGNATED_TYPES = [
	'CompileDiagnostic',
	'CorpusConfig',
	'CorpusConfigInput',
	'CorpusResult',
	'CorpusSummary',
	'DiagnosticCode',
	'DiagnosticEdit',
	'DiagnosticFix',
	'DiagnosticLocation',
	'EvaluationTier',
	'ExposeKind',
	'RegistryEntry',
].sort()

describe('designated export surface', () => {
	test('runtime exports are exactly the named value set', () => {
		expect(Object.keys(designated).sort()).toEqual(DESIGNATED_VALUES)
	})

	test('type re-exports are exactly the named type set', () => {
		const source = readFileSync(
			new URL('../src/contract.ts', import.meta.url),
			'utf8',
		)
		const names = [...source.matchAll(/export type \{([^}]+)\}/g)].flatMap(
			match => (match[1] ?? '').split(',').map(name => name.trim()),
		)
		expect(names.filter(Boolean).sort()).toEqual(DESIGNATED_TYPES)
	})
})
