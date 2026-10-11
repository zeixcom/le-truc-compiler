import type { AstNode } from './ast-utils'
import type { LocalDiagnostic } from './diagnostics'
import type { MarkerName } from './imports'
import type { ChildrenContract } from './params'
import type { Surface } from './surface'
import type { LocalRoutingSignal } from './tier'

/* === Types === */

/** Shared lowering/classification context for one source on one surface. */
export type ExtractContext = {
	source: string
	/** The authored surface — selects the diagnostic vocabulary. */
	surface: Surface
	diagnostics: LocalDiagnostic[]
	routingSignals: LocalRoutingSignal[]
	exposedProps: Set<string>
	/** Names server-known at template evaluation time (args, setup). */
	serverKnown: Set<string>
	parserProps: Set<string>
	/** The Parser factory name backing a `parserProps` entry (LTC039). */
	parserFactoryOf: (prop: string) => string
	parserFallbackRefsOf: (prop: string) => ReadonlySet<string>
	argNames: Set<string>
	composeImports: ReadonlyMap<string, string>
	markers: ReadonlyMap<string, MarkerName>
	claimedMarkers: Set<AstNode>
	moduleTypes: ReadonlyMap<string, AstNode>
	setupInits: ReadonlyMap<string, AstNode>
	handlerArgs: ReadonlyMap<string, string>
	childrenContract: ChildrenContract | null
	handlerArgRefs: Set<AstNode>
	loopBound: string[]
	loopReactive: boolean[]
	setupScope: {
		importedNames: ReadonlySet<string>
		refNames: ReadonlySet<string>
		tNames: ReadonlySet<string>
		declaredKeys: Readonly<Record<string, string>>
	}
}

/* === Internal Functions === */

/** Shared empty result for the `parserFallbackRefsOf` context hook. */
const EMPTY_NAMES: ReadonlySet<string> = new Set<string>()

/* === Exported Functions === */

/** A fresh extraction context for one source on one surface. */
export const createExtractContext = (
	source: string,
	surface: Surface,
): ExtractContext => ({
	source,
	surface,
	diagnostics: [],
	routingSignals: [],
	exposedProps: new Set<string>(),
	serverKnown: new Set<string>(),
	argNames: new Set<string>(),
	parserProps: new Set<string>(),
	parserFactoryOf: () => '',
	parserFallbackRefsOf: () => EMPTY_NAMES,
	composeImports: new Map<string, string>(),
	markers: new Map<string, MarkerName>(),
	claimedMarkers: new Set<AstNode>(),
	moduleTypes: new Map<string, AstNode>(),
	setupInits: new Map<string, AstNode>(),
	handlerArgs: new Map<string, string>(),
	childrenContract: null,
	handlerArgRefs: new Set<AstNode>(),
	loopBound: [],
	loopReactive: [],
	setupScope: {
		importedNames: EMPTY_NAMES,
		refNames: EMPTY_NAMES,
		tNames: EMPTY_NAMES,
		declaredKeys: {},
	},
})
