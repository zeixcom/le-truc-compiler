/**
 * Per-construct client effect planning (regrouping move M5): pass
 * 4's orchestration — `runEffects`'s five phases and the document-ordered
 * walk driver `emitTopEffects` — over the subsystem modules the bands moved
 * into (2026-10-10 split): `construct-effects.ts` (construct lowering and
 * the shared helpers), `branch-effects.ts` (control-flow addressing),
 * `mount-scopes.ts` (arms and list items), `compose-effects.ts` (composed
 * elements).
 *
 * Dependency shape (2026-10-10 architecture review): the pass context
 * (`EffectsContext`) and the selector adapters parameterized on it live
 * here with the drivers, so the subsystem modules import both from this
 * module while it imports their entry points — a cycle held safe, like
 * effects→loops and the harvest↔list-harvest pair, by every cross-call
 * sitting inside a function body, so no cycle resolves at module load. The
 * same shape repeats between mount-scopes and branch-effects.
 */

import type { AstNode } from '../ast-node'
import { objectKeys, sanitizeVarName } from '../ast-utils'
import { diagnostic, type LocalDiagnostic } from '../diagnostics'
import {
	foldableHostProps,
	foldableRefGuards,
	foldableRenderScope,
} from '../evaluability'
import type { ComponentIR, ForIR, TemplateNode } from '../ir'
import type { InternalRegistryEntry } from '../registry'
import {
	SUPPRESSED_HOST_SELECTOR,
	type SuppressedSite,
} from '../simulation/contract'
import { type LocalRoutingSignal } from '../tier'
import { isClientConstructAttr, isIf, isSwitch } from '../walk'
import {
	handleIfEffects,
	handleReactiveConditional,
	handleSwitchEffects,
	handleTryEffects,
	validateArmSetPlacement,
} from './branch-effects'
import {
	emitComposeEffects,
	planContentConstructs,
	planHostComposeHandlers,
	reportUnplannedHandlers,
	validateComposeIds,
} from './compose-effects'
import type { ComposeRefs } from './compose-refs'
import { emitConstructEffects, emitLazyTextChildren } from './construct-effects'
import { planReconcileItem } from './mount-scopes'
import type {
	EffectPlans,
	HarvestPlans,
	LoopPlans,
	PassShared,
	QueryPlan,
	TopEffectPlan,
} from './plan'
import {
	type ComposeNode,
	composeNodesBySource as composeNodesBySourceIn,
	countComposeBySource as countComposeBySourceIn,
	type ElementNode,
	isElement,
	loopFor as loopForIn,
	refOf,
	resolveSelector as resolveSelectorIn,
	selectorFor as selectorForIn,
} from './selectors'

/**
 * Pass 4's shared state : what `runEffects`'s nested closures used
 * to capture, threaded explicitly so each comment band — construct
 * lowering, control-flow addressing, compose, the compose-`id` validation —
 * is a module-scope unit. Built once at the top of `runEffects` and never
 * reassigned; the derived fold inputs are the same per-component values the
 * closure era computed lazily at the top of the walk. Exported for the
 * subsystem modules' `Pick` slices (2026-10-10 split); not part of the
 * package surface.
 */
export type EffectsContext = {
	component: ComponentIR
	source: string
	diagnostics: LocalDiagnostic[]
	routingSignals: LocalRoutingSignal[]
	suppressedSites: SuppressedSite[]
	registry: ReadonlySet<string>
	composeRefs: ComposeRefs
	queries: QueryPlan[]
	effects: TopEffectPlan[]
	ambient: Set<string>
	usedNames: Set<string>
	forPlans: LoopPlans['forPlans']
	reconcilePlans: LoopPlans['reconcilePlans']
	addQuery: (
		base: string,
		selector: string,
		cardinality: 'one' | 'many' | 'maybe',
	) => string
	collectAmbient: (node: AstNode | null | undefined) => void
	badFreeNames: (node: AstNode) => string[]
	/**
	 * `badFreeNames` for a list-body position (`analysis/plan.ts`):
	 * the setup consts and authored imports no client-need walk reaches.
	 * Item-scoped planning (ADR 0024 s1) reports through this — a setup const
	 * read only inside an item is still never emitted client-side.
	 */
	badListBodyNames: (node: AstNode) => string[]
	/** Registry-child tags addressed (type-flow imports), from `PassShared`. */
	childTags: Set<string>
	/**
	 * The item and key bindings and the setup names (ADR 0024 s5) of the
	 * reactive-list items currently being planned (ADR 0024 s1), empty
	 * outside one. Item-scoped sites are
	 * per-item state the server deliberately omits in every tier — never a
	 * routing signal, and never a suppression record (the revert would
	 * undo per-item truth the mount re-establishes on every clone).
	 */
	itemNames: ReadonlySet<string>
	/**
	 * The key bindings and per-item consts of every enclosing reactive-list
	 * item (ADR 0024 s1 and s5, LT-424/LT-426), empty outside one — the
	 * clone-time names. A `server` attribute over these alone is set once at
	 * the mount of the scope that owns its element.
	 */
	keyNames: ReadonlySet<string>
	/**
	 * The server-only check for the current scope's positions: `badFreeNames`
	 * at host level and in host-level arms, `badListBodyNames` once inside a
	 * reactive-list item — arms and lists nested in an item included.
	 */
	scopeBadNames: (node: AstNode) => string[]
	/**
	 * Registry entries by TAG . The compose registry is keyed by source
	 * path because composition resolves through import specifiers; a
	 * `pass={{ }}` on a raw dashed tag has only the tag, so it needs the
	 * other index. Built from the same map rather than threading a second
	 * one through: pass 1 puts every compilable file's entry in there, so
	 * the two indexes are the same set of components.
	 */
	entryByTag: Map<string, InternalRegistryEntry>
	/**
	 * A reactive conditional's arm locals (ADR 0015) are `bindArm`-scoped
	 * variables, not factory queries: each one's selector over the whole
	 * template, for the suppressed-site records `selectorOf` writes.
	 */
	armSelectors: Map<string, string>
	// The two substitutable sets for `hostDerivedFold`
	// below — host props with a known server truth, and refs whose
	// presence the server decides — computed once per component rather
	// than per attribute. Both must match what `emit-server.ts` will
	// actually fold, or LTC034 warns about an attribute that does render.
	derivableHostProps: ReturnType<typeof foldableHostProps>
	derivableRefGuards: ReturnType<typeof foldableRefGuards>
	//  step 6: the render-scope names a host-derived fold may leave in
	// a spliced thunk (args, signals, transitive-pure setup consts). Must be
	// the same set `emit-server.ts` folds with, or this check warns about an
	// attribute that does render (or silences one that doesn't).
	foldScope: ReturnType<typeof foldableRenderScope>
	/**
	 * The compose sites whose handler args a scope's walk planned or refused
	 * : any other site carrying one is refused at the end of the
	 * pass, so no handler drops silently.
	 */
	handledComposes: Set<ComposeNode>
}

/**
 * The component-scoped selector adapters, parameterized on the pass
 * context — exported for the subsystem modules, whose narrower context
 * slices all carry `component`.
 */
export const selectorFor = (
	fx: Pick<EffectsContext, 'component'>,
	el: ElementNode,
) => selectorForIn(fx.component, el)
export const resolveSelector = (
	fx: Pick<EffectsContext, 'component'>,
	el: ElementNode,
) => resolveSelectorIn(fx.component, el)
export const countComposeBySource = (
	fx: Pick<EffectsContext, 'component'>,
	source2: string,
) => countComposeBySourceIn(fx.component.root, source2)
export const composeNodesBySource = (
	fx: Pick<EffectsContext, 'component'>,
	source2: string,
) => composeNodesBySourceIn(fx.component.root, source2)
export const loopFor = (
	fx: Pick<EffectsContext, 'component'>,
	node: TemplateNode,
): ForIR | null => loopForIn(fx.component, node)

const emitTopEffects = (fx: EffectsContext, node: TemplateNode): void => {
	const {
		component,
		source,
		diagnostics,
		effects,
		ambient,
		addQuery,
		collectAmbient,
		forPlans,
		reconcilePlans,
	} = fx
	if (node.kind === 'conditional' && node.mode === 'reactive') {
		handleReactiveConditional(fx, node)
		return
	}
	if (isIf(node)) {
		handleIfEffects(fx, node)
		return
	}
	if (isSwitch(node)) {
		handleSwitchEffects(fx, node)
		return
	}
	if (node.kind === 'try') {
		handleTryEffects(fx, node)
		return
	}
	if (node.kind === 'compose') {
		emitComposeEffects(fx, node)
		planContentConstructs(fx, node)
		return
	}
	if (!isElement(node)) return
	const loop = node !== component.root ? loopFor(fx, node) : null
	if (loop) {
		if (loop.kind === 'reconcile') {
			const plan = reconcilePlans.get(loop)
			if (plan) {
				planReconcileItem(fx, loop, plan)
				effects.push({ kind: 'reconcile', for: plan })
			}
			return
		}
		const plan = forPlans.get(loop)
		if (plan) effects.push({ kind: 'each', for: plan })
		return
	}
	if (node === component.root) {
		for (const attr of component.root.attrs) {
			if (attr.kind === 'style-map') {
				//: the root's own reactive style is the one construct
				// addressable without a query — the target is the ambient
				// `host`, not a queried descendant.
				collectAmbient(attr.object)
				ambient.add('host')
				effects.push({
					kind: 'watch-style',
					query: 'host',
					keys: objectKeys(attr.object),
					thunkText: attr.thunkText,
					sourceStart: attr.thunk.start,
					sourceEnd: attr.thunk.end,
				})
				continue
			}
			if (attr.kind === 'class-map') {
				//: same root exemption as style-map — targets the
				// ambient `host`, not a queried descendant.
				collectAmbient(attr.object)
				ambient.add('host')
				effects.push({
					kind: 'watch-class',
					query: 'host',
					keys: objectKeys(attr.object),
					thunkText: attr.thunkText,
					sourceStart: attr.thunk.start,
					sourceEnd: attr.thunk.end,
				})
				continue
			}
			if (
				attr.kind === 'event' ||
				attr.kind === 'reactive' ||
				attr.kind === 'html' ||
				attr.kind === 'ref' ||
				attr.kind === 'pass'
			) {
				diagnostics.push(
					diagnostic.unsupported(
						source,
						component.root.node,
						'A reactive construct on the component root element',
						'The root takes reactive class and style maps and lazy text only — move the construct onto a child element.',
					),
				)
				break
			}
		}
		//: the root's lazy text CHILDREN are the text-binding
		// counterpart of the style-map/class-map root exemptions above
		// — shared with the nested path through
		// `emitLazyTextChildren` .
		emitLazyTextChildren(
			fx,
			component.root,
			'host',
			effects,
			'the component root',
			SUPPRESSED_HOST_SELECTOR,
			true,
		)
	} else {
		const hasClientConstruct =
			node.attrs.some(isClientConstructAttr) ||
			node.children.some(c => c.kind === 'expr' && c.reactivity === 'reactive')
		if (hasClientConstruct) {
			const { selector, unique } = resolveSelector(fx, node)
			if (!unique) {
				diagnostics.push(
					diagnostic.unaddressableElement(
						source,
						node.node,
						`No unique selector for <${node.tag}> in the rendered template — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
					),
				)
			}
			const refAttr = refOf(node)
			const query = addQuery(
				refAttr?.name ?? sanitizeVarName(node.tag),
				selector,
				'one',
			)
			emitConstructEffects(fx, node, query)
		}
	}
	for (const child of node.children) emitTopEffects(fx, child)
}

/* === Exported Functions === */

/**
 * Pass 4: the document-ordered client effect walk (regrouping move
 * M5). Builds the pass context once, walks the template through
 * `emitTopEffects`, then runs the standalone compose-`id` validation —
 * the band units live at module scope .
 */
export const runEffects = (
	shared: PassShared,
	{ forPlans, reconcilePlans }: LoopPlans,
	/**
	 * Unread here: the parameter carries the ORDER (ADR 0018 s5). Harvest
	 * registers its queries first, and query registration order is the
	 * byte-stable contract — so effects cannot be planned without it.
	 */
	_harvests: HarvestPlans,
): EffectPlans => {
	const {
		component,
		source,
		diagnostics,
		routingSignals,
		suppressedSites,
		registry,
		composeRefs,
		ambient,
		addQuery,
		collectAmbient,
		badFreeNames,
		badListBodyNames,
		childTags,
		usedNames,
		queries,
	} = shared
	/**
	 * Registry entries by TAG . The compose registry is keyed by
	 * source path because composition resolves through import specifiers; a
	 * `pass={{ }}` on a raw dashed tag has only the tag, so it needs the
	 * other index. Built from the same map rather than threading a second
	 * one through: pass 1 puts every compilable file's entry in there, so
	 * the two indexes are the same set of components.
	 */
	const entryByTag = new Map<string, InternalRegistryEntry>()
	if (composeRefs.mode === 'resolved')
		for (const entry of composeRefs.registry.values())
			entryByTag.set(entry.tag, entry)
	const effects: EffectPlans = []
	const fx: EffectsContext = {
		component,
		source,
		diagnostics,
		routingSignals,
		suppressedSites,
		registry,
		composeRefs,
		queries,
		effects,
		ambient,
		usedNames,
		forPlans,
		reconcilePlans,
		addQuery,
		collectAmbient,
		badFreeNames,
		badListBodyNames,
		childTags,
		entryByTag,
		// Empty outside a reactive-list item; `planReconcileItem` swaps them
		// in for the item's own walk and restores them after.
		itemNames: new Set<string>(),
		keyNames: new Set<string>(),
		scopeBadNames: badFreeNames,
		armSelectors: new Map(),
		derivableHostProps: foldableHostProps(component),
		derivableRefGuards: foldableRefGuards(component),
		foldScope: foldableRenderScope(component),
		handledComposes: new Set(),
	}
	validateArmSetPlacement(fx)
	emitTopEffects(fx, component.root)
	planHostComposeHandlers(fx)
	reportUnplannedHandlers(fx)
	validateComposeIds(fx)
	return effects
}
