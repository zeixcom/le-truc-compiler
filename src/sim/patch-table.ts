/** The realm patch table: per-runtime force/fill/stub data — the realm's classes forced over host natives, absent constructors stubbed inert, network globals replaced with reporting never-settling stubs. */

import type { SimRuntime } from '../simulation/contract'

export type { SimRuntime }

/* === Types === */

/**
 * A global whose value must come from the jsdom realm. Forced, not filled:
 * an existing host-runtime native is overwritten (Deno de-shadowing).
 */
export type RealmGlobalPatch = {
	kind: 'realm'
	/** Global name, also the property read off the jsdom `window`. */
	name: string
	/** Read from a different `window` property than `name`. */
	from?: string
	/** Scope to specific runtimes; omitted means all. */
	runtimes?: readonly SimRuntime[]
	/** Why this one is in the table. */
	note?: string
}

/** The shape an absent constructor/function is stubbed with. */
export type StubShape =
	| 'observer'
	| 'match-media'
	| 'animation-frame'
	| 'cancel'
	| 'noop'
	| 'history'

/**
 * A global the realm does not implement, stubbed inert so a runs-once-at-connect
 * effect is harmless rather than a `ReferenceError`.
 */
export type StubGlobalPatch = {
	kind: 'stub'
	name: string
	shape: StubShape
	/** Force even when the realm/runtime already provides one. */
	force?: boolean
	runtimes?: readonly SimRuntime[]
	note?: string
}

/**
 * An ambient network global, replaced with a no-op that reports at call
 * time and then NEVER SETTLES.
 * A rejecting stub is wrong under the hermetic-quiescence boundary
 * (`boundary.ts`): draining a rejection to settlement routes every fetching
 * component to its `@catch` arm, but the build cannot know the request
 * failed — it never ran. A promise that never settles keeps the component's
 * task at `nil`, which is what SSG requires and what
 * `match()` renders as `@pending`. The build must never depend on the
 * network either way; only the arm the client ends up
 * shipping changes.
 */
export type NetworkGlobalPatch = {
	kind: 'network'
	name: string
	/** `function` → callable stub; `constructor` → `new`-able stub. */
	form: 'function' | 'constructor'
	runtimes?: readonly SimRuntime[]
	note?: string
}

export type SimPatch = RealmGlobalPatch | StubGlobalPatch | NetworkGlobalPatch

/* === Patch Table === */

/**
 * Realm classes and objects forced onto `globalThis` for the duration of a
 * simulated connect. Ordering is irrelevant; the list is a set.
 */
export const REALM_GLOBALS: readonly RealmGlobalPatch[] = [
	// The document and the registry the upgrade pass runs through.
	{ kind: 'realm', name: 'window' },
	{ kind: 'realm', name: 'self', from: 'window' },
	{ kind: 'realm', name: 'document' },
	{ kind: 'realm', name: 'customElements' },
	{ kind: 'realm', name: 'navigator' },
	{ kind: 'realm', name: 'location' },
	{ kind: 'realm', name: 'getComputedStyle' },

	// Base classes. `instanceof` must be clean within the realm, and an
	// authored `class X extends HTMLElement` must extend the realm's.
	{ kind: 'realm', name: 'EventTarget' },
	{ kind: 'realm', name: 'Node' },
	{ kind: 'realm', name: 'Element' },
	{ kind: 'realm', name: 'HTMLElement' },
	{ kind: 'realm', name: 'DocumentFragment' },
	{ kind: 'realm', name: 'ShadowRoot' },
	{ kind: 'realm', name: 'HTMLTemplateElement' },
	{ kind: 'realm', name: 'HTMLSlotElement' },
	{ kind: 'realm', name: 'HTMLInputElement' },
	{ kind: 'realm', name: 'HTMLButtonElement' },
	{ kind: 'realm', name: 'HTMLSelectElement' },
	{ kind: 'realm', name: 'HTMLTextAreaElement' },
	{ kind: 'realm', name: 'HTMLFormElement' },
	{ kind: 'realm', name: 'HTMLCanvasElement' },
	{ kind: 'realm', name: 'HTMLDialogElement' },
	{ kind: 'realm', name: 'HTMLStyleElement' },
	{ kind: 'realm', name: 'ElementInternals' },
	{ kind: 'realm', name: 'CSSStyleDeclaration' },
	{ kind: 'realm', name: 'DOMTokenList' },
	{ kind: 'realm', name: 'NodeList' },
	{ kind: 'realm', name: 'HTMLCollection' },

	// Event constructors. Deno ships native `Event`/`CustomEvent`; an event
	// constructed from the native class and dispatched at a realm target is
	// the de-shadowing case this table exists for.
	{
		kind: 'realm',
		name: 'Event',
		note: 'Deno/Bun ship a native Event that would shadow the realm',
	},
	{ kind: 'realm', name: 'CustomEvent' },
	{ kind: 'realm', name: 'ErrorEvent' },
	{ kind: 'realm', name: 'InputEvent' },
	{ kind: 'realm', name: 'KeyboardEvent' },
	{ kind: 'realm', name: 'MouseEvent' },
	{ kind: 'realm', name: 'PointerEvent' },
	{ kind: 'realm', name: 'FocusEvent' },
	{ kind: 'realm', name: 'SubmitEvent' },

	// Observers jsdom implements. Deno ships no DOM observers, Bun ships none
	// either — but forcing keeps one rule for the whole column.
	{ kind: 'realm', name: 'MutationObserver' },

	// Form/data types the form extension touches.
	{ kind: 'realm', name: 'FormData' },
	{ kind: 'realm', name: 'DOMException' },
]

/**
 * Constructors and functions absent from jsdom, stubbed inert. `force: true`
 * where a host-runtime native must not be allowed through either: a real
 * `requestAnimationFrame` (Deno, Bun) would schedule work AFTER the synchronous
 * serialization boundary, so its callback could never land in the HTML and its
 * timer would keep the build process alive.
 */
export const STUB_GLOBALS: readonly StubGlobalPatch[] = [
	{
		kind: 'stub',
		name: 'ResizeObserver',
		shape: 'observer',
		note: 'jsdom has none; form-colorgraph observes at connect',
	},
	{ kind: 'stub', name: 'IntersectionObserver', shape: 'observer' },
	{ kind: 'stub', name: 'PerformanceObserver', shape: 'observer' },
	{
		kind: 'stub',
		name: 'matchMedia',
		shape: 'match-media',
		note: 'jsdom has none; returns a never-matching, never-changing list',
	},
	{
		kind: 'stub',
		name: 'requestAnimationFrame',
		shape: 'animation-frame',
		force: true,
		note: 'forced: a real rAF fires after serialization and holds the process open',
	},
	{
		kind: 'stub',
		name: 'cancelAnimationFrame',
		shape: 'cancel',
		force: true,
	},
	{ kind: 'stub', name: 'requestIdleCallback', shape: 'animation-frame' },
	{ kind: 'stub', name: 'cancelIdleCallback', shape: 'cancel' },
	{ kind: 'stub', name: 'scrollTo', shape: 'noop', force: true },
	{
		kind: 'stub',
		name: 'history',
		shape: 'history',
		force: true,
		note: "forced: jsdom's replaceState throws on the realm's opaque about:blank URL; module-listnav syncs its hash at connect (LT-332)",
	},
]

/**
 * Every ambient network global, replaced with a reporting, never-settling
 * stub. Reporting happens at CALL time, so a
 * network attempt is always a build warning regardless of what the component
 * does with the returned promise. The promise itself never settles, which is
 * what keeps a fetching component's task at `nil` and its markup on the
 * `@pending` arm under the quiescence drain — a rejection would route it to
 * `@catch` and ship an arm the build cannot know is right.
 */
export const NETWORK_GLOBALS: readonly NetworkGlobalPatch[] = [
	{
		kind: 'network',
		name: 'fetch',
		form: 'function',
		note: "Bun's fetch survives into the jsdom realm untouched",
	},
	{ kind: 'network', name: 'XMLHttpRequest', form: 'constructor' },
	{ kind: 'network', name: 'WebSocket', form: 'constructor' },
	{ kind: 'network', name: 'EventSource', form: 'constructor' },
	{ kind: 'network', name: 'Request', form: 'constructor' },
	{ kind: 'network', name: 'navigator.sendBeacon', form: 'function' },
]

/* === Runtime Detection === */

/** Which server runtime this process is. */
export function detectRuntime(): SimRuntime {
	const global = globalThis as Record<string, unknown>
	if (global.Deno) return 'deno'
	if (global.Bun) return 'bun'
	if (
		typeof global.process === 'object' &&
		global.process !== null &&
		typeof (global.process as { versions?: { node?: string } }).versions
			?.node === 'string'
	)
		return 'node'
	return 'unknown'
}

/** Filter the table to the entries that apply to `runtime`. */
export function patchesFor<T extends SimPatch>(
	patches: readonly T[],
	runtime: SimRuntime,
): T[] {
	return patches.filter(
		patch =>
			!('runtimes' in patch) ||
			patch.runtimes === undefined ||
			patch.runtimes.includes(runtime),
	)
}
