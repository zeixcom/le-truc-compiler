import { sanitizeHtml as librarySanitizeHtml } from '@zeix/le-truc'
import { bakeMessageEnv, type Message, type MessageEnv } from './icu/evaluate'

/* === Re-exports === */

export {
	formatMessage,
	type Message,
	type MessageArgs,
	type MessageEnv,
} from './icu/evaluate'

export const CLIENT_MESSAGE: unique symbol = Symbol.for(
	'le-truc.client-message',
)

/** What {@link CLIENT_MESSAGE} holds: the AST and the record it formats against. */
export type ClientMessageSource = { message: Message; env: MessageEnv }

/* === Types === */

/** Server-side stand-in for a Cause & Effect cell: read-once box, inert set. */
export type ServerCell<T> = {
	get: () => T
	set: (value: T) => void
}

export type ServerFieldSignal<V> = V extends readonly (infer U)[]
	? ServerList<U>
	: V extends Record<string, unknown>
		? ServerStore<V>
		: ServerCell<V>

export type ServerStore<T extends Record<string, unknown>> = ServerCell<T> & {
	readonly [K in keyof T]: ServerFieldSignal<T[K]>
}

export type ServerList<T, S = ServerCell<T>> = ServerCell<T[]> & {
	readonly length: number
	[Symbol.iterator]: () => Iterator<S>
	at: (index: number) => S | undefined
	keys: () => IterableIterator<string>
	byKey: (key: string) => S | undefined
	/** `(cell, key)` per item, in order — a plain array, like C&E's `map`. */
	map: <R>(callback: (cell: S, key: string) => R) => R[]
	forEach: (callback: (cell: S, key: string) => void) => void
	entries: () => Array<[string, S]>
}

/** Key configuration as Cause & Effect's `KeyConfig` accepts it. */
type KeyConfig<T> = string | ((item: T) => string | undefined)

/** Options the harness honors on `createList`/`deriveList`. */
type ServerListOptions<T, S> = {
	keyConfig?: KeyConfig<T>
	createItem?: (
		value: T,
	) => S | (T extends Record<string, unknown> ? ServerStore<T> : never)
}

/* === Exported Functions === */

/** `createCell(initial)` → box over `initial`. */
export const createCell = <T>(initial: T): ServerCell<T> => ({
	get: () => initial,
	set: () => {},
})

export const createList = <T, S = ServerCell<T>>(
	seed: Iterable<T> = [],
	options?: ServerListOptions<T, S>,
): ServerList<T, S> => {
	const items = Array.from(seed)
	let keyCounter = 0
	const keyConfig = options?.keyConfig
	const keyOf = (item: T): string =>
		typeof keyConfig === 'string'
			? `${keyConfig}${keyCounter++}`
			: typeof keyConfig === 'function'
				? keyConfig(item) || String(keyCounter++)
				: String(keyCounter++)
	const createItem =
		options?.createItem ?? ((value: T) => createCell(value) as S)
	const keyed = items.map(
		item => [keyOf(item), createItem(item)] as [string, S],
	)
	const cells = keyed.map(([, cell]) => cell)
	const byKey = new Map(keyed)
	return {
		get: () => items,
		set: () => {},
		length: items.length,
		[Symbol.iterator]: () => cells[Symbol.iterator](),
		at: index => cells.at(index),
		keys: () => byKey.keys(),
		byKey: key => byKey.get(key),
		map: callback => keyed.map(([key, cell]) => callback(cell, key)),
		forEach: callback => {
			for (const [key, cell] of keyed) callback(cell, key)
		},
		entries: () => keyed,
	}
}

/** Cause & Effect's `isRecord`: a plain object, the only kind a store nests. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null &&
	typeof value === 'object' &&
	Object.getPrototypeOf(value) === Object.prototype

/** The signal for one store field, by C&E's `MutableStore` rule. */
const fieldSignal = (value: unknown): unknown =>
	Array.isArray(value)
		? createList(value)
		: isRecord(value)
			? createStore(value)
			: createCell(value)

export const createStore = <T extends Record<string, unknown>>(
	initial: T,
): ServerStore<T> => {
	const store: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(initial))
		store[key] = fieldSignal(value)
	store.get = () => initial
	store.set = () => {}
	return store as ServerStore<T>
}

export const createSensor = <T>(
	_start: (set: (value: T) => void) => () => void,
	options?: { value?: T },
): ServerCell<T> =>
	options?.value !== undefined
		? createCell<T>(options.value)
		: {
				get: () => {
					throw new Error(
						'createSensor(...) has no { value } seed, so it has no server value — seed it, or read it only in a client position.',
					)
				},
				set: () => {},
			}

/** `createState(initial)` → same box as createCell (the v2 name). */
export const createState = <T>(initial: T): ServerCell<T> => createCell(initial)

/** Marks a `ServerCell` as pending — never exposed on the type; `isPending` is the only sanctioned way to read it. */
const ASYNC_PENDING = Symbol('tsrx-async-pending')

/** Runtime check for an `async` function, without invoking it. */
const isAsyncFunction = (fn: (...args: never[]) => unknown): boolean =>
	(fn as { constructor?: { name?: string } })?.constructor?.name ===
	'AsyncFunction'

export const deriveCell = <T>(
	compute: () => T | Promise<T>,
	options?: { initial?: T },
): ServerCell<T> => {
	if (!isAsyncFunction(compute as (...args: never[]) => unknown))
		return createCell(compute() as T)
	if (options && 'initial' in options) return createCell(options.initial as T)
	return {
		get: () => {
			throw new Error(
				'deriveCell(...) is pending (no { initial } seed) — read it only inside an isPending()-guarded branch (ADR 0005 async boundaries).',
			)
		},
		set: () => {},
		[ASYNC_PENDING]: true,
	} as ServerCell<T>
}

export const isPending = (signal: unknown): boolean =>
	!!signal &&
	typeof signal === 'object' &&
	(signal as Record<symbol, unknown>)[ASYNC_PENDING] === true

export const createTask = <T>(
	fn: (prev: T, signal: AbortSignal) => Promise<T>,
	options?: { value?: T },
): ServerCell<T> => {
	void fn
	if (options && 'value' in options) return createCell(options.value as T)
	return {
		get: () => {
			throw new Error(
				'createTask(...) is pending (no { value } seed) — read it only inside an isPending()-guarded branch (ADR 0005 async boundaries).',
			)
		},
		set: () => {},
		[ASYNC_PENDING]: true,
	} as ServerCell<T>
}

export const createMemo = <T>(
	compute: (prev: T | undefined) => T,
	options?: { value?: T },
): ServerCell<T> => createCell(compute(options?.value))

export function deriveList<T>(
	compute: () => Iterable<T>,
	options?: { keyConfig?: KeyConfig<T> },
): ServerList<T>
export function deriveList<T, U>(
	source: ServerList<U, { get: () => U }>,
	itemCallback: (sourceValue: U) => T,
	options?: { keyConfig?: KeyConfig<U> },
): ServerList<T>
export function deriveList<T, U>(
	input: (() => Iterable<T>) | ServerList<U, { get: () => U }>,
	second?: ((sourceValue: U) => T) | { keyConfig?: KeyConfig<T> },
): ServerList<T> {
	if (typeof input === 'function')
		return createList(
			input(),
			second as { keyConfig?: KeyConfig<T> } | undefined,
		)
	const map = second as (sourceValue: U) => T
	const keyed = input
		.entries()
		.map(([key, item]) => [key, createCell(map(item.get()))] as const)
	const values = keyed.map(([, cell]) => cell.get())
	const cells = keyed.map(([, cell]) => cell)
	const byKey = new Map(keyed)
	return {
		get: () => values,
		set: () => {},
		length: values.length,
		[Symbol.iterator]: () => cells[Symbol.iterator](),
		at: index => cells.at(index),
		keys: () => byKey.keys(),
		byKey: key => byKey.get(key),
		map: callback => keyed.map(([key, cell]) => callback(cell, key)),
		forEach: callback => {
			for (const [key, cell] of keyed) callback(cell, key)
		},
		entries: () => keyed.map(([key, cell]) => [key, cell]),
	}
}

/** `deriveStore(fn)` → box over `fn()` evaluated once. */
export const deriveStore = <T>(compute: () => T): ServerCell<T> =>
	deriveCell(compute)

export const expose = (_props: Record<string, unknown>): void => {}

export class HarvestWitnessError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'HarvestWitnessError'
	}
}

export const witnessHarvest = (
	component: string,
	list: string,
	keys: Iterable<string>,
	rendered: readonly string[],
): void => {
	const expected = [...keys]
	const seen = [...new Set(rendered)]
	const at = (i: number): string => `position ${i + 1}`
	for (let i = 0; i < Math.max(expected.length, seen.length); i++) {
		const want = expected[i]
		const got = seen[i]
		if (want === got) continue
		if (got !== undefined && !expected.includes(got))
			throw new HarvestWitnessError(
				`<${component}> rendered key \`${got}\` through the key alias of list \`${list}\`, which holds no item with that key, so the client would rebuild \`${list}\` with an item the server data does not have. Render only keys of \`${list}\` at the alias scope — derive the grouped lists from its items.`,
			)
		if (want === undefined) continue
		if (!seen.includes(want))
			throw new HarvestWitnessError(
				`<${component}> rendered no item with key \`${want}\` of list \`${list}\` through its key alias, so the client would rebuild \`${list}\` without it. The client reads the list back from the rendered items only — render every item of \`${list}\` once at the alias scope, and do not gate a group off on the server.`,
			)
		throw new HarvestWitnessError(
			`<${component}> rendered key \`${want}\` of list \`${list}\` out of order through its key alias: the list holds it at ${at(i)}, the render first reached it at ${at(seen.indexOf(want))}. The client rebuilds \`${list}\` in rendered order, so it would reorder the list — render the groups and their items in the order of \`${list}\`.`,
		)
	}
}

export const refStub: any = new Proxy((() => {}) as never, {
	get: (_target, key) => {
		// Coercion and iteration protocols must answer with real callables — returning the stub for `Symbol.toPrimitive` would make `String(stub)` throw "not a function" instead of ''.
		if (key === Symbol.toPrimitive)
			return (hint: string): string | number | boolean =>
				hint === 'number' ? 0 : hint === 'string' ? '' : false
		if (key === Symbol.toStringTag) return 'TsrxRefStub'
		if (key === Symbol.iterator) return function* () {}
		if (key === 'toString' || key === 'valueOf') return () => ''
		// NOT thenable: a stub `then` would make any `await` over it recurse forever resolving itself.
		if (key === 'then') return undefined
		return refStub
	},
	set: () => true,
	has: () => true,
	apply: () => refStub,
	// The target is an arrow function — no own `prototype`, configurable `length`/`name` — so reporting no own keys breaks no proxy invariant.
	ownKeys: () => [],
	getOwnPropertyDescriptor: () => undefined,
})

export const defineMethod = <T extends (...args: any[]) => void>(fn: T): T => fn

export const asString =
	(fallback: string = '') =>
	(value: string | null | undefined): string =>
		value ?? fallback

export const asInteger =
	(fallback: number = 0) =>
	(value: string | null | undefined): number => {
		const n = Number(value)
		return value != null && Number.isFinite(n) ? Math.trunc(n) : fallback
	}

export const asNumber =
	(fallback: number = 0) =>
	(value: string | null | undefined): number => {
		const n = Number(value)
		return value != null && Number.isFinite(n) ? n : fallback
	}

export const asBoolean =
	(fallback: boolean = false) =>
	(value: string | null | undefined): boolean =>
		value == null ? fallback : value !== 'false'

export const asEnum =
	(valid: readonly [string, ...string[]]) =>
	(value: string | null | undefined): string =>
		valid.includes(value as string) ? (value as string) : valid[0]

/** Clamped-integer shim mirroring src/parsers/number.ts (min/max clamp). */
export const asClampedInteger =
	(min: number = 0, max: number = Number.MAX_SAFE_INTEGER) =>
	(value: string | null | undefined): number => {
		const n = Number(value)
		const parsed = value != null && Number.isFinite(n) ? Math.trunc(n) : min
		return Math.max(min, Math.min(parsed, max))
	}

/** JSON shim mirroring src/parsers/json.ts (fallback on null/unparseable). */
export const asJSON =
	<T extends {}>(fallback: T) =>
	(value: string | null | undefined): T => {
		if (value == null || value === '') return fallback
		try {
			return JSON.parse(value) as T
		} catch {
			return fallback
		}
	}

export const esc = (text: string): string =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')

export type TextValue = string | number | null | undefined

export const text = (value: TextValue): string =>
	value == null ? '' : esc(String(value))

export const textOf = (thunk: () => TextValue): string => text(thunk())

export const attr = (name: string, value: unknown): string => {
	if (value === true) return ` ${name}`
	if (value === false || value === null || value === undefined) return ''
	if (typeof value === 'number') return ` ${name}="${value}"`
	return ` ${name}="${esc(String(value))}"`
}

export const attrValue = (value: unknown): string | null => {
	if (value === true) return ''
	if (value === false || value === null || value === undefined) return null
	return String(value)
}

export const cls = (map: Record<string, unknown>): string =>
	Object.entries(map)
		.filter(([, on]) => Boolean(on))
		.map(([token]) => token)
		.join(' ')

export const styleAttr = (
	map: Record<string, string | null | undefined>,
): string =>
	Object.entries(map)
		.filter(([, v]) => v != null)
		.map(([prop, v]) => `${prop}: ${v}`)
		.join('; ')

export { configureHtmlSanitizer } from '@zeix/le-truc'

export const sanitizeHtml = (html: string): string =>
	String(librarySanitizeHtml(html))

/** `@for` iteration helper over the items themselves (index unused). */
export const items = <T>(iterable: Iterable<T>): T[] => Array.from(iterable)

/** `@for` iteration helper: index/value pairs over any iterable. */
export const entries = <T>(
	iterable: Iterable<T>,
): IterableIterator<[number, T]> => Array.from(iterable).entries()

export { composeHostAttrs } from './compose-attrs'

/** JSON with object keys sorted, so two equal values serialize equal. */
const canonicalJson = (value: unknown): string =>
	JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
				)
			: v,
	)

const pickClientMessages = (
	t: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	source: Readonly<Record<string, unknown>>,
): Record<string, string | Message> => {
	const picked: Record<string, string | Message> = {}
	for (const key of keys) {
		const value = t[key]
		let form: string | Message | undefined
		if (typeof value === 'string') form = value
		else if (typeof value === 'function') {
			const tagged = (value as { [CLIENT_MESSAGE]?: ClientMessageSource })[
				CLIENT_MESSAGE
			]
			if (tagged) form = bakeMessageEnv(tagged.message, tagged.env)
		}
		if (
			form !== undefined &&
			canonicalJson(form) !== canonicalJson(source[key])
		)
			picked[key] = form
	}
	return picked
}

export const clientMessages = (
	t: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	source: Readonly<Record<string, unknown>>,
): string | null => {
	const picked = pickClientMessages(t, keys, source)
	return Object.keys(picked).length > 0 ? JSON.stringify(picked) : null
}

export const clientLocale = (
	t: Readonly<Record<string, unknown>>,
	keys: readonly string[],
): string | null => {
	for (const key of keys) {
		const value = t[key]
		if (typeof value !== 'function') continue
		const tagged = (value as { [CLIENT_MESSAGE]?: ClientMessageSource })[
			CLIENT_MESSAGE
		]
		if (tagged) return tagged.env.lang
	}
	return null
}
