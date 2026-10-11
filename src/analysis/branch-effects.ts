import { type AstNode, freeIdentifiers, sanitizeVarName } from '../ast-utils'
import {
	type BoundaryArmRoot,
	boundaryDeepConstructOf,
	htmlThunkSignalName,
	isBoundaryArmRoot,
	lazyCatchMessageEl,
} from '../boundary-arms'
import { diagnostic, type Site } from '../diagnostics'
import { dependenciesOf } from '../evaluability'
import { initialFold } from '../initial-winner'
import type { ForIR, TemplateNode } from '../ir'
import { wordingOf } from '../surface'
import { rangeFields, resolutionOf } from '../tier'
import {
	armSetOf,
	type ConditionalNode,
	childNodes,
	elseOf,
	hasArmSet,
	isClientConstructAttr,
	isIf,
	someNode,
	thenOf,
	walkTemplate,
} from '../walk'
import {
	composeArmRootTag,
	planArmComposeHandlers,
	planArmRootComposePass,
} from './compose-effects'
import {
	constructSignatureOf,
	directLazyCatchRef,
	directLazyIdentifier,
	emitConstructEffects,
	hasClientConstructs,
	hasDeepConstruct,
	hasOwnConstruct,
	isInsideCompose,
	lazyChildOf,
	selectorOf,
	startOf,
	suppresses,
} from './construct-effects'
import type { EffectsContext } from './effects'
import { loopFor, resolveSelector, selectorFor } from './effects'
import {
	armContainer,
	collectBranchKeyAttrs,
	collectKeyAttrs,
	type MountScope,
	mountScope,
	planNested,
	unmountableInArm,
} from './mount-scopes'
import { uniqueName } from './naming'
import type { ArmPlan, TopEffectPlan } from './plan'
import {
	type ElementNode,
	type IfNode,
	isElement,
	refOf,
	resolveComposeContentSelector,
	resolveExclusiveSelectorIn,
	type SwitchNode,
	type TryNode,
} from './selectors'
import { reportServerOnlyNames } from './server-only-names'

type BranchEffectsContext = Pick<
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

const handleOptionalBranch = (
	fx: BranchEffectsContext,
	// readonly so `handlePerBranchIfEffects` can pass a branch out of its
	// readonly tuple without a cast.
	body: readonly TemplateNode[],
	atNode: { node: AstNode },
	label: string,
	resolve: (el: ElementNode) => { selector: string; unique: boolean } = (
		el: ElementNode,
	) => selectorFor(fx, el),
): void => {
	const { source, diagnostics, effects, addQuery, collectAmbient } = fx
	const roots = body.filter(isElement)
	for (const root of roots)
		if (hasDeepConstruct(root))
			diagnostics.push(
				diagnostic.unsupported(
					source,
					root.node,
					`A client construct below the root element of ${label}`,
					'The deeper element exists only when the arm rendered — move the construct onto the root element.',
				),
			)
	const clientStmts = body.filter(
		(n): n is TemplateNode & { kind: 'client-stmt' } =>
			n.kind === 'client-stmt',
	)
	const constructedRoots = roots.filter(hasOwnConstruct)
	//: an element the author addressed with `first()` carries its OWN query
	// and presence guard, so it does not compete for the branch's single
	// addressable root — the one-root limit covers only branch ROOTs with
	// no ref, addressed by a synthesized selector standing in for
	// "whichever branch rendered". `refOf` is total over ref kinds.
	const unaddressed = constructedRoots.filter(el => !refOf(el))
	if (unaddressed.length > 1) {
		diagnostics.push(
			diagnostic.unsupported(
				source,
				atNode.node,
				`More than one element with client constructs in ${label}`,
				'The client addresses one root per arm — give the extra element its own `first()` reference, or address it through a hoisted const that the first element references.',
			),
		)
		return
	}
	const primary = unaddressed[0] ?? constructedRoots[0] ?? roots[0] ?? null
	// Every OTHER constructed root in this branch is ref-addressed (the
	// filter above proved it) and gets its own guarded effect below.
	const extras = constructedRoots.filter(el => el !== primary)
	const hasConstructs =
		clientStmts.length > 0 || (primary ? hasOwnConstruct(primary) : false)
	if (!hasConstructs) return
	if (!primary) {
		diagnostics.push(
			diagnostic.unsupported(
				source,
				atNode.node,
				`A bare client-only statement in ${label} with no element beside it`,
				'The client tests an element to learn whether the arm rendered — render an element beside the statement.',
			),
		)
		return
	}
	const resolved = resolve(primary)
	if (!resolved.unique) {
		diagnostics.push(
			diagnostic.unaddressableElement(
				source,
				primary.node,
				`No unique selector for ${label}'s root <${primary.tag}> — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
			),
		)
		return
	}
	const refAttr = refOf(primary)
	const query = addQuery(
		refAttr?.name ?? sanitizeVarName(primary.tag),
		resolved.selector,
		'maybe',
	)
	const guarded: TopEffectPlan[] = []
	for (const stmt of body) {
		if (stmt.kind === 'client-stmt') {
			collectAmbient(stmt.node)
			guarded.push({
				kind: 'raw',
				text: stmt.text,
				sourceStart: stmt.node.start,
				sourceEnd: stmt.node.end,
			})
			continue
		}
		if (stmt === primary) emitConstructEffects(fx, primary, query, guarded)
	}
	effects.push({ kind: 'guarded', query, effects: guarded })
	//: each ref-addressed sibling in the same branch, on its own
	// query and its own guard. Bare client-only statements stay with the
	// primary — they are guarded by "did this branch render", which the
	// primary's presence already answers; duplicating them under every
	// sibling's guard would run them once per element.
	for (const extra of extras) {
		const extraResolved = resolve(extra)
		if (!extraResolved.unique) {
			diagnostics.push(
				diagnostic.unaddressableElement(
					source,
					extra.node,
					`No unique selector for the \`first()\`-addressed <${extra.tag}> inside ${label} — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
				),
			)
			continue
		}
		const extraName = refOf(extra)?.name
		if (!extraName) continue
		const extraQuery = addQuery(extraName, extraResolved.selector, 'maybe')
		const extraEffects: TopEffectPlan[] = []
		emitConstructEffects(fx, extra, extraQuery, extraEffects)
		effects.push({
			kind: 'guarded',
			query: extraQuery,
			effects: extraEffects,
		})
	}
}

/** A single-branch `@if` (no `@else`) — see `handleOptionalBranch`. */
const handleOptionalIfEffects = (
	fx: BranchEffectsContext,
	node: IfNode,
): void =>
	handleOptionalBranch(
		fx,
		thenOf(node),
		node,
		wordingOf(fx.component).singleBranchIf,
	)

/**
 * An `@if`/`@else` whose branch roots carry DIFFERING client constructs —
 * addressed per branch, like a plain `@try`'s two arms: exclusivity is
 * structural, so mutually-exclusive branches never double-bind.
 * Precondition checked up front (`resolveExclusiveSelectorIn`): each
 * addressed root's selector must not match the OTHER branch's markup —
 * two existence guards over one selector would both be true on the one
 * rendered element. Roots indistinguishable by statics keep a LTC007
 * error naming the fix, rather than a plausible-but-wrong double binding.
 */
const handlePerBranchIfEffects = (
	fx: BranchEffectsContext,
	node: IfNode,
): void => {
	const { component, source, diagnostics } = fx
	const wording = wordingOf(component)
	const branches: Array<
		[string, readonly TemplateNode[], readonly TemplateNode[]]
	> = [
		[wording.thenBranch, thenOf(node), elseOf(node)],
		[wording.elseBranch, elseOf(node), thenOf(node)],
	]
	// Validate every branch needing addressing BEFORE any effects are
	// planned — a collision diagnostic must not leave a half-planned @if.
	for (const [label, body, other] of branches) {
		const own = body.filter(isElement).filter(hasOwnConstruct)
		if (own.length === 0) continue
		const root = own[0] as ElementNode
		const resolved = resolveExclusiveSelectorIn(
			component.root,
			root,
			other,
			component.composedShapes,
		)
		if (resolved.unique) continue
		const plain = resolveSelector(fx, root)
		if (!plain.unique) continue // no unique selector at all — reported below
		const otherLabel =
			label === wording.thenBranch ? wording.elseBranch : wording.thenBranch
		diagnostics.push(
			diagnostic.unaddressableElement(
				source,
				root.node,
				`The ${label} root <${root.tag}> of this ${wording.if} has no selector that excludes the ${otherLabel} — \`${plain.selector}\` is unique in the template but matches the ${otherLabel} root too, so the effects of both branches would bind whichever root rendered. Add distinguishing static attributes to the branch roots, or make the client constructs identical across branches (union addressing).`,
			),
		)
		return
	}
	for (const [label, body, other] of branches)
		handleOptionalBranch(fx, body, node, `the ${label}`, el =>
			resolveExclusiveSelectorIn(
				component.root,
				el,
				other,
				component.composedShapes,
			),
		)
}

/**
 * @if branches: client constructs must sit on the branch ROOT elements.
 * With IDENTICAL construct text on every branch root, the client
 * addresses whichever branch rendered through a union selector
 * (`first('textarea, input[type="text"]')`) — one effect covers all.
 * With DIFFERING constructs, each branch is addressed on its own — see
 * `handlePerBranchIfEffects`. A branch with no `@else` may not render at
 * all — see `handleOptionalIfEffects` for that (DOM-existence-guarded)
 * case.
 */
export const handleIfEffects = (
	fx: BranchEffectsContext,
	node: IfNode,
): void => {
	const { source, diagnostics, addQuery } = fx
	const wording = wordingOf(fx.component)
	if (elseOf(node).length === 0) {
		handleOptionalIfEffects(fx, node)
		return
	}
	const roots = [...thenOf(node), ...elseOf(node)].filter(isElement)
	for (const root of roots)
		if (hasDeepConstruct(root))
			diagnostics.push(
				diagnostic.unsupported(
					source,
					root.node,
					`A client construct below a branch root of this ${wording.if}`,
					'The deeper element exists only when its branch rendered — move the construct onto the branch root.',
				),
			)
	const clientStmts = [...thenOf(node), ...elseOf(node)].filter(
		(n): n is TemplateNode & { kind: 'client-stmt' } =>
			n.kind === 'client-stmt',
	)
	// Each branch may carry only ONE UNADDRESSED element of its own — the
	// union query addresses "whichever branch rendered", not siblings
	// within a branch. An element addressed with `first()` is exempt; a
	// branch carrying one routes to per-branch addressing below.
	for (const branch of [thenOf(node), elseOf(node)]) {
		const constructedInBranch = branch
			.filter(isElement)
			.filter(hasOwnConstruct)
			.filter(el => !refOf(el))
		if (constructedInBranch.length > 1) {
			diagnostics.push(
				diagnostic.unsupported(
					source,
					node.node,
					`More than one element with client constructs in one ${wording.ifBranch}`,
					`Union addressing binds one root per branch — split the markup into ${wording.separateIfs}, or address the extra element through a hoisted const that the first element references.`,
				),
			)
			return
		}
	}
	const constructedRoots = roots.filter(hasOwnConstruct)
	if (constructedRoots.length === 0) {
		for (const stmt of clientStmts)
			diagnostics.push(
				diagnostic.unsupported(
					source,
					stmt.node,
					`A bare client-only statement in ${wording.ifWithElse} with no addressed branch root`,
					`The client needs an addressed root to tell which branch rendered — add a client construct to one branch root (per-branch addressing), or use ${wording.singleBranchIfFix} instead.`,
				),
			)
		return
	}
	// routing: identical construct signatures on every branch root AND an
	// element root in every branch → union addressing; any difference (a
	// construct on only some roots — union emission reads the FIRST
	// constructed root only — or the same key with different text) →
	// per-branch. A text-only branch also routes per-branch: the union
	// query is cardinality 'one' and would throw on the branch-less side.
	const signatures = roots.map(constructSignatureOf)
	const everyBranchHasElementRoot = [thenOf(node), elseOf(node)].every(branch =>
		branch.some(isElement),
	)
	// A branch carrying MORE than one element root cannot be union-
	// addressed even with matching signatures: the union query resolves
	// to a single element per branch, so the siblings would go unbound.
	const everyBranchHasOneElementRoot = [thenOf(node), elseOf(node)].every(
		branch => branch.filter(isElement).length === 1,
	)
	const unionCompatible =
		everyBranchHasElementRoot &&
		everyBranchHasOneElementRoot &&
		signatures.length > 0 &&
		signatures.every(s => s !== '' && s === signatures[0])
	if (!unionCompatible) {
		handlePerBranchIfEffects(fx, node)
		return
	}
	// Union path: a bare client-only statement stays rejected here — a
	// union query proves SOME branch rendered, never WHICH one.
	for (const stmt of clientStmts)
		diagnostics.push(
			diagnostic.unsupported(
				source,
				stmt.node,
				`A bare client-only statement in ${wording.ifWithElse} with identical branch constructs`,
				`Union addressing cannot tell which branch rendered — make the branch constructs differ (per-branch addressing), or use ${wording.singleBranchIfFix} instead.`,
			),
		)
	// truc:html={dataRef} is server-rendered only — not a client construct.
	const primary = roots.find(r => r.attrs.some(isClientConstructAttr))
	if (!primary) return
	const resolved = selectorFor(fx, primary)
	if (!resolved.unique) {
		diagnostics.push(
			diagnostic.unaddressableElement(
				source,
				primary.node,
				`No unique selector for the ${wording.ifBranch} root <${primary.tag}> — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
			),
		)
		return
	}
	const refAttr = refOf(primary)
	const query = addQuery(
		refAttr?.name ?? sanitizeVarName(primary.tag),
		resolved.selector,
		'one',
	)
	emitConstructEffects(fx, primary, query)
}

/**
 * @switch arms render exclusively — a construct in one arm would make
 * its element missing whenever another arm renders, so arms must be
 * construct-free markup (use @if with identical branch constructs for
 * interactive alternatives).
 */
export const handleSwitchEffects = (
	fx: BranchEffectsContext,
	node: SwitchNode,
): void => {
	const { source, diagnostics } = fx
	const wording = wordingOf(fx.component)
	for (const arm of node.arms)
		for (const child of arm.children)
			if (hasClientConstructs(child))
				diagnostics.push(
					diagnostic.unsupported(
						source,
						(child as ElementNode).node ?? node.node,
						`A client construct in ${wording.switchArms}`,
						`Only one arm renders, so the element may not exist — keep the arms to static and server markup, or use ${wording.ifBranches} with identical constructs (union addressing).`,
					),
				)
}

/**
 * An async boundary (`@try`/`@pending`/`@catch`): `lowerTry` already
 * proved each arm has exactly one root element. The server renders the
 * winner live beside the three arm templates (`emit-server.ts`); the
 * client switches them through `reconcile()`'s arm form, keyed by the
 * guarded task's state, and the `ok`/`err` mounts write the resolved
 * value and the error text.
 */
export const handleAsyncBoundary = (
	fx: BranchEffectsContext,
	node: TryNode,
	scope: MountScope | null = null,
): void => {
	const {
		component,
		source,
		diagnostics,
		usedNames,
		// The same scope rule as every other arm-set handler: inside a
		// reactive-list item this is `badListBodyNames`, so a setup-const or
		// import read in an arm's client positions — the ok arm's constructs
		// and a compose arm root's pass entries — is LTC005 like on any
		// other list-body position.
		scopeBadNames: badNames,
	} = fx
	const wording = wordingOf(component)
	const okRoot = node.children.find(isBoundaryArmRoot) as BoundaryArmRoot
	const pendingRoot = (node.pendingChildren as TemplateNode[]).find(
		isBoundaryArmRoot,
	) as BoundaryArmRoot
	const errRoot = node.catchChildren.find(isBoundaryArmRoot) as BoundaryArmRoot
	const catchParam = node.catchParam

	const errMsgEl = lazyCatchMessageEl(errRoot, catchParam)
	// A composed element's server args are evaluated where the render call
	// is emitted — in the live arm AND in the arm templates, which sit
	// outside the catch binding. A child's own rendering of an arg has no
	// client write channel, so a catch-parameter read in an arg has no
	// lowering: the message must travel through composed content instead.
	if (catchParam !== null) {
		for (const [armRoot, which] of [
			[okRoot, wording.tryBody],
			[pendingRoot, wording.pendingArm],
			[errRoot, wording.catchArm],
		] as const) {
			let offender: { at: AstNode; arg: string } | null = null
			walkTemplate(
				armRoot,
				node => {
					if (node.kind !== 'compose' || offender !== null) return
					for (const attr of node.attrs) {
						if (attr.kind !== 'arg' || attr.node === null) continue
						if ([...freeIdentifiers(attr.node)].includes(catchParam)) {
							offender = { at: attr.node, arg: attr.name }
							return
						}
					}
				},
				{ intoCompose: false },
			)
			if (offender !== null) {
				const { at, arg } = offender as { at: AstNode; arg: string }
				diagnostics.push(
					diagnostic.unsupported(
						source,
						at,
						`A composed element's \`${arg}\` arg reading the catch parameter \`${catchParam}\` in the ${which} of an async boundary`,
						`An arm template renders outside the catch binding, and the child's own rendering of an arg has no client write. Render the message through composed content instead: \`<CardCallout><p class="error">{${catchParam}.message}</p></CardCallout>\` — the arm's value channel writes it on flip.`,
					),
				)
				return
			}
		}
	}
	// The ok/err arms' construct walk. An offender INSIDE composed content
	// renders into the child's markup, where no write can address it — the
	// fix is wrapping it in an element of the author's own, not moving it
	// onto the arm root (the generic advice is impossible there, the root
	// being a compose site or the construct sitting in composed content).
	const okOffender = boundaryDeepConstructOf(okRoot, null, null)
	const errOffender = boundaryDeepConstructOf(errRoot, errMsgEl, catchParam)
	const constructHit =
		okOffender !== null
			? { root: okRoot, node: okOffender }
			: errOffender !== null
				? { root: errRoot, node: errOffender }
				: null
	if (constructHit !== null) {
		const { root: hitRoot, node: hitNode } = constructHit
		const inComposed = isInsideCompose(hitRoot, hitNode)
		diagnostics.push(
			diagnostic.unsupported(
				source,
				hitNode.node,
				'A client construct below the root element of an async-boundary arm',
				inComposed
					? `The composed content renders inside the child's markup, where no write can address it — wrap the read in an element of your own, for example \`<p class="error">{${catchParam ?? 'e'}.message}</p>\`, which the arm's value channel writes on flip.`
					: "Deeper elements have no addressing (ADR 0005 sub-design 13) — move the construct onto the arm's root element.",
			),
		)
		return
	}
	// The pending arm keeps the DEEP construct walk: `hasOwnConstruct`
	// alone sees only the root's own attrs and direct lazy children, so a
	// reactive construct nested below the pending root compiled silently
	// after the ok/err walk grew offender attribution.
	const pendingOffender = boundaryDeepConstructOf(pendingRoot, null, null)
	if (
		pendingRoot.kind === 'element'
			? hasOwnConstruct(pendingRoot) || pendingOffender !== null
			: pendingOffender !== null
	) {
		const inComposed =
			pendingOffender !== null && isInsideCompose(pendingRoot, pendingOffender)
		diagnostics.push(
			diagnostic.unsupported(
				source,
				pendingOffender?.node ?? pendingRoot.node,
				`A client construct in the ${wording.pendingArm} of an async boundary`,
				inComposed
					? "The composed content renders inside the child's markup, where no write can address it — and nothing watches the pending arm once the signal resolves. Keep the arm to static and server markup."
					: 'Nothing watches the pending arm once the signal resolves — keep it to static and server markup.',
			),
		)
		return
	}

	const okLazyName =
		okRoot.kind === 'element' ? directLazyIdentifier(okRoot) : null
	const htmlSignalName = htmlThunkSignalName(okRoot)
	const driverName = okLazyName ?? htmlSignalName
	const boundaryCandidates = component.signals.filter(
		s =>
			(s.constructor === 'deriveCell' || s.constructor === 'createTask') &&
			s.name === driverName,
	)
	if (!driverName || boundaryCandidates.length !== 1) {
		diagnostics.push(
			diagnostic.unsupported(
				source,
				okRoot.node,
				`An async boundary whose ${wording.tryBody} neither renders its async signal as a direct lazy child nor reads it through a \`truc:html\` thunk`,
				'The compiler learns which signal drives the `isPending()` routing from that channel — render the `deriveCell(async …)` or `createTask(…)` signal directly, for example `{data}`, or read it on the arm root with `truc:html={() => data.get()}`.',
			),
		)
		return
	}
	const signal = boundaryCandidates[0]?.name as string
	// The attribute channel: the value reaches the arm root through the
	// `truc:html` watch, so the root's own client constructs become the ok
	// arm's effects. The child channel keeps the child-only contract.
	// Element-root vocabulary: a compose root carries no `truc:html`.
	const okElement = okRoot.kind === 'element' ? okRoot : null
	const viaHtmlThunk =
		okElement !== null && okLazyName === null && htmlSignalName !== null
	if (
		!viaHtmlThunk &&
		okRoot.kind === 'element' &&
		okRoot.attrs.some(isClientConstructAttr)
	) {
		diagnostics.push(
			diagnostic.unsupported(
				source,
				okRoot.node,
				`A reactive construct on the ${wording.tryBody} root of an async boundary`,
				"That root takes static and server attributes and its one lazy signal child only — move the construct onto a child element, or read the signal through `truc:html={() => data.get()}` on the root, which plans root constructs as the ok arm's effects.",
			),
		)
		return
	}
	if (errRoot.kind === 'element' && errRoot.attrs.some(isClientConstructAttr)) {
		diagnostics.push(
			diagnostic.unsupported(
				source,
				errRoot.node,
				`A reactive construct in the ${wording.catchArm} of an async boundary`,
				'The arm takes static and server attributes and its one lazy error child only — remove the construct.',
			),
		)
		return
	}

	const directErrText =
		catchParam && errRoot.kind === 'element'
			? directLazyCatchRef(errRoot, catchParam)
			: null
	const errText =
		directErrText ??
		(errMsgEl && catchParam ? directLazyCatchRef(errMsgEl, catchParam) : null)
	if (
		errRoot.children.some(
			c => c.kind === 'expr' && c.reactivity === 'reactive',
		) &&
		directErrText === null
	) {
		diagnostics.push(
			diagnostic.unsupported(
				source,
				errRoot.node,
				`A lazy child in the ${wording.catchArm} that does not read the catch parameter \`${catchParam ?? 'e'}\``,
				`Render a text member of it, for example \`{${catchParam ?? 'e'}.message}\` — the parameter itself is an \`Error\`, which a text position does not take (ADR 0024 s6).`,
			),
		)
		return
	}
	// One catch read per arm: the err branch writes a single text target, so
	// a direct read on the root beside a nested message element would land
	// the root's text in the nested element and drop the nested read.
	if (directErrText !== null && errMsgEl !== null) {
		diagnostics.push(
			diagnostic.unsupported(
				source,
				errMsgEl.node,
				`A ${wording.catchArm} that reads the catch parameter \`${catchParam ?? 'e'}\` both on its root and in a nested element`,
				`Keep one read of \`${catchParam ?? 'e'}\` per arm — either directly in the root, for example \`{${catchParam ?? 'e'}.message}\`, or in one child element of the root.`,
			),
		)
		return
	}

	const container = armContainer(fx, node, `a ${wording.boundary}`, scope)
	if (container === null) return
	const arm = (key: string): ArmPlan => ({
		key,
		caseText: null,
		renders: true,
		root: null,
		locals: [],
		keyAttrs: [],
		effects: [],
	})
	const okArm = arm('ok')
	if (viaHtmlThunk && okElement !== null) {
		// The ok root's client constructs are the ok arm's effects: the
		// `truc:html` watch is the value channel, and a reactive style/class
		// thunk rides beside it — both mounted inside `bindArm`'s ok branch,
		// dying with the arm. No descendants: the deep-construct refusal
		// above kept the root the only construct-bearing element.
		const rootName = uniqueName(usedNames, sanitizeVarName(okElement.tag))
		okArm.root = { name: rootName, tag: okElement.tag }
		fx.armSelectors.set(rootName, resolveSelector(fx, okElement).selector)
		emitConstructEffects(fx, okElement, rootName, okArm.effects, badNames)
	}
	// The nested message element (through composed content too) writes
	// through an arm-scoped `first` local; the depth-0 channel keeps
	// writing the root. Inside composed content the selector must be a
	// role or a class/id/data-* discriminator: the child renders markup
	// the compiler cannot see, so a bare tag could match one of ITS
	// elements and the arm's value would overwrite it.
	const errArm = arm('err')
	if (errMsgEl !== null) {
		const inComposed = isInsideCompose(component.root, errMsgEl)
		const resolved = inComposed
			? resolveComposeContentSelector(errMsgEl)
			: resolveSelector(fx, errMsgEl)
		if (resolved === null) {
			diagnostics.push(
				diagnostic.unsupported(
					source,
					errMsgEl.node,
					`The ${wording.catchArm}'s message element <${errMsgEl.tag}> inside composed content has no \`role\`, \`class\`, \`id\` or \`data-*\` attribute`,
					`The arm's write addresses it by selector, and the child's own markup can carry the same bare <${errMsgEl.tag}> — give the message element a distinguishing attribute, for example \`<p class="error">{${catchParam ?? 'e'}.message}</p>\`.`,
				),
			)
			return
		}
		errArm.locals.push({
			name: uniqueName(usedNames, 'errMessage'),
			selector: resolved.selector,
			message: `the ${wording.catchArm}'s message element`,
		})
	}
	//: a compose arm root's `truc:pass` entries plan in the arm's mount
	// against the arm element parameter. The ok arm is absent on purpose:
	// a compose try-body root has neither a lazy-child nor a `truc:html`
	// channel, so the driver detection above already refused it.
	const nilArm = arm('nil')
	if (pendingRoot.kind === 'compose') {
		const pendingTag = composeArmRootTag(fx, pendingRoot)
		planArmRootComposePass(
			fx,
			pendingRoot,
			uniqueName(usedNames, sanitizeVarName(pendingTag)),
			nilArm,
			badNames,
			`a ${wording.boundary}`,
		)
	}
	if (errRoot.kind === 'compose') {
		const errTag = composeArmRootTag(fx, errRoot)
		planArmRootComposePass(
			fx,
			errRoot,
			uniqueName(usedNames, sanitizeVarName(errTag)),
			errArm,
			badNames,
			`a ${wording.boundary}`,
		)
	}
	;(scope?.sink ?? fx.effects).push({
		kind: 'arms',
		arms: {
			container,
			armSet: armSetOf(component.root, node),
			construct: 'try',
			testText: signal,
			sourceStart: undefined,
			elementParam: uniqueName(usedNames, 'armElement'),
			keyParam: uniqueName(usedNames, 'armKey'),
			arms: [okArm, nilArm, errArm],
			boundary: {
				signal,
				errText,
				okStart: startOf(okElement ? lazyChildOf(okElement)?.expr : undefined),
				errStart:
					startOf(
						errMsgEl !== null ? lazyChildOf(errMsgEl)?.expr : undefined,
					) ??
					startOf(
						errRoot.kind === 'element' ? lazyChildOf(errRoot)?.expr : undefined,
					),
			},
		},
	})
}

/**
 * @try error boundaries: the body and catch arm render mutually
 * exclusively — whichever one the server actually rendered is the only
 * one that exists in the DOM, exactly the DOM-existence-guarded shape a
 * single-branch `@if` has (each arm gets its own `handleOptionalBranch`
 * call, independently — NOT union addressing like `@if`/`@else`, since
 * the two arms are different content, not the same construct duplicated).
 *
 * A `@pending` arm present routes to `handleAsyncBoundary` instead — its
 * arms switch on the client through `reconcile()`, where this plain
 * boundary's arms are decided once, at render time.
 */
export const handleTryEffects = (
	fx: BranchEffectsContext,
	node: TryNode,
): void => {
	const wording = wordingOf(fx.component)
	if (node.pendingChildren !== null) {
		handleAsyncBoundary(fx, node)
		return
	}
	handleOptionalBranch(fx, node.children, node, `the ${wording.tryBody}`)
	handleOptionalBranch(fx, node.catchChildren, node, `the ${wording.catchArm}`)
}

/**
 * The server-rendered branch a node sits under, named by the enclosure that
 * set it: a server-mode conditional's arms, or a server-only `try`'s body
 * vs its catch arm. The nearest enclosure wins — a `try` inside a server
 * conditional's arm, or a server conditional inside the `try`, re-keys the
 * flag to itself on the way down.
 */
type ServerBranch = false | 'conditional' | 'try-body' | 'try-catch'

/** The fix clause per server-branch enclosure for a `truc:pass` onto a composed child. */
const serverBranchFix = (
	branch: 'conditional' | 'try-body' | 'try-catch',
): string => {
	if (branch === 'try-body')
		return 'The `try` renders its body once per render, and its body cannot hold the pass — move the composed child out of the `try`.'
	if (branch === 'try-catch')
		return 'The catch arm folds once per render, so the pass would address markup that never re-renders — add a pending arm, which makes the `try` an async boundary whose catch arm binds the pass.'
	return 'The branch folds once per render, so the pass would address markup that never re-renders — make the condition reactive: the composed child then renders as its arm’s root.'
}

/**
 * The fix clause per enclosure, for a content element a `first()` reference
 * addresses. The reference plans where the host walk reaches the site; in
 * an arm or a list item its elements are recreated besides, so the clause
 * names the staleness the author would hit there too.
 */
const contentRefFix = (
	inArm: boolean,
	loop: ForIR | null,
	inServerBranch: ServerBranch,
): string => {
	if (inArm)
		return 'The arm is recreated from its template on every switch, so a reference taken at connect goes stale — move the composed child out of the arm.'
	if (loop?.kind === 'reconcile')
		return 'The item’s elements exist once per item and are recreated on every reconcile, so a reference taken at connect binds the first item’s — move the composed child out of the loop.'
	if (loop?.kind === 'each')
		return 'The content renders once per item, so a reference taken at connect could only ever bind one item’s markup — move the composed child out of the loop.'
	if (inServerBranch === 'try-body')
		return 'The `try` renders its body once per render, and its body cannot hold the reference — move the composed child out of the `try`.'
	if (inServerBranch === 'try-catch')
		return 'The catch arm folds once per render, so the reference would address markup that never re-renders — move the composed child out of the catch arm.'
	return 'The branch folds once per render, so the reference would address markup that never re-renders — move the composed child out of the branch.'
}

/**
 * Every arm set (a reactive conditional, an async boundary) and every
 * nested reactive list must sit where a mount reaches it: directly in
 * an element of the host or of a Mount Scope — an arm, a list item —
 * never inside a server-rendered branch or composed content of that
 * scope, and never in a server-data loop body, whose `each()` binds each
 * item through its own element. One check over the whole template,
 * because a misplaced construct is exactly one the walk would never
 * visit.
 */
export const validateArmSetPlacement = (fx: BranchEffectsContext): void => {
	const { component, source, diagnostics } = fx
	const wording = wordingOf(component)
	const loopOutputs = new Map<TemplateNode, ForIR>(
		[...component.fors.values()].map(loop => [loop.output, loop] as const),
	)
	const visit = (
		node: TemplateNode,
		enclosed: boolean,
		inServerBranch: ServerBranch,
		loop: ForIR | null,
		inArm: boolean,
	): void => {
		const own = loopOutputs.get(node) ?? null
		if (hasArmSet(node)) {
			const subject =
				node.kind === 'try'
					? `A ${wording.boundary}`
					: wording.reactiveConditional
			if (loop?.kind === 'each')
				diagnostics.push(
					diagnostic.unsupported(
						source,
						node.node,
						`${subject} inside a server-data ${wording.loop} body`,
						'`each()` binds each item through its own element, and an arm cloned after connect escapes it — move it out of the loop, or bind a reactive attribute on the item instead.',
					),
				)
			else if (enclosed)
				diagnostics.push(
					diagnostic.unsupported(
						source,
						node.node,
						`${subject} inside another control-flow branch or a composed element's content`,
						'Its arms switch inside the element that holds it, which the client must find at connect — move it out of the enclosing branch, or onto an element of its own.',
					),
				)
		} else if (own?.kind === 'reconcile' && loop?.kind === 'each') {
			diagnostics.push(
				diagnostic.unsupported(
					source,
					node.node,
					`A reactive-list ${wording.loop} inside a server-data ${wording.loop} body`,
					'`each()` binds the loop items once at connect and has no mount for a list in each item — move the list out of the loop.',
				),
			)
		}
		// A `truc:pass` onto a composed child in a server-rendered branch of
		// the host is refused here: the branch handlers never visit a compose
		// node, so without it the author's entries vanish with no error. The
		// same fold-fixed once-only addressing the item walk refuses one
		// scope down; the guarded alternative is rejected for the same reason
		// (a pass entry has no reactive core to guard). Keyed on
		// `inServerBranch`, not `enclosed`: composed content also encloses,
		// and a pass compose nested there is already the LTC011 nesting
		// refusal — a second LTC005 naming a server branch would name the
		// wrong enclosure. Skipped inside an arm (the arm walk refuses the
		// shape through `unmountableInArm`, including nested server branches)
		// and inside any list (the item walk refuses it in the item's own
		// branches). The fix clause is worded per enclosure: see
		// `serverBranchFix`.
		if (
			node.kind === 'compose' &&
			inServerBranch &&
			!inArm &&
			loop === null &&
			node.attrs.some(a => a.kind === 'pass')
		)
			diagnostics.push(
				diagnostic.unsupported(
					source,
					node.node,
					'A `truc:pass` onto a composed child in a server-rendered branch',
					serverBranchFix(inServerBranch),
				),
			)
		// A client construct in composed content is planned by the HOST walk
		// (`planContentConstructs`) — which never reaches a site inside an
		// arm, a loop body or a server-rendered branch. Refusing here, at the
		// one whole-template checkpoint, keeps those positions from compiling
		// with a silently inert binding or a dropped declaration the authored
		// statements still read. The data-reference `truc:html` form needs
		// no client half, so it stays legal in every scope.
		if (node.kind === 'compose' && (inArm || loop !== null || inServerBranch))
			for (const child of node.children)
				walkTemplate(
					child,
					inner => {
						if (!isElement(inner)) return
						const reactiveHtml = inner.attrs.some(
							a => a.kind === 'html' && a.reactive,
						)
						// The synthetic ref the authored `first()` attaches —
						// absent where the raw resolution refused the reference
						// already (a reactive arm or list item), so the two
						// faces never report one mistake twice.
						const refAttr = refOf(inner)
						if (!reactiveHtml && !refAttr) return
						const enclosure = inArm
							? 'an arm'
							: loop?.kind === 'reconcile'
								? 'a reactive-list loop body'
								: loop?.kind === 'each'
									? 'a server-data loop body'
									: 'a server-rendered branch'
						if (reactiveHtml) {
							const fix = inArm
								? 'The arm is recreated from its template on every switch, and the content renders server-side into each clone, so the binding goes stale on the first flip — move the composed child out of the arm.'
								: loop !== null
									? 'The content renders per item and its elements are recreated on every pass, so a host-level binding addresses stale markup — move the composed child out of the loop.'
									: inServerBranch === 'try-body'
										? 'The `try` renders its body once per render, and its body cannot hold the binding — move the composed child out of the `try`.'
										: inServerBranch === 'try-catch'
											? 'The catch arm folds once per render, so the binding would address markup that never re-renders — move the composed child out of the catch arm.'
											: 'The branch folds once per render, so the binding would address markup that never re-renders — move the composed child out of the branch.'
							diagnostics.push(
								diagnostic.unsupported(
									source,
									inner.node,
									`A reactive \`truc:html\` in the content of a composed element inside ${enclosure}`,
									fix,
								),
							)
							return
						}
						diagnostics.push(
							diagnostic.unsupported(
								source,
								inner.node,
								`A \`first()\` reference to <${inner.tag}> in the content of a composed element inside ${enclosure}`,
								contentRefFix(inArm, loop, inServerBranch),
							),
						)
					},
					{ intoCompose: false },
				)
		// An arm and a reactive-list item are Mount Scopes: what sits inside
		// starts over from its own mount. A server-data loop body stays
		// `each()`'s; a server-rendered branch or composed content encloses.
		let innerLoop = loop
		let innerEnclosed = enclosed
		let innerInArm = inArm
		let innerInServerBranch = inServerBranch
		// Set when this node is a server-only `try`: body and catch-arm
		// children carry different enclosures, so the child loop below keys
		// each child's branch kind by the arm holding it.
		let serverOnlyTry: TryNode | null = null
		if (hasArmSet(node)) {
			innerLoop = null
			innerEnclosed = false
			innerInArm = true
			innerInServerBranch = false
		} else if (own !== null) {
			innerLoop = own
			if (own.kind === 'reconcile') {
				innerEnclosed = false
				innerInServerBranch = false
			}
		} else if (node.kind === 'conditional' || node.kind === 'try') {
			innerEnclosed = true
			// A server-only `try` — no `@pending`, so not an arm set (the first
			// branch took those) — folds once per render into its body or
			// catch arm: both are server-rendered branches like a server
			// conditional's, so its `truc:pass` composes take the same
			// refusal, worded per arm.
			if (node.kind === 'try') serverOnlyTry = node
		} else if (node.kind === 'compose') {
			// Composed content encloses on its own: a pass compose nested in
			// it is the LTC011 nesting refusal, server branch around the
			// outer compose or not, so the flag does not survive the hop.
			innerEnclosed = true
			innerInServerBranch = false
		}
		if (node.kind === 'conditional' && node.mode === 'server')
			innerInServerBranch = 'conditional'
		for (const child of childNodes(node)) {
			let childBranch = innerInServerBranch
			if (serverOnlyTry)
				childBranch = serverOnlyTry.catchChildren.includes(child)
					? 'try-catch'
					: 'try-body'
			visit(child, innerEnclosed, childBranch, innerLoop, innerInArm)
		}
	}
	visit(component.root, false, false, null, false)
}

/**
 * A reactive conditional: its arms lower to `reconcile()`'s arm form —
 * templates the server stamps beside the live winner, a key thunk over the
 * test, and one mount per arm whose effects address the arm root and its
 * descendants inside the arm (collector parity). The conditional sits
 * directly in an element of its scope — the host or a Mount Scope — and
 * that element is the container the arm switches in, found at connect or
 * at the enclosing mount. Each arm is a Mount Scope: arm sets and lists
 * inside it plan into its mount.
 */
export const handleReactiveConditional = (
	fx: BranchEffectsContext,
	node: ConditionalNode,
	scope: MountScope | null = null,
): void => {
	const { component, source, diagnostics, usedNames } = fx
	const wording = wordingOf(component)
	const badNames = fx.scopeBadNames
	const unsupported = (at: Site, what: string, fix: string) => {
		diagnostics.push(diagnostic.unsupported(source, at, what, fix))
	}

	const containerQuery = armContainer(
		fx,
		node,
		'a condition that reads a signal',
		scope,
	)
	if (containerQuery === null) return

	// Arm shape: one root element per arm that renders anything. A compose
	// site is an arm root too — its rendered root is the child's own
	// element.
	const label = isIf(node) ? wording.ifBranch : `${wording.caseLabel} arm`
	for (const arm of node.arms) {
		if (arm.children.length === 0) continue
		const elements = arm.children.filter(isBoundaryArmRoot)
		const loose = arm.children.find(
			c =>
				c.kind !== 'element' &&
				c.kind !== 'compose' &&
				c.kind !== 'client-stmt',
		)
		if (elements.length !== 1 || loose) {
			unsupported(
				(loose ?? elements[1] ?? arm.children[0])?.node ?? node.node,
				`A ${label} that does not render exactly one root element, in a condition that reads a signal`,
				"The client clones each arm from a template with one root element — wrap the arm's content in a single element.",
			)
			return
		}
		// Nested arm sets and loops are scopes of their own: their content
		// answers to their own rules when they are planned.
		let blocked: { at: TemplateNode; what: string } | null = null
		const check = (inner: TemplateNode): void => {
			if (blocked || hasArmSet(inner)) return
			if (isElement(inner) && loopFor(fx, inner)) return
			const what = unmountableInArm(inner)
			if (what) {
				blocked = { at: inner, what }
				return
			}
			for (const child of childNodes(inner)) check(child)
		}
		for (const child of arm.children)
			for (const inner of childNodes(child)) check(inner)
		const rootLoop = loopFor(fx, elements[0] as ElementNode)
		if (rootLoop) blocked = { at: elements[0] as ElementNode, what: 'A loop' }
		if (blocked) {
			const { at, what } = blocked as { at: TemplateNode; what: string }
			unsupported(
				at.node ?? node.node,
				`${what} inside a ${label} of a condition that reads a signal`,
				"The arm's mount binds its root element and the elements inside it; this construct keeps addressing the host and would miss an arm cloned after connect — move it out of the arm.",
			)
			return
		}
	}

	// The client half: the key thunk reads what the test reads.
	fx.collectAmbient(node.test)
	reportServerOnlyNames(
		fx,
		node.test,
		isIf(node) ? wording.ifCondition : wording.switchDiscriminant,
		badNames(node.test),
	)
	// No server phase can pick the winner: no live arm renders, and the
	// component leaves the Folded tier — the realm, when it can answer,
	// renders the arm the client would. A test over an enclosing item is
	// per-item state: the live item renders its winner with the item in
	// scope, so it routes nothing.
	const itemScoped = [...dependenciesOf(node.test)].some(name =>
		fx.itemNames.has(name),
	)
	if (!itemScoped && !initialFold(component, node)) {
		fx.routingSignals.push({
			origin: 'LTC034',
			detail: `the initial arm of a ${isIf(node) ? 'conditional' : 'switch'} that reads a signal has no server-renderable value`,
			...rangeFields(source, node.test),
			resolution: resolutionOf(node.test, component.serverKnown),
		})
		//: a test over the wall clock or the RNG (limb b) has no winner in
		// ANY tier, the realm included — but the replayed client's
		// `reconcile()` clones one at connect when the component is Simulated
		// for another reason. Record the arm set so the driver strips that
		// arm before serializing, as it reverts every other limb-(b) site.
		if (suppresses(fx, node.test))
			fx.suppressedSites.push({
				kind: 'arms',
				selector: selectorOf(fx, containerQuery),
				armSet: armSetOf(component.root, node),
			})
	}

	const elementParam = uniqueName(usedNames, 'armElement')
	const keyParam = uniqueName(usedNames, 'armKey')
	const arms: ArmPlan[] = node.arms.map(arm => {
		const root = arm.children.find(isBoundaryArmRoot) ?? null
		const plan: ArmPlan = {
			key: arm.key,
			caseText: arm.testText,
			renders: root !== null,
			root: null,
			locals: [],
			keyAttrs: [],
			effects: [],
		}
		if (root === null) return plan
		// A compose arm root renders the child's own tag; the arm mount's
		// typed local (when anything reads it) casts to that element.
		const rootTag =
			root.kind === 'compose' ? composeArmRootTag(fx, root) : root.tag
		const rootName = uniqueName(usedNames, sanitizeVarName(rootTag))
		plan.root = { name: rootName, tag: rootTag }
		let rootUsed = false
		if (root.kind === 'element')
			fx.armSelectors.set(rootName, resolveSelector(fx, root).selector)
		const armScope = mountScope(fx, {
			// Composed content is never queried here (a reactive `truc:html`
			// in it is `validateArmSetPlacement`'s refusal — only the host
			// walk plans content constructs), so the scope root's
			// element-typed queries never touch the compose node.
			root: root as ElementNode,
			rootRef: () => {
				rootUsed = true
				return rootName
			},
			locals: plan.locals,
			sink: plan.effects,
			keyAttrs: plan.keyAttrs,
			label: `the arm root <${rootTag}>`,
		})
		for (const child of arm.children)
			if (child.kind === 'client-stmt') {
				fx.collectAmbient(child.node)
				plan.effects.push({
					kind: 'raw',
					text: child.text,
					sourceStart: child.node.start,
					sourceEnd: child.node.end,
				})
			}
		if (root.kind === 'element') {
			emitConstructEffects(fx, root, rootName, plan.effects, badNames)
			collectKeyAttrs(fx, armScope, root)
		} else {
			//: the arm root IS the child's rendered element — its
			// `truc:pass` entries plan in the arm's mount against the arm
			// element parameter, and a `first()` on the site stays refused.
			planArmRootComposePass(
				fx,
				root,
				rootName,
				plan,
				badNames,
				'a condition that reads a signal',
			)
		}
		const visitDescendants = (el: ElementNode): void => {
			for (const child of el.children) {
				if (planNested(fx, armScope, child)) continue
				if (child.kind === 'compose') {
					planArmComposeHandlers(fx, child, root as ElementNode, plan, badNames)
					continue
				}
				if (child.kind === 'conditional' && child.mode === 'server') {
					collectBranchKeyAttrs(fx, armScope, child)
					continue
				}
				if (!isElement(child)) continue
				if (hasOwnConstruct(child))
					emitConstructEffects(
						fx,
						child,
						armScope.localFor(child),
						plan.effects,
						badNames,
					)
				collectKeyAttrs(fx, armScope, child)
				visitDescendants(child)
			}
		}
		// Composed content carries no constructs in an arm (a reactive
		// `truc:html` in it is `validateArmSetPlacement`'s refusal), so the
		// descent never plans against the compose node itself.
		visitDescendants(root as ElementNode)
		// The root local is only declared when something reads it.
		if (
			!rootUsed &&
			!plan.effects.some(e => 'query' in e && e.query === rootName) &&
			!plan.keyAttrs.some(k => k.el === rootName)
		)
			plan.root = null
		return plan
	})

	;(scope?.sink ?? fx.effects).push({
		kind: 'arms',
		arms: {
			container: containerQuery,
			armSet: armSetOf(component.root, node),
			construct: node.construct,
			testText: node.testText,
			sourceStart: node.test.start,
			elementParam,
			keyParam,
			arms,
		},
	})
}
