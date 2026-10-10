/**
 * Mount Scopes (ADR 0046 s1, LT-424; 2026-10-10 split): an arm of an arm
 * set or a reactive-list item — an element subtree with its own mount and
 * its own `first` — addressed through `mountScope` and planned by
 * `planReconcileItem`, with the nested-scope planning (`planNested`), the
 * key-derived attributes, and the container addressing the arm sets switch
 * in (`armContainer`).
 *
 * Dependency shape: this module and `branch-effects.ts` call into each
 * other (`planNested` re-runs the branch handlers inside a scope; they plan
 * nested scopes back through it), and both import effects.ts's selector
 * adapters while its walk driver calls `planReconcileItem`. Every
 * cross-call on those edges sits inside a function body, so no cycle
 * resolves at module load.
 */

import type { AstNode } from '../ast-node'
import { freeIdentifiers, sanitizeVarName } from '../ast-utils'
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

/**
 * The context scope planning reads — its own fields plus everything the
 * forwarded calls need (the branch handlers `planNested` re-runs,
 * `emitConstructEffects`, the compose planners). The full pass context
 * satisfies it structurally (ADR 0040 s5).
 */
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

/**
 * A Mount Scope other than the host (ADR 0046 s1): an arm of an arm set or a
 * reactive-list item — an element subtree with its own mount and its own
 * `first`, bound to its root. Every construct inside it emits into its sink
 * through its locals (LT-424: recursive emission), and a construct that is a
 * scope of its own — a nested arm set, a nested list's item — plans into a
 * scope of its own the same way. `null` stands for the host scope, whose
 * addressing is the factory's queries.
 */
export type MountScope = {
	/** The scope root element: the arm root, the item root. */
	root: ElementNode
	/** The root's local; naming it declares it in the mount. */
	rootRef: () => string
	/**
	 * The local naming `el` inside the scope (memoized; the root's own for
	 * the root), queried once per mount through the scope's `first` with a
	 * selector proved within the scope root. `optional` mints a
	 * non-throwing query (an element in a server-rendered branch); a later
	 * required request for the same element makes it required.
	 */
	localFor: (el: ElementNode, optional?: boolean) => string
	/** Is the local `name` an optional (non-throwing) query? */
	isOptional: (name: string) => boolean
	/** The scope's effects, in document order. */
	sink: TopEffectPlan[]
	/** The scope's key-derived attributes (ADR 0046 s1). */
	keyAttrs: KeyAttrPlan[]
	/** How diagnostics name the scope root (`the arm root <section>`). */
	label: string
}

/**
 * A scope's addressing over its plan's locals: descendants by selectors
 * proved within the root (`resolveScopedSelector` — a nested scope's
 * possible content counts, and a `:scope >` child path is synthesized when
 * no class, role or `data-*` tells the element apart), the root through
 * `rootRef`. A failed proof is LTC007, whose fix is a unique class.
 */
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

/**
 * The nearest element holding `target` (control flow is transparent in the
 * DOM), or null at the template root.
 */
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

/**
 * A construct that is a Mount Scope of its own, or a loop, met while
 * planning `scope` (LT-424): plan it into the scope's sink through the
 * scope's locals and report true, so the caller does not descend. False for
 * everything else. `inBranch`: `node` sits in a server-rendered conditional
 * branch of the scope (an item's walk descends there; a reactive conditional
 * or boundary below one is refused), so a nested list's container may be
 * absent from the rendered markup (LT-455).
 */
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

/**
 * A reactive list nested in a Mount Scope (ADR 0046 s1–s2): its container
 * and its `@empty` roots are the scope's locals, and its item is a Mount
 * Scope of its own. The container may be the scope root itself: the
 * extracted template sits at the host's end and is queried from the host.
 * `inBranch`: the container sits in a server-rendered branch of the scope
 * (LT-455) — the branch folds per render call, the same for every clone,
 * but may leave the list out, so the container and `@empty` locals are
 * non-throwing queries and the mount binds under an `if` on the container.
 */
const planNestedList = (
	fx: MountScopesContext,
	loop: ReconcileForIR,
	scope: MountScope,
	inBranch = false,
): void => {
	const plan = fx.reconcilePlans.get(loop)
	if (!plan) return
	// A nested list's output always has an element above it: the scope root
	// at the shallowest.
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

/**
 * A server-data loop nested in a Mount Scope (ADR 0046 s2, LT-424): its items
 * are fixed for the life of the clone, so it lowers to a static query
 * against the scope root — no `all()`, no MutationObserver.
 */
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

/**
 * Key-derived attributes on `el` (ADR 0046 s1): `server` attributes reading
 * the enclosing items' key bindings alone. `validateListBody` refused every
 * other item or key read in a server attribute, so each survivor is
 * mount-time evaluable against the key parameters in scope.
 */
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

/**
 * Record `el`'s key-derived attributes on `scope`. `inBranch`: `el` sits in a
 * server-rendered conditional branch, whose winner the render fixes for every
 * clone but may leave out — its local is a non-throwing query, and the write
 * is guarded.
 */
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

/**
 * The key-derived attributes in a server-rendered conditional's arms (and
 * the server conditionals nested in them), for `scope`: the same descent the
 * item walk makes. Client constructs there are refused elsewhere
 * (`unmountableInArm`), so only key-derived attributes bind.
 */
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

/**
 * Why a node inside a reactive conditional's arm has no lowering in the
 * arm's mount (ADR 0037 s3), or null when it has one. The mount binds the
 * arm root and its descendants, and plans nested arm sets and loops into
 * their own scopes (ADR 0046 s1, LT-424); client constructs in a nested
 * server-rendered branch and composed references keep their host-level
 * addressing, which an arm cloned after connect would escape.
 */
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

/**
 * The container a node's arms switch in (ADR 0037): the element that holds
 * it — a host query, or `'host'` at the component root; inside a Mount
 * Scope (LT-424), the scope's local, or the scope root's own. Null, after
 * the diagnostic, when that element is a reactive list's container, which
 * removes every child it did not place (LTC063), or has no unique selector.
 * Placement elsewhere is `validateArmSetPlacement`'s; `noun` names the
 * construct mid-sentence.
 */
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

/**
 * A reactive-list item is a Mount Scope (ADR 0046 s1): its content plans
 * through the same construct emission an arm's does (`emitConstructEffects`,
 * the compose pass-entry path), addressed through the item's own `first` —
 * the item root by `bindItem`'s element parameter (declared as a typed local
 * only when something binds it), descendants by selectors proved within the
 * item's own subtree and queried once per entering item. Item reads keep
 * the signal meaning (ADR 0046 s3): the bare `{item}` child is the signal
 * shorthand — its watch source IS the item signal — and every other read is
 * the authored arrow over `.get()`. A `server` attribute over the key
 * bindings alone is a key-derived attribute (`keyAttrs`): set once at clone,
 * because a key never changes, so there is nothing to watch. Item-scoped
 * sites are per-item state in every tier — `fx.itemNames` makes the LTC034
 * router and the limb-(b) suppression skip them, and `badListBodyNames`
 * reports the server-only face whose setup-const class no client-need walk
 * reaches (LT-349). A composed child in the item renders into the template;
 * its `truc:pass` entries bind against a scoped local, resolved within the
 * item the way `emitComposeEffects` resolves within the template (the
 * child's own `lang`/`i18n` are LT-355's). Nested arm sets and loops plan
 * into the item's mount as scopes of their own (LT-424); the enclosing
 * items' bindings stay in scope there.
 */
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
	// The item's setup names are per-item too (ADR 0046 s5), and its consts
	// are clone-time values like the key: an attribute over them is set
	// once at mount.
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
		// Scope locals: the root by its element parameter, descendants by
		// `first()` within the item. Minted lazily — an element nothing
		// binds (its own constructs or a key-derived attribute) declares
		// nothing, exactly like an arm root no effect reads.
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

		// Key-derived attributes first, through server-rendered conditional
		// arms (the winner is fixed per render call, so the mount-time write
		// addresses markup that exists in both adopted items and clones) but
		// never into a nested scope or loop, whose own mount sets its own.
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

		// Descendants with constructs of their own, document order. A
		// construct in a server-rendered conditional branch — the branch
		// roots included — is refused (LT-468): the fold is fixed per render
		// and per clone, so the construct's required query would throw in
		// every item mount whenever the branch folded off — the same trap
		// the host and arm walks refuse. Nested arm sets and loops plan into
		// the item's mount as their own scopes, a loop below a branch knowing
		// its container may be absent (LT-455).
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

		// Composed children in the item: `truc:pass` entries bind against a
		// scoped local, resolved within the item the way
		// `emitComposeEffects` resolves within the template. The same
		// registry-discovery tolerance applies: that pass runs with no
		// `composeRegistry` and needs only this component's own entry, so a
		// site it cannot resolve says nothing (the LT-015 tolerance).
		// `inBranch`: a `truc:pass`-carrying compose in a server-rendered
		// branch of the item is refused before any local is minted (LT-470) —
		// the fold is fixed per render and per clone, so the required local
		// would throw in every item mount whenever the branch folded off, the
		// construct trap LT-468 refuses one scope down. A pass-less compose
		// stays legal: it is server-rendered markup the client never
		// addresses.
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
			// Handler args (LT-461): one item-scoped local per placement, under
			// the item's own `first`. A site in a server-rendered branch of the
			// item, or a placement in one of the child's, may be absent from
			// the clone: its local does not throw, and `on()` skips it.
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
			// Type-flow import: the composed child's tag-map augmentation must
			// reach the client module even though no factory query names it.
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
