import {
	type AstNode,
	asArray,
	forEachFreeIdentifier,
	identifierName,
	identifiersIn,
	isNode,
	text,
} from './ast-utils'
import { diagnostic } from './diagnostics'
import { DEFAULT_EMIT_PATHS } from './emit-paths'
import { dependenciesOf, isServerEvaluable } from './evaluability'
import type { ExtractContext } from './extract-context'
import type { ComponentIR, TemplateNode } from './ir'
import { onServer } from './setup-extraction'
import {
	CONTEXT_NAMES,
	FACTORY_CONTEXT_MEMBERS,
	JS_GLOBALS,
} from './vocabulary'
import { collectAttrs, walkTemplate } from './walk'

/* === Pure-string POSIX path helpers (specifiers are `/`-separated on every host) === */

/** `dir/file.tsrx` → `dir`; `file.tsrx` → `.`; `/file.tsrx` → `/`. */
const dirname = (p: string): string => {
	const idx = p.lastIndexOf('/')
	return idx === -1 ? '.' : idx === 0 ? '/' : p.slice(0, idx)
}

/** `join('dir', './sibling.tsrx')` → `dir/./sibling.tsrx` (normalize after). */
const join = (dir: string, rel: string): string =>
	dir === '.' ? rel : `${dir}/${rel}`

/** Lexical `.`/`..` segment resolution, matching `posix.normalize`. */
const normalize = (p: string): string => {
	const absolute = p.startsWith('/')
	const out: string[] = []
	for (const part of p.split('/')) {
		if (part === '' || part === '.') continue
		if (part === '..') {
			if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
			else if (!absolute) out.push('..')
			continue
		}
		out.push(part)
	}
	return (absolute ? '/' : '') + out.join('/')
}

/* === Compose imports (from config.ts) === */

export const parseComposeImports = (
	ast: AstNode,
	filename: string,
): Map<string, string> => {
	const imports = new Map<string, string>()
	const dir = dirname(filename)
	for (const stmt of asArray(ast.body)) {
		if (stmt.type !== 'ImportDeclaration') continue
		const specifierNode = stmt.source
		const specifier =
			isNode(specifierNode) &&
			specifierNode.type === 'Literal' &&
			typeof specifierNode.value === 'string'
				? specifierNode.value
				: null
		if (
			!specifier ||
			(!specifier.endsWith('.tsrx') && !specifier.endsWith('.tsx'))
		)
			continue
		const resolved = normalize(join(dir, specifier))
		for (const spec of asArray(stmt.specifiers)) {
			if (spec.type !== 'ImportSpecifier') continue
			const local = identifierName(spec.local)
			if (local) imports.set(local, resolved)
		}
	}
	return imports
}

/* === Compile-time markers === */

/** The module an authored source imports its compile-time markers from. */
export const MACROS_SPECIFIER = '@zeix/le-truc-compiler/macros'

/** Every export of `MACROS_SPECIFIER` (`server/compiler/macros.ts`). */
export const MARKER_NAMES = ['css', 'harvest'] as const

export type MarkerName = (typeof MARKER_NAMES)[number]

const isMarkerName = (name: string | null): name is MarkerName =>
	(MARKER_NAMES as readonly (string | null)[]).includes(name)

/** The string value of an import declaration's specifier, if it has one. */
const specifierOf = (stmt: AstNode): string | null => {
	const node = stmt.source
	return isNode(node) &&
		node.type === 'Literal' &&
		typeof node.value === 'string'
		? node.value
		: null
}

/** The name an import specifier imports (`css` in `{ css as style }`), or null for a default or namespace import. */
const importedNameOf = (spec: AstNode): string | null => {
	if (spec.type !== 'ImportSpecifier') return null
	const imported = spec.imported
	if (!isNode(imported)) return null
	return imported.type === 'Literal' && typeof imported.value === 'string'
		? imported.value
		: identifierName(imported)
}

/** A value specifier that imports a marker from `MACROS_SPECIFIER`. */
const isMarkerSpecifier = (stmt: AstNode, spec: AstNode): boolean =>
	specifierOf(stmt) === MACROS_SPECIFIER &&
	(stmt as { importKind?: unknown }).importKind !== 'type' &&
	(spec as { importKind?: unknown }).importKind !== 'type' &&
	isMarkerName(importedNameOf(spec))

export const parseMarkerImports = (ast: AstNode): Map<string, MarkerName> => {
	const markers = new Map<string, MarkerName>()
	for (const stmt of asArray(ast.body)) {
		if (stmt.type !== 'ImportDeclaration') continue
		for (const spec of asArray(stmt.specifiers)) {
			if (!isMarkerSpecifier(stmt, spec)) continue
			const local = identifierName(spec.local)
			const name = importedNameOf(spec)
			if (local && isMarkerName(name)) markers.set(local, name)
		}
	}
	return markers
}

/** `markers` less every name in `declared`: what a scope's own declarations shadow. */
const withoutShadowed = (
	markers: ReadonlyMap<string, MarkerName>,
	declared: Iterable<string>,
): ReadonlyMap<string, MarkerName> => {
	let scoped: Map<string, MarkerName> | null = null
	for (const name of declared) {
		if (!(scoped ?? markers).has(name)) continue
		scoped ??= new Map(markers)
		scoped.delete(name)
	}
	return scoped ?? markers
}

export const shadowMarkers = (
	ctx: ExtractContext,
	declared: ReadonlySet<string>,
): void => {
	ctx.markers = withoutShadowed(ctx.markers, declared)
}

export const markerOf = (
	ctx: ExtractContext,
	node: unknown,
	enclosing: Iterable<string> = [],
): MarkerName | null => {
	const name = identifierName(node)
	if (!name) return null
	return withoutShadowed(ctx.markers, enclosing).get(name) ?? null
}

export const claimMarker = (ctx: ExtractContext, node: unknown): void => {
	if (isNode(node)) ctx.claimedMarkers.add(node)
}

export const reportUnclaimedMarkers = (
	ctx: ExtractContext,
	fn: AstNode,
	markers: ReadonlyMap<string, MarkerName>,
): void => {
	if (markers.size === 0) return
	forEachFreeIdentifier(fn, identifier => {
		const marker = markers.get(String(identifier.name))
		if (!marker || ctx.claimedMarkers.has(identifier)) return
		ctx.diagnostics.push(
			diagnostic.misplacedMarker(ctx.source, identifier, marker),
		)
	})
}

/** An import declaration's text with its marker specifiers removed, or null when every specifier is a marker — a marker import never reaches a generated module. */
const withoutMarkers = (source: string, stmt: AstNode): string | null => {
	const specs = asArray(stmt.specifiers)
	const kept = specs.filter(spec => !isMarkerSpecifier(stmt, spec))
	if (kept.length === specs.length) return text(source, stmt)
	if (kept.length === 0) return null
	const parts: string[] = []
	const named: string[] = []
	for (const spec of kept) {
		if (spec.type === 'ImportSpecifier') named.push(text(source, spec))
		else parts.push(text(source, spec))
	}
	if (named.length > 0) parts.push(`{ ${named.join(', ')} }`)
	const kind =
		(stmt as { importKind?: unknown }).importKind === 'type' ? 'type ' : ''
	return `import ${kind}${parts.join(', ')} from ${text(source, stmt.source as AstNode)}`
}

/* === `@zeix/le-truc` authored imports === */

export type LeTrucImport = {
	names: string[]
	start: number
	end: number
	/** Each name's import specifier, for a diagnostic's range. */
	specifiers: Map<string, AstNode>
}

export const parseLeTrucImports = (ast: AstNode): LeTrucImport[] => {
	const result: LeTrucImport[] = []
	for (const stmt of asArray(ast.body)) {
		if (stmt.type !== 'ImportDeclaration') continue
		if ((stmt as { importKind?: unknown }).importKind === 'type') continue
		const specifierNode = stmt.source
		const specifier =
			isNode(specifierNode) &&
			specifierNode.type === 'Literal' &&
			typeof specifierNode.value === 'string'
				? specifierNode.value
				: null
		if (specifier !== '@zeix/le-truc') continue
		const names: string[] = []
		const specifiers = new Map<string, AstNode>()
		for (const spec of asArray(stmt.specifiers)) {
			if (spec.type !== 'ImportSpecifier') continue
			const name = identifierName(spec.local)
			if (name) {
				names.push(name)
				specifiers.set(name, spec)
			}
		}
		if (names.length > 0)
			result.push({
				names,
				start: typeof stmt.start === 'number' ? stmt.start : 0,
				end: typeof stmt.end === 'number' ? stmt.end : 0,
				specifiers,
			})
	}
	return result
}

const RUNTIME_HARNESS_EXPORTS: ReadonlySet<string> = new Set<string>([
	'createCell',
	'createList',
	'createStore',
	'createState',
	'createTask',
	'deriveCell',
	'deriveList',
	'deriveStore',
	'createMemo',
	'createSensor',
	'isPending',
	'expose',
	'defineMethod',
	'asString',
	'asInteger',
	'asNumber',
	'asBoolean',
	'asEnum',
	'asClampedInteger',
	'asJSON',
	'attrValue',
	'esc',
	'text',
	'textOf',
	'attr',
	'cls',
	'styleAttr',
	'sanitizeHtml',
	'configureHtmlSanitizer',
	'items',
	'entries',
])

export { RUNTIME_HARNESS_EXPORTS }

/** The span from the first to the last of `names`' specifiers in `imp` — what an unused-import report covers; the whole declaration when a specifier carries no position. */
const specifierSpan = (
	imp: LeTrucImport,
	names: readonly string[],
): { start: number; end: number } => {
	let start = Number.POSITIVE_INFINITY
	let end = Number.NEGATIVE_INFINITY
	for (const name of names) {
		const spec = imp.specifiers.get(name)
		if (typeof spec?.start !== 'number' || typeof spec.end !== 'number')
			return imp
		start = Math.min(start, spec.start)
		end = Math.max(end, spec.end)
	}
	return Number.isFinite(start) ? { start, end } : imp
}

/** `imp.names` split into maximal runs of adjacent specifiers that `skip` does not hold — so an unused-import range never covers a context name LTC037 reports on its own. */
const runsWithout = (
	imp: LeTrucImport,
	skip: ReadonlySet<string>,
): string[][] => {
	const runs: string[][] = []
	let run: string[] = []
	for (const name of imp.names) {
		if (skip.has(name)) {
			if (run.length > 0) runs.push(run)
			run = []
		} else run.push(name)
	}
	if (run.length > 0) runs.push(run)
	return runs
}

export const placeLeTrucImports = (
	ctx: ExtractContext,
	component: SetupLikeComponent,
	leTrucImports: LeTrucImport[],
	typeTexts: { server: readonly string[]; client: readonly string[] } = {
		server: [],
		client: [],
	},
): {
	server: string[]
	client: string[]
	serverNames: ReadonlySet<string>
	clientNames: ReadonlySet<string>
} => {
	const server: string[] = []
	const client: string[] = []
	const serverNames = new Set<string>()
	const clientNames = new Set<string>()
	if (leTrucImports.length === 0)
		return { server, client, serverNames, clientNames }

	const serverUsage = serverUsageNames(component)
	const clientUsage = computeClientNeededNames(component)
	const typeNamesIn = (texts: readonly string[]): ReadonlySet<string> =>
		// A name in an authored TYPE position counts only outside comments: strip them, then take the flat identifier tokens (`identifiersIn`).
		new Set(
			texts.flatMap(t =>
				identifiersIn(
					t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
				),
			),
		)
	const serverTypeNames = typeNamesIn(typeTexts.server)
	const clientTypeNames = typeNamesIn(typeTexts.client)
	// A FactoryContext member inside an authored '@zeix/le-truc' import is LTC037 (compiler.ts) — never re-emit one: it is not a package export.
	const contextVocabulary = new Set<string>([
		...FACTORY_CONTEXT_MEMBERS,
		...CONTEXT_NAMES,
	])
	for (const imp of leTrucImports) {
		// A FactoryContext member inside an authored '@zeix/le-truc' import is LTC037 (compiler.ts) — excluded here so it is neither placed nor double-reported as an unused import.
		const names = imp.names.filter(n => !contextVocabulary.has(n))
		if (names.length === 0) continue
		const usedServer = names.filter(n => serverUsage.has(n))
		const usedClient = names.filter(n => clientUsage.has(n))
		// Type-only survivors: unused as values, named in the module's own verbatim texts. Placed as `type X` so a type-only export stays one.
		const typeServer = names.filter(
			n => !serverUsage.has(n) && serverTypeNames.has(n),
		)
		const typeClient = names.filter(
			n => !clientUsage.has(n) && clientTypeNames.has(n),
		)
		if (
			usedServer.length === 0 &&
			usedClient.length === 0 &&
			typeServer.length === 0 &&
			typeClient.length === 0
		) {
			// One report per run of adjacent names, so no range covers a context name between them.
			for (const run of runsWithout(imp, contextVocabulary))
				ctx.diagnostics.push(
					diagnostic.unusedPlainImport(
						ctx.source,
						specifierSpan(imp, run),
						run,
					),
				)
			continue
		}
		const serverSide = [
			...usedServer.filter(n => !RUNTIME_HARNESS_EXPORTS.has(n)),
			...typeServer.map(n => `type ${n}`),
		]
		if (serverSide.length > 0) {
			for (const n of [...usedServer, ...typeServer]) serverNames.add(n)
			server.push(`import { ${serverSide.join(', ')} } from '@zeix/le-truc'`)
		}
		const clientSide = [...usedClient, ...typeClient.map(n => `type ${n}`)]
		if (clientSide.length > 0) {
			for (const n of [...usedClient, ...typeClient]) clientNames.add(n)
			client.push(`import { ${clientSide.join(', ')} } from '@zeix/le-truc'`)
		}
	}
	return { server, client, serverNames, clientNames }
}

/* === Plain imports (from plain-imports.ts) === */

/** One plain top-level import, not yet placed into server/client output. */
export type PlainImportIR = {
	/** Verbatim import statement source text. */
	text: string
	/** Local binding names introduced (empty for a side-effect-only import). */
	localNames: string[]
	/** `import 'specifier'` with no bindings at all — can't be usage-traced. */
	sideEffectOnly: boolean
	start: number
	end: number
}

export const parsePlainImports = (
	ctx: ExtractContext,
	ast: AstNode,
	filename: string,
	outDirPrefix: string = DEFAULT_EMIT_PATHS.outDirPrefix,
): PlainImportIR[] => {
	const result: PlainImportIR[] = []
	const dir = dirname(filename)
	for (const stmt of asArray(ast.body)) {
		if (stmt.type !== 'ImportDeclaration') continue
		const specifierNode = stmt.source
		const specifier =
			isNode(specifierNode) &&
			specifierNode.type === 'Literal' &&
			typeof specifierNode.value === 'string'
				? specifierNode.value
				: null
		if (
			!specifier ||
			specifier.endsWith('.tsrx') ||
			specifier.endsWith('.tsx') ||
			specifier === '@zeix/le-truc'
		)
			continue
		// A marker specifier never reaches a generated module: the declaration drops whole when every specifier is a marker.
		const stripped = withoutMarkers(ctx.source, stmt)
		if (stripped === null) continue
		const localNames: string[] = []
		for (const spec of asArray(stmt.specifiers)) {
			if (isMarkerSpecifier(stmt, spec)) continue
			const local = identifierName(spec.local)
			if (local) localNames.push(local)
		}
		let importText = stripped
		if (specifier.startsWith('.') && isNode(specifierNode)) {
			const resolved = normalize(join(dir, specifier)).replace(/\.ts$/, '')
			const rewritten = `${outDirPrefix}${resolved}`
			importText = importText.replace(
				text(ctx.source, specifierNode),
				JSON.stringify(rewritten),
			)
		}
		result.push({
			text: importText,
			localNames,
			sideEffectOnly: localNames.length === 0,
			start: typeof stmt.start === 'number' ? stmt.start : 0,
			end: typeof stmt.end === 'number' ? stmt.end : 0,
		})
	}
	return result
}

/** Every server-known-position expression node anywhere in the template, including `'server'`-kind attributes — they are spliced verbatim and unconditionally into the server module. */
const serverExprNodes = (root: TemplateNode): AstNode[] => {
	const out: AstNode[] = []
	walkTemplate(root, node => {
		if (node.kind === 'expr' && node.reactivity === 'server')
			out.push(node.expr)
		else if (node.kind === 'conditional' && node.mode === 'server') {
			out.push(node.test)
			for (const arm of node.arms) if (arm.test) out.push(arm.test)
		} else if (node.kind === 'compose')
			for (const attr of node.attrs)
				if (attr.kind === 'arg' && attr.node) out.push(attr.node)
	})
	for (const attr of collectAttrs(root))
		if (attr.kind === 'server') out.push(attr.node)
	return out
}

/** Every client-always expression node anywhere in the template. */
const clientExprNodes = (root: TemplateNode): AstNode[] => {
	const out: AstNode[] = []
	walkTemplate(root, node => {
		if (node.kind === 'expr' && node.reactivity === 'reactive')
			out.push(node.expr)
		else if (node.kind === 'client-stmt') out.push(node.node)
		// A reactive conditional's test is its client arm-key thunk.
		else if (node.kind === 'conditional' && node.mode === 'reactive')
			out.push(node.test)
		// Compose `pass` thunks and non-forwarded handler args: `collectAttrs` covers `kind: 'element'` attrs only, so they need the same client-need tracing raw-element `pass` gets below.
		else if (node.kind === 'compose')
			for (const attr of node.attrs) {
				if (attr.kind === 'pass')
					for (const entry of attr.entries) {
						out.push(entry.thunk)
						if (entry.setThunk) out.push(entry.setThunk)
					}
				else if (attr.kind === 'handler' && attr.forward === null)
					out.push(attr.handler)
			}
	})
	for (const attr of collectAttrs(root)) {
		if (attr.kind === 'reactive') out.push(attr.thunk)
		else if (attr.kind === 'style-map' || attr.kind === 'class-map')
			out.push(attr.object)
		else if (attr.kind === 'event') out.push(attr.handler)
		else if (attr.kind === 'html' && attr.reactive) out.push(attr.node)
		else if (attr.kind === 'pass')
			for (const entry of attr.entries) {
				out.push(entry.thunk)
				if (entry.setThunk) out.push(entry.setThunk)
			}
	}
	return out
}

/** Server-conditional reactive-family thunks (`reactive`/`style-map`/`class-map`) — gated by the same `isServerEvaluable` rule emit-server.ts applies, so a plain import used only inside a server-rendered thunk still lands server-side. */
const serverRenderedThunkNodes = (
	root: TemplateNode,
	serverKnown: ReadonlySet<string>,
): AstNode[] => {
	const out: AstNode[] = []
	// A reactive conditional's test folds its initial winner server-side.
	walkTemplate(root, node => {
		if (
			node.kind === 'conditional' &&
			node.mode === 'reactive' &&
			isServerEvaluable(node.test, serverKnown)
		)
			out.push(node.test)
	})
	for (const attr of collectAttrs(root)) {
		if (attr.kind === 'reactive' && isServerEvaluable(attr.thunk, serverKnown))
			out.push(attr.thunk)
		else if (
			(attr.kind === 'style-map' || attr.kind === 'class-map') &&
			isServerEvaluable(attr.object, serverKnown)
		)
			out.push(attr.object)
		else if (
			attr.kind === 'html' &&
			attr.reactive &&
			isServerEvaluable(attr.node, serverKnown)
		)
			out.push(attr.node)
	}
	return out
}

type SetupLikeComponent = Pick<
	ComponentIR,
	| 'root'
	| 'setup'
	| 'plainSetup'
	| 'clientSetup'
	| 'itemSetup'
	| 'signals'
	| 'serverKnown'
>

export const computeClientNeededNames = (
	component: SetupLikeComponent,
): ReadonlySet<string> => {
	const needed = new Set<string>()
	for (const exprNode of clientExprNodes(component.root))
		for (const n of dependenciesOf(exprNode)) needed.add(n)
	for (const stmt of component.clientSetup)
		for (const n of dependenciesOf(stmt.node)) needed.add(n)
	// A `harvest()` marker is spliced into the client's declaration as authored; the server reads the seed through without it.
	for (const signal of component.signals) {
		if (signal.family !== 'declared') continue
		const { harvest } = signal
		if (harvest?.kind === 'list')
			for (const entry of harvest.entries)
				for (const n of dependenciesOf(entry.value)) needed.add(n)
		if (harvest?.kind === 'scalar')
			for (const n of dependenciesOf(harvest.parser)) needed.add(n)
	}
	// Every item setup statement is client-emitted, in `bindItem` — a ref through its selector alone.
	for (const stmt of component.itemSetup)
		if (stmt.kind !== 'ref')
			for (const n of dependenciesOf(stmt.node)) needed.add(n)
	// Every `setup` entry that ISN'T a plain const (signals, `expose()`) is always client-emitted too — `plainSetup` is `setup`'s only conditional subset.
	const plainSetupNames = new Set(
		component.plainSetup.map(s => s.name).filter((n): n is string => !!n),
	)
	for (const stmt of component.setup)
		if (!stmt.name || !plainSetupNames.has(stmt.name))
			for (const n of dependenciesOf(stmt.node)) needed.add(n)
	let changed = true
	while (changed) {
		changed = false
		for (const stmt of component.plainSetup) {
			if (!stmt.name || !needed.has(stmt.name)) continue
			for (const n of dependenciesOf(stmt.node))
				if (!needed.has(n)) {
					needed.add(n)
					changed = true
				}
		}
	}
	return needed
}

export const serverUsageNames = (
	component: SetupLikeComponent,
): ReadonlySet<string> => {
	const serverNames = new Set<string>()
	for (const stmt of component.setup)
		for (const n of dependenciesOf(stmt.node)) serverNames.add(n)
	// The item setup the server's loop declares.
	for (const stmt of component.itemSetup)
		if (onServer(stmt))
			for (const n of dependenciesOf(stmt.node)) serverNames.add(n)
	for (const exprNode of serverExprNodes(component.root))
		for (const n of dependenciesOf(exprNode)) serverNames.add(n)
	for (const exprNode of serverRenderedThunkNodes(
		component.root,
		component.serverKnown,
	))
		for (const n of dependenciesOf(exprNode)) serverNames.add(n)
	return serverNames
}

export const placePlainImports = (
	ctx: ExtractContext,
	component: SetupLikeComponent,
	plainImports: PlainImportIR[],
	typeTexts: { server: readonly string[]; client: readonly string[] } = {
		server: [],
		client: [],
	},
): {
	server: string[]
	client: string[]
	serverLocalNames: ReadonlySet<string>
} => {
	if (plainImports.length === 0)
		return { server: [], client: [], serverLocalNames: new Set() }

	const serverNames = serverUsageNames(component)
	const clientNames = computeClientNeededNames(component)
	const typeNamesIn = (texts: readonly string[]): ReadonlySet<string> =>
		// A name in an authored TYPE position counts only outside comments: strip them, then take the flat identifier tokens (`identifiersIn`).
		new Set(
			texts.flatMap(t =>
				identifiersIn(
					t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
				),
			),
		)
	const serverTypeNames = typeNamesIn(typeTexts.server)
	const clientTypeNames = typeNamesIn(typeTexts.client)

	const server: string[] = []
	const client: string[] = []
	const serverLocalNames = new Set<string>()
	for (const imp of plainImports) {
		if (imp.sideEffectOnly) {
			// No bound name to trace usage from — a missing side-effect import is a silent runtime bug, not a compile error, so include it everywhere.
			server.push(imp.text)
			client.push(imp.text)
			continue
		}
		const typeOnly = /^import\s+type\b/.test(imp.text)
		const usedServer = imp.localNames.some(
			n => serverNames.has(n) || (typeOnly && serverTypeNames.has(n)),
		)
		const usedClient = imp.localNames.some(
			n => clientNames.has(n) || (typeOnly && clientTypeNames.has(n)),
		)
		if (usedServer) {
			server.push(imp.text)
			for (const n of imp.localNames) serverLocalNames.add(n)
		}
		if (usedClient) client.push(imp.text)
		if (!usedServer && !usedClient)
			ctx.diagnostics.push(
				diagnostic.unusedPlainImport(ctx.source, imp, imp.localNames),
			)
	}
	return { server, client, serverLocalNames }
}
