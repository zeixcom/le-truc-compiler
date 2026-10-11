/** The test-only second template target: an operation dump plus an in-process interpreter that renders it. It proves the operation interface carries a target that sees nothing but operations — the interpreter reads the dump text, never the walk's objects. Never shipped: a published dump would make the emitter shape a contract by accident. */

import { HtmlWriter } from '../../src/codegen'
import { composeHostAttrs } from '../../src/compose-attrs'
import { formatMessage } from '../../src/icu/evaluate'
import { parseMessage } from '../../src/icu/parse'
import { attr, sanitizeHtml, type TextValue, text } from '../../src/runtime'
import type {
	EscapeContext,
	HoleValue,
	MessageCall,
	PortableExpr,
	Segment,
	TemplateOp,
	TemplatePartial,
	TemplateTarget,
} from '../../src/template/operations'

export const dumpTarget: TemplateTarget = {
	name: 'dump',
	helpers: [],
	fileName: (tag, locale) => `${tag}.${locale}.dump.json`,
	emit: partial => JSON.stringify(partial, null, '\t'),
}

type Frame = {
	args: Readonly<Record<string, unknown>>
	items: ReadonlyMap<string, unknown>
	partial: TemplatePartial
}

/** Looks up a dumped partial by tag and locale. */
export type DumpLookup = (tag: string, locale: string) => string | undefined

const unreachable = (value: never): never => {
	throw new Error(`unhandled: ${JSON.stringify(value)}`)
}

const message = (frame: Frame, call: MessageCall): string => {
	const parsed = parseMessage(call.pattern)
	if (!parsed.ok)
		throw new Error(`dumped pattern does not parse: ${call.pattern}`)
	const args: Record<string, unknown> = {}
	for (const [name, value] of Object.entries(call.args))
		args[name] = evaluate(frame, value)
	return formatMessage(parsed.message, args, {
		lang: frame.partial.locale,
		timeZone: frame.partial.timeZone,
		currency: frame.partial.currency,
	})
}

const evaluate = (frame: Frame, expr: PortableExpr): unknown => {
	switch (expr.kind) {
		case 'literal':
			return expr.value
		case 'arg': {
			const value = frame.args[expr.name]
			return value === undefined && expr.fallback
				? evaluate(frame, expr.fallback)
				: value
		}
		case 'item':
			if (!frame.items.has(expr.name))
				throw new Error(`no loop binding \`${expr.name}\` in scope`)
			return frame.items.get(expr.name)
		case 'member': {
			const object = evaluate(frame, expr.object)
			if (object === null || object === undefined)
				throw new TypeError(
					`Cannot read properties of ${object} (reading '${expr.property}')`,
				)
			return (object as Record<string, unknown>)[expr.property]
		}
		case 'not':
			return !evaluate(frame, expr.operand)
		case 'compare': {
			const left = evaluate(frame, expr.left) as number
			const right = evaluate(frame, expr.right) as number
			const { operator } = expr
			switch (operator) {
				case '===':
					return left === right
				case '!==':
					return left !== right
				case '<':
					return left < right
				case '<=':
					return left <= right
				case '>':
					return left > right
				case '>=':
					return left >= right
				default:
					return unreachable(operator)
			}
		}
		case 'logical': {
			const left = evaluate(frame, expr.left)
			const { operator } = expr
			switch (operator) {
				case '&&':
					return left ? evaluate(frame, expr.right) : left
				case '||':
					return left ? left : evaluate(frame, expr.right)
				case '??':
					return left ?? evaluate(frame, expr.right)
				default:
					return unreachable(operator)
			}
		}
		case 'conditional':
			return evaluate(frame, expr.test)
				? evaluate(frame, expr.consequent)
				: evaluate(frame, expr.alternate)
		case 'message':
			return message(frame, expr.message)
		default:
			return unreachable(expr)
	}
}

const joined = (frame: Frame, segments: readonly Segment[]): string =>
	segments
		.map(segment =>
			segment.kind === 'literal'
				? segment.text
				: String(evaluate(frame, segment.value)),
		)
		.join('')

const holeValue = (frame: Frame, value: HoleValue): unknown =>
	value.kind === 'segments'
		? joined(frame, value.segments)
		: evaluate(frame, value)

/** A value in its escaping context — the SSG harness's own sinks, so escaping is byte-identical by construction. */
const inContext = (
	context: EscapeContext,
	attribute: string | undefined,
	value: unknown,
): string => {
	switch (context) {
		case 'text':
		case 'html':
		case 'composed-markup':
			if (attribute !== undefined)
				throw new Error(`a ${context} hole has no attribute`)
			return context === 'text'
				? text(value as TextValue)
				: context === 'html'
					? sanitizeHtml(String(value))
					: String(value)
		case 'quoted-attribute':
		case 'url-attribute':
		case 'boolean-attribute':
		case 'class-token':
		case 'style-value':
			if (attribute === undefined)
				throw new Error(`a ${context} hole needs an attribute`)
			return attr(attribute, value)
		default:
			return unreachable(context)
	}
}

const render = (
	frame: Frame,
	ops: readonly TemplateOp[],
	lookup: DumpLookup,
): string => {
	let out = ''
	for (const op of ops) {
		switch (op.op) {
			case 'text':
				out += op.markup
				break
			case 'hole':
				out += inContext(op.context, op.attribute, evaluate(frame, op.value))
				break
			case 'segments':
				out += inContext(op.context, op.attribute, joined(frame, op.segments))
				break
			case 'message':
				out += inContext(op.context, op.attribute, message(frame, op.message))
				break
			case 'conditional': {
				const branch = op.branches.find(b => evaluate(frame, b.test))
				out += render(frame, branch ? branch.body : op.otherwise, lookup)
				break
			}
			case 'loop': {
				const values = Array.from(
					evaluate(frame, op.source) as Iterable<unknown>,
				)
				for (const [index, item] of values.entries()) {
					const items = new Map(frame.items)
					items.set(op.item, item)
					if (op.index !== null) items.set(op.index, index)
					out += render({ ...frame, items }, op.body, lookup)
				}
				if (values.length === 0) out += render(frame, op.empty, lookup)
				break
			}
			case 'include': {
				const args: Record<string, unknown> = {}
				for (const arg of op.args) args[arg.name] = holeValue(frame, arg.value)
				const markup = renderDump(lookup, op.tag, op.locale, args)
				if (op.hostAttributes.length === 0) {
					out += markup
					break
				}
				const host: Record<string, string | number | null | undefined> = {}
				for (const arg of op.hostAttributes)
					host[arg.name] = holeValue(frame, arg.value) as string
				out += composeHostAttrs(markup, op.tag, host)
				break
			}
			case 'arm-template': {
				const open = new HtmlWriter()
					.static('<template')
					.attr('data-arms', op.armSet)
					.attr('data-key', op.key)
					.static('>')
				out += open.parts.map(p => ('static' in p ? p.static : '')).join('')
				out += render(frame, op.body, lookup)
				out += '</template>'
				break
			}
			case 'boundary':
			case 'list-template':
				throw new Error(`the walk emits no \`${op.op}\` operation yet`)
			default:
				unreachable(op)
		}
	}
	return out
}

/**
 * Render one dumped partial with server args.
 *
 * @param lookup - The dump text of every partial, by tag and locale
 * @returns The markup the partial renders
 * @throws When the partial is missing, or the args fail a member read as JavaScript would
 */
export const renderDump = (
	lookup: DumpLookup,
	tag: string,
	locale: string,
	args: Readonly<Record<string, unknown>>,
): string => {
	const dumped = lookup(tag, locale)
	if (dumped === undefined)
		throw new Error(`no dumped partial for <${tag}> at ${locale}`)
	const partial = JSON.parse(dumped) as TemplatePartial
	return render({ args, items: new Map(), partial }, partial.ops, lookup)
}
