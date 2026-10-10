/**
 * The LTC005 server-only-name check (LT-347–LT-349), a stateless diagnostic
 * utility every pass calls — pass 1's list bodies (`loops.ts`), passes 2/3's
 * parsers and seeds (`harvest.ts`, `list-harvest.ts`), pass 4's construct
 * positions (`effects.ts`) and the setup half (`plan.ts`). A leaf by design
 * (2026-10-10 architecture review): homed in pass 4 it made every pass
 * import pass 4, an import cycle that held only because each cross-module
 * call sat inside a function body. Reads no pass state — everything it
 * needs arrives through its context parameter.
 */

import type { AstNode } from '../ast-node'
import { isNode, nodeType } from '../ast-utils'
import { diagnostic, type LocalDiagnostic } from '../diagnostics'
import type { ComponentIR } from '../ir'
import { MANAGED_TEXT_PROPS } from '../vocabulary'
import { renderOnlyBindings } from './naming'

/**
 * Native form-control tags a form-associated component's `disabled`/
 * `checked` omission (LTC034) escalates to an ERROR for (LT-062/LT-085):
 * a real submittable control, not the host itself. Compiler-side duplicate
 * of `validate-lowered.ts`'s `NAMED_FORM_CONTROL_TAGS` (LT-059) — front-end/
 * analysis-layer duplication is the established pattern here (same
 * precedent as `MANAGED_FORM_MEMBERS`, vocabulary.ts) rather than an import
 * against the documented front-end → analysis direction.
 */
export const SUBMITTABLE_FORM_CONTROL_TAGS: ReadonlySet<string> = new Set([
	'input',
	'select',
	'textarea',
	'button',
])

/**
 * The managed form prop a reactive child reads, or null. Since LT-052 that
 * is a `host.<prop>` member read; the retired `{'<prop>'}` string-literal
 * spelling is still recognised so a stale source reports the managed-prop
 * message instead of a downstream type error.
 */
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

/**
 * The check's context: exactly the four fields it reads, which every pass
 * context satisfies structurally — `EffectsContext` (effects.ts) and
 * `PassShared` (plan.ts) pass their own context unchanged (the former
 * `Pick<EffectsContext, …>` parameter shape).
 */
type ServerOnlyNamesContext = {
	component: ComponentIR
	source: string
	diagnostics: LocalDiagnostic[]
	badFreeNames: (node: AstNode) => string[]
}

/**
 * LTC005's server-only face: the generated client binds no server name — a
 * parameter (`t` included), a module-level declaration, a server-data loop
 * binding (`badFreeNames`, LT-348) — so any client-emitted position reading
 * one is a ReferenceError at connect. One check and one wording for every
 * such position (LT-347 audited them: reactive attributes, lazy text
 * children, class/style maps, event handlers, `truc:html`, pass entries,
 * `expose()` entries, client-needed setup consts and harvest-less signal
 * initializers; `loops.ts` routes list bodies here through
 * `badListBodyNames`, LT-349). `subject` opens
 * the sentence.
 */
export const reportServerOnlyNames = (
	ctx: ServerOnlyNamesContext,
	node: AstNode,
	subject: string,
	allBad: string[] = ctx.badFreeNames(node),
): void => {
	// A handler arg read is LTC081's (LT-461), not a second error here.
	const bad = allBad.filter(name => !ctx.component.handlerArgs?.has(name))
	if (bad.length === 0) return
	const { component } = ctx
	// Split by binding class — each has its own fix. A name the server
	// binds takes precedence: a list body's setup-const class is only the
	// residue `badListBodyNames` adds (LT-349).
	const moduleNames = new Set(component.moduleBindings ?? [])
	const serverNames = renderOnlyBindings(component)
	const module = bad.filter(name => moduleNames.has(name))
	const server = bad.filter(
		name => !moduleNames.has(name) && serverNames.has(name),
	)
	const listBody = bad.filter(
		name => !moduleNames.has(name) && !serverNames.has(name),
	)
	// `lang` stays server-only under the client message channel (ADR 0030
	// s9): the locale reaches the client through the root attribute.
	const lang = component.langBinding
	// LT-358c: a record-spelled read (`i18n.t.<key>`) flags the RECORD
	// binding, not a `messageTBindings` entry, so the plain find misses it
	// and the report got the generic exposed-prop fix. The record spelling
	// stays server-only (ADR 0030 s9), so the fix is the same literal-key
	// sentence — spelled with the component's own `t` binding when it
	// declares one, else the canonical `t` the destructure binds. The
	// channel set keeps every message-channel name (t bindings + record
	// bindings) out of that generic fix, which would contradict the
	// literal-key sentence.
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
