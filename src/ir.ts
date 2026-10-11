import type { StyleSheet } from 'lightningcss-wasm'
import type { AstNode } from './ast-utils'
import type { MessageArg } from './icu/parse'
import type { Surface } from './surface'

/* === Types === */

export type ComponentSheet = StyleSheet

export type SourceRange = { start: number; end: number }

/** A verbatim setup/side-effect statement. */
export type SetupStmt = {
	text: string
	range: SourceRange
	/** The statement's own free-name-bearing expression. */
	node: AstNode
	/** Declared const name (signals, plain consts), or `null` for `expose()`. */
	name: string | null
	slices?: ReadonlyArray<{ text: string; start: number }>
}

export type SignalConstructor =
	| 'createCell'
	| 'createState'
	| 'createList'
	| 'createStore'
	| 'deriveCell'
	| 'deriveList'
	| 'deriveStore'
	| 'createMemo'
	| 'createSensor'
	| 'createTask'
	| 'requestContext'

export type ExposeKind = 'slot' | 'computed' | 'method'

/** The one `expose({...})` call — four views of the same statement. */
export type ExposeStmt = {
	/** The call expression's text, verbatim. */
	text: string
	/** Source range of `text`. */
	range: SourceRange
	argNode: AstNode | null
	/** Ambient names the call uses (parser factories, `defineMethod`), sorted. */
	ambients: string[]
}

export type ParserExposeDecl = {
	parser: string
	fallbackText: string | null
	fallbackNode: AstNode | null
}

/** One prop `expose()` declares. */
export type ExposePropDecl = {
	kind: ExposeKind
	/** The signal a `prop: signal.get` initializer reads. */
	signalName?: string
	/** The Parser factory call, for `prop: asString('')`. */
	parser?: ParserExposeDecl
	initNode?: AstNode
}

export type FirstRefStage = 'matched' | 'deferred' | 'unmatched' | 'rejected'

export type ChildrenContractIR = {
	roles: ReadonlyMap<string, string | null>
	model: 'any' | 'non-interactive' | null
	unreadable?: boolean
}

/** One `const name = first(selector, reason?)` element reference. */
export type FirstRefDecl = {
	name: string
	selector: string
	required: boolean
	reason: string | null
	stage: FirstRefStage
	/** Source range of the `first()` call's declaration, when known. */
	at: { start?: number | undefined; end?: number | undefined } | undefined
}

/** Fields every signal declaration carries, whatever its family. */
type SignalIRBase = {
	name: string
	/** Declaring expression text, e.g. `createCell(start)`. */
	text: string
	/** Start offset of `text` in the source (relative spans for arg surgery). */
	textStart: number
	inferredType: 'string' | 'number' | 'boolean' | 'unknown'
}

export type DeclaredSignalIR = SignalIRBase & {
	family: 'declared'
	constructor: 'createCell' | 'createState' | 'createList' | 'createStore'
	init: AstNode | null
	/** A seed declared through the `harvest()` marker. */
	harvest?: HarvestSeedIR
	/** A `createList` declaration's item type, read syntactically. */
	listItem?: ListItemIR
	unresolvable?: true
}

/** A harvest parser the compiler infers from a field's type. */
export type InferredParserIR = {
	name: 'asString' | 'asNumber' | 'asBoolean'
	cast: string | null
}

export type HarvestSeedIR =
	| {
			kind: 'list'
			call: AstNode
			entries: Array<{
				field: string
				key: AstNode
				value: AstNode
				text: string
			}>
	  }
	| { kind: 'scalar'; call: AstNode; parser: AstNode; parserText: string }

/** One field of a resolved list item type. */
export type ListItemFieldIR = {
	name: string
	/** The field's type annotation text, as authored; `| undefined` appended for an optional field. */
	typeText: string
	/** The parser its type infers, or null (an object, a `Date`, a union, an optional field). */
	parser: InferredParserIR | null
}

export type ListItemIR = {
	/** The item type's text; null for `unknown`. */
	typeText: string | null
	shape:
		| { kind: 'scalar' }
		| { kind: 'fields'; fields: ListItemFieldIR[] }
		| { kind: 'opaque' }
		| { kind: 'unknown' }
	/** The field `keyConfig` returns verbatim (`item => item.id`), if any. */
	keyField: string | null
}

export type DerivedSignalIR = SignalIRBase & {
	family: 'derived'
	constructor:
		| 'deriveCell'
		| 'deriveList'
		| 'deriveStore'
		| 'createMemo'
		| 'createSensor'
		| 'createTask'
	/** The derive expression node; `null` for an argument-less call. */
	init: AstNode | null
	unresolvable?: true
}

export type ContextSignalIR = SignalIRBase & {
	family: 'context'
	constructor: 'requestContext'
	/** The fallback argument (second call argument) — the server's value. */
	fallback: AstNode
	/** The fallback argument's verbatim source text. */
	fallbackText: string
}

/** A signal declared in the component's setup, by constructor family. */
export type SignalIR = DeclaredSignalIR | DerivedSignalIR | ContextSignalIR

/** A signal with an initializer — every family but `requestContext`. */
export type InitSignalIR = DeclaredSignalIR | DerivedSignalIR

export type ReactivityClass = 'static' | 'server' | 'reactive'

export type DependencyClosure = {
	signals: readonly string[]
	hostProps: readonly string[]
	args: readonly string[]
	bound: readonly string[]
}

/** Template IR — the shared input of both emitters. */
export type TemplateNode =
	| {
			kind: 'element'
			tag: string
			attrs: AttributeIR[]
			children: TemplateNode[]
			node: AstNode
	  }
	| {
			kind: 'text'
			value: string
			node?: AstNode
	  }
	| {
			kind: 'expr'
			/** `{expr}` child expression. */
			expr: AstNode
			exprText: string
			reactivity: Exclude<ReactivityClass, 'static'>
			/** What the child reads. */
			deps: DependencyClosure
			bindsProp?: string
			node: AstNode
	  }
	| {
			kind: 'conditional'
			construct: 'if' | 'switch'
			mode: 'server' | 'reactive'
			/** The `@if` test, or the `@switch` discriminant. */
			test: AstNode
			testText: string
			arms: ArmTemplate[]
			initial: InitialWinner
			node: AstNode
	  }
	| {
			kind: 'try'
			children: TemplateNode[]
			catchParam: string | null
			catchChildren: TemplateNode[]
			pendingChildren: TemplateNode[] | null
			node: AstNode
	  }
	| {
			kind: 'compose'
			component: string
			source: string
			attrs: ComposeAttrIR[]
			children: TemplateNode[]
			node: AstNode
	  }
	| {
			kind: 'client-stmt'
			text: string
			node: AstNode
	  }

export type ArmTemplate = {
	key: string
	/** The `@case` test expression; null for `then`/`else`/`default`. */
	test: AstNode | null
	testText: string | null
	children: TemplateNode[]
}

export type InitialWinner =
	| { constant: string | null }
	| {
			select: Array<{ when: string; key: string | null }>
			otherwise: string | null
	  }
	| { fold: true }

export type PassEntryIR = {
	prop: string
	thunk: AstNode
	thunkText: string
	setThunk?: AstNode
	setThunkText?: string
}

export type AttributeIR =
	| { kind: 'static'; name: string; value: string | null }
	| {
			kind: 'server'
			name: string
			exprText: string
			node: AstNode
			deps: DependencyClosure
			bindsProp?: string
	  }
	| {
			kind: 'reactive'
			name: string
			thunk: AstNode
			thunkText: string
			deps: DependencyClosure
	  }
	| { kind: 'pass'; entries: PassEntryIR[] }
	| {
			kind: 'class-map'
			thunkText: string
			/** The arrow function node — thunkText's own source range. */
			thunk: AstNode
			object: AstNode
			deps: DependencyClosure
	  }
	| {
			kind: 'style-map'
			thunkText: string
			/** The arrow function node — thunkText's own source range. */
			thunk: AstNode
			object: AstNode
			deps: DependencyClosure
	  }
	| ({
			kind: 'html'
			exprText: string
			node: AstNode
			/** What the value reads — the thunk's, for the reactive form. */
			deps: DependencyClosure
	  } & (
			| { reactive: false }
			| { reactive: true; thunk: AstNode; thunkText: string }
	  ))
	| {
			kind: 'event'
			name: string
			event: string
			handler: AstNode
			handlerText: string
	  }
	| {
			kind: 'handler-arg'
			name: string
			event: string
			arg: string
			node: AstNode
	  }
	| {
			kind: 'ref'
			name: string
			selector?: string
	  }

export type ComposeAttrIR =
	| { kind: 'ref'; name: string }
	| { kind: 'arg'; name: string; exprText: string; node: AstNode | null }
	| { kind: 'pass'; entries: PassEntryIR[] }
	| {
			kind: 'handler'
			name: string
			handler: AstNode
			handlerText: string
			forward: string | null
	  }

/** Fields every `@for` loop carries, whichever lowering it takes. */
type ForIRBase = {
	itemName: string
	output: TemplateNode & { kind: 'element' }
	node: AstNode
	emptyArm: TemplateNode[] | null
}
export type EachForIR = ForIRBase & {
	kind: 'each'
	indexName: string | null
	iterableText: string
	iterable: AstNode
	/** The iterable when it is a bare identifier, else null. */
	iterableName: string | null
	/** const declarations before the output element, in order. */
	hoisted: Array<{ name: string; initText: string; node: AstNode }>
}

export type ReconcileForIR = ForIRBase & {
	kind: 'reconcile'
	/** Declared createList signal name. */
	listSignal: string
	/** Verbatim key clause text, when present. */
	keyText: string | null
	/** Key binding name when the key clause is a bare identifier (`key k`). */
	keyName: string | null
	/** The item's setup statements, in source order. */
	setup: ItemSetupStmt[]
}

export type ItemSetupStmt =
	| (SetupStmt & { kind: 'const'; name: string; server: boolean })
	| (SetupStmt & {
			kind: 'signal'
			name: string
			constructor: Exclude<SignalConstructor, 'requestContext'>
	  })
	| (SetupStmt & {
			kind: 'ref'
			name: string
			selector: string
			reason: string | null
			required: boolean
			root: boolean
	  })
	| (SetupStmt & { kind: 'client'; name: null })

/** A `@for` loop, discriminated by its lowering. */
export type ForIR = EachForIR | ReconcileForIR

export type ConfigIR = {
	/** Which form-association extension leads the array (host-typing widener). */
	form: 'value' | 'checked' | null
	/** Attribute names re-parsed post-connect; must be Parser-exposed props. */
	observedAttributes: string[]
}

/** One top-level property of the component's parameter pattern. */
export type ComponentParam = {
	name: string
	/** Verbatim type annotation text (`'string'`, `'number | null'`, …). */
	typeText: string
	/** The pattern declares the key optional (`name?:`). */
	optional: boolean
	/** The pattern carries a default (`name = expr`). */
	hasDefault: boolean
	/** The annotation is `string` — a raw attribute value may pass for it. */
	isString: boolean
	isNumber: boolean
	/** The local name the pattern binds, when it differs from `name`. */
	binding?: string
	/** The pattern's default (`name = expr`), applied when the arg is `undefined`. */
	defaultValue?: AstNode
}

/** A complete component extracted from one `.tsrx` source. */
export type ComponentIR = {
	/** Function name, e.g. `BasicCounter`. */
	name: string
	/** Original source text (diagnostics compute line numbers from it). */
	source: string
	surface?: Surface
	/** Custom element tag from the template root, e.g. `basic-counter`. */
	tag: string
	/** Verbatim function parameter (pattern + type annotation). */
	paramsText: string
	/** Names bound by the parameter pattern (server args). */
	paramNames: string[]
	moduleBindings?: string[]
	messageTBindings?: string[]
	handlerArgs?: ReadonlyMap<string, string>
	messageRecordBindings?: string[]
	paramProps: ComponentParam[]
	i18nMessages: Record<string, string> | null
	i18nArgs?: Record<string, readonly MessageArg[]> | null
	declaresI18n: boolean
	langBinding: string | null
	langArgDefault: string | null
	setup: SetupStmt[]
	clientSetup: SetupStmt[]
	plainSetup: SetupStmt[]
	itemSetup: ItemSetupStmt[]
	signals: SignalIR[]
	/** The `expose({...})` call, or null when the component declares none. */
	expose: ExposeStmt | null
	exposeProps: ReadonlyMap<string, ExposePropDecl>
	contextRefs: string[]
	/** Extension activation from `export const config`, when declared. */
	config: ConfigIR | null
	/** Template root element IR (style block removed). */
	root: TemplateNode & { kind: 'element' }
	firstRefs: ReadonlyMap<string, FirstRefDecl>
	childrenContract?: ChildrenContractIR
	/** `@for` loops, keyed by their template node. */
	fors: Map<AstNode, ForIR>
	/** Dedented verbatim CSS ("" when no style block). */
	css: string
	sheetText?: string | null
	sheet?: ComponentSheet | null
	/** Module-level `type`/`interface` declarations, exported or not, verbatim. */
	typeDecls: string[]
	/** `declare global { … }` block text, verbatim (client module only). */
	globalDecl: string | null
	/** Name of the exported `<Name>Props` type, when authored. */
	propsTypeName: string | null
	componentDoc: string | null
	/** Names considered server-known at template evaluation time. */
	serverKnown: ReadonlySet<string>
	imports: {
		server: string[]
		client: string[]
		serverLocalNames: ReadonlySet<string>
		clientLeTrucNames: ReadonlySet<string>
		plainLocalNames: ReadonlySet<string>
	}
	composedShapes?: ReadonlyMap<string, ComposedMarkup>
}

/** A composed child's DOM tag and every shape its subtree renders. */
export type ComposedMarkup = {
	/** Null when the source has no registry entry — unknown markup. */
	tag: string | null
	shapes: readonly RenderedShape[]
	region: readonly RenderedShape[] | null
	/** The composing parent's tag: the owner its regions are marked with. */
	owner: string
}

export type RenderedShape =
	| {
			kind: 'element'
			tag: string
			attrs: Record<string, string | null>
			dynamic: string[]
	  }
	| {
			kind: 'compose'
			source: string
			attrs: Record<string, string>
			dynamic: string[]
	  }
	| { kind: 'any' }
	| { kind: 'children' }
