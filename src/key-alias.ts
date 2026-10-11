import {
	type AstNode,
	asArray,
	identifierName,
	nodeType,
	walkNodes,
} from './ast-utils'
import { dependenciesOf } from './evaluability'
import type {
	ComponentIR,
	DeclaredSignalIR,
	ItemSetupStmt,
	ReconcileForIR,
} from './ir'

/* === Types === */

export type ByKeyRead = {
	loop: ReconcileForIR
	stmt: ItemSetupStmt
	call: AstNode
	alias: string | null
	/** The `byKey` argument. */
	arg: AstNode | null
}

/* === Internal Functions === */

/** `list.byKey(…)` → the call's argument list, else null. */
const byKeyArgsOf = (node: unknown, list: string): AstNode[] | null => {
	if (nodeType(node) !== 'CallExpression') return null
	const callee = (node as AstNode).callee as AstNode | undefined
	return nodeType(callee) === 'MemberExpression' &&
		!callee?.computed &&
		identifierName(callee?.object) === list &&
		identifierName(callee?.property) === 'byKey'
		? asArray((node as AstNode).arguments)
		: null
}

/* === Exported Functions === */

export const harvestsPerField = (signal: DeclaredSignalIR): boolean =>
	signal.harvest?.kind === 'list' ||
	signal.listItem?.shape.kind === 'fields' ||
	signal.listItem?.shape.kind === 'opaque'

export const isAliasHarvestable = (
	component: ComponentIR,
	signal: DeclaredSignalIR,
): boolean => {
	if (signal.constructor !== 'createList' || !signal.init) return false
	const free = [...dependenciesOf(signal.init)]
	return (
		free.length > 0 &&
		free.every(name => component.paramNames.includes(name)) &&
		![...component.fors.values()].some(
			loop => loop.kind === 'reconcile' && loop.listSignal === signal.name,
		)
	)
}

/** Every `list.byKey(…)` read in any reactive list's item setup, in source order. */
export const byKeyReadsOf = (
	component: ComponentIR,
	list: string,
): ByKeyRead[] => {
	const reads: ByKeyRead[] = []
	for (const loop of component.fors.values()) {
		if (loop.kind !== 'reconcile') continue
		for (const stmt of loop.setup) {
			let init = stmt.node
			if (nodeType(init) === 'TSNonNullExpression')
				init = init.expression as AstNode
			const exact = stmt.kind === 'const' && byKeyArgsOf(init, list) !== null
			walkNodes(stmt.node, node => {
				const args = byKeyArgsOf(node, list)
				if (!args) return
				reads.push({
					loop,
					stmt,
					call: node,
					alias: exact && node === init ? stmt.name : null,
					arg: args.length === 1 ? (args[0] ?? null) : null,
				})
			})
		}
	}
	return reads.sort(
		(a, b) => (a.call.start as number) - (b.call.start as number),
	)
}

export const aliasScopeOf = (
	component: ComponentIR,
	list: string,
): ReconcileForIR | null =>
	byKeyReadsOf(component, list).find(read => read.alias !== null)?.loop ?? null
