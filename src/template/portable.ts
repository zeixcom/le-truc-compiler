import {
	type AstNode,
	asArray,
	forEachChild,
	identifierName,
	isNode,
} from '../ast-utils'
import type { ComponentIR, SignalIR } from '../ir'
import type {
	ComparisonOperator,
	HoleValue,
	LogicalOperator,
	PortableExpr,
	PortableValue,
	Segment,
} from './operations'

/* === Types === */

/** One message key at the partial's locale: its pattern, and its text when it takes no argument. */
export type LocaleMessage = { pattern: string; literal: string | null }

/** What a name means where an expression reads it. */
export type Binding =
	| { kind: 'arg'; name: string; fallback: AstNode | null }
	| { kind: 'item'; name: string }
	/** A const: its initializer stands in for it, read where it was declared. */
	| { kind: 'expr'; node: AstNode; scope: Scope }
	| { kind: 'value'; value: PortableValue }
	| { kind: 'messages' }
	/** A name the portable subset cannot read: a shadowing binding, an opaque const. */
	| { kind: 'opaque' }

export type Scope = {
	readonly bindings: ReadonlyMap<string, Binding>
	readonly parent: Scope | null
}

export type PortableContext = {
	component: ComponentIR
	/** Message keys at the partial's locale. */
	messages: ReadonlyMap<string, LocaleMessage>
	/** Host props whose server truth is known (`foldableHostProps`). */
	hostProps: ReadonlySet<string>
}

/* === Constants === */

const COMPARISONS: ReadonlySet<string> = new Set([
	'===',
	'!==',
	'<',
	'<=',
	'>',
	'>=',
])

const LOGICAL: ReadonlySet<string> = new Set(['&&', '||', '??'])

const TYPE_WRAPPERS: ReadonlySet<string> = new Set([
	'TSAsExpression',
	'TSNonNullExpression',
	'TSSatisfiesExpression',
	'ParenthesizedExpression',
])

const LOCALE_FORMATTERS: ReadonlySet<string> = new Set([
	'toLocaleString',
	'toLocaleDateString',
	'toLocaleTimeString',
])

/* === Internal Functions === */

const unwrap = (node: unknown): AstNode | null => {
	let current = isNode(node) ? node : null
	while (current && TYPE_WRAPPERS.has(current.type))
		current = isNode(current.expression) ? current.expression : null
	return current
}

const lookup = (scope: Scope | null, name: string): Binding | undefined => {
	for (let s = scope; s; s = s.parent) {
		const binding = s.bindings.get(name)
		if (binding) return binding
	}
	return undefined
}

const signalNamed = (
	ctx: PortableContext,
	name: string,
): SignalIR | undefined =>
	ctx.component.signals.find(signal => signal.name === name)

/** The node a signal's initial value is, or null when no portable node is. */
const signalInitial = (signal: SignalIR): AstNode | null => {
	if (signal.family === 'context') return signal.fallback
	if (signal.unresolvable || !signal.init) return null
	if (
		signal.constructor === 'createCell' ||
		signal.constructor === 'createState'
	)
		return signal.init
	if (
		(signal.constructor === 'deriveCell' ||
			signal.constructor === 'createMemo') &&
		signal.init.type === 'ArrowFunctionExpression' &&
		asArray(signal.init.params).length === 0 &&
		!signal.init.async &&
		isNode(signal.init.body) &&
		signal.init.body.type !== 'BlockStatement'
	)
		return signal.init.body
	return null
}

/** The node seeding `host.<prop>` and the scope it reads in, as `hostSeedExpr` chooses it; null for a Parser-backed prop, whose seed is a parser call. */
const hostSeed = (
	ctx: PortableContext,
	scope: Scope,
	prop: string,
): { node: AstNode; scope: Scope } | PortableExpr | null => {
	if (!ctx.hostProps.has(prop)) return null
	const { component } = ctx
	const decl = component.exposeProps.get(prop)
	if (decl?.parser) return null
	if (decl?.initNode) return { node: decl.initNode, scope: rootOf(scope) }
	const rootAttr = component.root.attrs.find(
		a => a.kind === 'server' && a.name === prop,
	)
	if (rootAttr?.kind === 'server')
		return { node: rootAttr.node, scope: rootOf(scope) }
	if (!component.paramNames.includes(prop)) return null
	const binding = lookup(rootOf(scope), prop)
	return binding?.kind === 'arg' ? { kind: 'arg', name: binding.name } : null
}

const rootOf = (scope: Scope): Scope => {
	let s = scope
	while (s.parent) s = s.parent
	return s
}

const literal = (value: PortableValue): PortableExpr => ({
	kind: 'literal',
	value,
})

const memberKey = (node: AstNode): string | null => {
	const property = isNode(node.property) ? node.property : null
	if (!property) return null
	if (!node.computed) return identifierName(property)
	if (property.type !== 'Literal') return null
	return typeof property.value === 'string' ||
		(typeof property.value === 'number' && Number.isInteger(property.value))
		? String(property.value)
		: null
}

const messageCall = (
	ctx: PortableContext,
	scope: Scope,
	key: string,
	argsNode: AstNode | null,
	seen: ReadonlySet<AstNode>,
): PortableExpr | null => {
	const message = ctx.messages.get(key)
	if (!message) return null
	if (argsNode === null)
		return message.literal === null ? null : literal(message.literal)
	if (argsNode.type !== 'ObjectExpression') return null
	const args: Record<string, PortableExpr> = {}
	for (const property of asArray(argsNode.properties)) {
		if (property.type !== 'Property' || property.computed) return null
		const name = identifierName(property.key) ?? stringKey(property.key)
		const value =
			name === null ? null : convert(ctx, scope, property.value, seen)
		if (name === null || value === null) return null
		args[name] = value
	}
	return { kind: 'message', message: { pattern: message.pattern, args } }
}

const stringKey = (node: unknown): string | null =>
	isNode(node) &&
	node.type === 'Literal' &&
	(typeof node.value === 'string' || typeof node.value === 'number')
		? String(node.value)
		: null

/** The messages binding a member reads through (`t.key`), or null. */
const readsMessages = (scope: Scope, object: unknown): boolean => {
	const node = unwrap(object)
	return (
		node?.type === 'Identifier' &&
		lookup(scope, String(node.name))?.kind === 'messages'
	)
}

const fold = (expr: PortableExpr): PortableValue | typeof NOT_FOLDED =>
	expr.kind === 'literal' ? expr.value : NOT_FOLDED

const NOT_FOLDED: unique symbol = Symbol('not folded')

const convertIdentifier = (
	ctx: PortableContext,
	scope: Scope,
	name: string,
	seen: ReadonlySet<AstNode>,
): PortableExpr | null => {
	const binding = lookup(scope, name)
	if (!binding) return name === 'undefined' ? literal(undefined) : null
	switch (binding.kind) {
		case 'arg': {
			if (binding.fallback === null) return { kind: 'arg', name: binding.name }
			const fallback = convert(ctx, rootOf(scope), binding.fallback, seen)
			return fallback && { kind: 'arg', name: binding.name, fallback }
		}
		case 'item':
			return { kind: 'item', name: binding.name }
		case 'expr':
			if (seen.has(binding.node)) return null
			return convert(
				ctx,
				binding.scope,
				binding.node,
				new Set([...seen, binding.node]),
			)
		case 'value':
			return literal(binding.value)
		case 'messages':
		case 'opaque':
			return null
	}
}

const convert = (
	ctx: PortableContext,
	scope: Scope,
	raw: unknown,
	seen: ReadonlySet<AstNode>,
): PortableExpr | null => {
	const node = unwrap(raw)
	if (!node) return null
	switch (node.type) {
		case 'Literal':
			if ('regex' in node || 'bigint' in node) return null
			return literal(node.value as PortableValue)
		case 'Identifier':
			return convertIdentifier(ctx, scope, String(node.name), seen)
		case 'MemberExpression': {
			if (node.optional) return null
			const key = memberKey(node)
			if (key === null) return null
			const object = unwrap(node.object)
			if (
				object?.type === 'Identifier' &&
				object.name === 'host' &&
				!lookup(scope, 'host')
			) {
				const seed = hostSeed(ctx, scope, key)
				if (seed === null) return null
				if ('kind' in seed) return seed
				return seen.has(seed.node)
					? null
					: convert(ctx, seed.scope, seed.node, new Set([...seen, seed.node]))
			}
			if (readsMessages(scope, object))
				return messageCall(ctx, scope, key, null, seen)
			const inner = convert(ctx, scope, object, seen)
			return inner && { kind: 'member', object: inner, property: key }
		}
		case 'CallExpression': {
			if (node.optional) return null
			const callee = unwrap(node.callee)
			const args = asArray(node.arguments)
			if (callee?.type !== 'MemberExpression' || callee.optional) return null
			const key = memberKey(callee)
			if (key === null) return null
			if (readsMessages(scope, callee.object))
				return args.length === 1
					? messageCall(ctx, scope, key, unwrap(args[0]), seen)
					: null
			const object = unwrap(callee.object)
			if (key !== 'get' || args.length > 0 || object?.type !== 'Identifier')
				return null
			const name = String(object.name)
			if (lookup(scope, name)) return null
			const signal = signalNamed(ctx, name)
			const initial = signal ? signalInitial(signal) : null
			if (!initial || seen.has(initial)) return null
			return convert(ctx, rootOf(scope), initial, new Set([...seen, initial]))
		}
		case 'UnaryExpression': {
			const argument = unwrap(node.argument)
			if (node.operator === '!') {
				const operand = convert(ctx, scope, argument, seen)
				return operand && { kind: 'not', operand }
			}
			if (
				node.operator === '-' &&
				argument?.type === 'Literal' &&
				typeof argument.value === 'number'
			)
				return literal(-argument.value)
			return null
		}
		case 'BinaryExpression':
		case 'LogicalExpression': {
			const operator = String(node.operator)
			const allowed = node.type === 'BinaryExpression' ? COMPARISONS : LOGICAL
			if (!allowed.has(operator)) return null
			const left = convert(ctx, scope, node.left, seen)
			const right = left && convert(ctx, scope, node.right, seen)
			if (!left || !right) return null
			return node.type === 'BinaryExpression'
				? {
						kind: 'compare',
						operator: operator as ComparisonOperator,
						left,
						right,
					}
				: {
						kind: 'logical',
						operator: operator as LogicalOperator,
						left,
						right,
					}
		}
		case 'ConditionalExpression': {
			const test = convert(ctx, scope, node.test, seen)
			const consequent = test && convert(ctx, scope, node.consequent, seen)
			const alternate = consequent && convert(ctx, scope, node.alternate, seen)
			return test && consequent && alternate
				? { kind: 'conditional', test, consequent, alternate }
				: null
		}
		// An arg-independent array or object folds to its value at build.
		case 'ArrayExpression': {
			const values: PortableValue[] = []
			for (const element of Array.isArray(node.elements) ? node.elements : []) {
				const value = convert(ctx, scope, element, seen)
				const folded = value ? fold(value) : NOT_FOLDED
				if (folded === NOT_FOLDED) return null
				values.push(folded)
			}
			return literal(values)
		}
		case 'ObjectExpression': {
			const record: Record<string, PortableValue> = {}
			for (const property of asArray(node.properties)) {
				if (
					property.type !== 'Property' ||
					property.computed ||
					property.kind !== 'init' ||
					property.method
				)
					return null
				const name = identifierName(property.key) ?? stringKey(property.key)
				const value =
					name === null ? null : convert(ctx, scope, property.value, seen)
				const folded = value ? fold(value) : NOT_FOLDED
				if (name === null || folded === NOT_FOLDED) return null
				record[name] = folded
			}
			return literal(record)
		}
		default:
			return null
	}
}

const segmentsOf = (
	ctx: PortableContext,
	scope: Scope,
	node: AstNode,
): Segment[] | null => {
	const quasis = asArray(node.quasis)
	const expressions = Array.isArray(node.expressions) ? node.expressions : []
	const segments: Segment[] = []
	for (const [index, quasi] of quasis.entries()) {
		const cooked = (quasi.value as { cooked?: string | null } | undefined)
			?.cooked
		if (typeof cooked !== 'string') return null
		if (cooked !== '') segments.push({ kind: 'literal', text: cooked })
		if (index >= expressions.length) continue
		const value = convert(ctx, scope, expressions[index], new Set())
		if (!value) return null
		segments.push({ kind: 'hole', value })
	}
	return segments
}

/* === Exported Functions === */

export const createScope = (
	bindings: ReadonlyMap<string, Binding>,
	parent: Scope | null = null,
): Scope => ({ bindings, parent })

/** `node` in the portable subset under `scope`, or null when it leaves the subset. */
export const portableExpr = (
	ctx: PortableContext,
	scope: Scope,
	node: unknown,
): PortableExpr | null => convert(ctx, scope, node, new Set())

/** A value in a text, attribute or include-arg position: a template literal lowers to a segment list, even through a const. */
export const portableHoleValue = (
	ctx: PortableContext,
	scope: Scope,
	node: unknown,
): HoleValue | null => {
	const seen = new Set<AstNode>()
	let current = unwrap(node)
	let currentScope = scope
	while (current?.type === 'Identifier') {
		const binding = lookup(currentScope, String(current.name))
		if (binding?.kind !== 'expr' || seen.has(binding.node)) break
		seen.add(binding.node)
		current = unwrap(binding.node)
		currentScope = binding.scope
	}
	if (current?.type === 'TemplateLiteral') {
		const segments = segmentsOf(ctx, currentScope, current)
		return segments && { kind: 'segments', segments }
	}
	return portableExpr(ctx, scope, node)
}

/** Whether `node` formats through `Intl` or a `toLocale…String()` call, directly or through a const it reads. */
export const readsIntl = (scope: Scope, node: unknown): boolean => {
	const seen = new Set<AstNode>()
	const visit = (current: unknown, within: Scope): boolean => {
		if (!isNode(current)) return false
		if (current.type === 'Identifier') {
			const name = String(current.name)
			if (name === 'Intl') return true
			const binding = lookup(within, name)
			if (binding?.kind !== 'expr' || seen.has(binding.node)) return false
			seen.add(binding.node)
			return visit(binding.node, binding.scope)
		}
		if (
			current.type === 'MemberExpression' &&
			!current.computed &&
			LOCALE_FORMATTERS.has(identifierName(current.property) ?? '')
		)
			return true
		let found = false
		forEachChild(current, child => {
			if (!found && visit(child, within)) found = true
		})
		return found
	}
	return visit(node, scope)
}
