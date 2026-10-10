/**
 * Pass 4's construct lowering (LT-022; 2026-10-10 split): one element's
 * client constructs — reactive attributes, class/style maps, pass entries,
 * events, a reactive `truc:html`, lazy text children — into
 * `TopEffectPlan`s (`emitConstructEffects`), the pass-entry twin
 * (`checkPassEntries`/`emitPassEntries`) every `pass={{ }}` addressing path
 * shares, the construct predicates the branch handlers and the boundary-arms
 * module test with, and the small helpers (`suppresses`, `selectorOf`,
 * `startOf`) the construct and branch bands share.
 *
 * A leaf among the pass-4 modules: the sibling subsystems and
 * `src/boundary-arms.ts` import from here; this module imports no sibling
 * at runtime (the `EffectsContext` import is type-only), so it stays on the
 * leaf side of pass 4's dependency shape.
 */

import type { AstNode } from '../ast-node'
import { hostPropOf, nodeType, objectKeys } from '../ast-utils'
import { diagnostic } from '../diagnostics'
import {
	containsImpureAmbient,
	dependenciesOf,
	hostDerivedFold,
} from '../evaluability'
import type { PassEntryIR, TemplateNode } from '../ir'
import { rangeFields, resolutionOf } from '../tier'
import {
	isDirtyFlagControlAttr,
	SEMANTICALLY_LOADED_ATTRS,
} from '../vocabulary'
import { childNodes, isClientConstructAttr } from '../walk'
import type { EffectsContext } from './effects'
import { lazyWatchSource } from './harvest'
import type { TopEffectPlan } from './plan'
import type { ElementNode, ExprNode } from './selectors'
import { isElement } from './selectors'
import {
	managedPropRead,
	reportServerOnlyNames,
	SUBMITTABLE_FORM_CONTROL_TAGS,
} from './server-only-names'
import { returnsNumber } from './thunk-types'

/**
 * The context slice construct lowering reads — exactly the `EffectsContext`
 * fields its functions use. The full pass context satisfies it structurally
 * (ADR 0040 s5), as do the wider sibling slices that forward `fx` here.
 */
type ConstructEffectsContext = Pick<
	EffectsContext,
	| 'component'
	| 'source'
	| 'diagnostics'
	| 'ambient'
	| 'routingSignals'
	| 'suppressedSites'
	| 'registry'
	| 'collectAmbient'
	| 'derivableHostProps'
	| 'derivableRefGuards'
	| 'foldScope'
	| 'effects'
	| 'badFreeNames'
	| 'itemNames'
	| 'queries'
	| 'armSelectors'
	| 'entryByTag'
>

/**
 * ADR 0029 sub-design 1 (LT-165 step 7): is this reactive expression
 * unresolvable — no server phase can answer it, because its value is a
 * function of the viewing moment or the build machine's own state (limb
 * b)? Such a site is omitted server-side in every tier and SILENT (step
 * 5), but the generated client still binds it and the realm replays that
 * module, so the site is recorded for the driver's serialization-time
 * suppression. Limb (a) (stubbed-API reads) is deliberately not
 * recorded — see {@link SuppressedSite}.
 */
export const suppresses = (
	fx: ConstructEffectsContext,
	node: AstNode,
): boolean => {
	// An item-scoped site (ADR 0046 s1) is per-item state the mount
	// re-establishes on every clone — never a build-machine answer to
	// revert.
	if ([...dependenciesOf(node)].some(name => fx.itemNames.has(name)))
		return false
	const resolution = resolutionOf(node, fx.component.serverKnown)
	return resolution.by === 'none' && resolution.limb === 'not-a-server-fact'
}

/** The selector a plan query addresses; `'host'` stays the sentinel. */
export const selectorOf = (
	fx: ConstructEffectsContext,
	query: string,
): string =>
	fx.queries.find(q => q.name === query)?.selector ??
	fx.armSelectors.get(query) ??
	query

/**
 * The lazy-text emission gate (LT-114's root branch, mirrored onto the
 * nested path by LT-115, deduplicated by LT-226): `bindText()` replaces the
 * element's ENTIRE textContent, so the one sanctioned shape is a lazy child
 * that is the element's sole content — multiple lazy children race
 * last-write-wins on the shared textContent, and static text is wiped
 * (element children REMOVED) by the first write. Both paths REJECT those
 * shapes with a clear message instead of emitting a plausible-looking but
 * wrong binding. Per-child checks run regardless of the gate — independent
 * findings, not precedents: a managed form prop as a reactive child
 * requires the widened FormFactoryContext (formAssociated() must lead the
 * extensions; since LT-052 the spelling is a `host.<prop>` read, with the
 * retired string-literal form still matched so a stale source gets the
 * managed-prop message rather than a confusing downstream type error), and
 * an impure-ambient lazy child (CHECKLIST §4) is omitted server-side,
 * corrected by the client's first binding pass, and silent (LT-165 step 5,
 * ADR 0029 s1 limb b).
 *
 * `targetLabel` names the element in the diagnostics (`<el.tag>` on the
 * nested path, `the component root` at the root). `suppressedSelector` is
 * the revert record's address: the query's resolved selector on the nested
 * path (via `selectorOf`) and the host sentinel at the root — deliberate,
 * because an author-named `first()` ref could collide with the literal
 * `'host'`. `addressHost` marks the root call: its watch-text targets the
 * ambient host element, so the factory needs `host` in its destructuring
 * whatever the child reads; a queried element needs it only for the
 * spliced `() => host.<prop>` source form.
 */
export const emitLazyTextChildren = (
	fx: ConstructEffectsContext,
	el: ElementNode,
	query: string,
	sink: TopEffectPlan[],
	targetLabel: string,
	suppressedSelector: string,
	addressHost: boolean,
	badNames: (node: AstNode) => string[] = fx.badFreeNames,
): void => {
	const lazyChildren = el.children.filter(
		(c): c is ExprNode => c.kind === 'expr' && c.reactivity === 'reactive',
	)
	if (lazyChildren.length === 0) return
	for (const child of lazyChildren) {
		const managed = managedPropRead(child.expr)
		if (
			managed !== null &&
			!fx.component.exposeProps.get(managed)?.signalName &&
			!fx.component.config?.form
		)
			fx.diagnostics.push(
				diagnostic.managedPropWithoutForm(fx.source, child.node, managed),
			)
		fx.collectAmbient(child.expr)
		// The LT-122 form's source is synthesized (`() => host.<prop>`);
		// its `exprText` is the server arg by design.
		if (!child.bindsProp)
			reportServerOnlyNames(
				fx,
				child.expr,
				`Reactive text on ${targetLabel}`,
				badNames(child.expr),
			)
	}
	// The gate itself: one lazy child, alone.
	const contentSiblings = el.children.filter(
		c =>
			c.kind !== 'client-stmt' &&
			!(c.kind === 'expr' && c.reactivity === 'reactive'),
	)
	if (lazyChildren.length > 1) {
		fx.diagnostics.push(
			diagnostic.unsupported(
				fx.source,
				lazyChildren[1]?.node,
				`More than one lazy text child on ${targetLabel}`,
				"`bindText()` replaces the element's whole `textContent`, so each lazy child would overwrite the others — combine them into one expression.",
			),
		)
		return
	}
	if (contentSiblings.length > 0) {
		fx.diagnostics.push(
			diagnostic.unsupported(
				fx.source,
				(lazyChildren[0] as ExprNode).node,
				`A lazy text child beside other content on ${targetLabel}`,
				"`bindText()` replaces the element's whole `textContent`, so the first write would erase the static text and remove the child elements — move the lazy child into an element of its own.",
			),
		)
		return
	}
	const child = lazyChildren[0] as ExprNode
	if (child.bindsProp || addressHost) fx.ambient.add('host')
	sink.push({
		kind: 'watch-text',
		query,
		source: lazyWatchSource(child),
		exprText: child.exprText,
		sourceStart: startOf(child.expr),
	})
	// Same record for either form (LT-165 step 7): the emission gate makes
	// the site the element's whole textContent, so the element's pre-connect
	// text is the entire revert.
	if (suppresses(fx, child.expr))
		fx.suppressedSites.push({ kind: 'text', selector: suppressedSelector })
}

/** Does this element carry a construct of its own (not a nested one)? */
export const hasOwnConstruct = (el: ElementNode): boolean =>
	el.attrs.some(isClientConstructAttr) ||
	el.children.some(c => c.kind === 'expr' && c.reactivity === 'reactive')

// A lazy text child of the branch ROOT itself is a legitimate construct
// (watched via the root's own query, exactly like a reactive attribute)
// — only a NESTED element's own lazy child or construct attrs make the
// construct unaddressable, hence the depth guard.
export const hasDeepConstruct = (el: ElementNode, depth = 0): boolean =>
	el.children.some(
		child =>
			(depth > 0 && child.kind === 'expr' && child.reactivity === 'reactive') ||
			(child.kind === 'element' &&
				(child.attrs.some(isClientConstructAttr) ||
					hasDeepConstruct(child, depth + 1))),
	)

/**
 * One branch root's client-construct signature (LT-118): its construct
 * attributes' `key=text` pairs, sorted. Two roots with equal signatures
 * are interchangeable for union addressing (one query, one effect set,
 * whichever branch rendered); differing signatures — a construct key
 * present on only some roots (the old LTC031 case) or the same key with
 * different text (the old "constructs differ" case) — route to per-branch
 * addressing instead. The text is whatever the client effect would differ
 * by: an event's handler, a reactive/class-map/style-map thunk, a
 * `server` attribute's `bindsProp` name, a `pass` attribute's
 * `prop=thunk` entries, a reactive `html` attribute's value text
 * (LT-378 — those last three contributed an empty text before, so two
 * roots binding DIFFERENT sources to the same attribute compared equal
 * and were union-addressed onto the primary root's source).
 */
export const constructSignatureOf = (root: ElementNode): string => {
	const parts: string[] = []
	for (const attr of root.attrs) {
		if (!isClientConstructAttr(attr)) continue
		const key = `${attr.kind === 'event' ? 'on' : 'bind'}:${'name' in attr ? attr.name : attr.kind}`
		const attrText =
			attr.kind === 'event'
				? attr.handlerText
				: attr.kind === 'reactive' ||
						attr.kind === 'class-map' ||
						attr.kind === 'style-map'
					? attr.thunkText
					: attr.kind === 'server'
						? (attr.bindsProp ?? '')
						: attr.kind === 'pass'
							? attr.entries
									.map(
										entry =>
											`${entry.prop}=${entry.thunkText}${
												entry.setThunkText ? ` set=${entry.setThunkText}` : ''
											}`,
									)
									.join(',')
							: attr.kind === 'html'
								? attr.exprText
								: ''
		parts.push(`${key}=${attrText}`)
	}
	return parts.sort().join('|')
}

/** Does a subtree carry client constructs (client-side-only elements)? */
export const hasClientConstructs = (node: TemplateNode): boolean => {
	if (node.kind === 'client-stmt') return true
	if (node.kind === 'expr') return node.reactivity === 'reactive'
	if (node.kind === 'conditional' || node.kind === 'try') return false
	if (!isElement(node)) return false
	if (node.attrs.some(isClientConstructAttr)) return true
	return node.children.some(hasClientConstructs)
}

/** A direct lazy child of `el` whose expr is a bare Identifier, if any. */
export const directLazyIdentifier = (el: ElementNode): string | null => {
	for (const child of el.children) {
		if (
			child.kind === 'expr' &&
			child.reactivity === 'reactive' &&
			nodeType(child.expr) === 'Identifier'
		)
			return String((child.expr as AstNode).name)
	}
	return null
}

/** The first direct lazy child of `el`, if any. */
export const lazyChildOf = (el: ElementNode): ExprNode | undefined =>
	el.children.find(
		(c): c is ExprNode => c.kind === 'expr' && c.reactivity === 'reactive',
	)

/**
 * Whether `target` sits inside composed content under `root` — a descendant
 * of a compose node's children. Such elements are parent-authored markup
 * spliced into the child's rendered DOM: real elements the arm-scoped query
 * reaches, but invisible to the host-template selector counting, so their
 * selectors resolve against the arm subtree instead (`resolveComposeContentSelector`).
 */
export const isInsideCompose = (
	root: TemplateNode,
	target: TemplateNode,
	inside = false,
): boolean => {
	if (root === target) return inside
	const children = root.kind === 'compose' ? root.children : childNodes(root)
	const childInside = inside || root.kind === 'compose'
	for (const child of children)
		if (isInsideCompose(child, target, childInside)) return true
	return false
}

/** An AST node's source offset, for the span table (LT-011). */
export const startOf = (node: AstNode | undefined): number | undefined =>
	typeof node?.start === 'number' ? node.start : undefined

/**
 * A direct lazy child of `el` referencing the catch param — bare (`e`) or
 * a non-computed member read (`e.message`) — as the client-side error
 * expression (`error`/`error.message`), or null if no such child exists.
 */
export const directLazyCatchRef = (
	el: ElementNode,
	catchParam: string,
): string | null => {
	for (const child of el.children) {
		if (child.kind !== 'expr' || child.reactivity === 'server') continue
		const expr = child.expr
		if (
			nodeType(expr) === 'Identifier' &&
			String((expr as AstNode).name) === catchParam
		)
			return 'error'
		if (nodeType(expr) === 'MemberExpression' && !(expr as AstNode).computed) {
			const obj = (expr as AstNode).object
			const prop = (expr as AstNode).property
			if (
				nodeType(obj) === 'Identifier' &&
				String((obj as AstNode).name) === catchParam &&
				nodeType(prop) === 'Identifier'
			)
				return `error.${String((prop as AstNode).name)}`
		}
	}
	return null
}

/**
 * Decide each `pass={{ prop }}` against the TARGET component's own
 * `expose()` (LT-158, ADR 0028 sub-design 6) — the residual TypeScript
 * cannot carry, because a read-only prop is structurally identical to a
 * writable one.
 *
 * Silent when the target's entry is unknown: a hand-written (non-.tsrx)
 * child is in `registry` via `childImports` but never in
 * `composeRegistry`, and the discovery pass has no `composeRegistry` at
 * all. Both keep the Tier 2 runtime check, which is what ADR 0028 says
 * it is for — [M15] no-build components and foreign markup.
 */
export const checkPassEntries = (
	fx: ConstructEffectsContext,
	entries: readonly PassEntryIR[],
	tag: string,
	node: AstNode,
): void => {
	const { entryByTag, source, diagnostics } = fx
	const entry = entryByTag.get(tag)
	if (!entry) return
	const exposed = entry.exposedProps
	for (const passed of entries) {
		const kind = exposed[passed.prop]
		if (kind === undefined)
			diagnostics.push(
				diagnostic.passPropNotExposed(
					source,
					node,
					tag,
					passed.prop,
					Object.keys(exposed),
				),
			)
		else if (kind !== 'slot')
			diagnostics.push(
				diagnostic.passPropNotSlotBacked(source, node, tag, passed.prop, kind),
			)
	}
}

/**
 * Validate and lower one target's `pass={{ }}` entries into `pass` effect
 * plans — shared by raw dashed-tag elements and composed elements, the
 * two `pass={{ }}` addressing paths (ADR 0024 sub-design 10).
 */
export const emitPassEntries = (
	fx: ConstructEffectsContext,
	entries: PassEntryIR[],
	query: string,
	sink: TopEffectPlan[] = fx.effects,
	badNames: (node: AstNode) => string[] = fx.badFreeNames,
): void => {
	const { collectAmbient } = fx
	for (const entry of entries) {
		collectAmbient(entry.thunk)
		reportServerOnlyNames(
			fx,
			entry.thunk,
			`Pass entry \`${entry.prop}\``,
			badNames(entry.thunk),
		)
		if (entry.setThunk) {
			collectAmbient(entry.setThunk)
			reportServerOnlyNames(
				fx,
				entry.setThunk,
				`The setter of pass entry \`${entry.prop}\``,
				badNames(entry.setThunk),
			)
		}
		sink.push({
			kind: 'pass',
			query,
			prop: entry.prop,
			thunkText: entry.thunkText,
			sourceStart: entry.thunk.start,
			sourceEnd: entry.thunk.end,
			setThunkText: entry.setThunkText,
			setSourceStart: entry.setThunk?.start,
			setSourceEnd: entry.setThunk?.end,
		})
	}
}

/**
 * Emit the effects of one element's client constructs against `query` —
 * the shared body for plain elements and @if branch-root unions alike.
 */
export const emitConstructEffects = (
	fx: ConstructEffectsContext,
	el: ElementNode,
	query: string,
	sink: TopEffectPlan[] = fx.effects,
	badNames: (node: AstNode) => string[] = fx.badFreeNames,
): void => {
	const {
		component,
		source,
		diagnostics,
		ambient,
		routingSignals,
		suppressedSites,
		registry,
		collectAmbient,
		derivableHostProps,
		derivableRefGuards,
		foldScope,
	} = fx
	const isCustom = el.tag.includes('-')
	for (const attr of el.attrs) {
		if (attr.kind === 'server' && attr.bindsProp) {
			// LT-122: a server-rendered attribute whose expression is
			// an arg that is also an exposed prop. `emit-server.ts`
			// renders it from the arg exactly as before — this adds
			// the client half, so a later prop write reaches the
			// attribute the component itself rendered. Dispatch is
			// always `property`: the source is a host-prop mirror by
			// construction, and mirrors never write through the
			// content attribute (see the `reactive` branch below).
			if (isCustom) {
				diagnostics.push(
					diagnostic.reactiveAttrOnCustomElement(
						source,
						attr.node,
						el.tag,
						attr.name,
					),
				)
				continue
			}
			// The synthesized thunk reads `host`, so the factory
			// destructuring needs it — there is no authored node
			// for `collectAmbient` to find the name in.
			ambient.add('host')
			sink.push({
				kind: 'watch-attr',
				query,
				attr: attr.name,
				thunkText: `() => host.${attr.bindsProp}`,
				// Attribute dispatch by default, exactly as an
				// authored thunk over a non-mirror source: the
				// site is whatever the author rendered, including
				// `data-*` seeds with no DOM property at all
				// (form-textbox's `data-remaining={description}`
				// — `bindProperty` there fails to typecheck, which
				// is how this was found). Property dispatch is
				// reserved for the one case where the attribute
				// genuinely stops tracking: a dirty-flag IDL
				// attribute on a native form control (LT-116).
				dispatch: isDirtyFlagControlAttr(el.tag, attr.name)
					? 'property'
					: 'attribute',
				// The thunk is synthesized, so there is no authored
				// body to inspect for a number return; the exposed
				// prop's own type decides.
				coerceToString: false,
				sourceStart: attr.node.start,
				sourceEnd: attr.node.end,
			})
			continue
		}
		if (attr.kind === 'reactive') {
			collectAmbient(attr.thunk)
			reportServerOnlyNames(
				fx,
				attr.thunk,
				`Reactive attribute \`${attr.name}\``,
				badNames(attr.thunk),
			)
			// CHECKLIST §5 / LTC034: omission is not neutral for these
			// attribute names — `hidden` omitted means visible, `disabled`
			// omitted means enabled AND submittable, same for `checked`/
			// `selected`/`aria-expanded`. A host-prop mirror, a derived
			// `host.<prop>` fold (LT-085, `hostDerivedFold` below), and a
			// server-evaluable thunk all render an initial value — all
			// three safe. Anything else (a sensor, or any other
			// non-portable dependency) is OMITTED (`emit-server.ts`'s
			// `case 'reactive'` pushes nothing at all when none of the
			// three paths applies).
			//
			// ADR 0029 sub-design 5 (LT-165 step 5): every such site is a
			// ROUTING SIGNAL, not a diagnostic — "phase 1 cannot fold
			// this" was a statement about the harness, not the author's
			// code. The one exception is the severe form (`disabled`/
			// `checked` on a real submittable control), and it is scoped
			// per-EXPRESSION, not per-component (LT-184): the error fires
			// iff THIS site's own resolution is `none`, so no server phase
			// resolves it in any tier and the wrong default is permanent.
			// A component routed Simulated by some other realm-answerable
			// signal still omits this value, so a component-level Static
			// check would have missed it. Sound without a tier check: a
			// `none` resolution can never occur on a Folded-tier
			// component, since the signal recorded right here would have
			// made it non-Folded.
			if (
				SEMANTICALLY_LOADED_ATTRS.has(attr.name) &&
				hostPropOf(attr.thunk) === null &&
				hostDerivedFold(
					attr.thunk,
					derivableHostProps,
					derivableRefGuards,
					foldScope,
				) === null &&
				!(
					dependenciesOf(attr.thunk).isSubsetOf(component.serverKnown) &&
					!containsImpureAmbient(attr.thunk, component.serverKnown)
				)
			) {
				const resolution = resolutionOf(attr.thunk, component.serverKnown)
				// ADR 0029 sub-design 5 (LT-165 step 5), item exception (ADR
				// 0046 s1): an item-scoped site is per-item state no server
				// phase answers BY DESIGN — the template bakes it empty and the
				// mount writes it on every clone — so it routes no tier. The
				// severe form below still fires: a no-JS item whose control is
				// enabled-and-submittable is the same permanent wrong default.
				if (fx.itemNames.size === 0)
					routingSignals.push({
						origin: 'LTC034',
						detail: `\`${attr.name}\` on <${el.tag}> has no server-renderable value`,
						...rangeFields(source, attr.thunk),
						resolution,
					})
				if (
					resolution.by === 'none' &&
					(attr.name === 'disabled' || attr.name === 'checked') &&
					component.config?.form != null &&
					SUBMITTABLE_FORM_CONTROL_TAGS.has(el.tag)
				)
					diagnostics.push(
						diagnostic.unsafeLoadedAttributeDefault(
							source,
							attr.thunk,
							attr.name,
						),
					)
			}
			if (isCustom) {
				// ADR 0024 sub-design 4 (amended by sub-design 10): a
				// function-valued attribute is only ever a reactive binding
				// on NATIVE elements. Custom-element interop is solely
				// through the explicit `pass={{ }}` attribute below — one
				// dispatch path, not two shape-inferred ones.
				diagnostics.push(
					diagnostic.reactiveAttrOnCustomElement(
						source,
						attr.thunk,
						el.tag,
						attr.name,
					),
				)
				continue
			}
			// A host-prop mirror always dispatches as a property —
			// attribute dispatch would be wrong for property-backed
			// targets like `input.value`. LT-116: a dirty-flag IDL
			// attribute on a native form control (`value`/`checked`/
			// `selected` on input/select/textarea/option) dispatches as
			// a property too, mirror or not — once the control is dirty,
			// rewriting the content attribute no longer moves the live
			// property, so `bindAttribute` would silently stop tracking
			// (the form-radiogroup mutual-exclusion break, NOTES LT-092).
			// The thunk's own type is irrelevant to that hazard: the
			// divergence is a property of the target.
			const mirror = hostPropOf(attr.thunk)
			const dispatch: 'attribute' | 'property' =
				mirror !== null || isDirtyFlagControlAttr(el.tag, attr.name)
					? 'property'
					: 'attribute'
			sink.push({
				kind: 'watch-attr',
				query,
				attr: attr.name,
				thunkText: attr.thunkText,
				dispatch,
				// Number-valued thunks stringify under either dispatch:
				// `bindAttribute` takes string|boolean, and the dirty-flag
				// properties (`value` on input/textarea/select) are
				// DOMString-typed — the coercion keeps both typechecking.
				coerceToString: returnsNumber(attr.thunk.body, component.signals),
				sourceStart: attr.thunk.start,
				sourceEnd: attr.thunk.end,
			})
			// ADR 0029 sub-design 1 (LT-165 step 7): the binding installs in
			// the shipped client even though phase 1 omits the site — record
			// where its connect-time write would land so the driver can
			// revert it after the connect window stabilizes.
			if (suppresses(fx, attr.thunk))
				suppressedSites.push({
					kind: 'attr',
					selector: selectorOf(fx, query),
					attr: attr.name,
					// Property dispatch (LT-116) writes the IDL property, which
					// a content-attribute revert alone does not undo.
					...(dispatch === 'property' ? { prop: attr.name } : {}),
				})
		} else if (attr.kind === 'pass') {
			if (!isCustom || !registry.has(el.tag)) {
				diagnostics.push(
					diagnostic.passTargetNotCustom(source, el.node, el.tag),
				)
				continue
			}
			checkPassEntries(fx, attr.entries, el.tag, el.node)
			emitPassEntries(fx, attr.entries, query, sink, badNames)
		} else if (attr.kind === 'class-map') {
			collectAmbient(attr.object)
			reportServerOnlyNames(
				fx,
				attr.thunk,
				'Reactive class map',
				badNames(attr.thunk),
			)
			sink.push({
				kind: 'watch-class',
				query,
				keys: objectKeys(attr.object),
				thunkText: attr.thunkText,
				sourceStart: attr.thunk.start,
				sourceEnd: attr.thunk.end,
			})
		} else if (attr.kind === 'style-map') {
			collectAmbient(attr.object)
			reportServerOnlyNames(
				fx,
				attr.thunk,
				'Reactive style map',
				badNames(attr.thunk),
			)
			sink.push({
				kind: 'watch-style',
				query,
				keys: objectKeys(attr.object),
				thunkText: attr.thunkText,
				sourceStart: attr.thunk.start,
				sourceEnd: attr.thunk.end,
			})
		} else if (attr.kind === 'event') {
			collectAmbient(attr.handler)
			reportServerOnlyNames(
				fx,
				attr.handler,
				`Event handler \`${attr.name}\``,
				badNames(attr.handler),
			)
			sink.push({
				kind: 'on',
				query,
				event: attr.event,
				handlerText: attr.handlerText,
				sourceStart: attr.handler.start,
				sourceEnd: attr.handler.end,
			})
		} else if (attr.kind === 'html' && attr.reactive) {
			// reactive truc:html={() => …} (LT-025): lowers to a
			// dangerouslyBindInnerHTML watch, the sanctioned XSS-aware sink
			// (ADR 0010) — never a raw innerHTML property binding.
			collectAmbient(attr.thunk)
			reportServerOnlyNames(
				fx,
				attr.thunk,
				'Reactive `truc:html`',
				badNames(attr.thunk),
			)
			sink.push({
				kind: 'watch-html',
				query,
				thunkText: attr.thunkText,
				sourceStart: attr.thunk.start,
				sourceEnd: attr.thunk.end,
			})
		}
	}
	// LT-115 (folded in by the LT-114 review): the EMISSION gate the root
	// branch has had since LT-114, mirrored onto the nested path — one
	// shared implementation since LT-226 (see `emitLazyTextChildren`).
	emitLazyTextChildren(
		fx,
		el,
		query,
		sink,
		`<${el.tag}>`,
		selectorOf(fx, query),
		false,
		badNames,
	)
}
