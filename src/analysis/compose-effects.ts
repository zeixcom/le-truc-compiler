/**
 * Pass 4's compose planning (LT-022; 2026-10-10 split; ADR 0024 sub-design
 * 10, LT-461): `pass={{ }}` entries and handler args on composed elements —
 * the host-scope walk (`planHostComposeHandlers`), the arm-root and in-arm
 * paths the branch handlers call, the unplanned-handler backstop, the
 * content constructs a site's children carry, and the compose-`id`
 * validation.
 *
 * Dependency shape: construct lowering imports from
 * `construct-effects.ts`, the selector adapters from effects.ts, whose
 * drivers call the entry points here. Every cross-call on those edges sits
 * inside a function body, so no cycle resolves at module load.
 */

import type { AstNode } from '../ast-node'
import { sanitizeVarName } from '../ast-utils'
import { diagnostic } from '../diagnostics'
import type { TemplateNode } from '../ir'
import { wordingOf } from '../surface'
import { childNodes, walkTemplate } from '../walk'
import {
	checkPassEntries,
	emitConstructEffects,
	emitPassEntries,
} from './construct-effects'
import type { EffectsContext } from './effects'
import {
	composeNodesBySource,
	countComposeBySource,
	loopFor,
	resolveSelector,
} from './effects'
import { joinSelector, resolveHandlerPlacements } from './handler-args'
import { uniqueName } from './naming'
import type { ArmPlan, TopEffectPlan } from './plan'
import {
	allComposeNodes,
	type ComposeNode,
	composeNodesBySource as composeNodesBySourceIn,
	composeSiteAddress,
	composeSiteRefusal,
	composeStaticAttrs,
	type ElementNode,
	isElement,
	refOf,
} from './selectors'
import { reportServerOnlyNames } from './server-only-names'

/**
 * The context slice compose planning reads — its own fields plus the
 * construct slice the forwarded `emitConstructEffects` call needs. The full
 * pass context satisfies it structurally (ADR 0040 s5).
 */
type ComposeEffectsContext = Pick<
	EffectsContext,
	| 'component'
	| 'source'
	| 'diagnostics'
	| 'ambient'
	| 'routingSignals'
	| 'suppressedSites'
	| 'registry'
	| 'composeRefs'
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
	| 'addQuery'
	| 'usedNames'
	| 'childTags'
	| 'handledComposes'
>

/**
 * A compose site's `truc:pass` object as comparable text (LT-319): the
 * prop set in sorted order, each get/set thunk's source with whitespace
 * collapsed. Textual identity only — no semantic equivalence.
 */
const passObjectKey = (node: ComposeNode): string =>
	node.attrs
		.flatMap(a => (a.kind === 'pass' ? a.entries : []))
		.map(e =>
			[e.prop, e.thunkText, e.setThunkText ?? '']
				.map(t => t.replace(/\s+/g, ' ').trim())
				.join('\u0000'),
		)
		.sort()
		.join('\u0001')

/** A compose site's handler args that bind here (LT-461): not forwards. */
export const ownHandlersOf = (node: ComposeNode) =>
	node.attrs.filter(
		(a): a is Extract<(typeof node.attrs)[number], { kind: 'handler' }> =>
			a.kind === 'handler' && a.forward === null,
	)

/**
 * A compose site's handler args (LT-461): one `on()` per placement the
 * child's registry entry publishes for the arg, resolved across forwards,
 * against the site's selector joined with the placement's. `prefix` is the
 * site's selector in the scope that queries it (`''` when the scope root is
 * the site itself, an arm root); `bind` mints the query in that scope —
 * non-throwing for a placement the child renders in a server-rendered
 * branch. The handler runs in the parent: its reads answer to the scope's
 * client names, and its `{ prop: value }` return updates the parent's host,
 * as for any handler the parent authors. A forward (`<Inner onClick=
 * {onClick} />`) binds nothing here — it is the child's half of the record.
 * Registry-discovery tolerance (LT-015): no `composeRegistry`, no plan.
 */
export const planComposeHandlers = (
	fx: ComposeEffectsContext,
	node: ComposeNode,
	prefix: string,
	bind: (selector: string, optional: boolean, base: string) => string,
	sink: TopEffectPlan[],
	badNames: (node: AstNode) => string[],
): void => {
	if (fx.composeRefs.mode === 'skipped') return
	fx.handledComposes.add(node)
	const { registry } = fx.composeRefs
	const entry = registry.get(node.source)
	if (!entry) return
	for (const attr of ownHandlersOf(node)) {
		const placements = resolveHandlerPlacements(entry, attr.name, registry)
		if (placements.length === 0) continue
		fx.collectAmbient(attr.handler)
		reportServerOnlyNames(
			fx,
			attr.handler,
			`Handler arg \`${attr.name}\``,
			badNames(attr.handler),
		)
		for (const placement of placements) {
			const selector = joinSelector(prefix, placement.selector)
			const last = selector.match(/([a-z][a-z0-9-]*)[^\s>]*$/)?.[1]
			sink.push({
				kind: 'on',
				query: bind(
					selector,
					placement.optional,
					sanitizeVarName(last ?? entry.tag),
				),
				event: placement.event,
				handlerText: attr.handlerText,
				sourceStart: attr.handler.start,
				sourceEnd: attr.handler.end,
			})
		}
	}
}

/**
 * A compose site's selector within `scope` — the child's tag plus the
 * clause `composeSiteAddress` proves (LT-498) — or the LTC007 refusal's
 * message, worded for `need` and the scope word (`template`, `arm`, the
 * list's item word).
 */
export const composeSiteSelector = (
	fx: ComposeEffectsContext,
	scope: TemplateNode,
	childTag: string,
	node: ComposeNode,
	need: string,
	scopeWord = 'template',
): { selector: string } | { refusal: string } => {
	const address = composeSiteAddress(scope, node, childTag, {
		composed: fx.component.composedShapes,
	})
	return address.kind === 'unique'
		? { selector: `${childTag}${address.clause}` }
		: {
				refusal: composeSiteRefusal(
					node,
					childTag,
					composeNodesBySourceIn(scope, node.source),
					need,
					scopeWord,
				),
			}
}

/**
 * The backstop for handler args (LT-461): a compose site whose handler no
 * scope's walk planned — inside a server-rendered branch of an arm, or a
 * server-data loop in an item — is refused rather than dropped. Skipped once an error is on record: the
 * walk that would have planned the site may have stopped at it.
 */
export const reportUnplannedHandlers = (fx: ComposeEffectsContext): void => {
	if (fx.composeRefs.mode === 'skipped') return
	if (fx.diagnostics.some(d => d.severity === 'error')) return
	const { registry } = fx.composeRefs
	walkTemplate(
		fx.component.root,
		node => {
			if (node.kind !== 'compose' || fx.handledComposes.has(node)) return
			const entry = registry.get(node.source)
			const bound = ownHandlersOf(node).filter(
				attr =>
					entry !== undefined &&
					resolveHandlerPlacements(entry, attr.name, registry).length > 0,
			)
			if (bound.length === 0) return
			fx.diagnostics.push(
				diagnostic.unsupported(
					fx.source,
					node.node,
					`A handler arg on <${node.component}> where no mount binds it`,
					'The host, an arm and a list item bind the handler args of the composed children they always render — move the composed child out of the nested branch or loop, or make the condition reactive so the child renders as an arm root.',
				),
			)
		},
		{ intoCompose: false },
	)
}

/**
 * Host-scope handler args (LT-461): every compose site the host's own walk
 * reaches — through elements and server-rendered branches, whose sites the
 * render may leave out (a non-throwing query) — binds its handlers through
 * factory queries. Arms and reactive-list items bind theirs in their own
 * mounts; a server-data loop body has no mount to bind per item in, so a
 * handler there is refused, and composed content is LTC011's.
 */
export const planHostComposeHandlers = (fx: ComposeEffectsContext): void => {
	if (fx.composeRefs.mode === 'skipped') return
	const { component, source, diagnostics, addQuery } = fx
	const wording = wordingOf(component)
	const visit = (node: TemplateNode, inBranch: boolean): void => {
		if (node.kind === 'element') {
			const loop = node !== component.root ? loopFor(fx, node) : null
			if (loop?.kind === 'reconcile') return
			if (loop?.kind === 'each') {
				walkTemplate(
					node,
					inner => {
						if (inner.kind !== 'compose' || ownHandlersOf(inner).length === 0)
							return
						fx.handledComposes.add(inner)
						diagnostics.push(
							diagnostic.unsupported(
								source,
								inner.node,
								`A handler arg on <${inner.component}> in a server-data ${wording.loop} body`,
								"`each()` binds the loop's items through their own elements, and the parent binds one listener for each placement — move the composed child out of the loop, or render the items from a reactive list.",
							),
						)
					},
					{ intoCompose: false },
				)
				return
			}
			for (const child of node.children) visit(child, inBranch)
			return
		}
		if (node.kind === 'compose') {
			if (ownHandlersOf(node).length === 0) return
			const childTag =
				fx.composeRefs.mode === 'resolved'
					? (fx.composeRefs.registry.get(node.source)?.tag ?? null)
					: null
			if (!childTag) return
			const site = composeSiteSelector(
				fx,
				component.root,
				childTag,
				node,
				'a handler arg needs a unique target',
			)
			if ('refusal' in site) {
				fx.handledComposes.add(node)
				// One error per site: `emitComposeEffects` may have explained it
				// already, for a `first()` or `truc:pass` on the same site.
				if (
					!diagnostics.some(
						d => d.code === 'LTC007' && d.range.start === node.node.start,
					)
				)
					diagnostics.push(
						diagnostic.unaddressableElement(source, node.node, site.refusal),
					)
				return
			}
			planComposeHandlers(
				fx,
				node,
				site.selector,
				(selector, optional, base) =>
					addQuery(base, selector, inBranch || optional ? 'maybe' : 'one'),
				fx.effects,
				fx.badFreeNames,
			)
			return
		}
		if (node.kind === 'conditional') {
			if (node.mode === 'reactive') return
			for (const child of childNodes(node)) visit(child, true)
			return
		}
		if (node.kind === 'try' && node.pendingChildren === null)
			for (const child of childNodes(node)) visit(child, true)
	}
	visit(component.root, false)
}

/**
 * A `first()` reference and/or `pass={{ }}` on a composed element (ADR
 * 0024 sub-design 10). The query's selector is always the compiler's own:
 * the child's tag from the registry, plus — when this template composes
 * the same child more than once — a static `class`/`id`/`data-*` that
 * uniquely tells the site apart (`composeDiscriminatorClause`, LT-089;
 * three `<FormSpinbutton class="lightness"|"chroma"|"hue">` instances,
 * say). Those attributes reach the served DOM by invariant (LT-090,
 * LT-320), which is what makes the site addressable at all.
 *
 * An author `first()` matching the site (the synthetic `ref` attr
 * `analysis/compose-refs.ts` attaches, LT-127) names the query and
 * carries its required-reason text; a bare reference with no `pass` still
 * needs the query so the name resolves in the factory. A `pass` site with
 * no matching `first()` is named after the child tag, the same fallback
 * raw custom elements get (LT-338).
 */
export const emitComposeEffects = (
	fx: ComposeEffectsContext,
	node: ComposeNode,
): void => {
	const { source, diagnostics, addQuery, composeRefs } = fx
	// Compose resolution is `skipped` during the corpus-wide registry-
	// discovery pass (compileComponent's own tolerance, LT-015). Nothing
	// below it can run then — the child's tag isn't resolvable. That pass
	// needs only this component's OWN registry entry.
	if (composeRefs.mode === 'skipped') return
	const { registry: composeRegistry, ambiguous: ambiguousComposeNodes } =
		composeRefs
	const passAttrs = node.attrs.filter(
		(a): a is Extract<(typeof node.attrs)[number], { kind: 'pass' }> =>
			a.kind === 'pass',
	)
	const refAttr = refOf(node)
	if (passAttrs.length === 0 && !refAttr) return
	// An ambiguous `first()` already explained itself (LTC027,
	// `analysis/compose-refs.ts`) — don't pile a second error on the same
	// mistake.
	if (!refAttr && ambiguousComposeNodes.has(node)) return
	const childTag = composeRegistry.get(node.source)?.tag ?? null
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
	// LT-496/LT-498: a raw element of the child's tag — in a list item, an
	// arm or a compose site's content — matches the host-level query as
	// well, and so does one another composed child renders: the first
	// counts against the site's uniqueness, the second is excluded.
	const address = composeSiteAddress(fx.component.root, node, childTag, {
		composed: fx.component.composedShapes,
		lone: countComposeBySource(fx, node.source) === 1,
		shared: !refAttr,
	})
	// LT-319: sites that share a clause and carry textually identical
	// `truc:pass` objects lower to ONE `pass(all(selector), …)`, emitted at
	// the group's first site; the other members add nothing. An author
	// `first()` is never part of this: a selector matching several sites is
	// already LTC027.
	if (
		address.kind === 'shared' &&
		new Set(address.members.map(passObjectKey)).size === 1
	) {
		if (address.members[0] !== node) return
		const query = addQuery(
			`${sanitizeVarName(childTag)}s`,
			`${childTag}${address.clause}`,
			'many',
		)
		const entries = passAttrs.flatMap(a => a.entries)
		checkPassEntries(fx, entries, childTag, node.node)
		emitPassEntries(fx, entries, query)
		return
	}
	if (address.kind !== 'unique') {
		diagnostics.push(
			diagnostic.unaddressableElement(
				source,
				node.node,
				composeSiteRefusal(
					node,
					childTag,
					composeNodesBySource(fx, node.source),
					'first() and truc:pass need a unique target',
					'template',
					'Give each site a distinct class. Sites that share a class can share one query only if every one of them carries a textually identical `truc:pass` object.',
				),
			),
		)
		return
	}
	const query = addQuery(
		refAttr?.name ?? sanitizeVarName(childTag),
		`${childTag}${address.clause}`,
		'one',
	)
	if (passAttrs.length > 0) {
		const entries = passAttrs.flatMap(a => a.entries)
		checkPassEntries(fx, entries, childTag, node.node)
		emitPassEntries(fx, entries, query)
	}
}

/**
 * An arm root compose site's rendered tag (LT-460): the child's registry
 * tag, or the authored component name while compose resolution is skipped
 * (the registry-discovery pass, which plans nothing against the site).
 */
export const composeArmRootTag = (
	fx: ComposeEffectsContext,
	node: ComposeNode,
): string =>
	fx.composeRefs.mode === 'resolved'
		? (fx.composeRefs.registry.get(node.source)?.tag ?? node.component)
		: node.component

/**
 * A compose site as an arm root carrying client addressing (LT-481): its
 * `truc:pass` entries plan as `pass()` effects in the arm's mount against
 * the arm element parameter — the arm root IS the child's rendered
 * element, so no query or local is minted. Same entry lowering as a
 * host-level or item-level compose: `checkPassEntries` plus
 * `emitPassEntries`, no fork. A `first()` on the site stays refused — the
 * arm is adopted or cloned afresh on every flip, so a connect-time
 * reference goes stale, the same trap the reactive-list item walk refuses
 * (LT-423) — while an ambiguous `first()` keeps LTC027 as its one
 * diagnostic. Registry-discovery tolerance (LT-015): that pass has no
 * `composeRegistry` and needs only this component's own entry, so a site
 * it cannot resolve says nothing. `where` names the arm set in the
 * refusal's subject.
 */
export const planArmRootComposePass = (
	fx: ComposeEffectsContext,
	node: ComposeNode,
	rootName: string,
	plan: ArmPlan,
	badNames: (node: AstNode) => string[],
	where: string,
): void => {
	if (fx.composeRefs.mode === 'skipped') return
	const { registry, ambiguous } = fx.composeRefs
	const childTag = registry.get(node.source)?.tag ?? null
	if (!childTag) {
		fx.diagnostics.push(
			diagnostic.composedComponentNotCompiled(
				fx.source,
				node.node,
				node.component,
				node.source,
			),
		)
		return
	}
	const refAttr = refOf(node)
	if (refAttr && !ambiguous.has(node))
		fx.diagnostics.push(
			diagnostic.unsupported(
				fx.source,
				node.node,
				`A \`first()\` reference to <${childTag}> as the root of an arm of ${where}`,
				"The arm is adopted or cloned afresh on every flip, so a reference taken at connect goes stale — pass the child its props with `truc:pass` instead: its entries plan in the arm's mount.",
			),
		)
	// Handler args (LT-461): the arm root IS the child's element, so each
	// placement's own selector queries from it through the arm's `first`.
	planComposeHandlers(
		fx,
		node,
		'',
		(selector, optional, base) => {
			const local = uniqueName(fx.usedNames, base)
			plan.locals.push({
				name: local,
				selector,
				message: `${fx.component.tag}: ${selector} missing`,
				...(optional ? { optional: true } : {}),
			})
			return local
		},
		plan.effects,
		badNames,
	)
	const passAttrs = node.attrs.filter(
		(a): a is Extract<(typeof node.attrs)[number], { kind: 'pass' }> =>
			a.kind === 'pass',
	)
	if (passAttrs.length === 0) return
	const entries = passAttrs.flatMap(a => a.entries)
	checkPassEntries(fx, entries, childTag, node.node)
	// Type-flow import: the composed child's tag-map augmentation must
	// reach the client module even though no factory query names it.
	if (childTag !== fx.component.tag && fx.registry.has(childTag))
		fx.childTags.add(childTag)
	plan.root = { name: rootName, tag: childTag }
	emitPassEntries(fx, entries, rootName, plan.effects, badNames)
}

/**
 * A compose site inside an arm, below its root (LT-461): its handler args
 * bind in the arm's mount through arm locals, the site addressed within
 * the arm root. A `first()` or `truc:pass` on such a site is refused by the
 * arm-shape check (`unmountableInArm`); a handler is the per-arm channel.
 */
export const planArmComposeHandlers = (
	fx: ComposeEffectsContext,
	node: ComposeNode,
	armRoot: ElementNode,
	plan: ArmPlan,
	badNames: (node: AstNode) => string[],
): void => {
	if (fx.composeRefs.mode === 'skipped' || ownHandlersOf(node).length === 0)
		return
	const childTag = fx.composeRefs.registry.get(node.source)?.tag ?? null
	if (!childTag) return
	const site = composeSiteSelector(
		fx,
		armRoot,
		childTag,
		node,
		'a handler arg needs a unique target',
		'arm',
	)
	if ('refusal' in site) {
		fx.handledComposes.add(node)
		fx.diagnostics.push(
			diagnostic.unaddressableElement(fx.source, node.node, site.refusal),
		)
		return
	}
	planComposeHandlers(
		fx,
		node,
		site.selector,
		(selector, optional, base) => {
			const local = uniqueName(fx.usedNames, base)
			plan.locals.push({
				name: local,
				selector,
				message: `${fx.component.tag}: ${selector} missing`,
				...(optional ? { optional: true } : {}),
			})
			return local
		},
		plan.effects,
		badNames,
	)
}

/**
 * The client constructs a compose site's content carries (ADR 0048 s1):
 * the content is this scope's markup, rendered into the child's Children
 * Region, so its `first()` references query from here, and a reactive
 * `truc:html` on one of its elements is the parent's own sanitized binding
 * (LT-492) — planned exactly like an element of the template proper: one
 * query under the reference's name when the author addressed the element,
 * else the tag's, and the shared construct emission (the watch-html sink).
 * References without the attribute keep today's query-only shape; a
 * non-reactive `truc:html` needs nothing here (the server render splices
 * it, sanitized, into the children string). Everything else is LTC011's,
 * nested compose sites included, so the walk stops at them — and a site
 * the host walk cannot reach (inside an arm, a list item or a
 * server-rendered branch) is `validateArmSetPlacement`'s refusal, which is
 * why this function runs only from the host-level walk.
 */
export const planContentConstructs = (
	fx: ComposeEffectsContext,
	node: ComposeNode,
): void => {
	for (const child of node.children)
		walkTemplate(
			child,
			inner => {
				if (!isElement(inner)) return
				const refAttr = refOf(inner)
				const reactiveHtml = inner.attrs.some(
					a => a.kind === 'html' && a.reactive,
				)
				if (!refAttr && !reactiveHtml) return
				const { selector, unique } = resolveSelector(fx, inner)
				if (!unique)
					fx.diagnostics.push(
						diagnostic.unaddressableElement(
							fx.source,
							inner.node,
							`No unique selector for <${inner.tag}> in the content passed to <${node.component}> — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
						),
					)
				const query = fx.addQuery(
					refAttr?.name ?? sanitizeVarName(inner.tag),
					selector,
					'one',
				)
				if (reactiveHtml) emitConstructEffects(fx, inner, query)
			},
			{ intoCompose: false },
		)
}

/**
 * LT-090: a static `id` on a compose site materializes on that
 * instance's host element (`composeHostAttrs`) — duplicated across
 * sites it is two elements sharing an id in the same rendered
 * document, invalid HTML, and id-based addressing resolves to at most
 * one of them. Template-cloned arms keep the same property by
 * structure: only the winning arm is ever in the document (ADR 0037
 * s4), so only compose sites can collide. Shares nothing with effect
 * planning — a standalone validation (LT-226), like the front end's
 * post-lowering tail.
 */
export const validateComposeIds = (fx: ComposeEffectsContext): void => {
	const { component, source, diagnostics } = fx
	const idSites = new Map<string, ComposeNode[]>()
	for (const composeNode of allComposeNodes(component.root)) {
		const id = composeStaticAttrs(composeNode).get('id')
		if (id == null) continue
		const sites = idSites.get(id) ?? []
		sites.push(composeNode)
		idSites.set(id, sites)
	}
	for (const [id, sites] of idSites) {
		const [, second] = sites
		if (!second) continue
		diagnostics.push(
			diagnostic.duplicateComposeId(source, second.node, id, sites.length),
		)
	}
}
