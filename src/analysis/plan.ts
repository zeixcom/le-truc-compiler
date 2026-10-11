import {
	type AstNode,
	asArray,
	freeIdentifiers,
	identifierName,
	isNode,
} from '../ast-utils'
import type { LocalDiagnostic } from '../diagnostics'
import { diagnostic } from '../diagnostics'
import { dependenciesOf } from '../evaluability'
import { staticMessageReads } from '../i18n'
import { computeClientNeededNames, serverUsageNames } from '../imports'
import type {
	ComponentIR,
	EachForIR,
	ItemSetupStmt,
	ReconcileForIR,
} from '../ir'
import type { InternalRegistryEntry } from '../registry'
import type { SuppressedSite } from '../simulation/contract'
import type { LocalRoutingSignal } from '../tier'
import { CLIENT_ONLY_PRIMITIVES, CONTEXT_NAMES } from '../vocabulary'
import { walkTemplate } from '../walk'
import { type ComposeRefs, resolveComposeRefs } from './compose-refs'
import { runEffects } from './effects'
import { runHarvest } from './harvest'
import { runLoops } from './loops'
import { addQuery, renderOnlyBindings } from './naming'
import { composedShapesFor } from './selectors'
import { reportServerOnlyNames } from './server-only-names'

/* === Types === */

/** The harvest parser an attr/text seed reads through (from `parserForType`). */
export type ParserKind = 'asNumber' | 'asBoolean' | 'asString'

export type AuthoredParser = {
	kind: 'authored'
	/** The parser expression, as authored. */
	text: string
	/** Where the expression starts in the authored source. */
	start: number
	/** Whether the call needs parentheses around `text` (an arrow, an operator). */
	wrap: boolean
}

/** A generated element query. */
export type QueryPlan = {
	/** Variable name in the generated factory. */
	name: string
	selector: string
	cardinality: 'one' | 'many' | 'maybe'
	message: string
}

/** How a signal seeds itself from the server-rendered DOM. */
export type HarvestPlan =
	| {
			kind: 'text'
			signal: string
			/** Query name of the element whose text was rendered. */
			query: string
			parser: ParserKind | AuthoredParser
	  }
	| {
			kind: 'attr'
			signal: string
			query: string
			attr: string
			parser: ParserKind | AuthoredParser
	  }
	| {
			kind: 'membership'
			signal: string
			/** Collection query holding the marked elements. */
			collection: string
			/** Attribute the membership thunk renders (`aria-selected`). */
			markAttr: string
			/** Attribute carrying the signal's value (`aria-controls`). */
			valueAttr: string
			default: string
			parser?: AuthoredParser
	  }
	| {
			kind: 'substitute'
			signal: string
			/** Initializer text with param identifiers replaced by DOM reads. */
			expr: string
			parser?: ParserKind | AuthoredParser
	  }
	| {
			/** Reactive List reconciled over the adopted DOM (milestone 3). */
			kind: 'list'
			signal: string
			seed:
				| 'verbatim'
				| { container: string; valueSelector: string }
				| {
						container: string
						fields: ListFieldPlan[]
						through?: Array<string | null>
				  }
	  }

export type ListFieldPlan = {
	field: string
	site:
		| { kind: 'key' }
		| { kind: 'text'; selector: string | null }
		| {
				kind: 'attr'
				selector: string | null
				attr: string
				/** A dirty-flag attribute (`value`/`checked`/`selected`) reads the live property. */
				property: boolean
				/** The site element's tag, for the property read's type. */
				tag: string
		  }
	parser:
		| { kind: 'inferred'; name: ParserKind; cast: string | null }
		| {
				kind: 'authored'
				/** The `harvest()` entry's parser, as authored. */
				text: string
				start: number
				/** Whether the call needs parentheses around `text` (an arrow, an operator). */
				wrap: boolean
				/** The entry's key, and where it starts — a type error maps there. */
				keyText: string
				keyStart: number
		  }
}

/** A hoisted const rebound to a server-rendered attribute inside each(). */
export type RebindingPlan = {
	name: string
	/** Expression for the element-derived value. */
	expr: string
}

export type LoopEffectPlan =
	| {
			kind: 'watch-attr'
			attr: string
			thunkText: string
			dispatch: 'attribute' | 'property'
			/** Number-valued thunks stringify — `bindAttribute` takes string|boolean. */
			coerceToString: boolean
			/** Source range of `thunkText`. */
			sourceStart: number | undefined
			sourceEnd: number | undefined
			target: string | null
	  }
	| {
			kind: 'watch-class'
			keys: string[]
			thunkText: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
			target: string | null
	  }
	| {
			kind: 'on'
			event: string
			handlerText: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
			target: string | null
	  }

/** One `@for` over server data lowered to `each()`. */
export type ForClientPlan = {
	/** Collection query variable (`tabs`); empty for a scoped loop. */
	collection: string
	scoped: { root: string; selector: string } | null
	/** Element parameter name inside each() (`tab`). */
	itemParam: string
	rebindings: RebindingPlan[]
	effects: LoopEffectPlan[]
}

export type ReconcileItemScope = {
	/** The item root's local (the bound element, typed by its tag). */
	root: { name: string; tag: string } | null
	/** Descendants the item's effects address, queried within the item root. */
	locals: ScopeLocal[]
	keyAttrs: KeyAttrPlan[]
	/** The item's effects, in document order. */
	effects: TopEffectPlan[]
	setup: readonly ItemSetupStmt[]
}

/** One reactive `@for` over a declared List lowered to `reconcile()`. */
export type ReconcilePlan = {
	/** Component tag (query messages). */
	tag: string
	/** Container query variable (`container`). */
	container: string
	listIndex: number
	/** The declared createList signal (`items`). */
	signal: string
	/** bindItem's item-signal parameter, named after the loop variable. */
	itemParam: string
	/** bindItem's key parameter, from `key k` (null → `_key`). */
	keyParam: string | null
	holeSelector: string | null
	/** The item's Mount Scope: everything bindItem mounts per entering item. */
	itemScope: ReconcileItemScope
	emptyQueries: string[]
	scoped: boolean
	inBranch?: boolean
}

export type ScopeLocal = {
	name: string
	selector: string
	message: string
	optional?: boolean
}

export type KeyAttrPlan = {
	el: string
	/** `el` is an optional local: the write is `el?.setAttribute`. */
	optional?: boolean
	attr: string
	exprText: string
	sourceStart: number | undefined
	sourceEnd: number | undefined
}

/** One arm of a reactive conditional, mounted inside `bindArm`. */
export type ArmPlan = {
	/** The arm key: `then`/`else`, `case:<value>`, `default`. */
	key: string
	/** A `@case` test's source text, null for `then`/`else`/`default`. */
	caseText: string | null
	/** False for an arm that renders nothing: no template, no mount. */
	renders: boolean
	/** The arm root's local (the bound element, typed by its tag). */
	root: { name: string; tag: string } | null
	/** Descendants the arm's effects address, queried within the arm root. */
	locals: ScopeLocal[]
	/** Key-derived attributes of an arm nested in a list item. */
	keyAttrs: KeyAttrPlan[]
	effects: TopEffectPlan[]
}

export type ArmsPlan = {
	/** Container query variable, or `'host'` at the component root. */
	container: string
	/** The arm set's index in document order (`data-arms`). */
	armSet: number
	construct: 'if' | 'switch' | 'try'
	/** The `@if` test or `@switch` discriminant verbatim; the boundary's signal. */
	testText: string
	sourceStart: number | undefined
	/** `bindArm`'s parameter names. */
	elementParam: string
	keyParam: string
	arms: ArmPlan[]
	boundary?: {
		signal: string
		errText: string | null
		/** Offsets of the `ok` and `err` arms' lazy children. */
		okStart: number | undefined
		errStart: number | undefined
	}
}

export type TopEffectPlan =
	| {
			kind: 'watch-text'
			query: string
			source: string
			exprText: string
			sourceStart: number | undefined
	  }
	| {
			kind: 'watch-attr'
			query: string
			attr: string
			thunkText: string
			dispatch: 'attribute' | 'property'
			/** Number-valued thunks stringify — `bindAttribute` takes string|boolean. */
			coerceToString: boolean
			/** Source range of `thunkText`. */
			sourceStart: number | undefined
			sourceEnd: number | undefined
	  }
	| {
			kind: 'pass'
			query: string
			prop: string
			thunkText: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
			/** `{ get, set }` descriptor's write-back accessor. */
			setThunkText: string | undefined
			setSourceStart: number | undefined
			setSourceEnd: number | undefined
	  }
	| {
			kind: 'on'
			query: string
			event: string
			handlerText: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
	  }
	| {
			kind: 'watch-style'
			query: string
			keys: string[]
			thunkText: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
	  }
	| {
			kind: 'watch-class'
			query: string
			keys: string[]
			thunkText: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
	  }
	| {
			kind: 'watch-html'
			query: string
			thunkText: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
	  }
	| { kind: 'each'; for: ForClientPlan }
	| { kind: 'reconcile'; for: ReconcilePlan }
	| { kind: 'arms'; arms: ArmsPlan }
	| {
			kind: 'raw'
			text: string
			sourceStart: number | undefined
			sourceEnd: number | undefined
	  }
	| {
			kind: 'guarded'
			query: string
			effects: TopEffectPlan[]
	  }

export type ClientPlan = {
	queries: QueryPlan[]
	harvests: HarvestPlan[]
	effects: TopEffectPlan[]
	ambientContext: string[]
	childTags: string[]
	routingSignals: LocalRoutingSignal[]
	suppressedSites: SuppressedSite[]
	clientMessageKeys: string[]
}

export type PassShared = {
	component: ComponentIR
	source: string
	diagnostics: LocalDiagnostic[]
	/** Tier routing signals — see {@link ClientPlan.routingSignals}. */
	routingSignals: LocalRoutingSignal[]
	suppressedSites: SuppressedSite[]
	registry: ReadonlySet<string>
	composeRefs: ComposeRefs
	/** The generated factory's element queries, in registration order. */
	queries: QueryPlan[]
	/** Registry-child tags addressed (type-flow imports). */
	childTags: Set<string>
	/** Context members the factory must destructure. */
	ambient: Set<string>
	/** Claimed variable names (queries, rebindings; never signals/refs). */
	usedNames: Set<string>
	/** Every ref name in the template, pre-collected. */
	refNames: Set<string>
	rawSourceRefused: Set<string>
	/** Register (or reuse) a query; returns its variable name. */
	addQuery: (
		base: string,
		selector: string,
		cardinality: 'one' | 'many' | 'maybe',
	) => string
	/** Note context members (`host`, `internals`) a client code position reads. */
	collectAmbient: (node: AstNode | null | undefined) => void
	/** Free names in a reactive/pass thunk the client cannot resolve. */
	badFreeNames: (node: AstNode) => string[]
	badListBodyNames: (node: AstNode) => string[]
}

/** `runLoops`'s production: every `@for`'s client plan, by loop kind. */
export type LoopPlans = {
	/** Server-data `@for` → `each()` plans. */
	forPlans: ReadonlyMap<EachForIR, ForClientPlan>
	/** Reactive-list `@for` → `reconcile()` plans. */
	reconcilePlans: ReadonlyMap<ReconcileForIR, ReconcilePlan>
}

/** `runHarvest`'s production: the signals' seeding plans, in signal order. */
export type HarvestPlans = readonly HarvestPlan[]

/** `runEffects`'s production: the document-ordered client effect list. */
export type EffectPlans = TopEffectPlan[]

/* === Exported Functions === */

export const analyzeClient = (
	component: ComponentIR,
	registry: ReadonlySet<string>,
	diagnostics: LocalDiagnostic[],
	composeRegistry?: ReadonlyMap<string, InternalRegistryEntry>,
): ClientPlan => {
	const source = component.source
	const queries: QueryPlan[] = []
	const childTags = new Set<string>()
	const ambient = new Set<string>(component.contextRefs)
	for (const name of computeClientNeededNames(component))
		if (CONTEXT_NAMES.has(name) || CLIENT_ONLY_PRIMITIVES.has(name))
			ambient.add(name)
	const collectAmbient = (node: AstNode | null | undefined): void => {
		if (!node) return
		for (const name of freeIdentifiers(node))
			if (CONTEXT_NAMES.has(name)) ambient.add(name)
	}
	const usedNames = new Set<string>([
		component.tag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
		...component.signals.map(s => s.name),
		'host',
		...component.itemSetup.flatMap(stmt =>
			stmt.name === null ? [] : [stmt.name],
		),
	])
	const composeRefs = resolveComposeRefs(
		component,
		diagnostics,
		composeRegistry,
	)
	if (composeRefs.mode === 'resolved')
		component.composedShapes = composedShapesFor(
			component.root,
			composeRefs.registry,
		)

	const refNames = new Set<string>()
	walkTemplate(component.root, node => {
		if (node.kind !== 'element' && node.kind !== 'compose') return
		for (const attr of node.attrs)
			if (attr.kind === 'ref') refNames.add(attr.name)
	})

	for (const ref of component.firstRefs.values())
		if (ref.stage === 'deferred') refNames.add(ref.name)

	for (const ref of [
		...[...component.firstRefs.values()]
			.filter(ref => ref.stage === 'unmatched')
			.map(ref => ({
				name: ref.name,
				selector: ref.selector,
				required: ref.required,
			})),
		...(composeRefs.mode === 'resolved' ? composeRefs.unmatched : []),
	]) {
		refNames.add(ref.name)
		usedNames.add(ref.name)
		queries.push({
			name: ref.name,
			selector: ref.selector,
			cardinality: ref.required ? 'one' : 'maybe',
			message: ref.required
				? (component.firstRefs.get(ref.name)?.reason ??
					`${component.tag}: ${ref.selector} missing`)
				: '',
		})
	}

	const serverBindings = new Set<string>([
		...renderOnlyBindings(component),
		...(component.moduleBindings ?? []),
	])

	const setupNames = new Set(
		component.setup.map(s => s.name).filter((n): n is string => !!n),
	)
	/** Factory-scope bindings every client position sees. */
	const factoryBinds = (name: string): boolean =>
		component.signals.some(s => s.name === name) ||
		refNames.has(name) ||
		CONTEXT_NAMES.has(name)
	/** Bindings the client module emits only where a client-need walk reaches. */
	const emittedOnDemand = (name: string): boolean =>
		setupNames.has(name) ||
		component.imports.clientLeTrucNames.has(name) ||
		component.imports.plainLocalNames.has(name)
	const clientRebinds = (name: string): boolean =>
		factoryBinds(name) || emittedOnDemand(name)

	const tNames = new Set(component.messageTBindings ?? [])
	const declaredKeys = component.i18nMessages ?? {}
	const clientMessageKeys = new Set<string>()
	/** Free names in a client-emitted position that only the server binds. */
	const badFreeNames = (node: AstNode): string[] =>
		[...dependenciesOf(node)].filter(name => {
			if (!serverBindings.has(name) || clientRebinds(name)) return false
			if (!tNames.has(name)) return true
			const keys = staticMessageReads(node, name, declaredKeys)
			if (keys === null) return true
			for (const key of keys) clientMessageKeys.add(key)
			return false
		})

	const badListBodyNames = (node: AstNode): string[] => {
		const bad = new Set(badFreeNames(node))
		return [...dependenciesOf(node)].filter(
			name => bad.has(name) || (!factoryBinds(name) && emittedOnDemand(name)),
		)
	}

	for (const stmt of [
		...component.clientSetup,
		...component.itemSetup.filter(stmt => stmt.kind !== 'ref'),
	])
		for (const name of dependenciesOf(stmt.node)) {
			if (!tNames.has(name)) continue
			for (const key of staticMessageReads(stmt.node, name, declaredKeys) ?? [])
				clientMessageKeys.add(key)
		}

	const routingSignals: LocalRoutingSignal[] = []
	const suppressedSites: SuppressedSite[] = []
	const shared: PassShared = {
		component,
		source,
		diagnostics,
		routingSignals,
		suppressedSites,
		registry,
		composeRefs,
		queries,
		childTags,
		ambient,
		usedNames,
		refNames,
		rawSourceRefused: new Set(),
		addQuery: (base, selector, cardinality) =>
			addQuery(
				usedNames,
				queries,
				childTags,
				component,
				registry,
				base,
				selector,
				cardinality,
			),
		collectAmbient,
		badFreeNames,
		badListBodyNames,
	}

	const loopPlans = runLoops(shared)
	const harvests = runHarvest(shared, loopPlans)
	const effects = runEffects(shared, loopPlans, harvests)

	for (const prop of asArray(component.expose?.argNode?.properties))
		if (prop.type === 'Property' && isNode(prop.value))
			reportServerOnlyNames(
				shared,
				prop.value,
				`\`expose()\` entry \`${identifierName(prop.key) ?? '…'}\``,
			)
	for (const signal of component.signals) {
		if (signal.family === 'context') continue
		if (shared.rawSourceRefused.has(signal.name)) continue
		const harvest = harvests.find(h => h.signal === signal.name)
		if (harvest && !(harvest.kind === 'list' && harvest.seed === 'verbatim'))
			continue
		const call = component.setup.find(s => s.name === signal.name)?.node
		if (call)
			reportServerOnlyNames(
				shared,
				call,
				`The initializer of signal \`${signal.name}\``,
			)
	}
	const clientNeeded = computeClientNeededNames(component)
	for (const stmt of component.plainSetup)
		if (stmt.name && clientNeeded.has(stmt.name))
			reportServerOnlyNames(
				shared,
				stmt.node,
				`Setup const \`${stmt.name}\`, which a client position reads,`,
			)

	const serverUsed = serverUsageNames(component)
	const harnessUnevaluableNames = new Set([
		...CLIENT_ONLY_PRIMITIVES,
		...refNames,
		...CONTEXT_NAMES,
	])
	for (const stmt of component.plainSetup) {
		if (stmt.name === null) continue
		if (!/Function(Expression)?$/.test(String(stmt.node.type))) {
			const badNames = [...freeIdentifiers(stmt.node)]
				.filter(name => harnessUnevaluableNames.has(name))
				.sort()
			if (badNames.length > 0 && serverUsed.has(stmt.name))
				diagnostics.push(
					diagnostic.renderedClientOnlyConst(
						source,
						stmt.range,
						stmt.name,
						badNames,
					),
				)
		}
	}

	const maybeQueryNames = new Set(
		queries.filter(q => q.cardinality === 'maybe').map(q => q.name),
	)
	const guardedEffects: TopEffectPlan[] = []
	for (const effect of effects) {
		const target =
			effect.kind !== 'guarded' && 'query' in effect ? effect.query : null
		if (target === null || !maybeQueryNames.has(target)) {
			guardedEffects.push(effect)
			continue
		}
		const last = guardedEffects.at(-1)
		if (last?.kind === 'guarded' && last.query === target)
			last.effects.push(effect)
		else
			guardedEffects.push({
				kind: 'guarded',
				query: target,
				effects: [effect],
			})
	}

	// The preamble reads the `i18n` attribute off the host.
	if (clientMessageKeys.size > 0) ambient.add('host')

	return {
		queries,
		harvests: [...harvests],
		effects: guardedEffects,
		clientMessageKeys: [...clientMessageKeys].sort(),
		ambientContext: [...ambient].sort(),
		childTags: [...childTags].sort(),
		routingSignals,
		suppressedSites,
	}
}
