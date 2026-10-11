import {
	directLazyCatchRef,
	hasDeepConstruct,
} from './analysis/construct-effects'
import type { ComposeNode, ElementNode } from './analysis/selectors'
import { type AstNode, isNode, nodeType } from './ast-utils'
import type { TemplateNode } from './ir'
import { isClientConstructAttr } from './walk'

export type BoundaryArmRoot = ElementNode | ComposeNode

export const isBoundaryArmRoot = (
	node: TemplateNode,
): node is BoundaryArmRoot => node.kind === 'element' || node.kind === 'compose'

export const lazyCatchMessageEl = (
	el: BoundaryArmRoot,
	catchParam: string | null,
): ElementNode | null => {
	if (!catchParam) return null
	const elementChildren = (children: readonly TemplateNode[]): ElementNode[] =>
		children.filter((c): c is ElementNode => c.kind === 'element')
	for (const child of elementChildren(el.children)) {
		if (directLazyCatchRef(child, catchParam) !== null) return child
	}
	for (const child of el.children) {
		if (child.kind !== 'compose') continue
		for (const inner of elementChildren(child.children)) {
			if (directLazyCatchRef(inner, catchParam) !== null) return inner
		}
	}
	return null
}

export const boundaryDeepConstructOf = (
	root: BoundaryArmRoot,
	messageEl: ElementNode | null,
	catchParam: string | null,
): TemplateNode | null => {
	// Without a catch parameter there is no message element to exempt.
	const exempt =
		messageEl !== null && catchParam !== null
			? { el: messageEl, param: catchParam }
			: null
	let seenLazyInner = false
	const visit = (
		children: readonly TemplateNode[],
		depth: number,
	): TemplateNode | null => {
		for (const child of children) {
			if (exempt !== null && child === exempt.el) {
				if (child.attrs.some(isClientConstructAttr)) return child
				for (const inner of child.children) {
					if (inner.kind === 'element') return inner
					if (inner.kind === 'expr' && inner.reactivity === 'reactive') {
						if (seenLazyInner) return inner
						seenLazyInner = true
						if (directLazyCatchRef(exempt.el, exempt.param) === null)
							return inner
					}
				}
				continue
			}
			if (child.kind === 'compose') {
				const deeper = visit(child.children, depth + 1)
				if (deeper !== null) return deeper
				continue
			}
			if (child.kind === 'expr' && child.reactivity === 'reactive') {
				if (depth === 0 && root.kind === 'element') continue
				return child
			}
			if (
				child.kind === 'element' &&
				(child.attrs.some(isClientConstructAttr) || hasDeepConstruct(child))
			)
				return child
		}
		return null
	}
	return visit(root.children, 0)
}

export const htmlThunkSignalName = (el: BoundaryArmRoot): string | null => {
	for (const attr of el.attrs) {
		if (attr.kind !== 'html' || !attr.reactive) continue
		const body = (attr.thunk as { body?: unknown }).body
		if (!isNode(body) || nodeType(body) !== 'CallExpression') continue
		const callee = (body as AstNode).callee
		if (!isNode(callee) || nodeType(callee) !== 'MemberExpression') continue
		if (callee.computed) continue
		const prop = callee.property
		if (!isNode(prop) || prop.type !== 'Identifier') continue
		if (String(prop.name) !== 'get') continue
		const object = callee.object
		if (isNode(object) && nodeType(object) === 'Identifier')
			return String(object.name)
	}
	return null
}
