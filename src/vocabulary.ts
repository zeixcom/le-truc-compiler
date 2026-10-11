/** The recognized-name vocabulary of the compiler: signal constructors, context members, parser factories, real `@zeix/le-truc` exports, reserved and managed prop names, JS/DOM globals. Name tables only — the AST walks that consult them live in `ast-utils.ts`. */

export const MUTABLE_SIGNAL_CONSTRUCTOR_NAMES = [
	'createCell',
	'createState',
	'createList',
	'createStore',
] as const

export const MUTABLE_SIGNAL_CONSTRUCTORS: ReadonlySet<string> = new Set<string>(
	MUTABLE_SIGNAL_CONSTRUCTOR_NAMES,
)

/** Signal constructor names recognized in setup declarations. */
export const SIGNAL_CONSTRUCTOR_NAMES = [
	...MUTABLE_SIGNAL_CONSTRUCTOR_NAMES,
	'deriveCell',
	'deriveList',
	'deriveStore',
	'createMemo',
	'createSensor',
	'createTask',
] as const

export const SIGNAL_CONSTRUCTORS: ReadonlySet<string> = new Set<string>(
	SIGNAL_CONSTRUCTOR_NAMES,
)

export const SCALAR_HARVEST_CONSTRUCTORS: ReadonlySet<string> = new Set([
	'createCell',
	'createState',
	'createStore',
])

/** Parser factory names recognized as ambients in `expose()` initializers. */
export const PARSER_FACTORY_NAMES = [
	'asString',
	'asInteger',
	'asNumber',
	'asBoolean',
	'asEnum',
	'asClampedInteger',
	'asJSON',
] as const

export const PARSER_FACTORIES: ReadonlySet<string> = new Set<string>(
	PARSER_FACTORY_NAMES,
)

export const SEMANTICALLY_LOADED_ATTRS: ReadonlySet<string> = new Set<string>([
	'hidden',
	'disabled',
	'checked',
	'selected',
	'aria-expanded',
])

export const DIRTY_FLAG_ATTRS: ReadonlySet<string> = new Set<string>([
	'value',
	'checked',
	'selected',
])

export const DIRTY_FLAG_CONTROL_TAG_NAMES = [
	'input',
	'select',
	'textarea',
	'option',
] as const

export type DirtyFlagControlTag = (typeof DIRTY_FLAG_CONTROL_TAG_NAMES)[number]

export const DIRTY_FLAG_CONTROL_TAGS: ReadonlySet<string> = new Set<string>(
	DIRTY_FLAG_CONTROL_TAG_NAMES,
)

export const isDirtyFlagControlAttr = (tag: string, attr: string): boolean =>
	DIRTY_FLAG_ATTRS.has(attr) && DIRTY_FLAG_CONTROL_TAGS.has(tag)

export const SUBMITTABLE_FORM_CONTROL_TAGS: ReadonlySet<string> = new Set([
	'input',
	'select',
	'textarea',
	'button',
])

export const CONTEXT_NAMES: ReadonlySet<string> = new Set<string>([
	'host',
	'internals',
	'requestContext',
	'provideContexts',
])

export const FACTORY_CONTEXT_MEMBER_NAMES = [
	'all',
	'expose',
	'first',
	'on',
	'pass',
	'watch',
] as const

export const FACTORY_CONTEXT_MEMBERS: ReadonlySet<string> = new Set<string>(
	FACTORY_CONTEXT_MEMBER_NAMES,
)

export const REAL_EXPORT_NAMES: ReadonlySet<string> = new Set<string>([
	...SIGNAL_CONSTRUCTOR_NAMES,
	...PARSER_FACTORY_NAMES,
	// @zeix/cause-effect bridge (index.ts re-exports)
	'abort',
	'batch',
	'CircularDependencyError',
	'createCollection',
	'createComputed',
	'createEffect',
	'createMutableSignal',
	'createScope',
	'createSignal',
	'createSlot',
	'createTask',
	'DEEP_EQUALITY',
	'DEFAULT_EQUALITY',
	'DuplicateKeyError',
	'deriveSignal',
	'EffectConvergenceError',
	'InvalidCallbackError',
	'InvalidSignalValueError',
	'InvalidStoreMutationError',
	'isAsyncFunction',
	'isCell',
	'isCollection',
	'isComputed',
	'isDerivedList',
	'isFunction',
	'isList',
	'isMemo',
	'isMutableCell',
	'isMutableList',
	'isMutableSignal',
	'isMutableStore',
	'isPending',
	'isRecord',
	'isSensor',
	'isSignal',
	'isSignalOfType',
	'isSlot',
	'isState',
	'isStore',
	'isTask',
	'match',
	'NullishSignalValueError',
	'PromiseValueError',
	'ReadonlySignalError',
	'RequiredOwnerError',
	'SKIP_EQUALITY',
	'UnresolvableKeyError',
	'UnsetSignalValueError',
	'unown',
	'untrack',
	// src/bindings
	'bindAria',
	'bindAttribute',
	'bindClass',
	'bindProperty',
	'bindState',
	'bindStyle',
	'bindText',
	'bindVisible',
	'configureHtmlSanitizer',
	'dangerouslyBindInnerHTML',
	'escapeHTML',
	'safeSetAttribute',
	'sanitizeHtml',
	'setTextPreservingComments',
	// src/component, src/errors
	'defineComponent',
	'DependencyTimeoutError',
	'ExtensionCollisionError',
	'InvalidComponentNameError',
	'InvalidCustomElementError',
	'InvalidPassPropertyError',
	'InvalidPropertyNameError',
	'InvalidReactivesError',
	'InvalidSelectorError',
	'InvalidTemplateError',
	'MissingElementError',
	'NoActiveCollectorError',
	'UnsafeAttributeError',
	// src/extensions, src/helpers, src/scheduler
	'observedAttributes',
	'formAssociated',
	'formAssociatedCheckbox',
	'relayValidity',
	'CONTEXT_REQUEST',
	'ContextRequestEvent',
	'createContext',
	'createElementsMemo',
	'query',
	'queryAll',
	'each',
	'reconcile',
	'schedule',
	'throttle',
	// src/parsers, src/types
	'asParser',
	'defineMethod',
	'isMethodProducer',
	'isParser',
	'RESERVED_WORDS_LIST',
])

export const RESERVED_PROP_NAMES: ReadonlySet<string> = new Set<string>([
	'constructor',
	'prototype',
	'__proto__',
	'toString',
	'valueOf',
	'hasOwnProperty',
	'isPrototypeOf',
	'propertyIsEnumerable',
	'toLocaleString',
])

export const COLLECTOR_HELPERS: ReadonlySet<string> = new Set<string>([
	'watch',
	'on',
	'pass',
	'provideContexts',
	'each',
	'reconcile',
])

/** Managed form props usable as string-literal lazy children (text-bindable). */
export const MANAGED_TEXT_PROPS: ReadonlySet<string> = new Set<string>([
	'validationMessage',
])

export const MANAGED_FORM_MEMBERS: ReadonlySet<string> = new Set<string>([
	'form',
	'name',
	'labels',
	'validity',
	'validationMessage',
	'willValidate',
	'checkValidity',
	'reportValidity',
	'setCustomValidity',
	'disabled',
])

export const CLIENT_ONLY_PRIMITIVES: ReadonlySet<string> = new Set<string>([
	'first',
	'all',
	'watch',
	'on',
	'pass',
	'requestContext',
	'provideContexts',
])

export const JS_GLOBALS: ReadonlySet<string> = new Set<string>([
	'Array',
	'BigInt',
	'Boolean',
	'Date',
	'Error',
	'Infinity',
	'JSON',
	'Map',
	'Math',
	'NaN',
	'Number',
	'Object',
	'Promise',
	'RegExp',
	'Set',
	'String',
	'Symbol',
	'WeakMap',
	'WeakSet',
	'decodeURIComponent',
	'decodeURI',
	'encodeURI',
	'encodeURIComponent',
	'globalThis',
	'isFinite',
	'isNaN',
	'parseFloat',
	'parseInt',
	'undefined',
	// DOM globals (generated handlers reference element/event types)
	'console',
	'crypto',
	'document',
	'window',
	'navigator',
	'location',
	'history',
	'performance',
	'CustomEvent',
	'DOMTokenList',
	'Document',
	'Element',
	'Event',
	'EventTarget',
	'FocusEvent',
	'FormData',
	'HTMLAnchorElement',
	'HTMLButtonElement',
	'HTMLCanvasElement',
	'HTMLDivElement',
	'HTMLElement',
	'HTMLFormElement',
	'HTMLInputElement',
	'HTMLSelectElement',
	'HTMLSpanElement',
	'HTMLTemplateElement',
	'HTMLTextAreaElement',
	'InputEvent',
	'Intl',
	'KeyboardEvent',
	'MouseEvent',
	'Node',
	'NodeList',
	'PointerEvent',
	'IntersectionObserver',
	'ResizeObserver',
	'SubmitEvent',
	'URL',
	'URLSearchParams',
	'cancelAnimationFrame',
	'clearInterval',
	'clearTimeout',
	'queueMicrotask',
	'requestAnimationFrame',
	'setInterval',
	'setTimeout',
	'structuredClone',
])
