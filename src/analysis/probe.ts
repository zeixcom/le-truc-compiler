import * as cssSelect from 'css-select'
import { parseFragment } from 'parse5'
import type { TemplateNode } from '../ir'
import type { ComposeNode } from './selectors'

/* === Types === */

/** Minimal structural view of a parse5 element/document-fragment node. */
type P5Node = {
	nodeName: string
	tagName?: string
	attrs?: Array<{ name: string; value: string }>
	childNodes?: P5Node[]
	parentNode?: P5Node | null
	value?: string
}
type P5Element = P5Node & {
	tagName: string
	attrs: Array<{ name: string; value: string }>
}

/* === css-select adapter over parse5 trees === */

const isTag = (node: P5Node): node is P5Element => node.tagName !== undefined

const elementChildren = (node: P5Node): P5Element[] =>
	(node.childNodes ?? []).filter(isTag)

type CssAdapter = NonNullable<
	import('css-select').Options<P5Node, P5Element>['adapter']
>

const adapter: CssAdapter = {
	isTag,
	getAttributeValue: (elem: P5Element, name: string): string | undefined =>
		elem.attrs.find(a => a.name === name)?.value,
	getChildren: (node: P5Node): P5Node[] => node.childNodes ?? [],
	getName: (elem: P5Element): string => elem.tagName,
	getParent: (node: P5Node): P5Node | null => node.parentNode ?? null,
	getSiblings: (node: P5Node): P5Node[] =>
		node.parentNode?.childNodes ?? [node],
	getText: (node: P5Node): string =>
		(node.childNodes ?? [])
			.map(child =>
				child.nodeName === '#text'
					? (child.value ?? '')
					: adapter.getText(child),
			)
			.join(''),
	hasAttrib: (elem: P5Element, name: string): boolean =>
		elem.attrs.some(a => a.name === name),
	prevElementSibling: (node: P5Node): P5Element | null => {
		const siblings = node.parentNode?.childNodes ?? []
		const index = siblings.indexOf(node)
		for (let i = index - 1; i >= 0; i--) {
			const sibling = siblings[i]
			if (sibling && isTag(sibling)) return sibling
		}
		return null
	},
	removeSubsets: (nodes: P5Node[]): P5Node[] =>
		nodes.filter(
			node => !nodes.some(other => other !== node && containsNode(other, node)),
		),
}

const containsNode = (ancestor: P5Node, node: P5Node): boolean => {
	let current: P5Node | null | undefined = node
	while (current) {
		if (current === ancestor) return true
		current = current.parentNode
	}
	return false
}

/* === Materializer === */

/** HTML void elements: parse5 reparents their "children" as siblings. */
const VOID_TAGS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
])

/** The probe-owned attribute carrying an element's exclusive-arm path. */
const ARM_ATTR = 'data-lt-probe-arm'

const escapeAttr = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')

type Frag = {
	root: P5Node
	/** Every compose site, document order, with its exclusive-arm path. */
	composes: Array<{ node: ComposeNode; path: string }>
}

type Serializer = {
	out: string[]
	composes: Array<{ node: ComposeNode; path: string }>
	/** Next group id; ids are unique per serialization. */
	nextGroup: number
	regions: boolean
}

const armPath = (path: string, group: number, arm: number): string =>
	`${path ? `${path}/` : ''}${group}:${arm}`

const serializeNodes = (
	nodes: readonly TemplateNode[],
	path: string,
	ser: Serializer,
): void => {
	const { out } = ser
	const exclusive = (arms: ReadonlyArray<readonly TemplateNode[]>) => {
		const group = ser.nextGroup++
		arms.forEach((arm, index) => {
			serializeNodes(arm, armPath(path, group, index), ser)
		})
	}
	for (const node of nodes) {
		switch (node.kind) {
			case 'element': {
				if (node.tag === 'template') {
					serializeNodes(node.children, path, ser)
					break
				}
				const attrs: string[] = []
				for (const attr of node.attrs)
					if (attr.kind === 'static' && attr.name !== ARM_ATTR)
						attrs.push(
							attr.value === null
								? attr.name
								: `${attr.name}="${escapeAttr(attr.value)}"`,
						)
				if (path) attrs.push(`${ARM_ATTR}="${path}"`)
				out.push(`<${node.tag}${attrs.length ? ' ' : ''}${attrs.join(' ')}>`)
				serializeNodes(node.children, path, ser)
				if (!VOID_TAGS.has(node.tag)) out.push(`</${node.tag}>`)
				break
			}
			case 'compose':
				ser.composes.push({ node, path })
				if (ser.regions) serializeNodes(node.children, path, ser)
				break
			case 'conditional':
				exclusive(node.arms.map(arm => arm.children))
				break
			case 'try':
				exclusive([
					node.children,
					node.catchChildren,
					...(node.pendingChildren ? [node.pendingChildren] : []),
				])
				break
			default:
				// text, expr, client-stmt — no element, nothing to match.
				break
		}
	}
}

const materialize = (nodes: readonly TemplateNode[], regions = false): Frag => {
	const ser: Serializer = { out: [], composes: [], nextGroup: 0, regions }
	serializeNodes(nodes, '', ser)
	return {
		root: parseFragment(ser.out.join('')) as unknown as P5Node,
		composes: ser.composes,
	}
}

const fragByNode = new WeakMap<TemplateNode, Frag>()
const fragByArray = new WeakMap<readonly TemplateNode[], Frag>()

const fragOfRoot = (root: TemplateNode): Frag => {
	let frag = fragByNode.get(root)
	if (!frag) {
		frag = materialize([root])
		fragByNode.set(root, frag)
	}
	return frag
}

const fragWithRegions = new WeakMap<TemplateNode, Frag>()

const fragOfRootWithRegions = (root: TemplateNode): Frag => {
	let frag = fragWithRegions.get(root)
	if (!frag) {
		frag = materialize([root], true)
		fragWithRegions.set(root, frag)
	}
	return frag
}

const fragOfNodes = (nodes: readonly TemplateNode[]): Frag => {
	let frag = fragByArray.get(nodes)
	if (!frag) {
		frag = materialize(nodes)
		fragByArray.set(nodes, frag)
	}
	return frag
}

/* === The one aggregation === */

/** An arm-path trie node: direct hits, plus each group's arms. */
type ArmTrie = { hits: number; groups: Map<string, Map<string, ArmTrie>> }

const trieNode = (): ArmTrie => ({ hits: 0, groups: new Map() })

const aggregate = (paths: readonly string[]): number => {
	const root = trieNode()
	for (const path of paths) {
		let node = root
		if (path)
			for (const segment of path.split('/')) {
				const [group, arm] = segment.split(':') as [string, string]
				let arms = node.groups.get(group)
				if (!arms) {
					arms = new Map()
					node.groups.set(group, arms)
				}
				let next = arms.get(arm)
				if (!next) {
					next = trieNode()
					arms.set(arm, next)
				}
				node = next
			}
		node.hits++
	}
	const value = (node: ArmTrie): number => {
		let total = node.hits
		for (const arms of node.groups.values())
			total += Math.max(0, ...[...arms.values()].map(value))
		return total
	}
	return value(root)
}

/** Compile with the adapter baked in; ReturnType names the query type. */
const compileQuery = (selector: string) =>
	cssSelect.compile(selector, { adapter })
type CompiledQuery = ReturnType<typeof compileQuery>

const queryCache = new Map<string, CompiledQuery | null>()

/** A compiled query, or `null` when css-what cannot parse the selector — a querySelector would throw on it, so it matches nothing in any valid DOM. */
const queryOf = (selector: string): CompiledQuery | null => {
	if (!queryCache.has(selector)) {
		try {
			queryCache.set(selector, compileQuery(selector))
		} catch {
			queryCache.set(selector, null)
		}
	}
	return queryCache.get(selector) ?? null
}

const matchedPaths = (frag: Frag, query: CompiledQuery): string[] => {
	const paths: string[] = []
	const visit = (node: P5Node, inherited: string): void => {
		for (const child of elementChildren(node)) {
			const path = adapter.getAttributeValue(child, ARM_ATTR) ?? inherited
			if (cssSelect.is(child, query)) paths.push(path)
			visit(child, path)
		}
	}
	visit(frag.root, '')
	return paths
}

/* === Exported Functions === */

/** `countForSelector` over the materialized probe (`analysis/selectors.ts`). */
export const probeCount = (root: TemplateNode, selector: string): number => {
	const query = queryOf(selector)
	if (!query) return 0
	return aggregate(matchedPaths(fragOfRoot(root), query))
}

export const probeCountWithRegions = (
	root: TemplateNode,
	selector: string,
): number => {
	const query = queryOf(selector)
	if (!query) return 0
	return aggregate(matchedPaths(fragOfRootWithRegions(root), query))
}

/** `matchesUnder` — pure existence; exclusivity can never flip it. */
export const probeExists = (
	nodes: readonly TemplateNode[],
	selector: string,
): boolean => {
	const query = queryOf(selector)
	if (!query) return false
	return matchedPaths(fragOfNodes(nodes), query).length > 0
}

export const probeCountCompose = (root: TemplateNode, source: string): number =>
	aggregate(
		fragOfRoot(root)
			.composes.filter(entry => entry.node.source === source)
			.map(entry => entry.path),
	)

export const probeComposeNodes = (root: TemplateNode): ComposeNode[] =>
	fragOfRoot(root).composes.map(entry => entry.node)
