import { Features, transform } from 'lightningcss-wasm'
import type { CssBrowser, CssTargets } from './emit-paths'
import type { RenderedShape } from './ir'

/* === Types === */

/** How the sheet is scoped: native `@scope` or the flat-selector lowering. */
export type ScopeMode = 'native' | 'lowered'

/** The authored forms with no meaning under the platform-CSS contract. */
export type ContractFace =
	/** A rule inside `@scope` led by the component's own tag (fix-it: `:where(:scope)`). */
	| 'own-tag-led'
	/** `::slotted()` in a light-DOM component. */
	| 'slotted'
	/** `:host-context()` anywhere (removed from the spec). */
	| 'host-context'
	/** `:host` anywhere — it matches nothing outside a shadow root (fix-it: `:where(:scope)`). */
	| 'host'
	/** `:global` anywhere — an unscoped rule is a top-level rule. */
	| 'global'
	/** A selector descending past a compound one of its block's limits excludes. */
	| 'dead-by-limit'
	/** A top-level rule neither in `@scope` nor led by the component's own tag (warning). */
	| 'unscoped'

/** One authored-form finding over the sheet. */
export type ContractFinding = {
	face: ContractFace
	/** The offending selector, summarized, for the message body. */
	selector: string
	/** For the `dead-by-limit` face: the limit that excludes the subject. */
	limit?: string
	/** 0-based offset within the sheet text, when known. */
	offset?: number | undefined
	/** Where the rule's selector list ends (exclusive), when known. */
	end?: number | undefined
}

/** Why the lowering cannot express an authored `@scope` form. */
export type LoweringFace =
	/** A `@scope` inside a component `@scope`. */
	| 'nested-scope'
	/** A limit that names `:scope` or `&`. */
	| 'scope-in-limit'

/** One `@scope` form the lowered emission cannot express (LTC089). */
export type LoweringFinding = {
	face: LoweringFace
	/** 0-based offset of the `@scope` rule within the sheet text. */
	offset: number | undefined
	/** Where the `@scope` prelude ends (exclusive), when known. */
	end?: number | undefined
}

/* === Deserialized lightningcss shapes (read structurally, never written) === */

type LcComponent = {
	type: string
	name?: string
	kind?: string
	value?: string
	selectors?: unknown
}
type LcSelector = LcComponent[]
type LcRule = {
	type: string
	value?: {
		selectors?: LcSelector[]
		scopeEnd?: LcSelector[] | null
		rules?: LcRule[]
		loc?: { line: number; column: number }
	}
}

/* === The CSS target === */

/** Packed `@scope` support: Chrome/Edge 118, Firefox 128, Safari 17.4. */
const SCOPE_SUPPORT: Record<CssBrowser, number> = {
	chrome: 118 << 16,
	edge: 118 << 16,
	firefox: 128 << 16,
	safari: (17 << 16) | (4 << 8),
}

export const scopeModeOf = (targets: CssTargets): ScopeMode => {
	const named = Object.entries(targets) as [CssBrowser, number][]
	if (named.length === 0) return 'lowered'
	return named.every(([browser, version]) => version >= SCOPE_SUPPORT[browser])
		? 'native'
		: 'lowered'
}

export const describeCssTargets = (targets: CssTargets): string => {
	const named = Object.entries(targets) as [CssBrowser, number][]
	if (named.length === 0) return 'no named browser'
	return named
		.map(([browser, packed]) => {
			const minor = (packed >> 8) & 0xff
			return `${browser} ${packed >> 16}${minor ? `.${minor}` : ''}`
		})
		.join(', ')
}

const flatteningTargets = (
	targets: CssTargets,
): { targets: CssTargets; include: number; exclude: number } => ({
	targets,
	include: Features.Nesting,
	exclude: Features.LightDark,
})

/* === The authored-form checks === */

const RECURSABLE_AT_RULES = new Set([
	'media',
	'supports',
	'container',
	'layer-block',
	'scope',
	'starting-style',
])

/** Every component of a selector, descending into functional pseudo-classes. */
const forEachComponent = (
	selector: LcSelector,
	visit: (component: LcComponent) => void,
): void => {
	for (const component of selector) {
		visit(component)
		const inner = component.selectors
		if (!Array.isArray(inner) || inner.length === 0) continue
		// `:is()`/`:not()`/`:has()` carry a selector LIST, `:host()` one selector.
		if (Array.isArray(inner[0]))
			for (const member of inner as LcSelector[])
				forEachComponent(member, visit)
		else forEachComponent(inner as LcSelector, visit)
	}
}

const isGlobalPseudo = (component: LcComponent): boolean =>
	component.type === 'pseudo-class' &&
	(component.kind === 'custom' || component.kind === 'custom-function') &&
	component.name === 'global'

const COMBINATOR_TEXT: Record<string, string> = {
	descendant: ' ',
	child: ' > ',
	'next-sibling': ' + ',
	'later-sibling': ' ~ ',
}

/** The deserialized selector's authored text is not carried — summarize it. */
const selectorTextOf = (selector: LcSelector): string =>
	selector
		.map(component => {
			if (component.type === 'combinator')
				return COMBINATOR_TEXT[component.value ?? ''] ?? ` ${component.value} `
			if (component.type === 'nesting') return '&'
			if (component.type === 'universal') return '*'
			if (component.type === 'type') return `${component.name ?? ''}`
			if (component.type === 'class') return `.${component.name ?? ''}`
			if (component.type === 'pseudo-element')
				return `::${component.kind ?? component.name ?? ''}`
			if (component.type === 'pseudo-class')
				return component.kind === 'custom' ||
					component.kind === 'custom-function'
					? `:${component.name ?? component.kind}(…)`
					: `:${component.kind ?? ''}`
			return component.name ?? `[${component.type}]`
		})
		.join('')

const withSelectorEnd = <F extends { offset?: number | undefined }>(
	sheetText: string,
	finding: F,
): F & { end?: number | undefined } => {
	if (finding.offset === undefined) return finding
	let offset = finding.offset
	while (/\s/.test(sheetText[offset] ?? '')) offset++
	const brace = sheetText.indexOf('{', offset)
	if (brace < 0) return finding
	let end = brace
	while (end > offset && /\s/.test(sheetText[end - 1] ?? '')) end--
	return { ...finding, offset, end }
}

/** 0-based-line/1-based-column loc → offset within the sheet text. */
const lineStartsOf = (text: string): number[] => {
	const starts = [0]
	for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
	return starts
}

const locToOffset = (
	lineStarts: readonly number[],
	loc: { line: number; column: number },
): number => (lineStarts[loc.line] ?? 0) + Math.max(0, loc.column - 1)

const dedentWithStrips = (text: string): { text: string; strip: number[] } => {
	const lines = text.split('\n')
	const indents = lines
		.filter(line => line.trim().length > 0)
		.map(line => line.match(/^[ \t]*/)?.[0] ?? '')
	const common = indents.length
		? (indents.reduce((min, ind) => (ind.length < min.length ? ind : min)) ??
			'')
		: ''
	const strip = lines.map(line =>
		line.startsWith(common)
			? common.length
			: (line.match(/^[ \t]*/)?.[0].length ?? 0),
	)
	return {
		text: lines.map((line, index) => line.slice(strip[index] ?? 0)).join('\n'),
		strip,
	}
}

/** A parsed loc's offset within the dedented text, per-line shifts applied. */
const shiftedLocToOffset = (
	lineStarts: readonly number[],
	strip: readonly number[],
	loc: { line: number; column: number },
): number =>
	(lineStarts[loc.line] ?? 0) +
	Math.max(0, loc.column - 1 - (strip[loc.line] ?? 0))

/* --- Limits: the dead-rule check (LTC071) --- */

/** A flat selector split at its combinators: compounds and the combinators between. */
type Compounds = { compounds: LcComponent[][]; combinators: string[] }

const compoundsOf = (selector: LcSelector): Compounds => {
	const compounds: LcComponent[][] = [[]]
	const combinators: string[] = []
	for (const component of selector) {
		// `::before` and kin ride in the compound they end.
		if (
			component.type === 'combinator' &&
			component.value !== 'pseudo-element' &&
			component.value !== 'slot-assignment'
		) {
			combinators.push(component.value ?? '')
			compounds.push([])
		} else compounds[compounds.length - 1]?.push(component)
	}
	return { compounds, combinators }
}

const sameCompound = (a: LcComponent[], b: LcComponent[]): boolean =>
	JSON.stringify(a) === JSON.stringify(b)

const resolveAgainst = (
	selector: LcSelector,
	parent: LcSelector | null,
): LcSelector => {
	const root: LcComponent = { type: 'pseudo-class', kind: 'scope' }
	if (!selector.some(component => component.type === 'nesting')) {
		return parent
			? [...parent, { type: 'combinator', value: 'descendant' }, ...selector]
			: selector
	}
	return selector.flatMap(component =>
		component.type === 'nesting' ? (parent ?? [root]) : [component],
	)
}

const deadByLimit = (selector: LcSelector, limit: LcSelector): boolean => {
	const subject = compoundsOf(selector)
	const excluded = compoundsOf(limit)
	const universalTail =
		excluded.compounds.length > 1 &&
		excluded.combinators[excluded.combinators.length - 1] === 'child' &&
		excluded.compounds[excluded.compounds.length - 1]?.length === 1 &&
		excluded.compounds[excluded.compounds.length - 1]?.[0]?.type === 'universal'
	const heads = [excluded]
	if (universalTail)
		heads.push({
			compounds: excluded.compounds.slice(0, -1),
			combinators: excluded.combinators.slice(0, -1),
		})
	for (const head of heads) {
		const length = head.compounds.length
		for (let end = length - 1; end < subject.compounds.length - 1; end++) {
			const next = subject.combinators[end]
			if (next !== 'descendant' && next !== 'child') continue
			const start = end - length + 1
			const matches =
				head.compounds.every((compound, index) =>
					sameCompound(subject.compounds[start + index] ?? [], compound),
				) &&
				head.combinators.every(
					(combinator, index) =>
						subject.combinators[start + index] === combinator,
				)
			if (matches) return true
		}
	}
	return false
}

/** What a scope block hands its rules: its authored limits. */
type ScopeBlock = { limits: LcSelector[] }

const checkRules = (
	rules: readonly LcRule[],
	tag: string,
	scope: ScopeBlock | null,
	styleDepth: number,
	parents: readonly LcSelector[] | null,
	lineStarts: readonly number[],
	findings: ContractFinding[],
): void => {
	for (const rule of rules) {
		if (rule.type === 'style') {
			const value = rule.value
			const selectors = value?.selectors ?? []
			const offset = value?.loc ? locToOffset(lineStarts, value.loc) : undefined
			const seen = new Set<ContractFace>()
			const report = (
				face: ContractFace,
				selector: LcSelector,
				limit?: string,
			): void => {
				if (seen.has(face)) return
				seen.add(face)
				findings.push({
					face,
					selector: selectorTextOf(selector),
					...(limit !== undefined ? { limit } : {}),
					offset,
				})
			}
			const resolved: LcSelector[] = []
			const dead: string[] = []
			let deadLimit: string | undefined
			for (const selector of selectors) {
				const first = selector[0] as LcComponent | undefined
				const tagLed =
					first?.type === 'type' && first.name?.toLowerCase() === tag
				if (scope && styleDepth === 0 && tagLed) report('own-tag-led', selector)
				forEachComponent(selector, component => {
					if (
						component.type === 'pseudo-element' &&
						component.kind === 'slotted'
					)
						report('slotted', selector)
					if (
						component.type === 'pseudo-class' &&
						component.kind === 'custom-function' &&
						component.name === 'host-context'
					)
						report('host-context', selector)
					else if (
						component.type === 'pseudo-class' &&
						component.kind === 'host'
					)
						report('host', selector)
					if (isGlobalPseudo(component)) report('global', selector)
				})
				// A top-level rule outside `@scope` that the unique tag does
				// not contain applies page-wide (LTC088) —
				// unless an error above already names the rule.
				if (!scope && styleDepth === 0 && !tagLed && seen.size === 0)
					report('unscoped', selector)
				if (scope) {
					const alternatives = (parents ?? [null]).map(parent =>
						resolveAgainst(selector, parent),
					)
					resolved.push(...alternatives)
					// Dead only when dead under EVERY parent alternative.
					for (const limit of scope.limits) {
						if (alternatives.every(flat => deadByLimit(flat, limit))) {
							dead.push(selectorTextOf(selector))
							deadLimit ??= selectorTextOf(limit)
							break
						}
					}
				}
			}
			// One finding per rule, naming every dead member of its list.
			if (deadLimit !== undefined)
				findings.push({
					face: 'dead-by-limit',
					selector: dead.join(', '),
					limit: deadLimit,
					offset,
				})
			checkRules(
				value?.rules ?? [],
				tag,
				scope,
				styleDepth + 1,
				scope ? resolved : null,
				lineStarts,
				findings,
			)
			continue
		}
		if (rule.type === 'scope') {
			// The outermost `@scope` is the component's; a nested one keeps
			// the component's block (LTC089 flags it on lowered targets).
			checkRules(
				rule.value?.rules ?? [],
				tag,
				scope ?? { limits: rule.value?.scopeEnd ?? [] },
				styleDepth,
				scope ? parents : null,
				lineStarts,
				findings,
			)
			continue
		}
		if (RECURSABLE_AT_RULES.has(rule.type))
			checkRules(
				rule.value?.rules ?? [],
				tag,
				scope,
				styleDepth,
				parents,
				lineStarts,
				findings,
			)
	}
}

export const checkSheetContract = (
	sheet: unknown,
	sheetText: string,
	tag: string,
): ContractFinding[] => {
	const findings: ContractFinding[] = []
	checkRules(
		(sheet as { rules?: LcRule[] })?.rules ?? [],
		tag.toLowerCase(),
		null,
		0,
		null,
		lineStartsOf(sheetText),
		findings,
	)
	return findings.map(finding => withSelectorEnd(sheetText, finding))
}

/* === Downward leaks into composed children (LTC087) === */

export type LeakChild = {
	tag: string
	host: { attrs: Record<string, string | null>; dynamic: readonly string[] }
	shapes: readonly (RenderedShape & { kind: 'element' })[]
	children: readonly LeakChild[]
}

/** One rule whose subject can match an element a composed child renders. */
export type LeakFinding = {
	/** The leaking selectors of the rule, summarized. */
	selector: string
	/** The composed children of this component the rule reaches into, in template order. */
	children: string[]
	offset?: number | undefined
	end?: number | undefined
}

/** The element shape a compound is tested against: a tag and its attributes. */
type ShapeLike = {
	tag: string
	attrs: Record<string, string | null>
	dynamic: readonly string[]
}

const simpleMatches = (
	component: LcComponent,
	shape: ShapeLike,
	definite: boolean,
): boolean => {
	const tokens = (name: string) => (shape.attrs[name] ?? '').split(/\s+/)
	const dynamic = (name: string) => shape.dynamic.includes(name)
	switch (component.type) {
		case 'universal':
			return true
		case 'type':
			return component.name?.toLowerCase() === shape.tag.toLowerCase()
		case 'class':
			return dynamic('class')
				? !definite
				: tokens('class').includes(component.name ?? '')
		case 'id':
			return dynamic('id') ? !definite : shape.attrs.id === component.name
		case 'attribute': {
			const attribute = component as LcComponent & {
				namespace?: unknown
				operation?: {
					operator?: string
					value?: string
					caseSensitivity?: string
				} | null
			}
			const name = attribute.name ?? ''
			if (attribute.namespace) return !definite
			if (dynamic(name)) return !definite
			const actual = shape.attrs[name]
			if (actual === undefined) return false
			const operation = attribute.operation
			if (!operation) return true
			if (operation.caseSensitivity === 'ascii-case-insensitive')
				return !definite
			if (operation.operator === 'equal')
				return (actual ?? '') === operation.value
			if (operation.operator === 'includes')
				return (actual ?? '').split(/\s+/).includes(operation.value ?? '')
			return !definite
		}
		default:
			// Pseudo-classes and pseudo-elements: undecidable against one shape.
			return !definite
	}
}

const compoundMatches = (
	compound: readonly LcComponent[],
	shape: ShapeLike,
	definite: boolean,
): boolean =>
	compound.every(component => simpleMatches(component, shape, definite))

/** Is the compound the scope root (`:scope`, or `&` at the block's top)? */
const isRootCompound = (compound: readonly LcComponent[]): boolean =>
	compound.some(
		component =>
			component.type === 'nesting' ||
			(component.type === 'pseudo-class' && component.kind === 'scope') ||
			(component.type === 'pseudo-class' &&
				(component.kind === 'where' || component.kind === 'is') &&
				Array.isArray(component.selectors) &&
				(component.selectors as LcSelector[]).every(
					member => member.length === 1 && isRootCompound(member),
				)),
	)

const limitHeads = (
	limit: LcSelector,
): { self: LcComponent[]; below: LcComponent[] | null } => {
	const { compounds, combinators } = compoundsOf(limit)
	const self = compounds[compounds.length - 1] ?? []
	const universalTail =
		compounds.length > 1 &&
		combinators[combinators.length - 1] === 'child' &&
		self.length === 1 &&
		self[0]?.type === 'universal'
	return {
		self,
		below: universalTail ? (compounds[compounds.length - 2] ?? null) : null,
	}
}

/** Does some limit always exclude `element` itself (and so its subtree)? */
const excludesSelf = (
	limits: readonly LcSelector[],
	element: ShapeLike,
): boolean =>
	limits.some(limit => {
		const heads = limitHeads(limit)
		return !heads.below && compoundMatches(heads.self, element, true)
	})

/** Does some limit always exclude everything below `element`? */
const excludesBelow = (
	limits: readonly LcSelector[],
	element: ShapeLike,
): boolean =>
	excludesSelf(limits, element) ||
	limits.some(limit => {
		const heads = limitHeads(limit)
		return heads.below !== null && compoundMatches(heads.below, element, true)
	})

const childLeaks = (
	subject: readonly LcComponent[],
	child: LeakChild,
	limits: readonly LcSelector[],
): boolean => {
	if (excludesBelow(limits, { tag: child.tag, ...child.host })) return false
	const reaches = (element: ShapeLike) =>
		compoundMatches(subject, element, false) && !excludesSelf(limits, element)
	return (
		child.shapes.some(reaches) ||
		child.children.some(
			grandchild =>
				reaches({ tag: grandchild.tag, ...grandchild.host }) ||
				childLeaks(subject, grandchild, limits),
		)
	)
}

const anchoredChain = (
	compounds: readonly LcComponent[][],
	combinators: readonly string[],
): LcComponent[][] | null => {
	let root = -1
	for (let index = compounds.length - 2; index >= 0; index--)
		if (isRootCompound(compounds[index] ?? [])) {
			root = index
			break
		}
	if (root < 0) return null
	if (combinators.slice(root).some(combinator => combinator !== 'child'))
		return null
	return compounds.slice(root + 1, -1)
}

const checkLeakRules = (
	rules: readonly LcRule[],
	children: readonly LeakChild[],
	scope: ScopeBlock | null,
	parents: readonly LcSelector[] | null,
	lineStarts: readonly number[],
	findings: LeakFinding[],
): void => {
	for (const rule of rules) {
		if (rule.type === 'style') {
			const value = rule.value
			const resolved: LcSelector[] = []
			const leaking: string[] = []
			const reached = new Set<string>()
			for (const selector of value?.selectors ?? []) {
				if (!scope) continue
				const alternatives = (parents ?? [null]).map(parent =>
					resolveAgainst(selector, parent),
				)
				resolved.push(...alternatives)
				let leaks = false
				for (const flat of alternatives) {
					const { compounds, combinators } = compoundsOf(flat)
					const subject = compounds[compounds.length - 1] ?? []
					// The host is the parent's own element, never a child's.
					if (isRootCompound(subject)) continue
					const chain = anchoredChain(compounds, combinators)
					for (const child of children)
						if (
							(chain === null ||
								chain.some(compound =>
									compoundMatches(
										compound,
										{ tag: child.tag, ...child.host },
										false,
									),
								)) &&
							childLeaks(subject, child, scope.limits)
						) {
							reached.add(child.tag)
							leaks = true
						}
				}
				if (leaks) leaking.push(selectorTextOf(selector))
			}
			if (leaking.length > 0)
				findings.push({
					selector: leaking.join(', '),
					children: children
						.map(child => child.tag)
						.filter(
							(tag, index, all) =>
								reached.has(tag) && all.indexOf(tag) === index,
						),
					offset: value?.loc ? locToOffset(lineStarts, value.loc) : undefined,
				})
			checkLeakRules(
				value?.rules ?? [],
				children,
				scope,
				scope ? resolved : null,
				lineStarts,
				findings,
			)
			continue
		}
		if (rule.type === 'scope') {
			checkLeakRules(
				rule.value?.rules ?? [],
				children,
				scope ?? { limits: rule.value?.scopeEnd ?? [] },
				scope ? parents : null,
				lineStarts,
				findings,
			)
			continue
		}
		if (RECURSABLE_AT_RULES.has(rule.type))
			checkLeakRules(
				rule.value?.rules ?? [],
				children,
				scope,
				parents,
				lineStarts,
				findings,
			)
	}
}

export const checkSheetLeaks = (
	sheet: unknown,
	sheetText: string,
	children: readonly LeakChild[],
): LeakFinding[] => {
	if (children.length === 0) return []
	const findings: LeakFinding[] = []
	checkLeakRules(
		(sheet as { rules?: LcRule[] })?.rules ?? [],
		children,
		null,
		null,
		lineStartsOf(sheetText),
		findings,
	)
	// The message quotes the rule as authored, not the parse's summary.
	return findings.map(finding => {
		const located = withSelectorEnd(sheetText, finding)
		return located.offset !== undefined && located.end !== undefined
			? {
					...located,
					selector: sheetText
						.slice(located.offset, located.end)
						.replace(/\s+/g, ' '),
				}
			: located
	})
}

/* === Forms the lowering cannot express (LTC089) === */

const hasScopeReference = (selector: LcSelector): boolean => {
	let found = false
	forEachComponent(selector, component => {
		if (
			component.type === 'nesting' ||
			(component.type === 'pseudo-class' && component.kind === 'scope')
		)
			found = true
	})
	return found
}

const checkLoweringRules = (
	rules: readonly LcRule[],
	inScope: boolean,
	lineStarts: readonly number[],
	findings: LoweringFinding[],
): void => {
	for (const rule of rules) {
		if (rule.type === 'scope') {
			const offset = rule.value?.loc
				? locToOffset(lineStarts, rule.value.loc)
				: undefined
			if (inScope) findings.push({ face: 'nested-scope', offset })
			else if ((rule.value?.scopeEnd ?? []).some(hasScopeReference))
				findings.push({ face: 'scope-in-limit', offset })
			checkLoweringRules(rule.value?.rules ?? [], true, lineStarts, findings)
			continue
		}
		if (rule.type === 'style' || RECURSABLE_AT_RULES.has(rule.type))
			checkLoweringRules(rule.value?.rules ?? [], inScope, lineStarts, findings)
	}
}

export const checkSheetLowering = (
	sheet: unknown,
	sheetText: string,
): LoweringFinding[] => {
	const findings: LoweringFinding[] = []
	checkLoweringRules(
		(sheet as { rules?: LcRule[] })?.rules ?? [],
		false,
		lineStartsOf(sheetText),
		findings,
	)
	return findings.map(finding => {
		if (finding.offset === undefined) return finding
		// The range is the `@scope` prelude, up to its block.
		const brace = sheetText.indexOf('{', finding.offset)
		if (brace < 0) return finding
		let end = brace
		while (end > finding.offset && /\s/.test(sheetText[end - 1] ?? '')) end--
		return { ...finding, end }
	})
}

/* === Text scanning (the surgery never parses selectors) === */

/** First index at/after `from` of `ch` outside strings and comments; -1 if none. */
const indexOfUnquoted = (text: string, ch: string, from: number): number => {
	let i = from
	while (i < text.length) {
		const c = text[i]
		if (c === '"' || c === "'") {
			const quote = c
			i++
			while (i < text.length && text[i] !== quote) {
				if (text[i] === '\\') i++
				i++
			}
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2)
			if (end === -1) return -1
			i = end + 1
			continue
		} else if (c === ch) return i
		i++
	}
	return -1
}

/** Index of the `)` matching the `(` at `open`, strings and comments aside. */
const matchingParen = (text: string, open: number): number => {
	let depth = 0
	let i = open
	while (i < text.length) {
		const c = text[i]
		if (c === '"' || c === "'") {
			const quote = c
			i++
			while (i < text.length && text[i] !== quote) {
				if (text[i] === '\\') i++
				i++
			}
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2)
			if (end === -1) return -1
			i = end + 1
			continue
		} else if (c === '(') depth++
		else if (c === ')') {
			depth--
			if (depth === 0) return i
		}
		i++
	}
	return -1
}

/** Offset of the `}` closing the `{` at `openBrace`, -1 when unbalanced. */
const matchingBrace = (text: string, openBrace: number): number => {
	let depth = 0
	let i = openBrace
	while (i < text.length) {
		const c = text[i]
		if (c === '"' || c === "'") {
			const quote = c
			i++
			while (i < text.length && text[i] !== quote) {
				if (text[i] === '\\') i++
				i++
			}
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2)
			if (end === -1) return -1
			i = end + 1
			continue
		} else if (c === '{') depth++
		else if (c === '}') {
			depth--
			if (depth === 0) return i
		}
		i++
	}
	return -1
}

const skipSpaceAndComments = (text: string, from: number): number => {
	let i = from
	for (;;) {
		while (i < text.length && /\s/.test(text[i] as string)) i++
		if (text.startsWith('/*', i)) {
			const end = text.indexOf('*/', i + 2)
			i = end === -1 ? text.length : end + 2
			continue
		}
		return i
	}
}

/** One rule located in a stylesheet text: `[start, end)`, `{` at `brace`. */
type TextRule = { start: number; end: number; brace: number }

const scanRules = (text: string, from: number, to: number): TextRule[] => {
	const out: TextRule[] = []
	let i = skipSpaceAndComments(text, from)
	while (i < to) {
		if (i >= text.length || text[i] === '}') break
		const brace = indexOfUnquoted(text, '{', i)
		const semicolon = indexOfUnquoted(text, ';', i)
		if (
			semicolon !== -1 &&
			semicolon < to &&
			(brace === -1 || semicolon < brace)
		) {
			i = skipSpaceAndComments(text, semicolon + 1)
			continue
		}
		if (brace === -1 || brace >= to) break
		const close = matchingBrace(text, brace)
		if (close === -1 || close >= to) break
		out.push({ start: i, end: close + 1, brace })
		i = skipSpaceAndComments(text, close + 1)
	}
	return out
}

/** The at-rule name of a text rule, or null for a style rule. */
const atRuleName = (text: string, rule: TextRule): string | null => {
	if (text[rule.start] !== '@') return null
	const match = /^@([a-zA-Z-]+)/.exec(text.slice(rule.start, rule.brace))
	return match?.[1] ?? null
}

/** Conditional groups, whose blocks hold rules the emission descends into. */
const CONDITIONAL_AT_RULES = new Set([
	'media',
	'supports',
	'container',
	'layer',
	'starting-style',
])

/** Commas outside parens/brackets/strings — a selector list's separators. */
const splitTopLevelCommas = (selectorText: string): string[] => {
	const parts: string[] = []
	let depth = 0
	let start = 0
	let i = 0
	while (i < selectorText.length) {
		const c = selectorText[i]
		if (c === '"' || c === "'") {
			const quote = c
			i++
			while (i < selectorText.length && selectorText[i] !== quote) {
				if (selectorText[i] === '\\') i++
				i++
			}
		} else if (c === '(' || c === '[') depth++
		else if (c === ')' || c === ']') depth--
		else if (c === ',' && depth === 0) {
			parts.push(selectorText.slice(start, i))
			start = i + 1
		}
		i++
	}
	parts.push(selectorText.slice(start))
	return parts
}

/** Apply `{offset, from, to}` splices in one reverse pass. */
const splice = (
	text: string,
	replacements: Array<{ start: number; end: number; text: string }>,
): string => {
	let out = text
	for (const { start, end, text: replacement } of [...replacements].sort(
		(a, b) => b.start - a.start,
	))
		out = out.slice(0, start) + replacement + out.slice(end)
	return out
}

/* === Relative selectors at the top of a `@scope` block === */

export type RelativeAnchor = '&' | ':where(:scope)'

/** Edits that anchor each relative member of one selector list. */
const anchorList = (
	text: string,
	start: number,
	end: number,
	anchor: RelativeAnchor,
	edits: Array<{ start: number; end: number; text: string }>,
): void => {
	let member = start
	for (const part of splitTopLevelCommas(text.slice(start, end))) {
		const at = skipSpaceAndComments(text, member)
		const c = text[at]
		if (at < member + part.length && (c === '>' || c === '+' || c === '~')) {
			const before = text[at - 1]
			if (anchor === '&' && (before === ' ' || before === '\t'))
				edits.push({ start: at - 1, end: at, text: '&' })
			else
				edits.push({
					start: at,
					end: at,
					text: anchor === '&' ? '&' : `${anchor} `,
				})
		}
		member += part.length + 1
	}
}

const anchorRules = (
	text: string,
	from: number,
	to: number,
	inScope: boolean,
	anchor: RelativeAnchor,
	edits: Array<{ start: number; end: number; text: string }>,
): void => {
	for (const rule of scanRules(text, from, to)) {
		const name = atRuleName(text, rule)
		if (name === null) {
			if (inScope) anchorList(text, rule.start, rule.brace, anchor, edits)
		} else if (name === 'scope' || CONDITIONAL_AT_RULES.has(name))
			anchorRules(
				text,
				rule.brace + 1,
				rule.end - 1,
				inScope || name === 'scope',
				anchor,
				edits,
			)
	}
}

export const anchorRelativeSelectors = (
	text: string,
	anchor: RelativeAnchor,
): string => {
	const edits: Array<{ start: number; end: number; text: string }> = []
	anchorRules(text, 0, text.length, false, anchor, edits)
	return edits.length === 0 ? text : splice(text, edits)
}

/* === The scope block's prelude === */

type ScopeHead = {
	/** The text between `@scope` and `{`, trimmed. */
	text: string
	/** The authored root selector, or null when the block is prelude-less. */
	root: string | null
	/** The authored limits, one per member of `to (…)`. */
	limits: string[]
}

const scopeHeadOf = (head: string): ScopeHead => {
	let rest = head.trim()
	const text = rest
	let root: string | null = null
	if (rest.startsWith('(')) {
		const close = matchingParen(rest, 0)
		if (close !== -1) {
			root = rest.slice(1, close).trim()
			rest = rest.slice(close + 1).trim()
		}
	}
	const limits: string[] = []
	if (/^to\s*\(/.test(rest)) {
		const open = rest.indexOf('(')
		const close = matchingParen(rest, open)
		if (close !== -1)
			for (const member of splitTopLevelCommas(rest.slice(open + 1, close)))
				if (member.trim() !== '') limits.push(member.trim())
	}
	return { text, root, limits }
}

/* === Native emission === */

const nativeRules = (
	text: string,
	from: number,
	to: number,
	tag: string,
): string => {
	let out = ''
	let cursor = from
	for (const rule of scanRules(text, from, to)) {
		out += text.slice(cursor, rule.start)
		cursor = rule.end
		const name = atRuleName(text, rule)
		if (name === 'scope') {
			const head = text.slice(rule.start + '@scope'.length, rule.brace).trim()
			const body = text.slice(rule.brace, rule.end)
			if (head === '' || /^to\s*\(/.test(head))
				out += anchorRelativeSelectors(
					`@scope (${tag})${head === '' ? '' : ` ${head}`} ${body}`,
					':where(:scope)',
				)
			else out += text.slice(rule.start, rule.end)
		} else if (name !== null && CONDITIONAL_AT_RULES.has(name)) {
			out += `${text.slice(rule.start, rule.brace + 1)}${nativeRules(
				text,
				rule.brace + 1,
				rule.end - 1,
				tag,
			)}}`
		} else out += text.slice(rule.start, rule.end)
	}
	return out + text.slice(cursor, to)
}

/* === Lowered emission === */

const SCOPE_PAD = ':not([data-truc-scope-pad])'

/** What lowering one component `@scope` block needs. */
type LoweringScope = {
	/** The root compound: `:where(<root>)` plus the specificity pad. */
	rootCompound: string
	/** The bare root as a leading `:where()`. */
	lead: string
	/** The guards, one per authored limit, ready to splice. */
	guards: string
}

const loweringScopeOf = (head: ScopeHead, tag: string): LoweringScope => {
	const root = head.root ?? tag
	const listed = splitTopLevelCommas(root).length > 1 ? `:is(${root})` : root
	// The re-include: an own-tag instance below the limit, or
	// one the limit itself matches, is a scope root of its own, and so is
	// everything inside it.
	const guard = (limit: string): string =>
		`:where(:not(:is(${listed} ${limit}, ${listed} ${limit} *):not(${listed} ${limit} ${tag}, ${listed} ${limit} ${tag} *, ${listed} ${limit}:is(${tag}), ${listed} ${limit}:is(${tag}) *)))`
	return {
		rootCompound: `:where(${root})${SCOPE_PAD}`,
		lead: `:where(${root})`,
		guards: head.limits.map(guard).join(''),
	}
}

/** The four CSS2.1 pseudo-elements, which also have a single-colon spelling. */
const LEGACY_PSEUDO_ELEMENT =
	/^:(?:before|after|first-line|first-letter)(?![\w-])/

const subjectOf = (selector: string): { subject: number; guard: number } => {
	let depth = 0
	let subject = 0
	for (let i = 0; i < selector.length; i++) {
		const c = selector[i] as string
		if (c === '"' || c === "'") {
			const quote = c
			i++
			while (i < selector.length && selector[i] !== quote) {
				if (selector[i] === '\\') i++
				i++
			}
		} else if (c === '(' || c === '[') depth++
		else if (c === ')' || c === ']') depth--
		else if (depth === 0 && /[\s>+~]/.test(c)) subject = i + 1
	}
	depth = 0
	for (let i = subject; i < selector.length; i++) {
		const c = selector[i] as string
		if (c === '(' || c === '[') depth++
		else if (c === ')' || c === ']') depth--
		else if (depth === 0 && c === ':') {
			if (selector[i + 1] === ':') return { subject, guard: i }
			if (LEGACY_PSEUDO_ELEMENT.test(selector.slice(i)))
				return { subject, guard: i }
		}
	}
	return { subject, guard: selector.trimEnd().length }
}

const SCOPE_PSEUDO = /:scope(?![\w-])/
const SCOPE_PSEUDO_ALL = /:scope(?![\w-])/g
const WHERE_SCOPE = /:where\(\s*:scope\s*\)/g

/** Whether a compound text holds `:scope` outside any parentheses. */
const hasTopLevelScope = (compound: string): boolean => {
	let depth = 0
	for (let i = 0; i < compound.length; i++) {
		const c = compound[i] as string
		if (c === '(' || c === '[') depth++
		else if (c === ')' || c === ']') depth--
		else if (
			depth === 0 &&
			c === ':' &&
			/^:scope(?![\w-])/.test(compound.slice(i))
		)
			return true
	}
	return false
}

const lowerSelector = (selector: string, scope: LoweringScope): string => {
	const member = selector.trim()
	const plain = member.replace(WHERE_SCOPE, () => scope.lead)
	const rootSubject = hasTopLevelScope(
		member.replace(WHERE_SCOPE, ':scope').slice(subjectOf(member).subject),
	)
	const explicit = SCOPE_PSEUDO.test(plain) || plain !== member
	const rewritten = explicit
		? plain.replace(SCOPE_PSEUDO_ALL, () => scope.rootCompound)
		: `${scope.lead} ${member}`
	if (rootSubject || scope.guards === '') return rewritten
	const at = subjectOf(rewritten).guard
	return `${rewritten.slice(0, at)}${scope.guards}${rewritten.slice(at)}`
}

const lowerSelectorList = (list: string, scope: LoweringScope): string =>
	splitTopLevelCommas(list)
		.map(member => lowerSelector(member, scope))
		.join(', ')

const lowerRules = (
	text: string,
	from: number,
	to: number,
	tag: string,
	scope: LoweringScope | null,
): string => {
	let out = ''
	let cursor = from
	for (const rule of scanRules(text, from, to)) {
		out += text.slice(cursor, rule.start)
		cursor = rule.end
		const name = atRuleName(text, rule)
		if (name === null) {
			out += scope
				? `${lowerSelectorList(text.slice(rule.start, rule.brace), scope)} ${text.slice(rule.brace, rule.end)}`
				: text.slice(rule.start, rule.end)
		} else if (name === 'scope' && scope === null) {
			const head = scopeHeadOf(
				text.slice(rule.start + '@scope'.length, rule.brace),
			)
			const body = lowerRules(
				text,
				rule.brace + 1,
				rule.end - 1,
				tag,
				loweringScopeOf(head, tag),
			)
			// The block's rules sat one indentation step in.
			out += body.replace(/^ {1,2}/gm, '').trim()
		} else if (CONDITIONAL_AT_RULES.has(name)) {
			out += `${text.slice(rule.start, rule.brace + 1)}${lowerRules(
				text,
				rule.brace + 1,
				rule.end - 1,
				tag,
				scope,
			)}}`
		} else out += text.slice(rule.start, rule.end)
	}
	return out + text.slice(cursor, to)
}

/* === The partition === */

type Fragment = { start: number; end: number }

const HOISTED_AT_RULES = new Set([
	'keyframes',
	'import',
	'namespace',
	'font-face',
	'property',
	'counter-style',
	'font-palette-values',
	'font-feature-values',
	'page',
	'view-transition',
	'color-profile',
])

const partitionSheet = (
	sheet: unknown,
	sheetText: string,
): { canonical: string; fragments: Fragment[] } => {
	const fragments: Fragment[] = []
	const { text: canonical, strip } = dedentWithStrips(sheetText)
	const rules = (sheet as { rules?: LcRule[] })?.rules ?? []
	const lineStarts = lineStartsOf(canonical)
	const bounds: number[] = rules.map(rule =>
		rule.value?.loc ? shiftedLocToOffset(lineStarts, strip, rule.value.loc) : 0,
	)
	for (const [index, rule] of rules.entries()) {
		if (!HOISTED_AT_RULES.has(rule.type)) continue
		fragments.push({
			start: bounds[index] as number,
			end: (bounds[index + 1] as number | undefined) ?? canonical.length,
		})
	}
	return { canonical, fragments }
}

/* === The emission === */

export const emitScopedSheet = (
	sheet: unknown,
	sheetText: string,
	tag: string,
	cssTargets: CssTargets,
): string => {
	if (scopeModeOf(cssTargets) === 'native') {
		const { text } = dedentWithStrips(sheetText)
		const emitted = nativeRules(text, 0, text.length, tag).trim()
		return emitted === '' ? '' : `${emitted}\n`
	}

	const { canonical, fragments } = partitionSheet(sheet, sheetText)
	const hoisted = fragments
		.map(fragment => canonical.slice(fragment.start, fragment.end).trim())
		.filter(fragment => fragment !== '')

	const remainder = anchorRelativeSelectors(
		splice(
			canonical,
			fragments.map(fragment => ({ ...fragment, text: '' })),
		),
		':where(:scope)',
	)
	let lowered = ''
	if (remainder.trim() !== '') {
		const flat = new TextDecoder()
			.decode(
				transform({
					code: Buffer.from(remainder) as Buffer,
					filename: 'scoped.css',
					...flatteningTargets(cssTargets),
				}).code,
			)
			.trim()
		lowered = lowerRules(flat, 0, flat.length, tag, null)
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	}

	const parts = [...hoisted, ...(lowered !== '' ? [lowered] : [])]
	return parts.length > 0 ? `${parts.join('\n\n')}\n` : ''
}
