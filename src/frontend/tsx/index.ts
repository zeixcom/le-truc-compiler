import { DEFAULT_EMIT_PATHS, type EmitPaths } from '../../emit-paths'
import { type CompileFileResult, compileFromIR } from '../../pipeline'
import type { InternalRegistryEntry } from '../../registry'
import { compileSourceTsx } from './compiler-tsx'

export type {
	CompiledComponent,
	CompileFileResult,
} from '../../pipeline'

export const compileComponentTsx = (
	source: string,
	filename: string,
	registry: ReadonlySet<string>,
	childImports?: ReadonlyMap<string, string>,
	composeRegistry?: ReadonlyMap<string, InternalRegistryEntry>,
	/** The configured output root's emit consequences — same as `compileComponent`. */
	emitPaths: EmitPaths = DEFAULT_EMIT_PATHS,
): CompileFileResult => {
	const { component, diagnostics, routingSignals } = compileSourceTsx(
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
