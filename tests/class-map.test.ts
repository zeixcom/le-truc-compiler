/** `class={() => ({ … })}` object-literal class thunks: server-side initial render and client-side lowering to one `watch(thunk, bindClass(el, keys))` call against `bindClass()`'s map-form overload — including the component-root case (targeting `host`), which the custom-element reactive-attribute gate otherwise rejects. Mirrors `style-map.test.ts`. */
import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/frontend/tsrx'
import { compileComponentTsx } from '../src/frontend/tsx'

describe('class-map on a descendant native element', () => {
	const source = `export function C({}: {})
	@{
		const open = createCell(true)
		expose({})
			<c-el>
				<p>{open}</p>
				<span class={() => ({ open: open.get(), disabled: false })}>ok</span>
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`

	test('compiles without diagnostics', () => {
		const { component, diagnostics } = compileComponent(
			source,
			'c.tsrx',
			new Set(),
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		expect(component).not.toBeNull()
	})

	test('client lowers to one watch(...bindClass(el, [keys])) call', () => {
		const { component } = compileComponent(source, 'c.tsrx', new Set())
		expect(component?.clientCode).toContain(
			"bindClass(span, ['open', 'disabled'])",
		)
		expect(component?.clientCode).toContain('bindClass')
	})

	test('server renders the initial class attribute from the map', () => {
		const { component } = compileComponent(source, 'c.tsrx', new Set())
		expect(component?.serverCode).toContain('cls(')
	})
})

describe('class-map on the component root (targets host)', () => {
	const source = `export function C({}: {})
	@{
		const open = createCell(true)
		expose({})
			<c-el class={() => ({ open: open.get(), disabled: false })}>
				<p>{open}</p>
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`

	test('compiles without the "Reactive constructs on the component root element" diagnostic', () => {
		const { diagnostics } = compileComponent(source, 'c.tsrx', new Set())
		expect(
			diagnostics.some(d =>
				d.message.includes('Reactive constructs on the component root element'),
			),
		).toBe(false)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
	})

	test('client targets the ambient host, not a query', () => {
		const { component } = compileComponent(source, 'c.tsrx', new Set())
		expect(component?.clientCode).toContain(
			"bindClass(host, ['open', 'disabled'])",
		)
	})

	test('server renders the initial class attribute on the root opening tag', () => {
		const { component } = compileComponent(source, 'c.tsrx', new Set())
		expect(component?.serverCode).toContain("attr('class', cls(")
	})
})

describe('class-map on a descendant custom element bypasses the reactive-attribute gate', () => {
	const source = `export function C({}: {})
	@{
		const open = createCell(true)
		expose({})
			<c-el>
				<p>{open}</p>
				<sub-el class={() => ({ open: open.get() })}>ok</sub-el>
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`

	test('compiles without a reactiveAttrOnCustomElement diagnostic', () => {
		const { diagnostics, component } = compileComponent(
			source,
			'c.tsrx',
			new Set(),
		)
		expect(diagnostics.some(d => d.code === 'LTC005')).toBe(false)
		expect(component).not.toBeNull()
	})

	test('client lowers via bindClass, not pass()', () => {
		const { component } = compileComponent(source, 'c.tsrx', new Set())
		expect(component?.clientCode).toContain("bindClass(subEl, ['open'])")
	})
})

describe('signal used only inside the class-map thunk', () => {
	const descendant = `export function C({}: {})
@{
	const on = createCell(true)
	expose({})
		<c-el>
			<span class={() => ({ active: on.get() })}>ok</span>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}
import { createCell } from '@zeix/le-truc'`
	const root = `export function C({}: {})
@{
	const on = createCell(true)
	expose({})
		<c-el class={() => ({ active: on.get() })}>
			<span>ok</span>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}
import { createCell } from '@zeix/le-truc'`

	test('descendant case: no LTC004, client seeds by initializer reuse', () => {
		const { component } = compileComponent(descendant, 'c.tsrx', new Set())
		expect(component).not.toBeNull()
		expect(component?.clientCode).toContain('createCell(true)')
		expect(component?.serverCode).toContain('createCell(true)')
		expect(component?.clientCode).toContain(
			"watch(() => ({ active: on.get() }), bindClass(span, ['active']))",
		)
	})

	test('root case (targets host): no LTC004 either', () => {
		const { component } = compileComponent(root, 'c.tsrx', new Set())
		expect(component?.clientCode).toContain("bindClass(host, ['active'])")
	})
})

describe('quoted class keys (LT-221 §1.3)', () => {
	// Two pinned defects: extraction silently dropped quoted keys from the key list (`bindClass(el, [])` — server renders the class, the client can never toggle it, no diagnostic), and emission interpolated the key into a member access (`((thunk)()).${key}`), which for a hyphenated key parses as subtraction. Dot-safe keys keep member access; everything else goes through bracket access.

	test('a quoted key in a top-level class map reaches the client binding', () => {
		const source = `export function C({}: {})
	@{
		const open = createCell(true)
		expose({})
			<c-el>
				<p>{open}</p>
				<span class={() => ({ 'has-error': open.get() })}>ok</span>
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`
		const { component, diagnostics } = compileComponent(
			source,
			'c.tsrx',
			new Set(),
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain("bindClass(span, ['has-error'])")
		expect(code).not.toContain('bindClass(span, [])')
	})

	test('a quoted key in a server-data loop body class map emits bracket access', () => {
		const source = `export function C({ tabs }: { tabs: { id: string }[] })
	@{
		const open = createCell(false)
		expose({})
			<c-el>
				<ul>
					@for (const tab of tabs) {
						<li class={() => ({ 'is-active': open.get() })}>{tab.id}</li>
					}
				</ul>
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`
		const { component, diagnostics } = compileComponent(
			source,
			'c.tsrx',
			new Set(),
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain("['is-active']")
		expect(code).not.toContain('.is-active')
	})
})

describe('the class:-prefix spelling is rejected (LT-222)', () => {
	// `class:token={…}` is silently wrong in both spellings: the call form renders a literal attribute the browser ignores, and the thunk form emits a watch reading `.token` off the thunk's result — a class that can never apply. Hence LTC006.

	test('a reactive class:-prefix attr is rejected on .tsrx', () => {
		const source = `export function C({}: {})
	@{
		const open = createCell(true)
		expose({})
			<c-el>
				<span class:has-error={() => open.get()}>ok</span>
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`
		const { component, diagnostics } = compileComponent(
			source,
			'c.tsrx',
			new Set(),
		)
		const errors = diagnostics.filter(d => d.code === 'LTC006')
		expect(errors).toHaveLength(1)
		expect(errors[0]?.message).toContain('class={() => ({')
		expect(component?.clientCode ?? '').not.toContain('has-error')
	})

	test('a server class:-prefix attr is rejected too (the call form)', () => {
		const source = `export function C({}: {})
	@{
		const open = createCell(true)
		expose({})
			<c-el>
				<span class:has-error={open.get()}>ok</span>
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`
		const { diagnostics } = compileComponent(source, 'c.tsrx', new Set())
		const errors = diagnostics.filter(d => d.code === 'LTC006')
		expect(errors).toHaveLength(1)
		expect(errors[0]?.message).toContain('class={() => ({')
	})

	test('the same rejection fires on .tsx', () => {
		const source = `export function C({}: {}) {
	const open = createCell(true)
	expose({})
	return (
			<c-el>
				<span class:has-error={() => open.get()}>ok</span>
				<style>c-el {'{ color: red }'}</style>
			</c-el>
	)
}
import { createCell } from '@zeix/le-truc'`
		const { component, diagnostics } = compileComponentTsx(
			source,
			'c.tsx',
			new Set(),
		)
		const errors = diagnostics.filter(d => d.code === 'LTC006')
		expect(errors).toHaveLength(1)
		expect(component?.clientCode ?? '').not.toContain('has-error')
	})
})
