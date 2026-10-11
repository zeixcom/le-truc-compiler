import {
	type AstNode,
	forEachChild,
	hostPropOf,
	isNode,
	nodeType,
	sanitizeVarName,
	signalGetCallName,
	walkNodes,
} from '../ast-utils'
import { diagnostic } from '../diagnostics'
import { dependenciesOf } from '../evaluability'
import type {
	AttributeIR,
	ComponentIR,
	HarvestSeedIR,
	InitSignalIR,
	TemplateNode,
} from '../ir'
import { harvestsPerField } from '../key-alias'
import { wordingOf } from '../surface'
import { rangeFields, resolutionOf } from '../tier'
import {
	CONTEXT_NAMES,
	FACTORY_CONTEXT_MEMBERS,
	JS_GLOBALS,
	SCALAR_HARVEST_CONSTRUCTORS,
} from '../vocabulary'
import { elseOf, isIf, thenOf, walkTemplate } from '../walk'
import {
	CALLABLE_AS_WRITTEN,
	planKeyAliasHarvest,
	planListFieldHarvest,
} from './list-harvest'
import type {
	AuthoredParser,
	HarvestPlan,
	HarvestPlans,
	LoopPlans,
	ParserKind,
	PassShared,
} from './plan'
import {
	type ElementNode,
	type ExprNode,
	isElement,
	refOf,
	selectorAdaptersOf,
} from './selectors'
import { reportServerOnlyNames } from './server-only-names'

/* === Shared signal-read predicates === */

/** `sig.get()` call check for direct/membership matching. */
export const isSignalGetCall = (node: unknown, signal: string): boolean =>
	signalGetCallName(node) === signal

export const containsSignalGet = (node: unknown, signal: string): boolean => {
	// Type positions are skipped: they hold no `.get()` calls.
	let found = false
	walkNodes(node, current => {
		if (found) return false
		if (isSignalGetCall(current, signal)) found = true
	})
	return found
}

export const membershipConst = (
	thunk: AstNode,
	signal: string,
): string | null => {
	const body = thunk.body
	if (
		nodeType(body) !== 'BinaryExpression' &&
		nodeType(body) !== 'CallExpression'
	)
		return null
	let comparison = body as AstNode
	if (nodeType(body) === 'CallExpression') {
		const call = body as AstNode
		const callee = call.callee
		if (
			nodeType(callee) !== 'Identifier' ||
			String((callee as AstNode).name) !== 'String' ||
			!Array.isArray(call.arguments)
		)
			return null
		comparison = call.arguments[0] as AstNode
	}
	if (nodeType(comparison) !== 'BinaryExpression') return null
	const bin = comparison as Record<string, unknown>
	if (bin.operator !== '===') return null
	const left = bin.left as AstNode
	const right = bin.right as AstNode
	for (const [a, b] of [
		[left, right],
		[right, left],
	] as const) {
		if (isSignalGetCall(a, signal) && nodeType(b) === 'Identifier')
			return String((b as AstNode).name)
	}
	return null
}

/** `() => sig.get()` (direct attribute render of a signal). */
export const isDirectAttrThunk = (thunk: AstNode, signal: string): boolean =>
	isSignalGetCall(thunk.body, signal)

export const parserForType = (type: string): ParserKind => {
	switch (type) {
		case 'number':
			return 'asNumber'
		case 'boolean':
			return 'asBoolean'
		default:
			return 'asString'
	}
}

export const defaultForType = (type: string): string => {
	switch (type) {
		case 'number':
			return '0'
		case 'boolean':
			return 'false'
		default:
			return "''"
	}
}

export const lazyWatchSource = (child: ExprNode): string => {
	const expr = child.expr
	if (child.bindsProp) return `() => host.${child.bindsProp}`
	if (nodeType(expr) === 'Identifier') return child.exprText
	if (nodeType(expr) === 'ArrowFunctionExpression') return child.exprText
	return `() => ${child.exprText}`
}

/* === Formatted text === */

/** Locale-formatting instance methods: their output never parses back. */
const LOCALE_FORMAT_METHODS: ReadonlySet<string> = new Set([
	'toLocaleString',
	'toLocaleDateString',
	'toLocaleTimeString',
])

/** Message argument kinds the evaluator formats (`{n, number}`, `#`, `{d, date}`). */
const FORMATTED_ARG_KINDS: ReadonlySet<string> = new Set(['number', 'date'])

export const formattingOf = (
	node: AstNode,
	component: ComponentIR,
): string | null => {
	const tNames = new Set(component.messageTBindings ?? [])
	const args = component.i18nArgs ?? {}
	const setupByName = new Map(
		component.setup.flatMap(stmt =>
			stmt.name === null ? [] : [[stmt.name, stmt.node] as const],
		),
	)
	const messageKey = (callee: unknown): string | null => {
		if (nodeType(callee) !== 'MemberExpression') return null
		const member = callee as AstNode
		const object = member.object as AstNode
		if (nodeType(object) !== 'Identifier' || !tNames.has(String(object.name)))
			return null
		const property = member.property as AstNode
		if (!member.computed && nodeType(property) === 'Identifier')
			return String(property.name)
		if (
			member.computed &&
			nodeType(property) === 'Literal' &&
			typeof property.value === 'string'
		)
			return property.value
		return null
	}
	const visited = new Set<string>()
	const inspect = (root: AstNode): string | null => {
		let found: string | null = null
		walkNodes(root, current => {
			if (found) return false
			const type = nodeType(current)
			if (type === 'Identifier' && String(current.name) === 'Intl') {
				found = '`Intl`'
				return false
			}
			if (type !== 'CallExpression' && type !== 'OptionalCallExpression') return
			const callee = current.callee as AstNode
			if (
				nodeType(callee) === 'MemberExpression' &&
				!callee.computed &&
				nodeType(callee.property) === 'Identifier' &&
				LOCALE_FORMAT_METHODS.has(String((callee.property as AstNode).name))
			) {
				found = `\`${String((callee.property as AstNode).name)}()\``
				return false
			}
			const key = messageKey(callee)
			if (
				key !== null &&
				(args[key] ?? []).some(arg => FORMATTED_ARG_KINDS.has(arg.kind))
			) {
				found = `message \`${String((callee.object as AstNode).name)}.${key}\``
				return false
			}
		})
		if (found) return found
		for (const name of dependenciesOf(root)) {
			const stmt = setupByName.get(name)
			if (!stmt || visited.has(name)) continue
			visited.add(name)
			const inner = inspect(stmt)
			if (inner) return inner
		}
		return null
	}
	return inspect(node)
}

/* === Render Sites (Pass 2) === */

type Site =
	| {
			kind: 'text' | 'attr'
			signal: string
			element: ElementNode
			attr?: string
			order: number
	  }
	| {
			kind: 'membership'
			signal: string
			element: ElementNode
			attr: string
			constName: string
			order: number
	  }

type RenderSites = {
	sites: Site[]
	thunkRendered: Set<string>
	renderCredited: Set<string>
	clientCredited: Set<string>
	formattedText: Map<string, { node: AstNode; formatting: string }>
}

/** Pass 2: signal render sites, in document order, plus thunk/client credit. */
const collectRenderSites = (component: ComponentIR): RenderSites => {
	const sites: Site[] = []
	const thunkRendered = new Set<string>()
	const textChildren: ExprNode[] = []
	let documentOrder = 0
	const { loopFor } = selectorAdaptersOf(component)

	const recordSites = (node: TemplateNode, insideLoopOutput: boolean): void => {
		if (!isElement(node)) return
		const isLoopOutput = !!loopFor(node)
		for (const attr of node.attrs) {
			if (
				attr.kind !== 'reactive' &&
				attr.kind !== 'style-map' &&
				attr.kind !== 'class-map' &&
				!(attr.kind === 'html' && attr.reactive)
			)
				continue
			const order = documentOrder++
			if (attr.kind === 'style-map' || attr.kind === 'class-map') {
				for (const signal of component.signals.map(s => s.name)) {
					if (containsSignalGet(attr.object, signal)) thunkRendered.add(signal)
				}
				continue
			}
			if (attr.kind === 'html' && attr.reactive) {
				for (const signal of component.signals.map(s => s.name)) {
					if (containsSignalGet(attr.thunk, signal)) thunkRendered.add(signal)
				}
				continue
			}
			for (const signal of component.signals.map(s => s.name)) {
				if (isDirectAttrThunk(attr.thunk, signal)) {
					sites.push({
						kind: 'attr',
						signal,
						element: node,
						attr: attr.name,
						order,
					})
					break
				}
				const constName = membershipConst(attr.thunk, signal)
				if (constName && isLoopOutput) {
					sites.push({
						kind: 'membership',
						signal,
						element: node,
						attr: attr.name,
						constName,
						order,
					})
					break
				}
				if (containsSignalGet(attr.thunk, signal)) thunkRendered.add(signal)
			}
		}
		for (const child of node.children) {
			if (
				child.kind === 'expr' &&
				child.reactivity === 'reactive' &&
				!insideLoopOutput &&
				!isLoopOutput
			) {
				textChildren.push(child)
				const order = documentOrder++
				const expr = child.expr
				if (nodeType(expr) === 'Identifier') {
					const name = String((expr as AstNode).name)
					if (component.signals.some(s => s.name === name))
						sites.push({ kind: 'text', signal: name, element: node, order })
				} else if (
					nodeType(expr) === 'Literal' &&
					typeof (expr as AstNode).value === 'string'
				) {
					const signal = component.exposeProps.get(
						String((expr as AstNode).value),
					)?.signalName
					if (signal) sites.push({ kind: 'text', signal, element: node, order })
				} else if (nodeType(expr) === 'ArrowFunctionExpression') {
					const body = (expr as AstNode).body
					for (const signal of component.signals.map(s => s.name)) {
						if (isSignalGetCall(body, signal)) {
							sites.push({ kind: 'text', signal, element: node, order })
							break
						}
					}
				}
			}
			recordSites(child, insideLoopOutput || isLoopOutput)
		}
	}
	recordSites(component.root, false)

	const creditSignalReads = (node: AstNode): void => {
		for (const signal of component.signals)
			if (
				containsSignalGet(node, signal.name) ||
				(nodeType(node) === 'Identifier' &&
					String((node as AstNode).name) === signal.name)
			)
				thunkRendered.add(signal.name)
	}
	walkTemplate(component.root, node => {
		if (node.kind !== 'conditional' || node.mode !== 'reactive') return
		creditSignalReads(node.test)
		for (const arm of node.arms)
			for (const child of arm.children)
				walkTemplate(child, inner => {
					if (inner.kind === 'expr' && inner.reactivity === 'reactive')
						creditSignalReads(inner.expr)
					if (inner.kind !== 'element') return
					for (const attr of inner.attrs) {
						if (
							attr.kind === 'reactive' ||
							attr.kind === 'class-map' ||
							attr.kind === 'style-map'
						)
							creditSignalReads(attr.thunk)
						else if (attr.kind === 'html' && attr.reactive)
							creditSignalReads(attr.thunk)
					}
				})
	})

	const carriers = new Map<string, Set<string>>(
		component.signals.map(signal => [signal.name, new Set([signal.name])]),
	)
	const carriedBy = (node: AstNode): Set<string> => {
		const carried = new Set<string>()
		for (const name of dependenciesOf(node))
			for (const signal of carriers.get(name) ?? []) carried.add(signal)
		return carried
	}
	for (let changed = true; changed; ) {
		changed = false
		for (const stmt of component.setup) {
			if (stmt.name === null) continue
			const own = carriers.get(stmt.name) ?? new Set<string>()
			const before = own.size
			for (const signal of carriedBy(stmt.node)) own.add(signal)
			carriers.set(stmt.name, own)
			if (own.size !== before) changed = true
		}
	}
	const renderCredited = new Set(thunkRendered)
	const creditRender = (node: AstNode | null | undefined): void => {
		if (node) for (const signal of carriedBy(node)) renderCredited.add(signal)
	}
	walkTemplate(component.root, node => {
		if (node.kind === 'element') {
			for (const attr of node.attrs) {
				if (
					attr.kind === 'reactive' ||
					attr.kind === 'class-map' ||
					attr.kind === 'style-map'
				)
					creditRender(attr.thunk)
				else if (attr.kind === 'html') {
					creditRender(attr.node)
					if (attr.reactive) creditRender(attr.thunk)
				} else if (attr.kind === 'server') creditRender(attr.node)
			}
		} else if (node.kind === 'expr') creditRender(node.expr)
		else if (node.kind === 'conditional') {
			creditRender(node.test)
			// `@case` tests are render positions too.
			for (const arm of node.arms) if (arm.test) creditRender(arm.test)
		} else if (node.kind === 'compose') {
			for (const attr of node.attrs)
				if (attr.kind === 'arg') creditRender(attr.node)
		}
	})
	for (const loop of component.fors.values()) {
		if (loop.kind !== 'each') continue
		creditRender(loop.iterable)
		for (const hoisted of loop.hoisted) creditRender(hoisted.node)
	}
	const clientCredited = new Set<string>()
	const creditClientRead = (node: AstNode): void => {
		for (const signal of carriedBy(node)) {
			thunkRendered.add(signal)
			clientCredited.add(signal)
		}
	}
	for (const stmt of component.clientSetup) creditClientRead(stmt.node)
	walkTemplate(component.root, node => {
		if (node.kind === 'element') {
			for (const attr of node.attrs)
				if (attr.kind === 'event') creditClientRead(attr.handler)
		} else if (node.kind === 'compose') {
			for (const attr of node.attrs) {
				if (attr.kind !== 'pass') continue
				for (const entry of attr.entries) {
					creditClientRead(entry.thunk)
					if (entry.setThunk) creditClientRead(entry.setThunk)
				}
			}
		}
	})

	const formattedText = new Map<string, { node: AstNode; formatting: string }>()
	for (const child of textChildren) {
		const carried = [...carriedBy(child.expr)].filter(
			signal => !formattedText.has(signal),
		)
		if (carried.length === 0) continue
		const formatting = formattingOf(child.expr, component)
		if (!formatting) continue
		for (const signal of carried)
			formattedText.set(signal, { node: child.expr, formatting })
	}

	return {
		sites,
		thunkRendered,
		renderCredited,
		clientCredited,
		formattedText,
	}
}

/* === Harvest Plans (Pass 3) === */

const reportUnharvestable = (
	shared: PassShared,
	signal: InitSignalIR,
	unportable: readonly string[] = [],
): void => {
	const { component, routingSignals, source } = shared
	routingSignals.push({
		origin: 'LTC004',
		detail:
			unportable.length > 0
				? `signal \`${signal.name}\` is rendered, but its initializer reads ${unportable.map(n => `\`${n}\``).join(', ')}, so the client cannot reuse it to seed the signal`
				: `signal \`${signal.name}\` has no harvestable initial-DOM site`,
		...rangeFields(source, signal.init),
		resolution:
			signal.init == null
				? { by: 'realm' }
				: resolutionOf(signal.init, component.serverKnown),
	})
}

const asParamType = (
	shared: PassShared,
	param: string,
	read: string,
): string =>
	shared.component.paramProps.find(p => p.name === param)?.isNumber
		? `Number${read}`
		: read

const argSiteChildrenOf = (node: TemplateNode): TemplateNode[] =>
	isIf(node) && node.mode === 'server'
		? [...thenOf(node), ...elseOf(node)]
		: isElement(node)
			? node.children
			: []

const findMirror = (
	component: ComponentIR,
	param: string,
	node: TemplateNode,
): {
	el: ElementNode
	attr: Extract<AttributeIR, { kind: 'reactive' }>
} | null => {
	if (isElement(node)) {
		for (const attr of node.attrs) {
			if (attr.kind !== 'reactive') continue
			const prop = hostPropOf(attr.thunk)
			if (!prop || !component.exposeProps.get(prop)?.parser) continue
			const rootAttr = component.root.attrs.find(
				a => a.kind === 'server' && a.name === prop,
			) as Extract<AttributeIR, { kind: 'server' }> | undefined
			if (rootAttr && rootAttr.exprText === param) return { el: node, attr }
		}
	}
	for (const child of argSiteChildrenOf(node)) {
		const found = findMirror(component, param, child)
		if (found) return found
	}
	return null
}

/** The first element attribute rendering `param` bare (`paramDomRead`'s precedence 3). */
const findAttrSite = (
	param: string,
	node: TemplateNode,
): {
	el: ElementNode
	attr: Extract<AttributeIR, { kind: 'server' }>
} | null => {
	if (isElement(node)) {
		for (const attr of node.attrs) {
			if (attr.kind === 'server' && attr.exprText === param)
				return { el: node, attr }
		}
	}
	for (const child of argSiteChildrenOf(node)) {
		const found = findAttrSite(param, child)
		if (found) return found
	}
	return null
}

const paramDomRead = (
	shared: PassShared,
	param: string,
	allowTrackedRead: boolean,
): string | null => {
	const { addQuery, ambient, component, diagnostics, source } = shared
	const { enclosingIfOf, selectorFor } = selectorAdaptersOf(component)
	if (allowTrackedRead) {
		const exposedRootAttr = component.root.attrs.find(
			a =>
				a.kind === 'server' &&
				a.name !== null &&
				a.exprText === param &&
				component.exposeProps.get(a.name)?.parser !== undefined,
		) as Extract<AttributeIR, { kind: 'server' }> | undefined
		if (exposedRootAttr) {
			ambient.add('host')
			return `host.${exposedRootAttr.name}`
		}
	}
	const mirror = findMirror(component, param, component.root)
	if (mirror) {
		const resolved = selectorFor(mirror.el)
		if (!resolved.unique) {
			diagnostics.push(
				diagnostic.unaddressableElement(
					source,
					mirror.el.node,
					`No unique selector for the DOM site of server arg \`${param}\` (<${mirror.el.tag}>) — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
				),
			)
			return null
		}
		const refAttr = refOf(mirror.el)
		const query = addQuery(
			refAttr?.name ?? sanitizeVarName(mirror.el.tag),
			resolved.selector,
			'one',
		)
		return `${query}.${mirror.attr.name}`
	}
	const site = findAttrSite(param, component.root)
	if (site && site.el !== component.root) {
		const resolved = selectorFor(site.el)
		if (!resolved.unique) {
			diagnostics.push(
				diagnostic.unaddressableElement(
					source,
					site.el.node,
					`No unique selector for the DOM site of server arg \`${param}\` (<${site.el.tag}>) — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
				),
			)
			return null
		}
		const refAttr = refOf(site.el)
		const enclosing = enclosingIfOf(site.el)
		const optional = !!enclosing && elseOf(enclosing).length === 0
		const query = addQuery(
			refAttr?.name ?? sanitizeVarName(site.el.tag),
			resolved.selector,
			optional ? 'maybe' : 'one',
		)
		return asParamType(
			shared,
			param,
			optional
				? `(${query}?.getAttribute('${site.attr.name}') ?? '')`
				: `(${query}.getAttribute('${site.attr.name}') ?? '')`,
		)
	}
	const rootAttr = component.root.attrs.find(
		a => a.kind === 'server' && a.name !== null && a.exprText === param,
	) as Extract<AttributeIR, { kind: 'server' }> | undefined
	if (rootAttr) {
		ambient.add('host')
		return asParamType(
			shared,
			param,
			`(host.getAttribute('${rootAttr.name}') ?? '')`,
		)
	}
	return null
}

type UnportableNamesScope = {
	plainConsts: ReadonlyMap<string, AstNode>
	signalNames: ReadonlySet<string>
	allowContextMembers: boolean
}

const visitUnportableName = (
	shared: PassShared,
	node: AstNode,
	topLevel: boolean,
	scope: UnportableNamesScope,
	bad: Set<string>,
	seen: Set<string>,
): void => {
	for (const name of dependenciesOf(node)) {
		const constNode = scope.plainConsts.get(name)
		if (constNode) {
			if (!seen.has(name)) {
				seen.add(name)
				visitUnportableName(shared, constNode, false, scope, bad, seen)
			}
		} else if (
			!JS_GLOBALS.has(name) &&
			!(topLevel && shared.component.paramNames.includes(name)) &&
			!scope.signalNames.has(name) &&
			!CONTEXT_NAMES.has(name) &&
			!(scope.allowContextMembers && FACTORY_CONTEXT_MEMBERS.has(name)) &&
			!shared.refNames.has(name) &&
			!shared.component.imports.plainLocalNames.has(name) &&
			!shared.component.imports.clientLeTrucNames.has(name)
		)
			bad.add(name)
	}
}

const unportableNames = (
	shared: PassShared,
	init: AstNode,
	allowContextMembers: boolean,
): string[] => {
	const { component } = shared
	const bad = new Set<string>()
	const seen = new Set<string>()
	const scope: UnportableNamesScope = {
		plainConsts: new Map(
			component.plainSetup.flatMap(stmt =>
				stmt.name === null ? [] : [[stmt.name, stmt.node] as const],
			),
		),
		signalNames: new Set(component.signals.map(s => s.name)),
		allowContextMembers,
	}
	visitUnportableName(shared, init, true, scope, bad, seen)
	return [...bad]
}

const collectArgReadRanges = (
	current: AstNode,
	reads: ReadonlyMap<string, string>,
	ranges: Array<[number, number, string]>,
): void => {
	if (current.type === 'Identifier') {
		const name = String(current.name)
		if (
			reads.has(name) &&
			typeof current.start === 'number' &&
			typeof current.end === 'number'
		)
			ranges.push([current.start, current.end, reads.get(name) as string])
		return
	}
	if (current.type === 'MemberExpression' && !current.computed) {
		if (isNode(current.object))
			collectArgReadRanges(current.object, reads, ranges)
		return
	}
	if (current.type === 'Property' && !current.computed) {
		if (isNode(current.value))
			collectArgReadRanges(current.value, reads, ranges)
		return
	}
	forEachChild(current, child => collectArgReadRanges(child, reads, ranges))
}

const substituteArgExpr = (
	shared: PassShared,
	init: AstNode,
	allowVerbatim: boolean,
	allowTrackedRead: boolean,
	allowContextMembers = false,
): string | null => {
	const { component, source } = shared
	const free = dependenciesOf(init)
	if (unportableNames(shared, init, allowContextMembers).length > 0) return null
	const params = [...free].filter(n => component.paramNames.includes(n))
	if (typeof init.start !== 'number' || typeof init.end !== 'number')
		return null
	if (params.length === 0)
		return allowVerbatim ? source.slice(init.start, init.end) : null
	const reads = new Map<string, string>()
	for (const param of params) {
		const read = paramDomRead(shared, param, allowTrackedRead)
		if (!read) return null
		reads.set(param, read)
	}
	const ranges: Array<[number, number, string]> = []
	collectArgReadRanges(init, reads, ranges)
	let expr = source.slice(init.start, init.end)
	for (const [start, end, read] of ranges.sort((a, b) => b[0] - a[0]))
		expr =
			expr.slice(0, start - (init.start as number)) +
			read +
			expr.slice(end - (init.start as number))
	return expr
}

/** The authored parser plan for a consumed marker. */
const authoredParserOf = (
	shared: PassShared,
	signal: InitSignalIR,
	marker: Extract<HarvestSeedIR, { kind: 'scalar' }>,
): AuthoredParser => {
	reportServerOnlyNames(
		shared,
		marker.parser,
		`The \`harvest()\` parser of signal \`${signal.name}\``,
	)
	return {
		kind: 'authored',
		text: marker.parserText,
		start: marker.parser.start as number,
		wrap: !CALLABLE_AS_WRITTEN.has(String(marker.parser.type)),
	}
}

const parserForSeed = (
	shared: PassShared,
	signal: InitSignalIR,
	scalarSeeded: boolean,
	scalarMarker: Extract<HarvestSeedIR, { kind: 'scalar' }> | null,
): ParserKind | AuthoredParser | null => {
	const { component, diagnostics, rawSourceRefused, source } = shared
	if (!scalarSeeded) return parserForType(signal.inferredType)
	if (scalarMarker) return authoredParserOf(shared, signal, scalarMarker)
	if (signal.inferredType === 'unknown') {
		const seedName =
			signal.init && nodeType(signal.init) === 'Identifier'
				? String((signal.init as AstNode).name)
				: null
		const param = seedName
			? component.paramProps.find(p => p.name === seedName)
			: undefined
		diagnostics.push(
			diagnostic.scalarSeedWithoutParser(
				source,
				signal.init,
				signal.name,
				signal.constructor,
				signal.init
					? source.slice(signal.init.start, signal.init.end)
					: signal.name,
				param && param.typeText !== 'unknown' ? param.typeText : null,
			),
		)
		rawSourceRefused.add(signal.name)
		return null
	}
	return parserForType(signal.inferredType)
}

const refuseDeadMarker = (
	shared: PassShared,
	signal: InitSignalIR,
	at: AstNode,
): void => {
	const { diagnostics, rawSourceRefused, source } = shared
	diagnostics.push(
		diagnostic.unsupported(
			source,
			at,
			`The \`harvest()\` parser of signal \`${signal.name}\`, whose seed reads no server-rendered value,`,
			'The client re-evaluates the seed as written, and no parser runs — drop the marker.',
		),
	)
	rawSourceRefused.add(signal.name)
}

/** Pass 3: one harvest plan per signal, from Pass 2's render sites. */
const planHarvests = (
	shared: PassShared,
	{ forPlans, reconcilePlans }: LoopPlans,
	{
		sites,
		thunkRendered,
		renderCredited,
		clientCredited,
		formattedText,
	}: RenderSites,
): HarvestPlan[] => {
	const {
		component,
		source,
		diagnostics,
		addQuery,
		ambient,
		rawSourceRefused,
	} = shared
	const harvests: HarvestPlan[] = []
	const { loopFor, resolveSelector } = selectorAdaptersOf(component)

	for (const signal of component.signals) {
		if (signal.family === 'context') continue
		if (signal.constructor === 'createSensor') continue
		if (signal.family === 'declared' && signal.unresolvable) continue
		const hostSeeded =
			signal.family === 'declared' &&
			!!signal.init &&
			dependenciesOf(signal.init).has('host')
		const scalarMarker =
			signal.family === 'declared' && signal.harvest?.kind === 'scalar'
				? signal.harvest
				: null
		const scalarSeeded =
			signal.family === 'declared' &&
			SCALAR_HARVEST_CONSTRUCTORS.has(signal.constructor)
		const listPlan = [...reconcilePlans.values()].find(
			p => p.signal === signal.name,
		)
		if (listPlan && signal.family === 'declared') {
			const free = signal.init ? dependenciesOf(signal.init) : new Set<string>()
			if (
				[...free].every(
					name =>
						JS_GLOBALS.has(name) ||
						(name === 'host' && hostSeeded && !signal.harvest),
				)
			) {
				if (signal.harvest) {
					diagnostics.push(
						diagnostic.unsupported(
							source,
							signal.harvest.call,
							'A `harvest()` seed on a list seeded with a literal',
							'The client reuses a literal seed as written and harvests nothing — pass the literal to `createList()` directly.',
						),
					)
					rawSourceRefused.add(signal.name)
				} else
					harvests.push({ kind: 'list', signal: signal.name, seed: 'verbatim' })
			} else if (
				[...free].every(name => component.paramNames.includes(name)) &&
				!listPlan.scoped &&
				harvestsPerField(signal)
			) {
				const loop = [...reconcilePlans.entries()].find(
					([, plan]) => plan === listPlan,
				)?.[0]
				const plan = loop
					? planListFieldHarvest(shared, signal, loop, listPlan.container)
					: null
				if (plan) harvests.push(plan)
			} else if ([...free].every(name => component.paramNames.includes(name))) {
				if (listPlan.scoped) {
					diagnostics.push(
						diagnostic.unsupported(
							source,
							signal.init,
							`The list seed of \`${signal.name}\`, which is derived from server args, for a reactive-list ${wordingOf(component).loop} nested in an arm or a list item`,
							'The client seeds an arg-derived list from the adopted container at connect, and a nested container may not exist then — seed the list with a literal.',
						),
					)
				} else if (listPlan.holeSelector === null) {
					diagnostics.push(
						diagnostic.unsupported(
							source,
							signal.init,
							`The list seed of \`${signal.name}\`, which is derived from server args, with the ${wordingOf(component).loop} body rendering the item nowhere to read it from`,
							"The client seeds the list from the adopted items' rendered values — render the item in the body (the bare `{item}` child), or seed the list with a literal.",
						),
					)
				} else {
					harvests.push({
						kind: 'list',
						signal: signal.name,
						seed: {
							container: listPlan.container,
							valueSelector: listPlan.holeSelector,
						},
					})
				}
			} else {
				diagnostics.push(
					diagnostic.unsupported(
						source,
						signal.init,
						`The list seed of \`${signal.name}\`, which is neither a pure literal nor derived from server args,`,
						"The client either reuses a literal seed (the server rendered from it) or harvests the container's server-rendered children — seed the list with a literal, or derive it from server args.",
					),
				)
			}
			continue
		}
		if (!listPlan && signal.family === 'declared') {
			const aliased = planKeyAliasHarvest(shared, signal, reconcilePlans)
			if (aliased !== undefined) {
				if (aliased) harvests.push(aliased)
				continue
			}
		}
		const isDerivedCallback =
			signal.constructor === 'deriveCell' ||
			signal.constructor === 'deriveList' ||
			signal.constructor === 'deriveStore' ||
			signal.constructor === 'createMemo'
		const own = isDerivedCallback
			? []
			: sites
					.filter(s => s.signal === signal.name)
					.sort((a, b) => a.order - b.order)
		if (own.length === 0) {
			const identitySeed =
				!!signal.init &&
				nodeType(signal.init) === 'Identifier' &&
				component.paramNames.includes(String((signal.init as AstNode).name))
			const readsArgs =
				!!signal.init &&
				[...dependenciesOf(signal.init)].some(name =>
					component.paramNames.includes(name),
				)
			if (scalarMarker && (!readsArgs || (scalarSeeded && !identitySeed))) {
				refuseDeadMarker(shared, signal, scalarMarker.call)
				continue
			}
			const reported = diagnostics.length
			const allowContextMembers =
				clientCredited.has(signal.name) && !renderCredited.has(signal.name)
			const substituted = signal.init
				? substituteArgExpr(
						shared,
						signal.init,
						isDerivedCallback || thunkRendered.has(signal.name) || hostSeeded,
						isDerivedCallback,
						allowContextMembers,
					)
				: null
			if (substituted) {
				if (scalarSeeded && scalarMarker) {
					harvests.push({
						kind: 'substitute',
						signal: signal.name,
						expr: substituted,
						parser: authoredParserOf(shared, signal, scalarMarker),
					})
				} else if (
					scalarSeeded &&
					identitySeed &&
					signal.inferredType === 'unknown'
				) {
					const seedName =
						signal.init && nodeType(signal.init) === 'Identifier'
							? String((signal.init as AstNode).name)
							: null
					const param = seedName
						? component.paramProps.find(p => p.name === seedName)
						: undefined
					diagnostics.push(
						diagnostic.scalarSeedWithoutParser(
							source,
							signal.init,
							signal.name,
							signal.constructor,
							signal.init
								? source.slice(signal.init.start, signal.init.end)
								: signal.name,
							param && param.typeText !== 'unknown' ? param.typeText : null,
						),
					)
					rawSourceRefused.add(signal.name)
				} else {
					harvests.push({
						kind: 'substitute',
						signal: signal.name,
						expr: substituted,
					})
				}
				continue
			}
			const formatted = formattedText.get(signal.name)
			if (
				formatted &&
				signal.init &&
				diagnostics.length === reported &&
				[...dependenciesOf(signal.init)].some(name =>
					component.paramNames.includes(name),
				)
			) {
				diagnostics.push(
					diagnostic.formattedWithoutRawSource(
						source,
						formatted.node,
						`Signal \`${signal.name}\``,
						formatted.formatting,
					),
				)
				rawSourceRefused.add(signal.name)
				continue
			}
			reportUnharvestable(
				shared,
				signal,
				signal.init && thunkRendered.has(signal.name)
					? unportableNames(shared, signal.init, allowContextMembers)
					: [],
			)
			continue
		}
		const direct = own.find(s => s.kind === 'text' || s.kind === 'attr') as
			| { kind: 'text'; element: ElementNode }
			| { kind: 'attr'; element: ElementNode; attr: string }
			| undefined
		if (direct && direct.element === component.root) {
			const parser = parserForSeed(shared, signal, scalarSeeded, scalarMarker)
			if (!parser) continue
			ambient.add('host')
			if (direct.kind === 'text') {
				harvests.push({
					kind: 'text',
					signal: signal.name,
					query: 'host',
					parser,
				})
			} else {
				harvests.push({
					kind: 'attr',
					signal: signal.name,
					query: 'host',
					attr: direct.attr,
					parser,
				})
			}
			continue
		}
		if (direct) {
			const parser = parserForSeed(shared, signal, scalarSeeded, scalarMarker)
			if (!parser) continue
			const { selector, unique } = resolveSelector(direct.element)
			if (!unique) {
				diagnostics.push(
					diagnostic.unaddressableElement(
						source,
						direct.element.node,
						`No unique selector for the harvest site of signal \`${signal.name}\` — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
					),
				)
			}
			const query = addQuery(
				sanitizeVarName(direct.element.tag),
				selector,
				'one',
			)
			if (direct.kind === 'text') {
				harvests.push({
					kind: 'text',
					signal: signal.name,
					query,
					parser,
				})
			} else {
				harvests.push({
					kind: 'attr',
					signal: signal.name,
					query,
					attr: direct.attr,
					parser,
				})
			}
			continue
		}
		const mark = own[0] as {
			kind: 'membership'
			element: ElementNode
			attr: string
			constName: string
		}
		const loop = loopFor(mark.element)
		const plan = loop?.kind === 'each' ? forPlans.get(loop) : undefined
		const valueAttr = loop
			? [...loop.output.attrs].find(
					(attr): attr is Extract<AttributeIR, { kind: 'server' }> =>
						attr.kind === 'server' && attr.exprText === mark.constName,
				)
			: undefined
		if (!loop || !plan || !valueAttr) {
			reportUnharvestable(shared, signal)
			continue
		}
		const membership = {
			kind: 'membership' as const,
			signal: signal.name,
			collection: plan.collection,
			markAttr: mark.attr,
			valueAttr: valueAttr.name,
			default: defaultForType(signal.inferredType),
		}
		if (scalarSeeded && scalarMarker)
			harvests.push({
				...membership,
				parser: authoredParserOf(shared, signal, scalarMarker),
			})
		else {
			if (
				scalarSeeded &&
				!parserForSeed(shared, signal, scalarSeeded, scalarMarker)
			)
				continue
			harvests.push(membership)
		}
	}
	return harvests
}

/* === Exported Functions === */

export const runHarvest = (
	shared: PassShared,
	loopPlans: LoopPlans,
): HarvestPlans =>
	planHarvests(shared, loopPlans, collectRenderSites(shared.component))
