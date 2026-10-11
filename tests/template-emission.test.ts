/** Template emission's shared walk: the walk owns every decision — hole classification, escaping contexts, refused positions, routing — and a target owns only syntax. Proved through the test-only dump target, whose interpreter renders the dumped operations: every emittable component renders byte-identically to its SSG render, per fixture arg set and locale. The walk runs only when a target is configured, so a plain build is unchanged. */

import { afterAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { templateCensus } from '../src/census'
import { compileCorpusFiles, type InternalCorpusResult } from '../src/corpus'
import type { CorpusFile } from '../src/corpus-scan'
import { compileSource } from '../src/frontend/tsrx/compiler'
import { compileSourceTsx } from '../src/frontend/tsx/compiler-tsx'
import type { ComponentIR } from '../src/ir'
import type { TemplateOp, TemplatePartial } from '../src/template/operations'
import { walkPartial } from '../src/template/walk'
import { CORPUS_ARGS, renderName } from './corpus-args'
import { loadCorpus } from './corpus-fixture'
import { REPO_CONFIG, REPO_ROOT } from './corpus-sources'
import { createGeneratedDir } from './helpers/generated-corpus'
import { type DumpLookup, dumpTarget, renderDump } from './targets/dump'

const TEMPLATE_CODES: ReadonlySet<string> = new Set(['LTC057', 'LTC058'])
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests/fixtures/template')

const plainDir = createGeneratedDir('template-plain')
const targetDir = createGeneratedDir('template-target')
const fixtureDir = createGeneratedDir('template-fixtures')
const refusalDir = createGeneratedDir('template-refusals')
afterAll(() => {
	for (const dir of [plainDir, targetDir, fixtureDir, refusalDir]) dir.cleanup()
})

/* === Helpers === */

const lookupOf =
	(result: InternalCorpusResult): DumpLookup =>
	(tag, locale) =>
		result.template?.partials.find(p => p.tag === tag && p.locale === locale)
			?.output

const partialOf = (
	result: InternalCorpusResult,
	tag: string,
	locale: string,
): TemplatePartial => {
	const output = lookupOf(result)(tag, locale)
	if (output === undefined)
		throw new Error(`no partial for <${tag}> at ${locale}`)
	return JSON.parse(output) as TemplatePartial
}

/** Every op in a partial, nested bodies included, in document order. */
const flatOps = (ops: readonly TemplateOp[]): TemplateOp[] =>
	ops.flatMap(op => {
		switch (op.op) {
			case 'conditional':
				return [
					op,
					...op.branches.flatMap(b => flatOps(b.body)),
					...flatOps(op.otherwise),
				]
			case 'loop':
				return [op, ...flatOps(op.body), ...flatOps(op.empty)]
			case 'arm-template':
			case 'list-template':
				return [op, ...flatOps(op.body)]
			case 'boundary':
				return [op, ...flatOps(op.ok), ...flatOps(op.nil), ...flatOps(op.err)]
			default:
				return [op]
		}
	})

type Renderer = (args: Record<string, unknown>) => string

/** The SSG render of `tag` from the build's own module, with the record at `locale` when it declares one. */
const ssgRender = async (
	result: InternalCorpusResult,
	outDir: string,
	tag: string,
	locale: string,
	args: Record<string, unknown>,
): Promise<string> => {
	const info = result.spanInfos.find(i => i.tag === tag)
	const entry = result.entries.find(e => e.tag === tag)
	if (!info || !entry) throw new Error(`<${tag}> was not compiled`)
	const mod = (await import(
		pathToFileURL(info.serverModulePath).href
	)) as Record<string, Renderer>
	const i18n = (await import(
		pathToFileURL(path.join(outDir, 'i18n.ts')).href
	)) as {
		i18nRecord: (tag: string, lang?: string) => unknown
	}
	const render = mod[renderName(tag)]
	if (!render) throw new Error(`${renderName(tag)} is not exported`)
	return render(
		entry.declaresI18n ? { ...args, i18n: i18n.i18nRecord(tag, locale) } : args,
	)
}

/** A render outcome, a throw included, so both sides compare whatever they do. */
const outcome = (render: () => string): string => {
	try {
		return render()
	} catch (error) {
		return `throws ${error instanceof Error ? error.constructor.name : 'value'}`
	}
}

const outcomeAsync = async (render: () => Promise<string>): Promise<string> => {
	try {
		return await render()
	} catch (error) {
		return `throws ${error instanceof Error ? error.constructor.name : 'value'}`
	}
}

/** The tags `tag` includes, transitively. */
const includedTags = (
	result: InternalCorpusResult,
	tag: string,
	seen = new Set<string>(),
): Set<string> => {
	for (const locale of REPO_CONFIG.locales) {
		const output = lookupOf(result)(tag, locale)
		if (output === undefined) continue
		for (const op of flatOps((JSON.parse(output) as TemplatePartial).ops))
			if (op.op === 'include' && !seen.has(op.tag)) {
				seen.add(op.tag)
				includedTags(result, op.tag, seen)
			}
	}
	return seen
}

const fileOf = (dir: string, name: string): CorpusFile => {
	const full = path.join(dir, name)
	return {
		path: full,
		filename: path.relative(REPO_ROOT, full),
		content: readFileSync(full, 'utf8'),
	}
}

const diagnosticKeys = (result: InternalCorpusResult): string[] =>
	result.diagnostics
		.filter(d => !TEMPLATE_CODES.has(d.code))
		.map(d => `${d.code} ${d.location.file}:${d.location.start}`)
		.sort()

/* === The corpus === */

const corpus = await loadCorpus()
const plain = await compileCorpusFiles(corpus, {
	...REPO_CONFIG,
	outDir: plainDir.path,
})
const targeted = await compileCorpusFiles(
	corpus,
	{ ...REPO_CONFIG, outDir: targetDir.path },
	{ templateTarget: dumpTarget },
)
const census = targeted.template?.census
const censusOf = (tag: string) =>
	census?.entries.find(entry => entry.subject === tag)

/** Components whose own partial and every included partial carry no routing reason: the SSG render is their oracle. */
const comparable = (result: InternalCorpusResult, tag: string): boolean => {
	const own = result.template?.census.entries.find(e => e.subject === tag)
	if (!own || own.value !== 'folded') return false
	return [...includedTags(result, tag)].every(
		child =>
			result.template?.census.entries.find(e => e.subject === child)?.value ===
			'folded',
	)
}

describe('a corpus build with no template target', () => {
	test('runs no walk: no template result, no LTC057/LTC058', () => {
		expect(plain.template).toBeUndefined()
		expect(plain.diagnostics.filter(d => TEMPLATE_CODES.has(d.code))).toEqual(
			[],
		)
	})
})

describe('a corpus build with the dump target', () => {
	test('reports every other diagnostic exactly as the plain build does', () => {
		expect(diagnosticKeys(targeted)).toEqual(diagnosticKeys(plain))
	})

	test('refuses the components whose holes leave the portable subset or sit in refused positions', () => {
		const refused = [
			...new Set(
				targeted.diagnostics
					.filter(d => TEMPLATE_CODES.has(d.code))
					.map(d => `${d.code} ${path.basename(d.location.file)}`),
			),
		].sort()
		expect(refused).toEqual([
			'LTC057 basic-blogmeta.tsx',
			'LTC057 basic-button.tsrx',
			'LTC057 form-combobox.tsx',
			'LTC057 form-listbox.tsx',
			'LTC057 form-radiogroup.tsrx',
			'LTC057 form-spinbutton.tsrx',
			'LTC057 form-textbox.tsrx',
			'LTC057 form-tokenbox.tsrx',
			'LTC057 module-carousel.tsx',
			'LTC057 module-coloreditor.tsx',
			'LTC057 module-colorinfo.tsx',
			'LTC057 module-listnav.tsx',
			'LTC057 module-pagination.tsx',
			'LTC057 module-splitview.tsx',
			'LTC057 module-tabgroup.tsrx',
			'LTC057 module-ticker.tsx',
			'LTC058 module-colorinfo.tsx',
			'LTC058 module-splitview.tsx',
		])
		for (const d of targeted.diagnostics.filter(d =>
			TEMPLATE_CODES.has(d.code),
		))
			expect(d.severity).toBe('error')
	})

	test('every served component without a finding emits one partial per locale, in its census tier', () => {
		const refusedFiles = new Set(
			targeted.diagnostics
				.filter(d => TEMPLATE_CODES.has(d.code))
				.map(d => d.location.file),
		)
		const emitting = plain.entries.filter(e => !refusedFiles.has(e.source))
		expect(emitting.length).toBeGreaterThan(20)
		for (const entry of emitting) {
			expect(censusOf(entry.tag)?.value, entry.tag).toMatch(/^(folded|static)$/)
			for (const locale of REPO_CONFIG.locales) {
				const partial = targeted.template?.partials.find(
					p => p.tag === entry.tag && p.locale === locale,
				)
				expect(partial?.fileName, `${entry.tag} at ${locale}`).toBe(
					`${entry.tag}.${locale}.dump.json`,
				)
				expect(partial?.tier).toBe(censusOf(entry.tag)?.value as never)
			}
		}
	})

	test('the census carries each routing reason the corpus exercises', () => {
		expect(censusOf('module-lazyload')?.reasons).toContain(
			'not yet emittable: the async boundary (line 117)',
		)
		expect(censusOf('module-list')?.reasons).toContain(
			'not yet emittable: the reactive list over `items` (line 58)',
		)
		expect(censusOf('module-dialog')?.reasons).toContain(
			'not yet emittable: the content passed to `<ModuleScrollarea>` as children (line 137)',
		)
		expect(
			censusOf('basic-gauge')?.reasons.some(r =>
				r.startsWith('non-portable initial: `qualification.get().label`'),
			),
		).toBe(true)
		for (const tag of ['basic-counter', 'card-callout', 'module-scrollarea'])
			expect(censusOf(tag)).toEqual({
				subject: tag,
				value: 'folded',
				reasons: [],
			})
	})

	const emittable = plain.entries
		.map(e => e.tag)
		.filter(tag => comparable(targeted, tag))
		.sort()

	test('the byte-compared set is every comparable component', () => {
		expect(emittable).toEqual([
			'basic-counter',
			'basic-hello',
			'basic-number',
			'card-blogpost',
			'card-callout',
			'card-collapsible',
			'card-colorscale',
			'card-mediaqueries',
			'context-media',
			'css-probe-child',
			'form-checkbox',
			'module-cem-list',
			'module-scrollarea',
			'section-menu',
		])
	})

	for (const tag of emittable)
		for (const locale of REPO_CONFIG.locales)
			test(`${tag} at ${locale}: the dump render is byte-identical to SSG`, async () => {
				const args = { ...(CORPUS_ARGS[tag] ?? {}) }
				delete args.i18n
				const expected = await outcomeAsync(() =>
					ssgRender(targeted, targetDir.path, tag, locale, args),
				)
				expect(expected.startsWith('throws')).toBe(false)
				expect(
					outcome(() => renderDump(lookupOf(targeted), tag, locale, args)),
				).toBe(expected)
			})
})

/* === Fixtures, both surfaces === */

const fixtureConfig = {
	...REPO_CONFIG,
	outDir: fixtureDir.path,
	i18nDir: path.join(FIXTURE_DIR, 'i18n'),
}
const fixtureFiles = [
	'tpl-chip.tsx',
	'tpl-showcase.tsx',
	'tpl-showcase-r.tsrx',
].map(name => fileOf(FIXTURE_DIR, name))
const fixtures = await compileCorpusFiles(fixtureFiles, fixtureConfig, {
	templateTarget: dumpTarget,
})
const fixturesPlain = await compileCorpusFiles(fixtureFiles, {
	...fixtureConfig,
	outDir: path.join(fixtureDir.path, 'plain'),
})

const SHOWCASE_ARGS: Record<string, Record<string, unknown>> = {
	full: {
		title: `Tom & "Jerry" <it>'s`,
		href: 'https://example.com/?a=1&b=2',
		items: [
			{ id: '1', name: 'One' },
			{ id: '2', name: 'Two <2>' },
		],
		mode: 'b',
		note: 'A <note>',
	},
	empty: { title: 'Bare', hidden: true },
	'hidden false, one item': {
		title: 'Solo',
		hidden: false,
		items: [{ id: '1', name: 'Only' }],
		mode: 'a',
	},
	'missing title': {},
}

describe('the showcase fixtures', () => {
	test('compile clean, with no finding and no routing reason', () => {
		expect(fixtures.diagnostics).toEqual([])
		for (const tag of ['tpl-chip', 'tpl-showcase', 'tpl-showcase-r'])
			expect(
				fixtures.template?.census.entries.find(e => e.subject === tag),
			).toEqual({
				subject: tag,
				value: 'folded',
				reasons: [],
			})
	})

	test('a plain build of the same files writes byte-identical server modules', () => {
		expect(fixturesPlain.template).toBeUndefined()
		for (const info of fixtures.spanInfos) {
			const twin = fixturesPlain.spanInfos.find(i => i.tag === info.tag)
			expect(twin).toBeDefined()
			expect(readFileSync(info.serverModulePath, 'utf8')).toBe(
				readFileSync(twin?.serverModulePath ?? '', 'utf8'),
			)
		}
	})

	test('both surfaces walk to the same operations', () => {
		for (const locale of REPO_CONFIG.locales) {
			const tsx = JSON.stringify(
				partialOf(fixtures, 'tpl-showcase', locale).ops,
			)
			const tsrx = JSON.stringify(
				partialOf(fixtures, 'tpl-showcase-r', locale).ops,
			).replaceAll('tpl-showcase-r', 'tpl-showcase')
			expect(tsrx).toBe(tsx)
		}
	})

	test('the walk assigns each hole its escaping context', () => {
		const ops = flatOps(partialOf(fixtures, 'tpl-showcase', 'en').ops)
		const contexts = (attribute?: string) =>
			ops.flatMap(op =>
				(op.op === 'hole' || op.op === 'segments' || op.op === 'message') &&
				op.attribute === attribute
					? [op.context]
					: [],
			)
		expect(contexts('href')).toEqual(['url-attribute'])
		expect(contexts('hidden')).toEqual(['boolean-attribute'])
		expect(contexts('class')).toEqual(['class-token'])
		expect(contexts('data-mode')).toEqual(['quoted-attribute'])
		expect(contexts()).toContain('text')
		const id = ops.find(op => op.op === 'segments' && op.attribute === 'id')
		expect(id).toEqual({
			op: 'segments',
			context: 'quoted-attribute',
			attribute: 'id',
			segments: [
				{ kind: 'hole', value: { kind: 'arg', name: 'title' } },
				{ kind: 'literal', text: '-heading' },
			],
		})
	})

	test('a message call carries the localized pattern; an argument-less message folds', () => {
		const de = flatOps(partialOf(fixtures, 'tpl-showcase', 'de').ops)
		expect(de.find(op => op.op === 'message')).toMatchObject({
			context: 'text',
			message: { pattern: '{n, plural, one {# Eintrag} other {# Einträge}}' },
		})
		expect(de).toContainEqual({
			op: 'hole',
			context: 'text',
			value: { kind: 'literal', value: 'Hallo' },
		})
	})

	test('a server-data loop carries its empty arm; a compose site becomes an include', () => {
		const ops = flatOps(partialOf(fixtures, 'tpl-showcase', 'de').ops)
		const loop = ops.find(op => op.op === 'loop')
		expect(loop).toMatchObject({ item: 'item', index: null })
		expect(loop?.op === 'loop' && loop.empty.length).toBeGreaterThan(0)
		// The parent binds no `lang`, so the child's record resolves at the page locale.
		expect(ops.find(op => op.op === 'include')).toMatchObject({
			tag: 'tpl-chip',
			locale: 'en',
			args: [{ name: 'label', value: { kind: 'arg', name: 'title' } }],
			hostAttributes: [
				{ name: 'class', value: { kind: 'literal', value: 'chip' } },
				{ name: 'data-kind', value: { kind: 'arg', name: 'mode' } },
			],
		})
	})

	test('a reactive conditional emits its initial winner beside inert arm templates', () => {
		const ops = partialOf(fixtures, 'tpl-showcase', 'en').ops
		const templates = ops.filter(op => op.op === 'arm-template')
		expect(templates.map(op => op.op === 'arm-template' && op.key)).toEqual([
			'then',
			'else',
		])
		const then =
			templates[0]?.op === 'arm-template' ? flatOps(templates[0].body) : []
		// The server-arg site stays a hole; the client-written `aria-expanded` bakes empty.
		expect(then.some(op => op.op === 'hole' && op.value.kind === 'arg')).toBe(
			true,
		)
		expect(
			then.some(op => op.op === 'hole' && op.attribute === 'aria-expanded'),
		).toBe(false)
		const live = ops.findLast(op => op.op === 'conditional')
		expect(live?.op === 'conditional' && live.branches[0]?.test).toEqual({
			kind: 'compare',
			operator: '===',
			left: {
				kind: 'arg',
				name: 'hidden',
				fallback: { kind: 'literal', value: false },
			},
			right: { kind: 'literal', value: false },
		})
	})

	for (const tag of ['tpl-chip', 'tpl-showcase', 'tpl-showcase-r'])
		for (const locale of REPO_CONFIG.locales)
			for (const [label, args] of Object.entries(
				tag === 'tpl-chip'
					? { label: { label: 'A & B' }, none: {} }
					: SHOWCASE_ARGS,
			))
				test(`${tag} at ${locale}, ${label} args: the dump render is byte-identical to SSG`, async () => {
					const expected = await outcomeAsync(() =>
						ssgRender(fixtures, fixtureDir.path, tag, locale, args),
					)
					expect(expected.startsWith('throws')).toBe(false)
					expect(
						outcome(() => renderDump(lookupOf(fixtures), tag, locale, args)),
					).toBe(expected)
				})
})

/* === Refusals === */

const refusal = (
	tag: string,
	params: string,
	body: string,
): string => `import { css } from '@zeix/le-truc-compiler/macros'

export function ${tag
	.split('-')
	.map(p => p[0]?.toUpperCase() + p.slice(1))
	.join('')}({ ${params} }: Record<string, any>) {
	return (
		<${tag}>
			${body}
			<style>{css\`@scope {
	:where(:scope) { display: block; }
}\`}</style>
		</${tag}>
	)
}
`

const REFUSALS: Record<string, string> = {
	'tpl-call': refusal('tpl-call', 'title', '<p>{title.toUpperCase()}</p>'),
	'tpl-intl': refusal(
		'tpl-intl',
		'amount',
		"<p>{new Intl.NumberFormat('en-US').format(amount)}</p>",
	),
	'tpl-handler': refusal('tpl-handler', 'code', '<div onclick={code}></div>'),
	'tpl-srcdoc': refusal('tpl-srcdoc', 'doc', '<iframe srcdoc={doc}></iframe>'),
	'tpl-style': refusal('tpl-style', 'rules', '<div style={rules}></div>'),
}

describe('refused holes', () => {
	const files: CorpusFile[] = Object.entries(REFUSALS).map(
		([tag, content]) => ({
			path: path.join(refusalDir.path, `${tag}.tsx`),
			filename: path.relative(
				REPO_ROOT,
				path.join(refusalDir.path, `${tag}.tsx`),
			),
			content,
		}),
	)

	test('fire only when a template target is configured', async () => {
		const result = await compileCorpusFiles(files, {
			...REPO_CONFIG,
			outDir: path.join(refusalDir.path, 'plain'),
		})
		expect(result.diagnostics).toEqual([])
		expect(result.entries.map(e => e.tag).sort()).toEqual(
			Object.keys(REFUSALS).sort(),
		)
	})

	test('are compiler-channel errors that drop the component from the output', async () => {
		const result = await compileCorpusFiles(
			files,
			{ ...REPO_CONFIG, outDir: path.join(refusalDir.path, 'target') },
			{ templateTarget: dumpTarget },
		)
		const byTag = (tag: string) =>
			result.diagnostics.filter(d => d.location.file.endsWith(`${tag}.tsx`))
		expect(byTag('tpl-call').map(d => d.code)).toEqual(['LTC057'])
		expect(byTag('tpl-call')[0]?.message).toContain(
			'`title.toUpperCase()` in a text position is outside the portable subset',
		)
		expect(byTag('tpl-intl').map(d => d.code)).toEqual(['LTC057'])
		expect(byTag('tpl-intl')[0]?.message).toContain(
			'formats a value with `Intl`',
		)
		expect(byTag('tpl-intl')[0]?.message).toContain('ICU pattern')
		expect(byTag('tpl-handler').map(d => d.code)).toEqual(['LTC058'])
		expect(byTag('tpl-handler')[0]?.message).toContain(
			'The `onclick` attribute takes a value',
		)
		expect(byTag('tpl-srcdoc')[0]?.message).toContain(
			'The `srcdoc` attribute takes a value',
		)
		expect(byTag('tpl-style')[0]?.message).toContain(
			'The whole `style` attribute takes a value',
		)
		for (const d of result.diagnostics) expect(d.severity).toBe('error')
		expect(result.entries).toEqual([])
		expect(result.template?.partials).toEqual([])
		for (const [tag] of Object.entries(REFUSALS)) {
			const source =
				files.find(f => f.filename.endsWith(`${tag}.tsx`))?.content ?? ''
			const at = byTag(tag)[0]?.location.start ?? -1
			expect(source.slice(at)).toMatch(/^(title|new Intl|code|doc|rules)/)
		}
	})

	test('a hole in `<script>` or `<style>` content is refused in the walk', () => {
		const { component } = compileSourceTsx(
			refusal('tpl-script', 'code', '<script>{code}</script>'),
			'tpl-script.tsx',
		)
		if (!component) throw new Error('tpl-script did not lower')
		const run = walkIR(component)
		expect(run.diagnostics.map(d => d.code)).toEqual(['LTC058'])
		expect(run.diagnostics[0]?.message).toContain(
			'A value in `<script>` content cannot become a template hole',
		)
	})
})

/* === Routing === */

const walkIR = (component: ComponentIR) =>
	walkPartial({
		component,
		composeRegistry: new Map(),
		locale: 'en',
		pageLocale: 'en',
		timeZone: 'UTC',
		currency: 'USD',
		messages: new Map(),
		clientMessageKeys: [],
	})

describe('routing outcomes', () => {
	test('a synchronous `try` routes the partial Static, without a finding', () => {
		const { component } = compileSource(
			`export function C({ data }: { data?: string })
	@{
		<c-try>
			@try {
				<p class="ok">{data}</p>
			} @catch (e) {
				<p class="err">failed</p>
			}
			<style>@scope {
	:where(:scope) { display: block; }
}</style>
		</c-try>
	}
`,
			'c-try.tsrx',
		)
		if (!component) throw new Error('c-try did not lower')
		const run = walkIR(component)
		expect(run.diagnostics).toEqual([])
		expect(run.routing.map(r => `${r.reason}: ${r.detail}`)).toEqual([
			'synchronous try: it catches a JavaScript throw, which no template observes',
		])
	})

	test('a key-alias harvest routes the partial Static, beside its reactive lists', () => {
		const source = readFileSync(
			path.join(REPO_ROOT, 'examples/module/ticker/module-ticker.tsx'),
			'utf8',
		)
		const { component } = compileSourceTsx(source, 'module-ticker.tsx')
		if (!component) throw new Error('module-ticker did not lower')
		const reasons = walkIR(component).routing.map(r => r.reason)
		expect(reasons).toContain('key-alias harvest')
		expect(reasons).toContain('not yet emittable')
	})

	test('the census formats each reason with its line', () => {
		const formatted = templateCensus(
			'dump',
			[
				{
					tag: 'c-try',
					tier: 'static',
					reasons: [
						{
							reason: 'synchronous try',
							detail:
								'it catches a JavaScript throw, which no template observes',
							location: { file: 'c.tsrx', start: 2, end: 3 },
						},
					],
				},
				{ tag: 'b-plain', tier: 'folded', reasons: [] },
			],
			() => 'a\nbc\n',
		)
		expect(formatted.entries).toEqual([
			{ subject: 'b-plain', value: 'folded', reasons: [] },
			{
				subject: 'c-try',
				value: 'static',
				reasons: [
					'synchronous try: it catches a JavaScript throw, which no template observes (line 2)',
				],
			},
		])
		expect(formatted.name).toBe('Template census (dump)')
	})
})

test('the dump target ships nowhere: no shipped source imports it', () => {
	const shipped = readdirSync(path.join(REPO_ROOT, 'src'), {
		recursive: true,
	}).filter(file => String(file).endsWith('.ts'))
	for (const file of shipped)
		expect(
			readFileSync(path.join(REPO_ROOT, 'src', String(file)), 'utf8'),
		).not.toContain('targets/dump')
})
