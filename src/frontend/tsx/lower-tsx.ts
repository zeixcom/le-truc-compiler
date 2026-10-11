import {
	asArray,
	identifierName,
	isNode,
	jsxName,
	nodeType,
} from '../../ast-utils'
import { diagnostic } from '../../diagnostics'
import type { ExtractContext } from '../../extract-context'
import type { ForIR, SignalIR, TemplateNode } from '../../ir'
import {
	finishIf,
	finishSwitch,
	finishTry,
	type Lowering,
	lowerChildrenSkeleton,
	lowerComposeElement,
	lowerElement as lowerElementShared,
	lowerLoop,
	reportEmptySwitch,
	validateCondition,
	validateEmptyArm,
} from '../../lower-shared'
import { wordingOf } from '../../surface'
import type { IfNode, SwitchNode } from '../../walk'
import type { AstNode } from './to-estree'

/** Whether `node` is a JSX value (`<x/>` or `<>…</>`). */
const isJsxNode = (node: unknown): node is AstNode => {
	const t = isNode(node) ? String(node.type) : null
	return t === 'JSXElement' || t === 'JSXFragment'
}

/** Lower one JSX value (element/fragment) into a children list. */
const lowerJsxValue = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): TemplateNode[] => {
	if (node.type === 'JSXFragment')
		return lowerChildren(ctx, node, signals, fors)
	// A PascalCase element is a compose site wherever a JSX value lowers — an arm root included; a `truc:try` tag is namespaced, so it never reaches this branch.
	const opening = isNode(node.openingElement) ? node.openingElement : null
	const tag = jsxName(isNode(opening) ? opening.name : null)
	if (tag && /^[A-Z]/.test(tag)) {
		const lowered = lowerComposeElement(
			ctx,
			node,
			tag,
			signals,
			fors,
			TSX_LOWERING,
		)
		return lowered ? [lowered] : []
	}
	if (isTrucTry(node)) {
		const lowered = lowerTrucTry(ctx, node, signals, fors)
		return lowered ? [lowered] : []
	}
	return [lowerElement(ctx, node, signals, fors)]
}

/* === @if → ConditionalExpression / LogicalExpression === */

/** Lower `{c ? <a/> : <b/>}` or `{c && <a/>}` into the `if` conditional. */
const lowerIfExpr = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): IfNode | null => {
	let test: AstNode | null = null
	let thenSrc: AstNode | null = null
	let alternateSrc: AstNode | null = null
	if (node.type === 'ConditionalExpression') {
		test = (node.test as AstNode | null) ?? null
		thenSrc = (node.consequent as AstNode | null) ?? null
		alternateSrc = (node.alternate as AstNode | null) ?? null
	} else if (
		node.type === 'LogicalExpression' &&
		String(node.operator) === '&&'
	) {
		test = (node.left as AstNode | null) ?? null
		thenSrc = (node.right as AstNode | null) ?? null
	}
	if (!isNode(test)) return null
	if (
		(isNode(thenSrc) && isMapCall(thenSrc)) ||
		(isNode(alternateSrc) && isMapCall(alternateSrc))
	) {
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				node,
				'A `.map()` loop as a conditional branch',
				"Only the empty state combines a condition with a loop — write `{xs.length === 0 ? <empty/> : xs.map(…)}`, testing the mapped array's own `length`, or move the loop out of the conditional.",
			),
		)
		return null
	}
	const mode = validateCondition(ctx, signals, test, 'if')
	if (mode === null) return null
	const then = isJsxNode(thenSrc)
		? lowerJsxValue(ctx, thenSrc, signals, fors)
		: []
	const alternate = isJsxNode(alternateSrc)
		? lowerJsxValue(ctx, alternateSrc, signals, fors)
		: []
	if (!isJsxNode(thenSrc) && !isJsxNode(alternateSrc)) {
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				node,
				'A conditional branch that is not a JSX element',
				'Write each branch as an element: `{cond ? <a/> : <b/>}` or `{cond && <a/>}`.',
			),
		)
		return null
	}
	return finishIf(ctx, node, test, then, alternate, mode)
}

/* === @switch → IIFE over a statement switch === */

/** Lower a `switch` IIFE into the `switch` conditional; recognition is shape-based — object identity does not survive the TS→estree conversion. */
const lowerSwitchIife = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): SwitchNode | null => {
	const fn = node.callee as AstNode | undefined
	const body = fn?.body as AstNode | undefined
	if (!isNode(body) || body.type !== 'BlockStatement') return null
	const stmts = asArray(body.body)
	const switchStmt = stmts.find(s => s.type === 'SwitchStatement')
	if (!switchStmt) return null
	if (stmts.length !== 1) {
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				node,
				'A `switch` IIFE that contains more than the `switch` statement',
				'Move the other statements into the component setup.',
			),
		)
		return null
	}
	const discriminant = switchStmt.discriminant as AstNode | undefined
	if (!isNode(discriminant)) return null
	const mode = validateCondition(ctx, signals, discriminant, 'switch')
	if (mode === null) return null
	const rawCases = asArray(switchStmt.cases)
	if (rawCases.length === 0) {
		reportEmptySwitch(ctx, node, 'switch')
		return null
	}
	const cases: Array<{ test: AstNode | null; children: TemplateNode[] }> = []
	for (const raw of rawCases) {
		const armStmts = asArray(raw.consequent)
		const ret = armStmts.find(s => s.type === 'ReturnStatement') as
			| AstNode
			| undefined
		const arm = ret?.argument as AstNode | undefined
		if (armStmts.length !== 1 || !isJsxNode(arm)) {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					ctx.source,
					raw.start === undefined ? node : raw,
					'A `switch` case other than `case <expr>: return <jsx/>`',
					'Statement-context arms are `.tsrx` grammar — write each case as a single `return` of JSX.',
				),
			)
			return null
		}
		const children = lowerJsxValue(ctx, arm, signals, fors)
		if (children.length === 0) {
			reportEmptySwitch(ctx, raw.start === undefined ? node : raw, 'arm')
			return null
		}
		cases.push({ test: isNode(raw.test) ? raw.test : null, children })
	}
	return finishSwitch(ctx, node, discriminant, cases, mode)
}

/* === @try family → <truc:try pending catch> === */

/** Whether `node` is a `<truc:try>` element — the one `truc:*` intrinsic this front end lowers; other namespaced tags fall to `lowerElement` (LTC053). */
const isTrucTry = (node: unknown): node is AstNode => {
	if (!isNode(node) || node.type !== 'JSXElement') return false
	const opening = node.openingElement
	const name = isNode(opening) ? opening.name : null
	return (
		isNode(name) &&
		name.type === 'JSXNamespacedName' &&
		jsxName(name.namespace) === 'truc' &&
		jsxName(name.name) === 'try'
	)
}

/** Lower `<truc:try catch={e => <jsx/>}>ok</truc:try>` — the error boundary, async with `pending={<jsx/>}`; the arms are inline shapes the compiler consumes, never evaluates. */
const lowerTrucTry = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): (TemplateNode & { kind: 'try' }) | null => {
	const opening = node.openingElement as AstNode
	let pendingSrc: AstNode | null = null
	let catchFn: AstNode | null = null
	let malformed = false
	for (const attr of asArray(opening.attributes)) {
		const name = attr.type === 'JSXAttribute' ? jsxName(attr.name) : null
		const value = isNode(attr.value) ? attr.value : null
		const expr =
			value?.type === 'JSXExpressionContainer' && isNode(value.expression)
				? value.expression
				: null
		if (name === 'pending' && isJsxNode(expr)) pendingSrc = expr
		else if (
			name === 'catch' &&
			isNode(expr) &&
			nodeType(expr) === 'ArrowFunctionExpression' &&
			isJsxNode(expr.body)
		)
			catchFn = expr
		else malformed = true
	}
	if (malformed || !catchFn) {
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				node,
				'A `<truc:try>` boundary with arms that are not inline, or with other attributes',
				'The compiler reads the arms and never evaluates them — write `catch={e => <jsx/>}` (an arrow whose body is the arm) and, optionally, `pending={<jsx/>}`, and no other attributes.',
			),
		)
		return null
	}
	const catchParam = identifierName(asArray(catchFn.params)[0]) ?? null
	const catchSrc = catchFn.body as AstNode
	const children = lowerChildren(ctx, node, signals, fors)
	const catchChildren = lowerJsxValue(ctx, catchSrc, signals, fors)
	const pendingChildren =
		pendingSrc === null ? null : lowerJsxValue(ctx, pendingSrc, signals, fors)
	return finishTry(ctx, node, {
		children,
		catchParam,
		catchChildren,
		pendingChildren,
		at: {
			body: node,
			pending: pendingSrc ?? node,
			catch: catchSrc.start === undefined ? node : catchSrc,
		},
	})
}

/* === @for → `.map()` === */

/** The empty-state idiom `{xs.length === 0 ? <empty/> : xs.map(…)}` — `.tsx`'s `@for … @empty`, recognized by shape; the loop and its arm lower to one `ForIR`. */
const emptyStateIdiomOf = (
	node: AstNode,
): { loop: AstNode; empty: AstNode } | null => {
	if (node.type !== 'ConditionalExpression') return null
	const test = node.test as AstNode | undefined
	const empty = node.consequent as AstNode | undefined
	const loop = node.alternate as AstNode | undefined
	if (!isNode(test) || test.type !== 'BinaryExpression') return null
	if (String(test.operator) !== '===') return null
	const left = test.left as AstNode | undefined
	const right = test.right as AstNode | undefined
	if (
		!isNode(left) ||
		left.type !== 'MemberExpression' ||
		left.computed ||
		identifierName(left.property) !== 'length'
	)
		return null
	if (!isNode(right) || right.type !== 'Literal' || right.value !== 0)
		return null
	if (!isJsxNode(empty) || !isNode(loop) || !isMapCall(loop)) return null
	const subject = identifierName(left.object)
	const receiver = identifierName((loop.callee as AstNode).object)
	if (!subject || subject !== receiver) return null
	return { loop, empty }
}

/** Lower the empty-state idiom's arm: `null` when the loop has none, `false` when the arm was diagnosed (the loop is dropped). */
const lowerEmptyArm = (
	ctx: ExtractContext,
	emptySrc: AstNode | null,
	kind: ForIR['kind'],
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): TemplateNode[] | null | false => {
	if (!emptySrc) return null
	const arm = lowerJsxValue(ctx, emptySrc, signals, fors)
	if (arm.length === 0) return null
	return validateEmptyArm(ctx, arm, kind, fors, emptySrc) ?? false
}

/** Whether `node` is an IIFE this lowering recognizes: `(() => { … })()` with a single arrow argument and a block body, by shape (see `lowerSwitchIife`). */
const asIife = (node: AstNode): AstNode | null => {
	if (node.type !== 'CallExpression') return null
	const callee = node.callee as AstNode | undefined
	if (
		!isNode(callee) ||
		callee.type !== 'ArrowFunctionExpression' ||
		asArray(callee.params).length !== 0 ||
		asArray(node.arguments).length !== 0
	)
		return null
	const body = callee.body as AstNode | undefined
	if (!isNode(body) || body.type !== 'BlockStatement') return null
	return node
}

/** Is this `.map()`-shaped call producing JSX (a loop)? */
const isMapCall = (node: AstNode): boolean => {
	if (node.type !== 'CallExpression') return false
	const callee = node.callee as AstNode | undefined
	return (
		isNode(callee) &&
		callee.type === 'MemberExpression' &&
		!callee.computed &&
		identifierName(callee.property) === 'map' &&
		isNode(callee.object)
	)
}

export const lowerFor = (
	ctx: ExtractContext,
	node: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
	/** The empty-state idiom's `<empty/>` arm, when the loop came from one. */
	emptySrc: AstNode | null = null,
): TemplateNode | null => {
	const callee = node.callee as AstNode
	const callback = asArray(node.arguments)[0]
	if (!isNode(callback) || !/Function(Expression)?$/.test(callback.type))
		return null
	const params = asArray(callback.params)
	const indexName = identifierName(params[1])
	const body = callback.body as AstNode | undefined
	if (!isNode(body)) return null
	const block = body.type === 'BlockStatement'
	// A `<truc:try>` root is a boundary, not an element: name the loop rule rather than let `lowerElement` report an unrecognized tag.
	const root = block
		? asArray(body.body).find(s => s.type === 'ReturnStatement')?.argument
		: body
	if (isNode(root) && isTrucTry(root)) {
		ctx.diagnostics.push(
			diagnostic.boundaryAsLoopRoot(ctx.source, root, wordingOf(ctx)),
		)
		return null
	}
	return lowerLoop(
		ctx,
		{
			node,
			itemName: identifierName(params[0]),
			index: indexName ? { name: indexName, at: params[1] as AstNode } : null,
			iterable: callee.object as AstNode,
			key: null,
			keyOverList: isNode(params[1]) ? (params[1] as AstNode) : null,
			extraParams: params.length > 2,
			statements: block ? asArray(body.body) : [],
			outputOf: stmt =>
				stmt.type === 'ReturnStatement' && isJsxNode(stmt.argument)
					? (stmt.argument as AstNode)
					: null,
			expressionOutput: !block && isJsxNode(body) ? body : null,
			lowerEmptyArm: kind => lowerEmptyArm(ctx, emptySrc, kind, signals, fors),
		},
		signals,
		fors,
		TSX_LOWERING,
	)
}

/* === Children / element lowering (shared skeleton, .tsx dispatch) === */

export const lowerChildren = (
	ctx: ExtractContext,
	parent: AstNode,
	signals: ReadonlyMap<string, SignalIR>,
	fors: Map<AstNode, ForIR>,
): TemplateNode[] =>
	lowerChildrenSkeleton(ctx, parent, signals, fors, TSX_LOWERING, {
		dispatchChild: (ctx, child, out, signals, fors) => {
			if (!isTrucTry(child)) return false
			const lowered = lowerTrucTry(ctx, child, signals, fors)
			if (lowered) out.push(lowered)
			return true
		},
		dispatchControlFlow: (ctx, expr, out, _container, signals, fors) => {
			const idiom = emptyStateIdiomOf(expr)
			if (idiom) {
				const lowered = lowerFor(ctx, idiom.loop, signals, fors, idiom.empty)
				if (lowered)
					out.push(lowered, ...(fors.get(idiom.loop)?.emptyArm ?? []))
				return true
			}
			if (
				expr.type === 'ConditionalExpression' ||
				(expr.type === 'LogicalExpression' && String(expr.operator) === '&&')
			) {
				const lowered = lowerIfExpr(ctx, expr, signals, fors)
				if (lowered) out.push(lowered)
				return true
			}
			if (isMapCall(expr)) {
				const lowered = lowerFor(ctx, expr, signals, fors)
				if (lowered) out.push(lowered)
				return true
			}
			if (asIife(expr)) {
				const body = (expr.callee as AstNode).body as AstNode
				if (asArray(body.body).some(s => s.type === 'SwitchStatement')) {
					const lowered = lowerSwitchIife(ctx, expr, signals, fors)
					if (lowered) out.push(lowered)
					return true
				}
				// An unrecognized IIFE is an ordinary expression child — usually a string-producing block, legal and static.
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
	lowerElementShared(ctx, element, signals, fors, TSX_LOWERING)

const TSX_LOWERING: Lowering = { lowerChildren }
