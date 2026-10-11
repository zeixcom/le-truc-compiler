/** The shared post-front-end pipeline: the stage assembly both front ends run after their `compileSource`, so a pipeline change cannot drift between surfaces. */

import {
	findInteractiveContent,
	templateInteractiveOf,
} from './analysis/content-model'
import { handlerPlacementsOf } from './analysis/handler-args'
import { analyzeClient } from './analysis/plan'
import { findRoleWriterConflicts, roleWritesOf } from './analysis/role-writes'
import {
	childrenRegionOfComponent,
	leakChildrenFor,
	renderedShapesOf,
} from './analysis/selectors'
import {
	checkSheetLeaks,
	checkSheetLowering,
	describeCssTargets,
	emitScopedSheet,
	scopeModeOf,
} from './css-scope'
import {
	type CompileDiagnostic,
	diagnostic,
	type LocalDiagnostic,
	locate,
} from './diagnostics'
import { emitClientModule } from './emit-client'
import { DEFAULT_EMIT_PATHS, type EmitPaths } from './emit-paths'
import { emitServerModule } from './emit-server'
import { checkFoldInputs } from './fold-inputs'
import type { ComponentIR } from './ir'
import type { InternalRegistryEntry } from './registry'
import type { SourceSpan } from './spans'
import { authoredRange } from './template-output'
import { classifyTier, type LocalRoutingSignal, locateSignal } from './tier'
import { collectComposeElements } from './walk'

/* === Types === */

export type CompiledComponent = {
	entry: InternalRegistryEntry
	/** Generated server render module source. */
	serverCode: string
	/** Generated client `defineComponent` module source. */
	clientCode: string
	css: string
	authoredCss: string
	formAssociated: boolean
	clientSpans: SourceSpan[]
	serverSpans: SourceSpan[]
}

export type CompileFileResult = {
	component: CompiledComponent | null
	diagnostics: CompileDiagnostic[]
}

/* === Exported Functions === */

export const compileFromIR = (
	component: ComponentIR | null,
	diagnostics: LocalDiagnostic[],
	setupSignals: LocalRoutingSignal[],
	filename: string,
	registry: ReadonlySet<string>,
	childImports?: ReadonlyMap<string, string>,
	composeRegistry?: ReadonlyMap<string, InternalRegistryEntry>,
	emitPaths: EmitPaths = DEFAULT_EMIT_PATHS,
): CompileFileResult => {
	// Every return publishes the stages' diagnostics against the file the caller named.
	const located = () => diagnostics.map(d => locate(d, filename))
	if (!component) return { component: null, diagnostics: located() }
	const composeNodes = collectComposeElements(component)
	if (composeRegistry) {
		for (const node of composeNodes) {
			if (!composeRegistry.has(node.source))
				diagnostics.push(
					diagnostic.composedComponentNotCompiled(
						component.source,
						node.node,
						node.component,
						node.source,
					),
				)
		}
	}
	const plan = analyzeClient(component, registry, diagnostics, composeRegistry)
	// Where each handler arg lands, for the registry entry a composing parent binds through. Before the error gate: an unaddressable placement is LTC007.
	const handlerArgs = handlerPlacementsOf(component, diagnostics)
	const childrenRegion = childrenRegionOfComponent(component)
	// The content model: a compose site of a child that declares `'non-interactive'` refuses interactive content, reading each child's declaration and `interactive` flag off its registry entry — so it runs only in the registry-aware pass; the entry's own flag is recorded either way.
	const interactive = templateInteractiveOf(component.root, composeRegistry)
	// The one-writer check: the child half records what its client writes on role elements in the passed content — own-IR only, so it runs in both passes; the parent half refuses a compose-site binding that writes the same property on a role element the child's entry records, reading each child's entry (registry-aware pass only, after `analyzeClient`).
	const roleWrites = roleWritesOf(component)
	if (composeRegistry) {
		for (const finding of findRoleWriterConflicts(component, composeRegistry))
			diagnostics.push(
				diagnostic.roleWriterConflict(
					component.source,
					finding.parent.at,
					finding.parent,
					finding.childTag,
					finding.role,
					finding.childWrite,
				),
			)
		for (const node of composeNodes) {
			if (node.children.length === 0) continue
			const child = composeRegistry.get(node.source)
			if (child?.childrenModel !== 'non-interactive') continue
			const finding = findInteractiveContent(node.children, composeRegistry)
			if (finding)
				diagnostics.push(
					diagnostic.interactiveContentRefused(
						component.source,
						node.node,
						child.tag,
						finding,
					),
				)
		}
	}
	// The partial-readiness invariant: nothing but own args and the declared ambient set may reach the fold.
	checkFoldInputs(component, diagnostics)
	// A `@scope` form the flat-selector lowering cannot express fails only on a CSS target without native `@scope` (LTC089) — it depends on the configured targets, so it runs here rather than with the authored-form checks.
	if (
		component.sheet &&
		component.sheetText &&
		scopeModeOf(emitPaths.cssTargets) === 'lowered'
	) {
		const sheetStart = component.source.lastIndexOf(component.sheetText)
		for (const finding of checkSheetLowering(
			component.sheet,
			component.sheetText,
		))
			diagnostics.push(
				diagnostic.scopeNotLowerable(
					component.source,
					authoredRange(sheetStart, finding),
					finding.face,
					describeCssTargets(emitPaths.cssTargets),
				),
			)
	}
	// A scoped rule that reaches into a composed child's own markup (LTC087) needs each child's rendered shapes, so it runs only in the registry-aware pass.
	if (component.sheet && component.sheetText && composeRegistry) {
		const sheetStart = component.source.lastIndexOf(component.sheetText)
		for (const finding of checkSheetLeaks(
			component.sheet,
			component.sheetText,
			leakChildrenFor(component.root, composeRegistry),
		))
			diagnostics.push(
				diagnostic.downwardLeak(
					component.source,
					authoredRange(sheetStart, finding),
					finding.selector,
					finding.children,
				),
			)
	}
	if (diagnostics.some(d => d.severity === 'error'))
		return { component: null, diagnostics: located() }

	const routingSignals = [...setupSignals, ...plan.routingSignals].map(signal =>
		locateSignal(signal, filename),
	)
	const tier = classifyTier(routingSignals)
	const composeReadTags = composeRegistry
		? [
				...new Set(
					composeNodes
						.filter(node =>
							node.attrs.some(
								attr => attr.kind === 'ref' || attr.kind === 'pass',
							),
						)
						.map(node => composeRegistry.get(node.source)?.tag)
						.filter((tag): tag is string => tag !== undefined),
				),
			]
		: []
	const server = emitServerModule(component, {
		runtimeImport: emitPaths.runtimeImport,
		sourcePath: filename,
		composeRegistry,
		// The tier decides whether the module re-declares the `@{ }` value harness — pre-contamination by construction, so it is sound.
		tier,
		clientMessageKeys: plan.clientMessageKeys,
	})
	const client = emitClientModule(component, plan, {
		sourcePath: filename,
		childImports,
	})
	return {
		component: {
			entry: {
				tag: component.tag,
				name: component.name,
				source: filename,
				serverModule: `${component.tag}.server.ts`,
				clientModule: `${component.tag}.client.ts`,
				css: `${component.tag}.css`,
				propsType: component.propsTypeName,
				exposedProps: Object.fromEntries(
					[...component.exposeProps].map(([prop, decl]) => [prop, decl.kind]),
				),
				tier,
				routingSignals,
				suppressedSites: plan.suppressedSites,
				composeReadTags,
				declaresI18n: component.declaresI18n,
				langArgDefault: component.langArgDefault,
				i18nMessages: component.i18nMessages,
				clientMessageKeys: plan.clientMessageKeys,
				...(handlerArgs ? { handlerArgs } : {}),
				...(roleWrites ? { roleWrites } : {}),
				renderedShapes: renderedShapesOf(component),
				interactive,
				...(component.childrenContract
					? { childrenModel: component.childrenContract.model }
					: {}),
				...(childrenRegion ? { childrenRegion } : {}),
				composesTags: composeRegistry
					? [
							...new Set(
								composeNodes
									.map(node => composeRegistry.get(node.source)?.tag)
									.filter((tag): tag is string => tag !== undefined),
							),
						]
					: [],
			},
			serverCode: server.code,
			clientCode: client.code,
			// The scoped emission is reachable only with no error diagnostics — the early return above dropped any file whose sheet failed LTC064 or the authored-form checks — so the surgery inputs are known-good. `sheetText` is the raw text `sheet`'s locs resolve against; `css` (dedented) stays on the IR as the authored form LTC051 compares.
			css:
				component.sheet && component.sheetText
					? emitScopedSheet(
							component.sheet,
							component.sheetText,
							component.tag,
							emitPaths.cssTargets,
						)
					: component.css,
			authoredCss: component.css,
			formAssociated: !!component.config?.form,
			clientSpans: client.spans,
			serverSpans: server.spans,
		},
		diagnostics: located(),
	}
}
