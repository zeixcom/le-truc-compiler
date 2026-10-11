import type { RenderedShape, TemplateNode } from './ir'
import { childNodes, walkTemplate } from './walk'

/* === Types === */

type ElementNode = Extract<TemplateNode, { kind: 'element' }>
type ComposeNode = Extract<TemplateNode, { kind: 'compose' }>

/** Where a template inserts its `children`, and how each insertion is marked. */
export type ChildrenInsertions = {
	/** Elements that directly enclose an insertion: each carries the marker. */
	holders: Set<ElementNode>
	forwards: Set<ComposeNode>
	unmarked: boolean
}

export type ChildrenRegion = {
	shapes: RenderedShape[]
	/** Sources of the composed children the content is forwarded to. */
	forwards: string[]
	/** See {@link ChildrenInsertions.unmarked}. */
	unmarked: boolean
}

/* === Constants === */

/** The region marker attribute. */
export const CHILDREN_MARKER = 'data-children'

/* === Exported Functions === */

/** The bare `{children}` insertion point. */
export const isChildrenInsertion = (node: TemplateNode): boolean =>
	node.kind === 'expr' &&
	node.reactivity === 'server' &&
	node.expr.type === 'Identifier' &&
	node.exprText === 'children'

/** The selector for every region `tag` owns. */
export const ownRegion = (tag: string): string =>
	`[${CHILDREN_MARKER}="${tag}"]`

export const excludeUnlessOwned = (
	owner: string,
	outerPrefix: string,
	terms: (prefix: string) => readonly string[],
): string => {
	const region = ownRegion(owner)
	return `:not(:is(${terms(outerPrefix).join(', ')}):not(:is(${region} *):not(:is(${terms(`${region} `).join(', ')}))))`
}

export const childrenInsertionsOf = (
	root: TemplateNode,
): ChildrenInsertions => {
	const result: ChildrenInsertions = {
		holders: new Set(),
		forwards: new Set(),
		unmarked: false,
	}
	const visit = (
		node: TemplateNode,
		enclosing: ElementNode | ComposeNode | null,
	): void => {
		if (isChildrenInsertion(node)) {
			if (enclosing?.kind === 'element') result.holders.add(enclosing)
			else if (enclosing?.kind === 'compose') {
				const content = enclosing.children.filter(
					child => !(child.kind === 'text' && child.value.trim() === ''),
				)
				if (content.length === 1) result.forwards.add(enclosing)
				else result.unmarked = true
			}
			return
		}
		const next =
			node.kind === 'element' || node.kind === 'compose' ? node : enclosing
		for (const child of childNodes(node)) visit(child, next)
	}
	visit(root, null)
	return result
}

export const childrenRegionOf = (
	root: TemplateNode,
	shapesOf: (node: TemplateNode) => readonly RenderedShape[],
): ChildrenRegion | undefined => {
	const insertions = childrenInsertionsOf(root)
	if (
		insertions.holders.size === 0 &&
		insertions.forwards.size === 0 &&
		!insertions.unmarked
	)
		return undefined
	const shapes: RenderedShape[] = []
	for (const holder of insertions.holders)
		for (const child of holder.children)
			walkTemplate(child, node => {
				for (const shape of shapesOf(node))
					if (shape.kind !== 'children') shapes.push(shape)
			})
	return {
		shapes,
		forwards: [...insertions.forwards].map(node => node.source),
		unmarked: insertions.unmarked,
	}
}
