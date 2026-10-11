/** The `.tsx` front end's compiler — the surface-specific half, producing the same `ComponentIR` as the `.tsrx` front end. */

import { asArray, identifierName, isNode } from '../../ast-utils'
import { diagnostic, type Site } from '../../diagnostics'
import { DEFAULT_EMIT_PATHS, type EmitPaths } from '../../emit-paths'
import {
	createExtractContext,
	type ExtractContext,
} from '../../extract-context'
import {
	type CompileResult,
	runFrontEnd,
	type SurfaceAdapter,
} from '../../front-end'
import { claimMarker, markerOf } from '../../imports'
import type { StylesheetRead } from '../../template-output'
import { lowerElement } from './lower-tsx'
import { type AstNode, parseTsxModule } from './to-estree'

/* === Types === */

export type { CompileResult } from '../../front-end'

/* === Spike-local helpers === */

/** Whitespace-only JSX text, or an empty `{}` container (a comment-only one too). */
const isBlankChild = (child: AstNode): boolean =>
	(child.type === 'JSXText' && String(child.value ?? '').trim() === '') ||
	// `to-estree` maps an empty container's `JSXEmptyExpression` to null.
	(child.type === 'JSXExpressionContainer' && !isNode(child.expression))

/** Raw CSS text of a `<style>` element: a `css`-tagged (marker) or bare template-literal child, read verbatim between the backticks; anything else is a refusal. */
const styleElementStylesheet = (
	ctx: ExtractContext,
	node: AstNode,
): StylesheetRead => {
	const children = asArray(node.children).filter(c => !isBlankChild(c))
	const [child, extra] = children
	if (!child) return ''
	if (extra) return { reason: 'content', at: extra }
	const expr =
		child.type === 'JSXExpressionContainer'
			? (child.expression as AstNode | undefined)
			: undefined
	let template = expr
	if (expr?.type === 'TaggedTemplateExpression') {
		const tag = expr.tag as AstNode
		if (markerOf(ctx, tag) !== 'css')
			return identifierName(tag) === 'css'
				? { reason: 'shadowed', at: tag }
				: {
						reason: 'tag',
						at: tag,
						tag: ctx.source.slice(tag.start ?? 0, tag.end ?? 0),
					}
		claimMarker(ctx, tag)
		template = expr.quasi as AstNode | undefined
	}
	if (!template || template.type !== 'TemplateLiteral')
		return { reason: 'content', at: child }
	const substitution = asArray(template.expressions)[0]
	if (substitution) return { reason: 'substitution', at: substitution }
	// Slice between the backticks (the literal's own brackets).
	const start = (template.start ?? 0) + 1
	const end = (template.end ?? 0) - 1
	return ctx.source.slice(start, end)
}

/** The `.tsx` grammar's half of the shared driver (`front-end.ts`). */
const tsxAdapter: SurfaceAdapter = {
	surface: 'tsx',
	componentBodyType: 'BlockStatement',
	// Setup = statements before the single return; template = the returned JSX.
	splitSetupAndOutput: (ctx, fn, filename) => {
		const bodyStmts = asArray((fn.body as AstNode).body)
		const returnStmt = bodyStmts.find(s => s.type === 'ReturnStatement')
		if (
			!returnStmt ||
			bodyStmts[bodyStmts.length - 1] !== returnStmt ||
			!isNode(returnStmt.argument)
		) {
			ctx.diagnostics.push(
				diagnostic.invalidSource(
					ctx.source,
					fn,
					`${filename}: the component function must end in a single \`return <jsx/>\` (setup statements before it).`,
				),
			)
			return null
		}
		return {
			setup: bodyStmts.slice(0, -1),
			output: returnStmt.argument as AstNode,
		}
	},
	stylesheetOf: styleElementStylesheet,
	lowerElement,
}

/** Where the TS parser located its failure, as offsets in `source`; undefined (the whole file) when the error carries none. */
const parseErrorSite = (e: unknown): Site => {
	const location = (
		e as {
			location?: { start?: { offset?: unknown }; end?: { offset?: unknown } }
		}
	)?.location
	const start = location?.start?.offset
	const end = location?.end?.offset
	return typeof start === 'number'
		? { start, end: typeof end === 'number' ? end : start }
		: undefined
}

/* === Exported Functions === */

/**
 * Parse and extract the single exported component from a `.tsx` source:
 * the TS parser + estree converter, then the shared driver over the `.tsx`
 * adapter.
 */
export const compileSourceTsx = (
	source: string,
	filename: string,
	emitPaths: EmitPaths = DEFAULT_EMIT_PATHS,
): CompileResult => {
	let ast: AstNode
	try {
		ast = parseTsxModule(source, filename)
	} catch (e) {
		return {
			component: null,
			routingSignals: [],
			diagnostics: [
				diagnostic.invalidSource(
					source,
					parseErrorSite(e),
					`Failed to parse ${filename}: ${e instanceof Error ? e.message : String(e)}`,
				),
			],
		}
	}
	return runFrontEnd(
		createExtractContext(source, 'tsx'),
		ast,
		filename,
		emitPaths,
		tsxAdapter,
	)
}
