import { type AstNode, objectKeys, sanitizeVarName } from '../ast-utils'
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
	badListBodyNames: (node: AstNode) => string[]
	/** Registry-child tags addressed (type-flow imports), from `PassShared`. */
	childTags: Set<string>
	itemNames: ReadonlySet<string>
	keyNames: ReadonlySet<string>
	scopeBadNames: (node: AstNode) => string[]
	entryByTag: Map<string, InternalRegistryEntry>
	armSelectors: Map<string, string>
	derivableHostProps: ReturnType<typeof foldableHostProps>
	derivableRefGuards: ReturnType<typeof foldableRefGuards>
	foldScope: ReturnType<typeof foldableRenderScope>
	handledComposes: Set<ComposeNode>
}

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

export const runEffects = (
	shared: PassShared,
	{ forPlans, reconcilePlans }: LoopPlans,
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
	/** Registry entries by TAG — see `EffectsContext.entryByTag`. */
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
