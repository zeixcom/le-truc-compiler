/** The jsdom simulation driver's published surface: the seam provider (the only entry point the compiler imports) plus the driver's pieces for its own tests and the portability probe. */

import {
	SIMULATION_SEAM_VERSION,
	type SimulationProvider,
} from '../simulation/contract'
import { CLASSIFIED_DIAGNOSTICS } from './classifications'
import { createSimulationRealm } from './realm'

/** The seam handshake, and the only thing the compiler imports from here. */
export const simulationProvider: SimulationProvider = {
	seamVersion: SIMULATION_SEAM_VERSION,
	substrate: 'jsdom',
	classifications: CLASSIFIED_DIAGNOSTICS,
	createSimulationRealm,
}

export {
	assertSynchronousWindow,
	drainToQuiescence,
	type QuiescenceResult,
	SimulationBoundaryError,
} from './boundary'
export { CLASSIFIED_DIAGNOSTICS } from './classifications'
export {
	detectRuntime,
	NETWORK_GLOBALS,
	patchesFor,
	REALM_GLOBALS,
	type SimPatch,
	type SimRuntime,
	STUB_GLOBALS,
} from './patch-table'
export {
	childrenFirstOrder,
	createSimulationRealm,
	type JsdomSimulationRealm,
	type RecordedDefinition,
} from './realm'
