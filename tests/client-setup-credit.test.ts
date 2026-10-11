/** A signal read by a client-only setup statement is credited as rendered: such a statement reaches the DOM without a template render site — the only route open to a predicate over a composed child's public prop, since as a reactive attribute it cannot be server-folded (LTC034). The credit seeds by initializer reuse, sound by construction: `clientSetup` exists only in the generated client. */
import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/frontend/tsrx'
import { compileComponentTsx } from '../src/frontend/tsx'

const compile = (source: string) =>
	compileComponent(source, 'c.tsrx', new Set())

describe('client-only setup statements credit a signal as rendered', () => {
	const source = `export function C({}: {})
@{
	const open = createState(false)
	const panel = first('.panel', 'the panel')
	expose({})
	watch(() => !open.get(), bindAttribute(panel, 'hidden'))
		<c-el>
			<div class="panel" hidden>ok</div>
			<style>@scope {
	:scope {
		  display: block;
		}
}</style>
		</c-el>
}
import { bindAttribute, createState } from '@zeix/le-truc'`

	test('no error — the signal is consumed, not dead', () => {
		const { component, diagnostics } = compile(source)
		expect(diagnostics).toEqual([])
		expect(component).not.toBeNull()
	})

	test('the signal seeds from its initializer, not from a DOM site', () => {
		const { component } = compile(source)
		expect(component?.clientCode).toContain('createState(false)')
	})

	test('the binding is client-only — the server never runs it', () => {
		const { component } = compile(source)
		expect(component?.serverCode).not.toContain('bindAttribute')
	})

	test('the credit follows a const (LT-323)', () => {
		// `open.get()` sits one level of indirection away inside `isOpen`; the credit follows it because every consumer is still client-only.
		const { component } = compile(
			source.replace(
				"\twatch(() => !open.get(), bindAttribute(panel, 'hidden'))",
				"\tconst isOpen = () => open.get()\n\twatch(() => !isOpen(), bindAttribute(panel, 'hidden'))",
			),
		)
		expect(component?.entry.routingSignals).toEqual([])
		expect(component?.entry.tier).toBe('folded')
		expect(component?.clientCode).toContain('createState(false)')
	})

	test('a bare signal reference is a read (LT-323)', () => {
		// module-scrollarea's `watch(overflowStart, bindState(…))` shape.
		const { component } = compile(
			source.replace(
				"\twatch(() => !open.get(), bindAttribute(panel, 'hidden'))",
				"\twatch(open, bindAttribute(panel, 'hidden'))",
			),
		)
		expect(component?.entry.routingSignals).toEqual([])
		expect(component?.entry.tier).toBe('folded')
	})

	test('an event handler is a client-only read position (LT-323)', () => {
		const { component } = compile(`export function C({}: {})
@{
	const count = createState(0)
	expose({})
		<c-el>
			<button type="button" onClick={() => console.log(count.get())}>log</button>
			<style>@scope {
	:scope {
		  display: block;
		}
}</style>
		</c-el>
}
import { createState } from '@zeix/le-truc'`)
		expect(component?.entry.routingSignals).toEqual([])
		expect(component?.entry.tier).toBe('folded')
	})

	test('a render position through a carrier blocks the context-member seed (LT-327)', () => {
		// `count` reaches the template only through `label`, so the direct `sig.get()` scan misses it. Its initializer reads `all()`, which the server cannot evaluate — folding it would emit `all` undeclared in the server module.
		const { component } = compile(`export function C({}: {})
@{
	const count = createMemo(() => all('li').get().length)
	const label = () => String(count.get())
	const out = first('output', 'the log')
	expose({})
	watch(label, bindText(out))
		<c-el>
			<ul><li>a</li></ul>
			<output></output>
			<p>{() => label()}</p>
			<style>@scope {
	:scope {
		  display: block;
		}
}</style>
		</c-el>
}
import { bindText, createMemo } from '@zeix/le-truc'`)
		expect(
			component?.entry.routingSignals.some(s => s.origin === 'LTC004'),
		).toBe(true)
		expect(component?.entry.tier).toBe('simulated')
	})

	test('a @case test is a render position (LT-330)', () => {
		// The case test `label()` reaches `count` through a carrier, but in a switch arm rather than an `@if` test.
		const { component } = compile(`export function C({ mode }: { mode: string })
@{
	const count = createMemo(() => all('li').get().length)
	const label = () => String(count.get())
	const out = first('output', 'the log')
	expose({})
	watch(label, bindText(out))
		<c-el>
			<ul><li>a</li></ul>
			<output></output>
			@switch (mode) {
				@case label(): {
					<p>one</p>
				}
				@default: {
					<p>other</p>
				}
			}
			<style>@scope {
	:scope {
		  display: block;
		}
}</style>
		</c-el>
}
import { bindText, createMemo } from '@zeix/le-truc'`)
		expect(
			component?.entry.routingSignals.some(s => s.origin === 'LTC004'),
		).toBe(true)
		expect(component?.entry.tier).toBe('simulated')
	})

	test('a switch case test is a render position on .tsx (LT-330)', () => {
		const { component } = compileComponentTsx(
			`export function C({ mode }: { mode: string }) {
	const count = createMemo(() => all('li').get().length)
	const label = () => String(count.get())
	const out = first('output', 'the log')
	expose({})
	watch(label, bindText(out))
	return (
			<c-el>
				<ul><li>a</li></ul>
				<output></output>
				{(() => {
					switch (mode) {
						case label():
							return <p>one</p>
						default:
							return <p>other</p>
					}
				})()}
				<style></style>
			</c-el>
	)
}
import { bindText, createMemo } from '@zeix/le-truc'`,
			'c.tsx',
			new Set(),
		)
		expect(
			component?.entry.routingSignals.some(s => s.origin === 'LTC004'),
		).toBe(true)
		expect(component?.entry.tier).toBe('simulated')
	})

	test('a signal nothing reads still routes (LTC004)', () => {
		const { component } = compile(
			source.replace(
				"\twatch(() => !open.get(), bindAttribute(panel, 'hidden'))",
				'',
			),
		)
		expect(
			component?.entry.routingSignals.some(s => s.origin === 'LTC004'),
		).toBe(true)
	})
})
