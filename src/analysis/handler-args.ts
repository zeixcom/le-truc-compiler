import { diagnostic, type LocalDiagnostic } from '../diagnostics'
import type { ComponentIR, ComposedMarkup, TemplateNode } from '../ir'
import type { HandlerPlacement, InternalRegistryEntry } from '../registry'
import { childNodes } from '../walk'
import {
	allComposeNodes,
	composedChildMayMatch,
	composeNodesBySource,
	composeSiteAddress,
	composeSiteRefusal,
	resolveScopedSelector,
} from './selectors'

/** A placement resolved to the element the parent's `on()` binds. */
export type ResolvedPlacement = {
	event: string
	selector: string
	optional: boolean
}

export const handlerPlacementsOf = (
	component: ComponentIR,
	diagnostics: LocalDiagnostic[],
): Record<string, HandlerPlacement[]> | undefined => {
	const placements: Record<string, HandlerPlacement[]> = {}
	const add = (arg: string, placement: HandlerPlacement): void => {
		placements[arg] ??= []
		placements[arg].push(placement)
	}
	const unknownMarkup = new Map<string, ComposedMarkup>(
		allComposeNodes(component.root).map(node => [
			node.source,
			{
				tag: null,
				shapes: [{ kind: 'any' }],
				region: null,
				owner: component.tag,
			},
		]),
	)
	const loopOutputs = new Set<TemplateNode>(
		[...component.fors.values()].map(loop => loop.output),
	)
	const visit = (node: TemplateNode, optional: boolean): void => {
		if (node.kind === 'element') {
			if (node !== component.root && loopOutputs.has(node)) return
			for (const attr of node.attrs) {
				if (attr.kind !== 'handler-arg') continue
				const { selector, unique } = resolveScopedSelector(
					component.root,
					node,
					unknownMarkup,
				)
				if (!unique) {
					diagnostics.push(
						diagnostic.unaddressableElement(
							component.source,
							node.node,
							`No unique selector for <${node.tag}>, which carries the handler arg \`${attr.arg}\` — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
						),
					)
					continue
				}
				add(attr.arg, { event: attr.event, selector, optional })
			}
			for (const child of node.children) visit(child, optional)
			return
		}
		if (node.kind === 'compose') {
			const forwards = node.attrs.flatMap(attr =>
				attr.kind === 'handler' && attr.forward !== null
					? [{ arg: attr.name, forward: attr.forward }]
					: [],
			)
			if (forwards.length === 0) return
			const address = composeSiteAddress(component.root, node, null)
			const childTag = component.composedShapes?.get(node.source)?.tag ?? null
			const need = 'the handler arg it forwards needs a unique target'
			if (address.kind !== 'unique') {
				diagnostics.push(
					diagnostic.unaddressableElement(
						component.source,
						node.node,
						composeSiteRefusal(
							node,
							null,
							composeNodesBySource(component.root, node.source),
							need,
						),
					),
				)
				return
			}
			if (
				childTag !== null &&
				component.composedShapes &&
				composedChildMayMatch(
					component.root,
					node,
					childTag,
					address.clause,
					component.composedShapes,
				)
			) {
				diagnostics.push(
					diagnostic.unaddressableElement(
						component.source,
						node.node,
						composeSiteRefusal(node, childTag, [node], need),
					),
				)
				return
			}
			for (const { arg, forward } of forwards)
				add(forward, {
					via: node.source,
					clause: address.clause,
					arg,
					optional,
				})
			return
		}
		if (node.kind === 'conditional') {
			if (node.mode === 'reactive') return
			for (const child of childNodes(node)) visit(child, true)
			return
		}
		if (node.kind === 'try') {
			if (node.pendingChildren !== null) return
			for (const child of childNodes(node)) visit(child, true)
		}
	}
	visit(component.root, false)
	return Object.keys(placements).length > 0 ? placements : undefined
}

export const joinSelector = (prefix: string, relative: string): string => {
	if (prefix === '') return relative
	return relative.startsWith(':scope')
		? `${prefix}${relative.slice(':scope'.length)}`
		: `${prefix} ${relative}`
}

export const resolveHandlerPlacements = (
	entry: InternalRegistryEntry,
	arg: string,
	registry: ReadonlyMap<string, InternalRegistryEntry>,
	seen: ReadonlySet<string> = new Set([entry.source]),
): ResolvedPlacement[] => {
	const resolved: ResolvedPlacement[] = []
	for (const placement of entry.handlerArgs?.[arg] ?? []) {
		if ('event' in placement) {
			resolved.push(placement)
			continue
		}
		const inner = registry.get(placement.via)
		if (!inner || seen.has(placement.via)) continue
		for (const nested of resolveHandlerPlacements(
			inner,
			placement.arg,
			registry,
			new Set([...seen, placement.via]),
		))
			resolved.push({
				event: nested.event,
				selector: joinSelector(
					`${inner.tag}${placement.clause}`,
					nested.selector,
				),
				optional: placement.optional || nested.optional,
			})
	}
	return resolved
}
