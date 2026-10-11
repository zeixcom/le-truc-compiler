/** Harvest sites on the component ROOT: `first()` searches descendants only, so a self-query for the root's own tag would throw `MissingElementError` at activation — root-site harvests route through the ambient `host`, and an exposed Parser prop arg seeds `deriveCell` through the prop's tracked Slot instead of an untracked `getAttribute` read that would freeze post-connect updates. */
import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/frontend/tsrx'

const compile = (setup: string, params: string, rootAttrs: string) =>
	compileComponent(
		`import { asNumber, createCell, deriveCell } from '@zeix/le-truc'

export function C(${params})
@{
${setup}
		<c-el ${rootAttrs}>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
		'c.tsrx',
		new Set(),
	)

describe('root-attribute arg harvest reads the ambient host, never a self-query (paramDomRead)', () => {
	test('a deriveCell over a root-rendered arg reads host.getAttribute — no first("<own-tag>")', () => {
		const { component, diagnostics } = compile(
			`	const label = deriveCell(() => String(lang).toUpperCase())
	expose({})`,
			'{ lang = "en" }: { lang?: string }',
			'lang={lang}',
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		expect(component).not.toBeNull()
		expect(component?.clientCode).toContain(
			"String((host.getAttribute('lang') ?? '')).toUpperCase()",
		)
		// The illegal self-query is gone — no query for the component's own tag.
		expect(component?.clientCode).not.toContain("first('c-el'")
		// `host` must be destructured from the factory context for that read.
		expect(component?.clientCode).toMatch(/\(\{[^}]*\bhost\b[^}]*}\) =>/)
	})

	test('an arg rendered on a NESTED element still queries that element (unchanged route)', () => {
		const { component, diagnostics } = compileComponent(
			`import { deriveCell } from '@zeix/le-truc'
export function C({ max = '10' }: { max?: string })
@{
	const label = deriveCell(() => Number(max) * 2)
	expose({})
		<c-el>
			<meter max={max}></meter>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
			new Set(),
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		// The nested site wins over the root's own rendering of the arg — the
		// element query is legitimate (descendant scope) and stays.
		expect(component?.clientCode).toContain(
			"Number((meter.getAttribute('max') ?? '')) * 2",
		)
		expect(component?.clientCode).toContain("first('meter'")
		expect(component?.clientCode).not.toContain("first('c-el'")
	})
})

describe('an exposed Parser prop arg seeds derived signals through the prop Slot (LT-115 freeze fix)', () => {
	test('a deriveCell over an exposed prop arg reads host.<prop> — a tracked reactive source', () => {
		const { component, diagnostics } = compile(
			`	const qualification = deriveCell(() => ({ doubled: Number(value) * 2 }))
	expose({ value: asNumber() })`,
			'{ value = 0 }: { value?: number }',
			'value={value}',
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		expect(component).not.toBeNull()
		// The arg read is routed through the exposed prop's Slot, not the
		// (untracked) content attribute — post-connect property writes and
		// observedAttributes re-parses re-derive the signal.
		expect(component?.clientCode).toContain('Number(host.value) * 2')
		expect(component?.clientCode).not.toContain("getAttribute('value')")
		expect(component?.clientCode).not.toContain("first('c-el'")
	})

	test('an EAGER createCell over the same arg still reads the DOM — it runs before expose() installs the prop', () => {
		const { component, diagnostics } = compile(
			`	const seed = createCell(String(value))
	expose({ value: asNumber() })`,
			'{ value = 0 }: { value?: number }',
			'value={value}',
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		// Eager initializers execute at declaration, BEFORE expose() installs
		// the Slot-backed property — a host.<prop> read there would be
		// undefined. The DOM (attribute) read is the only sound seed — and,
		// for a `number` arg, converted back with `Number()`.
		expect(component?.clientCode).toContain(
			"createCell(String(Number(host.getAttribute('value') ?? '')))",
		)
		expect(component?.clientCode).not.toContain('String(host.value)')
	})
})

describe('a signal-identifier lazy root child harvests via the ambient host (Pass 3 direct text-site)', () => {
	test('the text harvest reads host.textContent — no first("<own-tag>") self-query', () => {
		const { component, diagnostics } = compileComponent(
			`import { createCell } from '@zeix/le-truc'
export function C({}: {})
@{
	const greeting = createCell('Hello')
	expose({})
		<c-el>{greeting}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
			new Set(),
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		expect(component).not.toBeNull()
		// The root branch plans the watch against the ambient
		// host; the harvest agrees with it instead of throwing at activation.
		expect(component?.clientCode).toContain('watch(greeting, bindText(host))')
		expect(component?.clientCode).toContain('asString()(host.textContent)')
		expect(component?.clientCode).not.toContain("first('c-el'")
	})
})
