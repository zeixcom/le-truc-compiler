/** Server-render smoke gate: compiles the corpus the way the build does, calls every generated render function, and asserts only that it returns markup for its own tag without throwing — deliberately not a snapshot, so a new component joins coverage by existing. `ARGS` carries the components whose contract has genuinely required fields; everything else renders from `{}`, which also proves the defaults work. */
import { afterAll, describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { isVoidElement } from '../src/core'
import { resolveCorpusConfig } from '../src/corpus-config'
import { collectCorpusSources } from '../src/corpus-scan'
import { inlineI18n, MODULE_TODO_I18N } from './corpus-args'
import { compileCorpus } from './corpus-compile'
import type { FileInfo } from './file-signals'
import { createGeneratedDir } from './helpers/generated-corpus'

const ROOT = path.resolve(import.meta.dir, '..')

/** `form-spinbutton` → `renderFormSpinbutton`. */
const renderName = (tag: string): string =>
	`render${tag
		.split('-')
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')}`

/** Args for the components whose contract has genuinely required fields — and the reserved `i18n` records (an omitted record throws at the `i18n: { t }` destructure). Everything absent here renders from `{}` on purpose. */
const ARGS: Record<string, Record<string, unknown>> = {
	'form-spinbutton': {
		name: 'quantity',
		i18n: inlineI18n({ decrement: 'Decrement', increment: 'Increment' }),
	},
	'form-checkbox': { name: 'agree', label: 'I agree' },
	'form-radiogroup': {
		name: 'choice',
		children: 'Pick one',
		options: [
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B' },
		],
	},
	'form-textbox': {
		name: 'title',
		children: 'Title',
		i18n: inlineI18n({ clearInput: 'Clear input' }),
	},
	'form-combobox': {
		name: 'fruit',
		children: 'Fruit',
		options: [
			{ value: 'a', label: 'Apple' },
			{ value: 'b', label: 'Banana' },
		],
		i18n: inlineI18n({ clearInput: 'Clear input' }),
	},
	'form-tokenbox': {
		name: 'tags',
		children: 'Tags',
		i18n: inlineI18n({ remove: 'Remove' }),
	},
	'form-colorgraph': {
		i18n: inlineI18n({
			drag: 'Drag',
			lightness: 'Lightness',
			chroma: 'Chroma',
			hue: 'Hue',
		}),
	},
	'form-listbox': {
		name: 'fruit',
		options: [
			{ value: 'a', label: 'Apple' },
			{ value: 'b', label: 'Banana' },
		],
		i18n: inlineI18n({ filter: 'Filter', clearFilter: 'Clear filter' }),
	},
	'module-tabgroup': {
		tabs: [
			{ id: 'one', label: 'One', content: 'First' },
			{ id: 'two', label: 'Two', content: 'Second' },
		],
	},
	'card-blogpost': { title: 'Title', href: '#' },
	'card-callout': { title: 'Heads up' },
	'card-collapsible': { title: 'Details' },
	'basic-button': { label: 'Add' },
	'module-todo': { i18n: MODULE_TODO_I18N },
	'module-catalog': {
		products: [{ id: 'product-1', name: 'Product 1', max: 10 }],
	},
	'basic-blogmeta': {
		published: '2026-03-09',
		i18n: inlineI18n({
			avatarOf: 'Avatar of',
			updatedOn: 'updated on',
			minRead: 'min read',
			unknownDate: 'unknown date',
		}),
	},
	'module-carousel': { slides: [{ title: 'Slide 1' }] },
	'module-listnav': {
		options: [
			{ value: './test/module-listnav/mocks/page1.html', label: 'Page 1' },
		],
	},
}

// The CONFIGURED corpus scan — the same source set the build
// compiles, not a hand-rolled single-extension glob.
const corpus = async () => await collectCorpusSources(resolveCorpusConfig(ROOT))

// The REAL corpus runner writes every generated module; a per-run directory
// keeps that out of the build pipeline's own output. Render happens
// through `info.serverModulePath`, so the redirect is transparent.
const generated = createGeneratedDir('render-smoke')
afterAll(() => generated.cleanup())

const compiled = await compileCorpus(await corpus(), generated.path)

describe('server render smoke — every corpus tag renders (LT-121)', () => {
	test('the corpus compiled at all', () => {
		expect(compiled.length).toBeGreaterThan(0)
	})

	for (const info of compiled) {
		test(`${renderName(info.tag)}() does not throw`, async () => {
			const mod = (await import(info.serverModulePath)) as Record<
				string,
				unknown
			>
			const fn = mod[renderName(info.tag)]
			expect(typeof fn).toBe('function')
			const html = (fn as (args: unknown) => string)(ARGS[info.tag] ?? {})
			expect(typeof html).toBe('string')
			expect(html).toContain(`<${info.tag}`)
		})
	}
})

/** `InvalidTemplateError` gets no diagnostic and needs none: `emit-server.ts` shapes a `<template>` from a SINGLE element node, so exactly one root by construction — pinned here so teaching `@for` to emit a fragment fails before the runtime throw does. */
describe('@for templates have exactly one root element (LT-157c)', () => {
	/** Root-level element count of a `<template>`'s content. */
	const rootElementCount = (content: string): number => {
		let depth = 0
		let roots = 0
		const tagPattern = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g
		let match: RegExpExecArray | null = tagPattern.exec(content)
		while (match) {
			const [, slash, tag, rest] = match
			const selfClosing = (rest ?? '').trimEnd().endsWith('/')
			if (slash === '/') depth--
			else {
				if (depth === 0) roots++
				if (!selfClosing && !isVoidElement(tag as string)) depth++
			}
			match = tagPattern.exec(content)
		}
		return roots
	}

	test('the counter agrees with the runtime check it stands in for', () => {
		expect(rootElementCount('<li><span>x</span></li>')).toBe(1)
		expect(rootElementCount('<li>a</li><li>b</li>')).toBe(2)
		expect(rootElementCount('text only')).toBe(0)
		expect(rootElementCount('<li><input name="x"><br>y</li>')).toBe(1)
	})

	for (const info of compiled) {
		test(`${info.tag}'s emitted templates each have one root`, async () => {
			const mod = (await import(info.serverModulePath)) as Record<
				string,
				unknown
			>
			const fn = mod[renderName(info.tag)] as (args: unknown) => string
			const html = fn(ARGS[info.tag] ?? {})
			const templates = [
				...html.matchAll(/<template>([\s\S]*?)<\/template>/g),
			].map(m => m[1] ?? '')
			for (const content of templates) expect(rootElementCount(content)).toBe(1)
		})
	}
})
