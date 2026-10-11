import {
	type AstNode,
	asArray,
	collectBoundNames,
	identifierName,
	isHandlerArgName,
	isNode,
} from './ast-utils'
import { diagnostic } from './diagnostics'
import type { ExtractContext } from './extract-context'
import { ambientRecordViolations } from './fold-inputs'
import { isOptionalBinding } from './infer-type'
import type { ChildrenContractIR } from './ir'
import { CONTEXT_NAMES, FACTORY_CONTEXT_MEMBERS } from './vocabulary'

/** The component function's destructured args parameter, extracted. */
export type ComponentParams = {
	paramsNode: AstNode | null
	paramNames: Set<string>
	contextParam: {
		names: ReadonlySet<string>
		annotationName: 'FactoryContext' | 'FormFactoryContext' | null
		annotation: AstNode | null
	} | null
}

export const extractParams = (
	ctx: ExtractContext,
	filename: string,
	fn: AstNode,
): ComponentParams | null => {
	const params = asArray(fn.params)
	const paramsNode = (params[0] as AstNode | undefined) ?? null
	if (params.length > 2 || paramsNode?.type !== 'ObjectPattern') {
		ctx.diagnostics.push(
			diagnostic.invalidSource(
				ctx.source,
				fn,
				`${filename}: the component function must take a single destructured args object (plus, optionally, a typed factory-context parameter: \`, { host, expose }: FactoryContext<Props>\`).`,
			),
		)
		return null
	}
	const paramNames = new Set<string>()
	if (paramsNode) collectBoundNames(paramsNode, paramNames)
	for (const prop of asArray(paramsNode.properties)) {
		if (prop.type !== 'Property' || !isNode(prop.value)) continue
		if (prop.value.type !== 'AssignmentPattern') continue
		const bindingName = identifierName(prop.value.left)
		if (bindingName && !isOptionalBinding(paramsNode, bindingName))
			ctx.diagnostics.push(
				diagnostic.defaultOnRequiredProp(ctx.source, prop, bindingName),
			)
	}
	// The reserved `i18n` record yields only the declared page-ambient members.
	ctx.diagnostics.push(...ambientRecordViolations(ctx.source, paramsNode))
	ctx.handlerArgs = readHandlerArgs(ctx, paramsNode)
	ctx.childrenContract = readChildrenContract(ctx, paramsNode)

	// The factory-context parameter is the author's opt-in to precise context typing: names shadow the profile ambients at function scope, and the compiler only validates the vocabulary — the generated factory destructures the same names, and type-only imports of the annotation never reach generated output.
	let contextParam: ComponentParams['contextParam'] = null
	const contextNode = (params[1] as AstNode | undefined) ?? undefined
	if (contextNode !== undefined) {
		if (contextNode.type !== 'ObjectPattern') {
			ctx.diagnostics.push(
				diagnostic.invalidSource(
					ctx.source,
					contextNode,
					`${filename}: the factory-context parameter must be a destructured object: \`, { host, expose }: FactoryContext<Props>\`.`,
				),
			)
			return null
		}
		const names = new Set<string>()
		collectBoundNames(contextNode, names)
		const bad = [...names].filter(
			n => !FACTORY_CONTEXT_MEMBERS.has(n) && !CONTEXT_NAMES.has(n),
		)
		if (bad.length > 0) {
			ctx.diagnostics.push(
				diagnostic.badFactoryContextParam(ctx.source, contextNode, bad),
			)
			return null
		}
		contextParam = {
			names,
			...contextAnnotationName(contextNode),
		}
	}
	return { paramsNode, paramNames, contextParam }
}

/** The written type's name for the factory-context parameter's annotation — `FactoryContext`/`FormFactoryContext` when the annotation names either, null otherwise; `annotation` is the written type, for LTC050's range. */
const contextAnnotationName = (
	contextNode: AstNode,
): {
	annotationName: 'FactoryContext' | 'FormFactoryContext' | null
	annotation: AstNode | null
} => {
	if (isNode(contextNode.typeAnnotation)) {
		const wrapped = contextNode.typeAnnotation as AstNode
		const literal =
			wrapped.type === 'TSTypeAnnotation' && isNode(wrapped.typeAnnotation)
				? (wrapped.typeAnnotation as AstNode)
				: wrapped
		if (literal.type === 'TSTypeReference') {
			const name = identifierName(literal.typeName)
			if (name === 'FactoryContext' || name === 'FormFactoryContext')
				return { annotationName: name, annotation: literal }
		}
	}
	return { annotationName: null, annotation: null }
}

/** The handler args of the args pattern, binding name → arg name: every top-level arg named `on` plus a capital letter, typed syntactically from the parameter annotation (a non-function or unreadable type is LTC081 and declares no handler arg). */
const readHandlerArgs = (
	ctx: ExtractContext,
	paramsNode: AstNode,
): Map<string, string> => {
	const handlers = new Map<string, string>()
	for (const prop of asArray(paramsNode.properties)) {
		if (prop.type !== 'Property' || prop.computed) continue
		const arg = identifierName(prop.key)
		if (!arg || !isHandlerArgName(arg)) continue
		const value = isNode(prop.value) ? prop.value : null
		const binding = identifierName(
			value?.type === 'AssignmentPattern' ? value.left : value,
		)
		if (!binding) continue
		const type = argTypeOf(ctx, paramsNode.typeAnnotation, arg)
		if (type === null || !isFunctionType(ctx, type)) {
			ctx.diagnostics.push(
				diagnostic.unaddressableHandlerArg(ctx.source, prop, arg, {
					kind: 'not-function',
				}),
			)
			continue
		}
		handlers.set(binding, arg)
	}
	return handlers
}

/** The written type with its `TSTypeAnnotation` wrapper peeled. */
const unwrapType = (node: unknown): AstNode | null => {
	if (!isNode(node)) return null
	return node.type === 'TSTypeAnnotation' && isNode(node.typeAnnotation)
		? (node.typeAnnotation as AstNode)
		: node
}

/** The declared type of `arg` in the args annotation, or null. */
const argTypeOf = (
	ctx: ExtractContext,
	annotation: unknown,
	arg: string,
	depth = 0,
): AstNode | null => {
	const type = unwrapType(annotation)
	if (!type || depth > 8) return null
	const membersOf = (members: unknown): AstNode | null => {
		for (const member of asArray(members))
			if (
				member.type === 'TSPropertySignature' &&
				identifierName(member.key) === arg
			)
				return unwrapType(member.typeAnnotation)
		return null
	}
	switch (type.type) {
		case 'TSTypeLiteral':
			return membersOf(type.members)
		case 'TSIntersectionType':
			for (const part of asArray(type.types)) {
				const found = argTypeOf(ctx, part, arg, depth + 1)
				if (found) return found
			}
			return null
		case 'TSTypeReference': {
			const name = identifierName(type.typeName)
			const decl = name ? ctx.moduleTypes.get(name) : undefined
			if (!decl) return null
			if (decl.type === 'TSInterfaceDeclaration' && isNode(decl.body))
				return membersOf(decl.body.body)
			if (decl.type === 'TSTypeAliasDeclaration')
				return argTypeOf(ctx, decl.typeAnnotation, arg, depth + 1)
			return null
		}
		default:
			return null
	}
}

export type ChildrenContract = ChildrenContractIR

const childrenReferenceOf = (
	ctx: ExtractContext,
	type: AstNode | null,
	depth = 0,
): AstNode | null => {
	if (!type || depth > 8) return null
	if (type.type !== 'TSTypeReference') return null
	const name = identifierName(type.typeName)
	if (name === 'Children') return type
	const decl = name ? ctx.moduleTypes.get(name) : undefined
	return decl?.type === 'TSTypeAliasDeclaration' && isNode(decl.typeAnnotation)
		? childrenReferenceOf(ctx, unwrapType(decl.typeAnnotation), depth + 1)
		: null
}

/** A type-literal roles argument: the inline literal, or its same-file alias. */
const rolesLiteralOf = (
	ctx: ExtractContext,
	arg: AstNode | undefined,
	depth = 0,
): AstNode | null => {
	if (!arg || !isNode(arg) || depth > 8) return null
	if (arg.type === 'TSTypeLiteral') return arg
	if (arg.type === 'TSTypeReference') {
		const name = identifierName(arg.typeName)
		const decl = name ? ctx.moduleTypes.get(name) : undefined
		const aliased =
			decl?.type === 'TSTypeAliasDeclaration' && isNode(decl.typeAnnotation)
				? unwrapType(decl.typeAnnotation)
				: null
		return aliased !== null ? rolesLiteralOf(ctx, aliased, depth + 1) : null
	}
	return null
}

/** The model argument as a string literal: the inline literal, or its same-file alias; anything else reads null — tsc owns it. */
const modelLiteralOf = (
	ctx: ExtractContext,
	arg: AstNode | undefined,
	depth = 0,
): string | null => {
	if (!arg || !isNode(arg) || depth > 8) return null
	if (
		arg.type === 'TSLiteralType' &&
		isNode(arg.literal) &&
		(arg.literal as AstNode).type === 'Literal' &&
		typeof (arg.literal as AstNode).value === 'string'
	)
		return (arg.literal as AstNode).value as string
	if (arg.type === 'TSTypeReference') {
		const name = identifierName(arg.typeName)
		const decl = name ? ctx.moduleTypes.get(name) : undefined
		const aliased =
			decl?.type === 'TSTypeAliasDeclaration' && isNode(decl.typeAnnotation)
				? unwrapType(decl.typeAnnotation)
				: null
		return aliased !== null ? modelLiteralOf(ctx, aliased, depth + 1) : null
	}
	return null
}

/** The declared contract of `children` in the args annotation, or null. */
export const readChildrenContract = (
	ctx: ExtractContext,
	paramsNode: AstNode,
): ChildrenContract | null => {
	const member = argTypeOf(ctx, paramsNode.typeAnnotation, 'children')
	const reference = childrenReferenceOf(ctx, member)
	// An annotation the compiler cannot see through — an imported alias of `Children`, a qualified name, an imported custom type — may still declare roles the author wrote: recorded as `unreadable`, so LTC083's copy does not name a role the author declared. A readable non-reference declares no roles and keeps the plain read.
	if (!reference)
		return member?.type === 'TSTypeReference'
			? { roles: new Map(), model: 'any', unreadable: true }
			: null
	const typeArgs = asArray(
		isNode(reference.typeArguments)
			? ((reference.typeArguments as AstNode).params as unknown)
			: [],
	)
	const roles = new Map<string, string | null>()
	const rolesLiteral = rolesLiteralOf(ctx, typeArgs[0] as AstNode | undefined)
	// A roles argument present but unreadable — an imported name, a union, anything but an inline type literal or its same-file alias — is the same recorded unreadability; an ABSENT argument declares no roles and reads plain.
	const unreadable = rolesLiteral === null && typeArgs[0] !== undefined
	if (rolesLiteral)
		for (const memberNode of asArray(rolesLiteral.members)) {
			if (memberNode.type !== 'TSPropertySignature') continue
			const keyNode = isNode(memberNode.key) ? memberNode.key : null
			const key =
				identifierName(memberNode.key) ??
				(keyNode &&
				keyNode.type === 'Literal' &&
				typeof keyNode.value === 'string'
					? keyNode.value
					: null)
			if (!key) continue
			const tag = unwrapType(memberNode.typeAnnotation)
			roles.set(
				key,
				tag &&
					tag.type === 'TSLiteralType' &&
					isNode(tag.literal) &&
					(tag.literal as AstNode).type === 'Literal' &&
					typeof (tag.literal as AstNode).value === 'string'
					? ((tag.literal as AstNode).value as string)
					: null,
			)
		}
	const modelArg = typeArgs[1]
	const modelValue = modelLiteralOf(ctx, modelArg as AstNode | undefined)
	const model =
		modelValue === 'any' || modelValue === 'non-interactive'
			? modelValue
			: modelValue === null && modelArg !== undefined
				? null
				: 'any'
	return unreadable ? { roles, model, unreadable } : { roles, model }
}

const isFunctionType = (
	ctx: ExtractContext,
	type: AstNode,
	depth = 0,
): boolean => {
	if (depth > 8) return false
	switch (type.type) {
		case 'TSFunctionType':
			return true
		case 'TSUnionType': {
			const members = asArray(type.types)
			const fns = members.filter(m => isFunctionType(ctx, m, depth + 1))
			return (
				fns.length > 0 &&
				members.every(
					m =>
						fns.includes(m) ||
						m.type === 'TSUndefinedKeyword' ||
						m.type === 'TSNullKeyword',
				)
			)
		}
		case 'TSTypeReference': {
			const name = identifierName(type.typeName)
			const decl = name ? ctx.moduleTypes.get(name) : undefined
			const aliased =
				decl?.type === 'TSTypeAliasDeclaration'
					? unwrapType(decl.typeAnnotation)
					: null
			return aliased !== null && isFunctionType(ctx, aliased, depth + 1)
		}
		default:
			return false
	}
}
