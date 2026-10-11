import {
	type AstNode,
	freeIdentifiers,
	hostPropOf,
	identifiersIn,
} from './ast-utils'
import {
	type BoundaryArmRoot,
	htmlThunkSignalName,
	isBoundaryArmRoot,
	lazyCatchMessageEl,
} from './boundary-arms'
import {
	CHILDREN_MARKER,
	type ChildrenInsertions,
	childrenInsertionsOf,
	isChildrenInsertion,
} from './children-region'
import { CodeBuilder, HtmlWriter, jsData, jsString } from './codegen'
import { isVoidElement } from './core'
import {
	foldableHostProps,
	foldableRefGuards,
	foldableRenderScope,
	hostDerivedFold,
	hostSeedExpr,
	initializerHostReads,
	isServerEvaluable,
	spliceHostDerivedFold,
} from './evaluability'
import { declaredRefNames } from './first-refs'
import { i18nAnnotated } from './i18n'
import { carriedKinds, FORMATTING_KINDS, type Message } from './icu/evaluate'
import { clientSourceRecord } from './icu/parse'
import { RUNTIME_HARNESS_EXPORTS } from './imports'
import { initialFold } from './initial-winner'
import type {
	ArmTemplate,
	AttributeIR,
	ComponentIR,
	ContextSignalIR,
	ForIR,
	ItemSetupStmt,
	ReconcileForIR,
	SetupStmt,
	TemplateNode,
} from './ir'
import { aliasScopeOf, harvestsPerField, isAliasHarvestable } from './key-alias'
import { NO_DEPS } from './reactivity'
import type { InternalRegistryEntry } from './registry'
import { onServer } from './setup-extraction'
import { reindent, type SourceSpan } from './spans'
import type { EvaluationTier } from './tier'
import { CLIENT_ONLY_PRIMITIVES, CONTEXT_NAMES, JS_GLOBALS } from './vocabulary'
import {
	armSetOf,
	type ConditionalNode,
	childNodes,
	elseOf,
	enclosingLists,
	hasArmSet,
	inNestedScope,
	isIf,
	listIndexOf,
	loopBindingNames,
	walkTemplate,
} from './walk'

/* === Types === */

export type EmittedServerModule = {
	/** Full TypeScript source of the generated module. */
	code: string
	/** Runtime helper names the module imports. */
	runtimeImports: Set<string>
	spans: SourceSpan[]
}

type ElementNode = Extract<TemplateNode, { kind: 'element' }>
type TryNode = Extract<TemplateNode, { kind: 'try' }>
type ComposeNode = Extract<TemplateNode, { kind: 'compose' }>

const EMITTED_HARNESS_NAMES = [
	'attr',
	'clientLocale',
	'clientMessages',
	'cls',
	'composeHostAttrs',
	'entries',
	'esc',
	'i18nRecord',
	'isPending',
	'items',
	'refStub',
	'sanitizeHtml',
	'styleAttr',
	'text',
	'textOf',
	'witnessHarvest',
] as const
type EmittedHarnessName = (typeof EMITTED_HARNESS_NAMES)[number]

const renderScopeNames = (component: ComponentIR): Set<string> => {
	const names = new Set<string>(component.paramNames)
	for (const stmt of component.setup) if (stmt.name) names.add(stmt.name)
	for (const loop of component.fors.values()) {
		loopBindingNames(loop, names)
		if (loop.kind === 'reconcile' && loop.keyName) names.add(loop.keyName)
	}
	walkTemplate(component.root, node => {
		if (node.kind === 'try' && node.catchParam) names.add(node.catchParam)
	})
	return names
}

/** The import specifier for `name`, aliased when the emitter aliased it. */
const importSpecifier = (name: string, local: string): string =>
	local === name ? name : `${name} as ${local}`

type EmitContext = {
	component: ComponentIR
	composeRegistry: ReadonlyMap<string, InternalRegistryEntry> | undefined
	/** The render function's markup statements, in emission order. */
	out: CodeBuilder
	/** Runtime harness names referenced by the emitted code → import line. */
	used: Set<string>
	/** Composed component name → generated server module specifier. */
	composeImports: Map<string, string>
	buffer: string
	/** Unique suffix counters for @try arm / composed-children buffers. */
	armCounter: number
	childrenCounter: number
	childrenOwner: string | null
	childrenInsertions: ChildrenInsertions
	usedI18nRecord: boolean
	foldScope: ReadonlySet<string>
	inArmTemplate: boolean
	templateUnbound: ReadonlySet<string>
	listItems: Set<string>
	listFlags: Map<ReconcileForIR, string>
	witnesses: Map<ReconcileForIR, { list: string; keys: string }>
	emptyArmNodes: ReadonlySet<TemplateNode>
	/** Unique suffix counter for the loops' `__emptyN` flags. */
	emptyCounter: number
	h: (name: EmittedHarnessName) => string
	mint: (name: string) => string
}

/* === Internal Functions === */

/** One `<buffer>.push(<expr>)` statement into the current buffer. */
const push = (ctx: EmitContext, expr: string): void => {
	ctx.out.line(`${ctx.buffer}.push(${expr})`)
}

const pushText = (
	ctx: EmitContext,
	out: CodeBuilder,
	sink: 'text' | 'textOf',
	value: string,
	child: { expr: AstNode; exprText: string } | null,
): void => {
	ctx.used.add(sink)
	const call = `${ctx.h(sink)}(`
	const start = child?.expr.start
	const slices =
		child && typeof start === 'number' && value.startsWith(child.exprText)
			? [
					{ text: call, start },
					{ text: child.exprText, start },
				]
			: []
	out.line(`${ctx.buffer}.push(${call}${value}))`, slices)
}

/** Push a closing tag, unless the element is void. */
const pushClose = (ctx: EmitContext, tag: string): void => {
	if (!isVoidElement(tag)) push(ctx, jsString(`</${tag}>`))
}

const retainReferenced = (
	setup: readonly SetupStmt[],
	markup: readonly string[],
): SetupStmt[] => {
	const referenced = new Set(markup.flatMap(identifiersIn))
	const retained = new Set<SetupStmt>()
	for (let changed = true; changed; ) {
		changed = false
		for (const stmt of setup) {
			if (retained.has(stmt) || stmt.name === null) continue
			if (!referenced.has(stmt.name)) continue
			retained.add(stmt)
			for (const name of identifiersIn(stmt.text)) referenced.add(name)
			changed = true
		}
	}
	return setup.filter(stmt => retained.has(stmt))
}

const dropUnreferencedUnevaluable = (
	setup: readonly SetupStmt[],
	unevaluable: (stmt: SetupStmt) => boolean,
	markup: readonly string[],
): SetupStmt[] => {
	let kept = [...setup]
	for (let changed = true; changed; ) {
		changed = false
		const referenced = new Set([
			...markup.flatMap(identifiersIn),
			...kept.flatMap(stmt =>
				identifiersIn(stmt.text).filter(name => name !== stmt.name),
			),
		])
		const next = kept.filter(
			stmt =>
				!unevaluable(stmt) || stmt.name === null || referenced.has(stmt.name),
		)
		if (next.length !== kept.length) {
			kept = next
			changed = true
		}
	}
	return kept
}

const lazyValueExpression = (
	ctx: EmitContext,
	exprText: string,
	expr: AstNode,
	scope: ReadonlySet<string>,
): { expr: string; thunk: boolean } => {
	const component = ctx.component
	const value = (text: string) => ({ expr: text, thunk: false })
	if (expr.type === 'Identifier') {
		const name = String(expr.name)
		if (component.signals.some(s => s.name === name))
			// An unresolvable signal (an unseeded sensor) is not in scope.
			return value(scope.has(name) ? `${name}.get()` : "''")
		return value(exprText)
	}
	if (expr.type === 'ArrowFunctionExpression') {
		const mirror = hostPropMirrorExpr(component, expr)
		if (mirror !== null) return value(mirror)
		const derived = hostDerivedExpr(ctx, expr, exprText, ctx.foldScope)
		if (derived !== null) return value(derived)
	}
	if (!isServerEvaluable(expr, scope)) return value("''")
	if (expr.type === 'ArrowFunctionExpression')
		return { expr: exprText, thunk: true }
	return value(exprText)
}

const hostPropMirrorExpr = (
	component: ComponentIR,
	thunk: AstNode,
): string | null => {
	const propName = hostPropOf(thunk)
	if (propName === null || !component.exposeProps.get(propName)?.parser)
		return null
	const rootAttr = component.root.attrs.find(
		(a): a is Extract<AttributeIR, { kind: 'server' }> =>
			a.kind === 'server' && a.name === propName,
	)
	return rootAttr ? rootAttr.exprText : null
}

const useSeedNames = (ctx: EmitContext, seed: string): void => {
	for (const id of identifiersIn(seed))
		if (RUNTIME_HARNESS_EXPORTS.has(id)) ctx.used.add(id)
}

const foldSeedOf =
	(ctx: EmitContext) =>
	(prop: string, kind: 'prop' | 'ref'): string => {
		if (kind === 'ref') return foldableRefGuards(ctx.component).get(prop) ?? ''
		const seed = hostSeedExpr(ctx.component, prop)
		if (seed !== null) useSeedNames(ctx, seed)
		return seed ?? ''
	}

const hostDerivedExpr = (
	ctx: EmitContext,
	thunk: AstNode,
	thunkText: string,
	allow: ReadonlySet<string>,
): string | null => {
	const reads = hostDerivedFold(
		thunk,
		foldableHostProps(ctx.component),
		foldableRefGuards(ctx.component),
		allow,
	)
	if (reads === null || reads.length === 0) return null
	return `(${spliceHostDerivedFold(
		thunkText,
		typeof thunk.start === 'number' ? thunk.start : 0,
		reads,
		foldSeedOf(ctx),
	)})()`
}

const listTemplate = (
	ctx: EmitContext,
	loop: ReconcileForIR,
	listIndex: number,
	scope: ReadonlySet<string>,
): CodeBuilder => {
	const out = ctx.out.fork()
	const pushTo = (expr: string): void => {
		out.line(`${ctx.buffer}.push(${expr})`)
	}
	pushTo(`'<template data-list="${listIndex}">'`)
	const unbound = [
		loop.itemName,
		...(loop.keyName === null ? [] : [loop.keyName]),
		...loop.setup.flatMap(stmt => (stmt.name === null ? [] : [stmt.name])),
	]
	const cloneTime = new Set(
		loop.setup.flatMap(stmt => (stmt.kind === 'const' ? [stmt.name] : [])),
	)
	if (loop.keyName !== null) cloneTime.add(loop.keyName)
	const nested = (node: TemplateNode): void => {
		const saved = {
			out: ctx.out,
			inArmTemplate: ctx.inArmTemplate,
			templateUnbound: ctx.templateUnbound,
		}
		ctx.out = out
		ctx.inArmTemplate = true
		ctx.templateUnbound = new Set([...saved.templateUnbound, ...unbound])
		try {
			emit(ctx, node, scope)
		} finally {
			ctx.out = saved.out
			ctx.inArmTemplate = saved.inArmTemplate
			ctx.templateUnbound = saved.templateUnbound
		}
	}
	const shape = (node: TemplateNode): void => {
		// A nested list's `@empty` roots render from its own emission.
		if (ctx.emptyArmNodes.has(node)) return
		if (
			hasArmSet(node) ||
			(node.kind === 'element' &&
				node !== loop.output &&
				[...ctx.component.fors.values()].some(f => f.output === node))
		) {
			nested(node)
			return
		}
		if (node.kind === 'text') {
			pushTo(jsString(node.value, 'double'))
			return
		}
		if (node.kind === 'expr') {
			if (node.reactivity === 'server')
				pushText(ctx, out, 'text', node.exprText, node)
			return
		}
		if (node.kind === 'conditional' && node.mode === 'server') {
			emitJsConditional(out, node.testText, node, arm => {
				for (const child of arm?.children ?? []) shape(child)
			})
			return
		}
		if (node.kind === 'compose') {
			const saved = ctx.out
			ctx.out = out
			try {
				emit(ctx, node, scope)
			} finally {
				ctx.out = saved
			}
			return
		}
		if (node.kind !== 'element') return
		const html = new HtmlWriter().static(`<${node.tag}`)
		for (const attr of node.attrs) {
			if (attr.kind === 'static') html.attr(attr.name, attr.value)
			else if (attr.kind === 'server') {
				const reads = [...freeIdentifiers(attr.node)]
				if (reads.length > 0 && reads.every(n => cloneTime.has(n))) continue
				if (reads.some(n => ctx.templateUnbound.has(n))) continue
				ctx.used.add('esc')
				html
					.static(` ${attr.name}="`)
					.expr(`${ctx.h('esc')}(String(${attr.exprText}))`)
					.static('"')
			}
		}
		pushTo(`${html.static('>')}`)
		for (const child of node.children) shape(child)
		if (!isVoidElement(node.tag)) pushTo(jsString(`</${node.tag}>`))
	}
	out.depth++
	shape(loop.output)
	out.depth--
	pushTo("'</template>'")
	return out
}

const declareListFlags = (ctx: EmitContext): void => {
	const { component } = ctx
	const visit = (node: TemplateNode, guarded: boolean): void => {
		const loop = [...component.fors.values()].find(
			(f): f is ReconcileForIR => f.kind === 'reconcile' && f.output === node,
		)
		if (loop && guarded) {
			const flag = ctx.mint(
				`__list${listIndexOf(component.root, component.fors, loop)}`,
			)
			ctx.listFlags.set(loop, flag)
			ctx.out.line(`let ${flag} = false`)
		}
		const inner =
			guarded ||
			(node.kind === 'conditional' && node.mode === 'server') ||
			(node.kind === 'try' && node.pendingChildren === null)
		for (const child of childNodes(node)) visit(child, inner)
	}
	visit(component.root, false)
}

const declareWitnesses = (ctx: EmitContext): void => {
	const { component } = ctx
	for (const signal of component.signals) {
		if (
			signal.family !== 'declared' ||
			!isAliasHarvestable(component, signal) ||
			!harvestsPerField(signal)
		)
			continue
		const scope = aliasScopeOf(component, signal.name)
		if (!scope) continue
		const keys = ctx.mint(`__witness${ctx.witnesses.size}`)
		ctx.witnesses.set(scope, { list: signal.name, keys })
		ctx.out.line(`const ${keys}: string[] = []`)
	}
}

const checkWitnesses = (ctx: EmitContext): void => {
	for (const { list, keys } of ctx.witnesses.values()) {
		ctx.used.add('witnessHarvest')
		ctx.out.line(
			`${ctx.h('witnessHarvest')}(${jsString(ctx.component.tag)}, ${jsString(list)}, ${list}.keys(), ${keys})`,
		)
	}
}

const emitListTemplates = (ctx: EmitContext): void => {
	const { component } = ctx
	const loops = [...component.fors.values()]
		.filter((loop): loop is ReconcileForIR => loop.kind === 'reconcile')
		.map(loop => ({
			loop,
			index: listIndexOf(component.root, component.fors, loop),
		}))
		.sort((a, b) => a.index - b.index)
	for (const { loop, index } of loops) {
		const unbound = enclosingLists(
			component.root,
			component.fors,
			loop.output,
		).flatMap(outer => [
			outer.itemName,
			...(outer.keyName === null ? [] : [outer.keyName]),
			...outer.setup.flatMap(stmt => (stmt.name === null ? [] : [stmt.name])),
		])
		const saved = {
			inArmTemplate: ctx.inArmTemplate,
			templateUnbound: ctx.templateUnbound,
		}
		ctx.inArmTemplate = inNestedScope(
			component.root,
			component.fors,
			loop.output,
		)
		ctx.templateUnbound = new Set(unbound)
		const flag = ctx.listFlags.get(loop)
		try {
			if (flag) ctx.out.open(`if (${flag}) {`)
			ctx.out.append(listTemplate(ctx, loop, index, component.serverKnown))
			if (flag) ctx.out.close()
		} finally {
			ctx.inArmTemplate = saved.inArmTemplate
			ctx.templateUnbound = saved.templateUnbound
		}
	}
}

const emitItemSetup = (
	ctx: EmitContext,
	loop: ReconcileForIR,
	setup: readonly ItemSetupStmt[],
): void => {
	if (setup.length === 0) return
	const refs = declaredRefNames(ctx.component.firstRefs)
	for (const stmt of loop.setup) if (stmt.kind === 'ref') refs.add(stmt.name)
	const stubs = new Set<string>()
	for (const stmt of setup)
		for (const name of freeIdentifiers(stmt.node))
			if (
				refs.has(name) ||
				CONTEXT_NAMES.has(name) ||
				CLIENT_ONLY_PRIMITIVES.has(name)
			)
				stubs.add(name)
	if (stubs.size > 0) ctx.used.add('refStub')
	for (const name of [...stubs].sort())
		ctx.out.line(`const ${name}: any = ${ctx.h('refStub')}`)
	for (const stmt of setup) {
		if (stmt.kind === 'signal') {
			ctx.used.add(stmt.constructor)
			for (const id of identifiersIn(stmt.text))
				if (RUNTIME_HARNESS_EXPORTS.has(id)) ctx.used.add(id)
		}
		ctx.out.line(stmt.text, [{ text: stmt.text, start: stmt.range.start }])
	}
}

const emitListFor = (
	ctx: EmitContext,
	loop: ReconcileForIR,
	scope: ReadonlySet<string>,
): void => {
	const keyVar = loop.keyName ?? ctx.mint('__key')
	const loopScope = new Set(scope)
	loopScope.add(loop.itemName)
	if (loop.keyName) loopScope.add(keyVar)
	const setup = loop.setup.filter(onServer)
	for (const stmt of setup) loopScope.add(stmt.name as string)
	const emptyFlag = openEmptyFlag(ctx, loop)
	if (!ctx.inArmTemplate) {
		ctx.out.open(
			`for (const [${keyVar}, ${loop.itemName}] of ${loop.listSignal}.entries()) {`,
		)
		if (emptyFlag) ctx.out.line(`${emptyFlag} = false`)
		emitItemSetup(ctx, loop, setup)
		const witness = ctx.witnesses.get(loop)
		if (witness) ctx.out.line(`${witness.keys}.push(${keyVar})`)
		const cells = [
			loop.itemName,
			...setup.flatMap(stmt => (stmt.kind === 'signal' ? [stmt.name] : [])),
		]
		const added = cells.filter(name => !ctx.listItems.has(name))
		for (const name of added) ctx.listItems.add(name)
		const shadowed = setup
			.flatMap(stmt => (stmt.kind === 'const' ? [stmt.name] : []))
			.filter(name => ctx.listItems.delete(name))
		const dataKey: AttributeIR = {
			kind: 'server',
			name: 'data-key',
			exprText: keyVar,
			node: loop.node,
			// Compiler-minted locals: no authored dependency.
			deps: NO_DEPS,
		}
		emitElement(ctx, loop.output, loopScope, [dataKey])
		for (const child of loop.output.children) emit(ctx, child, loopScope)
		for (const name of added) ctx.listItems.delete(name)
		for (const name of shadowed) ctx.listItems.add(name)
		pushClose(ctx, loop.output.tag)
		ctx.out.close()
	}

	if (emptyFlag && loop.emptyArm) {
		ctx.used.add('attr')
		for (const root of loop.emptyArm) {
			if (root.kind !== 'element') continue
			emitElement(ctx, root, scope, [
				{ kind: 'static', name: 'data-unreconciled', value: null },
				{
					kind: 'server',
					name: 'hidden',
					exprText: `!${emptyFlag}`,
					node: loop.node,
					deps: NO_DEPS,
				},
			])
			for (const child of root.children) emit(ctx, child, scope)
			pushClose(ctx, root.tag)
		}
	}
	const listFlag = ctx.listFlags.get(loop)
	if (listFlag) ctx.out.line(`${listFlag} = true`)
}

const openEmptyFlag = (ctx: EmitContext, loop: ForIR): string | null => {
	if (!loop.emptyArm) return null
	const flag = ctx.mint(`__empty${ctx.emptyCounter++}`)
	ctx.out.line(`let ${flag} = true`)
	return flag
}

const emitFor = (
	ctx: EmitContext,
	loop: ForIR,
	scope: ReadonlySet<string>,
): void => {
	if (loop.kind === 'reconcile') {
		emitListFor(ctx, loop, scope)
		return
	}
	const bodyText = [
		...loop.hoisted.map(h => h.initText),
		...loop.output.attrs.map(a =>
			'thunkText' in a ? a.thunkText : 'exprText' in a ? a.exprText : '',
		),
		...loop.output.children.map(c => ('exprText' in c ? c.exprText : '')),
	].join(' ')
	const usesIndex =
		loop.indexName !== null &&
		new RegExp(`\\b${loop.indexName}\\b`).test(bodyText)
	ctx.used.add(usesIndex ? 'entries' : 'items')
	const loopScope = new Set(scope)
	loopScope.add(loop.itemName)
	if (loop.indexName) loopScope.add(loop.indexName)
	for (const hoisted of loop.hoisted) loopScope.add(hoisted.name)
	const binding = usesIndex
		? `const [${loop.indexName}, ${loop.itemName}] of ${ctx.h('entries')}(${loop.iterableText})`
		: `const ${loop.itemName} of ${ctx.h('items')}(${loop.iterableText})`
	const emptyFlag = openEmptyFlag(ctx, loop)
	ctx.out.open(`for (${binding}) {`)
	if (emptyFlag) ctx.out.line(`${emptyFlag} = false`)
	for (const hoisted of loop.hoisted)
		ctx.out.line(`const ${hoisted.name} = ${hoisted.initText}`)
	// A name this loop binds shadows an enclosing list item: a value here.
	const shadowed = [
		loop.itemName,
		loop.indexName,
		...loop.hoisted.map(h => h.name),
	].filter(
		(name): name is string => name !== null && ctx.listItems.delete(name),
	)
	emitElement(ctx, loop.output, loopScope)
	for (const child of loop.output.children) emit(ctx, child, loopScope)
	for (const name of shadowed) ctx.listItems.add(name)
	pushClose(ctx, loop.output.tag)
	ctx.out.close()
	if (emptyFlag && loop.emptyArm) {
		ctx.out.open(`if (${emptyFlag}) {`)
		for (const node of loop.emptyArm) emit(ctx, node, scope, true)
		ctx.out.close()
	}
}

const emitElement = (
	ctx: EmitContext,
	element: ElementNode,
	scope: ReadonlySet<string>,
	extraAttrs: AttributeIR[] = [],
): void => {
	const html = new HtmlWriter().static(`<${element.tag}`)
	const attrCall = (name: string, value: string): string =>
		`${ctx.h('attr')}(${jsString(name)}, ${value})`
	let staticClass: string | null = null
	let classExpr: string | null = null
	for (const attr of [...extraAttrs, ...element.attrs]) {
		switch (attr.kind) {
			case 'static':
				if (attr.name === 'class') staticClass = attr.value ?? ''
				else html.attr(attr.name, attr.value)
				break
			case 'server':
				if (
					ctx.templateUnbound.size > 0 &&
					element.attrs.includes(attr) &&
					[...freeIdentifiers(attr.node)].some(n => ctx.templateUnbound.has(n))
				)
					break
				ctx.used.add('attr')
				html.expr(attrCall(attr.name, attr.exprText))
				break
			case 'reactive': {
				if (ctx.inArmTemplate) break
				const mirror = hostPropMirrorExpr(ctx.component, attr.thunk)
				const derived =
					mirror === null
						? hostDerivedExpr(ctx, attr.thunk, attr.thunkText, ctx.foldScope)
						: null
				if (mirror !== null) {
					ctx.used.add('attr')
					html.expr(attrCall(attr.name, mirror))
				} else if (derived !== null) {
					ctx.used.add('attr')
					html.expr(attrCall(attr.name, derived))
				} else if (isServerEvaluable(attr.thunk, scope)) {
					ctx.used.add('attr')
					html.expr(attrCall(attr.name, `(${attr.thunkText})()`))
				}
				break
			}
			case 'class-map':
				if (!ctx.inArmTemplate && isServerEvaluable(attr.object, scope)) {
					ctx.used.add('cls')
					classExpr = `${ctx.h('cls')}((${attr.thunkText})())`
				}
				break
			case 'style-map':
				if (!ctx.inArmTemplate && isServerEvaluable(attr.object, scope)) {
					ctx.used.add('attr')
					ctx.used.add('styleAttr')
					html.expr(
						attrCall(
							'style',
							`${ctx.h('styleAttr')}((${attr.thunkText})()) || null`,
						),
					)
				}
				break
			case 'event':
			case 'ref':
			case 'handler-arg':
				break
		}
	}
	if (ctx.childrenOwner && ctx.childrenInsertions.holders.has(element)) {
		ctx.used.add('attr')
		html.expr(attrCall(CHILDREN_MARKER, ctx.childrenOwner))
	}
	if (classExpr || staticClass !== null) {
		html.static(' class="')
		if (staticClass) html.text(staticClass)
		if (classExpr) {
			if (staticClass) html.static(' ')
			html.expr(classExpr)
		}
		html.static('"')
	}
	push(ctx, `${html.static('>')}`)
}

/** Compose-site attributes that land on the child's root, not in its args. */
const isComposeHostAttr = (name: string): boolean =>
	name === 'class' || name === 'id' || name.startsWith('data-')

const emitCompose = (
	ctx: EmitContext,
	node: ComposeNode,
	scope: ReadonlySet<string>,
	opts: {
		extraHostAttrs?: Array<AttributeIR & { kind: 'static' }>
	} = {},
): void => {
	const entry = ctx.composeRegistry?.get(node.source)
	if (!entry) return
	ctx.composeImports.set(entry.name, `./${entry.tag}.server`)
	const args = node.attrs
		.filter(
			(a): a is Extract<typeof a, { kind: 'arg' }> =>
				a.kind === 'arg' && !isComposeHostAttr(a.name),
		)
		.map(a => `${jsString(a.name, 'double')}: ${a.exprText}`)
	if (node.children.length > 0) {
		const childrenVar = ctx.mint(`__children${++ctx.childrenCounter}`)
		ctx.out.line(`const ${childrenVar}: string[] = []`)
		const outerBuffer = ctx.buffer
		ctx.buffer = childrenVar
		for (const child of node.children) emit(ctx, child, scope)
		ctx.buffer = outerBuffer
		args.push(`children: ${childrenVar}.join('')`)
	}
	if (entry.declaresI18n) {
		ctx.usedI18nRecord = true
		const langAttr = node.attrs.find(
			(a): a is Extract<(typeof node.attrs)[number], { kind: 'arg' }> =>
				a.kind === 'arg' && a.name === 'lang',
		)
		const parentLang =
			ctx.component.declaresI18n && ctx.component.langBinding !== null
				? ctx.component.langBinding
				: null
		const langExpr =
			langAttr !== undefined
				? langAttr.exprText
				: parentLang !== null
					? parentLang
					: entry.langArgDefault !== null
						? jsString(entry.langArgDefault, 'double')
						: null
		const tag = jsString(entry.tag, 'double')
		args.push(
			langExpr !== null
				? `i18n: ${ctx.h('i18nRecord')}(${tag}, ${langExpr})`
				: `i18n: ${ctx.h('i18nRecord')}(${tag})`,
		)
	}
	const hostAttrs = node.attrs.filter(
		(a): a is Extract<typeof a, { kind: 'arg' }> =>
			a.kind === 'arg' && isComposeHostAttr(a.name),
	)
	const extra = opts.extraHostAttrs ?? []
	const owner =
		entry.childrenRegion && node.children.length > 0
			? ctx.childrenOwner && ctx.childrenInsertions.forwards.has(node)
				? ctx.childrenOwner
				: jsString(ctx.component.tag, 'double')
			: null
	const renderCall = `render${entry.name}({ ${args.join(', ')} }${owner ? `, ${owner}` : ''})`
	if (hostAttrs.length > 0 || extra.length > 0) {
		ctx.used.add('composeHostAttrs')
		const attrsArg = [
			...hostAttrs.map(a => [a.name, a.exprText] as const),
			// Arm-set keys are compiler-synthesized statics (`data-key="ok"`).
			...extra.map(a => [a.name, jsString(a.value ?? '', 'double')] as const),
		]
			.map(([name, expr]) => `${jsString(name, 'double')}: ${expr}`)
			.join(', ')
		push(
			ctx,
			`${ctx.h('composeHostAttrs')}(${renderCall}, ${jsString(entry.tag, 'double')}, { ${attrsArg} })`,
		)
	} else {
		push(ctx, renderCall)
	}
}

const stampArmTemplate = (
	ctx: EmitContext,
	armSet: string,
	key: string,
	renderRoot: () => void,
): void => {
	push(
		ctx,
		`${new HtmlWriter()
			.static('<template')
			.attr('data-arms', armSet)
			.attr('data-key', key)
			.static('>')}`,
	)
	const wasInTemplate = ctx.inArmTemplate
	ctx.inArmTemplate = true
	renderRoot()
	ctx.inArmTemplate = wasInTemplate
	push(ctx, "'</template>'")
}

const emitAsyncBoundary = (
	ctx: EmitContext,
	node: TryNode,
	scope: ReadonlySet<string>,
): void => {
	const pendingChildren = node.pendingChildren
	if (pendingChildren === null) return
	const asyncId = ++ctx.armCounter
	const stateVar = ctx.mint(`__async${asyncId}`)
	const errVar = ctx.mint(`__async${asyncId}Err`)
	const rootOf = (children: TemplateNode[]): BoundaryArmRoot =>
		children.find(isBoundaryArmRoot) as BoundaryArmRoot
	const okRoot = rootOf(node.children)
	const pendingRoot = rootOf(pendingChildren)
	const errRoot = rootOf(node.catchChildren)
	const signalChild = okRoot.children.find(
		(c): c is TemplateNode & { kind: 'expr' } =>
			c.kind === 'expr' &&
			c.reactivity === 'reactive' &&
			c.expr.type === 'Identifier',
	)
	// The driver's name, child channel or the `truc:html` thunk channel
	// — the analysis admitted exactly one, so mirror its choice.
	const signalName = signalChild
		? String((signalChild.expr as AstNode).name)
		: (htmlThunkSignalName(okRoot) ?? '')
	const errScope = new Set(scope)
	if (node.catchParam) errScope.add(node.catchParam)
	const emitArmRoot = (
		root: BoundaryArmRoot,
		armScope: ReadonlySet<string>,
		value: string | null,
		extraAttrs: Array<AttributeIR & { kind: 'static' }> = [],
	): void => {
		if (root.kind === 'compose') {
			emitCompose(ctx, root, armScope, { extraHostAttrs: extraAttrs })
			return
		}
		emitElement(ctx, root, armScope, extraAttrs)
		for (const child of root.children) {
			if (child.kind === 'expr' && child.reactivity === 'reactive') {
				if (value === null) continue
				pushText(ctx, ctx.out, 'text', value, child)
				continue
			}
			emit(ctx, child, armScope)
		}
		pushClose(ctx, root.tag)
	}
	// The inert arm templates, one per arm.
	const templates = (): void => {
		const armSet = String(armSetOf(ctx.component.root, node))
		for (const [key, root, armScope] of [
			['ok', okRoot, scope],
			['nil', pendingRoot, scope],
			['err', errRoot, errScope],
		] as const) {
			stampArmTemplate(ctx, armSet, key, () =>
				emitArmRoot(root, armScope, null),
			)
		}
	}
	if (ctx.inArmTemplate) {
		templates()
		return
	}
	ctx.used.add('isPending')
	ctx.out
		.line(`let ${stateVar}: 'pending' | 'ok' | 'err' = 'pending'`)
		.line(`let ${errVar}: unknown = undefined`)
		.open(`if (!${ctx.h('isPending')}(${signalName})) {`)
		.open('try {')
		.line(`${signalName}.get()`)
		.line(`${stateVar} = 'ok'`)
		.between('} catch (e) {')
		.line(`${errVar} = e`)
		.line(`${stateVar} = 'err'`)
		.close()
		.close()
	const keyed = (key: string): Array<AttributeIR & { kind: 'static' }> => [
		{ kind: 'static', name: 'data-key', value: key },
	]
	const errChild =
		errRoot.children.find(
			(c): c is TemplateNode & { kind: 'expr' } =>
				c.kind === 'expr' && c.reactivity === 'reactive',
		) ??
		lazyCatchMessageEl(errRoot, node.catchParam)?.children.find(
			(c): c is TemplateNode & { kind: 'expr' } =>
				c.kind === 'expr' && c.reactivity === 'reactive',
		)
	ctx.out.open(`if (${stateVar} === 'ok') {`)
	emitArmRoot(okRoot, scope, `${signalName}.get()`, keyed('ok'))
	ctx.out.between(`} else if (${stateVar} === 'err') {`)
	if (node.catchParam)
		ctx.out.line(`const ${node.catchParam} = ${errVar} as Error`)
	emitArmRoot(
		errRoot,
		errScope,
		errChild ? errChild.exprText : null,
		keyed('err'),
	)
	ctx.out.between('} else {')
	emitArmRoot(pendingRoot, scope, null, keyed('nil'))
	ctx.out.close()
	templates()
}

const emitJsConditional = (
	out: CodeBuilder,
	testText: string,
	node: ConditionalNode,
	renderArm: (arm: ArmTemplate | undefined) => void,
): void => {
	if (isIf(node)) {
		out.open(`if (${testText}) {`)
		renderArm(node.arms[0])
		if (elseOf(node).length > 0) {
			out.between('} else {')
			renderArm(node.arms[1])
		}
		out.close()
		return
	}
	out.open(`switch (${testText}) {`)
	for (const arm of node.arms) {
		out.open(`${arm.testText === null ? 'default' : `case ${arm.testText}`}: {`)
		renderArm(arm)
		out.line('break').close()
	}
	out.close()
}

const serverTestExpr = (
	ctx: EmitContext,
	node: ConditionalNode,
	scope: ReadonlySet<string>,
): string | null => {
	if (!initialFold(ctx.component, node, scope)) return null
	if (isServerEvaluable(node.test, scope)) return node.testText
	const reads = hostDerivedFold(
		node.test,
		foldableHostProps(ctx.component),
		foldableRefGuards(ctx.component),
		new Set([...ctx.foldScope, ...scope]),
	)
	if (reads === null) return null
	return spliceHostDerivedFold(
		node.testText,
		typeof node.test.start === 'number' ? node.test.start : 0,
		reads,
		foldSeedOf(ctx),
	)
}

const emitReactiveConditional = (
	ctx: EmitContext,
	node: ConditionalNode,
	scope: ReadonlySet<string>,
): void => {
	const rootOf = (arm: ArmTemplate): BoundaryArmRoot | undefined =>
		arm.children.find(isBoundaryArmRoot)
	const renderLive = (arm: ArmTemplate | undefined): void => {
		const root = arm && rootOf(arm)
		if (!arm || !root) return
		if (root.kind === 'compose') {
			emitCompose(ctx, root, scope, {
				extraHostAttrs: [{ kind: 'static', name: 'data-key', value: arm.key }],
			})
			return
		}
		emitPlainElement(ctx, root, scope, [
			{ kind: 'static', name: 'data-key', value: arm.key },
		])
	}
	const initial = node.initial
	const test = 'constant' in initial ? null : serverTestExpr(ctx, node, scope)
	if (ctx.inArmTemplate) {
		// no live arm
	} else if ('constant' in initial)
		renderLive(node.arms.find(arm => arm.key === initial.constant))
	else if (test !== null) emitJsConditional(ctx.out, test, node, renderLive)
	const armSet = String(armSetOf(ctx.component.root, node))
	for (const arm of node.arms) {
		const root = rootOf(arm)
		if (!root) continue
		stampArmTemplate(ctx, armSet, arm.key, () => {
			if (root.kind === 'compose') emitCompose(ctx, root, scope)
			else emitPlainElement(ctx, root, scope)
		})
	}
}

const emit = (
	ctx: EmitContext,
	node: TemplateNode,
	scope: ReadonlySet<string>,
	/** Set by the loop emitters, which render their own empty arm. */
	emptyArm = false,
): void => {
	if (!emptyArm && ctx.emptyArmNodes.has(node)) return
	if (node.kind === 'client-stmt') {
		return
	}
	if (node.kind === 'text') {
		push(ctx, jsString(node.value, 'double'))
		return
	}
	if (node.kind === 'expr') {
		if (isChildrenInsertion(node)) {
			push(ctx, 'String(children)')
			return
		}
		if (node.reactivity === 'reactive' && ctx.inArmTemplate) return
		// The bare `{item}` fill of a reactive list reads the item cell.
		const value =
			node.expr.type === 'Identifier' && ctx.listItems.has(node.exprText)
				? { expr: `${node.exprText}.get()`, thunk: false }
				: node.reactivity === 'reactive'
					? lazyValueExpression(ctx, node.exprText, node.expr, scope)
					: { expr: node.exprText, thunk: false }
		// An authored arrow is `textOf`'s argument, anything else `text`'s.
		pushText(ctx, ctx.out, value.thunk ? 'textOf' : 'text', value.expr, node)
		return
	}
	if (node.kind === 'conditional' && node.mode === 'reactive') {
		emitReactiveConditional(ctx, node, scope)
		return
	}
	if (node.kind === 'conditional') {
		emitJsConditional(ctx.out, node.testText, node, arm => {
			for (const child of arm?.children ?? []) emit(ctx, child, scope)
		})
		return
	}
	if (node.kind === 'try' && node.pendingChildren !== null) {
		emitAsyncBoundary(ctx, node, scope)
		return
	}
	if (node.kind === 'try') {
		const armName = ctx.mint(`__arm${++ctx.armCounter}`)
		ctx.out.open('try {').line(`const ${armName}: string[] = []`)
		const outerBuffer = ctx.buffer
		ctx.buffer = armName
		for (const child of node.children) emit(ctx, child, scope)
		ctx.buffer = outerBuffer
		ctx.out.line(`${outerBuffer}.push(${armName}.join(''))`)
		if (node.catchChildren.length > 0) {
			ctx.out.between(
				`} catch${node.catchParam ? ` (${node.catchParam})` : ''} {`,
			)
			const catchName = ctx.mint(`__arm${++ctx.armCounter}`)
			ctx.out.line(`const ${catchName}: string[] = []`)
			ctx.buffer = catchName
			const catchScope = new Set(scope)
			if (node.catchParam) catchScope.add(node.catchParam)
			for (const child of node.catchChildren) emit(ctx, child, catchScope)
			ctx.buffer = outerBuffer
			ctx.out.line(`${outerBuffer}.push(${catchName}.join(''))`)
		}
		ctx.out.close()
		return
	}
	if (node.kind === 'compose') {
		emitCompose(ctx, node, scope)
		return
	}
	const loop = [...ctx.component.fors.values()].find(f => f.output === node)
	if (loop) {
		emitFor(ctx, loop, scope)
		return
	}
	emitPlainElement(ctx, node, scope)
}

const emitPlainElement = (
	ctx: EmitContext,
	node: ElementNode,
	scope: ReadonlySet<string>,
	extraAttrs: AttributeIR[] = [],
): void => {
	emitElement(ctx, node, scope, extraAttrs)
	const htmlAttr = node.attrs.find(a => a.kind === 'html') as
		| Extract<AttributeIR, { kind: 'html' }>
		| undefined
	if (htmlAttr && isServerEvaluable(htmlAttr.node, scope)) {
		ctx.used.add('sanitizeHtml')
		push(ctx, `${ctx.h('sanitizeHtml')}(String(${htmlAttr.exprText}))`)
	}
	for (const child of node.children) emit(ctx, child, scope)
	pushClose(ctx, node.tag)
}

/* === Exported Functions === */

/**
 * Emit the server render module for a component IR.
 *
 * @param component - Component IR from compileSource
 * @param options.runtimeImport - Module specifier of the runtime harness
 * @param options.sourcePath - Source path for the generated header
 */
export const emitServerModule = (
	component: ComponentIR,
	options: {
		runtimeImport: string
		sourcePath: string
		composeRegistry?: ReadonlyMap<string, InternalRegistryEntry> | undefined
		tier?: EvaluationTier | undefined
		clientMessageKeys?: readonly string[] | undefined
	},
): EmittedServerModule => {
	const renderScope = renderScopeNames(component)
	const mint = (name: string): string => {
		let local = name
		while (renderScope.has(local)) local = `_${local}`
		return local
	}
	const htmlBuffer = mint('__html')
	const childrenInsertions = childrenInsertionsOf(component.root)
	const childrenOwner =
		childrenInsertions.holders.size > 0 || childrenInsertions.forwards.size > 0
			? mint('__owner')
			: null
	const ctx: EmitContext = {
		component,
		composeRegistry: options.composeRegistry,
		// The markup statements sit at the render function body's depth.
		out: new CodeBuilder({ depth: 1 }),
		used: new Set<string>(),
		composeImports: new Map<string, string>(),
		buffer: htmlBuffer,
		emptyArmNodes: new Set(
			[...component.fors.values()].flatMap(loop => loop.emptyArm ?? []),
		),
		emptyCounter: 0,
		armCounter: 0,
		childrenCounter: 0,
		childrenOwner,
		childrenInsertions,
		usedI18nRecord: false,
		foldScope: foldableRenderScope(component),
		inArmTemplate: false,
		templateUnbound: new Set(),
		listItems: new Set(),
		listFlags: new Map(),
		witnesses: new Map(),
		h: name => (renderScope.has(name) ? mint(`__${name}`) : name),
		mint,
	}
	const { out, used, composeImports } = ctx
	const { lines } = out

	declareListFlags(ctx)
	declareWitnesses(ctx)
	for (const child of component.root.children)
		emit(ctx, child, component.serverKnown)
	emitListTemplates(ctx)
	checkWitnesses(ctx)

	const rootHtml = new HtmlWriter().static(`<${component.tag}`)
	const attrCall = (name: string, value: string): string =>
		`${ctx.h('attr')}(${jsString(name)}, ${value})`
	for (const attr of component.root.attrs) {
		if (attr.kind === 'static') rootHtml.attr(attr.name, attr.value)
		else if (attr.kind === 'server') {
			used.add('attr')
			rootHtml.expr(attrCall(attr.name, attr.exprText))
		} else if (attr.kind === 'style-map') {
			if (isServerEvaluable(attr.object, component.serverKnown)) {
				used.add('attr')
				used.add('styleAttr')
				rootHtml.expr(
					attrCall(
						'style',
						`${ctx.h('styleAttr')}((${attr.thunkText})()) || null`,
					),
				)
			}
		} else if (attr.kind === 'class-map') {
			if (isServerEvaluable(attr.object, component.serverKnown)) {
				used.add('attr')
				used.add('cls')
				rootHtml.expr(
					attrCall('class', `${ctx.h('cls')}((${attr.thunkText})()) || null`),
				)
			}
		}
	}
	if (
		component.declaresI18n &&
		component.langBinding !== null &&
		!component.root.attrs.some(a => 'name' in a && a.name === 'lang')
	) {
		used.add('attr')
		rootHtml.expr(attrCall('lang', component.langBinding))
	}
	const tBinding = component.messageTBindings?.[0]
	const clientKeys = options.clientMessageKeys ?? []
	if (clientKeys.length > 0 && tBinding) {
		const { source, withArgs } = clientSourceRecord(
			component.i18nMessages,
			clientKeys,
		)
		const keysText = jsData(clientKeys)
		const formats = [
			...carriedKinds([...withArgs].map(key => source[key] as Message)),
		].some(kind => FORMATTING_KINDS.has(kind))
		const rendersLang =
			(component.declaresI18n && component.langBinding !== null) ||
			component.root.attrs.some(a => 'name' in a && a.name === 'lang')
		used.add('attr')
		if (formats && !rendersLang) {
			used.add('clientLocale')
			rootHtml.expr(
				attrCall('lang', `${ctx.h('clientLocale')}(${tBinding}, ${keysText})`),
			)
		}
		used.add('clientMessages')
		rootHtml.expr(
			attrCall(
				'i18n',
				`${ctx.h('clientMessages')}(${tBinding}, ${keysText}, ${jsData(source)})`,
			),
		)
	}
	if (childrenOwner && childrenInsertions.holders.has(component.root)) {
		used.add('attr')
		rootHtml.expr(attrCall(CHILDREN_MARKER, childrenOwner))
	}
	rootHtml.static('>')
	const rootMarkup = `${rootHtml}`
	const harnessSuppressed = (options.tier ?? 'folded') !== 'folded'
	const refNames = declaredRefNames(component.firstRefs)
	const requestContextNames = new Set(
		component.signals
			.filter(signal => signal.family === 'context')
			.map(signal => signal.name),
	)
	const serverUnevaluable = (stmt: SetupStmt): boolean =>
		stmt.name !== null &&
		!requestContextNames.has(stmt.name) &&
		[...freeIdentifiers(stmt.node)].some(
			name => CLIENT_ONLY_PRIMITIVES.has(name) || refNames.has(name),
		)
	const emittedSetup = harnessSuppressed
		? retainReferenced(
				component.setup.filter(stmt => !serverUnevaluable(stmt)),
				[rootMarkup, ...lines],
			)
		: dropUnreferencedUnevaluable(component.setup, serverUnevaluable, [
				rootMarkup,
				...lines,
			])
	const emittedNames = new Set(
		emittedSetup.map(stmt => stmt.name).filter(name => name !== null),
	)
	const foldable = foldableHostProps(component)
	const hostFolded = new Map<SetupStmt, NonNullable<SetupStmt['slices']>>()
	for (const stmt of emittedSetup) {
		const signal = component.signals.find(s => s.name === stmt.name)
		if (signal?.family !== 'declared' || signal.unresolvable) continue
		const reads = initializerHostReads(stmt.node, foldable)
		if (!reads?.length) continue
		const pieces = stmt.slices ?? [{ text: stmt.text, start: stmt.range.start }]
		hostFolded.set(
			stmt,
			pieces.map(piece => ({
				text: spliceHostDerivedFold(
					piece.text,
					piece.start,
					reads.filter(
						r =>
							r.start >= piece.start &&
							r.end <= piece.start + piece.text.length,
					),
					foldSeedOf(ctx),
				),
				start: piece.start,
			})),
		)
	}

	for (const signal of component.signals) {
		if (!emittedNames.has(signal.name)) continue
		if (signal.family === 'context') {
			used.add('createCell')
			continue
		}
		used.add(signal.constructor)
		for (const id of identifiersIn(signal.text))
			if (RUNTIME_HARNESS_EXPORTS.has(id)) used.add(id)
	}
	if (component.expose && !harnessSuppressed) used.add('expose')
	if (!harnessSuppressed)
		for (const ambient of component.expose?.ambients ?? []) used.add(ambient)
	const { expose } = component
	const exposeHarnessNames =
		expose?.argNode && !harnessSuppressed
			? [...freeIdentifiers(expose.argNode)].filter(
					name =>
						RUNTIME_HARNESS_EXPORTS.has(name) &&
						!component.serverKnown.has(name),
				)
			: []
	for (const name of exposeHarnessNames) used.add(name)
	const stubNames =
		expose?.argNode && !harnessSuppressed
			? [...freeIdentifiers(expose.argNode)]
					.filter(
						name =>
							!JS_GLOBALS.has(name) &&
							name !== 'expose' &&
							!RUNTIME_HARNESS_EXPORTS.has(name) &&
							!component.serverKnown.has(name) &&
							!expose.ambients.includes(name) &&
							!component.imports.serverLocalNames.has(name),
					)
					.sort()
			: []
	const setupContextNames = new Set<string>()
	for (const stmt of emittedSetup)
		for (const name of freeIdentifiers(stmt.node))
			if (
				(name === 'host' || name === 'internals') &&
				!component.serverKnown.has(name)
			)
				setupContextNames.add(name)
	const stubNamesAll = [...new Set([...stubNames, ...setupContextNames])].sort()
	if (stubNamesAll.length > 0) used.add('refStub')

	const referencesIsPending = (scan: string): boolean =>
		/\bisPending\b/.test(scan)
	if (
		lines.some(line => referencesIsPending(line)) ||
		emittedSetup.some(stmt => referencesIsPending(stmt.text)) ||
		(component.expose !== null && referencesIsPending(component.expose.text)) ||
		rootHtml.exprs.some(expr => referencesIsPending(expr))
	)
		used.add('isPending')

	const resolvesInHelper = (node: AstNode | null): boolean =>
		node === null ||
		[...freeIdentifiers(node)].every(
			name =>
				JS_GLOBALS.has(name) ||
				RUNTIME_HARNESS_EXPORTS.has(name) ||
				component.imports.serverLocalNames.has(name),
		)
	const argsHelperLines: string[] | null =
		component.declaresI18n &&
		!harnessSuppressed &&
		!component.paramNames.includes('children') &&
		component.paramProps.every(param => {
			if (param.name === 'i18n' || param.name === 'lang') return true
			const parser = component.exposeProps.get(param.name)?.parser
			if (parser && !resolvesInHelper(parser.fallbackNode))
				return param.optional || param.hasDefault
			if (parser || param.isString || param.isNumber) return true
			return param.optional || param.hasDefault
		})
			? (() => {
					const stmts: string[] = []
					for (const param of component.paramProps) {
						if (param.name === 'i18n' || param.name === 'lang') continue
						const optionalish = param.optional || param.hasDefault
						const key = jsString(param.name, 'double')
						const attrKey = jsString(
							param.name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`),
							'double',
						)
						const attrVar = `${param.name}Attr`
						const parser = component.exposeProps.get(param.name)?.parser
						if (parser && !resolvesInHelper(parser.fallbackNode)) {
							stmts.push(`\tif (attrs[${attrKey}] != null) return null`)
						} else if (parser) {
							stmts.push(`\tconst ${attrVar} = attrs[${attrKey}] ?? null`)
							stmts.push(
								`\tif (${attrVar} !== null) args[${key}] = ${parser.parser}(${parser.fallbackText ?? ''})(${attrVar})`,
							)
							if (!optionalish) stmts.push('\telse return null')
							for (const id of [
								parser.parser,
								...identifiersIn(parser.fallbackText ?? ''),
							])
								if (RUNTIME_HARNESS_EXPORTS.has(id)) used.add(id)
						} else if (param.isString) {
							stmts.push(`\tconst ${attrVar} = attrs[${attrKey}] ?? null`)
							stmts.push(`\tif (${attrVar} !== null) args[${key}] = ${attrVar}`)
							if (!optionalish) stmts.push('\telse return null')
						} else if (param.isNumber) {
							stmts.push(
								`\tconst ${attrVar} = attrs[${attrKey}]?.trim() || null`,
							)
							stmts.push(`\tif (${attrVar} !== null) {`)
							stmts.push(
								`\t\tif (!Number.isFinite(Number(${attrVar}))) return null`,
							)
							stmts.push(`\t\targs[${key}] = Number(${attrVar})`)
							stmts.push('\t}')
							if (!optionalish) stmts.push('\telse return null')
						} else {
							// Non-string, non-Parser.
						}
					}
					return [
						'/**',
						" * Maps an authored page occurrence's attributes to this component's",
						' * server args (LT-194). Null when the occurrence cannot be rendered',
						" * from attributes alone. `lang` and `i18n` are the page renderer's.",
						' */',
						'export function argsFromAttrs(attrs: Record<string, string | null>): Record<string, unknown> | null {',
						'\tconst args: Record<string, unknown> = {}',
						...stmts,
						'\treturn args',
						'}',
					]
				})()
			: null

	const body = new CodeBuilder()
		.line('/**')
		.line(' * Generated by the Le Truc TSRX compiler (milestone 1) from')
		.line(` * ${options.sourcePath} — DO NOT EDIT.`)
		.line(' */')
	if (used.size > 0) {
		const imports = [...used]
			.sort()
			.map(name =>
				importSpecifier(
					name,
					(EMITTED_HARNESS_NAMES as readonly string[]).includes(name)
						? ctx.h(name as EmittedHarnessName)
						: name,
				),
			)
		body.line(
			`import { ${imports.join(', ')} } from ${jsString(options.runtimeImport)}`,
		)
	}
	for (const [name, specifier] of [...composeImports].sort())
		body.line(`import { render${name} } from ${jsString(specifier)}`)
	if (component.declaresI18n) body.line(`import type { I18n } from './i18n'`)
	if (ctx.usedI18nRecord)
		body.line(
			`import { ${importSpecifier('i18nRecord', ctx.h('i18nRecord'))} } from './i18n'`,
		)
	if (component.childrenContract)
		body.line(`import type { Children } from '@zeix/le-truc'`)
	// Authored text and declarations are pre-formatted: appended as written.
	body.append([...component.imports.server, ''])
	for (const decl of component.typeDecls) body.append([decl, ''])
	const paramLines = reindent(
		i18nAnnotated(component.paramsText, component.i18nArgs),
		2,
	).split('\n')
	const paramFirst = paramLines[0]?.replace(/^\t\t/, '') ?? ''
	const ownerParam = childrenOwner ? `, ${childrenOwner}?: string` : ''
	if (paramLines.length === 1) {
		body.open(
			`export function render${component.name}(${ownerParam && !paramFirst ? '_args: {} = {}' : paramFirst}${ownerParam}): string {`,
		)
	} else {
		body.line(`export function render${component.name}(${paramFirst}`)
		body.append(paramLines.slice(1)).open(`${ownerParam}): string {`)
	}
	for (const name of stubNamesAll)
		body.line(`const ${name}: any = ${ctx.h('refStub')}`)
	const setup = new CodeBuilder({ depth: 1, reindent: true })
	for (const stmt of emittedSetup) {
		const ctxSignal = component.signals.find(
			(s): s is ContextSignalIR =>
				s.family === 'context' && s.name === stmt.name,
		)
		const folded = hostFolded.get(stmt)
		const stmtText = ctxSignal
			? `const ${ctxSignal.name} = createCell(${ctxSignal.fallbackText})`
			: folded
				? folded.map(slice => slice.text).join('')
				: stmt.text
		setup.line(
			stmtText,
			(!ctxSignal && (folded ?? stmt.slices)) || [
				{ text: stmtText, start: stmt.range.start },
			],
		)
	}
	body
		.append(setup)
		.line(`const ${htmlBuffer}: string[] = []`)
		.line(`${htmlBuffer}.push(${rootMarkup})`)
		.append(out)
		.line(`${htmlBuffer}.push(${jsString(`</${component.tag}>`)})`)
		.line(`return ${htmlBuffer}.join('')`)
		.close()
	if (argsHelperLines !== null) body.append(['', ...argsHelperLines])

	return {
		code: `${body}\n`,
		runtimeImports: used,
		spans: body.spans,
	}
}
