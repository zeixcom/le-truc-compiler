import { type AstNode, asArray, identifierName, isNode } from './ast-utils'

export type TypeContext = {
	paramsNode: AstNode | null
	setupInits: Map<string, AstNode>
}

/** Infer a signal's TS-ish value type, for parser and harvest defaults. */
export const inferType = (
	init: AstNode | null,
	ctx: TypeContext,
	depth = 0,
): 'string' | 'number' | 'boolean' | 'unknown' => {
	if (!init || depth > 6) return 'unknown'
	switch (init.type) {
		case 'Literal': {
			const value = init.value
			if (typeof value === 'number') return 'number'
			if (typeof value === 'boolean') return 'boolean'
			if (typeof value === 'string') return 'string'
			return 'unknown'
		}
		case 'TemplateLiteral':
			return 'string'
		case 'Identifier': {
			const name = String(init.name)
			const annotation = typeAnnotationForBinding(ctx.paramsNode, name)
			if (annotation) return typeOfAnnotation(annotation)
			const setupInit = ctx.setupInits.get(name)
			if (setupInit && setupInit !== init)
				return inferType(setupInit, ctx, depth + 1)
			return 'unknown'
		}
		case 'CallExpression':
		case 'OptionalCallExpression': {
			const calleeName = identifierName(init.callee)
			if (calleeName) {
				const fn = ctx.setupInits.get(calleeName)
				if (fn && fn !== init) return returnTypeOfFunction(fn, ctx, depth + 1)
			}
			return 'unknown'
		}
		default:
			return 'unknown'
	}
}

/** Return-type heuristic for setup helper arrows (`(id) => \`panel-${id}\``). */
const returnTypeOfFunction = (
	fn: AstNode,
	ctx: TypeContext,
	depth: number,
): 'string' | 'number' | 'boolean' | 'unknown' => {
	if (isNode(fn.returnType)) {
		const t = typeOfAnnotation(fn.returnType as AstNode)
		if (t !== 'unknown') return t
	}
	const body = fn.body
	if (!isNode(body)) return 'unknown'
	if (body.type === 'BlockStatement') {
		const stmts = asArray(body.body)
		const ret = stmts.find(s => s.type === 'ReturnStatement')
		if (ret && isNode(ret.argument)) return inferType(ret.argument, ctx, depth)
		return 'unknown'
	}
	return inferType(body, ctx, depth)
}

export const typeAnnotationForBinding = (
	paramsNode: AstNode | null,
	bindingName: string,
): AstNode | null => {
	if (!paramsNode || !isNode(paramsNode.typeAnnotation)) return null
	const wrapped = paramsNode.typeAnnotation as AstNode
	const literal =
		wrapped.type === 'TSTypeAnnotation' && isNode(wrapped.typeAnnotation)
			? (wrapped.typeAnnotation as AstNode)
			: wrapped
	if (literal.type !== 'TSTypeLiteral') return null
	for (const member of asArray(literal.members)) {
		if (member.type !== 'TSPropertySignature') continue
		if (
			identifierName(member.key) === bindingName &&
			isNode(member.typeAnnotation)
		)
			return member.typeAnnotation as AstNode
	}
	return null
}

export const isOptionalBinding = (
	paramsNode: AstNode | null,
	bindingName: string,
): boolean => {
	if (!paramsNode || !isNode(paramsNode.typeAnnotation)) return true
	const wrapped = paramsNode.typeAnnotation as AstNode
	const literal =
		wrapped.type === 'TSTypeAnnotation' && isNode(wrapped.typeAnnotation)
			? (wrapped.typeAnnotation as AstNode)
			: wrapped
	if (literal.type !== 'TSTypeLiteral') return true
	for (const member of asArray(literal.members)) {
		if (member.type !== 'TSPropertySignature') continue
		if (identifierName(member.key) === bindingName) return !!member.optional
	}
	// No matching property signature found (e.g. the type is a named alias) — nothing to check against, so don't flag.
	return true
}

export const typeOfAnnotation = (
	annotation: AstNode,
): 'string' | 'number' | 'boolean' | 'unknown' => {
	const inner =
		annotation.type === 'TSTypeAnnotation' && isNode(annotation.typeAnnotation)
			? (annotation.typeAnnotation as AstNode)
			: annotation
	switch (inner.type) {
		case 'TSStringKeyword':
			return 'string'
		case 'TSNumberKeyword':
			return 'number'
		case 'TSBooleanKeyword':
			return 'boolean'
		default:
			return 'unknown'
	}
}
