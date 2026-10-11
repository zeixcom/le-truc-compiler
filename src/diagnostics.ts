import type { InteractiveFinding } from './analysis/content-model'
import type { RoleWrite, WatchBinding } from './analysis/role-writes'
import type { MarkerName } from './imports'
import type { SourceRange } from './ir'
import type { SurfaceWording } from './surface'

/* === Types === */

export type DiagnosticCode =
	| 'LTC001' // @for over a reactive source that is not a declared createList
	| 'LTC002' // loop variable referenced inside a reactive thunk — hoist it first
	| 'LTC003' // hoisted const not rebindable to a server-rendered attribute
	// ('LTC004' is spent: retired as an emitted code, it survives ONLY as a
	// routing-signal origin — see tier.ts's `RoutingSignalOrigin`, which owns
	// the spelling now)
	| 'LTC005' // construct outside the supported subset
	| 'LTC006' // malformed or unsupported attribute shape
	| 'LTC007' // template structure the compiler cannot address
	| 'LTC008' // source shape violation (root tag, exports, style placement)
	| 'LTC009' // invalid `export const config` extension declaration
	| 'LTC010' // managed form prop used without formAssociated
	| 'LTC011' // composed (PascalCase) element with no resolvable .tsrx/.tsx import
	| 'LTC012' // pass={{ }}/reactive dispatch legality on a custom-element target, incl. per-prop Slot-backedness
	// ('LTC013' is spent: retired as an emitted code — its
	// two server-evaluation factories became routing signals, the other two
	// split to LTC044/LTC045 — and survives ONLY as a
	// routing-signal origin; see tier.ts's `RoutingSignalOrigin`)
	| 'LTC014' // plain (non-.tsrx) import whose bindings are never used anywhere the compiler can place them
	| 'LTC015' // requestContext() called with other than exactly two arguments
	| 'LTC016' // requestContext()'s fallback argument is not server-known
	| 'LTC017' // template child whose reactivity cannot be traced — needs a thunk
	| 'TSRX018' // retired `&{}` lazy-child sigil
	| 'LTC019' // string-literal prop name in child position — write host.<prop>
	| 'TSRX020' // RETIRED — the parser rejects lazy destructuring (`&{ … }`/`&[ … ]`) as its own syntax error, surfaced as LTC008. No builder emits this code; the member stays so the spent number stays visible in the union
	| 'TSRX021' // React `{cond && <jsx/>}` conditional-render idiom in child position
	| 'TSRX022' // React `{cond ? <a/> : <b/>}` conditional-render idiom in child position
	| 'TSRX023' // React `.map()` producing JSX in child position
	| 'TSRX024' // React `return (<>…</>)` render idiom in setup position
	| 'LTC025' // malformed first() element-reference call
	| 'LTC026' // first()/all() selector matches no element, uses unverifiable syntax, or is malformed
	| 'LTC027' // first() selector matches multiple, non-mutually-exclusive elements
	| 'LTC028' // expose() names a member it cannot: managed by formAssociated(), or a reserved word
	| 'LTC029' // a form-associated component's inner control carries a name
	| 'LTC030' // <textarea value={…}> — textarea has no value content attribute
	| 'LTC031' // RETIRED — per-branch addressing replaced it; no builder emits this code; the member stays so every spent number is visible in the union
	| 'LTC032' // destructured prop has a default value but its type isn't marked optional
	| 'LTC033' // a static child or server-rendered attribute reads an impure ambient (Date/Intl/Math.random/crypto RNG/toLocaleString), and so do a server-data loop's items — reactive thunks are omitted silently instead
	| 'LTC034' // severe only: disabled/checked unresolvable on a submittable control of a Static-tier component; non-severe sites are routing signals
	// ('LTC035' is spent: retired — template-cloned arms keep every
	// non-winning arm out of the document, so a literal id
	// repeated across arms no longer collides. No builder emits this code;
	// the member stays so every spent number is visible in the union)
	| 'LTC036' // real `@zeix/le-truc` export used without an explicit import
	| 'LTC037' // FactoryContext name inside an authored `@zeix/le-truc` import
	| 'LTC038' // duplicate static id across compose sites
	| 'LTC039' // Parser-exposed prop whose value is also rendered into an owned site
	| 'LTC040' // required first() whose only match sits in a branch that may not render
	| 'LTC041' // two first() names resolve to the same element
	| 'LTC042' // a static id in a template duplicates once the component is instantiated twice
	// ('LTC043' is spent: retired as an emitted code, it
	// survives ONLY as a routing-signal origin — see tier.ts's
	// `RoutingSignalOrigin`, which owns the spelling now)
	| 'LTC044' // a signal's initializer conditionally chooses between two constructor calls (split from LTC013)
	| 'LTC045' // a collector-requiring helper deferred into a callback, so it throws NoActiveCollectorError at connect (split from LTC013)
	| 'LTC046' // a setup const the value harness cannot evaluate has its value rendered into the markup — no tier can produce the site
	| 'LTC047' // literal prose in a component that declares `export const i18n` — route it through a message key
	| 'LTC048' // one component tag declared by multiple corpus sources outside a folder-local variant set — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC049' // the factory-context parameter destructures a name that is not FactoryContext vocabulary, or is not a destructured object — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC050' // the factory-context annotation's surface disagrees with `config.formAssociated` — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC051' // a variant set's compiled members disagree on CSS — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC052' // a server-data @for carries a `key` clause, which only a reactive List's reconcile() reads — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC053' // an element tag that is not a static name: a `.tsrx` dynamic `<{expr}>` tag, or a `.tsx` namespaced/member tag the front end does not recognize — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC054' // a position the server render evaluates reads page context outside the declared ambient set, or the reserved `i18n` record is destructured for a member outside it — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC055' // an `export const i18n` source pattern is not a supported ICU MessageFormat 1 pattern, or a `t.<key>` site disagrees with its pattern's arguments: missing/extra/non-literal arguments, an argument message read without a call, an argument-less message called — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC056' // an authored `<script>` element in a component template, whatever its `type` — the page owns script loading — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC059' // a signal seeded from server args renders only as formatted text (`Intl`, `toLocaleString()`/`toLocaleDateString()`/`toLocaleTimeString()`, a message call with a number/date argument) and has no raw value source to harvest from — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC060' // a fragment root, whatever it wraps — the template's root is the host element — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC061' // an authored `<template>` element in a component template — the compiler owns template extraction, and the selector proof cannot see inside one — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC062' // a reactive switch (one whose discriminant reads a signal) has a `@case`/`case` value that is not a literal, or two cases share an arm key — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC063' // a reactive condition inside a reactive list's reconcile() container — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC064' // the component's stylesheet does not parse — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC065' // a stylesheet declaration names a property the CSS dictionary does not know, or a value outside the property's grammar — tier 2 Contained: the dictionary (mdn-data, via css-tree) lags the platform, so a finding is evidence, not proof; the sheet ships as authored
	| 'LTC066' // a rule inside the component's `@scope` led by the component's own tag — it matches only a nested instance, never the host; the fix-it is `:where(:scope)` — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC067' // `::slotted()` in a component stylesheet — slotted content is a shadow-DOM construct, and compiled components are light DOM — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC068' // `:host-context()` in a component stylesheet — removed from the CSS spec, matched by no browser — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC069' // `:global` anywhere in a component stylesheet — an unscoped rule is a top-level rule, so the fix-it removes the wrapper and moves the rule to the top level — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC070' // RETIRED — a qualifier after `:scope` is valid CSS; the number is spent, see VOCABULARY_LEDGER.md
	| 'LTC071' // a selector inside a `@scope` block descends past a compound the block's own `to (…)` limit excludes, so the limit always excludes its subject — a dead rule — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC072' // a field of a list item seeded from server args has no harvest site in the item — no text child or reactive attribute reads exactly the field, and the `keyConfig` does not return it verbatim — so the client cannot rebuild the item at connect — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC073' // a `<style>` block that is not the root's single direct `<style>` child — a second direct one, or one nested in a descendant; only the first direct child is hoisted as the stylesheet, so the CSS would be dropped — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC074' // an element sibling of a reactive-list loop in its reconcile() container — directly or as an arm root, in any arm, of a server-mode conditional or a non-async `try` — carries no `data-unreconciled`, so the first reconcile removes it (an authored `data-key` is no exemption) — tier 1 Prevented, statically decidable; the runtime half is a DEV_MODE advisory, not a Contained error. Lands out of numeric order: `LTC072`/`LTC073` were reserved before this rule picked
	| 'LTC075' // a composed element in a reactive-list item whose args or content read the item or key binding — the child renders once, into the extracted `<template>` every item clones — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC076' // a field of a list item seeded from server args has a harvest site but no parser — its type is not one the compiler infers a parser from (`string`, a string-literal union, `number`, `boolean`; never an optional field) and no `harvest()` entry declares one; or the item type itself is unreadable (imported, generic) and no `harvest()` map lists its fields — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC077' // a scalar-seeded signal whose harvest read is a raw DOM string — a direct text/attribute site, the substituted read of a seed that is the arg itself, or a membership value read — and whose seed type the compiler cannot read (any annotation that is not the bare `string`/`number`/`boolean` keyword) with no `harvest()` marker declaring its parser: the inferred-type fallback would connect e.g. `2.5` as `'2.5'` — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC078' // a `<style>` block whose content is not a stylesheet spelling — on `.tsx` anything but the `css` marker's tagged template, a bare template literal or nothing (another tag, a shadowed or unimported `css`, a `${}` substitution, any other expression or text); on `.tsrx` an expression child in place of the CSS body. The sheet would read as empty and ship no CSS — tier 1 Prevented, statically decidable, no runtime half. Lands out of numeric order: `LTC076`/`LTC077` were reserved before this rule picked
	| 'LTC080' // a key alias that misses the alias-harvest conditions — a host-level list seeded from server args, never rendered by its own `map`, is harvested through `const t = list.byKey(k)` in a reactive list's item setup only when the aliasing list keys each item by itself, the read is that alias statement over the loop key, the list has one alias scope, and every field renders at a site in it — tier 1 Prevented, statically decidable; the render witness is the dynamic half, a server-render error with no client counterpart
	| 'LTC081' // a handler arg (an `on[A-Z]…` arg) the parent cannot address: its declared type is not a function type; or it is read anywhere but as an event attribute on a raw element or forwarded to a composed child's handler arg; or it is placed inside one of the component's reactive arms or list items, whose elements are recreated on a flip or a reconcile — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC083' // a first()/all() selector that can only resolve inside the content a parent passes as `children` — it matches nothing in the component's own template, the template inserts `{children}`, and its subject compound names no role class declared on the `children` prop's `Children<…>` type — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC085' // a compose site of a child whose `children` prop declares `Children<…, 'non-interactive'>` passes interactive content — `a[href]`, `button`, `input` (except `type="hidden"`), `select`, `textarea`, `label`, `details`, `iframe`, any `[tabindex]`, `audio`/`video` with `controls` — among its literal children, or a composed child whose own template renders any, transitively — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC084' // a parent `watch` binding on a `first()` reference into a compose site's content writes the same property, attribute, class token, style property or text on an element carrying a role class the child's client also writes through its role-targeted `watch` bindings — tier 1 Prevented, statically decidable on both sides, no runtime half
	| 'LTC086' // `:host` anywhere in a component stylesheet — it matches nothing in light DOM; the fix-it is `:where(:scope)` (`:host(X)` → `:where(:scope)X`) — tier 1 Prevented, statically decidable, no runtime half
	| 'LTC087' // a rule in the component's `@scope` block whose subject can match an element a composed child renders in its own template (transitively through the registry), with no authored limit excluding the child; passed `children` content is the parent's own markup and never counts — tier 2 Contained: the CSS ships as authored
	| 'LTC088' // a top-level stylesheet rule that is neither in `@scope` nor led by the component's own tag — it applies page-wide; `@keyframes`, `@font-face` and `@property` are exempt — tier 2 Contained: the CSS ships as authored
	| 'LTC089' // a `@scope` form the flat-selector lowering cannot express — a `@scope` inside a component `@scope`, or a limit naming `:scope` — on a CSS target without native `@scope` — tier 1 Prevented, statically decidable, no runtime half

export type DiagnosticLocation = {
	file: string
	start: number
	end: number
}

/** One text replacement a fix applies: `location`'s range becomes `text`. */
export type DiagnosticEdit = {
	location: DiagnosticLocation
	text: string
}

export type DiagnosticFix = {
	description: string
	edits: DiagnosticEdit[]
}

export type CompileDiagnostic = {
	code: DiagnosticCode
	severity: 'error' | 'warning'
	message: string
	location: DiagnosticLocation
	/** Further locations the message refers to; empty when there are none. */
	related: DiagnosticLocation[]
	fix?: DiagnosticFix
}

export type Site =
	| { start?: number | undefined; end?: number | undefined }
	| null
	| undefined

export type LocalDiagnostic = {
	code: DiagnosticCode
	severity: 'error' | 'warning'
	message: string
	range: SourceRange
	related?: SourceRange[]
	fix?: {
		description: string
		edits: { range: SourceRange; text: string }[]
	}
}

export type StyleBlockRefusal =
	| { reason: 'content'; at: Site }
	| { reason: 'shadowed'; at: Site }
	| { reason: 'tag'; at: Site; tag: string }
	| { reason: 'substitution'; at: Site }

/* === Internal Functions === */

const error = (
	code: DiagnosticCode,
	message: string,
	range: SourceRange,
): LocalDiagnostic => ({ code, severity: 'error', message, range })

/** A corpus-level error: the caller names the file and the related ones. */
const corpusError = (
	code: DiagnosticCode,
	message: string,
	location: DiagnosticLocation,
	related: DiagnosticLocation[],
): CompileDiagnostic => ({
	code,
	severity: 'error',
	message,
	location,
	related,
})

const sanitizeArgName = (id: string): string => {
	const camel = id
		.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) =>
			c ? c.toUpperCase() : '',
		)
		.replace(/^[0-9]+/, '')
	const base = camel === '' ? 'element' : camel
	return /id$/i.test(base) ? base : `${base}Id`
}

/** `a`, `b` and `c` — each item in backticks, for a closed list in copy. */
const codeList = (items: Iterable<string>): string => {
	const quoted = [...items].map(item => `\`${item}\``)
	return quoted.length < 2
		? quoted.join('')
		: `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
}

const warning = (
	code: DiagnosticCode,
	message: string,
	range: SourceRange,
): LocalDiagnostic => ({ code, severity: 'warning', message, range })

export const lineOf = (
	source: string,
	offset: number | undefined,
): number | undefined => {
	if (offset === undefined || offset < 0 || offset > source.length)
		return undefined
	let line = 1
	for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++
	return line
}

export const rangeOf = (source: string, at: Site): SourceRange => {
	const start = at?.start
	if (start === undefined || start < 0 || start > source.length)
		return { start: 0, end: source.length }
	const end = at?.end
	return {
		start,
		end: end === undefined || end < start || end > source.length ? start : end,
	}
}

/** A whole file's range — corpus-level rules have no construct inside it. */
export const wholeFile = (
	file: string,
	source: string,
): DiagnosticLocation => ({
	file,
	start: 0,
	end: source.length,
})

export const locate = (
	diagnostic: LocalDiagnostic,
	file: string,
): CompileDiagnostic => {
	const at = (range: SourceRange): DiagnosticLocation => ({ file, ...range })
	const located: CompileDiagnostic = {
		code: diagnostic.code,
		severity: diagnostic.severity,
		message: diagnostic.message,
		location: at(diagnostic.range),
		related: (diagnostic.related ?? []).map(at),
	}
	if (diagnostic.fix)
		located.fix = {
			description: diagnostic.fix.description,
			edits: diagnostic.fix.edits.map(edit => ({
				location: at(edit.range),
				text: edit.text,
			})),
		}
	return located
}

/* === Exported Functions === */

export const diagnostic = {
	reactiveForNotSupported: (
		source: string,
		at: Site,
		iterable: string,
		wording: SurfaceWording,
	) =>
		warning(
			'LTC001',
			`${wording.loop} over reactive source \`${iterable}\` — only declared createList(…) and deriveList(…) signals lower (reconcile(), ADR 0004); other reactive sources are not supported. File skipped.`,
			rangeOf(source, at),
		),

	keyOnServerDataFor: (source: string, at: Site) =>
		error(
			'LTC052',
			'This `@for` iterates server data but has a `key` clause — only a `@for` over a declared `createList(…)` signal reconciles its items by key, so this key has no effect. Remove the `key` clause, or declare the items with `createList(…)` if they must be keyed.',
			rangeOf(source, at),
		),

	unsupportedElementTag: (
		source: string,
		at: Site,
		spelled: string,
		conditional: string,
	) =>
		error(
			'LTC053',
			`The tag \`<${spelled}>\` is not a static element name — the compiler makes elements from static tag names only. To choose a tag at render time, choose between static tags with a conditional, for example \`${conditional}\`.`,
			rangeOf(source, at),
		),

	boundaryAsLoopRoot: (source: string, at: Site, wording: SurfaceWording) =>
		error(
			'LTC053',
			`A ${wording.boundary} cannot sit directly in a ${wording.loop} body — the body's root must be an element, because the client addresses each item through it. Wrap the boundary in an element inside the ${wording.loop} body, or move it out of the ${wording.loop} body.`,
			rangeOf(source, at),
		),

	scriptElementInTemplate: (source: string, at: Site) =>
		error(
			'LTC056',
			"A `<script>` element in a component template — scripts are refused, whatever their `type`: the page owns script loading, and a component template is static markup plus component behavior. Move the script to the page that places this component, or do its work in the component's setup (in `watch()` or an `on()` handler).",
			rangeOf(source, at),
		),

	formattedWithoutRawSource: (
		source: string,
		at: Site,
		subject: string,
		formatting: string,
	) =>
		error(
			'LTC059',
			`${subject} is seeded from server args but renders only as text formatted with ${formatting} — formatted text does not parse back into state, so the client has no value to start from. Render the raw value where the client can read it: a reactive \`<data value={() => …}>\` beside a number, a reactive \`<time datetime={() => …}>\` beside a date, or the arg as an attribute on the host.`,
			rangeOf(source, at),
		),

	misplacedMarker: (source: string, at: Site, marker: MarkerName) => {
		const copy: Record<MarkerName, { what: string; fix: string }> = {
			css: {
				what: 'A `css` tag outside the content of the root’s `<style>`',
				fix: '`css` marks the component’s stylesheet, and the compiler reads it only as the tag of the template literal inside the root’s `<style>` — move the CSS there, or drop the tag.',
			},
			harvest: {
				what: 'A `harvest()` call outside the seed of a `createList()` or a scalar signal declaration',
				fix: '`harvest()` declares the parser a client harvest reads a server-rendered seed through — the field parsers of a list seeded from server args, or the parser of a scalar signal seed — so the compiler reads it only as the seed of a component-setup `createList()` or a `createCell`/`createState`/`createStore` declaration. Call it there, or drop it.',
			},
		}
		return error(
			'LTC005',
			`${copy[marker].what} is outside the supported subset (ADR 0005). ${copy[marker].fix}`,
			rangeOf(source, at),
		)
	},

	listFieldWithoutSite: (
		source: string,
		at: Site,
		list: string,
		field: string,
	) =>
		error(
			'LTC072',
			`Field \`${field}\` of list \`${list}\` renders nowhere in the item, so the client cannot read it back. The client rebuilds each server-rendered item from its markup, and a field the item does not carry has no value at connect — render the raw value in the item, reading exactly the field: \`data-${field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}={() => …}\` on the item root, or \`<data value={() => …}>\`.`,
			rangeOf(source, at),
		),

	keyAliasRefused: (
		source: string,
		at: Site,
		list: string,
		condition:
			| { kind: 'item-key'; alias: string; loopList: string; item: string }
			| { kind: 'read'; loopList: string; key: string | null }
			| {
					kind: 'second-scope'
					alias: string
					first: string
					firstList: string
			  }
			| { kind: 'field'; alias: string; field: string },
	) => {
		const key = (k: string | null): string => k ?? 'k'
		const message = (() => {
			switch (condition.kind) {
				case 'item-key':
					return `List \`${condition.loopList}\`, whose items read list \`${list}\` through the key alias \`${condition.alias}\`, does not key each item by the item itself. The client rebuilds \`${list}\` from the keys of \`${condition.loopList}\`, so each item must be a key of \`${list}\` — declare \`${condition.loopList}\` with \`keyConfig: ${condition.item} => ${condition.item}\`.`
				case 'read':
					return `This \`${list}.byKey()\` read in the item setup of list \`${condition.loopList}\` is not a key alias, so the client cannot rebuild \`${list}\` from the items. A key alias reads \`byKey\` over the loop key, unconditionally, as its own statement — declare it as \`const t = ${list}.byKey(${key(condition.key)})\`${condition.key === null ? ' and bind the loop key' : ''}, and read the item through \`t\`.`
				case 'second-scope':
					return `List \`${list}\` already has the key alias \`${condition.first}\` in list \`${condition.firstList}\`, so the key alias \`${condition.alias}\` is a second one. The client rebuilds \`${list}\` from one alias scope, where each field has one site — read \`${list}\` through \`${condition.first}\` only, and remove this alias.`
				case 'field':
					return `Field \`${condition.field}\` of list \`${list}\` renders nowhere in the item of its key alias \`${condition.alias}\`, so the client cannot read it back. The client rebuilds each item of \`${list}\` from the alias scope's markup — render the raw value there, reading exactly the field: \`{() => ${condition.alias}.get().${condition.field}}\`, or \`<data value={() => ${condition.alias}.get().${condition.field}}>\`.`
			}
		})()
		return error('LTC080', message, rangeOf(source, at))
	},

	listFieldWithoutParser: (
		source: string,
		at: Site,
		list: string,
		field: string | null,
		typeText: string,
		seed: string,
		marked: boolean,
	) =>
		error(
			'LTC076',
			field === null
				? `The items of list \`${list}\` have type \`${typeText}\`, which the compiler cannot read — it reads only types declared in this file — so it cannot list the fields the client rebuilds each server-rendered item from. Declare a parser for every field on the seed: \`createList(harvest(${seed}, { <field>: … }), …)\`.`
				: `Field \`${field}\` of list \`${list}\` has type \`${typeText}\`, which the compiler infers no parser from, so the client cannot read the field back from the item's markup. ${marked ? `Add its parser to the \`harvest()\` map: \`${field}: …\`.` : `Declare its parser on the seed: \`createList(harvest(${seed}, { ${field}: … }), …)\`.`}`,
			rangeOf(source, at),
		),

	scalarSeedWithoutParser: (
		source: string,
		at: Site,
		signal: string,
		ctor: string,
		seed: string,
		annotation: string | null,
	) =>
		error(
			'LTC077',
			`Signal \`${signal}\` is seeded from \`${seed}\`, whose type ${
				annotation
					? `\`${annotation}\` the compiler cannot read — it reads only the bare \`string\`/\`number\`/\`boolean\` keywords`
					: 'has no annotation the compiler can read'
			}, so the harvest would connect it as a string. Declare its parser on the seed: \`${ctor}(harvest(${seed}, …))\`.`,
			rangeOf(source, at),
		),

	templateElementInTemplate: (source: string, at: Site) =>
		error(
			'LTC061',
			"A `<template>` element in a component template — the compiler emits the `<template>`s a component needs (a reactive list's item template, its conditional arms), and an authored one would collide with them. Render the markup directly, or let a reactive list or condition produce the repeated or switched content.",
			rangeOf(source, at),
		),

	fragmentRoot: (source: string, at: Site) =>
		error(
			'LTC060',
			"The template output is a fragment (`<>…</>`) — the template's root is the host element, and there is no fragment root. Drop the fragment so that the host element is the root. If the component has a stylesheet, put it inside the root as a `<style>` child.",
			rangeOf(source, at),
		),

	misplacedStyleBlock: (source: string, at: Site, nested: boolean) =>
		error(
			'LTC073',
			nested
				? "A `<style>` block nested inside an element of the template — the stylesheet is read only from a `<style>` child of the root, so this block's CSS would be dropped. Move its rules into the root's single `<style>` child."
				: "A second `<style>` block in the root — the stylesheet is read only from the root's first `<style>` child, so this block's CSS would be dropped. Merge its rules into the root's single `<style>` child.",
			rangeOf(source, at),
		),

	unreadableStyleBlock: (
		source: string,
		refusal: StyleBlockRefusal,
		wording: SurfaceWording,
	) => {
		const MACROS = '`@zeix/le-truc-compiler/macros`'
		switch (refusal.reason) {
			case 'shadowed':
				return error(
					'LTC078',
					`The \`css\` tag on this \`<style>\` block is not the \`css\` marker — the name is not imported from ${MACROS}, or a declaration in the component shadows that import. The compiler reads no stylesheet from it, so the component would ship no CSS. Import \`css\` from ${MACROS} and rename any other \`css\` in scope.`,
					rangeOf(source, refusal.at),
				)
			case 'tag':
				return error(
					'LTC078',
					`The template in this \`<style>\` block is tagged \`${refusal.tag}\`, not the \`css\` marker — the compiler reads only a \`css\`-tagged or untagged template literal, so the component would ship no CSS. Tag it with \`css\` from ${MACROS}, or remove the tag.`,
					rangeOf(source, refusal.at),
				)
			case 'substitution':
				return error(
					'LTC078',
					'The template in this `<style>` block contains a `${}` substitution — the compiler reads the stylesheet at build time and evaluates nothing in it, so the component would ship no CSS. Replace the substitution with literal CSS, or set the value as a custom property on an element and read it with `var()`.',
					rangeOf(source, refusal.at),
				)
			case 'content':
				return error(
					'LTC078',
					`The content of this \`<style>\` block is not a stylesheet — the compiler does not evaluate it, so the component would ship no CSS. Write the CSS as ${wording.stylesheetForm}.`,
					rangeOf(source, refusal.at),
				)
		}
	},

	dynamicCaseValue: (
		source: string,
		at: Site,
		caseText: string,
		wording: SurfaceWording,
		duplicate = false,
	) =>
		error(
			'LTC062',
			duplicate
				? `The ${wording.caseLabel} value \`${caseText}\` names the same arm as an earlier one in a switch that reads a signal. Its arms switch on the client by a key derived from each value, so every value must name a distinct arm — remove or merge the duplicate.`
				: `The ${wording.caseLabel} value \`${caseText}\` is not a literal in a switch that reads a signal. Its arms switch on the client by a key derived from each value at compile time — write each value as a string, number, boolean or \`null\` literal.`,
			rangeOf(source, at),
		),

	reactiveConditionInReconcileContainer: (
		source: string,
		at: Site,
		construct: 'conditional' | 'try',
		wording: SurfaceWording,
	) =>
		error(
			'LTC063',
			`${construct === 'try' ? wording.asyncBoundary : wording.reactiveConditional} inside the container of a reactive-list ${wording.loop}. The list owns that container's children and removes everything it did not place, the arm and its templates included — move the ${construct === 'try' ? 'boundary' : 'condition'} out of the container, or wrap the loop in an element of its own.`,
			rangeOf(source, at),
		),

	unkeyedSiblingInReconcileContainer: (
		source: string,
		at: Site,
		tag: string,
		composed: boolean,
		wording: SurfaceWording,
	) =>
		error(
			'LTC074',
			`<${tag}> sits beside a reactive-list ${wording.loop} in the list's container, without \`data-unreconciled\`. The list owns that container's children and removes every element it did not place on its first run — ${composed ? 'a composed element cannot carry `data-unreconciled`, so move it out of the container' : 'add `data-unreconciled` to keep the element, or move it out of the container'}.`,
			rangeOf(source, at),
		),

	composeReadsListItem: (
		source: string,
		at: Site,
		component: string,
		site: string,
		reads: readonly string[],
		wording: SurfaceWording,
	) =>
		error(
			'LTC075',
			`<${component}> in a reactive-list ${wording.loop} body reads ${reads.map(n => `\`${n}\``).join(' and ')} in ${site}. The server renders the child once, into the \`<template>\` that every item clones, so no per-item value exists there — pass the value through \`truc:pass\`, or give the child only server-known values.`,
			rangeOf(source, at),
		),

	unaddressableHandlerArg: (
		source: string,
		at: Site,
		arg: string,
		condition:
			| { kind: 'not-function' }
			| { kind: 'read' }
			| { kind: 'in-scope'; where: string; scope: 'arm' | 'item' }
			| { kind: 'in-loop'; loop: string },
	) => {
		const message = (() => {
			switch (condition.kind) {
				case 'not-function':
					return `Handler arg \`${arg}\` has no function type in the parameter annotation. An arg named \`on\` plus a capital letter is a handler arg, which the parent binds as an event listener — declare it with a function type, for example \`${arg}?: (e: Event) => void\`, or rename the arg.`
				case 'read':
					return `Handler arg \`${arg}\` is read outside an event attribute. The parent binds a handler arg as a listener on the element that carries it, so the arg has no value inside the component — place it as an event attribute on a raw element, \`<button onClick={${arg}}>\`, or forward it to a composed child's handler arg.`
				case 'in-scope':
					return `Handler arg \`${arg}\` is placed inside ${condition.where}. The client recreates the ${condition.scope}'s elements on every ${condition.scope === 'arm' ? 'flip' : 'reconcile'}, so the listener the parent binds at connect would stay on a removed element — place the arg on an element outside the ${condition.scope}.`
				case 'in-loop':
					return `Handler arg \`${arg}\` is placed inside a server-data ${condition.loop} body. The parent binds one listener for each placement, and the loop renders the element once for each item, so only the first item's element would get one — place the arg on an element outside the loop.`
			}
		})()
		return error('LTC081', message, rangeOf(source, at))
	},

	foldReadsPageContext: (
		source: string,
		at: Site,
		where: string,
		reads: readonly string[],
		ambients: Iterable<string>,
	) =>
		error(
			'LTC054',
			`The server evaluates ${where} at build time, but it reads ${codeList(reads)}, which is page context. Server-rendered HTML can depend only on the component's own args and on ${codeList(ambients)} from the \`i18n\` record — a template backend has no variable for page context. Pass the value in as an arg, or read it in the factory (in \`watch()\` or an \`on()\` handler), where it runs in the browser.`,
			rangeOf(source, at),
		),

	undeclaredPageAmbient: (
		source: string,
		at: Site,
		member: string | null,
		ambients: Iterable<string>,
	) =>
		error(
			'LTC054',
			`${member === null ? 'This destructuring takes an undeclared member' : `\`${member}\` is not a member`} of the reserved \`i18n\` record. The record carries only ${codeList(ambients)} — the page values that server-rendered HTML can depend on besides the component's own args. ${member === null ? 'Destructure the members you need by name' : `Destructure one of these members, or declare \`${member}\` as an arg`}.`,
			rangeOf(source, at),
		),

	loopVariableInReactiveThunk: (source: string, at: Site, names: string[]) =>
		error(
			'LTC002',
			`Reactive expressions must not reference loop variables directly (${names.map(n => `\`${n}\``).join(', ')}). Hoist the derived value into a const first (e.g. \`const pid = panelId(tab.id)\`) so the client can rebind it to a server-rendered attribute.`,
			rangeOf(source, at),
		),

	/** Hoisted const referenced reactively but never rendered as a bare attribute. */
	constNotRebindable: (
		source: string,
		at: Site,
		name: string,
		element: string,
	) =>
		error(
			'LTC003',
			`Hoisted const \`${name}\` is referenced by a reactive expression but never rendered as a bare attribute of <${element}>, so the client cannot rebind it. Render it (e.g. \`aria-controls={${name}}\` or a \`data-\` attribute) or stop referencing it reactively.`,
			rangeOf(source, at),
		),

	// --- subset, attribute shapes, addressing, source structure ---
	unsupported: (source: string, at: Site, what: string, fix?: string) =>
		error(
			'LTC005',
			`${what} is outside the supported subset (ADR 0005).${fix ? ` ${fix}` : ''}`,
			rangeOf(source, at),
		),

	serverOnlyNames: (
		source: string,
		at: Site,
		subject: string,
		names: {
			server: readonly string[]
			module: readonly string[]
			listBody: readonly string[]
		},
		lang: string | null,
		t: string | null = null,
		channel: readonly string[] = [],
	) => {
		const { server, module, listBody } = names
		const bound = [...server, ...module]
		const them = (list: readonly string[]) =>
			list.length === 1 ? 'it' : 'them'
		const sentences: string[] = []
		if (bound.length > 0)
			sentences.push(
				`${subject} references server-only ${bound.length === 1 ? 'name' : 'names'} ${codeList(bound)} — the generated client does not bind ${them(bound)}, so the read throws when the client runs it.`,
			)
		if (listBody.length > 0)
			sentences.push(
				`${bound.length > 0 ? 'It also references' : `${subject} references`} ${codeList(listBody)}, which a list body cannot read — the client emits setup consts and imports only for positions outside list bodies.`,
			)
		if (lang !== null)
			sentences.push(
				`The locale is \`host.lang\` on the client, not \`${lang}\`.`,
			)
		if (t !== null)
			sentences.push(
				`The client receives a message only when the site reads a declared key literally — write \`${t}.<key>\` or \`${t}['<key>']\`.`,
			)
		if (
			server.some(
				name => name !== lang && name !== t && !channel.includes(name),
			)
		)
			sentences.push('Read the value through an exposed prop or from the DOM.')
		if (module.length > 0)
			sentences.push(
				`Import ${codeList(module)} from a module, or declare ${them(module)} as a const in setup.`,
			)
		if (listBody.length > 0)
			sentences.push('Read the value through an exposed prop instead.')
		return error('LTC005', sentences.join(' '), rangeOf(source, at))
	},

	loopInBranch: (
		source: string,
		at: Site,
		wording: SurfaceWording,
		branch: 'if' | 'switch',
	) => {
		const { inside, outOf } = wording.loopInBranch(branch)
		return error(
			'LTC005',
			`${wording.aLoop} inside ${inside} is outside the supported subset: the client addresses a branch's content by its roots, so only the loop's first item would get its bindings. Render the empty case with ${wording.emptyArmFix}, or move the loop out of ${outOf}.`,
			rangeOf(source, at),
		)
	},

	/** Attribute shape the classifier does not accept. */
	invalidAttribute: (source: string, at: Site, what: string) =>
		error('LTC006', what, rangeOf(source, at)),

	/** Element the generated client cannot address deterministically. */
	unaddressableElement: (source: string, at: Site, what: string) =>
		error('LTC007', what, rangeOf(source, at)),

	invalidSource: (source: string, at: Site, what: string) =>
		error('LTC008', what, rangeOf(source, at)),

	// --- config, managed form props, composition, pass legality ---
	invalidConfig: (source: string, at: Site, what: string) =>
		error('LTC009', what, rangeOf(source, at)),

	managedPropWithoutForm: (source: string, at: Site, prop: string) =>
		error(
			'LTC010',
			`\`{host.${prop}}\` reads a managed form prop — it is watchable only when formAssociated() leads the extensions. Declare \`export const config = { formAssociated: true }\` or expose a prop of that name.`,
			rangeOf(source, at),
		),

	unresolvedComposedComponent: (source: string, at: Site, name: string) =>
		error(
			'LTC011',
			`\`<${name}>\` has no matching \`import { ${name} }\` of a \`.tsrx\` or \`.tsx\` module — composed (capitalized) tags must import the component they compose (ADR 0005 sub-design 10). A lowercase dashed tag addresses a raw custom element instead.`,
			rangeOf(source, at),
		),

	composedComponentNotCompiled: (
		source: string,
		at: Site,
		name: string,
		path: string,
	) =>
		error(
			'LTC011',
			`\`<${name}>\` composes \`${path}\`, but that file did not compile (or was not found) — fix its own diagnostics first.`,
			rangeOf(source, at),
		),

	composedElementUnsupported: (source: string, at: Site, what: string) =>
		error(
			'LTC011',
			`${what} is not supported yet (ADR 0005 sub-design 10). Move the construct into the composed component's own template, or out of this position.`,
			rangeOf(source, at),
		),

	reactiveAttrOnCustomElement: (
		source: string,
		at: Site,
		tag: string,
		attr: string,
	) =>
		error(
			'LTC012',
			`Reactive attribute \`${attr}={…}\` on custom element <${tag}> is no longer bound to anything (ADR 0005 sub-design 10) — use \`pass={{ ${attr}: ${attr} }}\` for client-side signal interop, or a plain value for a static attribute.`,
			rangeOf(source, at),
		),

	/** `pass={{ }}` on a native element or an unregistered/unknown custom tag. */
	passTargetNotCustom: (source: string, at: Site, tag: string) =>
		error(
			'LTC012',
			`pass={{ … }} on <${tag}> — its target must be a registry-known custom element (ADR 0005 sub-design 10); native elements use reactive attribute bindings instead. At connect this is \`InvalidCustomElementError\`.`,
			rangeOf(source, at),
		),

	passPropNotExposed: (
		source: string,
		at: Site,
		tag: string,
		prop: string,
		exposed: string[],
	) =>
		error(
			'LTC012',
			`pass={{ ${prop}: … }} targets <${tag}>, which does not expose \`${prop}\` — its reactive props are ${exposed.length ? exposed.map(p => `\`${p}\``).join(', ') : '(none)'}. Add \`${prop}\` to that component's \`expose({ … })\`, or pass one of the props it does declare. At connect this is \`InvalidPassPropertyError\`.`,
			rangeOf(source, at),
		),

	passPropNotSlotBacked: (
		source: string,
		at: Site,
		tag: string,
		prop: string,
		kind: 'computed' | 'method',
	) =>
		error(
			'LTC012',
			kind === 'method'
				? `pass={{ ${prop}: … }} targets <${tag}>, whose \`${prop}\` is a \`defineMethod()\` producer, not a reactive property — it is installed as a plain member and has no Slot to swap. Call it (\`el.${prop}()\`) from an event handler instead of passing to it. At connect this is \`InvalidPassPropertyError\`.`
				: `pass={{ ${prop}: … }} targets <${tag}>, whose \`${prop}\` is exposed READ-ONLY — a computed initializer (\`sig.get\` or \`() => …\`) is defined with a getter, not a Slot, so there is no backing signal for pass() to swap (ADR 0004). Expose \`${prop}\` from a mutable initializer on <${tag}> (a value, a Parser, or a \`{ get, set }\` descriptor) if it is meant to be driven from outside; otherwise drive it from <${tag}>'s own state. At connect this is \`InvalidPassPropertyError\`.`,
			rangeOf(source, at),
		),

	// --- imports, requestContext, children, ref spellings ---
	unusedPlainImport: (source: string, at: Site, names: string[]) =>
		warning(
			'LTC014',
			`Import ${names.map(n => `\`${n}\``).join(', ')} is never referenced in setup code or the template — it would be dropped from both generated modules. Remove it, or use it so the compiler can place it.`,
			rangeOf(source, at),
		),

	invalidRequestContextCall: (source: string, at: Site, name: string) =>
		error(
			'LTC015',
			`\`${name} = requestContext(...)\` must be called with exactly two arguments: the context key and a fallback value. The fallback is what the server renders (ADR 0005 sub-design 15) — there is no ancestor DOM to walk at render time.`,
			rangeOf(source, at),
		),

	contextFallbackNotServerKnown: (
		source: string,
		at: Site,
		name: string,
		names: string[],
	) =>
		error(
			'LTC016',
			`\`${name}\`'s fallback argument references ${names.map(n => `\`${n}\``).join(', ')}, which the server cannot resolve — requestContext()'s fallback must be a literal or an expression over server args/setup, since the server renders using it directly (no ancestor DOM to walk at render time).`,
			rangeOf(source, at),
		),

	unliftableChild: (
		source: string,
		at: Site,
		names: string[],
		exprText: string,
	) =>
		error(
			'LTC017',
			`${names.map(n => `\`${n}\``).join(', ')} ${names.length > 1 ? 'are' : 'is'} passed into a call the compiler cannot see inside, so it cannot tell whether this child is reactive. Wrap it in an explicit thunk: \`{() => ${exprText}}\`.`,
			rangeOf(source, at),
		),

	retiredLazySigil: (source: string, at: Site, exprText: string) =>
		error(
			'TSRX018',
			`The \`&\` sigil in \`&{${exprText}}\` has no meaning in a template child — the compiler decides reactivity itself, and TSRX 0.2 removed the lazy destructuring the sigil once introduced. Drop the sigil: \`{${exprText}}\`.`,
			rangeOf(source, at),
		),

	stringLiteralPropChild: (source: string, at: Site, prop: string) =>
		error(
			'LTC019',
			`\`{'${prop}'}\` names a prop but reads as the literal string "${prop}" — the \`&\` sigil that used to distinguish them is gone. Write the read explicitly: \`{host.${prop}}\`.`,
			rangeOf(source, at),
		),

	// --- React near-miss idioms ---
	reactLogicalJsx: (
		source: string,
		at: Site,
		condText: string,
		exprText: string,
	) =>
		error(
			'TSRX021',
			`\`{${exprText}}\` is the React \`&&\` conditional-render idiom — TSRX has no implicit falsy-renders-nothing rule, so this renders literally instead of conditionally. Use \`@if (${condText}) { … }\` instead.`,
			rangeOf(source, at),
		),

	reactTernaryJsx: (
		source: string,
		at: Site,
		condText: string,
		exprText: string,
	) =>
		error(
			'TSRX022',
			`\`{${exprText}}\` is the React ternary conditional-render idiom — TSRX renders it literally (the chosen branch stringified), not conditionally. Use \`@if (${condText}) { … } @else { … }\` instead.`,
			rangeOf(source, at),
		),

	reactMapJsx: (
		source: string,
		at: Site,
		itemName: string,
		arrayText: string,
		exprText: string,
	) =>
		error(
			'TSRX023',
			`\`{${exprText}}\` is the React \`.map()\` list-render idiom — TSRX renders it literally (the array stringified), not as a loop. Use \`@for (const ${itemName} of ${arrayText}) { … }\` instead.`,
			rangeOf(source, at),
		),

	reactReturnJsx: (source: string, at: Site) =>
		error(
			'TSRX024',
			"`return (…)` is the React component-return idiom — TSRX's output is the setup block's trailing JSX expression itself, not a return value. Drop `return`, keep the `<>…</>` as a bare expression.",
			rangeOf(source, at),
		),

	// --- first()/allselectors ---
	invalidFirstCall: (source: string, at: Site, name: string) =>
		error(
			'LTC025',
			`\`const ${name} = first(…)\` must be called with one or two string literals — a selector alone for an optional reference (\`first('span.badge')\`, yields \`undefined\` when absent), or a selector plus a required-reason string (\`first('input', 'required')\`, throws with that reason) — so the compiler can resolve the reference structurally at compile time.`,
			rangeOf(source, at),
		),

	firstSelectorNotFound: (
		source: string,
		at: Site,
		name: string,
		selector: string,
	) =>
		error(
			'LTC026',
			`\`first('${selector}', …)\` (bound to \`${name}\`) matches no element in this component's template, or uses selector syntax this compiler cannot verify structurally — supported: a tag plus any combination of \`.class\`, \`#id\`, \`[attr]\`/\`[attr="value"]\`, and comma-separated lists. Adjust the selector to match a real, statically-addressable element. A required reference that survives to runtime with no match is \`MissingElementError\`.`,
			rangeOf(source, at),
		),

	malformedSelector: (
		source: string,
		at: Site,
		helper: 'first' | 'all',
		selector: string,
		reason: string,
	) =>
		error(
			'LTC026',
			`\`${helper}('${selector}', …)\` is not a valid CSS selector — ${reason}. \`querySelector\` would throw a SyntaxError on it (InvalidSelectorError at connect); fix the selector.`,
			rangeOf(source, at),
		),

	firstSelectorAmbiguous: (
		source: string,
		at: Site,
		name: string,
		selector: string,
		count: number,
		wording: SurfaceWording,
	) =>
		error(
			'LTC027',
			`\`first('${selector}', …)\` (bound to \`${name}\`) matches ${count} elements in this component's template, and they are not all mutually-exclusive branches of the same ${wording.if} — give the target a distinguishing \`class\`/\`id\`/\`data-*\` and name it in the selector. On a COMPOSED (PascalCase) element the attribute goes on the COMPOSE SITE, not inside the child (LT-127): \`<FormSpinbutton class="lightness" />\` → \`first('form-spinbutton.lightness', …)\`.`,
			rangeOf(source, at),
		),

	childrenReachIn: (
		source: string,
		at: Site,
		helper: 'first' | 'all',
		name: string,
		selector: string,
		unreadable = false,
	) =>
		error(
			'LTC083',
			unreadable
				? `\`${helper}('${selector}', …)\` (bound to \`${name}\`) matches no element in this component's template, and the template inserts children — a selector like this can only resolve inside the content a parent passes, which belongs to the parent (ADR 0026). The roles on the \`children\` prop's type are declared in a shape this compiler cannot read — it reads only an inline type literal or a same-file alias: \`Children<{ … }>\`, or a \`type Roles = { … }\` in this file. Write the roles that way so the compiler can check the selector against them, or address an element the template renders.`
				: `\`${helper}('${selector}', …)\` (bound to \`${name}\`) matches no element in this component's template, and the template inserts children — a selector like this can only resolve inside the content a parent passes, which belongs to the parent (ADR 0026). Declare a role for it on the \`children\` prop's type — \`Children<{ … }>\` — and give the passed element the role's class, or address an element the template renders.`,
			rangeOf(source, at),
		),

	interactiveContentRefused: (
		source: string,
		at: Site,
		childTag: string,
		finding: InteractiveFinding,
	) =>
		error(
			'LTC085',
			finding.kind === 'element'
				? `\`<${childTag}>\` declares its children \`Children<…, 'non-interactive'>\`, but this compose site passes \`${finding.describe}\` — interactive content (ADR 0026). Remove the \`${finding.describe}\` from the passed content, or drop the \`'non-interactive'\` model argument from \`<${childTag}>\`'s \`Children<…>\` type if the content may be interactive.`
				: `\`<${childTag}>\` declares its children \`Children<…, 'non-interactive'>\`, but this compose site passes \`<${finding.tag}>\`, whose template renders interactive content (ADR 0026). Remove \`<${finding.tag}>\` from the passed content, or drop the \`'non-interactive'\` model argument from \`<${childTag}>\`'s \`Children<…>\` type if the content may be interactive.`,
			rangeOf(source, at),
		),

	roleWriterConflict: (
		source: string,
		at: Site,
		parent: WatchBinding,
		childTag: string,
		role: string,
		childWrite: RoleWrite,
	) => {
		const argOf = (write: RoleWrite): string | null => {
			const target = write.target
			if (target.channel === 'name') return `'${target.authored}'`
			if (target.channel === 'class') return `'${target.token}'`
			if (target.channel === 'style') return `'${target.property}'`
			return null
		}
		const parentSpell = `${parent.write.helper}(${parent.ref}${
			argOf(parent.write) ? `, ${argOf(parent.write)}` : ''
		})`
		const childArg = argOf(childWrite)
		const childSpell = `${childWrite.helper}(…${childArg ? `, ${childArg}` : ''})`
		const target = childWrite.target
		const noun =
			target.channel === 'class'
				? 'class token'
				: target.channel === 'style'
					? 'style property'
					: target.channel === 'text'
						? 'text content'
						: childWrite.helper === 'bindAttribute' ||
								childWrite.helper === 'bindAria'
							? 'attribute'
							: 'property'
		const writesOf = (write: RoleWrite): string => {
			const t = write.target
			return t.channel === 'text'
				? 'the text content'
				: `\`${t.channel === 'name' ? t.name : t.channel === 'class' ? t.token : t.property}\``
		}
		const parentWrites = writesOf(parent.write)
		const childWrites = writesOf(childWrite)
		const too = parentWrites === childWrites ? ' too' : ''
		const fix =
			target.channel === 'text'
				? "Change what the passed element renders, or change the child's role binding to leave the text to the parent."
				: `Bind a different ${noun} on the passed element, or change the child's role binding to leave it to the parent.`
		return error(
			'LTC084',
			`\`watch(…, ${parentSpell})\` writes ${parentWrites} on an element passed to \`<${childTag}>\` that carries the \`.${role}\` role class — and \`<${childTag}>\` writes ${childWrites} on \`.${role}\` elements${too}, through its \`${childSpell}\` role binding (ADR 0026): two writers would fight over the same ${noun}. The passed content is yours to bind, and the child acts on it only through the roles it declares. ${fix}`,
			rangeOf(source, at),
		)
	},

	// --- formAssociated surface ---
	reservedExposeName: (source: string, at: Site, member: string) =>
		error(
			'LTC028',
			`\`expose({ ${member}: … })\` names \`${member}\`, a reserved word or Object builtin — it cannot be a reactive property, because defining an accessor for it would shadow a member every object inherits. Rename the prop (e.g. \`${member}Value\`). At connect this is \`InvalidPropertyNameError\`.`,
			rangeOf(source, at),
		),

	managedFormMemberShadowed: (
		source: string,
		at: Site,
		member: string,
		extension: 'formAssociated' | 'formAssociatedCheckbox',
	) =>
		error(
			'LTC028',
			`\`expose({ ${member}: … })\` shadows the \`${member}\` member ${extension}() installs on the prototype — it is managed automatically (form-participation host contract) and cannot be exposed. Remove it, or rename the reactive property if you need something similar under a different name. At connect this is \`InvalidPropertyNameError\`.`,
			rangeOf(source, at),
		),

	formControlHasName: (source: string, at: Site, tag: string) =>
		error(
			'LTC029',
			`<${tag}> is a descendant of a formAssociated() component and carries a \`name\` — it would submit natively AND via the host's \`setFormValue\`, submitting the field twice. Remove \`name\` from <${tag}>; the host element is the sole form participant.`,
			rangeOf(source, at),
		),

	textareaValueAttribute: (source: string, at: Site) =>
		error(
			'LTC030',
			'`<textarea value={…}>` has no effect — `value` is not a real HTML attribute on `<textarea>` (the browser ignores it) and the pre-hydration control renders empty. Set the initial value as text content instead: `<textarea>{value}</textarea>`.',
			rangeOf(source, at),
		),

	// --- binding defaults, impure ambients, loaded-attribute defaults ---
	defaultOnRequiredProp: (source: string, at: Site, name: string) =>
		error(
			'LTC032',
			`Prop \`${name}\` has a default value but its type isn't marked optional — mark it \`${name}?:\` in the props type, or the default is unreachable (omitting \`${name}\` is a type error for any external caller before the default ever applies).`,
			rangeOf(source, at),
		),

	impureStaticChild: (source: string, at: Site) =>
		error(
			'LTC033',
			"This child reads an ambient value (`Date`/`Intl`, a random-number generator such as `Math.random()` or `crypto.randomUUID()`, or a locale/timezone method) with no signal dependency, so it renders exactly once, server-side, at build time, forever — the build machine's clock/locale/timezone/RNG reading gets baked into the page permanently, with no client-side correction. Wrap it in a signal (e.g. `createCell(...)` set from a client-only effect) so it can be a reactive child instead, or move the computation out of the template entirely.",
			rangeOf(source, at),
		),

	impureStaticAttribute: (source: string, at: Site, attrName: string) =>
		error(
			'LTC033',
			`Attribute \`${attrName}\` reads an ambient value (\`Date\`/\`Intl\`, a random-number generator such as \`Math.random()\` or \`crypto.randomUUID()\`, or a locale/timezone method) with no signal dependency, so it is rendered exactly once, server-side, at build time, forever — the build machine's clock/locale/timezone/RNG reading gets baked into the page permanently, with no client-side correction. Make it a reactive thunk (\`${attrName}={() => …}\`, which the client's first binding pass sets) or take the value as a server arg so the caller owns it.`,
			rangeOf(source, at),
		),

	impureLoopItems: (source: string, at: Site) =>
		error(
			'LTC033',
			"This loop's items read an ambient value (`Date`/`Intl`, a random-number generator such as `Math.random()` or `crypto.randomUUID()`, or a locale/timezone method), so the server computes them exactly once, at build time — a shuffle or a generated id is baked into the page permanently, with no client-side correction. Pass the items in as an arg, already in their final order, or hold them in a `createList` and reorder it in the factory, where it runs in the browser.",
			rangeOf(source, at),
		),

	unsafeLoadedAttributeDefault: (source: string, at: Site, name: string) => {
		const stateWord =
			name === 'hidden'
				? 'visible'
				: name === 'disabled'
					? 'enabled AND submittable'
					: name === 'checked'
						? 'unchecked'
						: name === 'selected'
							? 'deselected'
							: 'collapsed'
		return error(
			'LTC034',
			`\`${name}\` has no server-renderable initial value here, and no server phase can resolve this value in any tier — so \`${name}\` is silently OMITTED from the initial HTML. Omission is not neutral for \`${name}\`: it renders the ${stateWord} state regardless of what this expression would actually evaluate to once connected. This is a real submittable form control, so the wrong default is a correctness bug — the control can submit, or fail to, regardless of what the author intended — not just a cosmetic pre-hydration flash. Trace the value to a server-known prop or signal so it can render an initial value, or accept the pre-hydration flash explicitly by giving this element a static/server-rendered default for \`${name}\`.`,
			rangeOf(source, at),
		)
	},

	// --- duplicate ids, import hygiene, duplicated channels ---
	missingRealExportImport: (source: string, at: Site, name: string) =>
		error(
			'LTC036',
			`\`${name}\` is a real '@zeix/le-truc' export used here but never imported — add \`import { ${name} } from '@zeix/le-truc'\` (FactoryContext helpers are ambient and need no import).`,
			rangeOf(source, at),
		),

	contextNameInImport: (source: string, at: Site, name: string) =>
		error(
			'LTC037',
			`\`${name}\` is FactoryContext vocabulary — ambient in this host profile, not a '@zeix/le-truc' export. Remove it from the import (drop the whole line if it's the only named import left).`,
			rangeOf(source, at),
		),

	duplicateComposeId: (source: string, at: Site, id: string, count: number) =>
		error(
			'LTC038',
			`id="${id}" appears on ${count} composed elements — each compose site's id is materialized on that instance's host element, so this is ${count} elements sharing an id in the same document. Give each site a distinct id, or address the instances with a static class instead.`,
			rangeOf(source, at),
		),

	duplicatedPropChannel: (
		source: string,
		at: Site,
		prop: string,
		parser: string,
		formManaged: boolean,
	) =>
		warning(
			'LTC039',
			formManaged
				? `\`${prop}\` is exposed through a Parser (\`${parser}\`, which reads the host attribute) and is ALSO rendered into this component's own markup from the \`${prop}\` arg — the value ships twice, and when the host attribute is absent the Parser's fallback wins and this site's server-rendered content is overwritten on the first binding pass. On a form-associated host \`${prop}\` is the reset baseline (\`default${prop === 'checked' ? 'Checked' : 'Value'}\`) — render the host attribute too (\`<… ${prop}={${prop}}>\`) rather than dropping it; do not stop rendering the value here either, since the baseline attribute alone gives no initial DOM state for the control to mirror.`
				: `\`${prop}\` is exposed through a Parser (\`${parser}\`, which reads the host attribute) and is ALSO rendered into this component's own markup from the \`${prop}\` arg — the value ships twice, and when the host attribute is absent the Parser's fallback wins and this site's server-rendered content is overwritten on the first binding pass. Harvest it from the site instead (\`expose({ ${prop}: <ref read> })\`, HOST_PROFILE § data account) and drop the attribute, or stop rendering the value here.`,
			rangeOf(source, at),
		),

	// --- reference identity and per-instance ids ---
	deadRequiredReason: (
		source: string,
		at: Site,
		name: string,
		selector: string,
	) =>
		warning(
			'LTC040',
			`\`const ${name} = first('${selector}', …)\` is declared REQUIRED, but its only match in this template sits inside a branch that may not render — the client addresses it with an existence guard either way, so the required-reason string is never thrown. Drop it (\`first('${selector}')\`) to say optional outright. For a template-owning component the compiler controls the markup, so a required-reason only earns its keep on a selector that may match markup this component did not itself render.`,
			rangeOf(source, at),
		),

	firstSelectorDuplicate: (
		source: string,
		at: Site,
		name: string,
		selector: string,
		existing: string,
		/** The `first()` declaration of `existing`, related (ADR 0022 s1). */
		existingAt?: Site,
	): LocalDiagnostic => {
		const reported = error(
			'LTC041',
			`\`first('${selector}', …)\` (bound to \`${name}\`) resolves to the same element as \`${existing}\` — two names for one element. Only one of them would become a query and the other would be undefined at runtime. Use \`${existing}\` in both places, or give the two elements distinguishing \`class\`/\`id\`/\`data-*\` attributes and address them separately.`,
			rangeOf(source, at),
		)
		if (existingAt?.start !== undefined)
			reported.related = [rangeOf(source, existingAt)]
		return reported
	},

	staticIdInTemplate: (source: string, at: Site, tag: string, id: string) =>
		warning(
			'LTC042',
			`\`<${tag} id="${id}">\` is a constant \`id\` in a template — it duplicates the moment a page places this component twice, and any \`aria-labelledby\`/\`aria-describedby\`/\`<label for>\` pointing at it resolves to the FIRST instance. Take the id as a server arg with a default instead (\`{ ${sanitizeArgName(id)} = '${id}' }\`) and render it as \`id={${sanitizeArgName(id)}}\`, so whoever instantiates the component owns the value; wire every reference from that same arg.`,
			rangeOf(source, at),
		),

	// --- signal initializer shapes ---
	conditionalSignalConstructor: (source: string, at: Site, name: string) =>
		error(
			'LTC044',
			`\`${name}\`'s initializer conditionally chooses between two signal-constructor calls — a signal must be a single, unconditional call to a recognized constructor (createCell/createState/deriveCell/…). Move the condition inside the callback instead (e.g. \`deriveCell(() => cond ? a : b)\`).`,
			rangeOf(source, at),
		),

	deferredCollectorCall: (source: string, at: Site, helper: string) =>
		error(
			'LTC045',
			`\`${helper}(…)\` is called from inside a callback — it collects an effect descriptor into the factory's ambient collector, which is gone by the time a deferred callback runs, so this throws NoActiveCollectorError at connect (contained per ADR 0007, so the effect silently never activates). Call \`${helper}(…)\` directly in setup and make the callback's condition part of the effect instead (e.g. \`watch(() => cond ? … : …, sink)\`).`,
			rangeOf(source, at),
		),

	renderedClientOnlyConst: (
		source: string,
		at: Site,
		name: string,
		badNames: string[],
	) =>
		error(
			'LTC046',
			`The server render evaluates \`${name}\` — in the markup or in an \`expose()\` initializer — but its initializer reads ${codeList(badNames)}, which ${badNames.length === 1 ? 'exists' : 'exist'} only on the client. No tier can produce that value, so the site renders wrong or stays empty, and no client binding corrects a static value. Compute \`${name}\` from a server arg or a signal instead, or make each site that reads it reactive (a thunk, for example \`title={() => …}\`), so the client's first binding pass supplies the value.`,
			rangeOf(source, at),
		),

	// --- i18n and the tier-1 prevented surface ---
	untranslatedLiteral: (source: string, at: Site, sample: string) =>
		warning(
			'LTC047',
			`Literal prose \`${sample}\` is written directly in the template of a component that declares \`export const i18n\` — no locale can translate it. Add a message key with this text as its source-locale value to \`export const i18n\`, and render \`{t.<key>}\` here; the translation census then reports each locale that lacks the key.`,
			rangeOf(source, at),
		),

	unparseableMessage: (source: string, at: Site, key: string, reason: string) =>
		error(
			'LTC055',
			`The source message \`${key}\` in \`export const i18n\` is not a supported ICU MessageFormat 1 pattern: ${reason}. The source locale has no fallback, so the build cannot render it. Correct the pattern: quote a literal \`{\`, \`}\` or \`#\` with apostrophes (\`'{'\`), and double a literal apostrophe (\`''\`).`,
			rangeOf(source, at),
		),

	messageArgumentMismatch: (
		source: string,
		at: Site,
		key: string,
		problem: string,
		fix: string,
	) => error('LTC055', `\`t.${key}\` ${problem}. ${fix}`, rangeOf(source, at)),

	duplicateTag: (
		tag: string,
		sources: ReadonlyArray<string>,
		at: DiagnosticLocation,
		related: DiagnosticLocation[],
	): CompileDiagnostic =>
		corpusError(
			'LTC048',
			`Component tag \`${tag}\` is declared by more than one corpus source: ${sources.join(', ')}. A tag has one owner, whatever surface it is written in — only a variant set shares a tag, and a variant set is at most one source per surface (\`.tsrx\`, \`.tsx\`) with one base name in one folder. Delete the extra same-surface source, move the spellings into one folder under one base name, or rename the tag of one source.`,
			at,
			related,
		),

	variantCssDrift: (
		tag: string,
		sources: ReadonlyArray<string>,
		at: DiagnosticLocation,
		related: DiagnosticLocation[],
	): CompileDiagnostic =>
		corpusError(
			'LTC051',
			`Variant set \`${tag}\` compiles to different CSS across its members: ${sources.join(', ')} — the build writes one stylesheet for the whole set, so it wrote no artifact of the set. Make the styles of every member byte-identical: copy the styles of the served member into the others.`,
			at,
			related,
		),

	badFactoryContextParam: (
		source: string,
		at: Site,
		bad: ReadonlyArray<string>,
	) =>
		error(
			'LTC049',
			`The factory-context parameter destructures ${codeList(bad)}, which ${bad.length === 1 ? 'is' : 'are'} not FactoryContext vocabulary — the generated client destructures the same names from its own factory context, where ${bad.length === 1 ? 'it does' : 'they do'} not exist. Destructure only ${codeList(['host', 'first', 'all', 'expose', 'watch', 'on', 'pass', 'internals', 'requestContext', 'provideContexts'])}, for example \`, { host, expose }: FactoryContext<Props>\`.`,
			rangeOf(source, at),
		),

	formContextMismatch: (
		source: string,
		annotation: Site,
		annotated: 'FactoryContext' | 'FormFactoryContext',
	) =>
		error(
			'LTC050',
			annotated === 'FactoryContext'
				? `This component sets \`config.formAssociated\` but annotates its factory context as \`FactoryContext\`, so \`host\` lacks the managed form members the element carries. Annotate \`FormFactoryContext<Props>\` instead — its \`host\` is \`FormAssociatedElement & Props\`.`
				: `This component annotates its factory context as \`FormFactoryContext\` but does not set \`config.formAssociated\`, so \`host\` claims form members the element does not carry. Annotate \`FactoryContext<Props>\` instead, or set \`config.formAssociated\` if the component takes part in forms.`,
			rangeOf(source, annotation),
		),

	// --- Stylesheet grammar ---

	malformedStyleSheet: (source: string, at: Site, detail: string) =>
		error(
			'LTC064',
			`The component's stylesheet does not parse (${detail}) — the compiler cannot scope or emit a sheet it cannot read. Correct the CSS syntax.`,
			rangeOf(source, at),
		),

	unknownCssProperty: (source: string, at: Site, property: string) =>
		warning(
			'LTC065',
			`\`${property}\` is not a CSS property the compiler knows — a browser drops a declaration it does not recognize. Correct the name if it is a typo. If the property is newer than the compiler's CSS dictionary, ignore this warning: the declaration ships as written.`,
			rangeOf(source, at),
		),

	invalidCssValue: (
		source: string,
		at: Site,
		property: string,
		value: string,
	) =>
		warning(
			'LTC065',
			`The value \`${value}\` does not match the grammar of \`${property}\` that the compiler knows — a browser drops a declaration whose value it does not accept. Correct the value if it is a mistake. If the value is newer than the compiler's CSS dictionary, ignore this warning: the declaration ships as written.`,
			rangeOf(source, at),
		),

	// --- Platform-CSS stylesheet contract ---
	ownTagLedRule: (source: string, at: Site, tag: string) =>
		error(
			'LTC066',
			`A rule inside \`@scope\` is led by the component's own tag \`${tag}\` — a \`@scope\` rule starts at the host's descendants, so the tag matches only a nested \`<${tag}>\`, never the host. Write \`:where(:scope)\` for the host, and drop the tag from selectors for the component's own content.`,
			rangeOf(source, at),
		),

	hostSelector: (source: string, at: Site) =>
		error(
			'LTC086',
			'`:host` matches nothing in a compiled component — it names the root of a shadow tree, and a compiled component renders light DOM. Write `:where(:scope)` for the host inside `@scope { … }`: `:host { … }` becomes `:where(:scope) { … }`, and `:host(.x)` becomes `:where(:scope).x`.',
			rangeOf(source, at),
		),

	slottedInLightDom: (source: string, at: Site) =>
		error(
			'LTC067',
			"`::slotted()` cannot match in a compiled component: it addresses slotted content, which exists only inside a shadow root, and a compiled component renders light DOM — composed children are real children, not slotted nodes. Style a composed child's host element by its tag, and let the child style its own internals.",
			rangeOf(source, at),
		),

	hostContextSelector: (source: string, at: Site) =>
		error(
			'LTC068',
			'`:host-context()` is removed from the CSS spec and matched by no browser, so the rule could never apply. Theme the component by ancestor through inheritance and custom properties instead — custom properties cross every boundary.',
			rangeOf(source, at),
		),

	deadByLimit: (source: string, at: Site, selector: string, limit: string) =>
		error(
			'LTC071',
			`The selector \`${selector}\` reaches inside \`${limit}\`, which a \`to (…)\` limit of this \`@scope\` block excludes — the limit always excludes the rule's subject, so the rule matches nothing. Style an element above the limit instead, and pass values inward with custom properties. If the rule must reach inside, remove the limit.`,
			rangeOf(source, at),
		),

	globalSelector: (source: string, at: Site) =>
		error(
			'LTC069',
			'`:global` has no meaning in a compiled stylesheet — a rule at the top level, outside `@scope`, already applies page-wide. Remove the wrapper, and move the rule to the top level of the stylesheet.',
			rangeOf(source, at),
		),

	downwardLeak: (
		source: string,
		at: Site,
		selector: string,
		children: readonly string[],
	) => {
		const tags = children.map(tag => `<${tag}>`)
		const named =
			tags.length > 1
				? `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`
				: (tags[0] ?? '')
		const limits = children.map(tag => `${tag} > *`).join(', ')
		return warning(
			'LTC087',
			`The selector \`${selector}\` can match elements inside ${named}, which this component composes — a \`@scope\` rule reaches every descendant of the host, a composed child's own markup included. Add \`${limits}\` to the block's limits, \`@scope to (${limits}) { … }\`, to stop the rule below the child's host. If the rule styles the child's internals on purpose, ignore this warning: the CSS ships as written.`,
			rangeOf(source, at),
		)
	},

	unscopedRule: (source: string, at: Site, selector: string, tag: string) =>
		warning(
			'LTC088',
			`The rule \`${selector}\` sits outside \`@scope\` and is not led by the component's tag \`${tag}\` — a top-level rule applies to the whole page. Move it into the \`@scope { … }\` block, or lead it with the tag (\`${tag} ${selector}\`). If the page owns the rule, move it to the page's stylesheet. If the component owns it (for example, a class its own script sets on \`body\`), keep it here and ignore this warning: the CSS ships as written.`,
			rangeOf(source, at),
		),

	scopeNotLowerable: (
		source: string,
		at: Site,
		face: 'nested-scope' | 'scope-in-limit',
		targets: string,
	) =>
		error(
			'LTC089',
			`${
				face === 'nested-scope'
					? 'A `@scope` inside the component `@scope` has no flat-selector form'
					: 'A `to (…)` limit that names `:scope` or `&` has no flat-selector form'
			} — the configured CSS targets (${targets}) have no native \`@scope\`, so the compiler must lower the sheet. Write the sheet without it, or raise \`cssTargets\` in \`le-truc.config.json\` to browsers with native \`@scope\` (Chrome 118, Firefox 128, Safari 17.4).`,
			rangeOf(source, at),
		),
}
