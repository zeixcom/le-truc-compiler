/** The ICU MessageFormat 1 evaluator — one implementation for both the server fold and the client's recomputation, so they cannot disagree. */

/* === Types === */

/**
 * One node of a parsed message. A bare string is literal text, already
 * unescaped (the parser consumed MF1's apostrophe quoting).
 */
export type MessageNode =
	| string
	/** `{name}` — the argument's value, stringified. */
	| { t: 'arg'; a: string }
	| {
			t: 'num'
			a: string
			o?: Intl.NumberFormatOptions
			s?: number
	  }
	| { t: 'date'; a: string; o: Intl.DateTimeFormatOptions }
	| {
			t: 'plural'
			a: string
			c: Record<string, Message>
			o?: 1
			off?: number
	  }
	/** `{x, select, …}` — `c` maps each case key to its body. */
	| { t: 'select'; a: string; c: Record<string, Message> }
	| { t: '#'; a: string; off?: number }

/** A parsed message: a sequence of nodes. */
export type Message = MessageNode[]

/** The argument record a message with arguments is called with. */
export type MessageArgs = Readonly<Record<string, unknown>>

/** The locale facts a message formats against — the `i18n` record's. */
export type MessageEnv = {
	lang: string
	timeZone?: string
	currency?: string
}

/* === Internal Functions === */

/** The case body for `key`, own keys only — a select value of `'constructor'` must fall to `other`, not reach `Object.prototype`. */
const caseOf = (
	cases: Record<string, Message>,
	key: string,
): Message | undefined => (Object.hasOwn(cases, key) ? cases[key] : undefined)

/* === Exported Functions === */

export const formatMessage = (
	message: Message,
	args: MessageArgs,
	env: MessageEnv,
): string => {
	let out = ''
	for (const node of message) {
		if (typeof node === 'string') {
			out += node
			continue
		}
		const value = args[node.a]
		switch (node.t) {
			case 'arg':
				out += String(value)
				break
			case 'num': {
				const options =
					node.o?.style === 'currency' && !node.o.currency
						? { ...node.o, currency: env.currency }
						: node.o
				out += new Intl.NumberFormat(env.lang, options).format(
					Number(value) * (node.s ?? 1),
				)
				break
			}
			case 'date':
				out += new Intl.DateTimeFormat(
					env.lang,
					node.o.timeZone || !env.timeZone
						? node.o
						: { ...node.o, timeZone: env.timeZone },
				).format(new Date(value as number | Date))
				break
			case 'plural': {
				const n = Number(value)
				const body =
					caseOf(node.c, `=${n}`) ??
					caseOf(
						node.c,
						new Intl.PluralRules(env.lang, {
							type: node.o ? 'ordinal' : 'cardinal',
						}).select(n - (node.off ?? 0)),
					) ??
					node.c.other
				if (body) out += formatMessage(body, args, env)
				break
			}
			case 'select': {
				const body = caseOf(node.c, String(value)) ?? node.c.other
				if (body) out += formatMessage(body, args, env)
				break
			}
			case '#':
				out += new Intl.NumberFormat(env.lang).format(
					Number(value) - (node.off ?? 0),
				)
				break
		}
	}
	return out
}

/** The node kinds that format through `Intl`, so read the locale. */
export const FORMATTING_KINDS: ReadonlySet<string> = new Set([
	'num',
	'date',
	'plural',
	'#',
])

export const carriedKinds = (messages: Iterable<Message>): Set<string> => {
	const kinds = new Set<string>()
	const collect = (message: Message): void => {
		for (const node of message) {
			if (typeof node === 'string') continue
			kinds.add(node.t)
			if (node.t === 'plural' || node.t === 'select')
				for (const body of Object.values(node.c)) collect(body)
		}
	}
	for (const message of messages) collect(message)
	return kinds
}

export const clientFallsBack = (
	source: string | Message,
	translation: string | Message,
	carried: ReadonlySet<string>,
): boolean => {
	if (typeof translation === 'string') return false
	if (typeof source === 'string') return true
	return [...carriedKinds([translation])].some(kind => !carried.has(kind))
}

export const bakeMessageEnv = (message: Message, env: MessageEnv): Message =>
	message.map(node => {
		if (typeof node === 'string') return node
		switch (node.t) {
			case 'num':
				return node.o?.style === 'currency' && !node.o.currency && env.currency
					? { ...node, o: { ...node.o, currency: env.currency } }
					: node
			case 'date':
				return node.o.timeZone || !env.timeZone
					? node
					: { ...node, o: { ...node.o, timeZone: env.timeZone } }
			case 'plural':
			case 'select': {
				const c: Record<string, Message> = {}
				for (const [key, body] of Object.entries(node.c))
					c[key] = bakeMessageEnv(body, env)
				return { ...node, c }
			}
			default:
				return node
		}
	})
