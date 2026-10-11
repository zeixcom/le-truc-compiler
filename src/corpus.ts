import { dirname, join, relative } from 'node:path'
import { formatCensus, translationCensus } from './census'
import {
	type CorpusConfig,
	emitPathsFor,
	type VariantSurface,
	validateVariantOverrides,
} from './corpus-config'
import {
	type CorpusFile,
	collectCorpusSources,
	collectSiblingModules,
} from './corpus-scan'
import type { CompileDiagnostic } from './diagnostics'
import { diagnostic, lineOf, wholeFile } from './diagnostics'
import type { EmitPaths } from './emit-paths'
import { compileComponent } from './frontend/tsrx'
import { compileComponentTsx } from './frontend/tsx'
import { removeFile, scanGlobSync, writeTextFile } from './fs'
import { collectI18n, writeI18nModule, writeI18nReport } from './i18n-catalog'
import type { InternalRegistryEntry } from './registry'
import { internalRegistryJson, registryJson } from './registry'
import type { SourceSpan } from './spans'
import type { EvaluationTier } from './tier'
import { contaminateComposeReads } from './tier'
import {
	TSRX_IMPORTS_FILE,
	type TsrxImportSource,
	type TsrxTagMapEntry,
	tsrxImportTypings,
} from './tsrx-imports'

/* === Types === */

export type CompiledSpanInfo = {
	tag: string
	/** Authored source path, relative to the project root. */
	source: string
	/** Generated client module path on disk, absolute. */
	clientModulePath: string
	spans: SourceSpan[]
	/** Generated server module path on disk, absolute. */
	serverModulePath: string
	serverSpans: SourceSpan[]
	/** Emitted stylesheet path on disk, absolute. */
	cssPath: string
	authoredCss: string
}

/** What the corpus run counted, by the channel that prints it. */
export type CorpusSummary = {
	/** Served components the run wrote artifacts for. */
	components: number
	/** Diagnostics by severity: errors refused their files; warnings did not. */
	errors: number
	warnings: number
	tiers: Record<EvaluationTier, number>
	/** Locales the translation census walked (zero for an untranslated corpus). */
	locales: number
	/** Translation gaps the census recorded (missing, stale, orphaned, …). */
	translationGaps: number
}

/** The published half of a corpus run: what `compileCorpus` returns. */
export type CorpusResult = {
	/** Every diagnostic both passes reported, warnings and errors alike. */
	diagnostics: readonly CompileDiagnostic[]
	summary: CorpusSummary
}

export type InternalCorpusResult = CorpusResult & {
	/** Post-contamination entries, one per served tag — the `registry.internal.json` record. */
	entries: readonly InternalRegistryEntry[]
	/** Error labels, preformatted for the runner that fails its build on them. */
	errors: ReadonlyArray<{ file: string; label: string }>
	spanInfos: readonly CompiledSpanInfo[]
}

/* === Internal Functions === */

const compileCorpusFile = (
	content: string,
	rel: string,
	registry: ReadonlySet<string>,
	emitPaths: EmitPaths,
	childImports?: ReadonlyMap<string, string>,
	composeRegistry?: ReadonlyMap<string, InternalRegistryEntry>,
) =>
	rel.endsWith('.tsx')
		? compileComponentTsx(
				content,
				rel,
				registry,
				childImports,
				composeRegistry,
				emitPaths,
			)
		: compileComponent(
				content,
				rel,
				registry,
				childImports,
				composeRegistry,
				emitPaths,
			)

/** `basic-counter.tsrx`/`basic-counter.tsx` → `basic-counter`. */
const corpusTagOf = (filename: string): string =>
	(filename.split('/').pop() ?? '').replace(/\.(tsrx|tsx)$/, '')

export const relocateClientSpecifiers = (code: string): string =>
	code.replace(
		/(\bimport\s*\(?\s*|\bfrom\s*)(['"])(\.\.?\/)/g,
		(_, lead: string, quote: string, dots: string) =>
			`${lead}${quote}${dots === './' ? '../' : '../../'}`,
	)

/** A `.tsx` path → `tsx`; a `.tsrx` path → `tsrx`. */
const surfaceOf = (rel: string): VariantSurface =>
	rel.endsWith('.tsx') ? 'tsx' : 'tsrx'

const isVariantSet = (sources: readonly string[]): boolean =>
	new Set(sources.map(dirname)).size === 1 &&
	new Set(sources.map(surfaceOf)).size === sources.length

const pruneVariantClients = async (
	variantsDir: string,
	keep: ReadonlySet<string>,
): Promise<void> => {
	let present: string[]
	try {
		present = scanGlobSync('**/*', variantsDir)
	} catch {
		return
	}
	for (const file of present) {
		if (keep.has(file)) continue
		await removeFile(join(variantsDir, file))
		console.log(`🧹 Pruned stale variants/${file}`)
	}
}

/* === Exported Functions === */

export const compileCorpusFiles = async (
	files: readonly CorpusFile[],
	config: CorpusConfig,
): Promise<InternalCorpusResult> => {
	const { outDir, root } = config
	const emitPaths = emitPathsFor(config)

	const childImports = collectSiblingModules(config)
	const registry = new Set<string>(childImports.keys())
	const compilable = new Map<string, string>()
	const compiledTags = new Set<string>()
	const composeRegistry = new Map<string, InternalRegistryEntry>()
	const discoveryRegistry = new Set<string>(registry)
	for (const file of files) {
		const base = corpusTagOf(file.filename)
		if (/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/.test(base))
			discoveryRegistry.add(base)
	}
	const diagnostics: CompileDiagnostic[] = []
	const errorLabels = new Map<string, string>()
	const contentOf = new Map(
		files.map(file => [relative(root, file.path), file.content]),
	)
	const locationOf = (rel: string) => wholeFile(rel, contentOf.get(rel) ?? '')
	const lineLabel = (d: CompileDiagnostic): string => {
		const content = contentOf.get(d.location.file)
		if (
			content === undefined ||
			(d.location.start === 0 && d.location.end === content.length)
		)
			return ''
		const line = lineOf(content, d.location.start)
		return line === undefined ? '' : `line ${line}: `
	}
	const report = (rel: string, fileDiagnostics: CompileDiagnostic[]) => {
		for (const d of fileDiagnostics) {
			const label = `[${d.code}] ${lineLabel(d)}${d.message}`
			if (d.severity === 'error') {
				console.error(`❌ ${rel} — ${label}`)
				errorLabels.set(rel, label)
			} else console.warn(`⚠️ ${rel} — ${label}`)
			diagnostics.push(d)
		}
	}
	const tagsBySource = new Map<string, string[]>()
	for (const file of files) {
		const rel = relative(root, file.path)
		const base = corpusTagOf(file.filename)
		if (!/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/.test(base)) continue
		const decls = tagsBySource.get(base) ?? []
		decls.push(rel)
		tagsBySource.set(base, decls)
	}
	for (const [tag, sources] of tagsBySource) {
		if (sources.length < 2) continue
		if (isVariantSet(sources)) continue
		for (const rel of sources) {
			report(rel, [
				diagnostic.duplicateTag(
					tag,
					sources,
					locationOf(rel),
					sources.filter(other => other !== rel).map(locationOf),
				),
			])
		}
	}
	validateVariantOverrides(config, tagsBySource)
	for (const file of files) {
		const rel = relative(root, file.path)
		if (errorLabels.has(rel)) continue
		const { component, diagnostics: fileDiagnostics } = compileCorpusFile(
			file.content,
			rel,
			discoveryRegistry,
			emitPaths,
		)
		report(rel, fileDiagnostics)
		if (component) {
			registry.add(component.entry.tag)
			compiledTags.add(component.entry.tag)
			compilable.set(rel, file.content)
			composeRegistry.set(rel, component.entry)
		}
	}
	for (const tag of compiledTags) childImports.set(tag, `./${tag}.client`)

	const entries: InternalRegistryEntry[] = []
	const spanInfos: CompiledSpanInfo[] = []
	const variantClients = new Set<string>()
	const tsrxSources = new Map<string, string[]>()
	const formAssociatedTags = new Set<string>()
	const membersByTag = new Map<string, { rel: string; content: string }[]>()
	for (const [rel, content] of compilable) {
		const tag = corpusTagOf(rel)
		const members = membersByTag.get(tag) ?? []
		members.push({ rel, content })
		membersByTag.set(tag, members)
	}
	for (const [tag, members] of membersByTag) {
		const results = members.map(({ rel, content }) => {
			const { component, diagnostics: fileDiagnostics } = compileCorpusFile(
				content,
				rel,
				registry,
				emitPaths,
				childImports,
				composeRegistry,
			)
			report(rel, fileDiagnostics)
			if (component && rel.endsWith('.tsrx'))
				tsrxSources.set(tag, [...(tsrxSources.get(tag) ?? []), rel])
			return { rel, component }
		})
		if (results.length > 1) {
			const compiled = results.filter(r => r.component)
			const head = compiled[0]
			if (head?.component && compiled.length > 1) {
				const headCss = head.component.authoredCss
				const drifted = compiled.filter(
					r => r.component && r.component.authoredCss !== headCss,
				)
				if (drifted.length > 0) {
					const sources = [head.rel, ...drifted.map(r => r.rel)]
					for (const rel of sources)
						report(rel, [
							diagnostic.variantCssDrift(
								tag,
								sources,
								locationOf(rel),
								sources.filter(other => other !== rel).map(locationOf),
							),
						])
					continue
				}
			}
		}
		const want = config.variantOverrides[tag] ?? config.variantSurface
		const servedRel =
			results.length === 1
				? results[0]?.rel
				: results.find(r => r.component && surfaceOf(r.rel) === want)?.rel
		for (const { rel, component } of results) {
			if (!component) continue
			if (rel !== servedRel) {
				const clientCode = relocateClientSpecifiers(component.clientCode)
				const variantFile = `${component.entry.tag}.${surfaceOf(rel)}.client.ts`
				await writeTextFile(join(outDir, 'variants', variantFile), clientCode)
				variantClients.add(variantFile)
				console.log(
					`· Compiled ${component.entry.tag} from ${rel} — variant set member, not served` +
						(servedRel
							? ` (client kept at variants/${component.entry.tag}.${surfaceOf(rel)}.client.ts)`
							: ` (selected surface "${want}" did not compile)`),
				)
				continue
			}
			const { entry } = component
			const clientModulePath = join(outDir, entry.clientModule)
			const serverModulePath = join(outDir, entry.serverModule)
			await writeTextFile(serverModulePath, component.serverCode)
			await writeTextFile(clientModulePath, component.clientCode)
			const cssPath = join(outDir, entry.css)
			await writeTextFile(cssPath, component.css)
			entries.push(entry)
			if (component.formAssociated) formAssociatedTags.add(entry.tag)
			spanInfos.push({
				tag: entry.tag,
				source: rel,
				clientModulePath,
				spans: component.clientSpans,
				serverModulePath,
				serverSpans: component.serverSpans,
				cssPath,
				authoredCss: component.authoredCss,
			})
			console.log(`✅ Compiled ${entry.tag} from ${rel}`)
		}
	}

	await pruneVariantClients(join(outDir, 'variants'), variantClients)

	const contaminated = contaminateComposeReads(
		new Map(
			entries.map(entry => [
				entry.tag,
				{ tag: entry.tag, tier: entry.tier, signals: entry.routingSignals },
			]),
		),
		tag => entries.find(entry => entry.tag === tag)?.composeReadTags ?? [],
	)
	for (const entry of entries) {
		const classification = contaminated.get(entry.tag)
		if (!classification) continue
		entry.tier = classification.tier
		entry.routingSignals = [...classification.signals]
	}

	await writeTextFile(join(outDir, 'registry.json'), registryJson(entries))
	await writeTextFile(
		join(outDir, 'registry.internal.json'),
		internalRegistryJson(entries),
	)
	const typings: TsrxImportSource[] = entries.flatMap(entry =>
		(tsrxSources.get(entry.tag) ?? []).map(source => ({
			source,
			name: entry.name,
			serverModule: entry.serverModule,
			passProps: Object.entries(entry.exposedProps)
				.filter(([, kind]) => kind === 'slot')
				.map(([prop]) => prop),
		})),
	)
	const tagMap: TsrxTagMapEntry[] = entries
		.filter(entry => entry.source.endsWith('.tsrx'))
		.map(entry => ({
			tag: entry.tag,
			clientModule: entry.clientModule,
			propsType: entry.propsType,
			formAssociated: formAssociatedTags.has(entry.tag),
		}))
	await writeTextFile(
		join(outDir, TSRX_IMPORTS_FILE),
		tsrxImportTypings(typings, tagMap),
	)
	const i18nCollection = await collectI18n(entries, undefined, config.i18nDir)
	await writeI18nModule(
		outDir,
		i18nCollection,
		config.runtimeImport,
		config.locales,
	)
	await writeI18nReport(outDir, i18nCollection, config.locales)
	const i18nCensus = translationCensus(
		i18nCollection.gaps,
		i18nCollection.locales,
	)
	console.log(
		`🌐 Translation census: ${i18nCensus.entries.length} gap(s) across ${i18nCollection.locales.length} locale(s)`,
	)
	if (i18nCensus.entries.length > 0) console.log(formatCensus(i18nCensus))
	console.log(
		`📝 Corpus compilation completed (${entries.length} component(s))`,
	)
	const tiers: Record<EvaluationTier, number> = {
		folded: 0,
		simulated: 0,
		static: 0,
	}
	for (const entry of entries) tiers[entry.tier]++
	return {
		diagnostics,
		summary: {
			components: entries.length,
			errors: diagnostics.filter(d => d.severity === 'error').length,
			warnings: diagnostics.filter(d => d.severity === 'warning').length,
			tiers,
			locales: i18nCollection.locales.length,
			translationGaps: i18nCollection.gaps.length,
		},
		entries,
		errors: [...errorLabels].map(([file, label]) => ({ file, label })),
		spanInfos,
	}
}

export const compileCorpus = async (
	config: CorpusConfig,
): Promise<CorpusResult> => {
	const files = await collectCorpusSources(config)
	if (files.length === 0)
		throw new Error(
			`No component sources matched ${config.sources.join(', ')} under ${config.root}`,
		)
	const { diagnostics, summary } = await compileCorpusFiles(files, config)
	return { diagnostics, summary }
}
