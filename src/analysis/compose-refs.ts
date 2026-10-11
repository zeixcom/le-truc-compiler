import { childrenInsertionsOf } from '../children-region'
import { diagnostic, type LocalDiagnostic } from '../diagnostics'
import {
	inReconcileItem,
	matchesAuthoredSelectorOn,
	namesDeclaredRole,
} from '../first-refs'
import type { ComponentIR, TemplateNode } from '../ir'
import type { InternalRegistryEntry } from '../registry'
import { wordingOf } from '../surface'
import { allComposeNodes, composeStaticAttrs, refOf } from './selectors'

/* === Types === */

export type ComposeRefs =
	| { mode: 'skipped' }
	| {
			mode: 'resolved'
			registry: ReadonlyMap<string, InternalRegistryEntry>
			// Refs that matched nothing
			unmatched: ReadonlyArray<{
				name: string
				selector: string
				required: boolean
			}>
			ambiguous: ReadonlySet<TemplateNode>
	  }

/* === Exported Functions === */

export const resolveComposeRefs = (
	component: ComponentIR,
	diagnostics: LocalDiagnostic[],
	composeRegistry?: ReadonlyMap<string, InternalRegistryEntry>,
): ComposeRefs => {
	// No registry: say nothing rather than reporting a false LTC026.
	if (!composeRegistry) return { mode: 'skipped' }
	const unmatched: Array<{
		name: string
		selector: string
		required: boolean
	}> = []
	const ambiguous = new Set<TemplateNode>()
	const result: ComposeRefs = {
		mode: 'resolved',
		registry: composeRegistry,
		unmatched,
		ambiguous,
	}
	const deferred = [...component.firstRefs.values()].filter(
		ref => ref.stage === 'deferred',
	)
	if (deferred.length === 0) return result
	const nodes = allComposeNodes(component.root)
	for (const ref of deferred) {
		const matches = nodes.filter(node => {
			const tag = composeRegistry.get(node.source)?.tag
			if (!tag) return false
			return (
				matchesAuthoredSelectorOn(
					{ tag, attrs: composeStaticAttrs(node) },
					ref.selector,
				) === true
			)
		})
		if (matches.length === 0) {
			// The reach-in check (LTC083) on the deferred leg
			const insertions = childrenInsertionsOf(component.root)
			const inserts =
				insertions.holders.size > 0 ||
				insertions.forwards.size > 0 ||
				insertions.unmarked
			const declared = namesDeclaredRole(
				ref.selector,
				new Set(component.childrenContract?.roles.keys() ?? []),
			)
			if (inserts && declared === false) {
				diagnostics.push(
					diagnostic.childrenReachIn(
						component.source,
						ref.at,
						'first',
						ref.name,
						ref.selector,
						component.childrenContract?.unreadable === true,
					),
				)
				continue
			}
			// A required reference falls through to LTC026, an optional one to the silence.
			if (inserts && declared === true) {
				unmatched.push({
					name: ref.name,
					selector: ref.selector,
					required: ref.required,
				})
				continue
			}
			if (!ref.required) {
				unmatched.push({
					name: ref.name,
					selector: ref.selector,
					required: false,
				})
				continue
			}
			diagnostics.push(
				diagnostic.firstSelectorNotFound(
					component.source,
					ref.at,
					ref.name,
					ref.selector,
				),
			)
			continue
		}
		// A host-level `first()` into a reactive-list item stays refused
		const itemOutputs = [...component.fors.values()]
			.filter(l => l.kind === 'reconcile')
			.map(l => l.output)
		const inItem = matches.find(node => inReconcileItem(itemOutputs, node))
		if (inItem) {
			diagnostics.push(
				diagnostic.unsupported(
					component.source,
					ref.at,
					`A \`first()\` reference to <${composeRegistry.get(inItem.source)?.tag ?? inItem.component}> inside a reactive-list loop body`,
					"The item's elements exist once per item and are recreated on every reconcile, so a reference taken at connect goes stale — bind the element from inside the item instead (an event handler or a reactive attribute on it).",
				),
			)
			continue
		}
		if (matches.length > 1) {
			for (const node of matches) ambiguous.add(node)
			// The compose-site analog of `first-refs.ts`'s ambiguity check
			diagnostics.push(
				diagnostic.firstSelectorAmbiguous(
					component.source,
					ref.at,
					ref.name,
					ref.selector,
					matches.length,
					wordingOf(component),
				),
			)
			continue
		}
		const target = matches[0] as (typeof nodes)[number]
		// The compose-site half of the duplicate-ref check
		const claimed = refOf(target)
		if (claimed && claimed.name !== ref.name) {
			diagnostics.push(
				diagnostic.firstSelectorDuplicate(
					component.source,
					ref.at,
					ref.name,
					ref.selector,
					claimed.name,
					component.firstRefs.get(claimed.name)?.at,
				),
			)
			continue
		}
		// A claimed ref bound to the SAME name is this pass's own earlier attachment
		if (!claimed) target.attrs.push({ kind: 'ref', name: ref.name })
	}
	return result
}
