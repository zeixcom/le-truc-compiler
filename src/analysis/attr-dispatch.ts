import { hostPropOf } from '../ast-utils'
import type { AttributeIR } from '../ir'
import { isDirtyFlagControlAttr } from '../vocabulary'

export const dispatchOf = (
	attr: Extract<AttributeIR, { kind: 'reactive' }>,
	tag: string,
): 'property' | 'attribute' =>
	hostPropOf(attr.thunk) !== null || isDirtyFlagControlAttr(tag, attr.name)
		? 'property'
		: 'attribute'
