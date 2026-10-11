import { type AstNode, hostPropOf, isNode, text } from '../ast-utils'
import { type BoundaryArmRoot, isBoundaryArmRoot } from '../boundary-arms'
import { isChildrenInsertion } from '../children-region'
import { HtmlWriter } from '../codegen'
import { isVoidElement } from '../core'
import { diagnostic, type LocalDiagnostic, type Site } from '../diagnostics'
import {
	foldableHostProps,
	foldableRefGuards,
	foldableRenderScope,
	hostDerivedFold,
	isServerEvaluable,
} from '../evaluability'
import { changedClientForms } from '../icu/client-record'
import {
	bakeMessageEnv,
	carriedKinds,
	FORMATTING_KINDS,
	type Message,
} from '../icu/evaluate'
import { clientSourceRecord, parseMessage } from '../icu/parse'
import { initialFold } from '../initial-winner'
import type {
	ArmTemplate,
	AttributeIR,
	ComponentIR,
	EachForIR,
	TemplateNode,
} from '../ir'
import {
	aliasScopeOf,
	harvestsPerField,
	isAliasHarvestable,
} from '../key-alias'
import type { InternalRegistryEntry } from '../registry'
import { armSetOf, type ConditionalNode, elseOf, isIf } from '../walk'
import type {
	EscapeContext,
	HoleValue,
	IncludeArg,
	PortableExpr,
	TemplateOp,
} from './operations'
import {
	type Binding,
	createScope,
	type LocaleMessage,
	type PortableContext,
	portableExpr,
	portableHoleValue,
	readsIntl,
	type Scope,
} from './portable'

/* === Types === */

export type TemplateRoutingReason =
	| 'non-portable initial'
	| 'synchronous try'
	| 'key-alias harvest'
	| 'not yet emittable'

/** A routing outcome: the construct routes the component's partial Static. */
export type TemplateRouting = {
	reason: TemplateRoutingReason
	detail: string
	range: { start: number; end: number } | null
}

export type TemplateWalkInput = {
	component: ComponentIR
	composeRegistry: ReadonlyMap<string, InternalRegistryEntry>
	locale: string
	/** The locale a record resolves at when its caller names none. */
	pageLocale: string
	timeZone: string
	currency: string
	/** This component's messages at `locale`. */
	messages: ReadonlyMap<string, LocaleMessage>
	clientMessageKeys: readonly string[]
}

export type TemplateWalkResult = {
	ops: TemplateOp[]
	routing: TemplateRouting[]
	diagnostics: LocalDiagnostic[]
}

type ElementNode = Extract<TemplateNode, { kind: 'element' }>
type ComposeNode = Extract<TemplateNode, { kind: 'compose' }>
type TryNode = Extract<TemplateNode, { kind: 'try' }>
type StaticAttr = AttributeIR & { kind: 'static' }

/** What a position reads: the names SSG treats as server-known, and their portable meaning. */
type Lexical = {
	known: ReadonlySet<string>
	scope: Scope
	/** The `<script>`/`<style>` element whose content the position is in. */
	content: string | null
}

type WalkContext = {
	input: TemplateWalkInput
	portable: PortableContext
	out: TemplateOp[]
	inArmTemplate: boolean
	routing: TemplateRouting[]
	diagnostics: LocalDiagnostic[]
	emptyArmNodes: ReadonlySet<TemplateNode>
	foldScope: ReadonlySet<string>
	foldable: ReadonlySet<string>
	refGuards: ReadonlyMap<string, string>
}

/* === Constants === */

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
	'action',
	'background',
	'cite',
	'codebase',
	'data',
	'formaction',
	'href',
	'icon',
	'longdesc',
	'manifest',
	'ping',
	'poster',
	'src',
	'srcset',
	'xlink:href',
])

const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
	'allowfullscreen',
	'async',
	'autofocus',
	'autoplay',
	'checked',
	'controls',
	'default',
	'defer',
	'disabled',
	'formnovalidate',
	'hidden',
	'inert',
	'ismap',
	'itemscope',
	'loop',
	'multiple',
	'muted',
	'nomodule',
	'novalidate',
	'open',
	'playsinline',
	'readonly',
	'required',
	'reversed',
	'selected',
])

const RAW_CONTENT_TAGS: ReadonlySet<string> = new Set(['script', 'style'])

/* === Internal Functions === */

const attributeContext = (name: string): EscapeContext => {
	const lower = name.toLowerCase()
	if (lower === 'class') return 'class-token'
	if (URL_ATTRIBUTES.has(lower)) return 'url-attribute'
	if (BOOLEAN_ATTRIBUTES.has(lower)) return 'boolean-attribute'
	return 'quoted-attribute'
}

const siteOf = (node: AstNode | null | undefined): Site =>
	node ? { start: node.start, end: node.end } : null

const rangeOf = (node: AstNode | null | undefined): TemplateRouting['range'] =>
	typeof node?.start === 'number' && typeof node.end === 'number'
		? { start: node.start, end: node.end }
		: null

const sourceText = (ctx: WalkContext, node: AstNode | null): string =>
	text(ctx.input.component.source, node)

const emit = (ctx: WalkContext, op: TemplateOp): void => {
	const last = ctx.out.at(-1)
	if (op.op === 'text' && last?.op === 'text') last.markup += op.markup
	else ctx.out.push(op)
}

const emitMarkup = (ctx: WalkContext, markup: string): void =>
	emit(ctx, { op: 'text', markup })

const flush = (ctx: WalkContext, html: HtmlWriter<TemplateOp>): void => {
	for (const part of html.parts)
		if ('static' in part) emitMarkup(ctx, part.static)
		else emit(ctx, part.expr)
}

/** Ops emitted into a fresh sink, returned in order. */
const collect = (ctx: WalkContext, render: () => void): TemplateOp[] => {
	const saved = ctx.out
	ctx.out = []
	try {
		render()
		return ctx.out
	} finally {
		ctx.out = saved
	}
}

const route = (
	ctx: WalkContext,
	reason: TemplateRoutingReason,
	detail: string,
	node: AstNode | null,
): void => {
	ctx.routing.push({ reason, detail, range: rangeOf(node) })
}

const holeOp = (
	value: HoleValue,
	context: EscapeContext,
	attribute?: string,
): TemplateOp => {
	const named = attribute === undefined ? {} : { attribute }
	if (value.kind === 'segments')
		return { op: 'segments', context, ...named, segments: value.segments }
	if (value.kind === 'message')
		return { op: 'message', context, ...named, message: value.message }
	return { op: 'hole', context, ...named, value }
}

/** A server-class value: outside the subset it is LTC057. */
const serverValue = (
	ctx: WalkContext,
	lex: Lexical,
	node: AstNode | null,
	position: string,
	asHole = true,
): HoleValue | null => {
	const value = asHole
		? portableHoleValue(ctx.portable, lex.scope, node)
		: portableExpr(ctx.portable, lex.scope, node)
	if (value) return value
	ctx.diagnostics.push(
		diagnostic.nonPortableHole(
			ctx.input.component.source,
			siteOf(node),
			sourceText(ctx, node),
			position,
			readsIntl(lex.scope, node) ? 'intl' : 'subset',
		),
	)
	return null
}

/** A reactive initial value: outside the subset it routes the partial Static. */
const initialValue = (
	ctx: WalkContext,
	scope: Scope,
	node: AstNode | null,
	shown: AstNode | null,
): HoleValue | null => {
	const value = portableHoleValue(ctx.portable, scope, node)
	if (value) return value
	route(
		ctx,
		'non-portable initial',
		`\`${sourceText(ctx, shown).replace(/\s+/g, ' ')}\``,
		shown,
	)
	return null
}

/** The refusal for a hole in `lex`'s position, reported; true when refused. */
const refusedContent = (
	ctx: WalkContext,
	lex: Lexical,
	node: AstNode,
): boolean => {
	if (lex.content === null) return false
	ctx.diagnostics.push(
		diagnostic.refusedHolePosition(ctx.input.component.source, siteOf(node), {
			face: 'content',
			tag: lex.content,
		}),
	)
	return true
}

const refusedAttribute = (
	ctx: WalkContext,
	name: string,
	node: AstNode | null,
): boolean => {
	const lower = name.toLowerCase()
	const refusal =
		lower.startsWith('on') || lower === 'srcdoc'
			? ({ face: 'handler', attribute: name } as const)
			: lower === 'style'
				? ({ face: 'style' } as const)
				: null
	if (refusal === null) return false
	ctx.diagnostics.push(
		diagnostic.refusedHolePosition(
			ctx.input.component.source,
			siteOf(node),
			refusal,
		),
	)
	return true
}

const rootAttrNode = (
	component: ComponentIR,
	thunk: AstNode,
): AstNode | null => {
	const prop = hostPropOf(thunk)
	if (prop === null || !component.exposeProps.get(prop)?.parser) return null
	const attr = component.root.attrs.find(
		a => a.kind === 'server' && a.name === prop,
	)
	return attr?.kind === 'server' ? attr.node : null
}

const arrowBody = (thunk: AstNode): AstNode | null =>
	isNode(thunk.body) && thunk.body.type !== 'BlockStatement' ? thunk.body : null

/** The node SSG renders for a reactive thunk, the scope it reads in, or `none` when SSG renders nothing. */
const thunkValue = (
	ctx: WalkContext,
	lex: Lexical,
	thunk: AstNode,
): { node: AstNode | null; scope: Scope } | 'none' => {
	const mirror = rootAttrNode(ctx.input.component, thunk)
	if (mirror) return { node: mirror, scope: rootScope(lex.scope) }
	const reads = hostDerivedFold(
		thunk,
		ctx.foldable,
		ctx.refGuards,
		ctx.foldScope,
	)
	if (
		(reads !== null && reads.length > 0) ||
		isServerEvaluable(thunk, lex.known)
	)
		return { node: arrowBody(thunk), scope: lex.scope }
	return 'none'
}

const rootScope = (scope: Scope): Scope => {
	let current = scope
	while (current.parent) current = current.parent
	return current
}

const signalGet = (name: string): AstNode => ({
	type: 'CallExpression',
	optional: false,
	arguments: [],
	callee: {
		type: 'MemberExpression',
		computed: false,
		optional: false,
		object: { type: 'Identifier', name },
		property: { type: 'Identifier', name: 'get' },
	},
})

const walkExpr = (
	ctx: WalkContext,
	node: Extract<TemplateNode, { kind: 'expr' }>,
	lex: Lexical,
): void => {
	const { component } = ctx.input
	if (isChildrenInsertion(node)) {
		if (refusedContent(ctx, lex, node.expr)) return
		const value = serverValue(ctx, lex, node.expr, 'the `children` insertion')
		if (value) emit(ctx, holeOp(value, 'composed-markup'))
		return
	}
	if (node.reactivity === 'server') {
		if (refusedContent(ctx, lex, node.expr)) return
		const value = serverValue(ctx, lex, node.expr, 'a text position')
		if (value) emit(ctx, holeOp(value, 'text'))
		return
	}
	if (ctx.inArmTemplate) return
	const expr = node.expr
	let rendered: { node: AstNode | null; scope: Scope } | 'none'
	if (expr.type === 'Identifier') {
		const name = String(expr.name)
		rendered = component.signals.some(s => s.name === name)
			? lex.known.has(name)
				? { node: signalGet(name), scope: lex.scope }
				: 'none'
			: { node: expr, scope: lex.scope }
	} else if (expr.type === 'ArrowFunctionExpression') {
		rendered = thunkValue(ctx, lex, expr)
	} else
		rendered = isServerEvaluable(expr, lex.known)
			? { node: expr, scope: lex.scope }
			: 'none'
	if (rendered === 'none') return
	if (refusedContent(ctx, lex, expr)) return
	const value = initialValue(ctx, rendered.scope, rendered.node, expr)
	if (value) emit(ctx, holeOp(value, 'text'))
}

/** `cls(map)`'s tokens when every value folds at build, else null. */
const foldedClassTokens = (
	ctx: WalkContext,
	lex: Lexical,
	object: AstNode,
): string | null => {
	const tokens: string[] = []
	for (const property of Array.isArray(object.properties)
		? object.properties
		: []) {
		if (!isNode(property) || property.type !== 'Property' || property.computed)
			return null
		const key = isNode(property.key)
			? property.key.type === 'Identifier'
				? String(property.key.name)
				: property.key.type === 'Literal'
					? String(property.key.value)
					: null
			: null
		const value = portableExpr(ctx.portable, lex.scope, property.value)
		if (key === null || value?.kind !== 'literal') return null
		if (value.value) tokens.push(key)
	}
	return tokens.join(' ')
}

/** `styleAttr(map)` as a segment list: each value folds or is a template literal; null otherwise. */
const styleSegments = (
	ctx: WalkContext,
	lex: Lexical,
	object: AstNode,
): HoleValue | null => {
	const segments: Array<
		{ kind: 'literal'; text: string } | { kind: 'hole'; value: PortableExpr }
	> = []
	let first = true
	for (const property of Array.isArray(object.properties)
		? object.properties
		: []) {
		if (!isNode(property) || property.type !== 'Property' || property.computed)
			return null
		const key = isNode(property.key)
			? property.key.type === 'Identifier'
				? String(property.key.name)
				: property.key.type === 'Literal'
					? String(property.key.value)
					: null
			: null
		const value = portableHoleValue(ctx.portable, lex.scope, property.value)
		if (key === null || value === null) return null
		if (value.kind === 'literal' && value.value == null) continue
		if (value.kind !== 'literal' && value.kind !== 'segments') return null
		segments.push({ kind: 'literal', text: `${first ? '' : '; '}${key}: ` })
		first = false
		if (value.kind === 'literal')
			segments.push({ kind: 'literal', text: String(value.value) })
		else segments.push(...value.segments)
	}
	if (first) return { kind: 'literal', value: null }
	const merged: typeof segments = []
	for (const segment of segments) {
		const last = merged.at(-1)
		if (segment.kind === 'literal' && last?.kind === 'literal')
			merged[merged.length - 1] = {
				kind: 'literal',
				text: last.text + segment.text,
			}
		else merged.push(segment)
	}
	return merged.every(s => s.kind === 'literal')
		? {
				kind: 'literal',
				value: merged.map(s => (s as { text: string }).text).join(''),
			}
		: { kind: 'segments', segments: merged }
}

const styleMapOp = (
	ctx: WalkContext,
	lex: Lexical,
	attr: Extract<AttributeIR, { kind: 'style-map' }>,
): TemplateOp | null => {
	const value = styleSegments(ctx, lex, attr.object)
	if (value === null) {
		route(
			ctx,
			'non-portable initial',
			`\`${sourceText(ctx, attr.thunk).replace(/\s+/g, ' ')}\``,
			attr.thunk,
		)
		return null
	}
	return holeOp(value, 'style-value', 'style')
}

const attributeHole = (
	html: HtmlWriter<TemplateOp>,
	name: string,
	value: HoleValue | null,
): void => {
	if (value) html.expr(holeOp(value, attributeContext(name), name))
}

const openElement = (
	ctx: WalkContext,
	element: ElementNode,
	lex: Lexical,
	extraAttrs: readonly StaticAttr[] = [],
): void => {
	const html = new HtmlWriter<TemplateOp>().static(`<${element.tag}`)
	let staticClass: string | null = null
	let classTokens: string | null = null
	for (const attr of [...extraAttrs, ...element.attrs]) {
		switch (attr.kind) {
			case 'static':
				if (attr.name === 'class') staticClass = attr.value ?? ''
				else html.attr(attr.name, attr.value)
				break
			case 'server':
				if (refusedAttribute(ctx, attr.name, attr.node)) break
				attributeHole(
					html,
					attr.name,
					serverValue(ctx, lex, attr.node, `the \`${attr.name}\` attribute`),
				)
				break
			case 'reactive': {
				if (ctx.inArmTemplate) break
				const rendered = thunkValue(ctx, lex, attr.thunk)
				if (rendered === 'none') break
				if (refusedAttribute(ctx, attr.name, attr.thunk)) break
				attributeHole(
					html,
					attr.name,
					initialValue(ctx, rendered.scope, rendered.node, attr.thunk),
				)
				break
			}
			case 'class-map':
				if (!ctx.inArmTemplate && isServerEvaluable(attr.object, lex.known)) {
					classTokens = foldedClassTokens(ctx, lex, attr.object)
					if (classTokens === null)
						route(
							ctx,
							'non-portable initial',
							`\`${sourceText(ctx, attr.thunk).replace(/\s+/g, ' ')}\``,
							attr.thunk,
						)
				}
				break
			case 'style-map':
				if (!ctx.inArmTemplate && isServerEvaluable(attr.object, lex.known)) {
					const op = styleMapOp(ctx, lex, attr)
					if (op) html.expr(op)
				}
				break
			case 'html':
			case 'pass':
			case 'event':
			case 'ref':
			case 'handler-arg':
				break
		}
	}
	if (classTokens !== null || staticClass !== null) {
		html.static(' class="')
		if (staticClass) html.text(staticClass)
		if (classTokens !== null) {
			if (staticClass) html.static(' ')
			html.static(classTokens)
		}
		html.static('"')
	}
	flush(ctx, html.static('>'))
}

const closeElement = (ctx: WalkContext, tag: string): void => {
	if (!isVoidElement(tag)) emitMarkup(ctx, `</${tag}>`)
}

const contentOf = (lex: Lexical, tag: string): Lexical =>
	RAW_CONTENT_TAGS.has(tag) ? { ...lex, content: tag } : lex

const walkPlainElement = (
	ctx: WalkContext,
	node: ElementNode,
	lex: Lexical,
	extraAttrs: readonly StaticAttr[] = [],
): void => {
	openElement(ctx, node, lex, extraAttrs)
	const inner = contentOf(lex, node.tag)
	const htmlAttr = node.attrs.find(a => a.kind === 'html')
	if (
		htmlAttr?.kind === 'html' &&
		isServerEvaluable(htmlAttr.node, lex.known)
	) {
		if (!refusedContent(ctx, inner, htmlAttr.node)) {
			const value = htmlAttr.reactive
				? initialValue(ctx, lex.scope, htmlAttr.node, htmlAttr.thunk)
				: serverValue(ctx, lex, htmlAttr.node, '`truc:html`')
			if (value) emit(ctx, holeOp(value, 'html'))
		}
	}
	for (const child of node.children) walkNode(ctx, child, inner)
	closeElement(ctx, node.tag)
}

const isComposeHostAttr = (name: string): boolean =>
	name === 'class' || name === 'id' || name.startsWith('data-')

/** A compose arg as the child receives it; a value-less or literal arg carries its JSON text. */
const composeArgValue = (
	ctx: WalkContext,
	lex: Lexical,
	arg: Extract<ComposeNode['attrs'][number], { kind: 'arg' }>,
	position: string,
	at: AstNode,
): HoleValue | null => {
	if (arg.node) return serverValue(ctx, lex, arg.node, position)
	return {
		kind: 'literal',
		value: JSON.parse(arg.exprText) as string | boolean,
	}
}

/** The locale a composed child's record resolves at, as the SSG compose call picks it; null when it is not known at build. */
const childLocale = (
	ctx: WalkContext,
	lex: Lexical,
	node: ComposeNode,
	entry: InternalRegistryEntry,
): string | null => {
	const { component, locale, pageLocale } = ctx.input
	if (!entry.declaresI18n) return locale
	const langArg = node.attrs.find(
		(a): a is Extract<ComposeNode['attrs'][number], { kind: 'arg' }> =>
			a.kind === 'arg' && a.name === 'lang',
	)
	if (langArg) {
		const value = composeArgValue(
			ctx,
			lex,
			langArg,
			`the locale of \`<${node.component}>\``,
			node.node,
		)
		if (value?.kind === 'literal' && typeof value.value === 'string')
			return value.value || pageLocale
		if (value)
			ctx.diagnostics.push(
				diagnostic.nonPortableHole(
					component.source,
					siteOf(langArg.node ?? node.node),
					langArg.exprText,
					`the locale of \`<${node.component}>\``,
					'subset',
				),
			)
		return null
	}
	if (component.declaresI18n && component.langBinding !== null) {
		const value = portableExpr(ctx.portable, lex.scope, {
			type: 'Identifier',
			name: component.langBinding,
		})
		if (value?.kind === 'literal' && typeof value.value === 'string')
			return value.value || pageLocale
		ctx.diagnostics.push(
			diagnostic.nonPortableHole(
				component.source,
				siteOf(node.node),
				component.langBinding,
				`the locale of \`<${node.component}>\``,
				'subset',
			),
		)
		return null
	}
	return entry.langArgDefault || pageLocale
}

const walkCompose = (
	ctx: WalkContext,
	node: ComposeNode,
	lex: Lexical,
	extraHostAttrs: readonly StaticAttr[] = [],
): void => {
	const entry = ctx.input.composeRegistry.get(node.source)
	if (!entry) return
	if (node.children.length > 0) {
		route(
			ctx,
			'not yet emittable',
			`the content passed to \`<${node.component}>\` as children`,
			node.node,
		)
		return
	}
	const args: IncludeArg[] = []
	const hostAttributes: IncludeArg[] = []
	let complete = true
	for (const attr of node.attrs) {
		if (attr.kind !== 'arg') continue
		const host = isComposeHostAttr(attr.name)
		const value = composeArgValue(
			ctx,
			lex,
			attr,
			host
				? `the \`${attr.name}\` attribute of \`<${node.component}>\``
				: `the \`${attr.name}\` arg of \`<${node.component}>\``,
			node.node,
		)
		if (value === null) {
			complete = false
			continue
		}
		;(host ? hostAttributes : args).push({ name: attr.name, value })
	}
	for (const attr of extraHostAttrs)
		hostAttributes.push({
			name: attr.name,
			value: { kind: 'literal', value: attr.value ?? '' },
		})
	const locale = childLocale(ctx, lex, node, entry)
	if (!complete || locale === null) return
	emit(ctx, { op: 'include', tag: entry.tag, locale, args, hostAttributes })
}

const armRoot = (arm: ArmTemplate | undefined): BoundaryArmRoot | undefined =>
	arm?.children.find(isBoundaryArmRoot)

/** The branches of a JS `if`/`switch` over `test`, each arm rendered by `render`. */
const branchesOf = (
	ctx: WalkContext,
	node: ConditionalNode,
	test: PortableExpr,
	cases: ReadonlyArray<PortableExpr | null>,
	render: (arm: ArmTemplate | undefined) => void,
): TemplateOp => {
	if (isIf(node))
		return {
			op: 'conditional',
			branches: [{ test, body: collect(ctx, () => render(node.arms[0])) }],
			otherwise:
				elseOf(node).length > 0 ? collect(ctx, () => render(node.arms[1])) : [],
		}
	const branches: Array<{ test: PortableExpr; body: TemplateOp[] }> = []
	let otherwise: TemplateOp[] = []
	for (const [index, arm] of node.arms.entries()) {
		const value = cases[index]
		if (arm.test === null || !value) {
			otherwise = collect(ctx, () => render(arm))
			continue
		}
		branches.push({
			test: { kind: 'compare', operator: '===', left: test, right: value },
			body: collect(ctx, () => render(arm)),
		})
	}
	return { op: 'conditional', branches, otherwise }
}

const conditionParts = (
	ctx: WalkContext,
	lex: Lexical,
	node: ConditionalNode,
	value: (node: AstNode | null) => PortableExpr | null,
): { test: PortableExpr; cases: Array<PortableExpr | null> } | null => {
	const test = value(node.test)
	if (!test) return null
	const cases: Array<PortableExpr | null> = []
	for (const arm of node.arms) {
		if (arm.test === null) {
			cases.push(null)
			continue
		}
		const caseValue = value(arm.test)
		if (!caseValue) return null
		cases.push(caseValue)
	}
	return { test, cases }
}

const walkServerConditional = (
	ctx: WalkContext,
	node: ConditionalNode,
	lex: Lexical,
): void => {
	const parts = conditionParts(
		ctx,
		lex,
		node,
		at =>
			serverValue(ctx, lex, at, 'the condition', false) as PortableExpr | null,
	)
	if (!parts) return
	emit(
		ctx,
		branchesOf(ctx, node, parts.test, parts.cases, arm => {
			for (const child of arm?.children ?? []) walkNode(ctx, child, lex)
		}),
	)
}

const walkArmRoot = (
	ctx: WalkContext,
	root: BoundaryArmRoot,
	lex: Lexical,
	extra: readonly StaticAttr[],
): void => {
	if (root.kind === 'compose') walkCompose(ctx, root, lex, extra)
	else walkPlainElement(ctx, root, lex, extra)
}

const walkReactiveConditional = (
	ctx: WalkContext,
	node: ConditionalNode,
	lex: Lexical,
): void => {
	const { component } = ctx.input
	const renderLive = (arm: ArmTemplate | undefined): void => {
		const root = armRoot(arm)
		if (!arm || !root) return
		walkArmRoot(ctx, root, lex, [
			{ kind: 'static', name: 'data-key', value: arm.key },
		])
	}
	const initial = node.initial
	if (ctx.inArmTemplate) {
		// An inert template renders no live arm.
	} else if ('constant' in initial) {
		renderLive(node.arms.find(arm => arm.key === initial.constant))
	} else if (initialFold(component, node, lex.known)) {
		const parts = conditionParts(ctx, lex, node, at =>
			portableExpr(ctx.portable, lex.scope, at),
		)
		if (parts)
			emit(ctx, branchesOf(ctx, node, parts.test, parts.cases, renderLive))
		else
			route(
				ctx,
				'non-portable initial',
				`\`${node.testText.replace(/\s+/g, ' ')}\``,
				node.test,
			)
	}
	const armSet = String(armSetOf(component.root, node))
	for (const arm of node.arms) {
		const root = armRoot(arm)
		if (!root) continue
		const wasInTemplate = ctx.inArmTemplate
		ctx.inArmTemplate = true
		const body = collect(ctx, () => walkArmRoot(ctx, root, lex, []))
		ctx.inArmTemplate = wasInTemplate
		emit(ctx, { op: 'arm-template', armSet, key: arm.key, body })
	}
}

const loopScope = (loop: EachForIR, lex: Lexical): Lexical => {
	const bindings = new Map<string, Binding>()
	const scope = createScope(bindings, lex.scope)
	bindings.set(loop.itemName, { kind: 'item', name: loop.itemName })
	if (loop.indexName)
		bindings.set(loop.indexName, { kind: 'item', name: loop.indexName })
	// A hoisted const's node is its declarator; its initializer stands in for it.
	for (const hoisted of loop.hoisted)
		bindings.set(hoisted.name, {
			kind: 'expr',
			node: isNode(hoisted.node.init) ? hoisted.node.init : hoisted.node,
			scope,
		})
	return {
		known: new Set([
			...lex.known,
			loop.itemName,
			...(loop.indexName ? [loop.indexName] : []),
			...loop.hoisted.map(h => h.name),
		]),
		scope,
		content: lex.content,
	}
}

const walkEach = (ctx: WalkContext, loop: EachForIR, lex: Lexical): void => {
	const source = serverValue(
		ctx,
		lex,
		loop.iterable,
		'the loop source',
		false,
	) as PortableExpr | null
	if (!source) return
	const inner = loopScope(loop, lex)
	const body = collect(ctx, () => {
		openElement(ctx, loop.output, inner)
		for (const child of loop.output.children) walkNode(ctx, child, inner)
		closeElement(ctx, loop.output.tag)
	})
	const empty = collect(ctx, () => {
		for (const node of loop.emptyArm ?? []) walkNode(ctx, node, lex, true)
	})
	emit(ctx, {
		op: 'loop',
		source,
		item: loop.itemName,
		index: loop.indexName,
		body,
		empty,
	})
}

const walkTry = (ctx: WalkContext, node: TryNode): void => {
	if (node.pendingChildren === null)
		route(
			ctx,
			'synchronous try',
			'it catches a JavaScript throw, which no template observes',
			node.node,
		)
	else route(ctx, 'not yet emittable', 'the async boundary', node.node)
}

const walkNode = (
	ctx: WalkContext,
	node: TemplateNode,
	lex: Lexical,
	emptyArm = false,
): void => {
	if (!emptyArm && ctx.emptyArmNodes.has(node)) return
	switch (node.kind) {
		case 'client-stmt':
			return
		case 'text':
			emitMarkup(ctx, node.value)
			return
		case 'expr':
			walkExpr(ctx, node, lex)
			return
		case 'conditional':
			if (node.mode === 'reactive') walkReactiveConditional(ctx, node, lex)
			else walkServerConditional(ctx, node, lex)
			return
		case 'try':
			walkTry(ctx, node)
			return
		case 'compose':
			walkCompose(ctx, node, lex)
			return
		case 'element': {
			const loop = [...ctx.input.component.fors.values()].find(
				f => f.output === node,
			)
			if (loop?.kind === 'each') walkEach(ctx, loop, lex)
			else if (loop?.kind === 'reconcile')
				route(
					ctx,
					'not yet emittable',
					`the reactive list over \`${loop.listSignal}\``,
					loop.node,
				)
			else walkPlainElement(ctx, node, lex)
		}
	}
}

/** The component-level scope: args, the reserved record's members, setup consts. */
const componentScope = (input: TemplateWalkInput): Scope => {
	const { component, locale } = input
	const bindings = new Map<string, Binding>()
	const scope = createScope(bindings)
	for (const name of component.paramNames)
		bindings.set(name, { kind: 'opaque' })
	for (const param of component.paramProps) {
		if (param.name === 'i18n') continue
		bindings.set(param.binding ?? param.name, {
			kind: 'arg',
			name: param.name,
			fallback: param.defaultValue ?? null,
		})
	}
	for (const name of component.messageTBindings ?? [])
		bindings.set(name, { kind: 'messages' })
	const lang = component.langBinding
	if (
		component.declaresI18n &&
		lang !== null &&
		!component.paramProps.some(p => (p.binding ?? p.name) === lang)
	)
		bindings.set(lang, { kind: 'value', value: locale })
	const signals = new Set(component.signals.map(signal => signal.name))
	for (const stmt of component.setup) {
		if (stmt.name === null || signals.has(stmt.name)) continue
		const fn = /^(Arrow)?Function(Expression)?$/.test(stmt.node.type)
		bindings.set(
			stmt.name,
			fn ? { kind: 'opaque' } : { kind: 'expr', node: stmt.node, scope },
		)
	}
	return scope
}

/** The root's `i18n` attribute value at the locale: each client key whose form differs from its source form. */
const clientMessagesValue = (
	input: TemplateWalkInput,
	keys: readonly string[],
	source: Record<string, string | Message>,
): string | null => {
	const forms: Record<string, string | Message | undefined> = {}
	const env = {
		lang: input.locale,
		timeZone: input.timeZone,
		currency: input.currency,
	}
	for (const key of keys) {
		const message = input.messages.get(key)
		if (!message) continue
		if (message.literal !== null) {
			forms[key] = message.literal
			continue
		}
		const parsed = parseMessage(message.pattern)
		if (parsed.ok) forms[key] = bakeMessageEnv(parsed.message, env)
	}
	const picked = changedClientForms(forms, keys, source)
	return Object.keys(picked).length > 0 ? JSON.stringify(picked) : null
}

const openRoot = (ctx: WalkContext, lex: Lexical): void => {
	const { component, clientMessageKeys, locale, messages } = ctx.input
	const html = new HtmlWriter<TemplateOp>().static(`<${component.tag}`)
	for (const attr of component.root.attrs) {
		if (attr.kind === 'static') html.attr(attr.name, attr.value)
		else if (attr.kind === 'server') {
			if (refusedAttribute(ctx, attr.name, attr.node)) continue
			attributeHole(
				html,
				attr.name,
				serverValue(ctx, lex, attr.node, `the \`${attr.name}\` attribute`),
			)
		} else if (
			attr.kind === 'style-map' &&
			isServerEvaluable(attr.object, component.serverKnown)
		) {
			const op = styleMapOp(ctx, lex, attr)
			if (op) html.expr(op)
		} else if (
			attr.kind === 'class-map' &&
			isServerEvaluable(attr.object, component.serverKnown)
		) {
			const tokens = foldedClassTokens(ctx, lex, attr.object)
			if (tokens === null)
				route(
					ctx,
					'non-portable initial',
					`\`${sourceText(ctx, attr.thunk).replace(/\s+/g, ' ')}\``,
					attr.thunk,
				)
			else
				html.expr({
					op: 'hole',
					context: 'class-token',
					attribute: 'class',
					value: { kind: 'literal', value: tokens || null },
				})
		}
	}
	const rootLang = component.root.attrs.some(
		a => 'name' in a && a.name === 'lang',
	)
	if (component.declaresI18n && component.langBinding !== null && !rootLang) {
		const value = portableExpr(ctx.portable, lex.scope, {
			type: 'Identifier',
			name: component.langBinding,
		})
		if (value)
			html.expr({
				op: 'hole',
				context: 'quoted-attribute',
				attribute: 'lang',
				value,
			})
	}
	const tBinding = component.messageTBindings?.[0]
	if (clientMessageKeys.length > 0 && tBinding) {
		const { source, withArgs } = clientSourceRecord(
			component.i18nMessages,
			clientMessageKeys,
		)
		const formats = [
			...carriedKinds([...withArgs].map(key => source[key] as Message)),
		].some(kind => FORMATTING_KINDS.has(kind))
		const rendersLang =
			(component.declaresI18n && component.langBinding !== null) || rootLang
		if (formats && !rendersLang) {
			const withArguments = clientMessageKeys.some(
				key => messages.get(key)?.literal === null,
			)
			html.expr({
				op: 'hole',
				context: 'quoted-attribute',
				attribute: 'lang',
				value: { kind: 'literal', value: withArguments ? locale : null },
			})
		}
		html.expr({
			op: 'hole',
			context: 'quoted-attribute',
			attribute: 'i18n',
			value: {
				kind: 'literal',
				value: clientMessagesValue(ctx.input, clientMessageKeys, source),
			},
		})
	}
	flush(ctx, html.static('>'))
}

const routeKeyAliases = (ctx: WalkContext): void => {
	const { component } = ctx.input
	for (const signal of component.signals) {
		if (
			signal.family !== 'declared' ||
			!isAliasHarvestable(component, signal) ||
			!harvestsPerField(signal) ||
			!aliasScopeOf(component, signal.name)
		)
			continue
		route(
			ctx,
			'key-alias harvest',
			`\`${signal.name}\` is harvested through a key alias, whose render witness no template carries`,
			null,
		)
	}
}

/* === Exported Functions === */

/**
 * Walk one component into emission operations at one locale.
 *
 * @param input - The component, its compose registry and its locale facts
 * @returns The operations, the routing outcomes and the LTC057/LTC058 findings
 */
export const walkPartial = (input: TemplateWalkInput): TemplateWalkResult => {
	const { component } = input
	const ctx: WalkContext = {
		input,
		portable: {
			component,
			messages: input.messages,
			hostProps: foldableHostProps(component),
		},
		out: [],
		inArmTemplate: false,
		routing: [],
		diagnostics: [],
		emptyArmNodes: new Set(
			[...component.fors.values()].flatMap(loop => loop.emptyArm ?? []),
		),
		foldScope: foldableRenderScope(component),
		foldable: foldableHostProps(component),
		refGuards: foldableRefGuards(component),
	}
	const lex: Lexical = {
		known: component.serverKnown,
		scope: componentScope(input),
		content: null,
	}
	routeKeyAliases(ctx)
	openRoot(ctx, lex)
	for (const child of component.root.children) walkNode(ctx, child, lex)
	emitMarkup(ctx, `</${component.tag}>`)
	return { ops: ctx.out, routing: ctx.routing, diagnostics: ctx.diagnostics }
}
