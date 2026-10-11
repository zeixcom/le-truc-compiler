/** The simulation seam: the whole of what the compiler knows about simulation — the interface a substrate driver must satisfy and nothing else, versioned for the handshake. */

/* === Version === */

export const SIMULATION_SEAM_VERSION = 2

/* === Diagnostics === */

export type SimDiagnosticKind =
	| 'jsdom-error'
	| 'console'
	| 'network'
	| 'unhandled-rejection'
	| 'component-throw'
	| 'non-quiescent'

/** One build warning from a simulated run, attributed where possible. */
export type SimDiagnostic = {
	kind: SimDiagnosticKind
	/** Custom element name, when the driver knows which component caused it. */
	component?: string
	level?: 'error' | 'warn'
	message: string
	stack?: string
}

export type ClassifiedDiagnostic = {
	kind: SimDiagnosticKind
	/** Restrict the classification to one component; undefined matches any. */
	component?: string
	message: RegExp
	/** Why this diagnostic cannot affect the serialized markup. */
	reason: string
	docsOnly?: true
}

/* === Suppression === */

export const SUPPRESSED_HOST_SELECTOR = 'host'

export type SuppressedSite =
	| {
			kind: 'attr'
			/** CSS selector for the element, or {@link SUPPRESSED_HOST_SELECTOR}. */
			selector: string
			/** The content attribute the binding writes. */
			attr: string
			prop?: string
	  }
	| {
			kind: 'text'
			/** CSS selector for the element, or {@link SUPPRESSED_HOST_SELECTOR}. */
			selector: string
	  }
	| {
			kind: 'arms'
			selector: string
			/** The arm set's `data-arms` index. */
			armSet: number
	  }

/* === The realm interface === */

/** The server runtimes a driver must run under. */
export type SimRuntime = 'bun' | 'node' | 'deno' | 'unknown'

/** One render: strings in, strings out. */
export type SimRenderRequest = {
	/** The SSR'd markup for one component, as `emit-server` produced it. */
	markup: string
	/** Custom element name, used to attribute diagnostics and pick the root. */
	component: string
	locale?: string
	/** Bound on the quiescence drain; a driver default applies when omitted. */
	maxTurns?: number
}

export type SimRenderResult = {
	html: string
	diagnostics: readonly SimDiagnostic[]
}

export type SimulationRealmOptions = {
	/** The shell document as markup; a driver default applies when omitted. */
	html?: string
	composesTags?: (tag: string) => readonly string[]
	suppressedSites?: (tag: string) => readonly SuppressedSite[]
}

export type SimulationRealm = {
	readonly runtime: SimRuntime
	/** Every diagnostic recorded since the realm opened. */
	readonly diagnostics: readonly SimDiagnostic[]
	/** Tags whose client module has been loaded, in load order. */
	readonly loadedTags: readonly string[]
	load(importer: () => Promise<unknown>): Promise<void>
	render(request: SimRenderRequest): Promise<SimRenderResult>
	dispose(): Promise<void>
}

export type SimulationProvider = {
	/** The driver's half of the {@link SIMULATION_SEAM_VERSION} handshake. */
	readonly seamVersion: number
	/** Human name for the substrate, for the build log and census reasons. */
	readonly substrate: string
	/** The standing diagnostics this substrate is known to emit. */
	readonly classifications: readonly ClassifiedDiagnostic[]
	createSimulationRealm(options?: SimulationRealmOptions): SimulationRealm
}
