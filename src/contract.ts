/* === The corpus entry point and its exchange types === */

export type { CorpusResult, CorpusSummary } from './corpus'
export { compileCorpus } from './corpus'
export type {
	CorpusConfig,
	CorpusConfigInput,
} from './corpus-config'

/* === The registry the run wrote === */

/** The registry entry's per-prop kind vocabulary (`entry.exposedProps`). */
export type { ExposeKind } from './ir'
export type { RegistryEntry } from './registry'

/* === The refusal channel — how a compile fails honestly === */

export type {
	CompileDiagnostic,
	DiagnosticCode,
	DiagnosticEdit,
	DiagnosticFix,
	DiagnosticLocation,
} from './diagnostics'
export type { EvaluationTier } from './tier'
