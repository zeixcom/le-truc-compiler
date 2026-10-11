import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
	CSS_BROWSERS,
	type CssBrowser,
	type CssTargets,
	DEFAULT_CSS_TARGETS,
	DEFAULT_OUT_DIR,
	DEFAULT_RUNTIME_IMPORT,
	type EmitPaths,
	encodeCssVersion,
} from './emit-paths'

/* === Constants === */

/** The config file an installing project puts at its own root. */
export const CONFIG_FILENAME = 'le-truc.config.json'
export const DEFAULT_SOURCES = ['examples/**/*.tsrx', 'examples/**/*.tsx']
export const DEFAULT_SIBLING_MODULES = ['examples/**/*.ts']
export const DEFAULT_I18N_DIR = 'i18n'
export const DEFAULT_LOCALES: readonly string[] = ['en', 'de']
export { DEFAULT_OUT_DIR, DEFAULT_RUNTIME_IMPORT }

/* === Variant surface selection === */

export type VariantSurface = 'tsx' | 'tsrx'

export const DEFAULT_VARIANT_SURFACE: VariantSurface = 'tsx'

const VARIANT_SURFACES: readonly VariantSurface[] = ['tsx', 'tsrx']

const TAG_PATTERN = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/

/* === Types === */

export type CorpusConfigInput = {
	/** Globs selecting authored `.tsx`/`.tsrx` component sources. */
	sources?: string[]
	/** Globs selecting hand-written custom-element modules. */
	siblingModules?: string[]
	/** Output root for the generated artifacts, relative to the root. */
	outDir?: string
	/** Translation-catalog directory, relative to the root. */
	i18nDir?: string
	locales?: string[]
	/** Specifier the generated server modules import the harness from. */
	runtimeImport?: string
	variantSurface?: VariantSurface
	variantOverrides?: Partial<Record<string, VariantSurface>>
	cssTargets?: { [browser in CssBrowser]?: number | string }
}

/** A fully resolved corpus configuration; all paths absolute. */
export type CorpusConfig = {
	/** Project root. Every glob is scanned with this as its cwd. */
	root: string
	sources: readonly string[]
	siblingModules: readonly string[]
	outDir: string
	i18nDir: string
	/** Locales the corpus builds for; the first is the default page locale. */
	locales: readonly string[]
	runtimeImport?: string
	/** Surface a variant set serves with no override. */
	variantSurface: VariantSurface
	/** Per-tag variant-surface overrides. */
	variantOverrides: Readonly<Record<string, VariantSurface>>
	/** The resolved CSS target. */
	cssTargets: CssTargets
}

/* === Internal Functions === */

const ACCEPTED_KEYS: readonly string[] = [
	'sources',
	'siblingModules',
	'outDir',
	'i18nDir',
	'locales',
	'runtimeImport',
	'variantSurface',
	'variantOverrides',
	'cssTargets',
]

/** A short quote of a received JSON value for an error message. */
const received = (value: unknown): string => {
	const quote = JSON.stringify(value) ?? String(value)
	return quote.length <= 60 ? quote : `${quote.slice(0, 57)}...`
}

const fail = (message: string): never => {
	throw new Error(`${CONFIG_FILENAME}: ${message}`)
}

const validateConfigInput = (input: CorpusConfigInput): void => {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail(
			`expected a JSON object with keys drawn from: ${ACCEPTED_KEYS.join(', ')} — received ${received(input)}.`,
		)
	const value = (key: string): unknown =>
		(input as Record<string, unknown>)[key]
	for (const key of Object.keys(input)) {
		if (ACCEPTED_KEYS.includes(key)) continue
		const suggestion = ACCEPTED_KEYS.find(
			accepted => accepted.toLowerCase() === key.toLowerCase(),
		)
		fail(
			`unknown key "${key}" — accepted keys are: ${ACCEPTED_KEYS.join(', ')}.` +
				(suggestion && suggestion !== key
					? ` Did you mean "${suggestion}"?`
					: ''),
		)
	}
	const stringArray = (field: string): void => {
		const v = value(field)
		if (v === undefined) return
		if (!Array.isArray(v))
			fail(
				`"${field}" must be an array of glob strings — received ` +
					(typeof v === 'string'
						? `the string ${received(v)}. Wrap it in an array: "${field}": [${received(v)}]`
						: `a ${typeof v}.`),
			)
		for (const [index, item] of (v as unknown[]).entries())
			if (typeof item !== 'string' || item.length === 0)
				fail(
					`"${field}[${index}]" must be a non-empty string — received ${received(item)}.`,
				)
	}
	const nonEmptyString = (field: string): void => {
		const v = value(field)
		if (v === undefined) return
		if (typeof v !== 'string' || v.length === 0)
			fail(`"${field}" must be a non-empty string — received ${received(v)}.`)
	}
	const variantSurfaceValue = (where: string, v: unknown): void => {
		if (
			typeof v !== 'string' ||
			!VARIANT_SURFACES.includes(v as VariantSurface)
		)
			fail(
				`${where} must be one of: ${VARIANT_SURFACES.map(s => `"${s}"`).join(', ')} — received ${received(v)}.`,
			)
	}
	const VERSION_PATTERN = /^\d+(\.\d+){1,2}$/
	const cssTargetsValue = (v: unknown): void => {
		if (typeof v !== 'object' || v === null || Array.isArray(v))
			fail(
				`"cssTargets" must be an object mapping browser names to minimum versions — received ${received(v)}.`,
			)
		for (const [browser, version] of Object.entries(v as object)) {
			if (!CSS_BROWSERS.includes(browser as CssBrowser)) {
				const suggestion = CSS_BROWSERS.find(
					known => known.toLowerCase() === browser.toLowerCase(),
				)
				fail(
					`"cssTargets" keys must be browsers: ${CSS_BROWSERS.join(', ')} — received "${browser}".` +
						(suggestion && suggestion !== browser
							? ` Did you mean "${suggestion}"?`
							: ''),
				)
			}
			const ok =
				(typeof version === 'number' &&
					Number.isInteger(version) &&
					version >= 1 &&
					version <= 255) ||
				(typeof version === 'string' &&
					VERSION_PATTERN.test(version) &&
					version
						.split('.')
						.every(part => Number(part) >= 0 && Number(part) <= 255))
			if (!ok)
				fail(
					`"cssTargets["${browser}"]" must be an integer major version up to 255 (118) or a "major.minor[.patch]" string with every component up to 255 ("17.4") — received ${received(version)}.`,
				)
		}
	}
	stringArray('sources')
	stringArray('siblingModules')
	stringArray('locales')
	const locales = value('locales')
	if (Array.isArray(locales) && locales.length === 0)
		fail(
			'"locales" must list at least one locale (the first is the default page locale).',
		)
	nonEmptyString('outDir')
	nonEmptyString('i18nDir')
	nonEmptyString('runtimeImport')
	if (value('variantSurface') !== undefined)
		variantSurfaceValue('"variantSurface"', value('variantSurface'))
	const overrides = value('variantOverrides')
	if (overrides !== undefined) {
		if (
			typeof overrides !== 'object' ||
			overrides === null ||
			Array.isArray(overrides)
		)
			fail(
				`"variantOverrides" must be an object mapping component tags to surfaces — received ${received(overrides)}.`,
			)
		for (const [tag, surface] of Object.entries(overrides as object)) {
			if (!TAG_PATTERN.test(tag))
				fail(
					`"variantOverrides" keys must be custom-element tags (dashed lowercase, e.g. "basic-counter") — received "${tag}".`,
				)
			variantSurfaceValue(`"variantOverrides["${tag}"]"`, surface)
		}
	}
	if (value('cssTargets') !== undefined) cssTargetsValue(value('cssTargets'))
}

const resolveCssTargets = (
	input: CorpusConfigInput['cssTargets'],
): CssTargets => {
	const targets: CssTargets = {}
	for (const browser of CSS_BROWSERS) {
		const version = input?.[browser]
		if (version === undefined) continue
		if (typeof version === 'number') targets[browser] = version << 16
		else {
			const [major, minor, patch] = version
				.split('.')
				.map(part => Number.parseInt(part, 10))
			targets[browser] = encodeCssVersion(major ?? 0, minor ?? 0, patch ?? 0)
		}
	}
	return targets
}

/* === Exported Functions === */

export const outDirPrefix = (root: string, outDir: string): string => {
	const rel = relative(root, outDir)
	const segments = rel.split(sep).filter(s => s.length > 0 && s !== '.')
	return '../'.repeat(segments.length)
}

export const resolveCorpusConfig = (
	root: string,
	input: CorpusConfigInput = {},
): CorpusConfig => {
	validateConfigInput(input)
	const resolvedRoot = resolve(root)
	const at = (p: string) =>
		isAbsolute(p) ? resolve(p) : resolve(resolvedRoot, p)
	const outDir = at(input.outDir ?? DEFAULT_OUT_DIR)
	const rel = relative(resolvedRoot, outDir)
	if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel))
		throw new Error(
			`${CONFIG_FILENAME}: "outDir" must be a directory INSIDE the project ` +
				`root — got ${outDir}, root is ${resolvedRoot}. Generated modules ` +
				`address the project root relatively, so an output root outside it ` +
				`cannot be expressed.`,
		)
	const sources = input.sources ?? DEFAULT_SOURCES
	if (sources.length === 0)
		throw new Error(
			`${CONFIG_FILENAME}: "sources" must list at least one glob.`,
		)
	const locales = input.locales ?? DEFAULT_LOCALES
	const variantOverrides: Record<string, VariantSurface> = {}
	for (const [tag, surface] of Object.entries(input.variantOverrides ?? {}))
		if (surface !== undefined) variantOverrides[tag] = surface
	return {
		root: resolvedRoot,
		sources: [...sources],
		siblingModules: [...(input.siblingModules ?? DEFAULT_SIBLING_MODULES)],
		outDir,
		i18nDir: at(input.i18nDir ?? DEFAULT_I18N_DIR),
		locales: [...locales],
		runtimeImport: input.runtimeImport ?? DEFAULT_RUNTIME_IMPORT,
		variantSurface: input.variantSurface ?? DEFAULT_VARIANT_SURFACE,
		variantOverrides,
		cssTargets: input.cssTargets
			? resolveCssTargets(input.cssTargets)
			: DEFAULT_CSS_TARGETS,
	}
}

export const validateVariantOverrides = (
	config: CorpusConfig,
	sourcesByTag: ReadonlyMap<string, readonly string[]>,
): void => {
	for (const tag of Object.keys(config.variantOverrides)) {
		const sources = sourcesByTag.get(tag) ?? []
		if (sources.length === 0)
			fail(
				`"variantOverrides["${tag}"]" names no variant set — no variant set declares this tag. Remove the entry, or correct the tag.`,
			)
		if (sources.length === 1)
			fail(
				`"variantOverrides["${tag}"]" names no variant set — only one surface authors it (${sources[0]}). An override selects between the members of a variant set; remove the entry, or add the other surface's source beside it.`,
			)
	}
}

/** The emitter-facing projection of a configuration. */
export const emitPathsFor = (config: CorpusConfig): EmitPaths => ({
	outDirPrefix: outDirPrefix(config.root, config.outDir),
	runtimeImport: config.runtimeImport ?? DEFAULT_RUNTIME_IMPORT,
	cssTargets: config.cssTargets,
})
