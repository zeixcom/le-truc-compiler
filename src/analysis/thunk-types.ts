/**
 * Thunk-body type predicates shared across passes: `returnsNumber`
 * , read by pass 1's loop attribute planning (`loops.ts`)
 * and pass 4's reactive-attribute planning (`effects.ts`). A leaf by design
 * (2026-10-10 architecture review): homed in pass 2 (`harvest.ts`) it made
 * pass 1 import a later pass backwards. Pure functions — no pass state.
 */

import type { AstNode } from '../ast-node'
import { identifierName, nodeType, signalGetCallName } from '../ast-utils'
import type { SignalIR } from '../ir'

/** The library's number-valued parsers, by their authored name. */
const NUMBER_PARSERS: ReadonlySet<string> = new Set([
	'asNumber',
	'asInteger',
	'asClampedInteger',
])

/**
 * Does a signal's scalar `harvest()` marker declare a number-valued parser
 * ()? The marker does not inform `inferredType`, so a seed whose
 * annotation the compiler cannot read (`price: Price`) still connects as a
 * number once wrapped. Matched by name, called or bare — the same syntactic
 * honesty as `CALLABLE_AS_WRITTEN`: an aliased factory misses and its
 * generated attribute site fails tsc rather than being guessed at.
 */
const hasNumberMarker = (signal: SignalIR): boolean => {
	if (signal.family !== 'declared' || signal.harvest?.kind !== 'scalar')
		return false
	const parser = signal.harvest.parser
	const named =
		nodeType(parser) === 'CallExpression'
			? (parser.callee as AstNode | undefined)
			: parser
	return (
		nodeType(named) === 'Identifier' &&
		NUMBER_PARSERS.has(identifierName(named) ?? '')
	)
}

/**
 * Conservative check: does a thunk body evaluate to a number? Number
 * literals, conditionals over them, and — since  — a bare read of a
 * number-typed signal (`count.get()`), resolved through the signal's own
 * `inferredType` rather than guessed from the expression's shape — or,
 * since , through a number-valued `harvest()` marker parser.
 *
 * The signal case matters because of LT-116: `value` on a native form
 * control now dispatches as a PROPERTY write, and `HTMLInputElement.value`
 * is DOMString-typed, so an uncoerced number thunk fails `check:corpus` on
 * the generated client. Callers that have no signal list keep the old
 * literal-only behaviour.
 */
export const returnsNumber = (
	body: unknown,
	signals: readonly SignalIR[] = [],
): boolean => {
	if (nodeType(body) === 'Literal')
		return typeof (body as AstNode).value === 'number'
	if (nodeType(body) === 'ConditionalExpression')
		return returnsNumber((body as AstNode).consequent, signals)
	// `<signal>.get()` — the identifier form only. A `.get()` on anything
	// else (a member chain, a call result) is not a signal read this
	// compiler tracks, so it stays undetected rather than guessed at.
	const name = signalGetCallName(body)
	return (
		name !== null &&
		signals.some(
			s =>
				s.name === name && (s.inferredType === 'number' || hasNumberMarker(s)),
		)
	)
}
