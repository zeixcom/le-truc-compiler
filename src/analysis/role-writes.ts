import {
	type AstNode,
	asArray,
	identifierName,
	isNode,
	nodeType,
} from '../ast-utils'
import { childrenInsertionsOf } from '../children-region'
import { namesDeclaredRole } from '../first-refs'
import type { ComponentIR, TemplateNode } from '../ir'
import type { InternalRegistryEntry } from '../registry'
import { walkTemplate } from '../walk'
import { allComposeNodes, type ComposeNode, refOf } from './selectors'

/* === Types === */

/** The authored binding helpers a role write can come from. */
export type RoleBindHelper =
	| 'bindProperty'
	| 'bindAttribute'
	| 'bindText'
	| 'bindClass'
	| 'bindVisible'
	| 'bindStyle'
	| 'bindAria'

export type RoleWrite = {
	helper: RoleBindHelper
	target:
		| { channel: 'name'; name: string; authored: string }
		| { channel: 'text' }
		| { channel: 'class'; token: string }
		| { channel: 'style'; property: string }
}

/** One authored `watch` binding a declared `first()` reference targets. */
export type WatchBinding = {
	ref: string
	write: RoleWrite
	/** The binding helper call — where the check reports. */
	at: { start?: number | undefined; end?: number | undefined }
}

/** A conflict the compose-site half found, named for the message. */
export type RoleWriterConflict = {
	/** The parent's conflicting binding (the report site). */
	parent: WatchBinding
	childTag: string
	/** The role class the passed element carries. */
	role: string
	/** The child's write it collides with. */
	childWrite: RoleWrite
}

/* === Internal Functions === */

const normalizeWriteName = (name: string): string => {
	if (/^aria[A-Z]/.test(name)) return `aria-${name.slice(4).toLowerCase()}`
	if (name === 'className') return 'class'
	if (name === 'htmlFor') return 'for'
	return name.toLowerCase()
}

const stringLiterals = (node: unknown): string[] =>
	isNode(node) && nodeType(node) === 'ArrayExpression'
		? asArray((node as AstNode).elements)
				.filter(
					element =>
						isNode(element) &&
						nodeType(element) === 'Literal' &&
						typeof element.value === 'string',
				)
				.map(element => String((element as unknown as { value: string }).value))
		: []

/** What a helper call writes, from its arguments after the target ref. */
const writeTargetsOf = (
	helper: RoleBindHelper,
	args: unknown[],
): RoleWrite['target'][] => {
	const arg = args[1]
	if (helper === 'bindVisible')
		return [{ channel: 'name', name: 'hidden', authored: 'hidden' }]
	if (helper === 'bindText') return [{ channel: 'text' }]
	if (
		helper === 'bindProperty' ||
		helper === 'bindAttribute' ||
		helper === 'bindAria'
	) {
		const names =
			isNode(arg) &&
			nodeType(arg) === 'Literal' &&
			typeof arg.value === 'string'
				? [String(arg.value)]
				: helper === 'bindAria'
					? stringLiterals(arg)
					: []
		return names.map(name => ({
			channel: 'name',
			name: normalizeWriteName(name),
			authored: name,
		}))
	}
	// bindClass / bindStyle: a single literal or a list of them.
	const names =
		isNode(arg) && nodeType(arg) === 'Literal' && typeof arg.value === 'string'
			? [String(arg.value)]
			: stringLiterals(arg)
	const channel = helper === 'bindClass' ? 'class' : 'style'
	return names.map(name =>
		channel === 'class'
			? ({ channel: 'class', token: name } as const)
			: ({ channel: 'style', property: name } as const),
	)
}

/* === Exported Functions === */

export const watchBindingsOf = (component: ComponentIR): WatchBinding[] => {
	const helpers: ReadonlySet<string> = new Set<RoleBindHelper>([
		'bindProperty',
		'bindAttribute',
		'bindText',
		'bindClass',
		'bindVisible',
		'bindStyle',
		'bindAria',
	])
	const bindings: WatchBinding[] = []
	for (const stmt of [...component.setup, ...component.clientSetup]) {
		const expr = stmt.node
		if (
			!isNode(expr) ||
			nodeType(expr) !== 'CallExpression' ||
			identifierName((expr as AstNode).callee) !== 'watch'
		)
			continue
		const handler = asArray((expr as AstNode).arguments)[1]
		if (
			!isNode(handler) ||
			nodeType(handler) !== 'CallExpression' ||
			!helpers.has(identifierName((handler as AstNode).callee) ?? '')
		)
			continue
		const helper = identifierName((handler as AstNode).callee) as RoleBindHelper
		const helperArgs = asArray((handler as AstNode).arguments)
		const targetArg = helperArgs[0]
		if (
			!isNode(targetArg) ||
			nodeType(targetArg) !== 'Identifier' ||
			!component.firstRefs.has(String(targetArg.name))
		)
			continue
		for (const target of writeTargetsOf(helper, helperArgs))
			bindings.push({
				ref: String(targetArg.name),
				write: { helper, target },
				at: { start: handler.start, end: handler.end },
			})
	}
	return bindings
}

export const subjectRolesOf = (
	selectorList: string,
	roles: ReadonlySet<string>,
): string[] => {
	if (roles.size === 0) return []
	const found: string[] = []
	for (const branch of selectorList.split(',')) {
		// The subject compound starts after the last combinator.
		const subject =
			branch
				.trim()
				.split(/[\s>+~]+/)
				.pop() ?? ''
		for (const token of subject.split('.')) {
			const name = token.trim()
			if (name !== '' && roles.has(name) && !found.includes(name))
				found.push(name)
		}
	}
	return found
}

export const roleWritesOf = (
	component: ComponentIR,
): Record<string, RoleWrite[]> | null => {
	const roles = component.childrenContract?.roles
	if (!roles || roles.size === 0) return null
	const insertions = childrenInsertionsOf(component.root)
	const inserts =
		insertions.holders.size > 0 ||
		insertions.forwards.size > 0 ||
		insertions.unmarked
	if (!inserts) return null
	const roleSet = new Set(roles.keys())
	const claimedDeferred = new Set(
		allComposeNodes(component.root)
			.map(node => refOf(node)?.name)
			.filter((name): name is string => name !== undefined),
	)
	const byRole: Record<string, RoleWrite[]> = {}
	for (const binding of watchBindingsOf(component)) {
		const ref = component.firstRefs.get(binding.ref)
		if (!ref) continue
		if (
			ref.stage === 'deferred'
				? claimedDeferred.has(binding.ref)
				: ref.stage !== 'unmatched'
		)
			continue
		if (namesDeclaredRole(ref.selector, roleSet) !== true) continue
		for (const role of subjectRolesOf(ref.selector, roleSet)) {
			const writes = byRole[role] ?? []
			writes.push(binding.write)
			byRole[role] = writes
		}
	}
	return Object.keys(byRole).length > 0 ? byRole : null
}

export const findRoleWriterConflicts = (
	component: ComponentIR,
	composeRegistry: ReadonlyMap<string, InternalRegistryEntry>,
): RoleWriterConflict[] => {
	const bindings = watchBindingsOf(component)
	if (bindings.length === 0) return []
	const findings: RoleWriterConflict[] = []
	for (const node of allComposeNodes(component.root)) {
		if (node.children.length === 0) continue
		const child = composeRegistry.get(node.source)
		if (!child?.roleWrites) continue
		for (const [ref, element] of contentRefsOf(node)) {
			const classes = classTokensOf(element)
			if (classes.length === 0) continue
			for (const binding of bindings) {
				if (binding.ref !== ref) continue
				for (const role of classes) {
					const childWrites = child.roleWrites[role]
					if (!childWrites) continue
					const hit = childWrites.find(write =>
						conflictsWith(binding.write, write),
					)
					if (hit)
						findings.push({
							parent: binding,
							childTag: child.tag,
							role,
							childWrite: hit,
						})
				}
			}
		}
	}
	return findings
}

const contentRefsOf = (
	node: ComposeNode,
): Map<string, Extract<TemplateNode, { kind: 'element' }>> => {
	const refs = new Map<string, Extract<TemplateNode, { kind: 'element' }>>()
	for (const child of node.children)
		walkTemplate(
			child,
			inner => {
				if (inner.kind !== 'element') return
				const name = refOf(inner)?.name
				if (name !== undefined && !refs.has(name)) refs.set(name, inner)
			},
			{ intoCompose: false },
		)
	return refs
}

/** The static class attribute's tokens — the role-class carrier. */
const classTokensOf = (
	element: Extract<TemplateNode, { kind: 'element' }>,
): string[] => {
	for (const attr of element.attrs)
		if (attr.kind === 'static' && attr.name === 'class' && attr.value)
			return attr.value.split(/\s+/).filter(Boolean)
	return []
}

const WHOLE_TEXT_NAMES: ReadonlySet<string> = new Set([
	'textcontent',
	'innertext',
	'innerhtml',
])

const conflictsWith = (parent: RoleWrite, child: RoleWrite): boolean => {
	const a = parent.target
	const b = child.target
	if (a.channel === 'name' && b.channel === 'name') return a.name === b.name
	type NameTarget = Extract<RoleWrite['target'], { channel: 'name' }>
	const whole: NameTarget | null =
		a.channel === 'name' ? a : b.channel === 'name' ? b : null
	if (!whole) {
		if (a.channel !== b.channel) return false
		if (a.channel === 'text') return true
		if (a.channel === 'class' && b.channel === 'class')
			return a.token === b.token
		if (a.channel === 'style' && b.channel === 'style')
			return a.property === b.property
		return false
	}
	// One side is the whole-attribute write; the other is the partial kind.
	const partial: RoleWrite['target'] = a.channel === 'name' ? b : a
	switch (partial.channel) {
		case 'class':
			return whole.name === 'class'
		case 'style':
			return whole.name === 'style'
		case 'text':
			return WHOLE_TEXT_NAMES.has(whole.name)
		default:
			return false
	}
}
