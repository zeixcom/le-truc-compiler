/** Independent-pass tests: each analysis pass runs over an explicitly constructed `PassShared`, without `analyzeClient` orchestration. */
import { describe, expect, test } from 'bun:test'
import { runEffects } from '../src/analysis/effects'
import { runHarvest } from '../src/analysis/harvest'
import { runLoops } from '../src/analysis/loops'
import {
	analyzeClient,
	type LoopPlans,
	type PassShared,
} from '../src/analysis/plan'
import {
	composedShapesFor,
	countForSelector,
	renderedShapesOf,
	resolveSelector,
} from '../src/analysis/selectors'
import { compileSource } from '../src/frontend/tsrx/compiler'
import type { ComponentIR } from '../src/ir'
import type { InternalRegistryEntry } from '../src/registry'

const source = `export function C({}: {})
@{
	const color = createCell('red')
	expose({})
		<c-el>
			<span title={() => color.get() + '!'}>ok</span>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}
import { createCell } from '@zeix/le-truc'`

/** A minimal honest component IR: the front end's own output, not the facade's emitted artifacts. */
const realComponent = (): ComponentIR => {
	const { component } = compileSource(source, 'c.tsrx')
	return component as ComponentIR
}

/** A context assembled by hand — the orchestration-free entry point. */
const contextFor = (component: ComponentIR): PassShared => {
	const queries: PassShared['queries'] = []
	return {
		component,
		source: component.source,
		diagnostics: [],
		routingSignals: [],
		suppressedSites: [],
		registry: new Set(),
		rawSourceRefused: new Set(),
		composeRefs: { mode: 'skipped' },
		queries,
		childTags: new Set(),
		ambient: new Set(component.contextRefs),
		usedNames: new Set(['cEl', ...component.signals.map(s => s.name), 'host']),
		refNames: new Set(),
		addQuery: (base, selector, cardinality) => {
			const existing = queries.find(
				q => q.selector === selector && q.cardinality === cardinality,
			)
			if (existing) return existing.name
			queries.push({
				name: base,
				selector,
				cardinality,
				message: `c-el: ${selector} missing`,
			})
			return base
		},
		collectAmbient: () => {},
		badFreeNames: () => [],
		badListBodyNames: () => [],
	}
}

/** No loops in the fixture: the empty production `runLoops` would return. */
const noLoops: LoopPlans = { forPlans: new Map(), reconcilePlans: new Map() }

describe('analysis passes over a constructed context', () => {
	test('runHarvest alone seeds a map-thunk/computed-thunk signal', () => {
		const component = realComponent()
		const harvests = runHarvest(contextFor(component), noLoops)
		expect(harvests).toHaveLength(1)
		expect(harvests[0]).toEqual({
			kind: 'substitute',
			signal: 'color',
			expr: "'red'",
		})
	})

	test('runEffects alone registers the reactive attribute effect and query', () => {
		const component = realComponent()
		const ctx = contextFor(component)
		const effects = runEffects(ctx, noLoops, [])
		expect(ctx.queries.map(q => q.selector)).toEqual(['span'])
		expect(effects).toHaveLength(1)
		expect(effects[0]?.kind).toBe('watch-attr')
	})

	test('full orchestration agrees with the composed passes', () => {
		const component = realComponent()
		const plan = analyzeClient(component, new Set(), [])
		const ctx = contextFor(component)
		const loopPlans = runLoops(ctx)
		const harvests = runHarvest(ctx, loopPlans)
		expect(harvests).toEqual(plan.harvests)
		expect(runEffects(ctx, loopPlans, harvests)).toEqual(plan.effects)
	})

	test('pass order is a type contract, not a convention (ADR 0018 s5)', () => {
		const ctx = contextFor(realComponent())
		// Never executed — the assertions are the `@ts-expect-error`s, which fail typecheck the day a pass stops requiring its producer's output.
		const harvestBeforeLoops = () => {
			// @ts-expect-error — runHarvest requires runLoops' LoopPlans
			runHarvest(ctx)
		}
		const effectsBeforeHarvest = () => {
			// @ts-expect-error — runEffects requires runHarvest's HarvestPlans
			runEffects(ctx, noLoops)
		}
		expect(typeof harvestBeforeLoops).toBe('function')
		expect(typeof effectsBeforeHarvest).toBe('function')
	})

	test('selector engine counts are independently computable', () => {
		const component = realComponent()
		const span = component.root.children.find(
			n => n.kind === 'element',
		) as Extract<ComponentIR['root'], { kind: 'element' }>
		expect(countForSelector(component.root, 'span')).toBe(1)
		expect(resolveSelector(component, span)).toEqual({
			selector: 'span',
			unique: true,
		})
	})
})

/** Class discriminators are token clauses, matched through css-select on the materialized probe via `countForSelector` over the element's own subtree (which includes the element itself). */
describe('class discriminators are token clauses (LT-124)', () => {
	/** The element a `first()`-addressed span lowers to, given a class value. */
	const spanWithClass = (className: string): ComponentIR => {
		const { component } = compileSource(
			`export function C({}: {})
@{
	const el = first('span.label')
	expose({})
		<c-el>
			<span class="${className}">ok</span>
			<span class="other">x</span>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
		)
		return component as ComponentIR
	}

	const firstSpan = (component: ComponentIR) =>
		(component.root.children as ReadonlyArray<{ kind: string }>).find(
			n => n.kind === 'element',
		) as Extract<ComponentIR['root'], { kind: 'element' }>

	test('a single-token class synthesizes `.token`, not `[class="…"]`', () => {
		const component = spanWithClass('label')
		expect(resolveSelector(component, firstSpan(component))).toEqual({
			selector: 'span.label',
			unique: true,
		})
	})

	test('a multi-token class offers one candidate per token, order-insensitively', () => {
		const component = spanWithClass('label icon')
		// The first unique candidate wins, so the synthesized selector names one token — but either token identifies the element.
		const { selector } = resolveSelector(component, firstSpan(component))
		expect(['span.label', 'span.icon']).toContain(selector)
		expect(countForSelector(component.root, 'span.label')).toBe(1)
		expect(countForSelector(component.root, 'span.icon')).toBe(1)
	})

	test('a token clause matches page markup carrying extra classes', () => {
		// The template renders `class="label"`, the page renders `class="label icon"` — a token clause matches by membership.
		const pageSpan = firstSpan(spanWithClass('label icon'))
		expect(countForSelector(pageSpan, 'span.label')).toBe(1)
		expect(countForSelector(pageSpan, 'span.icon')).toBe(1)
		expect(countForSelector(pageSpan, 'span[class="label"]')).toBe(0)
		expect(countForSelector(pageSpan, 'span.missing')).toBe(0)
		expect(countForSelector(pageSpan, 'div.label')).toBe(0)
	})

	test('a token that is not a plain identifier falls back to exact match', () => {
		// `.w-1/2` would be a querySelector syntax error — a throw at activation, not a miss — so those keep the exact-match form.
		const component = spanWithClass('w-1/2')
		expect(resolveSelector(component, firstSpan(component))).toEqual({
			selector: 'span[class="w-1/2"]',
			unique: true,
		})
	})
})

/** `#id` is the canonical spelling of an id discriminator — not a widening, since `input#x` and `input[id="x"]` select exactly the same element. */
describe('id discriminators use the hash form (LT-124)', () => {
	/** Two same-tag inputs — the bare tag is ambiguous, forcing a discriminator. */
	const twoInputs = (idValue: string): ComponentIR => {
		const { component } = compileSource(
			`export function C({}: {})
@{
	const el = first('input#${idValue}')
	expose({})
		<c-el>
			<input id="${idValue}" />
			<input id="other" />
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
		)
		return component as ComponentIR
	}

	const firstInput = (component: ComponentIR) =>
		(component.root.children as ReadonlyArray<{ kind: string }>).find(
			n => n.kind === 'element',
		) as Extract<ComponentIR['root'], { kind: 'element' }>

	test('an ambiguous tag upgrades to `tag#id`, not `tag[id="…"]`', () => {
		const component = twoInputs('name-input')
		expect(resolveSelector(component, firstInput(component))).toEqual({
			selector: 'input#name-input',
			unique: true,
		})
	})

	test('the engine recognizes the hash form and stays exact', () => {
		const input = firstInput(twoInputs('name-input'))
		expect(countForSelector(input, 'input#name-input')).toBe(1)
		expect(countForSelector(input, '#name-input')).toBe(1)
		// Exact, unlike a class token: no membership, no prefix matching.
		expect(countForSelector(input, 'input#name')).toBe(0)
		expect(countForSelector(input, 'span#name-input')).toBe(0)
	})

	test('an id that is not a plain identifier falls back to exact match', () => {
		const component = twoInputs('1st.field')
		expect(resolveSelector(component, firstInput(component))).toEqual({
			selector: 'input[id="1st.field"]',
			unique: true,
		})
	})
})

describe('aria-* discriminators are the last resort (LT-101)', () => {
	/** An opener told apart by ARIA alone: no `first()` ref, so this pins the synthesizer's own candidate order. */
	const twoButtons = (openerAttrs: string): ComponentIR => {
		const { component } = compileSource(
			`export function C({}: {})
@{
	expose({})
		<c-el>
			<button type="button" ${openerAttrs}>Open</button>
			<button type="button" class="close" aria-label="Close">x</button>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
		)
		return component as ComponentIR
	}

	const firstButton = (component: ComponentIR) =>
		(component.root.children as ReadonlyArray<{ kind: string }>).find(
			n => n.kind === 'element',
		) as Extract<ComponentIR['root'], { kind: 'element' }>

	test('a button with no other discriminator resolves to its aria clause', () => {
		const component = twoButtons('aria-haspopup="dialog"')
		expect(resolveSelector(component, firstButton(component))).toEqual({
			selector: 'button[aria-haspopup="dialog"]',
			unique: true,
		})
	})

	test('any earlier discriminator still wins', () => {
		const component = twoButtons('class="open" aria-haspopup="dialog"')
		expect(resolveSelector(component, firstButton(component))).toEqual({
			selector: 'button.open',
			unique: true,
		})
	})
})

/** Uniqueness is counted over the own template, but the runtime query also descends into composed children's rendered markup — a candidate a child could match is emitted with a `:not(<child-tag> *)` exclusion. */
describe('selectors account for composed children', () => {
	const child = (body: string): ComponentIR =>
		compileSource(
			`export function Child({ size = 'small' }: { size?: string })
@{
		<child-el>${body}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</child-el>
}`,
			'child.tsrx',
		).component as ComponentIR

	// No `first()` refs: this block pins synthesis; the authored-selector route has its own block below.
	const parent = (withRefs = false): ComponentIR =>
		compileSource(
			`import { Child } from './child.tsrx'
export function P({}: {})
@{
	${withRefs ? "const overlay = first('button.overlay')" : ''}
	expose({})
		<p-el>
			<code>x</code>
			<Child />
			<button type="button" class="overlay">Go</button>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</p-el>
}`,
			'p.tsrx',
		).component as ComponentIR

	const elementByTag = (component: ComponentIR, tag: string) =>
		(
			component.root.children as ReadonlyArray<{ kind: string; tag?: string }>
		).find(n => n.kind === 'element' && n.tag === tag) as Extract<
			ComponentIR['root'],
			{ kind: 'element' }
		>

	const withChild = (
		childIR: ComponentIR | null,
		withRefs = false,
	): ComponentIR => {
		const component = parent(withRefs)
		const composeSource = (
			component.root.children.find(n => n.kind === 'compose') as {
				source: string
			}
		).source
		const registry = new Map<string, InternalRegistryEntry>(
			childIR
				? [
						[
							composeSource,
							{
								tag: 'child-el',
								renderedShapes: renderedShapesOf(childIR),
							} as InternalRegistryEntry,
						],
					]
				: [],
		)
		component.composedShapes = composedShapesFor(component.root, registry)
		return component
	}

	test('the child renders a button with a dynamic class — every button candidate clashes', () => {
		const component = withChild(
			child('<button type="button" class={size}>in</button>'),
		)
		// Every candidate clashes (the dynamic class may hold "overlay"), so all come out exclusion-wrapped; the most precise decorated base wins.
		expect(
			resolveSelector(component, elementByTag(component, 'button')),
		).toEqual({ selector: 'button.overlay:not(child-el *)', unique: true })
	})

	test('a static child class leaves a non-clashing discriminator clean', () => {
		const component = withChild(
			child('<button type="button" class="inner">in</button>'),
		)
		expect(
			resolveSelector(component, elementByTag(component, 'button')),
		).toEqual({ selector: 'button.overlay', unique: true })
	})

	test('a tag the child never renders keeps its bare selector', () => {
		const component = withChild(child('<button type="button">in</button>'))
		expect(resolveSelector(component, elementByTag(component, 'code'))).toEqual(
			{
				selector: 'code',
				unique: true,
			},
		)
	})

	test('raw `children` in the child is unknown markup — every candidate clashes', () => {
		const rawChild = compileSource(
			`export function Child({ children }: { children?: string })
@{
		<child-el>{children}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</child-el>
}`,
			'child.tsrx',
		).component as ComponentIR
		expect(renderedShapesOf(rawChild)).toContainEqual({ kind: 'children' })
		const component = withChild(rawChild)
		expect(resolveSelector(component, elementByTag(component, 'code'))).toEqual(
			{
				selector: 'code:not(child-el *)',
				unique: true,
			},
		)
	})

	test('a template-proper candidate beside content holding a match keeps the exclusion (LT-512)', () => {
		// The child renders only `{children}` and the parent passes a matching element into it: the plain probe never sees compose content, so the exclusion is the only thing keeping the passed element out of the query (document order puts it under the child's host, earlier than the target).
		const rawChild = compileSource(
			`export function Child({ children }: { children?: string })
@{
		<child-el>{children}
			<style>@scope {
:scope {
	  color: red;
	}
}</style>
		</child-el>
}`,
			'child.tsrx',
		).component as ComponentIR
		const parent = compileSource(
			`import { Child } from './child.tsrx'
export function P({}: {})
@{
	expose({})
		<p-el>
			<Child><button type="button" class="overlay">in</button></Child>
			<button type="button" class="overlay">out</button>
		</p-el>
}`,
			'p.tsrx',
		).component as ComponentIR
		const composeSource = (
			parent.root.children.find(n => n.kind === 'compose') as {
				source: string
			}
		).source
		parent.composedShapes = composedShapesFor(
			parent.root,
			new Map<string, InternalRegistryEntry>([
				[
					composeSource,
					{
						tag: 'child-el',
						renderedShapes: renderedShapesOf(rawChild),
					} as InternalRegistryEntry,
				],
			]),
		)
		const button = (
			parent.root.children as ReadonlyArray<{ kind: string; tag?: string }>
		).find(n => n.kind === 'element' && n.tag === 'button') as Extract<
			ComponentIR['root'],
			{ kind: 'element' }
		>
		// Synthesized form: the most precise decorated base (the class hook over the bare tag) with the exclusion.
		expect(resolveSelector(parent, button)).toEqual({
			selector: 'button.overlay:not(child-el *)',
			unique: true,
		})
		// Authored-contract form: the ref attr carries the author's selector and still comes out exclusion-wrapped — the authored path, not synthesis, produced it.
		;(
			button as {
				attrs: Array<{ kind: string; name?: string; selector?: string }>
			}
		).attrs.push({ kind: 'ref', name: 'overlay', selector: 'button.overlay' })
		expect(resolveSelector(parent, button)).toEqual({
			selector: 'button.overlay:not(child-el *)',
			unique: true,
		})
	})

	test('an unregistered child cannot be excluded — no candidate is unique', () => {
		const component = withChild(null)
		expect(
			resolveSelector(component, elementByTag(component, 'button')).unique,
		).toBe(false)
	})

	test('among exclusion-decorated candidates the most precise base wins (LT-520)', () => {
		// The child takes open children, so its `children` shape may match every candidate of the parent's own template: all come out decorated and the base decides — id outranks class hook and bare tag; role keeps first place over a class hook.
		const rawChild = compileSource(
			`export function Child({ children }: { children?: string })
@{
		<child-el>{children}
			<style>@scope {
:scope {
	  color: red;
	}
}</style>
		</child-el>
}`,
			'child.tsrx',
		).component as ComponentIR
		const component = compileSource(
			`import { Child } from './child.tsrx'
export function P({}: {})
@{
	expose({})
		<p-el>
			<Child />
			<button type="button" id="go" class="overlay">Go</button>
			<span role="status" class="note">St</span>
			<style>@scope {
:scope {
  color: red;
	}
}</style>
		</p-el>
}`,
			'p.tsrx',
		).component as ComponentIR
		const registry = new Map<string, InternalRegistryEntry>([
			[
				(
					component.root.children.find(n => n.kind === 'compose') as {
						source: string
					}
				).source,
				{
					tag: 'child-el',
					renderedShapes: renderedShapesOf(rawChild),
				} as InternalRegistryEntry,
			],
		])
		component.composedShapes = composedShapesFor(component.root, registry)
		expect(
			resolveSelector(component, elementByTag(component, 'button')),
		).toEqual({ selector: 'button#go:not(child-el *)', unique: true })
		expect(resolveSelector(component, elementByTag(component, 'span'))).toEqual(
			{ selector: 'span[role="status"]:not(child-el *)', unique: true },
		)
	})

	test('type is not a hook — a decorated type-only button keeps the bare tag', () => {
		// `type="button"` is boilerplate, not an addressing hook: the bare tag precedes it within its rank.
		const component = compileSource(
			`import { Child } from './child.tsrx'
export function P({}: {})
@{
	expose({})
		<p-el>
			<Child />
			<button type="button">Go</button>
			<style>@scope {
:scope {
  color: red;
	}
}</style>
		</p-el>
}`,
			'p.tsrx',
		).component as ComponentIR
		const registry = new Map<string, InternalRegistryEntry>([
			[
				(
					component.root.children.find(n => n.kind === 'compose') as {
						source: string
					}
				).source,
				{
					tag: 'child-el',
					renderedShapes: renderedShapesOf(
						child('<button type="button">in</button>'),
					),
				} as InternalRegistryEntry,
			],
		])
		component.composedShapes = composedShapesFor(component.root, registry)
		expect(
			resolveSelector(component, elementByTag(component, 'button')),
		).toEqual({ selector: 'button:not(child-el *)', unique: true })
	})

	test('without composed shapes (the discovery pass) the single-template view stands', () => {
		const component = parent()
		expect(
			resolveSelector(component, elementByTag(component, 'button')),
		).toEqual({ selector: 'button', unique: true })
	})

	test('an authored selector a child could match keeps its contract, exclusion-wrapped (LT-316)', () => {
		const component = withChild(
			child('<button type="button" class={size}>in</button>'),
			true,
		)
		expect(
			resolveSelector(component, elementByTag(component, 'button')),
		).toEqual({ selector: 'button.overlay:not(child-el *)', unique: true })
	})

	test('an authored selector an unregistered child may match falls back to synthesis (LT-316)', () => {
		const component = withChild(null, true)
		expect(
			resolveSelector(component, elementByTag(component, 'button')).unique,
		).toBe(false)
	})
})

/** A `first()` ref's authored selector is the contract page-authored occurrences are addressed by: emitted whenever structurally verifiable (in the synthesized grammar and unique over the own template), with synthesis only as fallback. */
describe('authored first() selectors are emitted when verifiable (LT-316)', () => {
	const resolveRef = (template: string, selector: string, tag: string) => {
		const component = compileSource(
			`export function C({}: {})
@{
	const el = first('${selector}')
	expose({})
		<c-el>
			${template}
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			'c.tsrx',
		).component as ComponentIR
		const element = (
			component.root.children as ReadonlyArray<{ kind: string; tag?: string }>
		).find(n => n.kind === 'element' && n.tag === tag) as Extract<
			ComponentIR['root'],
			{ kind: 'element' }
		>
		return resolveSelector(component, element)
	}

	test('a class selector wins over the role synthesis would pick (splitview)', () => {
		expect(
			resolveRef(
				'<button type="button" role="separator" class="divider">|</button>',
				'button.divider',
				'button',
			),
		).toEqual({ selector: 'button.divider', unique: true })
	})

	test('a class-only selector is not widened to the bare tag (colorinfo)', () => {
		expect(
			resolveRef('<small class="hex">#fff</small>', '.hex', 'small'),
		).toEqual({ selector: '.hex', unique: true })
	})

	test('a selector outside the synthesized grammar falls back to synthesis', () => {
		expect(
			resolveRef(
				'<span class="a b">x</span><span class="a">y</span>',
				'span.a.b',
				'span',
			),
		).toEqual({ selector: 'span.b', unique: true })
	})
})
