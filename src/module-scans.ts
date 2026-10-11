import {
	type AstNode,
	asArray,
	forEachChild,
	forEachFreeIdentifier,
	identifierName,
	isNode,
	walkNodes,
} from './ast-utils'
import { diagnostic } from './diagnostics'
import type { ExtractContext } from './extract-context'
import type { LeTrucImport } from './imports'
import { malformedSelectorReason } from './selector-syntax'
import {
	COLLECTOR_HELPERS,
	CONTEXT_NAMES,
	FACTORY_CONTEXT_MEMBERS,
	REAL_EXPORT_NAMES,
} from './vocabulary'

export const reportMalformedSelectors = (
	ctx: ExtractContext,
	ast: AstNode,
): void => {
	// Type positions are skipped: they hold no call expressions.
	walkNodes(ast, node => {
		if (node.type === 'CallExpression') {
			const helper = identifierName(node.callee)
			if (helper === 'first' || helper === 'all') {
				const arg = asArray(node.arguments)[0]
				if (
					isNode(arg) &&
					arg.type === 'Literal' &&
					typeof arg.value === 'string'
				) {
					const reason = malformedSelectorReason(arg.value)
					if (reason)
						ctx.diagnostics.push(
							diagnostic.malformedSelector(
								ctx.source,
								arg,
								helper,
								arg.value,
								reason,
							),
						)
				}
			}
		}
	})
}

export const reportDeferredCollectorCalls = (
	ctx: ExtractContext,
	fn: AstNode,
): void => {
	const FUNCTION_TYPES = new Set([
		'FunctionDeclaration',
		'FunctionExpression',
		'ArrowFunctionExpression',
	])
	// The declared Lists (`createList`/`deriveList` consts, an item's own included): a `.map()` over one is a reactive loop whose callback body is the item's setup, mounted in `bindItem`'s collector.
	const lists = new Set<string>()
	walkNodes(fn, node => {
		if (node.type !== 'VariableDeclarator' || !isNode(node.init)) return
		const callee = identifierName(node.init.callee)
		const name = identifierName(node.id)
		if (name && (callee === 'createList' || callee === 'deriveList'))
			lists.add(name)
	})
	const visit = (node: unknown, depth: number): void => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child, depth)
			return
		}
		if (!isNode(node)) return
		if (depth > 0 && node.type === 'CallExpression') {
			// `identifierName` returns null for a member callee, so `list.pass(…)` on some unrelated object never matches.
			const helper = identifierName(node.callee)
			if (helper && COLLECTOR_HELPERS.has(helper))
				ctx.diagnostics.push(
					diagnostic.deferredCollectorCall(ctx.source, node, helper),
				)
		}
		// `each(collection, item => …)` runs its callback inside a collector of its own (`withCollector`), so a helper called directly in that callback is registered, not deferred; its body keeps the caller's depth.
		if (
			node.type === 'CallExpression' &&
			identifierName(node.callee) === 'each'
		) {
			const [collection, callback, ...rest] = Array.isArray(node.arguments)
				? node.arguments
				: []
			visit(node.callee, depth)
			visit(collection, depth)
			if (isNode(callback) && FUNCTION_TYPES.has(String(callback.type))) {
				visit(callback.params, depth + 1)
				visit(callback.body, depth)
			} else visit(callback, depth)
			visit(rest, depth)
			return
		}
		// A reactive loop's `map` callback: its block body is the item's setup, run inside `bindItem`'s collector — a helper called directly there is registered per item, not deferred.
		const callee = node.type === 'CallExpression' ? node.callee : null
		if (
			isNode(callee) &&
			callee.type === 'MemberExpression' &&
			callee.computed !== true &&
			identifierName(callee.property) === 'map' &&
			lists.has(identifierName(callee.object) ?? '')
		) {
			const [callback, ...rest] = Array.isArray(node.arguments)
				? node.arguments
				: []
			visit(callee, depth)
			if (isNode(callback) && FUNCTION_TYPES.has(String(callback.type))) {
				visit(callback.params, depth + 1)
				visit(callback.body, depth)
			} else visit(callback, depth)
			visit(rest, depth)
			return
		}
		// Type positions are skipped: they hold no call expressions.
		const nextDepth = FUNCTION_TYPES.has(String(node.type)) ? depth + 1 : depth
		forEachChild(node, child => visit(child, nextDepth))
	}
	visit(fn.body, 0)
}

export const reportLeTrucImportMismatch = (
	ctx: ExtractContext,
	ast: AstNode,
	leTrucImports: LeTrucImport[],
): void => {
	const usage = new Map<string, AstNode>()
	// Type positions are walked: an unimported name in one (`typeof createState`, an error class as an annotation) is missing its import exactly as a value read is.
	forEachFreeIdentifier(
		ast,
		node => {
			const name = String(node.name)
			if (REAL_EXPORT_NAMES.has(name) && !usage.has(name)) usage.set(name, node)
		},
		'descend',
	)

	const imported = new Map<string, AstNode | undefined>()
	for (const imp of leTrucImports)
		for (const name of imp.names)
			if (!imported.has(name)) imported.set(name, imp.specifiers.get(name))
	const contextVocabulary = new Set<string>([
		...FACTORY_CONTEXT_MEMBERS,
		...CONTEXT_NAMES,
	])
	for (const [name, read] of usage)
		if (!imported.has(name))
			ctx.diagnostics.push(
				diagnostic.missingRealExportImport(ctx.source, read, name),
			)
	for (const [name, specifier] of imported)
		if (contextVocabulary.has(name))
			ctx.diagnostics.push(
				diagnostic.contextNameInImport(ctx.source, specifier, name),
			)
}
