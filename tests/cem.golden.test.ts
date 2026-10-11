/** CEM equivalence: entries the plugin extracts from generated clients must equal those extracted from the hand-written components, compared against pinned hand-written-derived expectations. basic-counter and module-tabgroup are byte-equal; form-textbox is a deliberate subset of the hand-written component but exercises Parser-exposed attributes from a generated `expose()` call. */
import { afterAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { compileComponent } from '../src/frontend/tsrx'
import { createGeneratedDir } from './helpers/generated-corpus'

const ROOT = path.resolve(import.meta.dir, '..')
const generated = createGeneratedDir('cem-golden')
afterAll(() => generated.cleanup())
const read = (rel: string): string =>
	fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel), 'utf8')

const registry = new Set<string>([
	'basic-counter',
	'module-tabgroup',
	'form-textbox',
	'form-checkbox',
])
// Every tag asserted below must be listed here, or its declaration may come from a stale client left in a shared output directory.
const SOURCES = [
	'examples/basic/counter/basic-counter.tsrx',
	'examples/module/tabgroup/module-tabgroup.tsrx',
	'examples/form/textbox/form-textbox.tsrx',
	'examples/form/checkbox/form-checkbox.tsrx',
] as const

/** The shadow config: analyzer + plugin over ONLY this run's generated clients. */
const SHADOW_CONFIG = `import { resolve } from 'node:path'
import { leTrucPlugin } from '@zeix/cem-plugin-le-truc'

let typeChecker

export default {
	globs: ['${generated.relativePath}/*.client.ts'],
	exclude: [],
	outdir: '${generated.relativePath}',
	// The analyzer defaults packagejson: true and would rewrite the ROOT
	// package.json "customElements" field to this shadow outdir — never
	// enable it for a shadow manifest.
	packagejson: false,
	plugins: [leTrucPlugin(() => typeChecker)],
	overrideModuleCreation({ ts, globs }) {
		const program = ts.createProgram(globs, {
			target: ts.ScriptTarget.ESNext,
			lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
		})
		typeChecker = program.getTypeChecker()
		// Resolved-path comparison — root files nothing imports keep relative
		// names in getSourceFiles() (see the main config's comment).
		const requested = new Set(globs.map(g => resolve(g)))
		return program.getSourceFiles().filter(sf => requested.has(resolve(sf.fileName)))
	},
}
`

type CemDeclaration = Record<string, unknown> & { tagName: string }

const declarationsByTag = async (): Promise<Map<string, CemDeclaration>> => {
	for (const rel of SOURCES) {
		const { component, diagnostics } = compileComponent(
			read(rel),
			rel,
			registry,
		)
		for (const d of diagnostics) console.warn(`[${d.code}] ${d.message}`)
		if (!component) throw new Error(`${rel} did not compile`)
		generated.emit(component.entry.clientModule, component.clientCode)
	}
	generated.emit('cem.config.mjs', SHADOW_CONFIG)

	const proc = Bun.spawn(
		[
			'bunx',
			'cem',
			'analyze',
			'--config',
			`${generated.relativePath}/cem.config.mjs`,
			'--quiet',
		],
		{ stdout: 'pipe', stderr: 'pipe', cwd: ROOT },
	)
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	if (exitCode !== 0) throw new Error(`cem analyze failed: ${stdout}${stderr}`)

	const manifest = JSON.parse(
		fs.readFileSync(path.join(generated.path, 'custom-elements.json'), 'utf8'),
	) as { modules?: Array<{ declarations?: CemDeclaration[] }> }
	const byTag = new Map<string, CemDeclaration>()
	for (const module of manifest.modules ?? [])
		for (const decl of module.declarations ?? [])
			if (decl.customElement) byTag.set(decl.tagName, decl)
	return byTag
}

describe('CEM golden — generated clients extract like hand-written components', () => {
	test('basic-counter declaration is byte-equal to the hand-written entry', async () => {
		const counter = (await declarationsByTag()).get('basic-counter')
		expect(counter).toEqual({
			kind: 'class',
			customElement: true,
			tagName: 'basic-counter',
			name: 'BasicCounter',
			description:
				'A simple click counter that increments on each button press.\n' +
				'Use it for demonstrating reactive property updates — the count\n' +
				'increments when the button is activated via mouse or keyboard.\n' +
				'The host element should contain a `<button>` and a `<span>`; the button must\n' +
				'be a real `<button>` element for keyboard activation to work.',
			members: [
				{
					kind: 'field',
					name: 'count',
					type: { text: 'number' },
					description:
						'Current counter value. Increments on each button click.',
				},
			],
			demos: [
				{
					url: 'https://zeixcom.github.io/le-truc/examples.html#basic-counter',
					description: 'Interactive preview and usage examples',
				},
			],
		})
	}, 90000)

	test('module-tabgroup declaration is byte-equal to the hand-written entry', async () => {
		const tabgroup = (await declarationsByTag()).get('module-tabgroup')
		expect(tabgroup).toEqual({
			kind: 'class',
			customElement: true,
			tagName: 'module-tabgroup',
			name: 'ModuleTabgroup',
			description:
				'An accessible tab group with keyboard navigation (Arrow, Home, End keys) and reactive panel switching.\n' +
				'Use it for tabbed interfaces — provides ARIA tab/tabpanel semantics, focus management\n' +
				'with roving tabindex, and keyboard accessibility per the WAI-ARIA tabs pattern.',
			members: [
				{
					kind: 'field',
					name: 'selected',
					type: { text: 'string' },
					description:
						'The `aria-controls` value of the currently selected tab (read-only).',
				},
			],
			demos: [
				{
					url: 'https://zeixcom.github.io/le-truc/examples.html#module-tabgroup',
					description: 'Interactive preview and usage examples',
				},
			],
		})
	}, 90000)

	test('form-textbox: hand-written entries plus the Parser-exposed attribute', async () => {
		const textbox = (await declarationsByTag()).get('form-textbox')
		if (!textbox) throw new Error('form-textbox declaration missing')
		expect(textbox.description).toBe(
			'A single-line or multiline text input with validation, optional clear button, and helper text.\n' +
				'Use it when you need a styled text field — the underlying native input provides\n' +
				'keyboard accessibility and standard ARIA textbox semantics. Form participation\n' +
				'and validity are via ElementInternals (`formAssociated()`).\n' +
				'External consumers read `host.validationMessage` / `host.validity` like on a\n' +
				'native input; inline error display binds directly to `host.validationMessage`.\n' +
				'Sets the `:has(.clear)` style hook when a `button.clear` descendant is\n' +
				'present, so CSS can reserve space for it — derived from markup, not an\n' +
				"author-set attribute or custom state, so it can't drift out of sync.\n" +
				'\n' +
				'The inner control is deliberately unnamed — `name` belongs to the host,\n' +
				'which submits via `setFormValue`. A named inner control would submit the\n' +
				'field twice.',
		)
		expect(textbox.demos).toEqual([
			{
				url: 'https://zeixcom.github.io/le-truc/examples.html#form-textbox',
				description: 'Interactive preview and usage examples',
			},
		])
		// `description` isn't wired through expose() (authored render-time content, not a live DOM-derived prop) but is still a real member of FormTextboxProps, so extraction picks it up.
		expect(
			(textbox.members as Array<{ kind: string; name: string }>).map(
				m => m.name,
			),
		).toEqual([
			'value',
			'length',
			'description',
			'clear',
			'focusControl',
			'form',
			'name',
			'disabled',
			'labels',
			'validity',
			'validationMessage',
			'willValidate',
			'checkValidity',
			'reportValidity',
			'setCustomValidity',
		])
		// Parser-exposed `value` leads the attributes (expose() scan precedes extension members); its default is the plugin's literal rendering of asString('').
		expect(textbox.attributes).toEqual([
			{
				name: 'value',
				fieldName: 'value',
				type: { text: 'string' },
				default: '""',
			},
			{ name: 'name', fieldName: 'name', type: { text: 'string' } },
			{ name: 'disabled', fieldName: 'disabled', type: { text: 'boolean' } },
		])
	}, 90000)

	test('form-checkbox: formAssociatedCheckbox extension + Parser-exposed attribute', async () => {
		const checkbox = (await declarationsByTag()).get('form-checkbox')
		if (!checkbox) throw new Error('form-checkbox declaration missing')
		expect(
			(checkbox.members as Array<{ kind: string; name: string }>).map(
				m => m.name,
			),
		).toEqual([
			'checked',
			'label',
			'form',
			'name',
			'disabled',
			'labels',
			'validity',
			'validationMessage',
			'willValidate',
			'checkValidity',
			'reportValidity',
			'setCustomValidity',
		])
		expect(checkbox.attributes).toEqual([
			{
				name: 'checked',
				fieldName: 'checked',
				type: { text: 'boolean' },
				default: 'false',
			},
			{ name: 'name', fieldName: 'name', type: { text: 'string' } },
			{ name: 'disabled', fieldName: 'disabled', type: { text: 'boolean' } },
		])
	}, 90000)
})
