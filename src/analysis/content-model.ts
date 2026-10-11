import type { TemplateNode } from '../ir'
import type { InternalRegistryEntry } from '../registry'
import { childNodes, someNode } from '../walk'

/* === Types === */

type ElementNode = Extract<TemplateNode, { kind: 'element' }>

/** What the compose-site check found, named for the message. */
export type InteractiveFinding =
	| { kind: 'element'; describe: string }
	| { kind: 'component'; tag: string }

/* === Internal Functions === */

/** Whether an attribute of `name` is present on `element` in any kind that renders one. */
const hasAttr = (element: ElementNode, name: string): boolean =>
	element.attrs.some(
		attr =>
			(attr.kind === 'static' ||
				attr.kind === 'server' ||
				attr.kind === 'reactive') &&
			attr.name === name,
	)

/** The static value of `name`, when the element carries it as a literal. */
const staticAttr = (
	element: ElementNode,
	name: string,
): string | null | undefined => {
	for (const attr of element.attrs)
		if (attr.kind === 'static' && attr.name === name) return attr.value
	return undefined
}

/* === Exported Functions === */

export const interactiveDescribeOf = (element: ElementNode): string | null => {
	const tag = element.tag
	if (
		tag === 'button' ||
		tag === 'select' ||
		tag === 'textarea' ||
		tag === 'label' ||
		tag === 'details' ||
		tag === 'iframe'
	)
		return `<${tag}>`
	if (tag === 'a' && hasAttr(element, 'href')) return '<a href>'
	if (
		tag === 'input' &&
		staticAttr(element, 'type')?.toLowerCase() !== 'hidden'
	)
		return '<input>'
	if (hasAttr(element, 'tabindex')) return `<${tag} tabindex>`
	if ((tag === 'audio' || tag === 'video') && hasAttr(element, 'controls'))
		return `<${tag} controls>`
	return null
}

export const interactiveBySource = (
	source: string,
	registry: ReadonlyMap<string, InternalRegistryEntry>,
	seen: ReadonlySet<string>,
): boolean => {
	if (seen.has(source)) return false
	const entry = registry.get(source)
	if (!entry) return false
	if (entry.interactive) return true
	return (entry.renderedShapes ?? []).some(
		shape =>
			shape.kind === 'compose' &&
			interactiveBySource(shape.source, registry, new Set([...seen, source])),
	)
}

export const templateInteractiveOf = (
	root: TemplateNode,
	composeRegistry?: ReadonlyMap<string, InternalRegistryEntry>,
): boolean =>
	someNode(root, node => {
		if (node.kind === 'element') return interactiveDescribeOf(node) !== null
		if (node.kind === 'compose' && composeRegistry)
			return interactiveBySource(node.source, composeRegistry, new Set())
		return false
	})

export const findInteractiveContent = (
	children: readonly TemplateNode[],
	composeRegistry: ReadonlyMap<string, InternalRegistryEntry>,
): InteractiveFinding | null => {
	for (const child of children) {
		if (child.kind === 'compose') {
			if (interactiveBySource(child.source, composeRegistry, new Set()))
				return {
					kind: 'component',
					tag: composeRegistry.get(child.source)?.tag ?? child.component,
				}
			continue
		}
		if (child.kind === 'element') {
			const describe = interactiveDescribeOf(child)
			if (describe) return { kind: 'element', describe }
		}
		const nested = findInteractiveContent(childNodes(child), composeRegistry)
		if (nested) return nested
	}
	return null
}
