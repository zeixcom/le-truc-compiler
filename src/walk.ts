import type {
	AttributeIR,
	ComponentIR,
	ForIR,
	ReconcileForIR,
	TemplateNode,
} from './ir'
import { attributeReactivity } from './reactivity'

/* === Conditionals === */

/** A conditional node, either construct, either mode. */
export type ConditionalNode = Extract<TemplateNode, { kind: 'conditional' }>
/** An `@if`/`@else` (or `.tsx` ternary/`&&`): arms `then` and `else`. */
export type IfNode = ConditionalNode & { construct: 'if' }
/** An `@switch`/`@case` (or `.tsx` switch IIFE): one arm per case. */
export type SwitchNode = ConditionalNode & { construct: 'switch' }

export const isIf = (node: TemplateNode | null | undefined): node is IfNode =>
	node?.kind === 'conditional' && node.construct === 'if'

export const isSwitch = (
	node: TemplateNode | null | undefined,
): node is SwitchNode =>
	node?.kind === 'conditional' && node.construct === 'switch'

/** An `@if`'s `then` branch. */
export const thenOf = (node: IfNode): TemplateNode[] =>
	node.arms[0]?.children ?? []

/** An `@if`'s `else` branch — empty when the conditional has none. */
export const elseOf = (node: IfNode): TemplateNode[] =>
	node.arms[1]?.children ?? []

export const hasArmSet = (node: TemplateNode): boolean =>
	(node.kind === 'conditional' && node.mode === 'reactive') ||
	(node.kind === 'try' && node.pendingChildren !== null)

export const armSetOf = (root: TemplateNode, target: TemplateNode): number => {
	let index = -1
	let found = -1
	walkTemplate(root, node => {
		if (found >= 0 || !hasArmSet(node)) return
		index++
		if (node === target) found = index
	})
	return found
}

export const listIndexOf = (
	root: TemplateNode,
	fors: ReadonlyMap<unknown, ForIR>,
	target: ReconcileForIR,
): number => {
	const outputs = new Set<TemplateNode>()
	for (const loop of fors.values())
		if (loop.kind === 'reconcile') outputs.add(loop.output)
	let index = -1
	let found = -1
	walkTemplate(root, node => {
		if (found >= 0 || !outputs.has(node)) return
		index++
		if (node === target.output) found = index
	})
	return found
}

export const enclosingLists = (
	root: TemplateNode,
	fors: ReadonlyMap<unknown, ForIR>,
	target: TemplateNode,
): ReconcileForIR[] => {
	const byOutput = new Map<TemplateNode, ReconcileForIR>()
	for (const loop of fors.values())
		if (loop.kind === 'reconcile') byOutput.set(loop.output, loop)
	const search = (
		node: TemplateNode,
		stack: ReconcileForIR[],
	): ReconcileForIR[] | null => {
		if (node === target) return stack
		const own = byOutput.get(node)
		const inner = own ? [...stack, own] : stack
		for (const child of childNodes(node)) {
			const found = search(child, inner)
			if (found !== null) return found
		}
		return null
	}
	return search(root, []) ?? []
}

export const loopBindingNames = (loop: ForIR, into: Set<string>): void => {
	into.add(loop.itemName)
	if (loop.kind === 'each') {
		if (loop.indexName) into.add(loop.indexName)
		for (const hoisted of loop.hoisted) into.add(hoisted.name)
	} else for (const stmt of loop.setup) if (stmt.name) into.add(stmt.name)
}

export const inNestedScope = (
	root: TemplateNode,
	fors: ReadonlyMap<unknown, ForIR>,
	target: TemplateNode,
): boolean => {
	const outputs = new Set<TemplateNode>()
	for (const loop of fors.values())
		if (loop.kind === 'reconcile') outputs.add(loop.output)
	const search = (node: TemplateNode, scoped: boolean): boolean | null => {
		if (node === target) return scoped
		const inner = scoped || hasArmSet(node) || outputs.has(node)
		for (const child of childNodes(node)) {
			const found = search(child, inner)
			if (found !== null) return found
		}
		return null
	}
	return search(root, false) ?? false
}

export const childNodes = (node: TemplateNode): readonly TemplateNode[] => {
	switch (node.kind) {
		case 'element':
		case 'compose':
			return node.children
		case 'conditional':
			return node.arms.flatMap(arm => arm.children)
		case 'try':
			return [
				...node.children,
				...node.catchChildren,
				...(node.pendingChildren ?? []),
			]
		default:
			return []
	}
}

export type WalkOptions = {
	intoCompose?: boolean
}

/** Called once per visited node, pre-order, with its parent (null for the root). */
export type TemplateVisitor = (
	node: TemplateNode,
	parent: TemplateNode | null,
) => void

export const walkTemplate = (
	node: TemplateNode,
	visit: TemplateVisitor,
	options: WalkOptions = {},
): void => {
	const { intoCompose = true } = options
	const walk = (current: TemplateNode, parent: TemplateNode | null): void => {
		visit(current, parent)
		if (current.kind === 'compose' && !intoCompose) return
		for (const child of childNodes(current)) walk(child, current)
	}
	walk(node, null)
}

export const someNode = (
	node: TemplateNode,
	predicate: (node: TemplateNode) => boolean,
	options: WalkOptions = {},
): boolean => {
	const { intoCompose = true } = options
	const search = (current: TemplateNode): boolean =>
		predicate(current) ||
		(!(current.kind === 'compose' && !intoCompose) &&
			childNodes(current).some(search))
	return search(node)
}

export const collectAttrs = (
	node: TemplateNode,
	options?: WalkOptions,
): AttributeIR[] => {
	const out: AttributeIR[] = []
	walkTemplate(
		node,
		current => {
			if (current.kind === 'element') out.push(...current.attrs)
		},
		options,
	)
	return out
}

export const collectComposeElements = (
	component: ComponentIR,
): Array<TemplateNode & { kind: 'compose' }> => {
	const out: Array<TemplateNode & { kind: 'compose' }> = []
	const visit = (node: TemplateNode): void => {
		if (node.kind === 'compose') out.push(node)
	}
	walkTemplate(component.root, visit, { intoCompose: false })
	for (const loop of component.fors.values())
		walkTemplate(loop.output, visit, { intoCompose: false })
	return out
}

export const isClientConstructAttr = (a: AttributeIR): boolean => {
	const reactivity = attributeReactivity(a)
	return reactivity === 'reactive' || reactivity === null
}
