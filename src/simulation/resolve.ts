/** The substrate resolver: activation is installation — resolves the simulation driver, answers `null` on genuine absence, and surfaces a broken install. */

import { SIMULATION_SEAM_VERSION, type SimulationProvider } from './contract'

/** Where the driver lives — a relative path now, the `'@zeix/le-truc-simulation'` package name after the split. Held in a variable so the typechecker does not follow it — see the module header. */
const SIMULATION_DRIVER = '../sim/index.ts'

/** The substrate package the driver itself loads (`sim/realm.ts`'s import). */
const SUBSTRATE_PACKAGE = 'jsdom'

/** What the driver specifier resolves to, as it appears in a resolve error. */
const DRIVER_SPECIFIER_TAIL = 'sim/index.ts'

/** Cached across calls: one resolution per process, driver or not. */
let resolved: SimulationProvider | null | undefined

export class SimulationSeamVersionError extends Error {
	constructor(found: number) {
		super(
			`The installed simulation driver speaks seam version ${found}, but ` +
				`this compiler speaks ${SIMULATION_SEAM_VERSION}. Install a driver ` +
				'matching the compiler, or uninstall it to build without the ' +
				'Simulated tier.',
		)
		this.name = 'SimulationSeamVersionError'
	}
}

export const isSubstrateAbsence = (error: unknown): boolean => {
	if (typeof error !== 'object' || error === null) return false
	const { code, name, specifier } = error as {
		code?: string
		name?: string
		specifier?: string
	}
	if (code !== 'ERR_MODULE_NOT_FOUND' && name !== 'ResolveMessage') return false
	// Bun carries the failing specifier as a field.
	const failed =
		specifier ??
		/^(?:Cannot find (?:module|package)) ['"]([^'"]+)['"]/.exec(
			error instanceof Error ? error.message : '',
		)?.[1]
	if (failed === undefined) return false
	return failed === SUBSTRATE_PACKAGE || failed.endsWith(DRIVER_SPECIFIER_TAIL)
}

export const resolveSimulationProvider =
	async (): Promise<SimulationProvider | null> => {
		if (resolved !== undefined) return resolved
		let provider: SimulationProvider | null = null
		try {
			const loaded = (await import(SIMULATION_DRIVER)) as {
				simulationProvider?: SimulationProvider
			}
			provider = loaded.simulationProvider ?? null
		} catch (error) {
			if (!isSubstrateAbsence(error)) throw error
			// The driver or its substrate is genuinely not installed; the caller decides what that means (it routes Static and records a census reason).
			provider = null
		}
		if (provider !== null && provider.seamVersion !== SIMULATION_SEAM_VERSION)
			throw new SimulationSeamVersionError(provider.seamVersion)
		resolved = provider
		return provider
	}

/** Drop the cached resolution. Tests only. */
export const resetSimulationProvider = (): void => {
	resolved = undefined
}
