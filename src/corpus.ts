import { dirname, join, relative } from 'node:path'
import {
	type Census,
	formatCensus,
	type TemplateCensusSubject,
	templateCensus,
	translationCensus,
} from './census'
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
import type { CompileDiagnostic, LocalDiagnostic } from './diagnostics'
import { diagnostic, lineOf, locate, wholeFile } from './diagnostics'
import type { EmitPaths } from './emit-paths'
import { compileComponent } from './frontend/tsrx'
import { compileComponentTsx } from './frontend/tsx'
import { removeFile, scanGlobSync, writeTextFile } from './fs'
import {
	buildI18n,
	type Catalogs,
	collectI18n,
	localeMessages,
	readCatalogs,
	writeI18nModule,
	writeI18nReport,
} from './i18n-catalog'
import type { CompiledComponent } from './pipeline'
import type { InternalRegistryEntry } from './registry'
import { internalRegistryJson, registryJson } from './registry'
import type { SourceSpan } from './spans'
import type { TemplatePartial, TemplateTarget } from './template/operations'
import { type TemplateRouting, walkPartial } from './template/walk'
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

/** Internal options of a corpus run, out of reach of `compileCorpus` and the config file. */
export type CorpusRunOptions = {
	/** Runs the shared template walk and hands each partial to this target. */
	templateTarget?: TemplateTarget
}

/** One component's partial at one locale, as the target emitted it. */
export type EmittedPartial = {
	tag: string
	locale: string
	fileName: string
	tier: 'folded' | 'static'
	output: string
}

export type InternalCorpusResult = CorpusResult & {
	/** Post-contamination entries, one per served tag — the `registry.internal.json` record. */
	entries: readonly InternalRegistryEntry[]
	/** Error labels, preformatted for the runner that fails its build on them. */
	errors: ReadonlyArray<{ file: string; label: string }>
	spanInfos: readonly CompiledSpanInfo[]
	/** Present only when a template target is configured. */
	template?: {
		census: Census
		partials: readonly EmittedPartial[]
	}
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

type WalkedPartials = {
	tag: string
	routing: TemplateRouting[]
	partials: TemplatePartial[]
	diagnostics: LocalDiagnostic[]
}

/** One component walked at every locale; the routing and findings are locale-independent, so the first locale's stand. */
const walkPartials = (
	component: CompiledComponent,
	composeRegistry: ReadonlyMap<string, InternalRegistryEntry>,
	locales: readonly string[],
	catalogs: Catalogs,
): WalkedPartials => {
	const { entry, ir } = component
	const build = buildI18n(locales)
	const runs = locales.map(locale => ({
		locale,
		run: walkPartial({
			component: ir,
			composeRegistry,
			locale,
			pageLocale: build.pageLocale,
			timeZone: build.timeZone,
			currency: build.currency,
			messages: localeMessages(
				entry.tag,
				ir.i18nMessages,
				catalogs.overrides.get(locale) ?? {},
			),
			clientMessageKeys: entry.clientMessageKeys ?? [],
		}),
	}))
	return {
		tag: entry.tag,
		routing: runs[0]?.run.routing ?? [],
		diagnostics: runs[0]?.run.diagnostics ?? [],
		partials: runs.map(({ locale, run }) => ({
			tag: entry.tag,
			locale,
			timeZone: build.timeZone,
			currency: build.currency,
			ops: run.ops,
		})),
	}
}

/* === Exported Functions === */

export const compileCorpusFiles = async (
	files: readonly CorpusFile[],
	config: CorpusConfig,
	options: CorpusRunOptions = {},
): Promise<InternalCorpusResult> => {
	const { outDir, root } = config
	const emitPaths = emitPathsFor(config)
	const { templateTarget } = options
	const catalogs: Catalogs | null = templateTarget
		? await readCatalogs(config.i18nDir)
		: null
	const walked: Array<{ rel: string } & WalkedPartials> = []

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
			if (catalogs) {
				const run = walkPartials(
					component,
					composeRegistry,
					config.locales,
					catalogs,
				)
				report(
					rel,
					run.diagnostics.map(d => locate(d, rel)),
				)
				if (run.diagnostics.some(d => d.severity === 'error')) continue
				walked.push({ rel, ...run })
			}
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

	let template: InternalCorpusResult['template']
	if (templateTarget) {
		const subjects: TemplateCensusSubject[] = []
		const partials: EmittedPartial[] = []
		for (const { rel, tag, routing, partials: perLocale } of walked) {
			const entry = entries.find(e => e.tag === tag)
			if (!entry) continue
			const reasons: Array<TemplateCensusSubject['reasons'][number]> =
				routing.map(({ reason, detail, range }) => ({
					reason,
					detail,
					...(range ? { location: { file: rel, ...range } } : {}),
				}))
			if (entry.tier !== 'folded')
				reasons.push({
					reason: `${entry.tier} tier`,
					detail:
						'a template target runs no realm, so the partial is the Static skeleton',
				})
			const tier = reasons.length > 0 ? 'static' : 'folded'
			subjects.push({ tag, tier, reasons })
			for (const partial of perLocale)
				partials.push({
					tag,
					locale: partial.locale,
					fileName: templateTarget.fileName(tag, partial.locale),
					tier,
					output: templateTarget.emit(partial),
				})
		}
		const census = templateCensus(templateTarget.name, subjects, file =>
			contentOf.get(file),
		)
		console.log(formatCensus(census))
		template = { census, partials }
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
		...(template ? { template } : {}),
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
