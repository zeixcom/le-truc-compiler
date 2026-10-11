import {
	type AstNode,
	asArray,
	freeIdentifiers,
	identifierName,
	isNode,
	walkNodes,
} from './ast-utils'
import { diagnostic, type LocalDiagnostic } from './diagnostics'
import {
	containsImpureAmbient,
	foldableHostProps,
	foldableRefGuards,
	foldableRenderScope,
	hostDerivedFold,
	isServerEvaluable,
} from './evaluability'
import { declaredRefNames } from './first-refs'
import type { AttributeIR, ComponentIR, TemplateNode } from './ir'
import { CLIENT_ONLY_PRIMITIVES, CONTEXT_NAMES } from './vocabulary'
import { childNodes } from './walk'

/* === The declared vocabulary === */

/** The reserved parameter that carries the page-ambient record. */
export const AMBIENT_RECORD_PARAM = 'i18n'

export const PAGE_AMBIENT_TYPES: Readonly<Record<string, string>> = {
	lang: 'string',
	t: 'T',
	timeZone: 'string',
	currency: 'string',
	dir: "'ltr' | 'rtl'",
}

/** The member names of {@link PAGE_AMBIENT_TYPES} — what the check reads. */
export const PAGE_AMBIENTS: ReadonlySet<string> = new Set(
	Object.keys(PAGE_AMBIENT_TYPES),
)

export const FOLD_HARNESS_NAMES: ReadonlySet<string> = new Set(['isPending'])

export const PAGE_CONTEXT_GLOBALS: ReadonlySet<string> = new Set([
	'document',
	'window',
	'globalThis',
	'self',
	'top',
	'parent',
	'frames',
	'opener',
	'navigator',
	'location',
	'history',
	'screen',
	'visualViewport',
	'localStorage',
	'sessionStorage',
	'indexedDB',
	'caches',
	'customElements',
	'performance',
])

/* === Exported Functions === */

/** Page-context globals `node` reads (scope-aware), sorted. */
export const pageContextReads = (node: AstNode): string[] =>
	[...freeIdentifiers(node)].filter(n => PAGE_CONTEXT_GLOBALS.has(n)).sort()

export const ambientRecordViolations = (
	source: string,
	paramsNode: AstNode | null,
): LocalDiagnostic[] => {
	if (!paramsNode || paramsNode.type !== 'ObjectPattern') return []
	const out: LocalDiagnostic[] = []
	for (const prop of asArray(paramsNode.properties)) {
		if (prop.type !== 'Property') continue
		if (identifierName(prop.key) !== AMBIENT_RECORD_PARAM) continue
		let value = prop.value
		if (isNode(value) && value.type === 'AssignmentPattern') value = value.left
		if (!isNode(value) || value.type !== 'ObjectPattern') continue
		for (const inner of asArray(value.properties)) {
			if (inner.type === 'RestElement') {
				out.push(
					diagnostic.undeclaredPageAmbient(source, inner, null, PAGE_AMBIENTS),
				)
				continue
			}
			if (inner.type !== 'Property') continue
			const member = inner.computed ? null : identifierName(inner.key)
			if (member === null || !PAGE_AMBIENTS.has(member))
				out.push(
					diagnostic.undeclaredPageAmbient(
						source,
						inner,
						member,
						PAGE_AMBIENTS,
					),
				)
		}
	}
	return out
}

export const assertFoldScopeClosed = (component: ComponentIR): void => {
	const own = new Set<string>([
		...component.paramNames,
		...component.setup.flatMap(stmt => (stmt.name ? [stmt.name] : [])),
		...component.signals.map(signal => signal.name),
		...FOLD_HARNESS_NAMES,
	])
	const foreign = [...component.serverKnown].filter(name => !own.has(name))
	if (foreign.length > 0)
		throw new Error(
			`Partial-readiness invariant (ADR 0012 s4): <${component.tag}>'s render scope holds ${foreign.map(n => `\`${n}\``).join(', ')}, which is neither an own arg, an own setup name, nor a FOLD_HARNESS_NAMES member. Declare the input in src/fold-inputs.ts or keep it out of the fold.`,
		)
}

export const checkFoldInputs = (
	component: ComponentIR,
	diagnostics: LocalDiagnostic[],
): void => {
	assertFoldScopeClosed(component)
	const { source } = component
	const refNames = declaredRefNames(component.firstRefs)

	const realmOwned = (node: AstNode): boolean =>
		[...freeIdentifiers(node)].some(
			n =>
				CONTEXT_NAMES.has(n) ||
				CLIENT_ONLY_PRIMITIVES.has(n) ||
				refNames.has(n),
		)
	const isFunction = (node: AstNode): boolean =>
		/Function(Expression)?$/.test(String(node.type))

	const tainted = new Map<string, string[]>()
	let changed = true
	while (changed) {
		changed = false
		for (const stmt of component.setup) {
			if (!stmt.name || tainted.has(stmt.name) || !isFunction(stmt.node))
				continue
			const reads = readsOf(stmt.node, tainted)
			if (reads.length === 0) continue
			tainted.set(stmt.name, reads)
			changed = true
		}
	}

	const report = (node: AstNode, where: string, reads: string[]): void => {
		diagnostics.push(
			diagnostic.foldReadsPageContext(
				source,
				node,
				where,
				reads,
				PAGE_AMBIENTS,
			),
		)
	}
	const checkEvaluated = (node: AstNode | null, where: string): void => {
		if (!node) return
		const reads = readsOf(node, tainted)
		if (reads.length > 0) report(node, where, reads)
	}

	for (const stmt of component.setup) {
		if (!stmt.name || isFunction(stmt.node)) continue
		const signal = component.signals.find(s => s.name === stmt.name)
		if (signal?.family === 'context') {
			checkEvaluated(signal.fallback, `the \`${stmt.name}\` context fallback`)
			continue
		}
		if (realmOwned(stmt.node)) continue
		checkEvaluated(stmt.node, `setup const \`${stmt.name}\``)
	}

	const hostProps = foldableHostProps(component)
	const refGuards = foldableRefGuards(component)
	const renderScope = foldableRenderScope(component)
	/** Whether the server folds a reactive thunk (emit-server's three routes). */
	const folds = (thunk: AstNode, scope: ReadonlySet<string>): boolean =>
		isServerEvaluable(thunk, scope) ||
		hostDerivedFold(
			thunk,
			hostProps,
			refGuards,
			new Set([...renderScope, ...scope]),
		) !== null
	const checkReactive = (
		thunk: AstNode,
		scope: ReadonlySet<string>,
		where: string,
	): void => {
		const reads = readsOf(thunk, tainted)
		if (reads.length > 0 && folds(thunk, scope)) report(thunk, where, reads)
	}

	const checkAttr = (
		attr: AttributeIR,
		tag: string,
		scope: ReadonlySet<string>,
	): void => {
		switch (attr.kind) {
			case 'server':
				checkEvaluated(attr.node, `attribute \`${attr.name}\` on <${tag}>`)
				return
			case 'reactive':
				checkReactive(
					attr.thunk,
					scope,
					`attribute \`${attr.name}\` on <${tag}>`,
				)
				return
			case 'class-map':
			case 'style-map':
				checkReactive(
					attr.object,
					scope,
					`the \`${attr.kind === 'class-map' ? 'class' : 'style'}\` map on <${tag}>`,
				)
				return
			case 'html':
				checkReactive(attr.node, scope, `the HTML content of <${tag}>`)
				return
			default:
				return
		}
	}

	const visit = (node: TemplateNode, scope: ReadonlySet<string>): void => {
		let inner = scope
		switch (node.kind) {
			case 'element': {
				const loop = [...component.fors.values()].find(f => f.output === node)
				if (loop) {
					if (loop.kind === 'each') {
						checkEvaluated(loop.iterable, 'the items of a loop')
						if (containsImpureAmbient(loop.iterable, scope))
							diagnostics.push(
								diagnostic.impureLoopItems(source, loop.iterable),
							)
					}
					const loopScope = new Set(scope)
					loopScope.add(loop.itemName)
					if (loop.kind === 'each') {
						if (loop.indexName) loopScope.add(loop.indexName)
						for (const hoisted of loop.hoisted) {
							checkEvaluated(hoisted.node, `loop const \`${hoisted.name}\``)
							loopScope.add(hoisted.name)
						}
					} else {
						if (loop.keyName) loopScope.add(loop.keyName)
						for (const stmt of loop.setup)
							if (stmt.name) loopScope.add(stmt.name)
					}
					inner = loopScope
				}
				for (const attr of node.attrs) checkAttr(attr, node.tag, inner)
				break
			}
			case 'expr':
				if (node.reactivity === 'reactive')
					checkReactive(node.expr, scope, 'a text child')
				else checkEvaluated(node.expr, 'a text child')
				break
			case 'conditional':
				if (node.mode === 'reactive') {
					// The initial winner folds like any reactive site.
					checkReactive(node.test, scope, 'a condition')
					break
				}
				checkEvaluated(
					node.test,
					node.construct === 'if' ? 'a condition' : 'a switch discriminant',
				)
				for (const arm of node.arms)
					if (arm.test) checkEvaluated(arm.test, 'a switch case')
				break
			case 'compose':
				for (const attr of node.attrs)
					if (attr.kind === 'arg')
						checkEvaluated(
							attr.node,
							`arg \`${attr.name}\` of <${node.component}>`,
						)
				break
			case 'try':
				if (node.catchParam) {
					const catchScope = new Set(scope)
					catchScope.add(node.catchParam)
					for (const child of node.children) visit(child, scope)
					for (const child of node.catchChildren) visit(child, catchScope)
					for (const child of node.pendingChildren ?? []) visit(child, scope)
					return
				}
				break
			default:
				break
		}
		for (const child of childNodes(node)) visit(child, inner)
	}
	visit(component.root, component.serverKnown)
	for (const loop of component.fors.values())
		for (const node of loop.emptyArm ?? []) visit(node, component.serverKnown)
}

/* === Internal Functions === */

const readsOf = (
	node: AstNode,
	tainted: ReadonlyMap<string, string[]>,
): string[] => {
	const reads = new Set([...pageContextReads(node), ...recordMemberReads(node)])
	for (const name of freeIdentifiers(node))
		for (const read of tainted.get(name) ?? []) reads.add(read)
	return [...reads].sort()
}

const recordMemberReads = (node: AstNode): string[] => {
	const out: string[] = []
	// Type positions are skipped: a member read never occurs in one.
	walkNodes(node, current => {
		if (
			current.type === 'MemberExpression' &&
			isNode(current.object) &&
			current.object.type === 'Identifier' &&
			String(current.object.name) === AMBIENT_RECORD_PARAM
		) {
			const member = current.computed ? null : identifierName(current.property)
			if (member === null) out.push(`${AMBIENT_RECORD_PARAM}[…]`)
			else if (!PAGE_AMBIENTS.has(member))
				out.push(`${AMBIENT_RECORD_PARAM}.${member}`)
		}
	})
	return out
}
