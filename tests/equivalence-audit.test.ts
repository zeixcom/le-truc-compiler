/** CI equivalence audit: two mechanisms produce a Folded-tier component's server answer — the value harness (phase 1) and the simulation realm (phase 2). Every signal in a Folded component seeds from a DOM harvest, so the two cannot independently disagree on a server value; the diff measures the hydration boundary — serializer normalization, designed connect-time writes, and any write that overwrites or removes server-rendered state. Phase 2 runs over every Folded component's phase-1 render and the connect diff is pinned per component; a diff that grows, shrinks or moves is a snapshot regression and a review trigger. Inputs are identical on both sides: shared fixture args, phase 1's exact markup, no locale. */
import { afterAll, describe, expect, test } from 'bun:test'
import { pathToFileURL } from 'node:url'
import type { InternalComponentRegistry } from '../src/registry'
import { createSimulationRealm } from '../src/sim/realm'
import { CORPUS_ARGS, renderName } from './corpus-args'
import { compileCorpus } from './corpus-compile'
import { loadCorpus } from './corpus-fixture'
import { createGeneratedDir } from './helpers/generated-corpus'

const generated = createGeneratedDir('equivalence-audit')
afterAll(() => generated.cleanup())

const compiled = await compileCorpus(await loadCorpus(), generated.path)
const registry = JSON.parse(
	await Bun.file(`${generated.path}/registry.internal.json`).text(),
) as InternalComponentRegistry

const realm = createSimulationRealm({
	composesTags: tag => registry[tag]?.composesTags ?? [],
	suppressedSites: tag => registry[tag]?.suppressedSites ?? [],
})
afterAll(() => realm.dispose())

// Load every client module exactly once (children arrive as import side
// effects of their parents — same skip-if-defined loop as sim-driver).
for (const info of compiled) {
	if (realm.definitions.some(entry => entry.name === info.tag)) continue
	await realm.load(() => import(pathToFileURL(info.clientModulePath).href))
}

/** One compiled corpus entry, as `compileCorpus` reported it. */
type CompiledInfo = (typeof compiled)[number]

const foldedEntries = Object.values(registry).filter(
	entry => entry.tier === 'folded',
)

/** The connect diff between a component's phase-1 render and its phase-2 (post-connect) serialization: scan forward to each first difference, then resync on the first common stretch of at least `RESYNC` characters and repeat. A review record, not a semantic diff — its shape is what the snapshot pins. */
const WINDOW = 60
const RESYNC = 32
const connectDiff = (phase1: string, phase2: string): string => {
	const regions: string[] = []
	let a = 0
	let b = 0
	for (;;) {
		while (a < phase1.length && b < phase2.length && phase1[a] === phase2[b]) {
			a++
			b++
		}
		if (a >= phase1.length && b >= phase2.length) break
		// Resync: the smallest advance where both tails rejoin for RESYNC
		// characters. Falls off the end when one side is exhausted.
		let endA = phase1.length
		let endB = phase2.length
		scan: for (let i = a; i <= phase1.length; i++)
			for (let j = b; j <= phase2.length; j++) {
				const n = Math.min(RESYNC, phase1.length - i, phase2.length - j)
				if (
					n === RESYNC &&
					phase1.slice(i, i + RESYNC) === phase2.slice(j, j + RESYNC)
				) {
					endA = i
					endB = j
					break scan
				}
			}
		regions.push(
			`@${a} (-${endA - a}/+${endB - b})  P1: …${phase1.slice(Math.max(0, a - WINDOW), Math.min(phase1.length, endA + WINDOW))}…\n` +
				`          P2: …${phase2.slice(Math.max(0, b - WINDOW), Math.min(phase2.length, endB + WINDOW))}…`,
		)
		a = endA
		b = endB
	}
	return regions.join('\n')
}

describe('CI equivalence audit (ADR 0008 s7, amended 2026-09-06 — LT-165 step 8)', () => {
	test('the audit covers every Folded-tier entry the registry carries — none silently skipped', () => {
		// A Folded registry entry with no matching compiled info (or vice versa) must fail loudly here, or the audit below would quietly shrink while staying green.
		expect(foldedEntries.length).toBeGreaterThan(0)
		for (const entry of foldedEntries)
			expect(
				compiled.some(info => info.tag === entry.tag),
				`${entry.tag} is Folded in the registry but absent from the compiled corpus`,
			).toBe(true)
	})

	for (const entry of foldedEntries) {
		test(`${entry.tag}: the connect diff against the harness render is the recorded hydration boundary`, async () => {
			const info = compiled.find((i): i is CompiledInfo => i.tag === entry.tag)!
			// Phase 1 — the value harness over the shared fixture args.
			const mod = (await import(
				pathToFileURL(info.serverModulePath).href
			)) as Record<string, unknown>
			const renderFn = mod[renderName(entry.tag)] as (args: unknown) => string
			const phase1 = renderFn(CORPUS_ARGS[entry.tag] ?? {})
			// Phase 2 — the realm parses that exact markup and replays the connect. No locale on either side: identical inputs are the audit's validity condition.
			const { html: phase2 } = await realm.render({
				markup: phase1,
				component: entry.tag,
			})
			// The diff is the record: a snapshot regression here means the hydration boundary moved — a new client write, a serializer change, or a hydration bug — a review trigger, not an automatic failure.
			expect(connectDiff(phase1, phase2)).toMatchSnapshot()
		})
	}

	// The snapshot records the dangerous class only as a shape; this pins the fact itself, so a regression fails on an assertion naming the symptom rather than on a diff a reviewer must interpret.
	test('form-tokenbox: the authored text input survives hydration (LT-185 regression)', async () => {
		const info = compiled.find(i => i.tag === 'form-tokenbox')!
		const mod = (await import(
			pathToFileURL(info.serverModulePath).href
		)) as Record<string, unknown>
		const renderFn = mod[renderName('form-tokenbox')] as (
			args: unknown,
		) => string
		const phase1 = renderFn(CORPUS_ARGS['form-tokenbox'] ?? {})
		expect(phase1).toContain('id="tags-input"')
		const { html: phase2 } = await realm.render({
			markup: phase1,
			component: 'form-tokenbox',
		})
		// `reconcile()` owns `data-container`'s children and removes every unkeyed one, so the authored input must carry the `data-unreconciled` opt-out to survive the first reconcile pass.
		expect(phase2).toContain('id="tags-input"')
		// Inside the reconcile container specifically — surviving anywhere else would not mean it survived the pass that removed it. The container holds only spans, so the first `</div>` closes it.
		const fromContainer = phase2.slice(phase2.indexOf('<div data-container'))
		const containerInner = fromContainer.slice(
			0,
			fromContainer.indexOf('</div>'),
		)
		expect(containerInner).toContain('id="tags-input"')
	})
})

/** A component's phase-1 render, from the shared fixture args. */
const renderPhase1 = async (info: CompiledInfo): Promise<string> => {
	const mod = (await import(
		pathToFileURL(info.serverModulePath).href
	)) as Record<string, unknown>
	const renderFn = mod[renderName(info.tag)] as (args: unknown) => string
	return renderFn(CORPUS_ARGS[info.tag] ?? {})
}

/** Every arm set under `root`: the `template[data-arms="N"]` children of one parent, and the live arm — the non-template sibling whose `data-key` names one of those templates. A set inside a reactive list's item template is not walked: it has no server winner. */
const armSets = (root: Element) =>
	[...root.querySelectorAll('template[data-arms]')]
		.filter(
			t =>
				t.previousElementSibling?.getAttribute('data-arms') !==
				t.getAttribute('data-arms'),
		)
		.map(first => {
			const parent = first.parentElement!
			const templates = [
				...parent.querySelectorAll(
					`:scope > template[data-arms="${first.getAttribute('data-arms')}"]`,
				),
			]
			const keys = new Set(templates.map(t => t.getAttribute('data-key')))
			const live = [...parent.children].filter(
				el =>
					el.localName !== 'template' && keys.has(el.getAttribute('data-key')),
			)
			return {
				live: live.map(el => el.getAttribute('data-key')),
				templates: templates.map(t => t.outerHTML),
			}
		})

/** Arm sets whose task settles during the realm's drain, so the live arm flips AFTER adoption — a state change, not a failed adoption. The realm's document is `about:blank`, so lazyload's relative `src` fails `isValidURL` and its task rejects: the `nil` arm is adopted, then flips to `err`. In a browser the fetch is still in flight at connect and `nil` stays. */
const SETTLED_IN_REALM: Record<string, string[]> = {
	'module-lazyload': ['err'],
	'module-listnav': ['err'],
}

// The adoption contract: the client adopts the server's winning arm by key — never cloning a replacement at connect, never touching an arm template. This block covers every component whose phase-1 render ships a live arm set, in every tier, checking node identity, not just bytes (a re-cloned arm whose binding rewrites the same text serializes identically).
const armEntries: CompiledInfo[] = []
{
	const inert = realm.document.implementation.createHTMLDocument('')
	for (const info of compiled) {
		inert.body.innerHTML = await renderPhase1(info)
		if (armSets(inert.body).length > 0) armEntries.push(info)
	}
}

describe('arm adoption across the hydration boundary (ADR 0015, LT-390)', () => {
	test('the corpus consumers of both arm forms are covered — the class is not vacuous', () => {
		const tags = armEntries.map(info => info.tag)
		// A reactive `@if` and the async boundary. A new consumer joins the loop below on its own; losing one of these fails here.
		expect(tags).toContain('form-inplace-edit')
		expect(tags).toContain('module-lazyload')
		for (const tag of Object.keys(SETTLED_IN_REALM)) expect(tags).toContain(tag)
	})

	for (const info of armEntries) {
		test(`${info.tag}: connect adopts the server's live arm and leaves the arm templates untouched`, async () => {
			const phase1 = await renderPhase1(info)
			const { document } = realm
			const inert = document.implementation.createHTMLDocument('')
			inert.body.innerHTML = phase1
			const before = armSets(inert.querySelector(info.tag)!)
			for (const set of before) expect(set.live).toHaveLength(1)
			const serverKeys = new Set(before.map(set => set.live[0]))

			// Every childList mutation below the body during the connect: collect from the callback (the drain delivers there) as well as from takeRecords(); body-level records are the previous render's teardown and this render's parse.
			const records: MutationRecord[] = []
			const observer = new document.defaultView!.MutationObserver(batch => {
				records.push(...batch)
			})
			observer.observe(document.body, { childList: true, subtree: true })
			await realm.render({ markup: phase1, component: info.tag })
			records.push(...observer.takeRecords())
			observer.disconnect()

			// A re-cloned winner: an arm root carrying a server-live key inserted beside its templates.
			const recloned = records
				.filter(r => r.target !== document.body)
				.flatMap(r =>
					[...r.addedNodes].filter(
						node =>
							node.nodeType === 1 &&
							(node as Element).localName !== 'template' &&
							serverKeys.has((node as Element).getAttribute('data-key')) &&
							(r.target as Element).querySelector(
								`:scope > template[data-arms][data-key="${(node as Element).getAttribute('data-key')}"]`,
							) !== null,
					),
				)
				.map(node => (node as Element).outerHTML)
			expect(recloned).toEqual([])

			const after = armSets(document.querySelector(info.tag)!)
			expect(after.map(set => set.templates)).toEqual(
				before.map(set => set.templates),
			)
			const settled: (string | null)[] =
				SETTLED_IN_REALM[info.tag] ?? before.map(set => set.live[0] ?? null)
			expect(after.map(set => set.live)).toEqual(settled.map(key => [key]))
		})
	}
})

describe('form-inplace-edit: a server-rendered edit arm (LT-390 review)', () => {
	test('seeds the textbox from the render value, so committing keeps it', async () => {
		const info = compiled.find(entry => entry.tag === 'form-inplace-edit')!
		const mod = (await import(
			pathToFileURL(info.serverModulePath).href
		)) as Record<string, unknown>
		const renderFn = mod[renderName(info.tag)] as (args: unknown) => string
		const markup = renderFn({ name: 'label', value: 'x', editing: true })

		const inert = realm.document.implementation.createHTMLDocument('')
		inert.body.innerHTML = markup
		const live = inert.querySelector(':scope form-inplace-edit > .edit')!
		expect(live.getAttribute('data-key')).toBe('then')
		expect(live.querySelector('input')?.getAttribute('value')).toBe('x')

		await realm.render({ markup, component: info.tag })
		const host = realm.document.querySelector(
			'form-inplace-edit',
		) as HTMLElement & { value: string; editing: boolean }
		const textbox = host.querySelector('form-textbox') as HTMLElement & {
			value: string
		}
		expect(host.editing).toBe(true)
		expect(textbox.value).toBe('x')

		host.dispatchEvent(
			new realm.document.defaultView!.KeyboardEvent('keydown', {
				key: 'Enter',
				bubbles: true,
			}),
		)
		expect(host.editing).toBe(false)
		expect(host.value).toBe('x')
	})
})
