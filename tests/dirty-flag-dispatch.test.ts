/** Dirty-flag attribute dispatch: `value`/`checked`/`selected` on native form controls lower reactive thunks to property writes (`bindProperty`), not attribute writes — the write direction of the divergence `dirty-flag-harvest.test.ts` covers on the read side. Once a control is dirty, removing the content attribute no longer clears the live IDL property, so a `bindAttribute` mirror silently stops tracking. Keyed on attr × native form-control tag in both dispatch paths; a string thunk over an ordinary attribute and a dirty-flag attr on a non-form-control keep the attribute dispatch. */
import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/frontend/tsrx'

const compiled = (source: string) =>
	compileComponent(source, 'c.tsrx', new Set(['c-el']))

describe('dirty-flag dispatch — loop bodies (@for → each())', () => {
	test('boolean comparison thunk over `checked` on a native input lowers to a property write', () => {
		const { component, diagnostics } =
			compiled(`import { asString } from '@zeix/le-truc'
export function C({ options }: { options: { value: string }[] })
@{
	expose({ value: asString('') })
		<c-el>
			@for (const option of options) {
				const optValue = option.value
				<label data-value={optValue}>
					<input
						type="radio"
						value={optValue}
						checked={() => host.value === optValue}
						onChange={() => ({ value: optValue })}
					/>
				</label>
			}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		const code = component?.clientCode ?? ''
		// The loop-body descendant target needs the precise element type for bindProperty's keyed setter to typecheck — querySelector is emitted with the tag's interface as its type argument.
		expect(code).toContain(
			"const input = option.querySelector<HTMLInputElement>('input')!",
		)
		expect(code).toContain(
			"watch(() => host.value === optValue, bindProperty(input, 'checked'))",
		)
		expect(code).not.toContain("bindAttribute(input, 'checked')")
	})

	test('string-valued thunk over an ordinary attribute keeps the attribute dispatch', () => {
		const { component, diagnostics } =
			compiled(`import { createCell } from '@zeix/le-truc'
export function C({ options }: { options: { value: string }[] })
@{
	const tip = createCell('hint')
	expose({})
		<c-el>
			@for (const option of options) {
				const optValue = option.value
				<label data-value={optValue}>
					<input type="radio" value={optValue} title={() => tip.get()} />
				</label>
			}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain(
			"watch(() => tip.get(), bindAttribute(input, 'title'))",
		)
		expect(code).not.toContain('bindProperty')
	})

	test('dirty-flag attr on the loop OUTPUT ROOT dispatches as a property too', () => {
		const { component, diagnostics } =
			compiled(`import { asString } from '@zeix/le-truc'
export function C({ options }: { options: { value: string }[] })
@{
	expose({ value: asString('') })
		<c-el>
			@for (const option of options) {
				const optValue = option.value
				<option value={optValue} selected={() => host.value === optValue}>{optValue}</option>
			}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain(
			"watch(() => host.value === optValue, bindProperty(option, 'selected'))",
		)
		expect(code).not.toContain("bindAttribute(option, 'selected')")
	})
})

describe('dirty-flag dispatch — top-level constructs', () => {
	test('boolean thunk over `checked` on a native input (not a bare host mirror) lowers to a property write', () => {
		const { component, diagnostics } =
			compiled(`import { createCell } from '@zeix/le-truc'
export function C({}: {})
@{
	const on = createCell(false)
	expose({})
		<c-el>
			<input type="checkbox" checked={() => on.get()} />
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain(
			"watch(() => on.get(), bindProperty(input, 'checked'))",
		)
		expect(code).not.toContain("bindAttribute(input, 'checked')")
	})

	test('non-mirror string thunk over `value` on a native input lowers to a property write (spinbutton shape)', () => {
		const { component, diagnostics } = compiled(`export function C({}: {})
@{
	expose({})
		<c-el>
			<input type="number" value={() => String(host.value)} />
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain(
			"watch(() => String(host.value), bindProperty(input, 'value'))",
		)
		expect(code).not.toContain("bindAttribute(input, 'value')")
	})

	test('dirty-flag attr on a NON-form-control element keeps the attribute dispatch', () => {
		const { component, diagnostics } = compiled(`export function C({}: {})
@{
	expose({})
		<c-el>
			<meter min="0" max="100" value={() => String(host.value)} />
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain(
			"watch(() => String(host.value), bindAttribute(meter, 'value'))",
		)
		expect(code).not.toContain("bindProperty(meter, 'value')")
	})

	test('number-valued thunk over `value` on a native input still stringifies for the property setter', () => {
		// `returnsNumber`: number literals and conditionals over them; the bare number-signal read is covered in the test below.
		const { component, diagnostics } = compiled(`export function C({}: {})
@{
	expose({})
		<c-el>
			<input type="number" value={() => (host.value === '' ? 1 : 2)} />
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		const code = component?.clientCode ?? ''
		expect(code).toContain(
			"watch(() => String((() => (host.value === '' ? 1 : 2))()), bindProperty(input, 'value'))",
		)
	})

	test('a bare number-SIGNAL read stringifies too (LT-126)', () => {
		// Without the signal's `inferredType`, `() => count.get()` reached `bindProperty`'s DOMString setter uncoerced. The inferred type settles it.
		const { component, diagnostics } =
			compiled(`import { createState } from '@zeix/le-truc'
export function C({}: {})
@{
	const count = createState(0)
	expose({})
		<c-el>
			<input type="number" value={() => count.get()} />
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		// IIFE-wrapped like the conditional case above — the coercion is what
		// this pins, not the wrapping.
		expect(component?.clientCode ?? '').toContain(
			"watch(() => String((() => count.get())()), bindProperty(input, 'value'))",
		)
	})

	test('a STRING signal read is left alone — the coercion is number-only', () => {
		const { component, diagnostics } =
			compiled(`import { createState } from '@zeix/le-truc'
export function C({}: {})
@{
	const label = createState('a')
	expose({})
		<c-el>
			<input type="text" value={() => label.get()} />
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`)
		expect(diagnostics).toEqual([])
		expect(component?.clientCode ?? '').toContain(
			"watch(() => label.get(), bindProperty(input, 'value'))",
		)
	})
})
