import { type AstNode, hostPropOf, nodeType, objectKeys } from '../ast-utils'
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
	SUBMITTABLE_FORM_CONTROL_TAGS,
} from '../vocabulary'
import { childNodes, isClientConstructAttr } from '../walk'
import { dispatchOf } from './attr-dispatch'
import type { EffectsContext } from './effects'
import { lazyWatchSource } from './harvest'
import type { TopEffectPlan } from './plan'
import type { ElementNode, ExprNode } from './selectors'
import { isElement } from './selectors'
import { managedPropRead, reportServerOnlyNames } from './server-only-names'
import { returnsNumber } from './thunk-types'

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

export const suppresses = (
	fx: ConstructEffectsContext,
	node: AstNode,
): boolean => {
	// An item-scoped site is per-item state the mount re-establishes on every clone
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
 * The lazy-text emission gate
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
		// The `host.<prop>` form's source is synthesized
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
	// Same record for either form.
	if (suppresses(fx, child.expr))
		fx.suppressedSites.push({ kind: 'text', selector: suppressedSelector })
}

/** Does this element carry a construct of its own (not a nested one)? */
export const hasOwnConstruct = (el: ElementNode): boolean =>
	el.attrs.some(isClientConstructAttr) ||
	el.children.some(c => c.kind === 'expr' && c.reactivity === 'reactive')

// A lazy text child of the branch ROOT itself is a legitimate construct
export const hasDeepConstruct = (el: ElementNode, depth = 0): boolean =>
	el.children.some(
		child =>
			(depth > 0 && child.kind === 'expr' && child.reactivity === 'reactive') ||
			(child.kind === 'element' &&
				(child.attrs.some(isClientConstructAttr) ||
					hasDeepConstruct(child, depth + 1))),
	)

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

/** An AST node's source offset, for the span table. */
export const startOf = (node: AstNode | undefined): number | undefined =>
	typeof node?.start === 'number' ? node.start : undefined

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
			ambient.add('host')
			sink.push({
				kind: 'watch-attr',
				query,
				attr: attr.name,
				thunkText: `() => host.${attr.bindsProp}`,
				dispatch: isDirtyFlagControlAttr(el.tag, attr.name)
					? 'property'
					: 'attribute',
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
				// Item exception: an item-scoped site is per-item state no
				// server phase answers BY DESIGN — the template bakes it empty
				// and the mount writes it on every clone — so it routes no
				// tier. The severe form below still fires: a no-JS item whose
				// control is enabled-and-submittable is the same permanent
				// wrong default.
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
			const dispatch = dispatchOf(attr, el.tag)
			sink.push({
				kind: 'watch-attr',
				query,
				attr: attr.name,
				thunkText: attr.thunkText,
				dispatch,
				// Number-valued thunks stringify under either dispatch
				coerceToString: returnsNumber(attr.thunk.body, component.signals),
				sourceStart: attr.thunk.start,
				sourceEnd: attr.thunk.end,
			})
			if (suppresses(fx, attr.thunk))
				suppressedSites.push({
					kind: 'attr',
					selector: selectorOf(fx, query),
					attr: attr.name,
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
	// The nested path mirrors the root branch's EMISSION gate
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
