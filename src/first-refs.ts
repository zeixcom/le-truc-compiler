import * as cssWhat from 'css-what'
import { type AstNode, isNode } from './ast-utils'
import { diagnostic, type LocalDiagnostic, type Site } from './diagnostics'
import type { FirstRefDecl, TemplateNode } from './ir'
import {
	childNodes,
	elseOf,
	type IfNode,
	isIf,
	someNode,
	thenOf,
	walkTemplate,
} from './walk'

/* === Types === */

export type ElementNode = Extract<TemplateNode, { kind: 'element' }>

/** One `.class`/`#id`/`[attr]`/`[attr="value"]` clause, or a bare tag name. */
type SimpleSelector = {
	tag: string | null
	id: string | null
	classes: string[]
	attrs: Array<{ name: string; value: string | null }>
}

/** A `.token`/`#id` spelling safe to verify as a bare identifier. */
const PLAIN_SELECTOR_TOKEN = /^[A-Za-z_-][\w-]*$/

/* === Internal Functions === */

/** Static attributes of an element as a map (mirrors `analysis/selectors.ts`). */
const staticAttrs = (element: ElementNode): Map<string, string | null> => {
	const map = new Map<string, string | null>()
	for (const attr of element.attrs)
		if (attr.kind === 'static') map.set(attr.name, attr.value)
	return map
}

const parseSimpleSelector = (selector: string): SimpleSelector | null => {
	const trimmed = selector.trim()
	if (trimmed === '') return null
	let branches
	try {
		branches = cssWhat.parse(trimmed)
	} catch {
		return null
	}
	const compound = branches[0]
	if (branches.length !== 1 || !compound || compound.length === 0) return null
	let tag: string | null = null
	let id: string | null = null
	const classes: string[] = []
	const attrs: Array<{ name: string; value: string | null }> = []
	for (const [index, simple] of compound.entries()) {
		if (simple.type === 'tag') {
			if (index !== 0 || simple.namespace !== null) return null
			if (!/^[a-z][a-z0-9-]*$/.test(simple.name)) return null
			tag = simple.name
		} else if (simple.type === 'attribute') {
			if (simple.namespace !== null || simple.ignoreCase === true) return null
			if (simple.action === 'element') {
				if (simple.name !== 'class' || !PLAIN_SELECTOR_TOKEN.test(simple.value))
					return null
				classes.push(simple.value)
			} else if (
				simple.action === 'equals' &&
				simple.name === 'id' &&
				simple.ignoreCase === 'quirks'
			) {
				if (!PLAIN_SELECTOR_TOKEN.test(simple.value)) return null
				// Last wins, exactly as the old clause loop overwrote `id`.
				id = simple.value
			} else if (simple.action === 'equals' || simple.action === 'exists') {
				if (!/^[a-zA-Z_-][\w-]*$/.test(simple.name)) return null
				if (simple.action === 'equals' && simple.value.includes('"'))
					return null
				attrs.push({
					name: simple.name,
					value: simple.action === 'equals' ? simple.value : null,
				})
			} else {
				// `^=`/`$=`/… — operators the subset never verified.
				return null
			}
		} else {
			return null
		}
	}
	if (leavesSimpleSubset(trimmed)) return null
	return { tag, id, classes, attrs }
}

const leavesSimpleSubset = (trimmed: string): boolean => {
	let quote: string | null = null
	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i] as string
		if (quote) {
			if (char === '\\') i++
			else if (char === quote) quote = null
			continue
		}
		if (char === '"') {
			quote = char
			continue
		}
		if (/\s/.test(char) || char === "'") return true
		if (char === '=' && trimmed[i + 1] !== '"') return true
	}
	return false
}

const matchesSimpleSelector = (
	candidate: { tag: string; attrs: ReadonlyMap<string, string | null> },
	parsed: SimpleSelector,
): boolean => {
	if (parsed.tag && candidate.tag !== parsed.tag) return false
	const attrs = candidate.attrs
	if (parsed.id !== null && attrs.get('id') !== parsed.id) return false
	if (parsed.classes.length > 0) {
		const classList = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean)
		if (!parsed.classes.every(c => classList.includes(c))) return false
	}
	for (const attr of parsed.attrs) {
		if (!attrs.has(attr.name)) return false
		if (attr.value !== null && attrs.get(attr.name) !== attr.value) return false
	}
	return true
}

export const matchesAuthoredSelectorOn = (
	candidate: { tag: string; attrs: ReadonlyMap<string, string | null> },
	selectorList: string,
): boolean | null => {
	let anyUnsupported = false
	for (const branch of selectorList.split(',')) {
		const parsed = parseSimpleSelector(branch)
		if (!parsed) {
			anyUnsupported = true
			continue
		}
		if (matchesSimpleSelector(candidate, parsed)) return true
	}
	return anyUnsupported ? null : false
}

/* === Exported Functions === */

export const collectMatchingElements = (
	root: ElementNode,
	selectorList: string,
): { elements: ElementNode[]; unsupported: boolean } => {
	const elements: ElementNode[] = []
	let unsupported = false
	walkTemplate(root, node => {
		if (node.kind !== 'element') return
		const result = matchesAuthoredSelectorOn(
			{ tag: node.tag, attrs: staticAttrs(node) },
			selectorList,
		)
		if (result === null) unsupported = true
		else if (result) elements.push(node)
	})
	return { elements, unsupported }
}

export const namesCustomElementTag = (selectorList: string): boolean =>
	selectorList
		.split(',')
		.some(branch => parseSimpleSelector(branch)?.tag?.includes('-') === true)

export const namesDeclaredRole = (
	selectorList: string,
	roles: ReadonlySet<string>,
): boolean | null => {
	if (roles.size === 0) return false
	let branches
	try {
		branches = cssWhat.parse(selectorList.trim())
	} catch {
		return null
	}
	for (const branch of branches) {
		// The subject compound starts after the last combinator entry.
		let start = 0
		for (const [index, simple] of branch.entries())
			if (
				simple.type === 'descendant' ||
				simple.type === 'child' ||
				simple.type === 'sibling' ||
				simple.type === 'adjacent' ||
				simple.type === 'parent'
			)
				start = index + 1
		for (const simple of branch.slice(start))
			if (
				simple.type === 'attribute' &&
				simple.name === 'class' &&
				simple.action === 'element' &&
				roles.has(simple.value)
			)
				return true
	}
	return false
}

const enclosingIfIn = (
	root: ElementNode,
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
		if (node.kind !== 'element') return null
		for (const child of node.children) {
			const found = walk(child)
			if (found) return found
		}
		return null
	}
	return walk(root)
}

export const shareExclusiveIf = (
	root: ElementNode,
	elements: ElementNode[],
): boolean => {
	if (elements.length < 2) return true
	const [first, ...rest] = elements.map(el => enclosingIfIn(root, el))
	if (!first || rest.some(e => e !== first)) return false
	const inThen = elements.filter(el => thenOf(first).includes(el))
	const inAlternate = elements.filter(el => elseOf(first).includes(el))
	return (
		inThen.length <= 1 &&
		inAlternate.length <= 1 &&
		inThen.length + inAlternate.length === elements.length
	)
}

export type DuplicatedChannelsCheck = {
	root: TemplateNode
	source: string
	diagnostics: LocalDiagnostic[]
	argNames: ReadonlySet<string>
	parserProps: ReadonlySet<string>
	parserFactoryOf: (prop: string) => string
	parserFallbackRefsOf: (prop: string) => ReadonlySet<string>
	/** `value` or `checked` if `config.form` names it (LT-141); else `null`. */
	formResetProp: string | null
}

export const reportDuplicatedChannels = ({
	root,
	source,
	diagnostics,
	argNames,
	parserProps,
	parserFactoryOf,
	parserFallbackRefsOf,
	formResetProp,
}: DuplicatedChannelsCheck): void => {
	if (parserProps.size === 0 || argNames.size === 0) return
	const named = (expr: AstNode): string | null => {
		if (!isNode(expr) || expr.type !== 'Identifier') return null
		const name = String(expr.name)
		return argNames.has(name) && parserProps.has(name) ? name : null
	}
	const rootHasBaselineAttr =
		formResetProp !== null &&
		root.kind === 'element' &&
		root.attrs.some(a => a.kind === 'server' && a.name === formResetProp)
	const report = (prop: string, at: Site): void => {
		diagnostics.push(
			diagnostic.duplicatedPropChannel(
				source,
				at,
				prop,
				parserFactoryOf(prop),
				prop === formResetProp,
			),
		)
	}
	const refNameOf = (
		node: TemplateNode & { kind: 'element' },
	): string | null => {
		for (const attr of node.attrs) if (attr.kind === 'ref') return attr.name
		return null
	}
	/** The override shape: this prop's Parser fallback reads THIS element. */
	const isSanctionedOverride = (
		prop: string,
		element: (TemplateNode & { kind: 'element' }) | null,
	): boolean => {
		const refName = element ? refNameOf(element) : null
		return refName !== null && parserFallbackRefsOf(prop).has(refName)
	}
	walkTemplate(root, (node, parent) => {
		if (node.kind === 'expr') {
			const prop = named(node.expr)
			if (
				prop &&
				!isSanctionedOverride(
					prop,
					parent?.kind === 'element' ? parent : null,
				) &&
				!(prop === formResetProp && rootHasBaselineAttr)
			)
				report(prop, node.node)
			return
		}
		if (node.kind !== 'element' || node === root) return
		for (const attr of node.attrs) {
			if (attr.kind !== 'server') continue
			const prop = named(attr.node)
			if (
				prop &&
				!isSanctionedOverride(prop, node) &&
				!(prop === formResetProp && rootHasBaselineAttr)
			)
				report(prop, attr.node)
		}
	})
}

export const reportStaticIds = (
	root: TemplateNode,
	source: string,
	diagnostics: LocalDiagnostic[],
): void => {
	walkTemplate(root, node => {
		if (node.kind !== 'element') return
		for (const attr of node.attrs)
			if (attr.kind === 'static' && attr.name === 'id' && attr.value)
				diagnostics.push(
					diagnostic.staticIdInTemplate(
						source,
						node.node,
						node.tag,
						attr.value,
					),
				)
	})
}

export const refBranchGuard = (
	root: TemplateNode,
	refName: string,
): string | null => {
	const found: string[][] = []
	let bailed = false
	const carriesRef = (node: TemplateNode): boolean =>
		(node.kind === 'element' || node.kind === 'compose') &&
		node.attrs.some(a => a.kind === 'ref' && a.name === refName)
	const walk = (node: TemplateNode, guards: readonly string[]): void => {
		if (bailed) return
		if (carriesRef(node)) found.push([...guards])
		if (isIf(node) && node.mode === 'server') {
			for (const child of thenOf(node))
				walk(child, [...guards, `(${node.testText})`])
			for (const child of elseOf(node))
				walk(child, [...guards, `!(${node.testText})`])
			return
		}
		if (node.kind === 'conditional' || node.kind === 'try') {
			if (someNode(node, carriesRef)) bailed = true
			return
		}
		for (const child of childNodes(node)) walk(child, guards)
	}
	walk(root, [])
	if (bailed || found.length > 1) return null
	if (found.length === 0) return 'false'
	const guards = found[0] as string[]
	return guards.length === 0 ? 'true' : guards.join(' && ')
}

export const inOptionalBranch = (
	root: TemplateNode,
	target: TemplateNode,
): boolean => {
	let found = false
	const walk = (node: TemplateNode, optional: boolean): void => {
		if (found) return
		if (node === target) {
			found = optional
			return
		}
		if (isIf(node) && node.mode === 'server') {
			const single = elseOf(node).length === 0
			for (const child of thenOf(node)) walk(child, optional || single)
			for (const child of elseOf(node)) walk(child, optional)
			return
		}
		for (const child of childNodes(node)) walk(child, optional)
	}
	walk(root, false)
	return found
}

export const inReactiveArm = (
	root: TemplateNode,
	target: TemplateNode,
): boolean => {
	let found = false
	walkTemplate(root, node => {
		if (found || node.kind !== 'conditional' || node.mode !== 'reactive') return
		found = node.arms.some(arm =>
			arm.children.some(child => someNode(child, n => n === target)),
		)
	})
	return found
}

export const inReconcileItem = (
	outputs: readonly TemplateNode[],
	target: TemplateNode,
): boolean => outputs.some(output => someNode(output, n => n === target))

export const declaredRefNames = (
	firstRefs: ReadonlyMap<string, FirstRefDecl>,
): Set<string> =>
	new Set(
		[...firstRefs.values()]
			.filter(ref => ref.stage !== 'rejected' || !ref.required)
			.map(ref => ref.name),
	)
