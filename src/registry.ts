import type { RoleWrite } from './analysis/role-writes'
import type { ChildrenRegion } from './children-region'
import type { ExposeKind, RenderedShape } from './ir'
import type { SuppressedSite } from './simulation/contract'
import type { EvaluationTier, RoutingSignal } from './tier'

/* === Types === */

export type RegistryEntry = {
	/** Custom element tag (`basic-counter`). */
	tag: string
	/** Component function name (`BasicCounter`). */
	name: string
	/** Path of the authored source, relative to the PROJECT root. */
	source: string
	/** Generated artifacts, relative to the registry file. */
	serverModule: string
	clientModule: string
	css: string
	/** Exported `<Name>Props` type, when authored. */
	propsType: string | null
	exposedProps: Record<string, ExposeKind>
	composesTags: string[]
	tier: EvaluationTier
}

export type InternalRegistryEntry = RegistryEntry & {
	renderedShapes?: RenderedShape[]
	childrenRegion?: ChildrenRegion
	interactive: boolean
	childrenModel?: 'any' | 'non-interactive' | null
	/** Why this component is not Folded-tier; empty for the Folded tier. */
	routingSignals: RoutingSignal[]
	suppressedSites: SuppressedSite[]
	composeReadTags: string[]
	declaresI18n: boolean
	langArgDefault: string | null
	i18nMessages: Record<string, string> | null
	clientMessageKeys: string[]
	handlerArgs?: Record<string, HandlerPlacement[]>
	roleWrites?: Record<string, RoleWrite[]>
}

export type HandlerPlacement =
	| { event: string; selector: string; optional: boolean }
	| { via: string; clause: string; arg: string; optional: boolean }

/** The parsed `registry.json` shape — one public entry per tag. */
export type ComponentRegistry = Record<string, RegistryEntry>

export type InternalComponentRegistry = Record<string, InternalRegistryEntry>

/* === Exported Functions === */

/** The public projection of one entry — the `registry.json` schema, exactly. */
export const publicRegistryEntry = (
	entry: InternalRegistryEntry,
): RegistryEntry => ({
	tag: entry.tag,
	name: entry.name,
	source: entry.source,
	serverModule: entry.serverModule,
	clientModule: entry.clientModule,
	css: entry.css,
	propsType: entry.propsType,
	exposedProps: entry.exposedProps,
	tier: entry.tier,
	composesTags: entry.composesTags,
})

export const registryJson = (
	entries: readonly InternalRegistryEntry[],
): string =>
	`${JSON.stringify(
		Object.fromEntries(entries.map(e => [e.tag, publicRegistryEntry(e)])),
		null,
		'\t',
	)}\n`

export const internalRegistryJson = (
	entries: readonly InternalRegistryEntry[],
): string =>
	`${JSON.stringify(Object.fromEntries(entries.map(e => [e.tag, e])), null, '\t')}\n`
