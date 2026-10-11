import {
	type AstNode,
	asArray,
	freeIdentifiers,
	getterObjectName,
	identifierName,
	isGetterMember,
	isNode,
	text,
} from './ast-utils'
import { diagnostic } from './diagnostics'
import type { ExtractContext } from './extract-context'
import { staticMessageReads } from './i18n'
import { inferType, type TypeContext } from './infer-type'
import type {
	DeclaredSignalIR,
	DerivedSignalIR,
	ExposeKind,
	ExposePropDecl,
	ExposeStmt,
	HarvestSeedIR,
	InitSignalIR,
	ItemSetupStmt,
	ListItemIR,
	SetupStmt,
	SignalIR,
	SourceRange,
} from './ir'
import { type HarvestCall, harvestCallOf, resolveListItem } from './list-item'
import { type Resolution, rangeFields, resolutionOf } from './tier'
import {
	CLIENT_ONLY_PRIMITIVES,
	CONTEXT_NAMES,
	JS_GLOBALS,
	MANAGED_TEXT_PROPS,
	MUTABLE_SIGNAL_CONSTRUCTORS,
	PARSER_FACTORIES,
	SCALAR_HARVEST_CONSTRUCTORS,
	SIGNAL_CONSTRUCTORS,
} from './vocabulary'

/** One `const name = first(selector, required?)` element reference. */
export type ElementRefEntry = {
	selectorText: string
	reasonText: string | null
	maybe: boolean
	node: AstNode
}

export type SetupExtraction = {
	setup: SetupStmt[]
	clientSetup: SetupStmt[]
	plainSetup: SetupStmt[]
	signals: SignalIR[]
	signalByName: Map<string, SignalIR>
	setupInits: Map<string, AstNode>
	elementRefs: Map<string, ElementRefEntry>
	expose: ExposeStmt | null
	exposeProps: Map<string, ExposePropDecl>
	contextRefs: Set<string>
	/** The authored import bindings the client gate admitted. */
	importedNames: ReadonlySet<string>
	/** The client message channel the client gate admitted. */
	messages: {
		tNames: ReadonlySet<string>
		declaredKeys: Readonly<Record<string, string>>
	}
}

/** Shared empty result for the `parserFallbackRefsOf` context hook. */
const EMPTY_NAMES: ReadonlySet<string> = new Set<string>()

/** Which phase binds a name an item's setup statement reads. */
type ItemNameClass = 'both' | 'client' | 'server' | 'unknown'

/** A list of names as message copy: `` `a` and `b` ``. */
const nameList = (names: readonly string[]): string =>
	names.map(n => `\`${n}\``).join(' and ')

/** The setup refusal component setup reports, verbatim. */
const setupStatementRefusal = (ctx: ExtractContext, stmt: AstNode) =>
	diagnostic.unsupported(
		ctx.source,
		stmt,
		'A setup statement other than a `const` declaration, `expose()` or a client-only side effect over `host`, `internals` or signals',
		'Move the logic into a `const` initializer, or into a `watch()` or `on()` handler.',
	)

/** A `harvest()` marker call in a setup declaration's seed position: the map form on a `createList` seed, the scalar form on a scalar signal constructor's seed; null when the statement declares nothing or the seed is no marker call. */
const seedHarvestOf = (
	ctx: ExtractContext,
	stmt: AstNode,
	enclosing: Iterable<string> = [],
): { constructor: string; call: HarvestCall } | null => {
	if (stmt.type !== 'VariableDeclaration') return null
	const init = asArray(stmt.declarations)[0]?.init as AstNode | undefined
	if (!isNode(init)) return null
	const callee = identifierName(init.callee)
	if (
		!callee ||
		(callee !== 'createList' && !SCALAR_HARVEST_CONSTRUCTORS.has(callee))
	)
		return null
	const call = harvestCallOf(ctx, asArray(init.arguments)[0], enclosing)
	return call ? { constructor: callee, call } : null
}

/** The refusal for a `harvest()` call the compiler does not consume. */
const misplacedHarvest = (
	ctx: ExtractContext,
	stmt: AstNode,
	subject: string,
) =>
	diagnostic.unsupported(
		ctx.source,
		stmt,
		subject,
		'`harvest()` declares the parser a client harvest reads a server-rendered seed through, so the compiler reads it only as the seed of a component-setup `createList()` or a scalar signal declaration — call it there, or drop it.',
	)

/** A component-setup signal declaration with the marker read through: the server's statement text and node name `seed` where the call was, with source slices around the cut; the call itself stays on the signal for the client to splice the harvest read over. */
const readThroughHarvest = (
	source: string,
	stmt: AstNode,
	init: AstNode,
	harvest: { call: AstNode; seed: AstNode },
): {
	init: AstNode
	text: string
	slices: NonNullable<SetupStmt['slices']>
} => {
	const { call } = harvest
	const stmtStart = stmt.start as number
	const callStart = call.start as number
	const callEnd = call.end as number
	const before = source.slice(stmtStart, callStart)
	const seedText = text(source, harvest.seed)
	const after = source.slice(callEnd, stmt.end as number)
	return {
		init: {
			...init,
			arguments: [harvest.seed, ...asArray(init.arguments).slice(1)],
		},
		text: `${before}${seedText}${after}`,
		slices: [
			{ text: before, start: stmtStart },
			{ text: seedText, start: harvest.seed.start as number },
			{ text: after, start: callEnd },
		],
	}
}

/** Is `node` a function expression (an initializer defined, not called)? */
const isFunctionNode = (node: unknown): node is AstNode =>
	isNode(node) && /Function(Expression)?$/.test(String(node.type))

/** A `first()` call's parsed literal arguments, as both setup loops record them. */
type FirstCallRef = {
	selectorText: string
	reasonText: string | null
	maybe: boolean
}

/** The single-initialized-`const` guard both setup loops share: the first declaration's name and initializer, or null after reporting the refusal. */
const singleConstDeclOf = (
	ctx: ExtractContext,
	stmt: AstNode,
): { name: string; init: AstNode } | null => {
	if (stmt.type !== 'VariableDeclaration') return null
	const declarations = asArray(stmt.declarations)
	const decl = declarations[0] ?? null
	const name = identifierName(decl?.id)
	if (
		stmt.kind !== 'const' ||
		declarations.length !== 1 ||
		!name ||
		!isNode(decl?.init)
	) {
		ctx.diagnostics.push(
			diagnostic.unsupported(
				ctx.source,
				stmt,
				'A setup declaration other than a single initialized `const`',
				'Declare one initialized `const` per statement.',
			),
		)
		return null
	}
	return { name, init: (decl as AstNode).init as AstNode }
}

/** Parse a `first(selector, required?)` call's literal arguments and validate the arity: one literal (a selector alone) is the OPTIONAL form, two (selector + required-reason) the required form, anything else LTC025. */
const firstCallOf = (
	ctx: ExtractContext,
	stmt: AstNode,
	init: AstNode,
	name: string,
): FirstCallRef | null => {
	const args = asArray(init.arguments)
	const [selectorArg, reasonArg] = args
	const selectorText =
		selectorArg?.type === 'Literal' && typeof selectorArg.value === 'string'
			? selectorArg.value
			: null
	const reasonText =
		reasonArg?.type === 'Literal' && typeof reasonArg.value === 'string'
			? reasonArg.value
			: null
	const validArity = args.length === 1 || args.length === 2
	if (
		!validArity ||
		selectorText === null ||
		(args.length === 2 && reasonText === null)
	) {
		ctx.diagnostics.push(diagnostic.invalidFirstCall(ctx.source, stmt, name))
		return null
	}
	return { selectorText, reasonText, maybe: args.length === 1 }
}

/** Refuse a ternary between two signal-constructor calls — with no single `.callee` the loop recognizes no signal — rather than silently treating it as an ordinary setup const. */
const refuseConditionalSignalConstructor = (
	ctx: ExtractContext,
	stmt: AstNode,
	init: AstNode,
	name: string,
): boolean => {
	const consequentName = identifierName(
		(init.consequent as AstNode | undefined)?.callee,
	)
	const alternateName = identifierName(
		(init.alternate as AstNode | undefined)?.callee,
	)
	if (
		consequentName &&
		SIGNAL_CONSTRUCTORS.has(consequentName) &&
		alternateName &&
		SIGNAL_CONSTRUCTORS.has(alternateName)
	) {
		ctx.diagnostics.push(
			diagnostic.conditionalSignalConstructor(ctx.source, stmt, name),
		)
		return true
	}
	return false
}

/** The signal IR both loops build from a recognized signal-constructor call: mutable constructors declare a Slot-backed signal, the rest derive one. */
const signalIROf = (
	base: {
		name: string
		text: string
		textStart: number
		init: AstNode | null
		inferredType: 'string' | 'number' | 'boolean' | 'unknown'
	},
	callee: string,
	declared: { listItem?: ListItemIR; harvest?: HarvestSeedIR } = {},
	derived: { unresolvable?: true } = {},
): InitSignalIR =>
	MUTABLE_SIGNAL_CONSTRUCTORS.has(callee)
		? {
				...base,
				family: 'declared',
				constructor: callee as DeclaredSignalIR['constructor'],
				...declared,
			}
		: {
				...base,
				family: 'derived',
				constructor: callee as DerivedSignalIR['constructor'],
				...derived,
			}

/** Why a `createSensor(start, options)` call has no server value, or null when it has one: the `value` seed is the server value, so a sensor without a resolvable one is unresolvable. */
const sensorSeedResolution = (
	options: unknown,
): Extract<Resolution, { by: 'none' }> | null => {
	const seed =
		isNode(options) && options.type === 'ObjectExpression'
			? asArray(options.properties).find(
					(p): p is AstNode =>
						isNode(p) &&
						p.type === 'Property' &&
						!p.computed &&
						identifierName(p.key) === 'value',
				)?.value
			: undefined
	if (!isNode(seed))
		return {
			by: 'none',
			limb: 'not-a-server-fact',
			reason:
				'has no `{ value }` seed, so its first value comes from a client source after connect',
		}
	const resolution = resolutionOf(seed, EMPTY_NAMES)
	return resolution.by === 'none' ? resolution : null
}

/** Which of `#setAccessor`'s three landings an `expose()` initializer takes — see `ExposeKind`. One-sided on purpose: everything unrecognized classifies as `slot`, the answer that raises no diagnostic. */
const classifyExposeInit = (
	value: unknown,
	signalByName: ReadonlyMap<string, SignalIR>,
): ExposeKind => {
	if (!isNode(value)) return 'slot'
	// `defineMethod(…)` → a plain member; `asString(…)` and friends → the Parser's RESULT reaches `#setAccessor`, so a Parser is Slot-backed.
	if (value.type === 'CallExpression') {
		const callee = identifierName(value.callee)
		if (callee === 'defineMethod') return 'method'
		return 'slot'
	}
	// `sig.get` — a bare function, so `deriveCell` wraps it read-only however mutable `sig` is.
	if (isGetterMember(value)) return 'computed'
	if (
		value.type === 'ArrowFunctionExpression' ||
		value.type === 'FunctionExpression'
	)
		return 'computed'
	// `{ get, set }` is a SlotDescriptor; a `get`-only object literal can never be written through, so it is reported as read-only.
	if (value.type === 'ObjectExpression') {
		const keys = asArray(value.properties)
			.filter(prop => prop.type === 'Property')
			.map(prop => identifierName(prop.key))
		if (keys.includes('get')) return keys.includes('set') ? 'slot' : 'computed'
		return 'slot'
	}
	// A bare signal identifier: mutable constructors give a Slot, derived ones do not.
	if (value.type === 'Identifier') {
		const signal = signalByName.get(identifierName(value) ?? '')
		if (signal) return signal.family === 'declared' ? 'slot' : 'computed'
	}
	return 'slot'
}

export const extractSetup = (
	ctx: ExtractContext,
	setupStmts: AstNode[],
	paramsNode: AstNode | null,
	paramNames: ReadonlySet<string>,
	importedNames: ReadonlySet<string>,
	messages: {
		tNames: ReadonlySet<string>
		declaredKeys: Readonly<Record<string, string>>
	} = { tNames: new Set(), declaredKeys: {} },
): SetupExtraction => {
	const source = ctx.source
	const setup: SetupStmt[] = []
	const clientSetup: SetupStmt[] = []
	// Plain (non-signal) setup consts: `component.setup` is emitted verbatim into the SERVER module only — this subset also needs emitting into the CLIENT factory, since a plain const is documented as available in both. Signals (already client-emitted via harvest) and `expose()` (already client-emitted separately) are excluded.
	const plainSetup: SetupStmt[] = []
	const signals: SignalIR[] = []
	const signalByName = new Map<string, SignalIR>()
	const setupInits = new Map<string, AstNode>()
	/** `const name = first(selector, required)` declarations, pending post-lowering resolution in `resolveTemplateOutput`. */
	const elementRefs = new Map<string, ElementRefEntry>()
	let expose: ExposeStmt | null = null
	const exposeProps = new Map<string, ExposePropDecl>()
	const exposeAmbients = new Set<string>()
	const contextRefs = new Set<string>()
	const typeCtx: TypeContext = { paramsNode, setupInits }
	for (const stmt of setupStmts) {
		// A `harvest()` seed is consumed here; any other reference to the marker is the unclaimed-marker sweep's.
		const seedHarvest = seedHarvestOf(ctx, stmt)
		if (seedHarvest?.call.form === 'malformed') {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					source,
					seedHarvest.call.call,
					seedHarvest.call.what,
					seedHarvest.call.fix,
				),
			)
			continue
		}
		// A marker form mismatched to its constructor is refused, read through (neither generated module sees the marker), and recorded on nothing — the signal keeps its plain seed.
		if (
			seedHarvest &&
			(seedHarvest.call.form === 'list'
				? seedHarvest.constructor !== 'createList'
				: seedHarvest.constructor === 'createList')
		) {
			const { marker } = seedHarvest.call
			const [what, fix] =
				seedHarvest.call.form === 'scalar'
					? [
							'A scalar `harvest(seed, parser)` on a `createList` seed',
							'The scalar form declares the parser of a scalar signal seed; a list takes the map form — `harvest(seed, { field: parser, … })` — or no marker at all.',
						]
					: [
							`A \`harvest(seed, { … })\` map on a \`${seedHarvest.constructor}\` seed`,
							'The map declares the field parsers of a list item; a scalar seed declares one parser — `createState(harvest(seed, parser))`.',
						]
			ctx.diagnostics.push(
				diagnostic.unsupported(source, marker.call, what, fix),
			)
		}
		if (stmt.type === 'VariableDeclaration') {
			const single = singleConstDeclOf(ctx, stmt)
			if (!single) continue
			const { name: declName, init: authoredInit } = single
			// A `harvest()` seed is read through to its seed for every consumer of the statement; the signal keeps the marker call.
			const readThrough = seedHarvest
				? readThroughHarvest(source, stmt, authoredInit, {
						call: seedHarvest.call.marker.call,
						seed: seedHarvest.call.seed,
					})
				: null
			const init = readThrough?.init ?? authoredInit
			// `first(selector, required)` element reference: it doesn't exist server-side, so it must never reach `setup`/`setupInits`/`serverKnown` — a name known there but never actually declared server-side would suppress the `expose.argNode` `any`-stub below for a name that genuinely needs it. Handled entirely separately, before the generic push/set below.
			if (identifierName(init.callee) === 'first') {
				const firstRef = firstCallOf(ctx, stmt, init, declName)
				if (firstRef) elementRefs.set(declName, { ...firstRef, node: init })
				continue
			}
			setupInits.set(declName, init)
			const setupStmt: SetupStmt = {
				text: readThrough?.text ?? text(ctx.source, stmt),
				range: {
					start: typeof stmt.start === 'number' ? stmt.start : 0,
					end: typeof stmt.end === 'number' ? stmt.end : 0,
				},
				node: init,
				name: declName,
				...(readThrough ? { slices: readThrough.slices } : {}),
			}
			setup.push(setupStmt)
			// This statement is bound for the SERVER render function too, so a non-function initializer reading a `first()`-bound ref evaluates where no DOM exists — reported at the push because it holds for every initializer shape alike. A FUNCTION initializer is exempt: defined but never called server-side, so its ref reads never evaluate.
			if (!isFunctionNode(init)) {
				const refReads = [...freeIdentifiers(init)]
					.filter(n => elementRefs.has(n))
					.sort()
				if (refReads.length > 0) {
					// A ROUTING SIGNAL, not a diagnostic: the realm has a real DOM, so the ref read the value harness could not evaluate is exactly what phase 2 answers — the component routes Simulated so the tier-aware emit drops the statement from the server module instead of refusing the file.
					ctx.routingSignals.push({
						origin: 'LTC043',
						detail: `\`${declName}\` reads element ref(s) ${refReads.join(', ')} in setup`,
						...rangeFields(source, stmt),
						resolution: { by: 'realm' },
					})
				}
			}
			const calleeName = identifierName(init.callee)
			if (calleeName === 'requestContext') {
				// Consumer side of the context protocol: `requestContext` has no server behavior at all (it dispatches a DOM event against `host`), so the server substitutes the fallback argument as the signal's render-time value instead of running the call; the fallback must therefore be resolvable with what's server-known so far.
				const args = asArray(init.arguments)
				if (args.length !== 2) {
					ctx.diagnostics.push(
						diagnostic.invalidRequestContextCall(source, stmt, declName),
					)
				} else {
					const fallbackNode = args[1] as AstNode
					const knownSoFar = new Set([...paramNames, ...setupInits.keys()])
					const badFallbackNames = [...freeIdentifiers(fallbackNode)].filter(
						n => !JS_GLOBALS.has(n) && !knownSoFar.has(n),
					)
					if (badFallbackNames.length > 0) {
						ctx.diagnostics.push(
							diagnostic.contextFallbackNotServerKnown(
								source,
								stmt,
								declName,
								badFallbackNames,
							),
						)
					} else {
						const signal: SignalIR = {
							name: declName,
							text: text(ctx.source, init),
							textStart: typeof init.start === 'number' ? init.start : 0,
							family: 'context',
							constructor: 'requestContext',
							fallback: fallbackNode,
							inferredType: inferType(fallbackNode, typeCtx),
							fallbackText: text(ctx.source, fallbackNode),
						}
						signals.push(signal)
						signalByName.set(declName, signal)
						contextRefs.add('requestContext')
					}
				}
			} else if (calleeName && SIGNAL_CONSTRUCTORS.has(calleeName)) {
				const args = asArray(init.arguments)
				const computeArg = args[0] ?? null
				// deriveCell/deriveStore/createMemo invoke their compute function synchronously at server-render time too — a host/internals read inside it would crash, since every signal declaration is re-emitted verbatim into both modules.
				const isDerivedCallback =
					(calleeName === 'deriveCell' ||
						calleeName === 'deriveStore' ||
						calleeName === 'createMemo') &&
					isFunctionNode(computeArg)
				const badContextNames = isDerivedCallback
					? [...freeIdentifiers(computeArg as AstNode)].filter(n =>
							CONTEXT_NAMES.has(n),
						)
					: []
				if (badContextNames.length > 0) {
					// A ROUTING SIGNAL, not a diagnostic — `host`/`internals` resolve in the realm, which is the whole difference between the harness and phase 2. Registered as a plain setup const, so the generated CLIENT module emits it when its name is needed while the Simulated-tier server module drops it.
					plainSetup.push(setupStmt)
					ctx.routingSignals.push({
						origin: 'LTC013',
						detail: `\`${declName}\`'s ${calleeName}() compute reads ${badContextNames.join('/')}`,
						...rangeFields(source, stmt),
						resolution: resolutionOf(init, ctx.serverKnown),
					})
				} else {
					const base = {
						name: declName,
						text: text(ctx.source, init),
						textStart: typeof init.start === 'number' ? init.start : 0,
						init: computeArg,
						inferredType: inferType(computeArg, typeCtx),
					}
					// A sensor's server value is its `{ value }` seed; without one — or with one no server phase can answer — every read is unresolvable: the sensor stays out of `serverKnown`, so each read site is omitted.
					const sensorResolution =
						calleeName === 'createSensor' ? sensorSeedResolution(args[1]) : null
					if (sensorResolution)
						ctx.routingSignals.push({
							origin: 'LTC013',
							detail: `\`${declName}\`'s createSensor() has no server value`,
							...rangeFields(source, stmt),
							resolution: sensorResolution,
						})
					// A list's item type and `harvest()` map feed the per-field harvest of an arg-seeded list; a scalar signal's `harvest()` parser feeds its text/attr harvest. A mismatched form records nothing.
					const matchedMarker =
						seedHarvest && seedHarvest.constructor === calleeName
							? seedHarvest.call.marker
							: null
					const listFields =
						calleeName === 'createList'
							? {
									listItem: resolveListItem(
										ctx,
										init,
										computeArg,
										paramsNode,
										paramNames,
									),
									...(matchedMarker?.kind === 'list'
										? { harvest: matchedMarker }
										: {}),
								}
							: matchedMarker?.kind === 'scalar'
								? { harvest: matchedMarker }
								: {}
					const signal = signalIROf(
						base,
						calleeName,
						listFields,
						sensorResolution ? { unresolvable: true as const } : {},
					)
					signals.push(signal)
					signalByName.set(declName, signal)
				}
			} else if (init.type === 'ConditionalExpression') {
				if (!refuseConditionalSignalConstructor(ctx, stmt, init, declName))
					plainSetup.push(setupStmt)
			} else {
				plainSetup.push(setupStmt)
				// A plain setup const calling a client-only primitive directly — the value harness cannot run it. A ROUTING SIGNAL, not a diagnostic: the const already sits in `plainSetup`, so the generated CLIENT module emits it when needed and the Simulated-tier server module drops it.
				const badPrimitives = [...freeIdentifiers(init)]
					.filter(n => CLIENT_ONLY_PRIMITIVES.has(n))
					.sort()
				if (badPrimitives.length > 0) {
					ctx.routingSignals.push({
						origin: 'LTC013',
						detail: `\`${declName}\` calls client-only primitive(s) ${badPrimitives.join(', ')}`,
						...rangeFields(source, stmt),
						resolution: resolutionOf(init, ctx.serverKnown),
					})
				}
			}
			continue
		}
		// React's component-return idiom: the template is the surface module's output expression, not a `return` in setup — diagnosed with a dedicated fix-it rather than the generic message below.
		if (
			stmt.type === 'ReturnStatement' &&
			isNode((stmt as AstNode).argument) &&
			['JSXElement', 'JSXFragment'].includes(
				String(((stmt as AstNode).argument as AstNode).type),
			)
		) {
			ctx.diagnostics.push(diagnostic.reactReturnJsx(source, stmt))
			continue
		}
		const clientKnownName = (freeName: string): boolean => {
			if (JS_GLOBALS.has(freeName)) return true
			if (CONTEXT_NAMES.has(freeName)) {
				contextRefs.add(freeName)
				return true
			}
			if (signalByName.has(freeName)) return true
			if (exposeAmbients.has(freeName)) return true
			if (elementRefs.has(freeName)) return true
			if (setupInits.has(freeName)) return true
			if (importedNames.has(freeName)) return true
			if (CLIENT_ONLY_PRIMITIVES.has(freeName)) {
				contextRefs.add(freeName)
				return true
			}
			return false
		}
		const expression =
			stmt.type === 'ExpressionStatement'
				? (stmt.expression as AstNode | undefined)
				: undefined
		if (
			stmt.type === 'ExpressionStatement' &&
			identifierName(expression?.callee) === 'expose'
		) {
			const exposeText = text(ctx.source, expression as AstNode)
			const exposeRange: SourceRange = {
				start:
					typeof (expression as AstNode).start === 'number'
						? ((expression as AstNode).start as number)
						: 0,
				end:
					typeof (expression as AstNode).end === 'number'
						? ((expression as AstNode).end as number)
						: 0,
			}
			// prop → signal from expose({ prop: signal.get })
			const arg = asArray(expression?.arguments)[0] ?? null
			expose = {
				text: exposeText,
				range: exposeRange,
				argNode: arg,
				ambients: [],
			}
			setup.push({
				text: exposeText,
				range: exposeRange,
				node: arg ?? (expression as AstNode),
				name: null,
			})
			for (const name of freeIdentifiers(
				arg ??
					({ type: 'ObjectExpression', properties: [] } as unknown as AstNode),
			)) {
				if (CONTEXT_NAMES.has(name)) contextRefs.add(name)
			}
			for (const prop of asArray(arg?.properties)) {
				if (prop.type !== 'Property') continue
				const propName = identifierName(prop.key)
				const value = prop.value
				if (!propName) continue
				// EVERY declared prop name, whatever its initializer shape: `kind` is which of `#setAccessor`'s three landings this initializer takes, so another file's `pass={{ }}` can be decided against it. Default `slot` — the shape that makes no diagnostic — so an unrecognized initializer falls back to the Tier 2 runtime check rather than failing a build on a guess.
				const decl: ExposePropDecl = {
					kind: classifyExposeInit(value, signalByName),
				}
				const getterOf = getterObjectName(value)
				if (getterOf) decl.signalName = getterOf
				// Parser-backed attribute-driven props and method producers: the initializer is an ambient factory call, verbatim in the generated client (imports) and shimmed on the server.
				if (isNode(value) && value.type === 'CallExpression') {
					const callee = identifierName(value.callee)
					if (callee && PARSER_FACTORIES.has(callee)) {
						const fallback = asArray(value.arguments)[0] ?? null
						decl.parser = {
							parser: callee,
							fallbackText: fallback ? text(ctx.source, fallback) : null,
							fallbackNode: fallback,
						}
						exposeAmbients.add(callee)
					} else if (callee === 'defineMethod') {
						exposeAmbients.add(callee)
					}
				} else if (
					isNode(value) &&
					!isGetterMember(value) &&
					value.type !== 'ObjectExpression' &&
					value.type !== 'ArrowFunctionExpression' &&
					value.type !== 'FunctionExpression' &&
					value.type !== 'Identifier'
				) {
					// A plain-value initializer IS the prop's client seed (`#initSignals` evaluates it once), so its expression is the prop's server truth. Only plain value shapes are recorded — a call's purity, a getter's body and a bare identifier's referent are seeds the fold cannot vouch for.
					decl.initNode = value
				}
				exposeProps.set(propName, decl)
			}
			continue
		}
		if (stmt.type === 'ExpressionStatement' && expression) {
			// Client-only setup side effect: connect-time statements (`internals?.states.add('clearable')`) whose free names are all client-known — those touch connect-time APIs (ElementInternals, DOM, ResizeObserver/pointer capture) that don't exist render-time. A plain-const reference is picked up client-side automatically by `computeClientNeededNames`'s plain-setup fixpoint, and a static `t.<key>` read of a declared key is the one server binding admitted.
			const bad = [...freeIdentifiers(expression)].filter(
				n =>
					!clientKnownName(n) &&
					!(
						messages.tNames.has(n) &&
						staticMessageReads(expression, n, messages.declaredKeys) !== null
					),
			)
			if (bad.length === 0) {
				clientSetup.push({
					text: text(ctx.source, stmt),
					range: {
						start: typeof stmt.start === 'number' ? stmt.start : 0,
						end: typeof stmt.end === 'number' ? stmt.end : 0,
					},
					node: expression,
					name: null,
				})
				continue
			}
		}
		ctx.diagnostics.push(setupStatementRefusal(ctx, stmt))
	}
	return {
		setup,
		clientSetup,
		plainSetup,
		signals,
		signalByName,
		setupInits,
		elementRefs,
		expose: expose && { ...expose, ambients: [...exposeAmbients].sort() },
		exposeProps,
		contextRefs,
		importedNames,
		messages,
	}
}

export const seedExtractionContext = (
	ctx: ExtractContext,
	{
		paramNames,
		extraction,
	}: {
		paramNames: ReadonlySet<string>
		extraction: SetupExtraction
	},
): void => {
	// @if conditions validate against server-known names — args and setup declarations. `isPending` is included: the server harness always provides it, so a reactive thunk reading `isPending(knownSignal)` folds server-side; this does NOT reopen `@if` over signals (`validateCondition` diagnoses signal reads before the unknown-name check).
	ctx.serverKnown = new Set<string>([...paramNames, 'isPending'])
	// `bindsExposedArg` consults the caller-supplied names alone (see `ExtractContext.argNames`), so they are kept apart from the signals/setup consts folded into `serverKnown` below.
	ctx.argNames = new Set<string>(paramNames)
	for (const s of extraction.signals) ctx.serverKnown.add(s.name)
	for (const n of extraction.setupInits.keys()) ctx.serverKnown.add(n)
	// An unresolvable signal (an unseeded sensor) has no server value, so no read of it is server-known.
	for (const s of extraction.signals)
		if ('unresolvable' in s && s.unresolvable) ctx.serverKnown.delete(s.name)
	ctx.setupInits = extraction.setupInits
	for (const [prop, decl] of extraction.exposeProps) {
		ctx.exposedProps.add(prop)
		if (decl.parser) ctx.parserProps.add(prop)
	}
	ctx.parserFactoryOf = (prop: string): string =>
		extraction.exposeProps.get(prop)?.parser?.parser ?? ''
	ctx.parserFallbackRefsOf = (prop: string): ReadonlySet<string> => {
		const fallback = extraction.exposeProps.get(prop)?.parser?.fallbackNode
		if (!fallback) return EMPTY_NAMES
		return new Set(
			[...freeIdentifiers(fallback)].filter(n => extraction.elementRefs.has(n)),
		)
	}
	for (const prop of MANAGED_TEXT_PROPS) ctx.exposedProps.add(prop)
	ctx.setupScope = {
		importedNames: extraction.importedNames,
		refNames: new Set(extraction.elementRefs.keys()),
		tNames: extraction.messages.tNames,
		declaredKeys: extraction.messages.declaredKeys,
	}
}

/* === Per-item setup === */

export const extractItemSetup = (
	ctx: ExtractContext,
	stmts: readonly AstNode[],
	signals: ReadonlyMap<string, SignalIR>,
): { setup: ItemSetupStmt[]; signals: SignalIR[] } => {
	const { source } = ctx
	const scope = ctx.setupScope
	const setup: ItemSetupStmt[] = []
	const itemSignals: SignalIR[] = []
	const own = new Map<string, ItemNameClass>()
	const classOf = (name: string): ItemNameClass => {
		const mine = own.get(name)
		if (mine) return mine
		const bound = ctx.loopBound.lastIndexOf(name)
		if (bound >= 0) return ctx.loopReactive[bound] ? 'both' : 'server'
		if (signals.has(name) || ctx.setupInits.has(name)) return 'both'
		if (scope.refNames.has(name)) return 'client'
		if (CONTEXT_NAMES.has(name) || CLIENT_ONLY_PRIMITIVES.has(name))
			return 'client'
		if (ctx.argNames.has(name) || scope.tNames.has(name)) return 'server'
		if (JS_GLOBALS.has(name) || scope.importedNames.has(name)) return 'both'
		return 'unknown'
	}
	const namesOf = (node: AstNode, cls: ItemNameClass): string[] =>
		[...freeIdentifiers(node)].filter(n => classOf(n) === cls).sort()
	const rangeOfStmt = (stmt: AstNode): SourceRange => ({
		start: typeof stmt.start === 'number' ? stmt.start : 0,
		end: typeof stmt.end === 'number' ? stmt.end : 0,
	})
	/** Refuse a both-phase position reading a name one phase lacks; true when it was refused. `clientOnlyOk` admits client-only names (a position the server defines but never calls). */
	const refusePhase = (
		stmt: AstNode,
		node: AstNode,
		subject: string,
		clientOnlyOk: boolean,
	): boolean => {
		const serverOnly = namesOf(node, 'server')
		if (serverOnly.length > 0) {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					source,
					stmt,
					`${subject} reading ${nameList(serverOnly)}, which the item's client mount does not have,`,
					'Item setup also runs on the client, once per entering item, where server args and server-data loop bindings do not exist — read the value from the item or from a signal.',
				),
			)
			return true
		}
		const clientOnly = clientOnlyOk ? [] : namesOf(node, 'client')
		if (clientOnly.length > 0) {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					source,
					stmt,
					`${subject} reading ${nameList(clientOnly)}, which the server render does not have,`,
					'Item setup also runs on the server, once per initial item — read client-only names in a function const, a `createSensor()` start callback, or a `watch()` or `on()` handler.',
				),
			)
			return true
		}
		return false
	}

	for (const stmt of stmts) {
		// The `harvest()` marker resolves against the item's scopes: its binding, key and setup names, and every enclosing item's. An item's list is seeded from the item on both sides, so nothing is harvested; any other reference here is the unclaimed-marker sweep's.
		const enclosing = [...own.keys(), ...ctx.loopBound, ...signals.keys()]
		if (seedHarvestOf(ctx, stmt, enclosing)) {
			ctx.diagnostics.push(
				misplacedHarvest(
					ctx,
					stmt,
					"A `harvest()` seed declared in a reactive-list item's setup",
				),
			)
			continue
		}
		if (stmt.type === 'VariableDeclaration') {
			const single = singleConstDeclOf(ctx, stmt)
			if (!single) continue
			const { name: declName, init } = single
			const base = {
				text: text(source, stmt),
				range: rangeOfStmt(stmt),
				node: init,
				name: declName,
			}
			const calleeName = identifierName(init.callee)
			// `first()` against the item's own `first`: resolved against the item's content once it is lowered.
			if (calleeName === 'first') {
				const firstRef = firstCallOf(ctx, stmt, init, declName)
				if (!firstRef) continue
				setup.push({
					...base,
					kind: 'ref',
					selector: firstRef.selectorText,
					reason: firstRef.reasonText,
					required: !firstRef.maybe,
					root: false,
				})
				own.set(declName, 'client')
				continue
			}
			if (calleeName === 'requestContext') {
				ctx.diagnostics.push(
					diagnostic.unsupported(
						source,
						stmt,
						"`requestContext()` in a reactive-list item's setup",
						'A context is requested once per component — request it in the component setup and read it in the item.',
					),
				)
				continue
			}
			if (calleeName && SIGNAL_CONSTRUCTORS.has(calleeName)) {
				const args = asArray(init.arguments)
				const subject = `The per-item signal \`${declName}\``
				if (calleeName === 'createSensor') {
					// The seed is the sensor's server value, and every initial item renders from it.
					if (sensorSeedResolution(args[1]) !== null) {
						ctx.diagnostics.push(
							diagnostic.unsupported(
								source,
								stmt,
								`A per-item \`createSensor()\` without a server-known \`{ value }\` seed`,
								'The seed is the sensor’s server value, and the server renders every initial item from it — add `{ value: … }` over values both phases know.',
							),
						)
						continue
					}
					// The start callback subscribes on the client and never runs on the server: client-only names are admitted there and stubbed.
					const [start, options] = args
					if (
						(isNode(start) &&
							refusePhase(stmt, start, subject, isFunctionNode(start))) ||
						(isNode(options) && refusePhase(stmt, options, subject, false))
					)
						continue
				} else if (refusePhase(stmt, init, subject, false)) continue
				itemSignals.push(
					signalIROf(
						{
							name: declName,
							text: text(source, init),
							textStart: typeof init.start === 'number' ? init.start : 0,
							init: args[0] ?? null,
							inferredType: 'unknown',
						},
						calleeName,
					),
				)
				setup.push({
					...base,
					kind: 'signal',
					constructor: calleeName as Exclude<
						SignalIR['constructor'],
						'requestContext'
					>,
				})
				own.set(declName, 'both')
				continue
			}
			if (
				init.type === 'ConditionalExpression' &&
				refuseConditionalSignalConstructor(ctx, stmt, init, declName)
			)
				continue
			// A plain const. A function is defined in both phases and called on the client only, so its body may read client-only names — the server then leaves it out.
			const isFunction = isFunctionNode(init)
			if (
				refusePhase(
					stmt,
					init,
					`The per-item const \`${declName}\``,
					isFunction,
				)
			)
				continue
			setup.push({
				...base,
				kind: 'const',
				server: !isFunction || namesOf(init, 'client').length === 0,
			})
			own.set(declName, 'both')
			continue
		}
		const expression =
			stmt.type === 'ExpressionStatement'
				? (stmt.expression as AstNode | undefined)
				: undefined
		if (identifierName(expression?.callee) === 'expose') {
			ctx.diagnostics.push(
				diagnostic.unsupported(
					source,
					stmt,
					"`expose()` in a reactive-list item's setup",
					'A component exposes its props once — call `expose()` in the component setup.',
				),
			)
			continue
		}
		if (expression) {
			// A client-only side effect, gated by the contract on `classOf`.
			const bad = [...freeIdentifiers(expression)].filter(n => {
				const cls = classOf(n)
				if (cls === 'both' || cls === 'client') return false
				return !(
					scope.tNames.has(n) &&
					staticMessageReads(expression, n, scope.declaredKeys) !== null
				)
			})
			if (bad.length === 0) {
				setup.push({
					text: text(source, stmt),
					range: rangeOfStmt(stmt),
					node: expression,
					name: null,
					kind: 'client',
				})
				continue
			}
		}
		ctx.diagnostics.push(setupStatementRefusal(ctx, stmt))
	}
	return { setup, signals: itemSignals }
}

export const onServer = (stmt: ItemSetupStmt): boolean =>
	stmt.kind === 'signal' || (stmt.kind === 'const' && stmt.server)
