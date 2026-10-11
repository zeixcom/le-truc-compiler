import {
	type AstNode,
	identifierName,
	nodeType,
	signalGetCallName,
} from '../ast-utils'
import type { SignalIR } from '../ir'

/** The library's number-valued parsers, by their authored name. */
const NUMBER_PARSERS: ReadonlySet<string> = new Set([
	'asNumber',
	'asInteger',
	'asClampedInteger',
])

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

export const returnsNumber = (
	body: unknown,
	signals: readonly SignalIR[] = [],
): boolean => {
	if (nodeType(body) === 'Literal')
		return typeof (body as AstNode).value === 'number'
	if (nodeType(body) === 'ConditionalExpression')
		return returnsNumber((body as AstNode).consequent, signals)
	const name = signalGetCallName(body)
	return (
		name !== null &&
		signals.some(
			s =>
				s.name === name && (s.inferredType === 'number' || hasNumberMarker(s)),
		)
	)
}
