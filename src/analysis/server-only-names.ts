import { type AstNode, isNode, nodeType } from '../ast-utils'
import { diagnostic, type LocalDiagnostic } from '../diagnostics'
import type { ComponentIR } from '../ir'
import { MANAGED_TEXT_PROPS } from '../vocabulary'
import { renderOnlyBindings } from './naming'

export const managedPropRead = (expr: AstNode): string | null => {
	if (nodeType(expr) === 'Literal' && typeof expr.value === 'string') {
		const prop = String(expr.value)
		return MANAGED_TEXT_PROPS.has(prop) ? prop : null
	}
	if (nodeType(expr) !== 'MemberExpression' || expr.computed) return null
	const obj = expr.object
	if (!isNode(obj) || obj.type !== 'Identifier' || String(obj.name) !== 'host')
		return null
	const prop = expr.property
	if (!isNode(prop) || prop.type !== 'Identifier') return null
	const name = String(prop.name)
	return MANAGED_TEXT_PROPS.has(name) ? name : null
}

/** The check's context: exactly the four fields it reads, which every pass context satisfies structurally. */
type ServerOnlyNamesContext = {
	component: ComponentIR
	source: string
	diagnostics: LocalDiagnostic[]
	badFreeNames: (node: AstNode) => string[]
}

export const reportServerOnlyNames = (
	ctx: ServerOnlyNamesContext,
	node: AstNode,
	subject: string,
	allBad: string[] = ctx.badFreeNames(node),
): void => {
	// A handler arg read is LTC081's, not a second error here.
	const bad = allBad.filter(name => !ctx.component.handlerArgs?.has(name))
	if (bad.length === 0) return
	const { component } = ctx
	const moduleNames = new Set(component.moduleBindings ?? [])
	const serverNames = renderOnlyBindings(component)
	const module = bad.filter(name => moduleNames.has(name))
	const server = bad.filter(
		name => !moduleNames.has(name) && serverNames.has(name),
	)
	const listBody = bad.filter(
		name => !moduleNames.has(name) && !serverNames.has(name),
	)
	const lang = component.langBinding
	const tNames = component.messageTBindings ?? []
	const recordNames = component.messageRecordBindings ?? []
	const t =
		server.find(name => tNames.includes(name)) ??
		(recordNames.some(name => server.includes(name))
			? (tNames[0] ?? 't')
			: null)
	const channel = [...tNames, ...recordNames].filter(name =>
		server.includes(name),
	)
	ctx.diagnostics.push(
		diagnostic.serverOnlyNames(
			ctx.source,
			node,
			subject,
			{ server, module, listBody },
			lang !== null && server.includes(lang) ? lang : null,
			t,
			channel,
		),
	)
}
