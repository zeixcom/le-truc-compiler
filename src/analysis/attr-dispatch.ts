/**
 * The watch-attribute dispatch rule (): how a reactive attribute's
 * client watch writes its value — a property write or a content-attribute
 * write. One decision for every lowering path that emits a `watch-attr`
 * effect plan: construct lowering (`construct-effects.ts`) and `each()`
 * loop bodies (`loops.ts`) kept line-for-line copies of it, hazard comment
 * included, until TC-006 pinned it here (2026-10-10 architecture review).
 *
 * A leaf among the analysis modules: `ast-utils`, the IR type and the
 * vocabulary only — no analysis sibling.
 */

import { hostPropOf } from '../ast-utils'
import type { AttributeIR } from '../ir'
import { isDirtyFlagControlAttr } from '../vocabulary'

/**
 * How the watch for reactive attribute `attr` on a `<tag>` element writes
 * its value. A bare host-prop mirror always dispatches as a PROPERTY —
 * attribute dispatch would be wrong for property-backed targets like
 * `input.value`. LT-116: a dirty-flag IDL attribute (`value`/`checked`/
 * `selected`) on a native dirty-flag control (`input`/`select`/`textarea`/
 * `option`) dispatches as a property too,
 * mirror or not — once the control is dirty, rewriting the content
 * attribute no longer moves the live property, so `bindAttribute` would
 * silently stop tracking (the form-radiogroup mutual-exclusion break,
 * NOTES ; the hand-written corpus precedent is the property write in
 * the `each()` callback, `radio.checked = isChecked`). Everything else
 * dispatches as an ATTRIBUTE — the site is whatever the author rendered.
 *
 * The thunk's own type is irrelevant to the hazard: the divergence is a
 * property of the TARGET. The plan's `coerceToString` stays with the
 * caller — it reads the component's signals, which this leaf does not see.
 */
export const dispatchOf = (
	attr: Extract<AttributeIR, { kind: 'reactive' }>,
	tag: string,
): 'property' | 'attribute' =>
	hostPropOf(attr.thunk) !== null || isDirtyFlagControlAttr(tag, attr.name)
		? 'property'
		: 'attribute'
