/** Direct test for the dirty-flag hydration bug: `value`/`checked`/`selected` are dirty-flag attributes — between server render and client upgrade the live IDL property may already diverge from the content attribute, so a signal harvested from one must read the live property, not `getAttribute`. Pinned directly: no corpus example harvests a dirty-flag attribute via this path, so a regression here would be invisible in `client.golden.test.ts`. */
import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/frontend/tsrx'

const harvestFrom = (attr: string, signalInit = "createCell('')"): string => {
	const { component, diagnostics } = compileComponent(
		`import { createCell } from '@zeix/le-truc'
export function C({}: {})
	@{
		const ${attr === 'checked' ? 'checked' : 'value'} = ${signalInit}
		expose({ ${attr === 'checked' ? 'checked' : 'value'}: ${attr === 'checked' ? 'checked' : 'value'}.get })
			<c-el>
				<input ${attr}={() => ${attr === 'checked' ? 'checked' : 'value'}.get()} />
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
	expect(diagnostics).toEqual([])
	if (!component) throw new Error('expected component to compile')
	return component.clientCode
}

describe('dirty-flag attribute harvest reads the live property (CHECKLIST §6)', () => {
	test('value harvests from the live IDL property, not getAttribute', () => {
		const code = harvestFrom('value')
		expect(code).toContain('createCell(asString()(String(input.value)))')
		expect(code).not.toContain("getAttribute('value')")
	})

	test('checked harvests from the live IDL property, not getAttribute', () => {
		const code = harvestFrom('checked', 'createCell(false)')
		expect(code).toContain('input.checked')
		expect(code).not.toContain("getAttribute('checked')")
	})

	test('an ordinary (non-dirty-flag) attribute still harvests via getAttribute — the content attribute IS the source of truth there', () => {
		const { component, diagnostics } = compileComponent(
			`export function C({}: {})
	@{
		const title = createCell('')
		expose({ title: title.get })
			<c-el>
				<input title={() => title.get()} />
				<style>@scope {
	:scope {
		  color: red;
		}
}</style>
			</c-el>
	}
import { createCell } from '@zeix/le-truc'`,
			'c.tsrx',
			new Set(),
		)
		expect(diagnostics).toEqual([])
		expect(component?.clientCode).toContain("getAttribute('title')")
		expect(component?.clientCode).not.toContain('input.title')
	})
})
