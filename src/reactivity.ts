import {
	type AstNode,
	forEachChild,
	forEachFreeIdentifier,
	identifierName,
	isNode,
	nodeType,
	walkNodes,
} from './ast-utils'
import type { AttributeIR, DependencyClosure, ReactivityClass } from './ir'

/** The client-only ambient whose property reads are reactive by definition — `host.<prop>` resolves against the component's own exposed props, so a lexical `host.x` is a signal read in every position. */
const REACTIVE_AMBIENT = 'host'

/** A name lookup satisfied by both `Set<string>` and `Map<string, …>` — no set allocated per child just to ask `.has()`. */
type NameSet = { has(name: string): boolean }

/** Verdict for one template-child expression. */
export type LiftVerdict =
	/** No reactive read anywhere — server-render it once, emit no watch. */
	| { kind: 'server' }
	/** A lexically visible reactive read — lift it into a `watch()`. */
	| { kind: 'reactive' }
	| { kind: 'opaque'; names: string[] }

export const bindsExposedArg = (
	expr: AstNode,
	args: NameSet,
	exposedProps: NameSet,
	signals: NameSet,
	parserProps: NameSet,
): string | null => {
	if (nodeType(expr) !== 'Identifier') return null
	const name = String(expr.name)
	return args.has(name) &&
		exposedProps.has(name) &&
		!signals.has(name) &&
		!parserProps.has(name)
		? name
		: null
}

export const classifyChild = (expr: AstNode, signals: NameSet): LiftVerdict => {
	// An authored thunk is the explicit override: always reactive, never inspected — nothing inside it can be "missed", so nothing inside it can be an error.
	if (nodeType(expr) === 'ArrowFunctionExpression') return { kind: 'reactive' }

	// A bare signal identifier is the identifier-source `watch()` overload (`watch(count, …)`) — a read, not an escape.
	if (nodeType(expr) === 'Identifier' && signals.has(String(expr.name)))
		return { kind: 'reactive' }

	let reads = 0
	const escapes = new Set<string>()

	const visit = (current: unknown, bound: ReadonlySet<string>): void => {
		if (Array.isArray(current)) {
			for (const child of current) visit(child, bound)
			return
		}
		if (!isNode(current)) return
		switch (current.type) {
			case 'Identifier': {
				const name = String(current.name)
				// Reached as a value, not as the object of a member read (consumed below): the signal itself crosses into whatever expression encloses it.
				if (
					!bound.has(name) &&
					(signals.has(name) || name === REACTIVE_AMBIENT)
				)
					escapes.add(name)
				return
			}
			case 'MemberExpression': {
				const obj = current.object
				const objName =
					isNode(obj) && obj.type === 'Identifier' ? String(obj.name) : null
				// `sig.get()`, `sig.get`, `host.validationMessage` — the read forms; the object is consumed here, so it never reaches the Identifier case and never counts as an escape.
				if (
					objName !== null &&
					!bound.has(objName) &&
					(signals.has(objName) || objName === REACTIVE_AMBIENT)
				) {
					reads++
					if (current.computed) visit(current.property, bound)
					return
				}
				visit(obj, bound)
				if (current.computed) visit(current.property, bound)
				return
			}
			case 'Property':
				if (current.computed) visit(current.key, bound)
				visit(current.value, bound)
				return
			case 'ArrowFunctionExpression':
			case 'FunctionExpression': {
				// A nested thunk's body is still lexically visible here, so its reads count — `{items.filter(i => i.id === sel.get())}` lifts.
				const inner = new Set(bound)
				for (const param of Array.isArray(current.params) ? current.params : [])
					if (isNode(param) && param.type === 'Identifier')
						inner.add(String(param.name))
				visit(current.body, inner)
				return
			}
			default:
				// Type positions are skipped: types are erased, so a signal named in one (`x as typeof count`) neither reads nor escapes.
				forEachChild(current, child => visit(child, bound))
				return
		}
	}

	visit(expr, new Set<string>())

	if (escapes.size > 0) return { kind: 'opaque', names: [...escapes].sort() }
	return reads > 0 ? { kind: 'reactive' } : { kind: 'server' }
}

/** The empty closure — an expression that reads nothing tracked. */
export const NO_DEPS: DependencyClosure = {
	signals: [],
	hostProps: [],
	args: [],
	bound: [],
}

const sorted = (names: Iterable<string>): string[] => [...new Set(names)].sort()

export const dependencyClosure = (
	expr: AstNode,
	signals: NameSet,
	args: NameSet,
	hostProp?: string,
): DependencyClosure => {
	// `host.<prop>`: the member a free `host` identifier is the object of.
	const hostMembers = new Map<AstNode, string>()
	walkNodes(expr, current => {
		if (current.type !== 'MemberExpression' || current.computed) return
		const prop = identifierName(current.property)
		if (
			prop !== null &&
			isNode(current.object) &&
			identifierName(current.object) === REACTIVE_AMBIENT
		)
			hostMembers.set(current.object, prop)
	})
	const signalNames: string[] = []
	const argNames: string[] = []
	const hostProps: string[] = hostProp === undefined ? [] : [hostProp]
	forEachFreeIdentifier(expr, identifier => {
		const name = String(identifier.name)
		if (signals.has(name)) signalNames.push(name)
		if (args.has(name)) argNames.push(name)
		const member = hostMembers.get(identifier)
		if (member !== undefined) hostProps.push(member)
	})
	return {
		signals: sorted(signalNames),
		hostProps: sorted(hostProps),
		args: sorted(argNames),
		bound: [],
	}
}

/** `deps` with `names` added as positionally reactive (`bound`). */
export const withBound = (
	deps: DependencyClosure,
	names: Iterable<string>,
): DependencyClosure => ({ ...deps, bound: sorted([...deps.bound, ...names]) })

export const attributeReactivity = (
	attr: AttributeIR,
): ReactivityClass | null => {
	switch (attr.kind) {
		case 'static':
		case 'reactive':
			return attr.kind
		// A handler-arg placement renders nothing and binds nothing in the component itself — the composing parent addresses it.
		case 'handler-arg':
			return 'static'
		case 'server':
			return attr.bindsProp != null ? 'reactive' : 'server'
		case 'class-map':
		case 'style-map':
			return 'reactive'
		case 'html':
			return attr.reactive ? 'reactive' : 'server'
		default:
			return null
	}
}
