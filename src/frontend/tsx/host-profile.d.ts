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

declare const internals: ElementInternals | null

type FormAssociatedElement = import('@zeix/le-truc').FormAssociatedElement

/** Web Components Community Protocol helpers (ADR 0005 sub-design 15). */
declare const requestContext: LeTrucFactoryContext['requestContext']
declare const provideContexts: LeTrucFactoryContext['provideContexts']

declare const host: FormAssociatedElement & Record<string, any>

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

// biome-ignore lint/style/noNamespace: global-script .d.ts has no module-free alternative for JSX.IntrinsicElements
declare namespace JSX {
	interface Element {
		readonly $$leTrucJsx: 'element'
	}

	interface ElementChildrenAttribute {
		children: unknown
	}

	type LibraryManagedAttributes<_C, P> = (P extends unknown
		? ComposeArgs<Omit<P, 'i18n'>>
		: never) &
		ComposeSiteAttrs
	/** JSX children the compose lowering turns into the child's markup string. */
	type ComposeChildren = Element | string | (Element | string)[]
	type ComposeArgs<P> = 'children' extends keyof P
		? NonNullable<P['children']> extends string
			? Omit<P, 'children'> &
					({} extends Pick<P, 'children'>
						? { children?: ComposeChildren }
						: { children: ComposeChildren })
			: P
		: P
	interface ComposeSiteAttrs {
		class?: string
		id?: string
		[key: `data-${string}`]: string
	}

	/** A reactive value: static, or a thunk re-evaluated client-side. */
	type Thunk<T> = () => T
	type Reactive<T> = T | Thunk<T>

	type PassEntry =
		| Thunk<unknown>
		| { get: Thunk<unknown>; set: (value: unknown) => void }

	interface CommonLightDom {
		class?: Reactive<string | null>
		hidden?: Reactive<boolean>
		id?: Reactive<string>
		role?: string
		style?: Reactive<string> | (() => Partial<Record<string, string | null>>)
		tabindex?: Reactive<number>
		title?: string
		'aria-label'?: Reactive<string>
		'aria-live'?: 'polite' | 'assertive' | 'off'
		'aria-expanded'?: Reactive<string | boolean>
		'aria-selected'?: Reactive<string | boolean>
		'aria-describedby'?: string | null
		'aria-controls'?: Reactive<string>
		'aria-current'?: Reactive<string>
		'aria-haspopup'?: string
		'aria-labelledby'?: Reactive<string>
		'aria-orientation'?: Reactive<'horizontal' | 'vertical'>
		'aria-valuenow'?: Reactive<string>
		'aria-valuemin'?: Reactive<string>
		'aria-valuemax'?: Reactive<string>
		onClick?: ((event: MouseEvent) => unknown) | undefined
		onInput?: ((event: Event) => unknown) | undefined
		onChange?: ((event: Event) => unknown) | undefined
		onKeydown?: ((event: KeyboardEvent) => unknown) | undefined
		onKeyup?: ((event: KeyboardEvent) => unknown) | undefined
		[key: `data-${string}`]: Reactive<string>
		/** Sanitized raw markup, rendered before any authored children . */
		'truc:html'?: Reactive<string>
		children?: unknown
	}

	interface button extends CommonLightDom {
		type?: 'button' | 'submit' | 'reset'
		disabled?: Reactive<boolean>
	}
	interface details extends CommonLightDom {
		open?: Reactive<boolean>
	}
	interface dialog extends CommonLightDom {}
	interface div extends CommonLightDom {}
	/** module-todo's per-item filter radios. */
	interface fieldset extends CommonLightDom {}
	interface form extends CommonLightDom {
		action?: string
		method?: 'get' | 'post' | 'dialog'
		onSubmit?: ((event: SubmitEvent) => unknown) | undefined
	}
	interface h1 extends CommonLightDom {}
	interface h2 extends CommonLightDom {}
	interface h3 extends CommonLightDom {}
	interface footer extends CommonLightDom {}
	interface header extends CommonLightDom {}
	interface input extends CommonLightDom {
		type?: string
		name?: string
		value?: Reactive<string>
		placeholder?: Reactive<string>
		autocomplete?: string
		checked?: Reactive<boolean>
		disabled?: Reactive<boolean>
		min?: Reactive<string>
		max?: Reactive<string>
		step?: string
		inputmode?: string
	}
	interface label extends CommonLightDom {
		/** The native attribute is `for` — there is no `htmlFor` here. */
		for?: string
	}
	/** module-todo's per-item filter radios. */
	interface legend extends CommonLightDom {}
	interface code extends CommonLightDom {}
	interface dd extends CommonLightDom {
		/** A fixed-language island (module-colorinfo's `oklch(…)` line). */
		lang?: string
	}
	interface dl extends CommonLightDom {}
	interface dt extends CommonLightDom {}
	interface small extends CommonLightDom {}
	interface strong extends CommonLightDom {}
	interface summary extends CommonLightDom {}
	/** The queue board's lanes (demo/queue-board). */
	interface section extends CommonLightDom {}
	interface li extends CommonLightDom {}
	/** schema.org microdata, the attributes basic-blogmeta's byline carries. */
	interface Microdata {
		itemprop?: string
		itemscope?: boolean
		itemtype?: string
	}
	interface img extends CommonLightDom, Microdata {
		src?: Reactive<string>
		alt?: Reactive<string>
	}
	interface meta extends CommonLightDom, Microdata {
		content?: Reactive<string>
	}
	interface data extends CommonLightDom {
		value?: Reactive<string>
	}
	interface time extends CommonLightDom, Microdata {
		datetime?: Reactive<string>
	}
	interface svg extends CommonLightDom {
		viewBox?: string
		fill?: string
		focusable?: 'true' | 'false'
	}
	interface path extends CommonLightDom {
		d?: string
		'fill-rule'?: 'nonzero' | 'evenodd'
	}
	interface nav extends CommonLightDom {}
	/** module-todo's item container. */
	interface ol extends CommonLightDom {}
	/* module-calctable's table skeleton. */
	interface table extends CommonLightDom {}
	interface thead extends CommonLightDom {}
	interface tbody extends CommonLightDom {}
	interface tfoot extends CommonLightDom {}
	interface tr extends CommonLightDom {}
	interface th extends CommonLightDom {
		scope?: string
	}
	interface td extends CommonLightDom {
		colspan?: string
	}
	interface p extends CommonLightDom {}
	interface pre extends CommonLightDom {}
	interface span extends CommonLightDom, Microdata {}
	interface ul extends CommonLightDom {}
	/** A component's stylesheet: content only, no attributes. */
	interface style {
		children?: unknown
	}

	type BasicCounterAttrs = CommonLightDom & {
		start?: Reactive<number>
	}
	type BasicNumberAttrs = CommonLightDom & {
		value?: Reactive<number>
		options?: string
		'truc:pass'?: { value?: PassEntry }
	}
	type FormComboboxAttrs = CommonLightDom & {
		name: Reactive<string>
		label?: string
		description?: string
		value?: Reactive<string>
		options?: unknown
		clearable?: Reactive<boolean>
	}
	type FormListboxAttrs = CommonLightDom & {
		name: Reactive<string>
		'aria-label'?: string
		value?: Reactive<string>
		options?: unknown
		filterable?: Reactive<boolean>
		'truc:pass'?: { filter?: PassEntry }
	}
	/** Its own `id` mirrors an optional arg: absent when the caller passes none. */
	type ModuleCodeblockAttrs = Omit<CommonLightDom, 'id'> & {
		id?: string | undefined
		collapsed?: Reactive<boolean>
		language?: string
	}
	type BasicBlogmetaAttrs = CommonLightDom
	type BasicButtonAttrs = CommonLightDom & {
		'truc:pass'?: { disabled?: PassEntry; badge?: PassEntry; label?: PassEntry }
	}
	type FormCheckboxAttrs = CommonLightDom & {
		name?: Reactive<string>
		checked?: Reactive<boolean>
		'truc:pass'?: { checked?: PassEntry }
	}
	type FormRadiogroupAttrs = CommonLightDom & {
		name?: Reactive<string>
		value?: Reactive<string>
	}
	type ModuleCalctableAttrs = CommonLightDom & {
		lang?: string
		/** JSON-encoded `Intl.NumberFormatOptions` */
		options?: string
	}
	type ModuleCarouselAttrs = CommonLightDom
	type ModuleCatalogAttrs = CommonLightDom
	type ModuleCemListAttrs = CommonLightDom
	type ModuleColoreditorAttrs = CommonLightDom & {
		/** Parser-backed: read once at connect; the `value` property owns it after. */
		value?: string
		/** Parser-backed: read once at connect; the `label` property owns it after. */
		label?: string
	}
	type ModuleColorinfoAttrs = CommonLightDom & {
		value?: Reactive<string>
		/** Server-rendered swatch properties; `bindStyle` owns them after connect. */
		style?: string
	}
	type ModuleDialogAttrs = CommonLightDom
	type ModuleListAttrs = CommonLightDom
	type ModuleListnavAttrs = CommonLightDom
	type ModuleTickerAttrs = CommonLightDom & {
		/** Parser-backed: read once at connect; the `fraction` property owns it after. */
		fraction?: string
	}
	type ModuleTodoAttrs = CommonLightDom
	type SectionMenuAttrs = CommonLightDom
	type ModuleLazyloadAttrs = CommonLightDom & {
		/** Parser-backed: read once at connect; the `src` property owns it after. */
		src?: string | undefined
		/** Config-only, presence-read once at connect: not a reactive property. */
		'allow-scripts'?: boolean | undefined
	}
	type ModuleSplitviewAttrs = CommonLightDom & {
		split?: Reactive<number>
		/** Server-rendered initial ratio; the `split` watcher owns it after connect. */
		style?: string
		/** Config-only: read once at connect, not a reactive property. */
		orientation?: 'horizontal' | 'vertical' | undefined
	}
	type ModulePaginationAttrs = CommonLightDom & {
		max?: Reactive<number>
		value?: Reactive<number>
	}
	/** Its light-DOM config attribute: read once at connect, not a reactive property. */
	type ModuleScrollareaAttrs = CommonLightDom & {
		orientation?: 'horizontal' | 'vertical' | undefined
	}
	/** Breakpoint config attributes, each read once at connect. */
	type ContextMediaAttrs = CommonLightDom & {
		sm?: string | undefined
		md?: string | undefined
		lg?: string | undefined
		xl?: string | undefined
	}
	/** A `.tsrx` leaf authored raw: its `kind` class is the only contract. */
	type CardCalloutAttrs = CommonLightDom
	type SyncElAttrs = CommonLightDom & {
		mode?: string
		items?: unknown
	}
	type AsyncElAttrs = CommonLightDom
	type CssProbeAttrs = CommonLightDom
	type CssProbeChildAttrs = CommonLightDom
	type XKidWidgetAttrs = CommonLightDom
	type TestListitemTsxAttrs = CommonLightDom
	type QueueBoardAttrs = CommonLightDom

	interface TrucTryAttrs {
		pending?: Element
		catch: (error: Error) => Element
		children: Element
	}

	interface IntrinsicElements {
		button: button
		dd: dd
		details: details
		dialog: dialog
		dl: dl
		dt: dt
		fieldset: fieldset
		div: div
		table: table
		thead: thead
		tbody: tbody
		tfoot: tfoot
		tr: tr
		th: th
		td: td
		form: form
		h1: h1
		h2: h2
		h3: h3
		footer: footer
		header: header
		input: input
		code: code
		label: label
		legend: legend
		img: img
		li: li
		meta: meta
		path: path
		nav: nav
		ol: ol
		p: p
		pre: pre
		section: section
		small: small
		span: span
		svg: svg
		data: data
		time: time
		strong: strong
		summary: summary
		ul: ul
		style: style
		'basic-blogmeta': BasicBlogmetaAttrs
		'basic-button': BasicButtonAttrs
		'basic-counter': BasicCounterAttrs
		'card-callout': CardCalloutAttrs
		'context-media': ContextMediaAttrs
		'basic-number': BasicNumberAttrs
		'module-calctable': ModuleCalctableAttrs
		'form-combobox': FormComboboxAttrs
		'form-listbox': FormListboxAttrs
		'form-checkbox': FormCheckboxAttrs
		'form-radiogroup': FormRadiogroupAttrs
		'module-codeblock': ModuleCodeblockAttrs
		'module-carousel': ModuleCarouselAttrs
		'module-catalog': ModuleCatalogAttrs
		'module-cem-list': ModuleCemListAttrs
		'module-coloreditor': ModuleColoreditorAttrs
		'module-colorinfo': ModuleColorinfoAttrs
		'module-dialog': ModuleDialogAttrs
		'module-lazyload': ModuleLazyloadAttrs
		'module-list': ModuleListAttrs
		'module-listnav': ModuleListnavAttrs
		'module-pagination': ModulePaginationAttrs
		'module-scrollarea': ModuleScrollareaAttrs
		'module-splitview': ModuleSplitviewAttrs
		'module-ticker': ModuleTickerAttrs
		'module-todo': ModuleTodoAttrs
		'section-menu': SectionMenuAttrs
		'sync-el': SyncElAttrs
		'async-el': AsyncElAttrs
		'css-probe': CssProbeAttrs
		'css-probe-child': CssProbeChildAttrs
		'x-kid-widget': XKidWidgetAttrs
		'test-listitem-tsx': TestListitemTsxAttrs
		'queue-board': QueueBoardAttrs
		'truc:try': TrucTryAttrs
	}
}
