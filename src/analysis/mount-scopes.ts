import { type AstNode, freeIdentifiers, sanitizeVarName } from '../ast-utils'
import { diagnostic } from '../diagnostics'
import type {
	AttributeIR,
	EachForIR,
	ReconcileForIR,
	TemplateNode,
} from '../ir'
import { wordingOf } from '../surface'
import {
	childNodes,
	isClientConstructAttr,
	someNode,
	walkTemplate,
} from '../walk'
import {
	handleAsyncBoundary,
	handleReactiveConditional,
} from './branch-effects'
import {
	composeSiteSelector,
	ownHandlersOf,
	planComposeHandlers,
} from './compose-effects'
import {
	checkPassEntries,
	emitConstructEffects,
	emitPassEntries,
	hasOwnConstruct,
} from './construct-effects'
import type { EffectsContext } from './effects'
import { loopFor, resolveSelector } from './effects'
import { planEachLoop } from './loops'
import { uniqueName } from './naming'
import type {
	KeyAttrPlan,
	ReconcilePlan,
	ScopeLocal,
	TopEffectPlan,
} from './plan'
import {
	type ComposeNode,
	type ElementNode,
	isElement,
	refOf,
	resolveScopedSelector,
} from './selectors'

type MountScopesContext = Pick<
	EffectsContext,
	| 'component'
	| 'source'
	| 'diagnostics'
	| 'ambient'
	| 'routingSignals'
	| 'suppressedSites'
	| 'registry'
	| 'composeRefs'
	| 'queries'
	| 'effects'
	| 'usedNames'
	| 'addQuery'
	| 'collectAmbient'
	| 'badFreeNames'
	| 'badListBodyNames'
	| 'childTags'
	| 'itemNames'
	| 'keyNames'
	| 'scopeBadNames'
	| 'entryByTag'
	| 'armSelectors'
	| 'derivableHostProps'
	| 'derivableRefGuards'
	| 'foldScope'
	| 'handledComposes'
	| 'reconcilePlans'
>

export type MountScope = {
	/** The scope root element: the arm root, the item root. */
	root: ElementNode
	/** The root's local; naming it declares it in the mount. */
	rootRef: () => string
	localFor: (el: ElementNode, optional?: boolean) => string
	/** Is the local `name` an optional (non-throwing) query? */
	isOptional: (name: string) => boolean
	/** The scope's effects, in document order. */
	sink: TopEffectPlan[]
	/** The scope's key-derived attributes. */
	keyAttrs: KeyAttrPlan[]
	/** How diagnostics name the scope root (`the arm root <section>`). */
	label: string
}

export const mountScope = (
	fx: MountScopesContext,
	init: {
		root: ElementNode
		rootRef: () => string
		locals: ScopeLocal[]
		sink: TopEffectPlan[]
		keyAttrs: KeyAttrPlan[]
		label: string
	},
): MountScope => {
	const { component, source, diagnostics, usedNames } = fx
	const names = new Map<ElementNode, string>()
	return {
		root: init.root,
		rootRef: init.rootRef,
		sink: init.sink,
		keyAttrs: init.keyAttrs,
		label: init.label,
		isOptional: name =>
			init.locals.some(local => local.name === name && local.optional),
		localFor: (el, optional = false) => {
			if (el === init.root) return init.rootRef()
			const known = names.get(el)
			if (known) {
				if (!optional) {
					const local = init.locals.find(l => l.name === known)
					if (local?.optional) delete local.optional
				}
				return known
			}
			const scoped = resolveScopedSelector(
				init.root,
				el,
				component.composedShapes,
			)
			if (!scoped.unique)
				diagnostics.push(
					diagnostic.unaddressableElement(
						source,
						el.node,
						`No unique selector for <${el.tag}> inside ${init.label} — no \`class\`, \`role\`, \`data-*\` attribute or child path tells it apart from the other elements there, nested arms and list items included. Give it a unique \`class\`.`,
					),
				)
			const name = uniqueName(usedNames, sanitizeVarName(el.tag))
			names.set(el, name)
			init.locals.push({
				name,
				selector: scoped.selector,
				message: `${component.tag}: ${scoped.selector} missing`,
				...(optional ? { optional: true } : {}),
			})
			fx.armSelectors.set(name, resolveSelector(fx, el).selector)
			return name
		},
	}
}

const holderOf = (
	fx: MountScopesContext,
	target: TemplateNode,
): ElementNode | null => {
	const find = (
		node: TemplateNode,
		holder: ElementNode | null,
	): ElementNode | null | undefined => {
		if (node === target) return holder
		const next = isElement(node) ? node : holder
		for (const child of childNodes(node)) {
			const found = find(child, next)
			if (found !== undefined) return found
		}
		return undefined
	}
	return find(fx.component.root, null) ?? null
}

export const planNested = (
	fx: MountScopesContext,
	scope: MountScope,
	node: TemplateNode,
	inBranch = false,
): boolean => {
	if (node.kind === 'conditional' && node.mode === 'reactive') {
		handleReactiveConditional(fx, node, scope)
		return true
	}
	if (node.kind === 'try' && node.pendingChildren !== null) {
		handleAsyncBoundary(fx, node, scope)
		return true
	}
	if (!isElement(node)) return false
	const loop = loopFor(fx, node)
	if (!loop) return false
	if (loop.kind === 'reconcile') planNestedList(fx, loop, scope, inBranch)
	else planNestedEach(fx, loop, scope)
	return true
}

const planNestedList = (
	fx: MountScopesContext,
	loop: ReconcileForIR,
	scope: MountScope,
	inBranch = false,
): void => {
	const plan = fx.reconcilePlans.get(loop)
	if (!plan) return
	const container = holderOf(fx, loop.output)
	if (container === null) return
	plan.container = scope.localFor(container, inBranch)
	fx.ambient.add('host')
	plan.emptyQueries = (loop.emptyArm ?? [])
		.filter(isElement)
		.map(root => scope.localFor(root, inBranch))
	if (inBranch) plan.inBranch = true
	planReconcileItem(fx, loop, plan)
	scope.sink.push({ kind: 'reconcile', for: plan })
}

const planNestedEach = (
	fx: MountScopesContext,
	loop: EachForIR,
	scope: MountScope,
): void => {
	const plan = planEachLoop(fx, loop, { root: '', tree: scope.root })
	if (!plan?.scoped) return
	plan.scoped.root = scope.rootRef()
	scope.sink.push({ kind: 'each', for: plan })
}

const keyAttrsOf = (
	fx: MountScopesContext,
	el: ElementNode,
): Array<Extract<AttributeIR, { kind: 'server' }>> =>
	fx.keyNames.size === 0
		? []
		: el.attrs.filter(
				(attr): attr is Extract<AttributeIR, { kind: 'server' }> => {
					if (attr.kind !== 'server' || attr.bindsProp != null) return false
					const free = [...freeIdentifiers(attr.node)]
					return free.length > 0 && free.every(n => fx.keyNames.has(n))
				},
			)

export const collectKeyAttrs = (
	fx: MountScopesContext,
	scope: MountScope,
	el: ElementNode,
	inBranch = false,
): void => {
	for (const attr of keyAttrsOf(fx, el)) {
		const local = scope.localFor(el, inBranch)
		scope.keyAttrs.push({
			el: local,
			...(scope.isOptional(local) ? { optional: true } : {}),
			attr: attr.name,
			exprText: attr.exprText,
			sourceStart: attr.node.start,
			sourceEnd: attr.node.end,
		})
	}
}

export const collectBranchKeyAttrs = (
	fx: MountScopesContext,
	scope: MountScope,
	node: TemplateNode,
): void => {
	if (isElement(node)) {
		if (loopFor(fx, node)) return
		collectKeyAttrs(fx, scope, node, true)
		for (const child of node.children) collectBranchKeyAttrs(fx, scope, child)
		return
	}
	if (node.kind === 'conditional' && node.mode === 'server')
		for (const arm of node.arms)
			for (const child of arm.children) collectBranchKeyAttrs(fx, scope, child)
}

export const unmountableInArm = (node: TemplateNode): string | null => {
	const carriesConstruct = (n: TemplateNode): boolean =>
		n.kind === 'client-stmt' ||
		(n.kind === 'expr' && n.reactivity === 'reactive') ||
		(n.kind === 'element' && n.attrs.some(isClientConstructAttr))
	if (
		(node.kind === 'conditional' || node.kind === 'try') &&
		someNode(node, carriesConstruct)
	)
		return 'A client construct in a nested control-flow branch'
	if (
		node.kind === 'compose' &&
		node.attrs.some(a => a.kind === 'pass' || a.kind === 'ref')
	)
		return 'A composed element read through `first()` or `truc:pass`'
	return null
}

/** Is `holder` a reactive list's container (LTC063's question)? */
const isReconcileContainer = (
	fx: MountScopesContext,
	holder: ElementNode,
): boolean =>
	[...fx.component.fors.values()].some(
		loop => loop.kind === 'reconcile' && holderOf(fx, loop.output) === holder,
	)

export const armContainer = (
	fx: MountScopesContext,
	node: TemplateNode & { node: AstNode },
	noun: string,
	scope: MountScope | null,
): string | null => {
	const { component, source, diagnostics, addQuery } = fx
	const wording = wordingOf(component)
	let container: TemplateNode | null = null
	walkTemplate(component.root, (current, parent) => {
		if (current === node) container = parent
	})
	const holder = container as TemplateNode | null
	if (holder === null || holder.kind !== 'element') return null
	if (isReconcileContainer(fx, holder)) {
		diagnostics.push(
			diagnostic.reactiveConditionInReconcileContainer(
				source,
				node.node,
				node.kind === 'try' ? 'try' : 'conditional',
				wording,
			),
		)
		return null
	}
	if (scope !== null) return scope.localFor(holder)
	if (holder === component.root) {
		fx.ambient.add('host')
		return 'host'
	}
	const resolved = resolveSelector(fx, holder)
	if (!resolved.unique) {
		diagnostics.push(
			diagnostic.unaddressableElement(
				source,
				holder.node,
				`No unique selector for <${holder.tag}>, which holds ${noun} — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
			),
		)
		return null
	}
	return addQuery(
		refOf(holder)?.name ?? sanitizeVarName(holder.tag),
		resolved.selector,
		'one',
	)
}

export const planReconcileItem = (
	fx: MountScopesContext,
	loop: ReconcileForIR,
	plan: ReconcilePlan,
): void => {
	const { component, source, diagnostics, usedNames } = fx
	const output = loop.output
	const wording = wordingOf(component)
	const saved = {
		itemNames: fx.itemNames,
		keyNames: fx.keyNames,
		scopeBadNames: fx.scopeBadNames,
	}
	const setupNames = loop.setup.flatMap(stmt =>
		stmt.name === null ? [] : [stmt.name],
	)
	const consts = loop.setup.flatMap(stmt =>
		stmt.kind === 'const' ? [stmt.name] : [],
	)
	fx.itemNames = new Set([
		...saved.itemNames,
		loop.itemName,
		...(loop.keyName ? [loop.keyName] : []),
		...setupNames,
	])
	fx.keyNames = new Set([
		...saved.keyNames,
		...(loop.keyName ? [loop.keyName] : []),
		...consts,
	])
	fx.scopeBadNames = fx.badListBodyNames
	const badNames = fx.badListBodyNames
	try {
		let rootName: string | null = null
		const item = plan.itemScope
		const scope = mountScope(fx, {
			root: output,
			rootRef: () => {
				if (rootName === null) {
					rootName = uniqueName(usedNames, sanitizeVarName(output.tag))
					item.root = { name: rootName, tag: output.tag }
				}
				return rootName
			},
			locals: item.locals,
			sink: item.effects,
			keyAttrs: item.keyAttrs,
			label: `the ${wording.loop} item <${output.tag}>`,
		})

		const keyAttrSites: Array<{ el: ElementNode; inBranch: boolean }> = []
		const collectKeySites = (node: TemplateNode, inBranch: boolean): void => {
			if (isElement(node)) {
				if (node !== output && loopFor(fx, node)) return
				if (keyAttrsOf(fx, node).length > 0)
					keyAttrSites.push({ el: node, inBranch })
				for (const child of node.children) collectKeySites(child, inBranch)
				return
			}
			if (node.kind === 'conditional' && node.mode === 'server')
				for (const arm of node.arms)
					for (const child of arm.children) collectKeySites(child, true)
		}
		collectKeySites(output, false)

		// The item root's own constructs.
		if (hasOwnConstruct(output))
			emitConstructEffects(
				fx,
				output,
				scope.localFor(output),
				item.effects,
				badNames,
			)

		const visitElements = (node: TemplateNode, inBranch = false): void => {
			if (node !== output && planNested(fx, scope, node, inBranch)) return
			if (isElement(node)) {
				if (node !== output && hasOwnConstruct(node)) {
					if (inBranch)
						diagnostics.push(
							diagnostic.unsupported(
								source,
								node.node,
								`A client construct on an element in a server-rendered branch of the ${wording.loop} item <${output.tag}>`,
								'The branch folds once per render and every clone copies the fold, so the construct would address markup that never re-renders — make the condition reactive: the item then plans an arm set with live switching and existence-guarded binding.',
							),
						)
					else
						emitConstructEffects(
							fx,
							node,
							scope.localFor(node),
							item.effects,
							badNames,
						)
				}
				for (const child of node.children) visitElements(child, inBranch)
				return
			}
			if (node.kind === 'compose') {
				collectCompose(node, inBranch)
				return
			}
			if (node.kind === 'conditional' && node.mode === 'server')
				for (const arm of node.arms)
					for (const child of arm.children) visitElements(child, true)
		}

		function collectCompose(node: ComposeNode, inBranch = false): void {
			const passAttrs = node.attrs.filter(
				(a): a is Extract<(typeof node.attrs)[number], { kind: 'pass' }> =>
					a.kind === 'pass',
			)
			const handlers = ownHandlersOf(node)
			if (passAttrs.length === 0 && handlers.length === 0) return
			if (fx.composeRefs.mode === 'skipped') return
			if (inBranch && passAttrs.length > 0) {
				diagnostics.push(
					diagnostic.unsupported(
						source,
						node.node,
						`A \`truc:pass\` onto a composed child in a server-rendered branch of the ${wording.loop} item <${output.tag}>`,
						'The branch folds once per render and every clone copies the fold, so the pass would address markup that never re-renders — make the condition reactive: the item then plans an arm set with live switching, and the composed child renders as its arm’s root.',
					),
				)
				return
			}
			const childTag = fx.composeRefs.registry.get(node.source)?.tag ?? null
			if (!childTag) {
				diagnostics.push(
					diagnostic.composedComponentNotCompiled(
						source,
						node.node,
						node.component,
						node.source,
					),
				)
				return
			}
			const site = composeSiteSelector(
				fx,
				output,
				childTag,
				node,
				'truc:pass and handler args need a unique target',
				`${wording.loop} item`,
			)
			if ('refusal' in site) {
				diagnostics.push(
					diagnostic.unaddressableElement(source, node.node, site.refusal),
				)
				return
			}
			const { selector } = site
			planComposeHandlers(
				fx,
				node,
				selector,
				(placement, optional, base) => {
					const local = uniqueName(usedNames, base)
					item.locals.push({
						name: local,
						selector: placement,
						message: `${component.tag}: ${placement} missing`,
						...(inBranch || optional ? { optional: true } : {}),
					})
					return local
				},
				item.effects,
				badNames,
			)
			if (passAttrs.length === 0) return
			const name = uniqueName(usedNames, sanitizeVarName(childTag))
			item.locals.push({
				name,
				selector,
				message: `${component.tag}: ${selector} missing`,
			})
			if (childTag !== component.tag && fx.registry.has(childTag))
				fx.childTags.add(childTag)
			const entries = passAttrs.flatMap(a => a.entries)
			checkPassEntries(fx, entries, childTag, node.node)
			emitPassEntries(fx, entries, name, item.effects, badNames)
		}
		visitElements(output)

		// The key-derived attributes, with the locals their sites claimed.
		for (const { el, inBranch } of keyAttrSites)
			collectKeyAttrs(fx, scope, el, inBranch)
	} finally {
		fx.itemNames = saved.itemNames
		fx.keyNames = saved.keyNames
		fx.scopeBadNames = saved.scopeBadNames
	}
}
