import type {
	ArmPlan,
	ArmsPlan,
	AuthoredParser,
	ClientPlan,
	ForClientPlan,
	KeyAttrPlan,
	ListFieldPlan,
	ParserKind,
	ReconcilePlan,
	TopEffectPlan,
} from './analysis/plan'
import { freeIdentifiers, sanitizeVarName } from './ast-utils'
import {
	CodeBuilder,
	dataArmsSelector,
	isJsIdentifier,
	jsData,
	jsString,
} from './codegen'
import { carriedKinds, FORMATTING_KINDS, type Message } from './icu/evaluate'
import { clientSourceRecord } from './icu/parse'
import { computeClientNeededNames } from './imports'
import type { ComponentIR, InitSignalIR, ItemSetupStmt } from './ir'
import type { SourceSlice, SourceSpan } from './spans'
import {
	DIRTY_FLAG_ATTRS,
	type DirtyFlagControlTag,
	FACTORY_CONTEXT_MEMBERS,
} from './vocabulary'
import { loopBindingNames } from './walk'

/* === Types === */

export type EmittedClientModule = {
	/** Full TypeScript source of the generated module. */
	code: string
	/** `@zeix/le-truc` imports the module needs (sorted for emission). */
	imports: Set<string>
	spans: SourceSpan[]
}

/* === Internal Functions === */

const DIRTY_FLAG_CONTROL_INTERFACES: ReadonlyMap<string, string> = new Map(
	Object.entries({
		input: 'HTMLInputElement',
		select: 'HTMLSelectElement',
		textarea: 'HTMLTextAreaElement',
		option: 'HTMLOptionElement',
	} satisfies Record<DirtyFlagControlTag, string>),
)

class ClientImports extends Set<string> {
	#scope: ReadonlySet<string> = new Set()
	/** Record the factory-scope names; call once, before any `use()`. */
	bindScope(scope: ReadonlySet<string>): void {
		this.#scope = scope
	}
	/** The local name for `name`: itself, or `__name` on a collision. */
	local(name: string): string {
		return this.#scope.has(name) ? `__${name}` : name
	}
	/** Add `name` and return its local name, for a synthesized call site. */
	use(name: string): string {
		this.add(name)
		return this.local(name)
	}
}

/** `name`, or `name as local` / `name: local` when aliased. */
const aliased = (name: string, local: string, separator: string): string =>
	local === name ? name : `${name}${separator}${local}`

/** `aria-selected` → `ariaSelected` (ARIA reflection property name). */
const ariaProperty = (attr: string): string | null =>
	attr.startsWith('aria-') ? sanitizeVarName(attr) : null

const memberAccess = (object: string, key: string): string =>
	isJsIdentifier(key) ? `${object}.${key}` : `${object}[${jsString(key)}]`

const parserExpression = (
	parser: ParserKind | AuthoredParser,
	imports: ClientImports,
): { call: string; slice: SourceSlice | null } => {
	if (typeof parser !== 'string') {
		const call = parser.wrap ? `(${parser.text})` : parser.text
		return { call, slice: { text: call, start: parser.start } }
	}
	return { call: `${imports.use(parser)}()`, slice: null }
}

const harvestInitializer = (
	plan: ClientPlan['harvests'][number],
	imports: ClientImports,
): { text: string; slices: SourceSlice[] } | null => {
	if (plan.kind === 'substitute') {
		if (!plan.parser) return { text: plan.expr, slices: [] }
		const { call, slice } = parserExpression(plan.parser, imports)
		return {
			text: `${call}(${plan.expr})`,
			slices: slice ? [slice] : [],
		}
	}
	if (plan.kind === 'text') {
		const { call, slice } = parserExpression(plan.parser, imports)
		const read = `${plan.query}.textContent`
		return {
			text: `${call}(${read})`,
			slices: slice ? [slice] : [],
		}
	}
	if (plan.kind === 'attr') {
		const { call, slice } = parserExpression(plan.parser, imports)
		if (DIRTY_FLAG_ATTRS.has(plan.attr)) {
			const live = `${plan.query}.${plan.attr}`
			return {
				text: `${call}(String(${live}))`,
				slices: slice ? [slice] : [],
			}
		}
		const raw = `${plan.query}.getAttribute(${jsString(plan.attr)})`
		return {
			text: `${call}(${raw})`,
			slices: slice ? [slice] : [],
		}
	}
	if (plan.kind === 'list') return null
	const markProp = ariaProperty(plan.markAttr)
	const predicate = markProp
		? `el => el.${markProp} === 'true'`
		: `el => el.getAttribute(${jsString(plan.markAttr)}) === 'true'`
	const read = `${plan.collection}.get().find(${predicate})?.getAttribute(${jsString(plan.valueAttr)})`
	if (plan.parser) {
		const { call, slice } = parserExpression(plan.parser, imports)
		return {
			text: `${call}(${read})`,
			slices: slice ? [slice] : [],
		}
	}
	return {
		text: `${read} ?? ${plan.default}`,
		slices: [],
	}
}

const listDeclaration = (
	signal: InitSignalIR,
	seed: { container: string; valueSelector: string },
): string | null => {
	const harvested =
		`[...${seed.container}.children].filter(el => el.hasAttribute('data-key')).map(el => ` +
		`el.querySelector(${jsString(seed.valueSelector)})?.textContent ?? '')`
	return spliceInit(signal, harvested)
}

/** One field's raw-value read in an adopted item `el`. */
const fieldRead = (site: ListFieldPlan['site']): string => {
	if (site.kind === 'key') return "el.getAttribute('data-key')"
	const query = (typed: boolean): string => {
		if (site.selector === null) return 'el'
		const selector = jsString(site.selector)
		return typed
			? `el.querySelector<ElementFromSelector<${selector}>>(${selector})?`
			: `el.querySelector(${selector})?`
	}
	if (site.kind === 'text') return `${query(false)}.textContent`
	if (!site.property)
		return `${query(false)}.getAttribute(${jsString(site.attr)})`
	const element =
		site.selector === null
			? `(el as ElementFromSelector<${jsString(site.tag)}>)`
			: query(true)
	return site.attr === 'value'
		? `${element}.value`
		: `${element}.${site.attr}.toString()`
}

const fieldListDeclaration = (
	source: string,
	signal: InitSignalIR,
	seed: {
		container: string
		fields: readonly ListFieldPlan[]
		through?: ReadonlyArray<string | null>
	},
	imports: ClientImports,
): { text: string; slices: SourceSlice[] } | null => {
	if (signal.family !== 'declared') return null
	const cut = signal.harvest?.call ?? signal.init
	if (!cut || typeof cut.start !== 'number' || typeof cut.end !== 'number')
		return null
	const itemType =
		signal.listItem?.shape.kind === 'fields' ||
		signal.listItem?.shape.kind === 'opaque'
			? signal.listItem.typeText
			: null
	const before = signal.text.slice(0, cut.start - signal.textStart)
	const after = signal.text.slice(cut.end - signal.textStart)
	const lineStart = source.lastIndexOf('\n', cut.start - 1) + 1
	const indent = /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? ''
	const children = `[...${seed.container}.children]`
	const slices: SourceSlice[] = [
		{ text: before, start: signal.textStart },
		{ text: children, start: cut.start },
		{ text: '({', start: cut.start },
	]
	const adopted = ".filter(el => el.hasAttribute('data-key'))"
	const roots = (seed.through ?? [])
		.map(
			selector =>
				`.flatMap(el => [...${selector === null ? 'el.children' : `(el.querySelector(${jsString(selector)})?.children ?? [])`}])${adopted}`,
		)
		.join('')
	const lines = [
		`${children}${adopted}${roots}.map((el)${itemType ? `: ${itemType}` : ''} => ({`,
	]
	for (const { field, site, parser } of seed.fields) {
		const read = fieldRead(site)
		if (parser.kind === 'authored') {
			const call = parser.wrap ? `(${parser.text})` : parser.text
			lines.push(`${indent}\t${field}: ${call}(${read}),`)
			slices.push(
				{ text: `${field}: `, start: parser.keyStart },
				{ text: parser.text, start: parser.start },
			)
		} else {
			const call = `${imports.use(parser.name)}()(${read})`
			lines.push(
				`${indent}\t${field}: ${parser.cast ? `${call} as ${parser.cast}` : call},`,
			)
			slices.push({ text: `${field}: `, start: cut.start })
		}
	}
	lines.push(`${indent}}))`)
	slices.push({ text: after, start: cut.end })
	return {
		text: `${before}${lines.join('\n')}${after}`,
		slices,
	}
}

/** The declaring call with its first argument replaced by `init`. */
const spliceInit = (signal: InitSignalIR, init: string): string | null => {
	const node = signal.init
	if (!node || typeof node.start !== 'number' || typeof node.end !== 'number')
		return null
	return (
		signal.text.slice(0, node.start - signal.textStart) +
		init +
		signal.text.slice(node.end - signal.textStart)
	)
}

const restArguments = (signal: InitSignalIR): SourceSlice | null => {
	const seed =
		signal.family === 'declared' && signal.harvest
			? signal.harvest.call
			: signal.init
	if (!seed || typeof seed.end !== 'number') return null
	const text = signal.text.slice(seed.end - signal.textStart)
	// No further argument — only a trailing comma before the paren.
	if (/^\s*,?\s*\)$/.test(text)) return null
	return { text, start: seed.end }
}

const typeArguments = (signal: InitSignalIR): string =>
	/^[\w$.]+\s*(<[\s\S]*?>)\s*\(/.exec(signal.text)?.[1] ?? ''

const sliceOf = (text: string, start: number | undefined): SourceSlice[] =>
	start === undefined ? [] : [{ text, start }]

const textSinkSlices = (
	anchor: string,
	value: string,
	exprText: string,
	start: number | undefined,
): SourceSlice[] => {
	if (start === undefined) return []
	const slices: SourceSlice[] = [{ text: anchor, start }]
	if (value === exprText) slices.push({ text: value, start })
	else if (value === `() => ${exprText}`)
		slices.push({ text: '() => ', start }, { text: exprText, start })
	else slices.push({ text: value, start })
	return slices
}

/** Emit one server-data loop; true when it typed a query `ElementFromSelector`. */
const emitEachBlock = (
	plan: ForClientPlan,
	imports: ClientImports,
	out: CodeBuilder,
): boolean => {
	if (plan.scoped) {
		const selector = jsString(plan.scoped.selector)
		out.open(
			`for (const ${plan.itemParam} of ${plan.scoped.root}.querySelectorAll<ElementFromSelector<${selector}>>(${selector})) {`,
		)
	} else {
		imports.add('each')
		out.open(
			`${imports.use('each')}(${plan.collection}, ${plan.itemParam} => {`,
		)
	}
	for (const rebinding of plan.rebindings)
		out.line(`const ${rebinding.name} = ${rebinding.expr}`)
	const taken = new Set<string>([
		plan.itemParam,
		...plan.rebindings.map(r => r.name),
	])
	const targetVars = new Map<string, string>()
	for (const effect of plan.effects) {
		if (effect.target === null || targetVars.has(effect.target)) continue
		const tagMatch = effect.target.match(/^[a-z][a-z0-9-]*/)
		const base = sanitizeVarName(tagMatch ? tagMatch[0] : 'el')
		let name = base
		let i = 1
		while (taken.has(name)) name = `${base}${++i}`
		taken.add(name)
		targetVars.set(effect.target, name)
		const tag = tagMatch?.[0] ?? ''
		const typeArg = DIRTY_FLAG_CONTROL_INTERFACES.get(tag)
		out.line(
			`const ${name} = ${plan.itemParam}.querySelector${typeArg ? `<${typeArg}>` : ''}(${jsString(effect.target)})!`,
		)
	}
	const targetOf = (target: string | null): string =>
		target === null
			? plan.itemParam
			: (targetVars.get(target) ?? plan.itemParam)
	for (const effect of plan.effects) {
		if (effect.kind === 'watch-attr') {
			imports.add('watch')
			const source = effect.coerceToString
				? `() => String((${effect.thunkText})())`
				: effect.thunkText
			if (effect.dispatch === 'property') {
				imports.add('bindProperty')
				out.line(
					`${imports.local('watch')}(${source}, ${imports.local('bindProperty')}(${targetOf(effect.target)}, ${jsString(effect.attr)}))`,
					sliceOf(effect.thunkText, effect.sourceStart),
				)
			} else {
				imports.add('bindAttribute')
				out.line(
					`${imports.local('watch')}(${source}, ${imports.local('bindAttribute')}(${targetOf(effect.target)}, ${jsString(effect.attr)}))`,
					sliceOf(effect.thunkText, effect.sourceStart),
				)
			}
		} else if (effect.kind === 'watch-class') {
			imports.add('watch')
			imports.add('bindClass')
			for (const key of effect.keys) {
				out.line(
					`${imports.local('watch')}(() => Boolean(${memberAccess(`((${effect.thunkText})())`, key)}), ${imports.local('bindClass')}(${targetOf(effect.target)}, ${jsString(key)}))`,
					sliceOf(effect.thunkText, effect.sourceStart),
				)
			}
		} else {
			imports.add('on')
			out.line(
				`${imports.local('on')}(${targetOf(effect.target)}, ${jsString(effect.event)}, ${effect.handlerText})`,
				sliceOf(effect.handlerText, effect.sourceStart),
			)
		}
	}
	out.close(plan.scoped ? '}' : '})')
	return plan.scoped !== null
}

const factoryScopeNames = (
	component: ComponentIR,
	plan: ClientPlan,
): Set<string> => {
	const names = new Set<string>()
	for (const stmt of [...component.setup, ...component.clientSetup])
		if (stmt.name) names.add(stmt.name)
	for (const signal of component.signals) names.add(signal.name)
	for (const query of plan.queries) names.add(query.name)
	for (const loop of component.fors.values()) loopBindingNames(loop, names)
	names.delete('host')
	names.delete('internals')
	return names
}

const messagePreambleLines = (
	component: ComponentIR,
	keys: readonly string[],
): string[] => {
	const tName = component.messageTBindings?.[0]
	if (!tName || keys.length === 0) return []
	const { source, withArgs } = clientSourceRecord(component.i18nMessages, keys)
	const kinds = carriedKinds([...withArgs].map(key => source[key] as Message))
	const lines = [
		'// Client messages (ADR 0009 s9): the source-locale record, merged under',
		'// the server-rendered `i18n` attribute and fixed for the connection.',
		`const __i18nSource: Record<string, unknown> = ${jsData(source)}`,
		'let __i18nMessages = __i18nSource',
		"const __i18nAttribute = host.getAttribute('i18n')",
		'if (__i18nAttribute) {',
		'\ttry {',
		'\t\tconst parsed: unknown = JSON.parse(__i18nAttribute)',
		"\t\tif (parsed && typeof parsed === 'object')",
		'\t\t\t__i18nMessages = { ...__i18nSource, ...(parsed as Record<string, unknown>) }',
		'\t} catch (error) {',
		"\t\tif (process.env.DEV_MODE === 'true')",
		`\t\t\tconsole.warn(${jsString(`<${component.tag}>: the i18n attribute is not valid JSON, so the component shows its source-locale messages. Check the server render that wrote the attribute.`, 'double')}, error)`,
		'\t}',
		'}',
	]
	if (withArgs.size > 0) {
		const usesFormatter = [...kinds].some(k => FORMATTING_KINDS.has(k))
		lines.push(
			'type __I18nNode = string | { t: string; a: string; o?: unknown; s?: number; off?: number; c?: Record<string, __I18nNode[]> }',
		)
		if (usesFormatter)
			lines.push(
				'let __i18nLocale: string | undefined',
				"const __i18nLang = (): string | undefined => (__i18nLocale ??= (host.closest('[lang]') as HTMLElement | null)?.lang ?? '') || undefined",
				'const __i18nFormatters = new WeakMap<object, unknown>()',
				'const __i18nFormatter = <F>(node: object, make: () => F): F => {',
				'\tlet formatter = __i18nFormatters.get(node) as F | undefined',
				'\tif (!formatter) __i18nFormatters.set(node, (formatter = make()))',
				'\treturn formatter',
				'}',
			)
		const cases: string[] = []
		if (kinds.has('arg'))
			cases.push(
				"\t\t\tcase 'arg':",
				'\t\t\t\tout += String(value)',
				'\t\t\t\tbreak',
			)
		if (kinds.has('num'))
			cases.push(
				"\t\t\tcase 'num':",
				'\t\t\t\tout += __i18nFormatter(node, () => new Intl.NumberFormat(__i18nLang(), node.o as Intl.NumberFormatOptions)).format(Number(value) * (node.s ?? 1))',
				'\t\t\t\tbreak',
			)
		if (kinds.has('date'))
			cases.push(
				"\t\t\tcase 'date':",
				'\t\t\t\tout += __i18nFormatter(node, () => new Intl.DateTimeFormat(__i18nLang(), node.o as Intl.DateTimeFormatOptions)).format(new Date(value as number | Date))',
				'\t\t\t\tbreak',
			)
		if (kinds.has('#'))
			cases.push(
				"\t\t\tcase '#':",
				'\t\t\t\tout += __i18nFormatter(node, () => new Intl.NumberFormat(__i18nLang())).format(Number(value) - (node.off ?? 0))',
				'\t\t\t\tbreak',
			)
		if (kinds.has('plural') || kinds.has('select'))
			cases.push(
				...(kinds.has('plural') && kinds.has('select')
					? ["\t\t\tcase 'plural':", "\t\t\tcase 'select': {"]
					: [`\t\t\tcase '${kinds.has('plural') ? 'plural' : 'select'}': {`]),
				'\t\t\t\tconst c = node.c ?? {}',
				'\t\t\t\tconst own = (key: string) => (Object.hasOwn(c, key) ? c[key] : undefined)',
				...(kinds.has('plural')
					? [
							"\t\t\t\tconst body = node.t === 'plural'",
							'\t\t\t\t\t? (own(`=${Number(value)}`) ??',
							"\t\t\t\t\t\town(__i18nFormatter(node, () => new Intl.PluralRules(__i18nLang(), { type: node.o ? 'ordinal' : 'cardinal' })).select(Number(value) - (node.off ?? 0))) ??",
							'\t\t\t\t\t\tc.other)',
							'\t\t\t\t\t: (own(String(value)) ?? c.other)',
						]
					: ['\t\t\t\tconst body = own(String(value)) ?? c.other']),
				'\t\t\t\tif (body) out += __i18nFormat(body, args)',
				'\t\t\t\tbreak',
				'\t\t\t}',
			)
		// A kind the source does not carry: the accessor falls back .
		cases.push('\t\t\tdefault:', '\t\t\t\tthrow __i18nUncarried')
		lines.push(
			'const __i18nUncarried = Symbol()',
			'const __i18nFormat = (message: __I18nNode[], args: Record<string, unknown>): string => {',
			"\tlet out = ''",
			'\tfor (const node of message) {',
			"\t\tif (typeof node === 'string') {",
			'\t\t\tout += node',
			'\t\t\tcontinue',
			'\t\t}',
			'\t\tconst value = args[node.a]',
			'\t\tswitch (node.t) {',
			...cases,
			'\t\t}',
			'\t}',
			'\treturn out',
			'}',
		)
	}
	lines.push(`const ${tName} = {`)
	for (const key of keys) {
		const quoted = jsString(key, 'double')
		const at = `__i18nMessages[${quoted}]`
		const member = isJsIdentifier(key) ? key : quoted
		if (withArgs.has(key))
			lines.push(
				`\t${member}: (args: Record<string, unknown>): string => {`,
				`\t\tconst message = ${at}`,
				"\t\tif (typeof message === 'string') return message",
				'\t\ttry {',
				'\t\t\treturn __i18nFormat(message as __I18nNode[], args)',
				'\t\t} catch (error) {',
				'\t\t\tif (error !== __i18nUncarried) throw error',
				`\t\t\treturn __i18nFormat(__i18nSource[${quoted}] as __I18nNode[], args)`,
				'\t\t}',
				'\t},',
			)
		else
			lines.push(
				`\t${member}: typeof ${at} === 'string' ? (${at} as string) : ${jsData(source[key])},`,
			)
	}
	lines.push('}')
	return lines
}

/* === Exported Functions === */

export const emitClientModule = (
	component: ComponentIR,
	plan: ClientPlan,
	options: {
		sourcePath: string
		childImports?: ReadonlyMap<string, string> | undefined
	},
): EmittedClientModule => {
	const imports = new ClientImports(['defineComponent'])
	imports.bindScope(factoryScopeNames(component, plan))
	for (const ambient of component.expose?.ambients ?? []) imports.add(ambient)
	// The factory body, at the arrow's body depth.
	const out = new CodeBuilder({ depth: 2, reindent: true })
	const push = (text: string, slices: SourceSlice[] = []): void => {
		out.line(text, slices)
	}

	for (const line of messagePreambleLines(component, plan.clientMessageKeys))
		push(line)

	// Queries
	for (const query of plan.queries) {
		if (query.name === 'host') continue
		if (query.cardinality === 'maybe') {
			imports.add('first')
			push(
				`const ${query.name} = ${imports.local('first')}(${jsString(query.selector)})`,
			)
		} else if (query.cardinality === 'one') {
			imports.add('first')
			push(
				`const ${query.name} = ${imports.local('first')}(${jsString(query.selector)}, ${jsString(query.message)})`,
			)
		} else {
			imports.add('all')
			push(
				`const ${query.name} = ${imports.local('all')}(${jsString(query.selector)}, ${jsString(query.message)})`,
			)
		}
	}

	const clientNeededNames = computeClientNeededNames(component)
	let needsElementType = false
	const ordered: Array<{ start: number; text: string; slices: SourceSlice[] }> =
		[]
	const pushAt = (
		start: number,
		text: string,
		slices: SourceSlice[] = [],
	): void => {
		ordered.push({ start, text, slices })
	}
	for (const stmt of component.plainSetup)
		if (stmt.name && clientNeededNames.has(stmt.name))
			pushAt(stmt.range.start, stmt.text, sliceOf(stmt.text, stmt.range.start))

	// Signals seeded by DOM harvest
	for (const signal of component.signals) {
		if (signal.family === 'context') continue
		const harvest = plan.harvests.find(h => h.signal === signal.name)
		if (!harvest) {
			imports.add(signal.constructor)
			pushAt(
				signal.textStart,
				`const ${signal.name} = ${signal.text}`,
				sliceOf(signal.text, signal.textStart),
			)
			continue
		}
		imports.add(signal.constructor)
		if (harvest.kind === 'list') {
			if (harvest.seed === 'verbatim') {
				pushAt(
					signal.textStart,
					`const ${signal.name} = ${signal.text}`,
					sliceOf(signal.text, signal.textStart),
				)
			} else if ('fields' in harvest.seed) {
				const declared = fieldListDeclaration(
					component.source,
					signal,
					harvest.seed,
					imports,
				)
				if (declared) {
					pushAt(
						signal.textStart,
						`const ${signal.name} = ${declared.text}`,
						declared.slices,
					)
					if (
						harvest.seed.fields.some(
							field => field.site.kind === 'attr' && field.site.property,
						)
					)
						needsElementType = true
				}
			} else {
				const substituted = listDeclaration(signal, harvest.seed)
				if (substituted)
					pushAt(signal.textStart, `const ${signal.name} = ${substituted}`)
			}
			continue
		}
		const initializer = harvestInitializer(harvest, imports)
		const call =
			initializer && signal.constructor === 'deriveList'
				? spliceInit(signal, initializer.text)
				: null
		if (call) pushAt(signal.textStart, `const ${signal.name} = ${call}`)
		else if (initializer) {
			const head = `const ${signal.name} = ${imports.local(signal.constructor)}${typeArguments(signal)}(`
			const rest = restArguments(signal)
			pushAt(
				signal.textStart,
				`${head}${initializer.text}${rest?.text ?? ')'}`,
				[
					{ text: head, start: signal.textStart },
					...initializer.slices,
					...(rest ? [rest] : []),
				],
			)
		}
	}

	for (const signal of component.signals) {
		if (signal.family !== 'context') continue
		pushAt(
			signal.textStart,
			`const ${signal.name} = ${signal.text}`,
			sliceOf(signal.text, signal.textStart),
		)
	}

	// expose verbatim
	if (component.expose) {
		imports.add('expose')
		pushAt(
			component.expose.range.start,
			component.expose.text,
			sliceOf(component.expose.text, component.expose.range.start),
		)
	}

	for (const stmt of component.clientSetup)
		pushAt(stmt.range.start, stmt.text, sliceOf(stmt.text, stmt.range.start))
	for (const entry of ordered.sort((a, b) => a.start - b.start))
		push(entry.text, entry.slices)

	const emitArms = (plan: ArmsPlan): void => {
		imports.add('reconcile')
		if (plan.boundary) {
			emitBoundary(plan, plan.boundary)
			return
		}
		const key = (arm: ArmPlan): string =>
			arm.renders ? jsString(arm.key) : 'null'
		const test = sliceOf(plan.testText, plan.sourceStart)
		let thunk: string
		if (plan.construct === 'if') {
			const [then, otherwise] = plan.arms
			thunk = `() => ((${plan.testText}) ? ${then ? key(then) : 'null'} : ${otherwise ? key(otherwise) : 'null'})`
		} else {
			const cases = plan.arms.map(arm =>
				arm.caseText === null
					? `default: return ${key(arm)}`
					: `case ${arm.caseText}: return ${key(arm)}`,
			)
			const fallback = plan.arms.some(arm => arm.caseText === null)
				? ''
				: ' return null'
			thunk = `() => { switch (${plan.testText}) { ${cases.join('; ')} }${fallback} }`
		}
		const templates = `${plan.container}.querySelectorAll<HTMLTemplateElement>(${jsString(dataArmsSelector(plan.armSet))})`
		const mounted = plan.arms.filter(
			arm => arm.effects.length > 0 || arm.keyAttrs.length > 0,
		)
		if (mounted.length === 0) {
			out.line(
				`${imports.local('reconcile')}(${plan.container}, ${templates}, ${thunk}, () => {})`,
				test,
			)
			return
		}
		const usesFirst = mounted.some(arm => arm.locals.length > 0)
		out.open(
			`${imports.local('reconcile')}(${plan.container}, ${templates}, ${thunk}, (${plan.elementParam}, ${plan.keyParam}${usesFirst ? ', first' : ''}) => {`,
			test,
		)
		mounted.forEach((arm, index) => {
			const condition = `${plan.keyParam} === ${jsString(arm.key)}`
			if (index === 0) out.open(`if (${condition}) {`)
			else out.between(`} else if (${condition}) {`)
			if (arm.root) {
				needsElementType = true
				out.line(
					`const ${arm.root.name} = ${plan.elementParam} as ElementFromSelector<${jsString(arm.root.tag)}>`,
				)
			}
			for (const local of arm.locals)
				out.line(
					local.optional
						? `const ${local.name} = first(${jsString(local.selector)})`
						: `const ${local.name} = first(${jsString(local.selector)}, ${jsString(local.message)})`,
				)
			emitKeyAttrs(arm.keyAttrs)
			for (const inner of arm.effects) emitTopEffect(inner)
		})
		out.close()
		out.close('})')
	}

	const emitKeyAttrs = (keyAttrs: readonly KeyAttrPlan[]): void => {
		for (const keyAttr of keyAttrs)
			out.line(
				`${keyAttr.el}${keyAttr.optional ? '?' : ''}.setAttribute(${jsString(keyAttr.attr)}, ${keyAttr.exprText})`,
				sliceOf(keyAttr.exprText, keyAttr.sourceStart),
			)
	}

	const emitItemSetup = (setup: readonly ItemSetupStmt[]): void => {
		for (const stmt of setup) {
			if (stmt.kind === 'ref') {
				if (stmt.root) {
					needsElementType = true
					out.line(
						`const ${stmt.name} = _element as ElementFromSelector<${jsString(stmt.selector)}>`,
					)
				} else
					out.line(
						stmt.reason === null || !stmt.required
							? `const ${stmt.name} = first(${jsString(stmt.selector)})`
							: `const ${stmt.name} = first(${jsString(stmt.selector)}, ${jsString(stmt.reason)})`,
					)
				continue
			}
			if (stmt.kind === 'signal') imports.add(stmt.constructor)
			push(stmt.text, sliceOf(stmt.text, stmt.range.start))
		}
	}

	const emitReconcile = (plan: ReconcilePlan): void => {
		imports.add('reconcile')
		if (plan.inBranch) out.open(`if (${plan.container}) {`)
		const scope = plan.itemScope
		const keyParam = plan.keyParam ?? '_key'
		const templateQuery = `host.querySelector<HTMLTemplateElement>(${jsString(`:scope > template[data-list="${plan.listIndex}"]`)})!`
		if (
			scope.effects.length === 0 &&
			scope.keyAttrs.length === 0 &&
			scope.setup.length === 0
		) {
			out.line(
				`${imports.local('reconcile')}(${plan.container}, ${templateQuery}, ${plan.signal}, () => {})`,
			)
		} else {
			const usesFirst =
				scope.locals.length > 0 ||
				scope.setup.some(stmt =>
					stmt.kind === 'ref'
						? !stmt.root
						: freeIdentifiers(stmt.node).has('first'),
				)
			out.open(
				`${imports.local('reconcile')}(${plan.container}, ${templateQuery}, ${plan.signal}, (_element, ${plan.itemParam}, ${keyParam}${usesFirst ? ', first' : ''}) => {`,
			)
			if (scope.root) {
				needsElementType = true
				out.line(
					`const ${scope.root.name} = _element as ElementFromSelector<${jsString(scope.root.tag)}>`,
				)
			}
			for (const local of scope.locals)
				out.line(
					local.optional
						? `const ${local.name} = first(${jsString(local.selector)})`
						: `const ${local.name} = first(${jsString(local.selector)}, ${jsString(local.message)})`,
				)
			emitItemSetup(scope.setup)
			emitKeyAttrs(scope.keyAttrs)
			for (const inner of scope.effects) emitTopEffect(inner)
			out.close('})')
		}
		for (const query of plan.emptyQueries) {
			imports.add('bindVisible')
			out.line(
				`${imports.local('watch')}(() => ${plan.signal}.length === 0, ${imports.local('bindVisible')}(${query}))`,
			)
		}
		if (plan.inBranch) out.close()
	}

	const emitBoundary = (
		plan: ArmsPlan,
		boundary: NonNullable<ArmsPlan['boundary']>,
	): void => {
		const watch = imports.use('watch')
		const unset = imports.use('UnsetSignalValueError')
		const templates = `${plan.container}.querySelectorAll<HTMLTemplateElement>(${jsString(dataArmsSelector(plan.armSet))})`
		const usesFirst = plan.arms.some(arm => arm.locals.length > 0)
		out.open(
			`${imports.local('reconcile')}(${plan.container}, ${templates}, () => {`,
		)
		out.open('try {')
		out.line(`${boundary.signal}.get()`)
		out.between('} catch (error) {')
		out.line(`return error instanceof ${unset} ? 'nil' : 'err'`)
		out.close()
		out.line("return 'ok'")
		out.between(
			`}, (${plan.elementParam}, ${plan.keyParam}${usesFirst ? ', first' : ''}) => {`,
		)
		const okArm = plan.arms[0] as ArmPlan
		const nilArm = plan.arms[1] as ArmPlan
		const errArm = plan.arms[2] as ArmPlan
		const okViaHtml = okArm.effects.some(e => e.kind === 'watch-html')
		out.open(`if (${plan.keyParam} === 'ok') {`)
		if (okArm.root) {
			needsElementType = true
			out.line(
				`const ${okArm.root.name} = ${plan.elementParam} as ElementFromSelector<${jsString(okArm.root.tag)}>`,
			)
			for (const inner of okArm.effects) emitTopEffect(inner)
		}
		if (!okViaHtml) {
			const bindText = imports.use('bindText')
			out.line(
				`${watch}(${boundary.signal}, { ok: ${bindText}(${plan.elementParam}), err: () => {} })`,
				textSinkSlices(
					`${watch}(`,
					boundary.signal,
					boundary.signal,
					boundary.okStart,
				),
			)
		}
		if (nilArm.effects.length > 0) {
			out.between(`} else if (${plan.keyParam} === 'nil') {`)
			if (nilArm.root) {
				needsElementType = true
				out.line(
					`const ${nilArm.root.name} = ${plan.elementParam} as ElementFromSelector<${jsString(nilArm.root.tag)}>`,
				)
			}
			for (const inner of nilArm.effects) emitTopEffect(inner)
		}
		if (boundary.errText !== null || errArm.effects.length > 0) {
			out.between(`} else if (${plan.keyParam} === 'err') {`)
			if (errArm.root) {
				needsElementType = true
				out.line(
					`const ${errArm.root.name} = ${plan.elementParam} as ElementFromSelector<${jsString(errArm.root.tag)}>`,
				)
			}
			for (const local of errArm.locals)
				out.line(
					`const ${local.name} = first(${jsString(local.selector)}, ${jsString(local.message)})`,
				)
			for (const inner of errArm.effects) emitTopEffect(inner)
			if (boundary.errText !== null) {
				const bindText = imports.use('bindText')
				// The nested message element writes through its arm-
				// scoped local; the depth-0 channel keeps writing the arm root.
				const target = errArm.locals[0]?.name ?? plan.elementParam
				const sink = `${bindText}(${target})(`
				out.line(
					`${watch}(${boundary.signal}, { ok: () => {}, err: error => ${sink}${boundary.errText}) })`,
					boundary.errStart === undefined
						? []
						: [
								{ text: sink, start: boundary.errStart },
								{ text: boundary.errText, start: boundary.errStart },
							],
				)
			}
		}
		out.close()
		out.close('})')
	}

	// Effects in document order
	const emitTopEffect = (effect: TopEffectPlan): void => {
		const at = push
		if (effect.kind === 'each') {
			if (emitEachBlock(effect.for, imports, out)) needsElementType = true
			return
		}
		if (effect.kind === 'reconcile') {
			emitReconcile(effect.for)
			return
		}
		if (effect.kind === 'watch-text') {
			imports.add('watch')
			imports.add('bindText')
			const watch = imports.local('watch')
			at(
				`${watch}(${effect.source}, ${imports.local('bindText')}(${effect.query}))`,
				textSinkSlices(
					`${watch}(`,
					effect.source,
					effect.exprText,
					effect.sourceStart,
				),
			)
			return
		}
		if (effect.kind === 'watch-attr') {
			imports.add('watch')
			const slices = sliceOf(effect.thunkText, effect.sourceStart)
			if (effect.dispatch === 'property') {
				imports.add('bindProperty')
				const source = effect.coerceToString
					? `() => String((${effect.thunkText})())`
					: effect.thunkText
				at(
					`${imports.local('watch')}(${source}, ${imports.local('bindProperty')}(${effect.query}, ${jsString(effect.attr)}))`,
					slices,
				)
			} else {
				imports.add('bindAttribute')
				const source = effect.coerceToString
					? `() => String((${effect.thunkText})())`
					: effect.thunkText
				at(
					`${imports.local('watch')}(${source}, ${imports.local('bindAttribute')}(${effect.query}, ${jsString(effect.attr)}))`,
					slices,
				)
			}
			return
		}
		if (effect.kind === 'watch-style') {
			imports.add('watch')
			imports.add('bindStyle')
			const slices = sliceOf(effect.thunkText, effect.sourceStart)
			const keys = effect.keys.map(key => jsString(key)).join(', ')
			at(
				`${imports.local('watch')}(${effect.thunkText}, ${imports.local('bindStyle')}(${effect.query}, [${keys}]))`,
				slices,
			)
			return
		}
		if (effect.kind === 'watch-class') {
			imports.add('watch')
			imports.add('bindClass')
			const slices = sliceOf(effect.thunkText, effect.sourceStart)
			const keys = effect.keys.map(key => jsString(key)).join(', ')
			at(
				`${imports.local('watch')}(${effect.thunkText}, ${imports.local('bindClass')}(${effect.query}, [${keys}]))`,
				slices,
			)
			return
		}
		if (effect.kind === 'watch-html') {
			imports.add('watch')
			imports.add('dangerouslyBindInnerHTML')
			imports.add('sanitizeHtml')
			const slices = sliceOf(effect.thunkText, effect.sourceStart)
			at(
				`${imports.local('watch')}(${effect.thunkText}, ${imports.local('dangerouslyBindInnerHTML')}(${effect.query}, { sanitize: ${imports.local('sanitizeHtml')} }))`,
				slices,
			)
			return
		}
		if (effect.kind === 'pass') {
			imports.add('pass')
			const accessors = effect.setThunkText
				? `{ get: ${effect.thunkText}, set: ${effect.setThunkText} }`
				: `{ get: ${effect.thunkText} }`
			at(
				`${imports.local('pass')}(${effect.query}, { ${effect.prop}: ${accessors} })`,
				[
					...sliceOf(effect.thunkText, effect.sourceStart),
					...(effect.setThunkText
						? sliceOf(effect.setThunkText, effect.setSourceStart)
						: []),
				],
			)
			return
		}
		if (effect.kind === 'raw') {
			at(effect.text, sliceOf(effect.text, effect.sourceStart))
			return
		}
		if (effect.kind === 'arms') {
			emitArms(effect.arms)
			return
		}
		if (effect.kind === 'guarded') {
			out.open(`if (${effect.query}) {`)
			for (const inner of effect.effects) emitTopEffect(inner)
			out.close('}')
			return
		}
		imports.add('on')
		at(
			`${imports.local('on')}(${effect.query}, ${jsString(effect.event)}, ${effect.handlerText})`,
			sliceOf(effect.handlerText, effect.sourceStart),
		)
	}
	for (const effect of plan.effects) emitTopEffect(effect)

	const contextMembers = [
		...new Set([
			...[...imports].filter(h => FACTORY_CONTEXT_MEMBERS.has(h)),
			...plan.ambientContext,
		]),
	].sort()
	const context = contextMembers.length
		? `{ ${contextMembers.map(name => aliased(name, imports.local(name), ': ')).join(', ')} }`
		: '{}'
	const typeArg = component.propsTypeName ? `<${component.propsTypeName}>` : ''

	const extensions: string[] = []
	if (component.config?.form === 'value') {
		extensions.push(`${imports.use('formAssociated')}()`)
	} else if (component.config?.form === 'checked') {
		extensions.push(`${imports.use('formAssociatedCheckbox')}()`)
	}
	if (component.config && component.config.observedAttributes.length > 0) {
		extensions.push(
			`${imports.use('observedAttributes')}([${component.config.observedAttributes.map(n => jsString(n)).join(', ')}])`,
		)
	}
	const needsFormType =
		component.config?.form !== null &&
		component.config?.form !== undefined &&
		[component.globalDecl, ...component.typeDecls].some(t =>
			(t ?? '').includes('FormAssociatedElement'),
		)

	const body = new CodeBuilder()
		.line('/**')
		.line(' * Generated by the Le Truc TSRX compiler (milestone 2) from')
		.line(
			` * ${options.sourcePath} — DO NOT EDIT. The server half lives in ${component.tag}.server.ts.`,
		)
		.line(' */')
	if (out.lines.some(line => /\bisPending\b/.test(line)))
		imports.add('isPending')

	const importList = [...imports]
		.filter(name => !FACTORY_CONTEXT_MEMBERS.has(name))
		.filter(
			name =>
				!component.imports.clientLeTrucNames.has(name) ||
				imports.local(name) !== name,
		)
		.sort()
		.map(name => aliased(name, imports.local(name), ' as '))
	if (importList.length > 0)
		body.line(`import { ${importList.join(', ')} } from '@zeix/le-truc'`)
	if (needsFormType)
		body.line("import type { FormAssociatedElement } from '@zeix/le-truc'")
	if (needsElementType)
		body.line("import type { ElementFromSelector } from '@zeix/le-truc'")
	for (const tag of plan.childTags) {
		const specifier = options.childImports?.get(tag)
		if (specifier) body.line(`import ${jsString(specifier)}`)
	}
	// Authored text and declarations are pre-formatted: appended as written.
	body.append([...component.imports.client, ''])
	for (const decl of component.typeDecls) body.append([decl, ''])
	if (component.globalDecl) body.append([component.globalDecl, ''])
	if (component.componentDoc) body.append([component.componentDoc, ''])
	body.open(`export default ${imports.local('defineComponent')}${typeArg}(`)
	body.line(`${jsString(component.tag)},`)
	body.open(`(${context}) => {`)
	body.append(out)
	body.close('},')
	if (extensions.length > 0) body.line(`[${extensions.join(', ')}],`)
	body.close(')')

	return {
		code: `${body}\n`,
		imports,
		spans: body.spans,
	}
}
