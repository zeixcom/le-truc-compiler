import {
	type AstNode,
	collectBoundNames,
	forEachChild,
	freeIdentifiers,
	isNode,
	text,
	walkNodes,
} from './ast-utils'
import { declaredRefNames, refBranchGuard } from './first-refs'
import type { AttributeIR, ComponentIR, TemplateNode } from './ir'
import { JS_GLOBALS, PARSER_FACTORIES } from './vocabulary'
import { walkTemplate } from './walk'

const IMPURE_AMBIENT_ROOTS: ReadonlySet<string> = new Set(['Date'])

const isLocaleResolvable = (
	arg: unknown,
	scope: ReadonlySet<string>,
): boolean => {
	if (!isNode(arg)) return false
	if (arg.type === 'Literal' && typeof arg.value === 'string') return true
	if (arg.type === 'Identifier') return scope.has(String(arg.name))
	return false
}

const RNG_METHODS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['Math', new Set(['random'])],
	['crypto', new Set(['randomUUID', 'getRandomValues'])],
])

/** Method names whose ambient inputs (not their receiver) make them impure. */
const IMPURE_AMBIENT_METHODS: ReadonlySet<string> = new Set([
	'toLocaleString',
	'toLocaleDateString',
	'toLocaleTimeString',
	'getTimezoneOffset',
])

export const containsImpureAmbient = (
	node: AstNode,
	scope: ReadonlySet<string> = new Set(),
): boolean => impureAmbientCauses(node, scope).length > 0

export type ImpureAmbientCause =
	| 'date'
	| 'rng'
	| 'locale-method'
	| 'intl-default-locale'
	| 'intl-dom-locale'

export const impureAmbientCauses = (
	node: AstNode,
	scope: ReadonlySet<string> = new Set(),
): ImpureAmbientCause[] => {
	const causes: ImpureAmbientCause[] = []
	let found = false
	const flag = (cause: ImpureAmbientCause) => {
		causes.push(cause)
		found = true
	}
	const visit = (current: unknown): void => {
		if (found) return
		if (Array.isArray(current)) {
			for (const child of current) visit(child)
			return
		}
		if (!isNode(current)) return
		if (current.type === 'Identifier') {
			const name = String(current.name)
			if (name === 'Intl') {
				flag('intl-default-locale')
				return
			}
			if (IMPURE_AMBIENT_ROOTS.has(name)) {
				flag('date')
				return
			}
		}
		if (
			(current.type === 'CallExpression' ||
				current.type === 'OptionalCallExpression' ||
				current.type === 'NewExpression') &&
			isNode(current.callee) &&
			current.callee.type === 'MemberExpression' &&
			!current.callee.computed
		) {
			const obj = current.callee.object
			const prop = current.callee.property
			if (
				isNode(obj) &&
				obj.type === 'Identifier' &&
				String(obj.name) === 'Date' &&
				isNode(prop) &&
				prop.type === 'Identifier' &&
				String(prop.name) === 'UTC'
			) {
				const utcArgs = Array.isArray(current.arguments)
					? current.arguments
					: []
				for (const arg of utcArgs) visit(arg)
				return
			}
			if (
				isNode(obj) &&
				obj.type === 'Identifier' &&
				isNode(prop) &&
				prop.type === 'Identifier' &&
				RNG_METHODS.get(String(obj.name))?.has(String(prop.name))
			) {
				flag('rng')
				return
			}
			if (
				isNode(prop) &&
				prop.type === 'Identifier' &&
				IMPURE_AMBIENT_METHODS.has(String(prop.name))
			) {
				flag('locale-method')
				return
			}
			if (
				isNode(obj) &&
				obj.type === 'Identifier' &&
				String(obj.name) === 'Intl'
			) {
				const args = Array.isArray(current.arguments) ? current.arguments : []
				if (!isLocaleResolvable(args[0], scope)) {
					flag(
						args[0] === undefined ? 'intl-default-locale' : 'intl-dom-locale',
					)
					return
				}
				for (const arg of args) visit(arg)
				return
			}
		}
		forEachChild(current, visit)
	}
	visit(node)
	return causes
}

export const dependenciesOf = (node: AstNode): Set<string> => {
	const free = freeIdentifiers(node)
	for (const global of JS_GLOBALS) free.delete(global)
	return free
}

export const isServerEvaluable = (
	node: AstNode,
	scope: ReadonlySet<string>,
): boolean =>
	dependenciesOf(node).isSubsetOf(scope) && !containsImpureAmbient(node, scope)

const argRenderedProps = (root: TemplateNode): string[] => {
	const out: string[] = []
	walkTemplate(
		root,
		node => {
			if (node.kind === 'expr' && node.bindsProp) out.push(node.bindsProp)
			if (node.kind === 'element')
				for (const attr of node.attrs)
					if (attr.kind === 'server' && attr.bindsProp) out.push(attr.bindsProp)
		},
		{ intoCompose: false },
	)
	return out
}

export const foldableRefGuards = (
	component: ComponentIR,
): ReadonlyMap<string, string> => {
	const guards = new Map<string, string>()
	const declared = declaredRefNames(component.firstRefs)
	for (const name of declared) {
		const guard = refBranchGuard(component.root, name)
		if (guard !== null) guards.set(name, guard)
	}
	return guards
}

const PLATFORM_CONFIG_ATTRS: ReadonlySet<string> = new Set(['lang', 'dir'])

export const foldableHostProps = (
	component: ComponentIR,
): ReadonlySet<string> => {
	const names = new Set<string>()
	for (const attr of component.root.attrs) {
		if (attr.kind !== 'server') continue
		const parser = component.exposeProps.get(attr.name)?.parser
		if (parser) {
			if (seedResolvable(component, parser.fallbackNode)) names.add(attr.name)
		} else if (PLATFORM_CONFIG_ATTRS.has(attr.name)) names.add(attr.name)
	}
	for (const [prop, decl] of component.exposeProps) {
		if (decl.parser || !decl.initNode) continue
		if (seedResolvable(component, decl.initNode)) names.add(prop)
	}
	for (const prop of argRenderedProps(component.root))
		if (!component.exposeProps.get(prop)?.parser) names.add(prop)
	return names
}

const seedResolvable = (
	component: ComponentIR,
	node: AstNode | null,
): boolean => {
	if (node === null) return true
	const allowed = new Set<string>([
		...foldableRenderScope(component),
		...PARSER_FACTORIES,
		...component.imports.serverLocalNames,
	])
	return dependenciesOf(node).isSubsetOf(allowed)
}

export const hostSeedExpr = (
	component: ComponentIR,
	prop: string,
): string | null => {
	const decl = component.exposeProps.get(prop)
	if (decl?.parser) {
		const rootAttr = findRootAttr(component, prop)
		if (!rootAttr) return null
		return `${decl.parser.parser}(${decl.parser.fallbackText ?? ''})(attrValue(${rootAttr.exprText}))`
	}
	if (decl?.initNode && seedResolvable(component, decl.initNode))
		return text(component.source, decl.initNode)
	const rootAttr = findRootAttr(component, prop)
	if (rootAttr) return rootAttr.exprText
	return component.paramNames.includes(prop) ? prop : null
}

/** The root's server attribute named `prop`, if it renders one. */
const findRootAttr = (
	component: ComponentIR,
	prop: string,
): Extract<AttributeIR, { kind: 'server' }> | undefined =>
	component.root.attrs.find(
		(a): a is Extract<AttributeIR, { kind: 'server' }> =>
			a.kind === 'server' && a.name === prop,
	)

export type HostPropRead = {
	start: number
	end: number
	prop: string
	kind: 'prop' | 'ref'
}

export const hostDerivedFold = (
	node: AstNode,
	foldable: ReadonlySet<string>,
	foldableRefs: ReadonlyMap<string, string> = new Map(),
	allow?: ReadonlySet<string>,
): readonly HostPropRead[] | null => {
	if (containsImpureAmbient(node, allow ?? new Set())) return null
	const reads: HostPropRead[] = []
	let escaped = false
	const visit = (current: unknown, bound: ReadonlySet<string>): void => {
		if (escaped || Array.isArray(current)) {
			if (Array.isArray(current)) for (const c of current) visit(c, bound)
			return
		}
		if (!isNode(current)) return
		switch (current.type) {
			case 'Identifier': {
				const name = String(current.name)
				if (bound.has(name)) return
				if (name === 'host') {
					escaped = true
					return
				}
				if (foldableRefs.has(name))
					reads.push({
						start: typeof current.start === 'number' ? current.start : 0,
						end: typeof current.end === 'number' ? current.end : 0,
						prop: name,
						kind: 'ref',
					})
				return
			}
			case 'MemberExpression': {
				const obj = current.object
				if (
					!current.computed &&
					isNode(obj) &&
					obj.type === 'Identifier' &&
					String(obj.name) === 'host' &&
					!bound.has('host')
				) {
					const prop = current.property
					const name =
						isNode(prop) && prop.type === 'Identifier'
							? String(prop.name)
							: null
					if (name === null || !foldable.has(name)) {
						escaped = true
						return
					}
					reads.push({
						start: typeof current.start === 'number' ? current.start : 0,
						end: typeof current.end === 'number' ? current.end : 0,
						prop: name,
						kind: 'prop',
					})
					return
				}
				if (
					isNode(obj) &&
					obj.type === 'Identifier' &&
					!bound.has(String(obj.name)) &&
					foldableRefs.has(String(obj.name))
				) {
					escaped = true
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
				const inner = new Set(bound)
				for (const param of Array.isArray(current.params) ? current.params : [])
					if (isNode(param) && param.type === 'Identifier')
						inner.add(String(param.name))
				visit(current.body, inner)
				return
			}
			default:
				forEachChild(current, child => visit(child, bound))
		}
	}
	visit(node, new Set())
	if (escaped) return null
	const others = dependenciesOf(node)
	others.delete('host')
	for (const ref of foldableRefs.keys()) others.delete(ref)
	if (allow) for (const name of allow) others.delete(name)
	if (others.size > 0) return null
	return reads
}

export const foldableRenderScope = (
	component: ComponentIR,
): ReadonlySet<string> => {
	/** Plain setup consts, by declared name (signals excluded). */
	const constInits = new Map<string, AstNode>()
	for (const stmt of component.setup) {
		if (stmt.name === null) continue
		if (component.signals.some(signal => signal.name === stmt.name)) continue
		constInits.set(stmt.name, stmt.node)
	}
	const scope = new Set<string>(
		[...component.serverKnown].filter(name => !constInits.has(name)),
	)
	const boundWithin = (node: unknown, into: Set<string>): void =>
		walkNodes(node, current => {
			if (
				current.type === 'ArrowFunctionExpression' ||
				current.type === 'FunctionExpression' ||
				current.type === 'FunctionDeclaration'
			) {
				for (const param of Array.isArray(current.params) ? current.params : [])
					collectBoundNames(param, into)
			}
			if (current.type === 'CatchClause' && isNode(current.param))
				collectBoundNames(current.param, into)
		})
	let changed = true
	while (changed) {
		changed = false
		for (const [name, init] of constInits) {
			if (scope.has(name)) continue
			const params = new Set<string>()
			boundWithin(init, params)
			const checkScope = new Set([...component.serverKnown, ...params])
			if (impureAmbientCauses(init, checkScope).length > 0) continue
			let callsRejected = false
			for (const free of dependenciesOf(init))
				if (constInits.has(free) && !scope.has(free)) callsRejected = true
			if (callsRejected) continue
			scope.add(name)
			changed = true
		}
	}
	return scope
}

export const spliceHostDerivedFold = (
	thunkText: string,
	thunkStart: number,
	reads: readonly HostPropRead[],
	exprTextOf: (prop: string, kind: 'prop' | 'ref') => string,
): string => {
	let out = ''
	let cursor = 0
	for (const r of [...reads].sort((a, b) => a.start - b.start)) {
		out += thunkText.slice(cursor, r.start - thunkStart)
		out += `(${exprTextOf(r.prop, r.kind)})`
		cursor = r.end - thunkStart
	}
	out += thunkText.slice(cursor)
	return out
}

export const initializerHostReads = (
	node: AstNode,
	foldable: ReadonlySet<string>,
): readonly HostPropRead[] | null => {
	const others = dependenciesOf(node)
	if (!others.has('host') && !others.has('internals')) return []
	others.delete('host')
	others.delete('internals')
	return hostDerivedFold(node, foldable, new Map(), others)
}
