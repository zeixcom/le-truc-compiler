type LeTrucFactoryContext = import('@zeix/le-truc').FactoryContext<
	Record<string, NonNullable<unknown>>
>

/** Effect helpers received via the compiler-generated factory parameter. */
declare const all: LeTrucFactoryContext['all']
declare const first: LeTrucFactoryContext['first']
declare const on: LeTrucFactoryContext['on']
declare const pass: LeTrucFactoryContext['pass']
declare const watch: LeTrucFactoryContext['watch']
declare const expose: LeTrucFactoryContext['expose']

declare const host: HTMLElement & Record<string, unknown>
declare const internals: ElementInternals | null

declare const requestContext: LeTrucFactoryContext['requestContext']
declare const provideContexts: LeTrucFactoryContext['provideContexts']

type FormAssociatedElement = import('@zeix/le-truc').FormAssociatedElement

type MessageArgs = Record<string, string | number | Date>

type MessageOf<V> = string extends V
	? string | ((args: MessageArgs) => string)
	: V extends `${string}{${string}`
		? (args: MessageArgs) => string
		: string

interface I18n<M extends Record<string, string> = Record<string, string>> {
	lang: string
	t: { readonly [K in keyof M]: MessageOf<M[K]> }
	timeZone: string
	currency: string
	dir: 'ltr' | 'rtl'
}
