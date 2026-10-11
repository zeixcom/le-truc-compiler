/** What the realm cannot answer — the classifier-facing half of the patch table: the globals no realm answers and the member reads a realm answers wrong, kept substrate-independent so the classifier runs with no driver installed. */

/* === Types === */

export type UnanswerableGlobal = {
	/** Global name as authored */
	name: string
	/** `stub` — absent from the realm; `network` — present but closed. */
	kind: 'stub' | 'network'
	/** Why this one is unanswerable, in the census's words. */
	note?: string
}

export type CapabilityPatch = {
	/** Member name as authored (`scrollLeft`, `getBoundingClientRect`). */
	member: string
	/** Restrict to reads off this receiver name; omitted means any. */
	receiver?: string
	/** Why the realm cannot answer it. */
	note: string
}

/* === The tables === */

export const UNANSWERABLE_GLOBALS: readonly UnanswerableGlobal[] = [
	// --- Absent from the realm, stubbed inert ------------------------------
	{
		name: 'ResizeObserver',
		kind: 'stub',
		note: 'no realm observes layout; the stub never fires',
	},
	{ name: 'IntersectionObserver', kind: 'stub' },
	{ name: 'PerformanceObserver', kind: 'stub' },
	{
		name: 'matchMedia',
		kind: 'stub',
		note: 'the realm has no viewport; the list never matches and never changes',
	},
	{
		name: 'requestAnimationFrame',
		kind: 'stub',
		note: 'a frame callback fires after the serialization boundary',
	},
	{ name: 'cancelAnimationFrame', kind: 'stub' },
	{ name: 'requestIdleCallback', kind: 'stub' },
	{ name: 'cancelIdleCallback', kind: 'stub' },
	{ name: 'scrollTo', kind: 'stub' },
	{
		name: 'history',
		kind: 'stub',
		note: 'the build has no session history; navigation calls are inert',
	},

	// --- Present but closed ------------------------------------------------
	{
		name: 'fetch',
		kind: 'network',
		note: 'the build realm is closed to the network',
	},
	{ name: 'XMLHttpRequest', kind: 'network' },
	{ name: 'WebSocket', kind: 'network' },
	{ name: 'EventSource', kind: 'network' },
	{ name: 'Request', kind: 'network' },
	{ name: 'navigator.sendBeacon', kind: 'network' },
]

export const CAPABILITY_PATCHES: readonly CapabilityPatch[] = [
	// --- Layout geometry: jsdom returns silent zeros -----------------------
	...(
		[
			'scrollLeft',
			'scrollTop',
			'scrollWidth',
			'scrollHeight',
			'offsetWidth',
			'offsetHeight',
			'offsetLeft',
			'offsetTop',
			'clientWidth',
			'clientHeight',
			'clientLeft',
			'clientTop',
			'getBoundingClientRect',
			'getClientRects',
		] as const
	).map(
		(member): CapabilityPatch => ({
			member,
			note: 'jsdom has no layout engine — this reads as a silent zero',
		}),
	),
	// --- ElementInternals: only the members jsdom does not implement -------
	{
		member: 'states',
		receiver: 'internals',
		note: "jsdom's skeletal ElementInternals has no custom-state set",
	},
	{
		member: 'setFormValue',
		receiver: 'internals',
		note: 'form association degrades to no internals (LT-150 shape check)',
	},
	{
		member: 'setValidity',
		receiver: 'internals',
		note: 'form association degrades to no internals (LT-150 shape check)',
	},
	{
		member: 'form',
		receiver: 'internals',
		note: 'form association degrades to no internals (LT-150 shape check)',
	},
	{
		member: 'validity',
		receiver: 'internals',
		note: 'form association degrades to no internals (LT-150 shape check)',
	},
]

/* === The reason vocabulary === */

export const UNANSWERABLE_GLOBAL_NAMES: ReadonlySet<string> = new Set(
	UNANSWERABLE_GLOBALS.map(global => global.name.split('.')[0] ?? global.name),
)

/** Capability rows keyed by member name, for the member-read check. */
export const UNANSWERABLE_MEMBERS: ReadonlyMap<string, CapabilityPatch> =
	new Map(CAPABILITY_PATCHES.map(patch => [patch.member, patch]))

export const unanswerableGlobalReason = (name: string): string =>
	`\`${name}\` is stubbed in the simulation realm`

/** Census copy for a member read the realm answers wrong. */
export const unanswerableMemberReason = (patch: CapabilityPatch): string =>
	`\`${patch.member}\`: ${patch.note}`
