import type { ComponentIR } from '../ir'
import type { QueryPlan } from './plan'

export const uniqueName = (usedNames: Set<string>, base: string): string => {
	let name = base
	let n = 2
	while (usedNames.has(name)) name = `${base}${n++}`
	usedNames.add(name)
	return name
}

export const addQuery = (
	usedNames: Set<string>,
	queries: QueryPlan[],
	childTags: Set<string>,
	component: ComponentIR,
	registry: ReadonlySet<string>,
	base: string,
	selector: string,
	cardinality: 'one' | 'many' | 'maybe',
): string => {
	const effective: 'one' | 'many' | 'maybe' =
		cardinality === 'one' && component.firstRefs.get(base)?.required === false
			? 'maybe'
			: cardinality
	const existing = queries.find(
		q => q.selector === selector && q.cardinality === effective,
	)
	if (existing) return existing.name
	const tag = selector.match(/^[a-z][a-z0-9-]*/)?.[0] ?? ''
	if (
		tag.includes('-') &&
		tag !== component.tag &&
		registry.has(tag) &&
		!childTags.has(tag)
	)
		childTags.add(tag)
	const name = uniqueName(usedNames, base)
	const message =
		component.firstRefs.get(base)?.reason ??
		`${component.tag}: ${selector} missing`
	queries.push({ name, selector, cardinality: effective, message })
	return name
}

export const renderOnlyBindings = (component: ComponentIR): Set<string> => {
	const names = new Set<string>(component.paramNames)
	for (const loop of component.fors.values()) {
		if (loop.kind !== 'each') continue
		names.add(loop.itemName)
		if (loop.indexName) names.add(loop.indexName)
		for (const h of loop.hoisted) names.add(h.name)
	}
	return names
}
