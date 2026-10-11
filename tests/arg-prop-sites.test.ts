/** Arg-and-prop coincidence: an expression naming both a server arg and an `expose()`d prop of that name is reactive by position — server emission untouched, client gets the effect the `host.<name>` spelling would have produced. */
import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/frontend/tsrx'

const compile = (
	setup: string,
	template: string,
	params = '{ label }: { label: string }',
) =>
	compileComponent(
		`export function C(${params})
@{
	const el = first('span', 'span')
	${setup}
		<c-el>${template}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
		'c.tsrx',
		new Set(['c-el']),
	)

describe('text sites (LT-122)', () => {
	test('an arg that is also an exposed prop renders server-side AND binds client-side', () => {
		const { component, diagnostics } = compile(
			`expose({ label: el.textContent ?? '' })`,
			`<span>{label}</span>`,
		)
		expect(diagnostics).toEqual([])
		expect(component?.serverCode).toContain('text(label)')
		expect(component?.clientCode).toContain(
			'watch(() => host.label, bindText(el))',
		)
	})

	test('an arg that is NOT an exposed prop stays render-only', () => {
		const { component, diagnostics } = compile(
			`expose({ other: el.textContent ?? '' })`,
			`<span>{label}</span>`,
		)
		expect(diagnostics).toEqual([])
		expect(component?.serverCode).toContain('text(label)')
		expect(component?.clientCode).not.toContain('watch(')
	})

	test('an exposed prop that is NOT an arg stays render-only', () => {
		const { component, diagnostics } = compile(
			`const other = 'x'
	expose({ other: el.textContent ?? '' })`,
			`<span>{other}</span>`,
		)
		expect(diagnostics).toEqual([])
		expect(component?.clientCode).not.toContain('watch(() => host.other')
	})

	test('a site inside a single-branch @if binds under the existing presence guard', () => {
		const { component, diagnostics } = compile(
			`expose({ label: el.textContent ?? '', badge: '' })`,
			`<span>{label}</span>@if (badge) { <b class="badge">{badge}</b> }`,
			`{ label, badge = '' }: { label: string; badge?: string }`,
		)
		expect(diagnostics).toEqual([])
		const client = component?.clientCode ?? ''
		// The optional branch keeps its non-throwing query and guard; this rule only supplies the source.
		expect(client).toMatch(/const \w+ = first\('b'\)\n/)
		expect(client).toContain('watch(() => host.badge, bindText(')
		expect(component?.serverCode).toContain('text(badge)')
	})
})

describe('attribute sites (LT-122)', () => {
	test('a bare-arg attribute renders server-side AND binds as a property', () => {
		const { component, diagnostics } = compile(
			`expose({ disabled: el.hidden })`,
			`<button type="button" disabled={disabled}>x</button><span>y</span>`,
			`{ disabled = false }: { disabled?: boolean }`,
		)
		expect(diagnostics).toEqual([])
		expect(component?.serverCode).toContain("attr('disabled', disabled)")
		// `disabled` on a <button> is not a dirty-flag control attribute, so `bindAttribute`'s boolean path (toggleAttribute) is the right write.
		expect(component?.clientCode).toContain("bindAttribute(button, 'disabled')")
		expect(component?.clientCode).toContain('watch(() => host.disabled,')
	})

	test('the same attribute on a custom element is still rejected', () => {
		const { diagnostics } = compile(
			`expose({ disabled: el.hidden })`,
			`<other-el disabled={disabled}></other-el><span>y</span>`,
			`{ disabled = false }: { disabled?: boolean }`,
		)
		expect(diagnostics.some(d => d.code === 'LTC012')).toBe(true)
	})
})

describe('LTC039 — one value, two channels (LT-122)', () => {
	test('a Parser-exposed prop also rendered from its own arg warns', () => {
		const { diagnostics } = compileComponent(
			`import { asString } from '@zeix/le-truc'
export function C({ label }: { label: string })
@{
	expose({ label: asString('') })
		<c-el><span>{label}</span>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
			new Set(['c-el']),
		)
		const hit = diagnostics.find(d => d.code === 'LTC039')
		expect(hit).toBeDefined()
		expect(hit?.severity).toBe('warning')
		expect(hit?.message).toContain('asString')
		expect(hit?.message).toContain('ships twice')
	})

	test('harvesting the same prop from the site instead is clean', () => {
		const { diagnostics } = compile(
			`expose({ label: el.textContent ?? '' })`,
			`<span>{label}</span>`,
		)
		expect(diagnostics.some(d => d.code === 'LTC039')).toBe(false)
	})
})

/** Server half of the same coincidence: `hostDerivedFold` lets a thunk reading only `host.<prop>` members render an initial value server-side. A harvested prop's server truth is the arg that renders its site — without the fold, its thunks drop out of the initial HTML (LTC034), the pre-JS flash the fold exists to prevent. */
describe('host-derived folds over a harvested prop (LT-118)', () => {
	const compileZero = (exposeText: string, extraParams = '') =>
		compileComponent(
			`export function C({ zero = '' }: { zero?: string${extraParams} })
@{
	const zeroSpan = first('span.zero')
	expose({ ${exposeText} })
		<c-el>
			<span class="zero">{zero}</span>
			<b hidden={() => Boolean(host.zero)}>x</b>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
			new Set(['c-el']),
		)

	test('a thunk over a harvested prop folds to the arg server-side', () => {
		const { component, diagnostics } = compileZero(
			`zero: zeroSpan?.textContent ?? ''`,
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		// The fold splices `host.zero` for the arg that renders its site.
		expect(component?.serverCode).toContain('(() => Boolean((zero)))()')
	})

	test('no LTC034 — the initial `hidden` is server-renderable', () => {
		const { diagnostics } = compileZero(`zero: zeroSpan?.textContent ?? ''`)
		expect(diagnostics.some(d => d.code === 'LTC034')).toBe(false)
	})

	test('the client still binds the thunk', () => {
		const { component } = compileZero(`zero: zeroSpan?.textContent ?? ''`)
		expect(component?.clientCode).toContain('() => Boolean(host.zero)')
	})

	test('a prop that is NOT arg-rendered routes instead of warning (LT-165 step 5)', () => {
		// `other` is exposed as a signal getter but no site renders it from a same-named arg and no plain-value initializer states it, so the server has no truth to splice — omission, not a guess (a plain-value initializer would state it, which is why `other: ''` folds). The omission is a routing signal, not a diagnostic.
		const { component, diagnostics } = compileComponent(
			`import { createCell } from '@zeix/le-truc'
export function C({ zero = '' }: { zero?: string })
@{
	const zeroSpan = first('span.zero')
	const otherCell = createCell(false)
	expose({ zero: zeroSpan?.textContent ?? '', other: otherCell.get })
		<c-el>
			<span class="zero">{zero}</span>
			<b hidden={() => Boolean(host.other)}>x</b>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
			new Set(['c-el']),
		)
		expect(diagnostics.some(d => d.code === 'LTC034')).toBe(false)
		const hit = component?.entry.routingSignals.find(s => s.origin === 'LTC034')
		expect(hit?.detail).toContain('`hidden`')
		expect(component?.entry.tier).toBe('simulated')
		expect(component?.serverCode).not.toContain('Boolean(other)')
	})
})

/** Ref-presence folds: a ref name is not server-known, so a presence thunk fell out of the initial HTML (LTC034). But the server decides the answer — it renders `.zero` exactly when the `@if (zero)` it sits in is taken, so the ref's presence folds to that branch's own condition. */
describe('ref-presence folds (LT-118)', () => {
	const compileGate = (template: string, gate: string) =>
		compileComponent(
			`export function C({ zero = '' }: { zero?: string })
@{
	const zeroSpan = first('span.zero')
	expose({ value: asNumber(0) })
		<c-el>
			<b hidden={${gate}}>x</b>
			${template}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}
import { asNumber } from '@zeix/le-truc'`,
			'c.tsrx',
			new Set(['c-el']),
		)

	test('a ref inside a single-branch @if folds to that branch condition', () => {
		const { component, diagnostics } = compileGate(
			`@if (zero) { <span class="zero">{zero}</span> }`,
			`() => Boolean(zeroSpan)`,
		)
		expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
		expect(diagnostics.some(d => d.code === 'LTC034')).toBe(false)
		expect(component?.serverCode).toContain('Boolean(((zero)))')
	})

	test('a ref read composes with a host-prop read in one thunk', () => {
		// The two substitutable sets are consulted together — the shape the real corpus uses (form-spinbutton's `hidden={() => Boolean(zeroSpan) && host.value === 0}`). `value` needs its root attribute to be a foldable host prop, seeded by the parser applied to the attribute's serialized value — the same evaluation as the client's connect-time parse.
		const { component, diagnostics } = compileComponent(
			`export function C({ zero = '', value = 0 }: { zero?: string; value?: number })
@{
	const zeroSpan = first('span.zero')
	expose({ value: asNumber(0) })
		<c-el {value}>
			<b hidden={() => Boolean(zeroSpan) && host.value === 0}>x</b>
			@if (zero) { <span class="zero">{zero}</span> }
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}
import { asNumber } from '@zeix/le-truc'`,
			'c.tsrx',
			new Set(['c-el']),
		)
		expect(diagnostics.some(d => d.code === 'LTC034')).toBe(false)
		expect(component?.serverCode).toContain(
			'Boolean(((zero))) && (asNumber(0)(attrValue(value))) === 0',
		)
	})

	test('the client still gates on the ref itself', () => {
		const { component } = compileGate(
			`@if (zero) { <span class="zero">{zero}</span> }`,
			`() => Boolean(zeroSpan) && host.value === 0`,
		)
		expect(component?.clientCode).toContain('() => Boolean(zeroSpan)')
	})

	test('a ref in an @else arm folds to the NEGATED condition', () => {
		const { component, diagnostics } = compileGate(
			`@if (zero) { <i>y</i> } @else { <span class="zero">n</span> }`,
			`() => Boolean(zeroSpan)`,
		)
		expect(diagnostics.some(d => d.code === 'LTC034')).toBe(false)
		expect(component?.serverCode).toContain('Boolean((!(zero)))')
	})

	test('an unconditionally rendered ref folds to true', () => {
		const { component, diagnostics } = compileGate(
			`<span class="zero">y</span>`,
			`() => Boolean(zeroSpan)`,
		)
		expect(diagnostics.some(d => d.code === 'LTC034')).toBe(false)
		expect(component?.serverCode).toContain('Boolean((true))')
	})

	test('a ref matching nothing in the template folds to false', () => {
		// The server rendered no such element, so its presence is decided:
		// only a PAGE could supply it, and the server did not.
		const { component, diagnostics } = compileGate(
			`<span class="elsewhere">y</span>`,
			`() => Boolean(zeroSpan)`,
		)
		expect(diagnostics.some(d => d.code === 'LTC034')).toBe(false)
		expect(component?.serverCode).toContain('Boolean((false))')
	})
})
