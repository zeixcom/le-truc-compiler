import {
	type AstNode,
	asArray,
	attrName,
	eventNameFromAttr,
	identifierName,
	isHandlerArgName,
	isNode,
	text,
} from './ast-utils'
import type { ExtractContext } from './extract-context'
import type { AttributeIR, ComposeAttrIR, PassEntryIR } from './ir'
import { bindsExposedArg, dependencyClosure } from './reactivity'

export const classifyPassEntries = (
	ctx: ExtractContext,
	attr: AstNode,
): PassEntryIR[] | { kind: 'invalid'; reason: string } => {
	const value = attr.value
	const expr =
		isNode(value) && value.type === 'JSXExpressionContainer'
			? value.expression
			: null
	if (!isNode(expr) || expr.type !== 'ObjectExpression')
		return {
			kind: 'invalid',
			reason:
				'pass={{ … }} expects an object literal of prop: thunk entries (pass={{ value: () => x.get() }}).',
		}
	const entries: PassEntryIR[] = []
	for (const prop of asArray(expr.properties)) {
		const propName = identifierName(prop.key)
		if (prop.type !== 'Property' || !propName)
			return {
				kind: 'invalid',
				reason: 'pass={{ … }} entries must be named properties.',
			}
		const entryValue = prop.value
		if (isNode(entryValue) && entryValue.type === 'ArrowFunctionExpression') {
			if (!isNode(entryValue.body))
				return {
					kind: 'invalid',
					reason: `pass entry \`${propName}\` must be a thunk with a body (() => value).`,
				}
			entries.push({
				prop: propName,
				thunk: entryValue,
				thunkText: text(ctx.source, entryValue),
			})
			continue
		}
		if (isNode(entryValue) && entryValue.type === 'ObjectExpression') {
			const props = asArray(entryValue.properties)
			const find = (key: string) =>
				props.find(
					p => p.type === 'Property' && (identifierName(p.key) ?? '') === key,
				)
			const getProp = find('get')
			const setProp = find('set')
			const getFn = getProp && isNode(getProp.value) ? getProp.value : null
			const setFn = setProp && isNode(setProp.value) ? setProp.value : null
			if (
				getFn?.type === 'ArrowFunctionExpression' &&
				setFn?.type === 'ArrowFunctionExpression' &&
				isNode(getFn.body) &&
				isNode(setFn.body)
			) {
				entries.push({
					prop: propName,
					thunk: getFn,
					thunkText: text(ctx.source, getFn),
					setThunk: setFn,
					setThunkText: text(ctx.source, setFn),
				})
				continue
			}
			return {
				kind: 'invalid',
				reason: `{ get, set } pass entry \`${propName}\` must have both get and set as thunks (() => value).`,
			}
		}
		return {
			kind: 'invalid',
			reason: `pass entry \`${propName}\` must be a thunk (() => value) or a { get, set } descriptor.`,
		}
	}
	return entries
}

/** The host-owned client-prop interop attribute. */
const PASS_ATTR = 'truc:pass'
const LEGACY_PASS_ATTR = 'pass'

const renamedPassReason =
	'`pass={{ … }}` is now `truc:pass={{ … }}` — host-owned attributes are namespaced so they cannot collide with a user prop called `pass`.'

/** The host-owned dynamic-rendering attribute, and its retired bare name. */
const HTML_ATTR = 'truc:html'
const LEGACY_HTML_ATTR = 'html'

const renamedHtmlReason =
	'`html={…}` is now `truc:html={…}` — host-owned attributes are namespaced so they cannot collide with a user prop called `html` (LT-128). Core TSRX defines no `{html expr}` keyword in any published release; it delegates raw markup to the host, and Le Truc owns this one because it routes the value through `sanitizeHtml` rather than assigning it raw.'

const TRUC_NAMESPACE = 'truc:'
const RETIRED_TRUC_ATTRS: ReadonlySet<string> = new Set([
	'truc:case',
	'truc:case-type',
])

const unknownTrucAttrReason = (
	name: string,
	known: readonly string[],
): string | null => {
	if (!name.startsWith(TRUC_NAMESPACE)) return null
	if (RETIRED_TRUC_ATTRS.has(name))
		return `\`${name}\` is retired (ADR 0009) — plural and select variance lives in the message's ICU pattern now. Declare the message in the \`i18n\` record, e.g. \`tasks: '{count, plural, one {task} other {tasks}}'\`, and render it as \`{t.tasks({ count })}\`.`
	const names = known.map(n => `\`${n}\``).join(' and ')
	return `\`${name}\` is not a Le Truc attribute — the \`truc:\` namespace is host-owned, so an unrecognized name would pass through as an ordinary attribute that nothing reads. Use ${names}, or drop the \`truc:\` prefix for an ordinary attribute.`
}

const REACT_ATTR_RENAMES: ReadonlyMap<string, string> = new Map([
	['className', 'class'],
	['htmlFor', 'for'],
])

export const classifyAttribute = (
	ctx: ExtractContext,
	attr: AstNode,
	/** Declared signal names (see `bindsExposedArg`). */
	signals: { has(name: string): boolean },
): AttributeIR | { kind: 'invalid'; reason: string } => {
	const name = attrName(attr)
	const depsOf = (expr: AstNode, hostProp?: string) =>
		dependencyClosure(expr, signals, ctx.argNames, hostProp)
	const value = attr.value
	if (name === PASS_ATTR) {
		const entries = classifyPassEntries(ctx, attr)
		if ('reason' in entries) return entries
		return { kind: 'pass', entries }
	}
	if (name === LEGACY_PASS_ATTR)
		return { kind: 'invalid', reason: renamedPassReason }
	const reactRename = REACT_ATTR_RENAMES.get(name)
	if (reactRename)
		return {
			kind: 'invalid',
			reason: `\`${name}\` is a React DOM-property name, not an HTML attribute — TSRX has no JSX-to-DOM-property translation, so this would render into the markup verbatim and the browser would ignore it. Use \`${reactRename}\` instead.`,
		}
	if (name === 'ref')
		return {
			kind: 'invalid',
			reason:
				"`ref={name}` is retired — use `const name = first(selector, required)` in setup instead, e.g. `const textbox = first('input', 'required')`. The compiler resolves the selector structurally at compile time.",
		}
	if (/^on[A-Z]/.test(name)) {
		const raw =
			isNode(value) && value.type === 'JSXExpressionContainer'
				? value.expression
				: value
		const resolvedName =
			isNode(raw) && raw.type === 'Identifier' ? identifierName(raw) : null
		const handlerArg = resolvedName ? ctx.handlerArgs.get(resolvedName) : null
		if (handlerArg && isNode(raw)) {
			ctx.handlerArgRefs.add(raw)
			return {
				kind: 'handler-arg',
				name,
				event: eventNameFromAttr(name),
				arg: handlerArg,
				node: raw,
			}
		}
		const resolved = resolvedName ? ctx.setupInits.get(resolvedName) : undefined
		const expr = resolved ?? raw
		if (!isNode(expr) || !/Function(Expression)?$/.test(expr.type))
			return {
				kind: 'invalid',
				reason: `Event attribute ${name}={…} must be a function, or an identifier bound to one by a hoisted \`const\`.`,
			}
		return {
			kind: 'event',
			name,
			event: eventNameFromAttr(name),
			handler: expr,
			handlerText: text(ctx.source, expr),
		}
	}
	if (name === LEGACY_HTML_ATTR)
		return { kind: 'invalid', reason: renamedHtmlReason }
	if (name === HTML_ATTR) {
		const expr =
			isNode(value) && value.type === 'JSXExpressionContainer'
				? value.expression
				: value
		if (isNode(expr) && expr.type === 'ArrowFunctionExpression') {
			const body = expr.body
			if (!isNode(body))
				return {
					kind: 'invalid',
					reason: 'truc:html={() => …} must be a thunk with a body.',
				}
			return {
				kind: 'html',
				exprText: text(ctx.source, body),
				node: body,
				deps: depsOf(expr),
				reactive: true,
				thunk: expr,
				thunkText: text(ctx.source, expr),
			}
		}
		if (!isNode(expr) || !/^(Identifier|MemberExpression)$/.test(expr.type))
			return {
				kind: 'invalid',
				reason:
					'truc:html={…} expects a data reference (identifier or member expression) or a reactive thunk (truc:html={() => value}).',
			}
		return {
			kind: 'html',
			exprText: text(ctx.source, expr),
			node: expr,
			deps: depsOf(expr),
			reactive: false,
		}
	}
	const trucReason = unknownTrucAttrReason(name, [PASS_ATTR, HTML_ATTR])
	if (trucReason) return { kind: 'invalid', reason: trucReason }
	if (name.startsWith('class:'))
		return {
			kind: 'invalid',
			reason:
				'`class:token={…}` is not a Le Truc spelling — the attribute would render into the markup as written, and the browser ignores it. Bind a class reactively with a class map: `class={() => ({ token: value })}`.',
		}
	if (!isNode(value)) return { kind: 'static', name, value: null }
	if (value.type === 'Literal')
		return { kind: 'static', name, value: String(value.value ?? '') }
	if (value.type === 'JSXExpressionContainer') {
		const expr = value.expression
		if (!isNode(expr)) return { kind: 'static', name, value: '' }
		if (expr.type === 'ArrowFunctionExpression') {
			const body = expr.body
			if (name === 'class' && isNode(body) && body.type === 'ObjectExpression')
				return {
					kind: 'class-map',
					thunkText: text(ctx.source, expr),
					thunk: expr,
					object: body,
					deps: depsOf(expr),
				}
			if (name === 'style' && isNode(body) && body.type === 'ObjectExpression')
				return {
					kind: 'style-map',
					thunkText: text(ctx.source, expr),
					thunk: expr,
					object: body,
					deps: depsOf(expr),
				}
			if (!isNode(body))
				return {
					kind: 'invalid',
					reason: `Reactive attribute ${name}={…} must be a thunk with a body (() => value).`,
				}
			return {
				kind: 'reactive',
				name,
				thunk: expr,
				thunkText: text(ctx.source, expr),
				deps: depsOf(expr),
			}
		}
		if (expr.type === 'FunctionExpression')
			return {
				kind: 'invalid',
				reason: `Attribute \`${name}\` uses an unsupported function form; write a thunk (() => value).`,
			}
		const bindsProp = bindsExposedArg(
			expr,
			ctx.argNames,
			ctx.exposedProps,
			signals,
			ctx.parserProps,
		)
		return {
			kind: 'server',
			name,
			exprText: text(ctx.source, expr),
			node: expr,
			deps: depsOf(expr, bindsProp ?? undefined),
			...(bindsProp !== null ? { bindsProp } : {}),
		}
	}
	return {
		kind: 'invalid',
		reason: `Attribute \`${name}\` uses an unsupported value form.`,
	}
}

export const classifyComposeAttribute = (
	ctx: ExtractContext,
	attr: AstNode,
): ComposeAttrIR | { kind: 'invalid'; reason: string } => {
	const name = attrName(attr)
	const value = attr.value
	if (name === PASS_ATTR) {
		const entries = classifyPassEntries(ctx, attr)
		if ('reason' in entries) return entries
		return { kind: 'pass', entries }
	}
	if (name === LEGACY_PASS_ATTR)
		return { kind: 'invalid', reason: renamedPassReason }
	const reactRename = REACT_ATTR_RENAMES.get(name)
	if (reactRename)
		return {
			kind: 'invalid',
			reason: `\`${name}\` is a React DOM-property name, not an HTML attribute — TSRX has no JSX-to-DOM-property translation, so this would render into the markup verbatim and the browser would ignore it. Use \`${reactRename}\` instead.`,
		}
	const trucReason = unknownTrucAttrReason(name, [PASS_ATTR])
	if (trucReason) return { kind: 'invalid', reason: trucReason }
	if (name === 'ref')
		return {
			kind: 'invalid',
			reason:
				"`ref={name}` is retired — use `const name = first(selector, required)` in setup instead. A composed element is addressed by the tag it renders plus its own compose-site class/id, e.g. `const lightness = first('form-spinbutton.lightness', 'required')`.",
		}
	if (name === 'i18n')
		return {
			kind: 'invalid',
			reason:
				"`i18n` is a reserved parameter (ADR 0009) — the compiler supplies the locale record; callers never pass it. To set the child's locale, pass `lang` instead.",
		}
	if (isHandlerArgName(name)) {
		const raw =
			isNode(value) && value.type === 'JSXExpressionContainer'
				? value.expression
				: value
		const rawName =
			isNode(raw) && raw.type === 'Identifier' ? identifierName(raw) : null
		const forward = rawName ? ctx.handlerArgs.get(rawName) : undefined
		if (forward && isNode(raw)) {
			ctx.handlerArgRefs.add(raw)
			return {
				kind: 'handler',
				name,
				handler: raw,
				handlerText: text(ctx.source, raw),
				forward,
			}
		}
		const resolved = rawName ? ctx.setupInits.get(rawName) : undefined
		const expr = resolved ?? raw
		if (!isNode(expr) || !/Function(Expression)?$/.test(expr.type))
			return {
				kind: 'invalid',
				reason: `Handler arg ${name}={…} must be a function, or an identifier bound to one by a hoisted \`const\` — the child binds it as an event listener.`,
			}
		return {
			kind: 'handler',
			name,
			handler: expr,
			handlerText: text(ctx.source, expr),
			forward: null,
		}
	}
	if (!isNode(value)) return { kind: 'arg', name, exprText: 'true', node: null }
	if (value.type === 'Literal')
		return {
			kind: 'arg',
			name,
			exprText: JSON.stringify(value.value ?? ''),
			node: null,
		}
	if (value.type === 'JSXExpressionContainer') {
		const expr = value.expression
		if (!isNode(expr))
			return { kind: 'invalid', reason: `Attribute \`${name}\` is empty.` }
		return { kind: 'arg', name, exprText: text(ctx.source, expr), node: expr }
	}
	return {
		kind: 'invalid',
		reason: `Attribute \`${name}\` uses an unsupported value form.`,
	}
}
