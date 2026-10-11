import { type AstNode, nodeType, objectKeys } from '../ast-utils'
import { diagnostic } from '../diagnostics'
import { dependenciesOf } from '../evaluability'
import type {
	AttributeIR,
	EachForIR,
	ReconcileForIR,
	TemplateNode,
} from '../ir'
import { wordingOf } from '../surface'
import {
	inNestedScope,
	isClientConstructAttr,
	listIndexOf,
	walkTemplate,
} from '../walk'
import { dispatchOf } from './attr-dispatch'
import type {
	ForClientPlan,
	LoopEffectPlan,
	LoopPlans,
	PassShared,
	RebindingPlan,
	ReconcilePlan,
} from './plan'
import {
	type ElementNode,
	isElement,
	resolveScopedSelector,
	resolveSelectorIn as resolveSelectorScoped,
	selectorAdaptersOf,
	staticAttrs,
} from './selectors'
import { reportServerOnlyNames } from './server-only-names'
import { returnsNumber } from './thunk-types'

/* === Internal Functions === */

const isLoopConstruct = (a: AttributeIR): boolean =>
	isClientConstructAttr(a) && a.kind !== 'ref'

/** A loop construct `each()` has no lowering for — reported, not dropped. */
const isLoopUnloweredConstruct = (a: AttributeIR): boolean =>
	isLoopConstruct(a) &&
	a.kind !== 'reactive' &&
	a.kind !== 'class-map' &&
	a.kind !== 'event'

/** How a loop-body diagnostic names an unlowered construct. */
const loopConstructLabel = (a: AttributeIR): string => {
	switch (a.kind) {
		case 'style-map':
			return 'A reactive style map'
		case 'html':
			return 'A reactive `html` binding'
		case 'pass':
			return 'A `pass` binding'
		default:
			return `The prop-bound attribute \`${'name' in a ? a.name : a.kind}\``
	}
}

/** What planning one server-data loop reads from the pass context. */
type EachLoopContext = Pick<
	PassShared,
	| 'component'
	| 'source'
	| 'diagnostics'
	| 'addQuery'
	| 'usedNames'
	| 'collectAmbient'
	| 'badFreeNames'
	| 'badListBodyNames'
>

export const planEachLoop = (
	shared: EachLoopContext,
	loop: EachForIR,
	scope: { root: string; tree: ElementNode } | null,
): ForClientPlan | null => {
	const {
		component,
		source,
		diagnostics,
		addQuery,
		usedNames,
		collectAmbient,
		badListBodyNames,
	} = shared
	const wording = wordingOf(component)
	const { resolveSelector } = selectorAdaptersOf(component)
	const output = loop.output
	const loopBound = new Set<string>([loop.itemName])
	if (loop.indexName) loopBound.add(loop.indexName)
	// Map hoisted const → attribute it was rendered into as a bare value.
	const constAttr = new Map<string, string>()
	for (const attr of output.attrs) {
		if (attr.kind === 'server' && nodeType(attr.node) === 'Identifier')
			constAttr.set(attr.exprText, attr.name)
	}

	const referencedConsts = new Set<string>()
	const checkClientNames = (node: AstNode, what: string): void => {
		collectAmbient(node)
		const free = dependenciesOf(node)
		const loopRefs = [...free].filter(name => loopBound.has(name))
		if (loopRefs.length > 0) {
			diagnostics.push(
				diagnostic.loopVariableInReactiveThunk(source, node, loopRefs),
			)
			return
		}
		for (const name of free)
			if (loop.hoisted.some(h => h.name === name)) referencedConsts.add(name)
		reportServerOnlyNames(
			shared,
			node,
			`${what} inside the ${wording.loop} body`,
			badListBodyNames(node).filter(name => !referencedConsts.has(name)),
		)
	}

	/** Each referenced hoisted const, re-read off the item element. */
	const rebindingsFor = (itemParam: string): RebindingPlan[] => {
		const rebindings: RebindingPlan[] = []
		for (const hoisted of loop.hoisted) {
			if (!referencedConsts.has(hoisted.name)) continue
			const attr = constAttr.get(hoisted.name)
			if (!attr) {
				diagnostics.push(
					diagnostic.constNotRebindable(
						source,
						hoisted.node,
						hoisted.name,
						output.tag,
					),
				)
				continue
			}
			rebindings.push({
				name: hoisted.name,
				expr:
					attr === 'id'
						? `${itemParam}.id`
						: `${itemParam}.getAttribute('${attr}')!`,
			})
		}
		return rebindings
	}

	const effectsPlan: LoopEffectPlan[] = []
	const collectAttrs = (el: ElementNode, target: string | null): void => {
		for (const attr of el.attrs) {
			if (attr.kind === 'reactive') {
				checkClientNames(attr.thunk, `Reactive attribute \`${attr.name}\``)
				effectsPlan.push({
					kind: 'watch-attr',
					attr: attr.name,
					thunkText: attr.thunkText,
					dispatch: dispatchOf(attr, el.tag),
					coerceToString: returnsNumber(attr.thunk.body, component.signals),
					sourceStart: attr.thunk.start,
					sourceEnd: attr.thunk.end,
					target,
				})
			} else if (attr.kind === 'class-map') {
				checkClientNames(attr.object, 'Reactive class map')
				effectsPlan.push({
					kind: 'watch-class',
					keys: objectKeys(attr.object),
					thunkText: attr.thunkText,
					sourceStart: attr.thunk.start,
					sourceEnd: attr.thunk.end,
					target,
				})
			} else if (attr.kind === 'event') {
				checkClientNames(attr.handler, `Event handler \`${attr.name}\``)
				effectsPlan.push({
					kind: 'on',
					event: attr.event,
					handlerText: attr.handlerText,
					sourceStart: attr.handler.start,
					sourceEnd: attr.handler.end,
					target,
				})
			} else if (isLoopUnloweredConstruct(attr)) {
				diagnostics.push(
					diagnostic.unsupported(
						source,
						el.node,
						`${loopConstructLabel(attr)} on an element in a server-data ${wording.loop} body`,
						'`each()` binds reactive attributes, class maps and event handlers only — bind it outside the loop, or render the value from server data.',
					),
				)
			}
		}
	}
	collectAttrs(output, null)
	const collectDescendants = (el: ElementNode): void => {
		for (const child of el.children) {
			if (child.kind !== 'element') continue
			const hasConstruct = child.attrs.some(isLoopConstruct)
			if (hasConstruct) {
				const resolved = resolveSelectorScoped(
					output,
					child,
					component.composedShapes,
				)
				if (!resolved.unique) {
					diagnostics.push(
						diagnostic.unaddressableElement(
							source,
							child.node,
							`No unique selector for <${child.tag}> inside the ${wording.loop} output <${output.tag}> — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
						),
					)
				}
				collectAttrs(child, resolved.selector)
			}
			collectDescendants(child)
		}
	}
	collectDescendants(output)
	const gatedLazyChild = (node: TemplateNode): unknown => {
		if (node.kind === 'expr' && node.reactivity === 'reactive') {
			diagnostics.push(
				diagnostic.unsupported(
					source,
					node.node,
					`A lazy child in a server-data ${wording.loop} body`,
					'An `each()` scope owns no template slot to bind it to — render the value from server data, or bind it reactively on an attribute of the item element.',
				),
			)
		}
		if (node.kind === 'element')
			for (const child of node.children) gatedLazyChild(child)
		return undefined
	}
	gatedLazyChild(loop.output)

	if (effectsPlan.length === 0) return null
	if (scope !== null) {
		const scoped = resolveScopedSelector(
			scope.tree,
			output,
			component.composedShapes,
		)
		if (!scoped.unique)
			diagnostics.push(
				diagnostic.unaddressableElement(
					source,
					output.node,
					`No unique selector for the ${wording.loop} output <${output.tag}> inside its scope root <${scope.tree.tag}> — no \`class\`, \`role\`, \`data-*\` attribute or child path tells it apart from the other elements there, nested arms and list items included. Give it a unique \`class\`.`,
				),
			)
		const rebindings = rebindingsFor(loop.itemName)
		return {
			collection: '',
			scoped: { root: scope.root, selector: scoped.selector },
			itemParam: loop.itemName,
			rebindings,
			effects: effectsPlan,
		}
	}
	const { selector, unique } = resolveSelector(output)
	if (!unique) {
		diagnostics.push(
			diagnostic.unaddressableElement(
				source,
				output.node,
				`No unique selector for the ${wording.loop} output <${output.tag}> in the rendered template — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
			),
		)
	}
	const roleValue = staticAttrs(output).get('role')
	const fallbackBase =
		roleValue !== undefined && roleValue !== null
			? `${roleValue.split('-').pop() ?? roleValue}s`
			: `${output.tag}s`
	const base =
		loop.iterableName && !usedNames.has(loop.iterableName)
			? loop.iterableName
			: fallbackBase
	const collection = addQuery(base, selector, 'many')

	const itemParam =
		loop.itemName === collection ? `${loop.itemName}El` : loop.itemName
	return {
		collection,
		scoped: null,
		itemParam,
		rebindings: rebindingsFor(itemParam),
		effects: effectsPlan,
	}
}

const runEachLoops = (shared: PassShared): Map<EachForIR, ForClientPlan> => {
	const { component } = shared
	const forPlans = new Map<EachForIR, ForClientPlan>()
	for (const loop of component.fors.values()) {
		if (loop.kind !== 'each') continue // reactive loops → runReconcileLoops
		if (inNestedScope(component.root, component.fors, loop.output)) continue
		const plan = planEachLoop(shared, loop, null)
		if (plan) forPlans.set(loop, plan)
	}
	return forPlans
}

/** The list owns its container's children — the sibling checks, for a host-level list and a nested one alike. */
const checkContainerSiblings = (
	shared: Pick<PassShared, 'component' | 'source' | 'diagnostics'>,
	loop: ReconcileForIR,
	container: ElementNode,
): void => {
	const { source, diagnostics } = shared
	const wording = wordingOf(shared.component)
	const output = loop.output
	const exempt = new Set(loop.emptyArm ?? [])
	const checkSiblings = (children: TemplateNode[]): void => {
		for (const child of children) {
			if (child === output || exempt.has(child)) continue
			if (child.kind === 'compose') {
				diagnostics.push(
					diagnostic.unkeyedSiblingInReconcileContainer(
						source,
						child.node,
						child.component,
						true,
						wording,
					),
				)
			} else if (
				child.kind === 'element' &&
				!child.attrs.some(a => 'name' in a && a.name === 'data-unreconciled')
			) {
				diagnostics.push(
					diagnostic.unkeyedSiblingInReconcileContainer(
						source,
						child.node,
						child.tag,
						false,
						wording,
					),
				)
			} else if (child.kind === 'conditional' && child.mode === 'server') {
				for (const arm of child.arms) checkSiblings(arm.children)
			} else if (child.kind === 'try' && child.pendingChildren === null) {
				checkSiblings(child.children)
				checkSiblings(child.catchChildren)
			}
		}
	}
	checkSiblings(container.children)
}

const holeSelectorOf = (
	component: PassShared['component'],
	loop: ReconcileForIR,
): string | null => {
	const output = loop.output
	const findHoleParent = (node: TemplateNode): ElementNode | null => {
		if (node.kind === 'conditional' && node.mode === 'server') {
			for (const arm of node.arms)
				for (const armChild of arm.children) {
					const found = findHoleParent(armChild)
					if (found) return found
				}
			return null
		}
		if (!isElement(node)) return null
		for (const child of node.children) {
			if (
				child.kind === 'expr' &&
				child.reactivity === 'reactive' &&
				child.exprText === loop.itemName
			)
				return node
			const found = findHoleParent(child)
			if (found) return found
		}
		return null
	}
	const holeParent = findHoleParent(output)
	const holeSelector = holeParent
		? resolveSelectorScoped(output, holeParent, component.composedShapes)
				.selector
		: null
	return holeSelector
}

const runReconcileLoops = (
	shared: PassShared,
): Map<ReconcileForIR, ReconcilePlan> => {
	const { component, source, diagnostics, addQuery } = shared
	const wording = wordingOf(component)
	const { resolveSelector } = selectorAdaptersOf(component)
	const reconcilePlans = new Map<ReconcileForIR, ReconcilePlan>()

	const parentOf = (target: TemplateNode): ElementNode | null => {
		let found: ElementNode | null = null
		walkTemplate(component.root, (node, parent) => {
			if (node === target && parent !== null && isElement(parent))
				found = parent
		})
		return found
	}

	for (const loop of component.fors.values()) {
		if (loop.kind !== 'reconcile') continue
		const output = loop.output
		const nested = inNestedScope(component.root, component.fors, output)
		if (nested) {
			const container = parentOf(output)
			if (container) checkContainerSiblings(shared, loop, container)
			reconcilePlans.set(loop, {
				tag: component.tag,
				container: '',
				listIndex: listIndexOf(component.root, component.fors, loop),
				signal: loop.listSignal,
				itemParam: loop.itemName,
				keyParam: loop.keyName,
				holeSelector: holeSelectorOf(component, loop),
				itemScope: {
					root: null,
					locals: [],
					keyAttrs: [],
					effects: [],
					setup: loop.setup,
				},
				emptyQueries: [],
				scoped: true,
			})
			continue
		}

		const container = parentOf(output)
		if (!container || container === component.root) {
			diagnostics.push(
				diagnostic.unsupported(
					source,
					output.node,
					`A reactive-list ${wording.loop} directly under the component root`,
					'`reconcile()` needs a container element other than the host — wrap the loop in one.',
				),
			)
			continue
		}
		const containerSelector = resolveSelector(container)
		if (!containerSelector.unique) {
			diagnostics.push(
				diagnostic.unaddressableElement(
					source,
					container.node,
					`No unique selector for the ${wording.loop} container <${container.tag}> — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
				),
			)
		}
		const containerName = addQuery(
			'container',
			containerSelector.selector,
			'one',
		)
		shared.ambient.add('host')
		checkContainerSiblings(shared, loop, container)
		const listIndex = listIndexOf(component.root, component.fors, loop)
		const emptyQueries: string[] = []
		for (const root of loop.emptyArm ?? []) {
			if (!isElement(root)) continue
			const resolved = resolveSelector(root)
			if (!resolved.unique) {
				diagnostics.push(
					diagnostic.unaddressableElement(
						source,
						root.node,
						`No unique selector for the ${wording.emptyArm} root <${root.tag}> — add a distinguishing static attribute (\`role\`, \`class\` or \`data-*\`).`,
					),
				)
				continue
			}
			emptyQueries.push(addQuery('empty', resolved.selector, 'one'))
		}

		const holeSelector = holeSelectorOf(component, loop)

		reconcilePlans.set(loop, {
			tag: component.tag,
			container: containerName,
			listIndex,
			signal: loop.listSignal,
			itemParam: loop.itemName,
			keyParam: loop.keyName,
			holeSelector,
			itemScope: {
				root: null,
				locals: [],
				keyAttrs: [],
				effects: [],
				setup: loop.setup,
			},
			emptyQueries,
			scoped: false,
		})
	}
	return reconcilePlans
}

/* === Exported Functions === */

export const runLoops = (shared: PassShared): LoopPlans => {
	const forPlans = runEachLoops(shared)
	const reconcilePlans = runReconcileLoops(shared)
	return { forPlans, reconcilePlans }
}
