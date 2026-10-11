/** The simulation realm: applies the patch table to `globalThis` for a simulated connect — load records definitions, render parses then upgrades children-first and drains to quiescence, and disposal is end-of-process. */

import { JSDOM, VirtualConsole } from 'jsdom'
import { dataArmsSelector } from '../codegen'
import {
	type SimDiagnostic,
	type SimRenderRequest,
	type SimRenderResult,
	type SimRuntime,
	type SimulationRealm,
	type SimulationRealmOptions,
	SUPPRESSED_HOST_SELECTOR,
	type SuppressedSite,
} from '../simulation/contract'
import { assertSynchronousWindow, drainToQuiescence } from './boundary'
import {
	detectRuntime,
	NETWORK_GLOBALS,
	type NetworkGlobalPatch,
	patchesFor,
	REALM_GLOBALS,
	STUB_GLOBALS,
	type StubShape,
} from './patch-table'

/* === Types === */

/** A `customElements.define()` call captured during the resolution phase. */
export type RecordedDefinition = {
	name: string
	elementConstructor: CustomElementConstructor
	options?: ElementDefinitionOptions
}

/**
 * One render, as the driver takes it. Structurally the seam's
 * {@link SimRenderRequest}; kept as a local alias so the driver's own
 * call sites read in its vocabulary.
 */
export type RenderOptions = SimRenderRequest

/**
 * The jsdom driver's own handle — the seam's {@link SimulationRealm} plus
 * the substrate-shaped members its tests and the portability probe need.
 *
 * The split is the point. `window`,
 * `document` and the recorded constructors are jsdom's types, so they
 * cannot appear on the interface the compiler programs against — a
 * consumer who opted out of jsdom would not be able to typecheck it. They
 * are still legitimate INSIDE the driver, which is where the substrate is
 * known; when `@zeix/le-truc-simulation` splits out, this
 * type goes with it and the compiler is left holding the contract alone.
 *
 * Nothing compiler-side may widen to this type. `loadedTags` exists on the
 * seam precisely so no caller needs `definitions` for the one thing it was
 * ever read for.
 */
export type JsdomSimulationRealm = SimulationRealm & {
	readonly window: JSDOM['window']
	readonly document: Document
	/** Definitions captured during the resolution phase, in recording order. */
	readonly definitions: readonly RecordedDefinition[]
}

/* === Internal Functions === */

const asRecord = (value: object) => value as unknown as Record<string, unknown>

/** Resolve a possibly dotted patch name to its owner object and leaf key. */
const resolveTarget = (
	root: Record<string, unknown>,
	name: string,
): { owner: Record<string, unknown>; key: string } | null => {
	const parts = name.split('.')
	let owner: Record<string, unknown> = root
	for (const part of parts.slice(0, -1)) {
		const next = owner[part]
		if (typeof next !== 'object' || next === null) return null
		owner = next as Record<string, unknown>
	}
	const key = parts.at(-1)
	return key === undefined ? null : { owner, key }
}

const stubFor = (shape: StubShape): unknown => {
	switch (shape) {
		case 'observer':
			return class {
				observe() {}
				unobserve() {}
				disconnect() {}
				takeRecords() {
					return []
				}
			}
		case 'match-media':
			return (query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addListener() {},
				removeListener() {},
				addEventListener() {},
				removeEventListener() {},
				dispatchEvent: () => false,
			})
		case 'animation-frame':
			// Returns a handle but never calls back: anything it would have
			// scheduled lands after the serialization boundary anyway.
			return () => 0
		case 'cancel':
		case 'noop':
			return () => {}
		case 'history':
			// The build has no session history: navigation calls are inert and
			// the stack is the one entry being rendered.
			return {
				length: 1,
				scrollRestoration: 'auto',
				state: null,
				back() {},
				forward() {},
				go() {},
				pushState() {},
				replaceState() {},
			}
	}
}

/**
 * Order `definitions` so every entry's composed children (per
 * `composesTags`) come before it — a DFS post-order topological sort,
 * stable on the input order for unrelated entries.
 *
 * `define()` call order decides jsdom upgrade order: a composed child that its
 * parent's client module never imports (pure server-splice composition, no
 * `pass()`/`first()` binding) has no import-graph relationship to its
 * parent, so nothing about import/recording order guarantees it is defined
 * first. The compose graph is the only source of truth for that
 * relationship, hence `composesTags` is threaded in rather than inferred.
 */
export function childrenFirstOrder(
	definitions: readonly RecordedDefinition[],
	composesTags: (tag: string) => readonly string[],
): RecordedDefinition[] {
	const byName = new Map(definitions.map(entry => [entry.name, entry]))
	const visited = new Set<string>()
	const ordered: RecordedDefinition[] = []
	const visit = (name: string): void => {
		if (visited.has(name)) return
		visited.add(name)
		for (const child of composesTags(name)) visit(child)
		const entry = byName.get(name)
		if (entry) ordered.push(entry)
	}
	for (const entry of definitions) visit(entry.name)
	return ordered
}

/* === Exported Functions === */

/**
 * Build a simulation realm with the patch table applied to `globalThis`.
 *
 * The patches are process-global for the realm's lifetime, so a realm owns the
 * process while it lives — `dispose()` restores every touched global to the
 * descriptor it found. One realm per build, disposed
 * only at end-of-process (see the module header).
 *
 * @param options.html - the shell document; defaults to an empty body
 * @param options.composesTags - direct composed-child tags for a defined
 *   tag, from the compiler's compose graph (`RegistryEntry.composesTags`).
 *   Defaults to "no known children" — correct for the driver's own inline
 *   test fixtures, which have no composition.
 * @returns the realm handle
 */
export function createSimulationRealm(
	options: SimulationRealmOptions = {},
): JsdomSimulationRealm {
	const composesTags = options.composesTags ?? (() => [])
	const suppressedSites = options.suppressedSites ?? (() => [])
	const runtime = detectRuntime()
	const diagnostics: SimDiagnostic[] = []
	const definitions: RecordedDefinition[] = []
	/** The component whose synchronous window is open, so realm-level channels (jsdom errors, console, network) are attributed rather than anonymous. */
	let currentComponent: string | undefined
	const report = (diagnostic: SimDiagnostic) => {
		diagnostics.push(
			diagnostic.component === undefined && currentComponent !== undefined
				? { ...diagnostic, component: currentComponent }
				: diagnostic,
		)
	}

	/** Capture the HOST console for one load/render window — the library's own containment reports to the process console, never to jsdom's virtualConsole, so without this a degraded connect would serve wrong HTML with no signal; everything the window logs at `error`/`warn` is recorded, and output is captured rather than forwarded so the report is the single place a failure is stated. */
	const hostConsole = globalThis.console as unknown as Record<
		string,
		(...args: unknown[]) => void
	>
	const CAPTURED_LEVELS = ['error', 'warn'] as const
	const captureHostConsole = (): (() => void) => {
		const original = CAPTURED_LEVELS.map(
			level => [level, hostConsole[level]] as const,
		)
		for (const level of CAPTURED_LEVELS)
			hostConsole[level] = (...args: unknown[]) => {
				const thrown = args.find(arg => arg instanceof Error) as
					| Error
					| undefined
				report({
					kind: 'console',
					level,
					message: args.map(String).join(' '),
					...(thrown?.stack === undefined ? {} : { stack: thrown.stack }),
				})
			}
		return () => {
			for (const [level, fn] of original)
				if (fn !== undefined) hostConsole[level] = fn
		}
	}

	const virtualConsole = new VirtualConsole()
	virtualConsole.on('jsdomError', (error: Error) => {
		const cause = (error.cause as Error | undefined) ?? error
		report({
			kind: 'jsdom-error',
			message: String(cause?.message ?? cause),
			...(cause?.stack === undefined ? {} : { stack: cause.stack }),
		})
	})
	for (const level of ['error', 'warn'] as const)
		virtualConsole.on(level, (...args: unknown[]) => {
			report({ kind: 'console', level, message: args.map(String).join(' ') })
		})

	const dom = new JSDOM(
		options.html ?? '<!DOCTYPE html><html><body></body></html>',
		{ virtualConsole, pretendToBeVisual: false },
	)
	const { window } = dom
	const document = window.document as unknown as Document
	const realRegistry = window.customElements as unknown as CustomElementRegistry

	// --- Apply the patch table -------------------------------------------

	const root = globalThis as unknown as Record<string, unknown>
	const restores: Array<() => void> = []

	const force = (name: string, value: unknown) => {
		const target = resolveTarget(root, name)
		if (!target) return
		const { owner, key } = target
		const previous = Object.getOwnPropertyDescriptor(owner, key)
		try {
			Object.defineProperty(owner, key, {
				value,
				writable: true,
				configurable: true,
				enumerable: previous?.enumerable ?? false,
			})
		} catch {
			// Deno marks a few globals non-configurable; skip rather than abort, and let the probe's cross-runtime diff surface any consequence.
			report({
				kind: 'console',
				message: `Could not patch global '${name}' under ${runtime}`,
			})
			return
		}
		restores.push(() => {
			if (previous) Object.defineProperty(owner, key, previous)
			else delete owner[key]
		})
	}

	const windowRecord = asRecord(window as unknown as object)
	for (const patch of patchesFor(REALM_GLOBALS, runtime)) {
		const value = windowRecord[patch.from ?? patch.name]
		if (value === undefined) continue
		// Constructors go across verbatim — a bound copy breaks both `instanceof` and `class X extends HTMLElement`; free functions (`getComputedStyle`) need their receiver.
		const isConstructor =
			typeof value === 'function' && /^[A-Z]/.test(patch.name)
		force(
			patch.name,
			typeof value === 'function' && !isConstructor
				? value.bind(window)
				: value,
		)
	}

	for (const patch of patchesFor(STUB_GLOBALS, runtime)) {
		const present =
			windowRecord[patch.name] !== undefined || root[patch.name] !== undefined
		if (present && !patch.force) continue
		force(patch.name, stubFor(patch.shape))
	}

	const denyNetwork = (patch: NetworkGlobalPatch) => {
		const message =
			`network access from a simulated connect (\`${patch.name}()\`) — the ` +
			'build realm is closed (ADR 0006 sub-design 2d). Declare build-time ' +
			'data as a resolution-phase dependency instead.'
		// Never settles: a rejection would route every fetching component to `@catch` under the quiescence drain, but the build cannot know the request failed — it never ran; a never-settling promise keeps the component's task at `nil`, which SSG requires. Reported at CALL time, so "fails loudly" is unaffected either way.
		const deny = () => {
			report({ kind: 'network', message })
			return new Promise<never>(() => {})
		}
		return patch.form === 'function'
			? deny
			: class {
					constructor() {
						report({ kind: 'network', message })
						throw new Error(message)
					}
				}
	}
	for (const patch of patchesFor(NETWORK_GLOBALS, runtime)) {
		force(patch.name, denyNetwork(patch))
		const inRealm = resolveTarget(windowRecord, patch.name)
		if (inRealm && inRealm.key in inRealm.owner) {
			const previous = Object.getOwnPropertyDescriptor(
				inRealm.owner,
				inRealm.key,
			)
			try {
				Object.defineProperty(inRealm.owner, inRealm.key, {
					value: denyNetwork(patch),
					writable: true,
					configurable: true,
				})
				restores.push(() => {
					if (previous)
						Object.defineProperty(inRealm.owner, inRealm.key, previous)
				})
			} catch {
				/* realm-side copy is best effort; the global is the load-bearing one */
			}
		}
	}

	// Timers scheduled while the realm is open are the realm's: a contained component's dependency wait and context retries run on the HOST timer queue, which `window.close()` does not own — so a timer outliving `dispose()` fires against restored globals and lands as an uncaught error in whatever runs next. Tracking wraps keep the host handles; `dispose()` cancels whatever is still pending.
	const pendingTimers = new Map<unknown, (handle: unknown) => void>()
	type TimerFn = (fn: unknown, delay?: number, ...args: unknown[]) => unknown
	type ClearFn = (handle: unknown) => void
	const ownTimers = (set: string, clear: string, repeats: boolean) => {
		const hostSet = root[set] as TimerFn | undefined
		const hostClear = root[clear] as ClearFn | undefined
		if (typeof hostSet !== 'function' || typeof hostClear !== 'function') return
		force(set, (fn: unknown, delay?: number, ...args: unknown[]) => {
			if (typeof fn !== 'function') return hostSet(fn, delay, ...args)
			const handle = hostSet(
				(...fired: unknown[]) => {
					if (!repeats) pendingTimers.delete(handle)
					return (fn as (...a: unknown[]) => unknown)(...fired)
				},
				delay,
				...args,
			)
			pendingTimers.set(handle, hostClear)
			return handle
		})
		force(clear, (handle: unknown) => {
			pendingTimers.delete(handle)
			hostClear(handle)
		})
	}
	ownTimers('setTimeout', 'clearTimeout', false)
	ownTimers('setInterval', 'clearInterval', true)

	const onRejection = (reason: unknown) => {
		report({
			kind: 'unhandled-rejection',
			message: String((reason as { message?: string })?.message ?? reason),
		})
	}
	type ProcessLike = {
		on?: (event: string, handler: (reason: unknown) => void) => void
		off?: (event: string, handler: (reason: unknown) => void) => void
	}
	const processLike = root.process as ProcessLike | undefined
	processLike?.on?.('unhandledRejection', onRejection)

	// --- Phases -----------------------------------------------------------

	const recordingRegistry = {
		define(
			name: string,
			elementConstructor: CustomElementConstructor,
			elementOptions?: ElementDefinitionOptions,
		) {
			definitions.push({
				name,
				elementConstructor,
				...(elementOptions === undefined ? {} : { options: elementOptions }),
			})
		},
		get(name: string) {
			return (
				realRegistry.get(name) ??
				definitions.find(entry => entry.name === name)?.elementConstructor
			)
		},
		getName(elementConstructor: CustomElementConstructor) {
			return (
				definitions.find(
					entry => entry.elementConstructor === elementConstructor,
				)?.name ?? null
			)
		},
		whenDefined: (name: string) => realRegistry.whenDefined(name),
		upgrade: (node: Node) => realRegistry.upgrade(node),
	}

	/** The live arm of arm set `armSet` in `container`: the element immediately before the set's first `<template data-arms>`, when its `data-key` names one of the set's arms and it is neither a `<template>` nor a `[data-arms]` carrier. */
	const liveArmOf = (container: Element, armSet: number): Element | null => {
		// The same selector the generated clients run (`dataArmsSelector`) against the stamp the server emitter writes.
		const templates = container.querySelectorAll(dataArmsSelector(armSet))
		const previous = templates[0]?.previousElementSibling ?? null
		const key = previous?.getAttribute('data-key') ?? null
		return previous !== null &&
			key !== null &&
			[...templates].some(t => t.getAttribute('data-key') === key) &&
			previous.localName !== 'template' &&
			!previous.hasAttribute('data-arms')
			? previous
			: null
	}

	/** Snapshot each suppressed site's server-rendered state from an INERT parse of the markup (a live parse upgrades during the `innerHTML` assignment, so its bindings have already written) and return the closure that restores it after the drain. */
	const snapshotSuppressedSites = (
		component: string,
		markup: string,
	): (() => void) | null => {
		const sites = suppressedSites(component)
		if (sites.length === 0) return null
		const skeleton = document.implementation.createHTMLDocument('')
		skeleton.body.innerHTML = markup
		const live = (site: SuppressedSite): Element | null =>
			site.selector === SUPPRESSED_HOST_SELECTOR
				? document.querySelector(component)
				: document.querySelector(site.selector)
		const undo: Array<() => void> = []
		for (const site of sites) {
			// Snapshot from the skeleton; restore onto the LIVE tree, resolved at restore time (the element exists by then — it was parsed).
			const el =
				site.selector === SUPPRESSED_HOST_SELECTOR
					? skeleton.body.querySelector(component)
					: skeleton.body.querySelector(site.selector)
			if (!el) continue
			if (site.kind === 'arms') {
				// The skeleton holds no live arm for a recorded set; should one be there, the skeleton state already matches and nothing is stripped.
				if (liveArmOf(el, site.armSet)) continue
				undo.push(() => {
					const target = live(site)
					if (target) liveArmOf(target, site.armSet)?.remove()
				})
			} else if (site.kind === 'text') {
				const text = el.textContent
				undo.push(() => {
					const target = live(site)
					if (target) target.textContent = text
				})
			} else {
				const present = el.hasAttribute(site.attr)
				const value = el.getAttribute(site.attr)
				const property =
					site.prop === undefined
						? undefined
						: (el as unknown as Record<string, unknown>)[site.prop]
				undo.push(() => {
					const target = live(site)
					if (!target) return
					if (present) target.setAttribute(site.attr, value ?? '')
					else target.removeAttribute(site.attr)
					if (site.prop !== undefined)
						(target as unknown as Record<string, unknown>)[site.prop] = property
				})
			}
		}
		if (undo.length === 0) return null
		return () => {
			for (const restore of undo) restore()
		}
	}

	const load = async (importer: () => Promise<unknown>) => {
		const before = definitions.length
		force('customElements', recordingRegistry)
		const releaseConsole = captureHostConsole()
		try {
			await importer()
		} finally {
			releaseConsole()
			force('customElements', realRegistry)
		}
		// Load-once is a driver assertion, not a convention: one module cache per process means a bundle imported by an EARLIER realm/load re-evaluates nothing here, and rendering would then silently degrade to un-upgraded SSR markup — invisible in the output, because it looks like ordinary un-upgraded markup.
		if (definitions.length === before)
			throw new Error(
				'load() recorded no element definitions — the imported module was ' +
					'served from the process module cache (one cache per process, ' +
					'ADR 0006 sub-design 10). Load each component exactly once and ' +
					'render it many times.',
			)
	}

	const renderWindow = async ({
		markup,
		component,
		locale,
		maxTurns,
	}: RenderOptions): Promise<string> => {
		// The skeleton snapshot is a pure function of the markup — an inert parse upgrades nothing — so it is taken before the connect window opens at all; restoring happens after the drain, below.
		const restoreSuppressed = snapshotSuppressedSites(component, markup)
		let degraded = false
		const parsed = assertSynchronousWindow(() => {
			currentComponent = component
			try {
				// Seed the page locale onto `<html>` BEFORE the markup parses, so a component reading `getLocale(host)` at connect sees the page's answer rather than the `'en'` fallback. This only narrows the gap — the realm parses one component's markup, so an ancestor `[lang]` below `<html>` stays invisible; the reserved `i18n` parameter is the canonical route.
				if (locale === undefined)
					document.documentElement.removeAttribute('lang')
				else document.documentElement.setAttribute('lang', locale)
				// Parsed while still undefined: the pre-parsed upgrade path, which gives `connectedCallback` its child-before-parent order.
				document.body.innerHTML = markup
				// Children-first: define() call order decides jsdom upgrade order, and the compose graph — not recording order — is the only source of truth for which tags contain which.
				for (const entry of childrenFirstOrder(definitions, composesTags)) {
					if (realRegistry.get(entry.name)) continue
					realRegistry.define(
						entry.name,
						entry.elementConstructor,
						entry.options as ElementDefinitionOptions,
					)
				}
			} catch (error) {
				// A throwing component degrades to plain SSR output and never blocks the build.
				report({
					kind: 'component-throw',
					component,
					message: String((error as Error)?.message ?? error),
					...((error as Error)?.stack === undefined
						? {}
						: { stack: (error as Error).stack as string }),
				})
				degraded = true
				return markup
			}
			const rendered = document.querySelector(component)
			return rendered?.outerHTML ?? document.body.innerHTML
		}, component)

		// Hermetic quiescence: drain the microtask queue — never a timer — until the component's own markup stops changing, or the bound expires; skipped when the parse step already degraded to plain SSR output (nothing upgraded, nothing to settle).
		if (degraded) return parsed
		const readRendered = () =>
			document.querySelector(component)?.outerHTML ?? parsed
		const { value, quiescent, turns } = await drainToQuiescence(
			readRendered,
			maxTurns,
		)
		// The revert runs strictly AFTER the drain has stabilized — the stability comparison must observe the unsuppressed tree, and a revert inside the drain loop would either oscillate against the live binding or mask a genuine non-quiescence — and the final serialization snapshot is taken only AFTER the revert, so the returned bytes never carry the build machine's reading.
		let html = value
		if (restoreSuppressed) {
			restoreSuppressed()
			html = readRendered()
		}
		if (!quiescent)
			report({
				kind: 'non-quiescent',
				component,
				message:
					`did not settle within ${turns} microtask turns — a reactive ` +
					'effect is re-triggering itself at connect (ADR 0006 sub-design ' +
					'9). The build shipped the last observed state rather than hang. ' +
					'Find the self-triggering effect before relying on this markup.',
			})
		return html
	}

	/** Tear down the previous render's tree under ITS attribution, before the next window opens — and, from `dispose()`, the last render's tree before the realm retires. Disconnect runs component code (a composing parent's `pass()` restore re-fires its child's effects), so a teardown left to the next window's `innerHTML` would blame an innocent component; draining the microtask queue afterwards does the same for anything the teardown queued. */
	const settlePreviousRender = async (): Promise<void> => {
		if (!document.body.hasChildNodes()) return
		document.body.replaceChildren()
		await drainToQuiescence(() => String(diagnostics.length))
	}

	/** The render window, with the host console captured for its duration — the connect this drives is where the library's own containment reports, and that report is the build's only signal that a component degraded instead of enhancing. The returned `diagnostics` are this call's slice off the cumulative list. */
	const render = async (
		request: SimRenderRequest,
	): Promise<SimRenderResult> => {
		const releaseConsole = captureHostConsole()
		try {
			await settlePreviousRender()
			const before = diagnostics.length
			const html = await renderWindow(request)
			return { html, diagnostics: diagnostics.slice(before) }
		} finally {
			releaseConsole()
		}
	}

	/** The in-flight or completed disposal, for idempotence. */
	let disposal: Promise<void> | null = null

	/** Tear down the last render's tree, then retire the realm — idempotent: a second call returns the first disposal's promise. The simulation pass disposes before the report is computed and keeps a disposal in its `finally` for the error path; the guard makes the two coincide. */
	const dispose = (): Promise<void> => {
		if (disposal) return disposal
		disposal = (async () => {
			const releaseConsole = captureHostConsole()
			try {
				await settlePreviousRender()
			} finally {
				releaseConsole()
			}
			processLike?.off?.('unhandledRejection', onRejection)
			for (const [handle, clear] of pendingTimers) clear(handle)
			pendingTimers.clear()
			for (const restore of restores.reverse()) restore()
			window.close()
		})()
		return disposal
	}

	return {
		runtime,
		window,
		document,
		diagnostics,
		definitions,
		// Live, because `load()` appends: a caller checking whether a composed child was already recorded by its parent's load must see the result of the load it just awaited.
		get loadedTags() {
			return definitions.map(entry => entry.name)
		},
		load,
		render,
		dispose,
	}
}
