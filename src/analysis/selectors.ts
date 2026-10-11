import * as cssWhat from 'css-what'
import {
	type ChildrenRegion,
	childrenRegionOf,
	excludeUnlessOwned,
	isChildrenInsertion,
} from '../children-region'
import type { LeakChild } from '../css-scope'
import type {
	ComponentIR,
	ComposedMarkup,
	ForIR,
	RenderedShape,
	TemplateNode,
} from '../ir'
import type { InternalRegistryEntry } from '../registry'
import {
	childNodes,
	elseOf,
	type IfNode,
	isIf,
	someNode,
	thenOf,
	walkTemplate,
} from '../walk'
import {
	probeComposeNodes,
	probeCount,
	probeCountCompose,
	probeCountWithRegions,
	probeExists,
} from './probe'

/* === Types === */

export type ElementNode = Extract<TemplateNode, { kind: 'element' }>
export type ExprNode = Extract<TemplateNode, { kind: 'expr' }>
export type { IfNode, SwitchNode } from '../walk'
export type TryNode = Extract<TemplateNode, { kind: 'try' }>
export type ComposeNode = Extract<TemplateNode, { kind: 'compose' }>

export const isElement = (n: TemplateNode): n is ElementNode =>
	n.kind === 'element'

export const refOf = <A extends { kind: string }>(node: {
	attrs: readonly A[]
}): Extract<A, { kind: 'ref' }> | undefined =>
	node.attrs.find((a): a is Extract<A, { kind: 'ref' }> => a.kind === 'ref')

/* === Internal Functions === */

/** Static attributes of an element as a map (for selector synthesis). */
export const staticAttrs = (
	element: ElementNode,
): Map<string, string | null> => {
	const map = new Map<string, string | null>()
	for (const attr of element.attrs)
		if (attr.kind === 'static') map.set(attr.name, attr.value)
	return map
}

const buildSelector = (
	element: ElementNode,
	mode: 'role' | 'bare',
): string | null => {
	if (mode === 'bare') return element.tag
	const role = staticAttrs(element).get('role')
	if (role !== undefined && role !== null)
		return element.tag === 'div'
			? `[role="${role}"]`
			: `${element.tag}[role="${role}"]`
	return null
}

const PLAIN_SELECTOR_TOKEN = /^[A-Za-z_-][\w-]*$/

const PRECISION = { role: 3, id: 2, hook: 1, bare: 0 } as const

type Precision = (typeof PRECISION)[keyof typeof PRECISION]

type RankedBase = {
	base: string
	rank: Precision
}

const discriminatorCandidates = (element: ElementNode): RankedBase[] => {
	const attrs = staticAttrs(element)
	const prefix = element.tag === 'div' ? '' : element.tag
	const exact = (name: string, value: string): string =>
		`${prefix}[${name}="${value}"]`
	const candidates = new Map<string, Precision>()
	const type = attrs.get('type')
	if (typeof type === 'string')
		candidates.set(exact('type', type), PRECISION.bare)
	const className = attrs.get('class')
	if (typeof className === 'string') {
		const tokens = className.split(/\s+/).filter(Boolean)
		for (const token of tokens)
			candidates.set(
				PLAIN_SELECTOR_TOKEN.test(token)
					? `${prefix}.${token}`
					: exact('class', className),
				PRECISION.hook,
			)
	}
	const id = attrs.get('id')
	if (typeof id === 'string')
		candidates.set(
			PLAIN_SELECTOR_TOKEN.test(id) ? `${prefix}#${id}` : exact('id', id),
			PRECISION.id,
		)
	for (const [name, value] of attrs)
		if (name.startsWith('data-') && typeof value === 'string')
			candidates.set(exact(name, value), PRECISION.hook)
	for (const [name, value] of attrs)
		if (
			name.startsWith('aria-') &&
			typeof value === 'string' &&
			!/["\\]/.test(value)
		)
			candidates.set(exact(name, value), PRECISION.bare)
	return [...candidates].map(([base, rank]) => ({ base, rank }))
}

const SELECTOR_GRAMMAR =
	/^([a-z][a-z0-9-]*)?(?:\[([^\]="]+)="([^"]*)"\]|\.([A-Za-z_-][\w-]*)|#([A-Za-z_-][\w-]*))?$/

/* === Exported Functions === */

export const countForSelector = (
	node: TemplateNode,
	selector: string,
): number => probeCount(node, selector)

export const countRenderedForSelector = (
	node: TemplateNode,
	selector: string,
): number => probeCountWithRegions(node, selector)

export const countComposeBySource = (
	node: TemplateNode,
	source: string,
): number => probeCountCompose(node, source)

export const allComposeNodes = (root: TemplateNode): ComposeNode[] =>
	probeComposeNodes(root)

export const composeNodesBySource = (
	root: TemplateNode,
	source: string,
): ComposeNode[] => allComposeNodes(root).filter(node => node.source === source)

export const composeStaticAttrs = (node: ComposeNode): Map<string, string> => {
	const map = new Map<string, string>()
	for (const attr of node.attrs) {
		if (attr.kind !== 'arg') continue
		if (attr.node === null) {
			try {
				const value = JSON.parse(attr.exprText)
				if (typeof value === 'string') map.set(attr.name, value)
			} catch {
				// exprText wasn't a JSON string literal — not a static value.
			}
			continue
		}
		if (attr.node.type === 'Literal' && typeof attr.node.value === 'string')
			map.set(attr.name, attr.node.value)
	}
	return map
}

export const composeSiteAttrs = (
	node: ComposeNode,
): { attrs: Record<string, string>; dynamic: string[] } => {
	const attrs = Object.fromEntries(composeStaticAttrs(node))
	const dynamic = new Set<string>()
	for (const attr of node.attrs)
		if (
			attr.kind === 'arg' &&
			!(attr.name in attrs) &&
			(attr.name === 'class' ||
				attr.name === 'id' ||
				attr.name.startsWith('data-'))
		)
			dynamic.add(attr.name)
	return { attrs, dynamic: [...dynamic] }
}

export const composeDiscriminatorClause = (
	node: ComposeNode,
	siblings: readonly ComposeNode[],
	rejects: (clause: string) => boolean = () => false,
): string | null =>
	composeClauseCandidates(node).find(
		candidate =>
			composeClauseMatches(siblings, candidate).length === 1 &&
			!rejects(candidate.clause),
	)?.clause ?? null

export const composeSharedPassClause = (
	node: ComposeNode,
	siblings: readonly ComposeNode[],
	rejects: (clause: string) => boolean = () => false,
): { clause: string; members: ComposeNode[] } | null => {
	for (const candidate of composeClauseCandidates(node)) {
		const members = composeClauseMatches(siblings, candidate)
		if (
			members.every(
				sib =>
					sib.attrs.some(a => a.kind === 'pass') &&
					!refOf(sib) &&
					composeDiscriminatorClause(sib, siblings, rejects) === null,
			)
		)
			return { clause: candidate.clause, members }
	}
	return null
}

export type ComposeSiteAddress =
	| { kind: 'unique'; clause: string }
	| { kind: 'shared'; clause: string; members: ComposeNode[] }
	| { kind: 'refused'; siblings: ComposeNode[] }

export const composeSiteAddress = (
	scope: TemplateNode,
	node: ComposeNode,
	childTag: string | null,
	options: {
		composed?: ReadonlyMap<string, ComposedMarkup> | undefined
		lone?: boolean
		shared?: boolean
	} = {},
): ComposeSiteAddress => {
	const siblings = composeNodesBySource(scope, node.source)
	const tags =
		childTag !== null
			? [childTag]
			: rawElementTags(scope).filter(tag => tag.includes('-'))
	const matchesRaw = (clause: string) =>
		tags.some(tag => countRenderedForSelector(scope, `${tag}${clause}`) > 0)
	const exclusion = (clause: string): string | null => {
		if (!options.composed || childTag === null) return ''
		const base = `${childTag}${clause}`
		const resolved = composedEmitter(
			scope,
			node,
			options.composed,
			node.source,
		)(base)
		return resolved === null ? null : resolved.emit.slice(base.length)
	}
	const addressed = (clause: string): string | null => {
		if (matchesRaw(clause)) return null
		const suffix = exclusion(clause)
		return suffix === null ? null : `${clause}${suffix}`
	}
	const lone = options.lone ?? siblings.length === 1
	if (lone) {
		const bare = addressed('')
		if (bare !== null) return { kind: 'unique', clause: bare }
	}
	for (const candidate of composeClauseCandidates(node)) {
		if (composeClauseMatches(siblings, candidate).length !== 1) continue
		const clause = addressed(candidate.clause)
		if (clause !== null) return { kind: 'unique', clause }
	}
	const fallback = options.shared
		? composeSharedPassClause(
				node,
				siblings,
				clause => addressed(clause) === null,
			)
		: null
	const sharedClause = fallback ? addressed(fallback.clause) : null
	if (fallback && sharedClause !== null)
		return { kind: 'shared', clause: sharedClause, members: fallback.members }
	return { kind: 'refused', siblings }
}

export const composedChildMayMatch = (
	scope: TemplateNode,
	node: ComposeNode,
	childTag: string,
	clause: string,
	composed: ReadonlyMap<string, ComposedMarkup>,
): boolean =>
	composedEmitter(scope, node, composed, node.source)(`${childTag}${clause}`)
		?.clean !== true

export const composeSiteRefusal = (
	node: ComposeNode,
	childTag: string | null,
	siblings: readonly ComposeNode[],
	need: string,
	scope = 'template',
	tail = 'Give each site a distinct class.',
): string => {
	const where = scope === 'template' ? '' : `in one ${scope} `
	if (siblings.length > 1)
		return `Multiple <${node.component}> sites ${where}compose the same child, and no static class/id/data-* attribute tells this one apart — ${need}. ${tail}`
	if (childTag === null)
		return `<${node.component}>'s tag is not known when its handler args are recorded, so any raw custom element in this ${scope} could share it, and no static class/id/data-* attribute tells this site apart — ${need}. Give the site a class no raw custom element here carries.`
	return `<${node.component}> renders <${childTag}>, which other elements in this ${scope} also render, and no static class/id/data-* attribute tells this site apart — ${need}. Give the site a class no other <${childTag}> carries.`
}

/** Every raw element tag `scope` renders below its root, compose-site content included. */
const rawElementTags = (scope: TemplateNode): string[] => {
	const tags = new Set<string>()
	walkTemplate(scope, node => {
		if (node !== scope && node.kind === 'element') tags.add(node.tag)
	})
	return [...tags]
}

type ClauseCandidate = { name: string; value: string; clause: string }

/** `class` tokens, then `id`, then every `data-*`: the discriminator priority. */
const composeClauseCandidates = (node: ComposeNode): ClauseCandidate[] => {
	const attrs = composeStaticAttrs(node)
	const classTokens = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean)
	return [
		...classTokens.map(value => ({
			name: 'class',
			value,
			clause: `.${value}`,
		})),
		...(attrs.has('id')
			? [
					{
						name: 'id',
						value: attrs.get('id') as string,
						clause: `#${attrs.get('id')}`,
					},
				]
			: []),
		...[...attrs.keys()]
			.filter(name => name.startsWith('data-'))
			.map(name => ({
				name,
				value: attrs.get(name) as string,
				clause: `[${name}="${attrs.get(name)}"]`,
			})),
	]
}

/** The siblings `candidate` matches: `class` by token membership, the rest by exact value. */
const composeClauseMatches = (
	siblings: readonly ComposeNode[],
	{ name, value }: ClauseCandidate,
): ComposeNode[] =>
	siblings.filter(sib => {
		const sibAttrs = composeStaticAttrs(sib)
		if (name === 'class')
			return (sibAttrs.get('class') ?? '')
				.split(/\s+/)
				.filter(Boolean)
				.includes(value)
		return sibAttrs.get(name) === value
	})

const mayMatchShape = (shape: RenderedShape, selector: string): boolean => {
	if (shape.kind !== 'element') return true
	let branches
	try {
		branches = cssWhat.parse(selector)
	} catch {
		// Assumed to match — the conservative direction.
		return true
	}
	return branches.some(branch => branchMayMatchShape(shape, branch))
}

const branchMayMatchShape = (
	shape: RenderedShape & { kind: 'element' },
	branch: cssWhat.Selector[],
): boolean => {
	for (const simple of branch) {
		if (simple.type === 'tag') {
			if (simple.namespace !== null) return true
			// HTML parsing lowercases tag names; shapes carry the authored
			// (lowercase) tag.
			if (simple.name.toLowerCase() !== shape.tag.toLowerCase()) return false
		} else if (simple.type === 'attribute') {
			if (simple.namespace !== null) return true
			if (simple.ignoreCase === true) return true
			const name = simple.name
			if (shape.dynamic.includes(name))
				// May hold any value.
				continue
			const actual = shape.attrs[name]
			if (actual === undefined || actual === null)
				// Not rendered at all — the child's element cannot carry it.
				return false
			if (
				simple.action === 'equals'
					? actual !== simple.value
					: simple.action === 'element'
						? !actual.split(/\s+/).includes(simple.value)
						: simple.action === 'exists'
							? false
							: true
			)
				return false
		}
	}
	return true
}

type Candidates = {
	/** The structural count every candidate's `base` must prove itself in. */
	count: (selector: string) => number
	list: Array<{ base: string; emit: string }>
	excluded: Array<{ base: string; emit: string; rank: number }>
}

const selectorCandidates = (
	tree: TemplateNode,
	element: ElementNode,
	composed: ReadonlyMap<string, ComposedMarkup> | undefined,
): Candidates => {
	const count = enclosingComposeOf(tree, element)
		? (selector: string) => probeCountWithRegions(tree, selector)
		: (selector: string) => countForSelector(tree, selector)
	const role = buildSelector(element, 'role')
	const bases: RankedBase[] = [
		...(role !== null ? [{ base: role, rank: PRECISION.role }] : []),
		{ base: element.tag, rank: PRECISION.bare },
		...discriminatorCandidates(element),
	]
	const authored = authoredSelectorOf(element)
	if (!composed) {
		const synthesized = bases.map(({ base }) => ({ base, emit: base }))
		return {
			count,
			list: authored
				? [{ base: authored, emit: authored }, ...synthesized]
				: synthesized,
			excluded: [],
		}
	}
	const emitFor = composedEmitter(tree, element, composed)
	const resolved = bases.flatMap(({ base, rank }) => {
		const emitted = emitFor(base)
		return emitted
			? [{ base, emit: emitted.emit, rank, clean: emitted.clean }]
			: []
	})
	const own = authored ? emitFor(authored) : null
	return {
		count,
		list: [
			...(authored && own ? [{ base: authored, emit: own.emit }] : []),
			...resolved
				.filter(r => r.clean)
				.map(({ base, emit }) => ({ base, emit })),
		],
		excluded: resolved.filter(r => !r.clean),
	}
}

const composedEmitter = (
	tree: TemplateNode,
	target: TemplateNode,
	composed: ReadonlyMap<string, ComposedMarkup>,
	skipSource?: string,
): ((base: string) => { clean: boolean; emit: string } | null) => {
	const region = enclosingComposeOf(tree, target)
	const sites = allComposeNodes(tree)
	const children = sites.map(
		node =>
			composed.get(node.source) ?? {
				tag: null,
				shapes: [],
				region: null,
				owner: '',
			},
	)
	const owner = region ? composed.get(region.source) : undefined
	const regionSafe = (base: string, site: ComposeNode): boolean =>
		sites.every((node, index) => {
			if (node.children.length === 0) return true
			const markup = children[index] as ComposedMarkup
			if (markup.region === null) return node !== site
			return !markup.region.some(shape => mayMatchShape(shape, base))
		})
	return (base: string): { clean: boolean; emit: string } | null => {
		if (owner && !regionSafe(base, region as ComposeNode)) return null
		const clashing = children.filter(
			(child, index) =>
				sites[index]?.source !== skipSource &&
				(child.tag === null ||
					child.shapes.some(
						shape =>
							(shape.kind !== 'children' || !owner) &&
							mayMatchShape(shape, base),
					)),
		)
		if (clashing.length === 0) return { clean: true, emit: base }
		if (clashing.some(child => child.tag === null)) return null
		const tags = [...new Set(clashing.map(child => child.tag as string))]
		if (!owner)
			return {
				clean: false,
				emit: `${base}:not(${tags.map(tag => `${tag} *`).join(', ')})`,
			}
		return {
			clean: false,
			emit: `${base}${excludeUnlessOwned(owner.owner, '', prefix => tags.map(tag => `${prefix}${tag} *`))}`,
		}
	}
}

const enclosingComposeOf = (
	tree: TemplateNode,
	element: TemplateNode,
): ComposeNode | null => {
	let found: ComposeNode | null = null
	walkTemplate(tree, node => {
		if (found || node.kind !== 'compose') return
		if (node.children.some(child => someNode(child, n => n === element)))
			found = node
	})
	return found
}

const authoredSelectorOf = (element: ElementNode): string | null => {
	const selector = refOf(element)?.selector?.trim()
	return selector && SELECTOR_GRAMMAR.test(selector) ? selector : null
}

const byPrecision = <T extends { rank: number }>(excluded: readonly T[]): T[] =>
	[...excluded].sort((a, b) => b.rank - a.rank)

export const resolveSelectorIn = (
	tree: ElementNode,
	element: ElementNode,
	composed?: ReadonlyMap<string, ComposedMarkup>,
): { selector: string; unique: boolean } => {
	const { count, list, excluded } = selectorCandidates(tree, element, composed)
	for (const { base, emit } of list) {
		if (count(base) === 1) return { selector: emit, unique: true }
	}
	for (const { base, emit } of byPrecision(excluded)) {
		if (count(base) === 1) return { selector: emit, unique: true }
	}
	return {
		selector: list[0]?.emit ?? excluded[0]?.emit ?? element.tag,
		unique: false,
	}
}

export const resolveComposeContentSelector = (
	el: ElementNode,
): { selector: string; unique: false } | null => {
	const role = buildSelector(el, 'role')
	const candidates: RankedBase[] = [
		...(role !== null ? [{ base: role, rank: PRECISION.role }] : []),
		...discriminatorCandidates(el),
	]
	const selector = candidates[0]?.base
	return selector === undefined ? null : { selector, unique: false }
}

const childPathSelector = (
	tree: ElementNode,
	element: ElementNode,
): string | null => {
	const chain: string[] = []
	const find = (node: TemplateNode): boolean => {
		if (node === element) return true
		if (node.kind === 'compose') return false
		for (const child of childNodes(node)) {
			if (isElement(child)) chain.push(child.tag)
			if (find(child)) return true
			if (isElement(child)) chain.pop()
		}
		return false
	}
	if (element === tree || !find(tree) || chain.length === 0) return null
	const selector = `:scope > ${chain.join(' > ')}`
	return countForSelector(tree, selector) === 1 ? selector : null
}

export const resolveScopedSelector = (
	tree: ElementNode,
	element: ElementNode,
	composed?: ReadonlyMap<string, ComposedMarkup>,
): { selector: string; unique: boolean } => {
	const resolved = resolveSelectorIn(tree, element, composed)
	if (resolved.unique) return resolved
	const path = childPathSelector(tree, element)
	return path === null ? resolved : { selector: path, unique: true }
}

export const resolveSelector = (
	component: ComponentIR,
	element: ElementNode,
): { selector: string; unique: boolean } =>
	resolveSelectorIn(component.root, element, component.composedShapes)

export const matchesUnder = (
	nodes: readonly TemplateNode[],
	selector: string,
): boolean => probeExists(nodes, selector)

export const resolveExclusiveSelectorIn = (
	tree: ElementNode,
	element: ElementNode,
	clash: readonly TemplateNode[],
	composed?: ReadonlyMap<string, ComposedMarkup>,
): { selector: string; unique: boolean } => {
	const { count, list, excluded } = selectorCandidates(tree, element, composed)
	for (const { base, emit } of list) {
		if (count(base) !== 1) continue
		if (matchesUnder(clash, base)) continue
		return { selector: emit, unique: true }
	}
	for (const { base, emit } of byPrecision(excluded)) {
		if (count(base) !== 1) continue
		if (matchesUnder(clash, base)) continue
		return { selector: emit, unique: true }
	}
	return {
		selector: list[0]?.emit ?? excluded[0]?.emit ?? element.tag,
		unique: false,
	}
}

/** The `@for` loop whose output element is `node`, if any. */
export const loopFor = (
	component: ComponentIR,
	node: TemplateNode,
): ForIR | null =>
	[...component.fors.values()].find(f => f.output === node) ?? null

export const enclosingIfOf = (
	component: ComponentIR,
	target: ElementNode,
): IfNode | null => {
	const walk = (node: TemplateNode): IfNode | null => {
		if (isIf(node) && node.mode === 'server') {
			const branches = [...thenOf(node), ...elseOf(node)]
			if (branches.includes(target)) return node
			for (const child of branches) {
				const found = walk(child)
				if (found) return found
			}
			return null
		}
		if (!isElement(node)) return null
		for (const child of node.children) {
			const found = walk(child)
			if (found) return found
		}
		return null
	}
	return walk(component.root)
}

/** Selector for an element, union-addressed when it is an @if branch root. */
export const selectorFor = (
	component: ComponentIR,
	el: ElementNode,
): { selector: string; unique: boolean } => {
	const enclosing = enclosingIfOf(component, el)
	if (!enclosing) return resolveSelector(component, el)
	const roots = [...thenOf(enclosing), ...elseOf(enclosing)].filter(isElement)
	const clauses: string[] = []
	for (const root of roots) {
		const self = resolveSelectorIn(
			component.root,
			root,
			component.composedShapes,
		)
		if (!self.unique) return { selector: self.selector, unique: false }
		if (!clauses.includes(self.selector)) clauses.push(self.selector)
	}
	return { selector: clauses.join(', '), unique: true }
}

/** The component-bound selector adapters `selectorAdaptersOf` returns. */
export type SelectorAdapters = {
	/** `resolveSelector` — synthesized, uniqueness-proven selector. */
	resolveSelector: (el: ElementNode) => { selector: string; unique: boolean }
	/** `selectorFor` — union-addressed when `el` is an @if branch root. */
	selectorFor: (el: ElementNode) => { selector: string; unique: boolean }
	/** `loopFor` — the @for loop whose output element `node` is. */
	loopFor: (node: TemplateNode) => ForIR | null
	/** `enclosingIfOf` — the server-known @if holding `target` as a branch root. */
	enclosingIfOf: (target: ElementNode) => IfNode | null
}

export const selectorAdaptersOf = (
	component: ComponentIR,
): SelectorAdapters => ({
	resolveSelector: el => resolveSelector(component, el),
	selectorFor: el => selectorFor(component, el),
	loopFor: node => loopFor(component, node),
	enclosingIfOf: target => enclosingIfOf(component, target),
})

const shapesOfNode = (node: TemplateNode): RenderedShape[] => {
	if (node.kind === 'compose')
		return [{ kind: 'compose', source: node.source, ...composeSiteAttrs(node) }]
	if (isChildrenInsertion(node)) return [{ kind: 'children' }]
	if (node.kind !== 'element') return []
	const attrs: Record<string, string | null> = {}
	const dynamic = new Set<string>()
	let any = false
	for (const attr of node.attrs) {
		if (attr.kind === 'static') attrs[attr.name] = attr.value
		else if (attr.kind === 'server' || attr.kind === 'reactive')
			dynamic.add(attr.name)
		else if (attr.kind === 'class-map') dynamic.add('class')
		else if (attr.kind === 'style-map') dynamic.add('style')
		else if (attr.kind === 'html') any = true
	}
	return [
		{ kind: 'element', tag: node.tag, attrs, dynamic: [...dynamic] },
		...(any ? [{ kind: 'any' } as const] : []),
	]
}

export const renderedShapesOf = (component: ComponentIR): RenderedShape[] => {
	const shapes: RenderedShape[] = []
	let any = false
	let children = false
	walkTemplate(component.root, node => {
		for (const shape of shapesOfNode(node)) {
			if (shape.kind === 'any') any = true
			else if (shape.kind === 'children') children = true
			else shapes.push(shape)
		}
	})
	if (any) shapes.push({ kind: 'any' })
	if (children) shapes.push({ kind: 'children' })
	return shapes
}

export const childrenRegionOfComponent = (
	component: ComponentIR,
): ChildrenRegion | undefined => childrenRegionOf(component.root, shapesOfNode)

export const composedShapesFor = (
	root: TemplateNode & { kind: 'element' },
	composeRegistry: ReadonlyMap<string, InternalRegistryEntry>,
): Map<string, ComposedMarkup> => {
	const closure = (
		source: string,
		seen: ReadonlySet<string>,
		dropChildren = false,
	): RenderedShape[] => {
		const own = composeRegistry.get(source)?.renderedShapes
		if (!own) return [{ kind: 'any' }]
		return expand(own, seen, dropChildren)
	}
	const expand = (
		shapes: readonly RenderedShape[],
		seen: ReadonlySet<string>,
		dropChildren: boolean,
	): RenderedShape[] =>
		shapes.flatMap(shape =>
			shape.kind === 'children' && dropChildren
				? []
				: shape.kind !== 'compose'
					? [shape]
					: seen.has(shape.source)
						? []
						: closure(
								shape.source,
								new Set([...seen, shape.source]),
								dropChildren,
							),
		)
	const regionClosure = (
		source: string,
		seen: ReadonlySet<string>,
	): RenderedShape[] | null => {
		const entry = composeRegistry.get(source)
		const region = entry?.childrenRegion
		if (!region || region.unmarked) return null
		const shapes = expand(region.shapes, seen, true)
		for (const forward of region.forwards) {
			if (seen.has(forward)) return null
			const inner = regionClosure(forward, new Set([...seen, forward]))
			if (inner === null) return null
			shapes.push(...inner)
		}
		return shapes
	}
	const result = new Map<string, ComposedMarkup>()
	for (const node of allComposeNodes(root))
		if (!result.has(node.source))
			result.set(node.source, {
				tag: composeRegistry.get(node.source)?.tag ?? null,
				shapes: closure(node.source, new Set([node.source])),
				region: regionClosure(node.source, new Set([node.source])),
				owner: root.tag,
			})
	return result
}

export const leakChildrenFor = (
	root: TemplateNode,
	composeRegistry: ReadonlyMap<string, InternalRegistryEntry>,
): LeakChild[] => {
	type Element = RenderedShape & { kind: 'element' }
	type Site = { attrs: Record<string, string>; dynamic: readonly string[] }
	const build = (
		source: string,
		site: Site,
		seen: ReadonlySet<string>,
	): LeakChild | null => {
		const entry = composeRegistry.get(source)
		if (!entry) return null
		const shapes = entry.renderedShapes ?? []
		const elements = shapes.filter(
			(shape): shape is Element => shape.kind === 'element',
		)
		// The template's root is the host: `renderedShapesOf` walks it first.
		const own = elements[0]?.tag === entry.tag ? elements[0] : undefined
		const attrs: Record<string, string | null> = { ...own?.attrs }
		for (const [name, value] of Object.entries(site.attrs))
			attrs[name] =
				name === 'class' && attrs.class ? `${attrs.class} ${value}` : value
		const inner = new Set([...seen, source])
		return {
			tag: entry.tag,
			host: {
				attrs,
				dynamic: [...new Set([...(own?.dynamic ?? []), ...site.dynamic])],
			},
			shapes: own ? elements.slice(1) : elements,
			children: shapes.flatMap(shape =>
				shape.kind === 'compose' && !inner.has(shape.source)
					? (build(shape.source, shape, inner) ?? [])
					: [],
			),
		}
	}
	return allComposeNodes(root).flatMap(
		node => build(node.source, composeSiteAttrs(node), new Set()) ?? [],
	)
}
