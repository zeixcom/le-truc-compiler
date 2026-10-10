/**
 * Async-boundary arm roots (ADR 0024 sub-design 13, ADR 0037 s4): what
 * counts as an arm root, where the catch message element sits, which
 * construct below a root is unaddressable, and which signal a reactive
 * `truc:html` thunk on a root drives. Shared by pass 4's branch handlers
 * (`analysis/branch-effects.ts`) and the server emitter, which must find
 * the same live-arm child and name the same signal the analysis admitted —
 * homed here, a sibling of `initial-winner.ts`, so the emitter no longer
 * imports the effects subsystem for them (2026-10-10 split). The construct
 * predicates the walks share live in `analysis/construct-effects.ts`.
 */

import {
	directLazyCatchRef,
	hasDeepConstruct,
} from './analysis/construct-effects'
import type { ComposeNode, ElementNode } from './analysis/selectors'
import type { AstNode } from './ast-node'
import { isNode, nodeType } from './ast-utils'
import type { TemplateNode } from './ir'
import { isClientConstructAttr } from './walk'

/**
 * An async-boundary arm root: a plain element, or — since LT-460 — a
 * compose site, whose rendered root is the child's own element.
 */
export type BoundaryArmRoot = ElementNode | ComposeNode

export const isBoundaryArmRoot = (
	node: TemplateNode,
): node is BoundaryArmRoot => node.kind === 'element' || node.kind === 'compose'

/**
 * The err arm's message element (LT-449, compose-aware since LT-460): the
 * first child element of `el` whose direct reactive child reads the catch
 * parameter (bare or a member read) — reached either directly or through
 * one compose hop, inside the composed content (a composed callout's
 * message element: `<CardCallout class="danger"><p class="error">
 * {e.message}</p></CardCallout>`). The text write targets that element
 * through an arm-scoped `first()`. Null when the message sits on the root
 * itself (the depth-0 channel the boundary has always carried). Shared
 * with `emit-server.ts`, which must find the same live-arm child.
 */
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
	// One compose hop: the message element is parent-authored content
	// spliced into the child's rendered markup — still inside the arm root,
	// so the arm-scoped query reaches it (LT-096).
	for (const child of el.children) {
		if (child.kind !== 'compose') continue
		for (const inner of elementChildren(child.children)) {
			if (directLazyCatchRef(inner, catchParam) !== null) return inner
		}
	}
	return null
}

/**
 * The offending construct below an async-boundary arm root, or null.
 * Compose-aware (LT-460): composed content is transparent one level — a
 * parent-authored element in it may carry exactly one lazy child reading
 * the catch parameter (the message element), its own attrs stay static,
 * and no deeper element or second reactive child is allowed. A reactive
 * expression directly inside composed content renders into the child's own
 * markup, where no write can address it — an offender; on a plain element
 * root a direct reactive child stays the sanctioned depth-0 channel.
 */
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
				// Composed content: entered for the message exemption only —
				// a nested composed element is refused at lowering.
				const deeper = visit(child.children, depth + 1)
				if (deeper !== null) return deeper
				continue
			}
			if (child.kind === 'expr' && child.reactivity === 'reactive') {
				// The depth-0 channel: a direct lazy child of a plain element
				// root. Inside composed content it renders into the child's
				// own markup, where no write can address it.
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

/**
 * The signal an async boundary's ok arm reads through a reactive
 * `truc:html={() => name.get()}` thunk on its arm root (LT-449) — the
 * attribute-channel counterpart of a direct lazy identifier child. The
 * thunk must be exactly a `.get()` read; anything else is not a boundary
 * driver. Shared with `emit-server.ts`, which must name the same signal
 * the analysis admitted.
 */
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
