import {
	type AstNode,
	asArray,
	identifierName,
	isNode,
	text,
	walkNodes,
} from '../../ast-utils'
import { getStyleElementStylesheet, parseModule } from '../../core'
import { diagnostic, type Site } from '../../diagnostics'
import { DEFAULT_EMIT_PATHS, type EmitPaths } from '../../emit-paths'
import type { ExtractContext } from '../../extract-context'
import { createExtractContext } from '../../extract-context'
import {
	type CompileResult,
	runFrontEnd,
	type SurfaceAdapter,
} from '../../front-end'
import { lowerElement } from './lower-template'

/* === Types === */

export type { CompileResult } from '../../front-end'

/* === Internal Functions === */

const newerGrammarHint = (source: string, error: unknown): string => {
	const pos =
		error &&
		typeof error === 'object' &&
		typeof (error as { pos?: unknown }).pos === 'number'
			? (error as { pos: number }).pos
			: undefined
	const around =
		pos !== undefined ? source.slice(Math.max(0, pos - 24), pos + 48) : ''
	const signatures: Array<[RegExp, string]> = [
		[/\bswitch\b/, 'a statement-form switch inside a template'],
	]
	for (const [pattern, what] of signatures)
		if (pattern.test(around))
			return ` — ${what} is not parseable by the pinned @tsrx/core 0.1.63 (pin upgrades are reviewed changes — see ADR 0005 sub-design 2)`
	return ''
}

/** Is `node` a JSX value (`<x/>` or `<>…</>`)? */
const isJsxNode = (node: unknown): boolean => {
	const t = isNode(node) ? String(node.type) : null
	return t === 'JSXElement' || t === 'JSXFragment'
}

/** Does an arrow/function body produce JSX, directly or via a `return`? */
const producesJsx = (body: unknown): boolean => {
	if (isJsxNode(body)) return true
	if (!isNode(body) || body.type !== 'BlockStatement') return false
	return asArray(body.body).some(
		stmt => stmt.type === 'ReturnStatement' && isJsxNode(stmt.argument),
	)
}

const reportReactJsxNearMisses = (ctx: ExtractContext, ast: AstNode): void => {
	// Type positions are skipped: they hold no JSX, conditionals or calls.
	walkNodes(ast, node => {
		if (
			node.type === 'LogicalExpression' &&
			node.operator === '&&' &&
			isJsxNode(node.right)
		)
			ctx.diagnostics.push(
				diagnostic.reactLogicalJsx(
					ctx.source,
					node,
					text(ctx.source, node.left as AstNode),
					text(ctx.source, node),
				),
			)
		if (
			node.type === 'ConditionalExpression' &&
			(isJsxNode(node.consequent) || isJsxNode(node.alternate))
		)
			ctx.diagnostics.push(
				diagnostic.reactTernaryJsx(
					ctx.source,
					node,
					text(ctx.source, node.test as AstNode),
					text(ctx.source, node),
				),
			)
		if (
			node.type === 'CallExpression' &&
			isNode(node.callee) &&
			node.callee.type === 'MemberExpression' &&
			!node.callee.computed &&
			identifierName(node.callee.property) === 'map'
		) {
			const callback = asArray(node.arguments)[0]
			if (
				callback &&
				/Function(Expression)?$/.test(callback.type) &&
				producesJsx(callback.body)
			)
				ctx.diagnostics.push(
					diagnostic.reactMapJsx(
						ctx.source,
						node,
						identifierName(asArray(callback.params)[0]) ?? 'item',
						text(ctx.source, node.callee.object as AstNode),
						text(ctx.source, node),
					),
				)
		}
	})
}

/** The `.tsrx` grammar's half of the shared driver (`front-end.ts`). */
const TSRX_ADAPTER: SurfaceAdapter = {
	surface: 'tsrx',
	componentBodyType: 'JSXCodeBlock',
	preScans: reportReactJsxNearMisses,
	// The `@{ }` container's statements are the setup; its `render` slot is
	// the trailing output expression.
	splitSetupAndOutput: (_ctx, fn) => {
		const codeBlock = fn.body as AstNode
		return {
			setup: asArray(codeBlock.body),
			output: codeBlock.render as AstNode | undefined,
		}
	},
	stylesheetOf: (_ctx, node) => {
		const sheet = getStyleElementStylesheet(node)
		if (sheet) return String(sheet.source ?? '')
		const content = asArray(node.children).find(
			c => !(c.type === 'JSXText' && String(c.value ?? '').trim() === ''),
		)
		return content ? { reason: 'content', at: content } : ''
	},
	lowerElement,
}

const parseErrorSite = (e: unknown): Site => {
	const { pos, raisedAt } = (e ?? {}) as { pos?: unknown; raisedAt?: unknown }
	return typeof pos === 'number'
		? { start: pos, end: typeof raisedAt === 'number' ? raisedAt : pos }
		: undefined
}

/* === Exported Functions === */

export const compileSource = (
	source: string,
	filename: string,
	emitPaths: EmitPaths = DEFAULT_EMIT_PATHS,
): CompileResult => {
	let ast: AstNode
	try {
		ast = parseModule(source, filename)
	} catch (e) {
		return {
			component: null,
			routingSignals: [],
			diagnostics: [
				diagnostic.invalidSource(
					source,
					parseErrorSite(e),
					`Failed to parse ${filename}: ${e instanceof Error ? e.message : String(e)}${newerGrammarHint(source, e)}`,
				),
			],
		}
	}
	return runFrontEnd(
		createExtractContext(source, 'tsrx'),
		ast,
		filename,
		emitPaths,
		TSRX_ADAPTER,
	)
}
