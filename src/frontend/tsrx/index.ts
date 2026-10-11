import { DEFAULT_EMIT_PATHS, type EmitPaths } from '../../emit-paths'
import { type CompileFileResult, compileFromIR } from '../../pipeline'
import type { InternalRegistryEntry } from '../../registry'
import { compileSource } from './compiler'

/* === Exported Functions === */

export const compileComponent = (
	source: string,
	filename: string,
	registry: ReadonlySet<string>,
	childImports?: ReadonlyMap<string, string>,
	composeRegistry?: ReadonlyMap<string, InternalRegistryEntry>,
	emitPaths: EmitPaths = DEFAULT_EMIT_PATHS,
): CompileFileResult => {
	const { component, diagnostics, routingSignals } = compileSource(
		source,
		filename,
		emitPaths,
	)
	return compileFromIR(
		component,
		diagnostics,
		routingSignals,
		filename,
		registry,
		childImports,
		composeRegistry,
		emitPaths,
	)
}

export type { ClientPlan } from '../../analysis/plan'
export { analyzeClient } from '../../analysis/plan'
export { dedentCss } from '../../css'
export type { CompileDiagnostic, DiagnosticCode } from '../../diagnostics'
export type { EmittedClientModule } from '../../emit-client'
export { emitClientModule } from '../../emit-client'
export type { EmitPaths } from '../../emit-paths'
export { DEFAULT_EMIT_PATHS } from '../../emit-paths'
export type { EmittedServerModule } from '../../emit-server'
export { emitServerModule } from '../../emit-server'
export type { ComponentIR } from '../../ir'
export type {
	CompiledComponent,
	CompileFileResult,
} from '../../pipeline'
export type {
	ComponentRegistry,
	InternalComponentRegistry,
	InternalRegistryEntry,
	RegistryEntry,
} from '../../registry'
export { registryJson } from '../../registry'
export type { SourceSpan } from '../../spans'
export {
	fileLineColToOffset,
	fileOffsetToLineCol,
	findSpanForGeneratedOffset,
} from '../../spans'
export { collectComposeElements } from '../../walk'
export type { CompileResult } from './compiler'
export { compileSource } from './compiler'
