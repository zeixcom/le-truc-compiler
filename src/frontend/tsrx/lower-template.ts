import {
	type AstNode,
	asArray,
	collapseJsxText,
	freeIdentifiers,
	identifierName,
	isNode,
	jsxName,
	text,
} from '../../ast-utils'
import { isTemplateForOfNode } from '../../core'
import { diagnostic } from '../../diagnostics'
import type { ExtractContext } from '../../extract-context'
import type { ForIR, SignalIR, TemplateNode } from '../../ir'
import {
	finishIf,
	finishSwitch,
	finishTry,
	type Lowering,
	lowerChildrenSkeleton,
	lowerComposeElement as lowerComposeElementShared,
	lowerElement as lowerElementShared,
	lowerLoop,
	reportEmptySwitch,
	validateCondition,
	validateEmptyArm,
} from '../../lower-shared'
import { wordingOf } from '../../surface'
import { CONTEXT_NAMES, JS_GLOBALS } from '../../vocabulary'
import type { IfNode, SwitchNode } from '../../walk'

/* === Condition validation === */

export const lowerIf = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): IfNode | null => {
	const test = node.test
	if (!isNode(test)) return null
	const mode = validateCondition(ctx, signals, test, 'if')
	if (mode === null) return null
	const lowerBranch = (block: unknown): TemplateNode[] =>
		lowerBodyStatements(
			ctx,
			isNode(block) && Array.isArray(block.body) ? block.body : [],
			signals,
			fors,
		)
	return finishIf(
		ctx,
		node,
		test,
		lowerBranch(node.consequent),
		lowerBranch(node.alternate),
		mode,
	)
}

export const lowerSwitch = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): SwitchNode | null => {
	const discriminant = node.discriminant
	if (!isNode(discriminant)) return null
	const mode = validateCondition(ctx, signals, discriminant, 'switch')
	if (mode === null) return null
	const rawCases = Array.isArray(node.cases) ? node.cases : []
	if (rawCases.length === 0) {
		reportEmptySwitch(ctx, node, 'switch')
		return null
	}
	const cases: Array<{ test: AstNode | null; children: TemplateNode[] }> = []
	for (const raw of rawCases as AstNode[]) {
		const children = lowerBodyStatements(ctx, raw.consequent, signals, fors)
		if (children.length === 0) {
			reportEmptySwitch(ctx, raw.start === undefined ? node : raw, 'arm')
			return null
		}
		cases.push({ test: isNode(raw.test) ? raw.test : null, children })
	}
	return finishSwitch(ctx, node, discriminant, cases, mode)
}

/** Lower a control-flow branch body (a statement list): elements, text, fragments, and nested control-flow directives; anything unsupported reports a diagnostic. */
const lowerBodyStatements = (
	ctx: ExtractContext,
	statements: unknown,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): TemplateNode[] => {
	const body = Array.isArray(statements) ? statements : []
	const out: TemplateNode[] = []
	for (const stmt of body) {
		if (stmt.type === 'JSXElement') {
			const tag = jsxName(
				isNode(stmt.openingElement) ? stmt.openingElement.name : null,
			)
			const lowered =
				tag && /^[A-Z]/.test(tag)
					? lowerComposeElement(ctx, stmt, tag, signals, fors)
					: lowerElement(ctx, stmt, signals, fors)
			if (lowered) out.push(lowered)
			continue
		}
		if (stmt.type === 'JSXText') {
			const collapsed = collapseJsxText(String(stmt.value ?? ''))
			if (collapsed) out.push({ kind: 'text', value: collapsed, node: stmt })
			continue
		}
		if (stmt.type === 'JSXFragment') {
			out.push(...lowerChildren(ctx, stmt, signals, fors))
			continue
		}
		if (isTemplateForOfNode(stmt)) {
			const lowered = lowerFor(ctx, stmt, signals, fors)
			if (lowered) out.push(lowered, ...(fors.get(stmt)?.emptyArm ?? []))
			continue
		}
		if (stmt.type === 'JSXIfExpression') {
			const lowered = lowerIf(ctx, stmt, signals, fors)
			if (lowered) out.push(lowered)
			continue
		}
		if (stmt.type === 'JSXSwitchExpression') {
			const lowered = lowerSwitch(ctx, stmt, signals, fors)
			if (lowered) out.push(lowered)
			continue
		}
		if (stmt.type === 'JSXTryExpression') {
			const lowered = lowerTry(ctx, stmt, signals, fors)
			if (lowered) out.push(lowered)
			continue
		}
		if (stmt.type === 'JSXStyleElement') {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					ctx.source,
					stmt,
					'A `<style>` block inside a control-flow branch',
					'Styles are component-scoped — move the block inside the root element, as its direct child.',
				),
			)
			continue
		}
		if (stmt.type === 'ExpressionStatement' && isNode(stmt.expression)) {
			// A bare client-only side effect beside conditionally rendered markup — same free-name contract as a top-level clientSetup statement (host/internals/signals/globals only).
			const free = freeIdentifiers(stmt.expression)
			const bad = [...free].filter(
				name =>
					!JS_GLOBALS.has(name) &&
					!CONTEXT_NAMES.has(name) &&
					!signals.has(name),
			)
			if (bad.length === 0) {
				out.push({
					kind: 'client-stmt',
					text: text(ctx.source, stmt),
					node: stmt,
				})
				continue
			}
		}
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				stmt,
				'A statement other than an output element or a nested directive inside a control-flow branch',
				'Move the statement into setup.',
			),
		)
	}
	return out
}

export const lowerTry = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): (TemplateNode & { kind: 'try' }) | null => {
	const lowerBlock = (block: unknown): TemplateNode[] =>
		lowerBodyStatements(
			ctx,
			isNode(block) && Array.isArray(block.body) ? block.body : [],
			signals,
			fors,
		)
	if (isNode(node.finalizer)) {
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				node.finalizer,
				'A `@finally` arm on a template `@try` block',
				'Remove the arm — a template boundary has `@pending` and `@catch` arms only.',
			),
		)
		return null
	}
	const children = lowerBlock(node.block)
	const handler = isNode(node.handler) ? node.handler : null
	let catchParam: string | null = null
	let catchChildren: TemplateNode[] = []
	if (handler) {
		catchParam = identifierName(handler.param)
		catchChildren = lowerBlock(handler.body)
	}
	const pendingChildren = isNode(node.pending) ? lowerBlock(node.pending) : null
	if (pendingChildren !== null && !handler) {
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				node,
				'A `@pending` arm without a `@catch (e)` arm',
				'An async boundary routes the pending, resolved and error states together (ADR 0005 sub-design 13) — add a `@catch (e)` arm.',
			),
		)
		return null
	}
	return finishTry(ctx, node, {
		children,
		catchParam,
		catchChildren,
		pendingChildren,
		at: {
			body: isNode(node.block) ? node.block : node,
			pending: isNode(node.pending) ? node.pending : node,
			catch: handler?.start === undefined ? node : handler,
		},
	})
}

export const lowerChildren = (
	ctx: ExtractContext,
	parent: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): TemplateNode[] =>
	lowerChildrenSkeleton(ctx, parent, signals, fors, TSRX_LOWERING, {
		onText: (ctx, child, next) => {
			// The retired `&{expr}` lazy child — `&{`/`&[` are lazy destructuring introducers in binding position; diagnose the sigil rather than keep parsing it.
			if (
				next?.type === 'JSXExpressionContainer' &&
				String(child.value ?? '').endsWith('&')
			) {
				const expr = next.expression
				ctx.diagnostics.push(
					diagnostic.retiredLazySigil(
						ctx.source,
						child,
						isNode(expr) ? text(ctx.source, expr) : '…',
					),
				)
			}
		},
		dispatchChild: (ctx, child, out, signals, fors) => {
			if (isTemplateForOfNode(child)) {
				const lowered = lowerFor(ctx, child, signals, fors)
				if (lowered) out.push(lowered, ...(fors.get(child)?.emptyArm ?? []))
				return true
			}
			if (child.type === 'JSXIfExpression') {
				const lowered = lowerIf(ctx, child, signals, fors)
				if (lowered) out.push(lowered)
				return true
			}
			if (child.type === 'JSXSwitchExpression') {
				const lowered = lowerSwitch(ctx, child, signals, fors)
				if (lowered) out.push(lowered)
				return true
			}
			if (child.type === 'JSXTryExpression') {
				const lowered = lowerTry(ctx, child, signals, fors)
				if (lowered) out.push(lowered)
				return true
			}
			if (
				child.type === 'JSXForExpression' &&
				String(child.statementType) === 'ForInStatement'
			) {
				ctx.diagnostics.push(
					diagnostic.unsupported(
						ctx.source,
						child,
						'A `@for-in` loop over object keys',
						'Loop with `@for-of` over an array, for example `Object.keys(record)`.',
					),
				)
				return true
			}
			if (child.type === 'JSXStyleElement') {
				// Style blocks become placeholder elements (tag 'style'); the
				// CSS is extracted via getStyleElementStylesheet, never
				// rendered.
				out.push({
					kind: 'element',
					tag: 'style',
					attrs: [],
					children: [],
					node: child,
				})
				return true
			}
			return false
		},
	})

export const lowerElement = (
	ctx: ExtractContext,
	element: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): TemplateNode & { kind: 'element' } =>
	lowerElementShared(ctx, element, signals, fors, TSRX_LOWERING)

export const lowerComposeElement = (
	ctx: ExtractContext,
	element: AstNode,
	tag: string,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): (TemplateNode & { kind: 'compose' }) | null =>
	lowerComposeElementShared(ctx, element, tag, signals, fors, TSRX_LOWERING)

/** Lower a `@for`'s `@empty { … }` arm: `null` when the loop has none, `false` when the arm was diagnosed (the loop is dropped). */
const lowerEmptyArm = (
	ctx: ExtractContext,
	node: AstNode,
	kind: ForIR['kind'],
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): TemplateNode[] | null | false => {
	if (!isNode(node.empty)) return null
	const arm = lowerBodyStatements(ctx, asArray(node.empty.body), signals, fors)
	if (arm.length === 0) return null
	return validateEmptyArm(ctx, arm, kind, fors, node.empty) ?? false
}

export const lowerFor = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): (TemplateNode & { kind: 'element' }) | null => {
	const statements = isNode(node.body) ? asArray(node.body.body) : []
	const tryStmt = statements.find(s => s.type === 'JSXTryExpression')
	if (isNode(tryStmt)) {
		ctx.diagnostics.push(
			diagnostic.boundaryAsLoopRoot(ctx.source, tryStmt, wordingOf(ctx)),
		)
		return null
	}
	const declarations = isNode(node.left) ? asArray(node.left.declarations) : []
	const indexNode = isNode(node.index) ? node.index : null
	const indexName = identifierName(indexNode)
	return lowerLoop(
		ctx,
		{
			node,
			itemName:
				declarations.length === 1
					? identifierName(declarations[0]?.id) || null
					: null,
			index: indexName ? { name: indexName, at: indexNode } : null,
			iterable: node.right as AstNode,
			key: isNode(node.key) ? node.key : null,
			keyOverList: null,
			extraParams: false,
			statements: isNode(node.body) ? asArray(node.body.body) : [],
			outputOf: stmt => (stmt.type === 'JSXElement' ? stmt : null),
			expressionOutput: null,
			lowerEmptyArm: kind => lowerEmptyArm(ctx, node, kind, signals, fors),
		},
		signals,
		fors,
		TSRX_LOWERING,
	)
}

const TSRX_LOWERING: Lowering = { lowerChildren }
