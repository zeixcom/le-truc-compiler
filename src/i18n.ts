import {
	type AstNode,
	asArray,
	collectBoundNames,
	forEachChild,
	identifierName,
	isNode,
} from './ast-utils'
import { diagnostic } from './diagnostics'
import type { ExtractContext } from './extract-context'
import { type MessageArg, type MessageArgKind, parseMessage } from './icu/parse'

const messagesKey = (node: unknown): string | null => {
	if (!isNode(node)) return null
	if (node.type === 'Identifier') return String(node.name)
	// A quoted key (`'task-count'`) names what no bare identifier can.
	if (node.type === 'Literal' && typeof node.value === 'string')
		return node.value
	return null
}

/** Unwrap the `as const` the authored spelling carries; any other assertion is returned as-is and fails the object-literal check. */
const constAssertedObject = (init: AstNode): AstNode => {
	if (init.type !== 'TSAsExpression' || !isNode(init.expression)) return init
	const annotation = init.typeAnnotation
	return isNode(annotation) &&
		annotation.type === 'TSTypeReference' &&
		identifierName(annotation.typeName) === 'const'
		? init.expression
		: init
}

/** A component's `export const i18n` declaration, as extracted. */
export type I18nDecl = {
	/** Message key → source-locale pattern, verbatim. */
	messages: Record<string, string>
	args: Record<string, readonly MessageArg[]>
}

export const readI18nDecl = (
	ctx: ExtractContext,
	stmt: AstNode,
): I18nDecl | null => {
	const decl =
		stmt.type === 'ExportNamedDeclaration' && isNode(stmt.declaration)
			? stmt.declaration
			: stmt
	if (decl.type !== 'VariableDeclaration' || decl.kind !== 'const') return null
	const declarator = asArray(decl.declarations)[0] ?? null
	if (identifierName(declarator?.id) !== 'i18n' || !isNode(declarator?.init))
		return null
	const init = constAssertedObject(declarator.init)
	if (init.type !== 'ObjectExpression') {
		ctx.diagnostics.push(
			diagnostic.invalidSource(
				ctx.source,
				declarator,
				'`export const i18n` must be an object literal mapping message keys to their source-locale strings (ADR 0009).',
			),
		)
		return null
	}
	const messages: Record<string, string> = {}
	const args: Record<string, readonly MessageArg[]> = {}
	for (const prop of asArray(init.properties)) {
		if (prop.type !== 'Property') continue
		const key = messagesKey(prop.key)
		const value = prop.value
		if (!key || !isNode(value)) continue
		if (value.type === 'Literal' && typeof value.value === 'string') {
			messages[key] = value.value
			const parsed = parseMessage(value.value)
			if (parsed.ok) args[key] = parsed.args
			else
				ctx.diagnostics.push(
					diagnostic.unparseableMessage(ctx.source, value, key, parsed.error),
				)
		} else {
			ctx.diagnostics.push(
				diagnostic.invalidSource(
					ctx.source,
					value,
					`\`export const i18n\` value for \`${key}\` must be a string literal — the inline source string is the fallback every locale resolves against and the bytes the staleness manifest hashes.`,
				),
			)
		}
	}
	return { messages, args }
}

export const langBindingOf = (paramsNode: AstNode | null): string | null => {
	if (!paramsNode || paramsNode.type !== 'ObjectPattern') return null
	for (const prop of asArray(paramsNode.properties)) {
		if (prop.type !== 'Property') continue
		const key = identifierName(prop.key)
		const value = prop.value
		if (!key || !isNode(value)) continue
		if (key === 'lang') {
			const bound = new Set<string>()
			collectBoundNames(value, bound)
			const name = [...bound][0]
			if (name) return name
		}
		if (key === 'i18n' && value.type === 'ObjectPattern') {
			for (const inner of asArray(value.properties)) {
				if (inner.type !== 'Property') continue
				if (identifierName(inner.key) !== 'lang') continue
				if (!isNode(inner.value)) continue
				const bound = new Set<string>()
				collectBoundNames(inner.value, bound)
				const name = [...bound][0]
				if (name) return name
			}
		}
	}
	return null
}

export const langArgDefaultOf = (paramsNode: AstNode | null): string | null => {
	if (!paramsNode || paramsNode.type !== 'ObjectPattern') return null
	for (const prop of asArray(paramsNode.properties)) {
		if (prop.type !== 'Property') continue
		if (identifierName(prop.key) !== 'lang') continue
		const value = prop.value
		if (
			isNode(value) &&
			value.type === 'AssignmentPattern' &&
			isNode(value.right) &&
			value.right.type === 'Literal' &&
			typeof value.right.value === 'string'
		)
			return value.right.value
		return null
	}
	return null
}

export const declaresI18nOf = (paramsNode: AstNode | null): boolean => {
	if (!paramsNode || paramsNode.type !== 'ObjectPattern') return false
	return asArray(paramsNode.properties).some(
		prop => prop.type === 'Property' && identifierName(prop.key) === 'i18n',
	)
}

export const messageBindingsOf = (
	paramsNode: AstNode | null,
): { tNames: Set<string>; recordNames: Set<string> } => {
	const tNames = new Set<string>()
	const recordNames = new Set<string>()
	if (!paramsNode || paramsNode.type !== 'ObjectPattern')
		return { tNames, recordNames }
	for (const prop of asArray(paramsNode.properties)) {
		if (prop.type !== 'Property' || identifierName(prop.key) !== 'i18n')
			continue
		const value = prop.value
		if (isNode(value) && value.type === 'Identifier')
			recordNames.add(String(value.name))
		if (!isNode(value) || value.type !== 'ObjectPattern') continue
		for (const inner of asArray(value.properties)) {
			if (inner.type !== 'Property' || identifierName(inner.key) !== 't')
				continue
			const name = identifierName(inner.value)
			if (name) tNames.add(name)
		}
	}
	return { tNames, recordNames }
}

export const staticMessageReads = (
	node: AstNode,
	tName: string,
	declaredKeys: Readonly<Record<string, string>>,
): string[] | null => {
	const keys: string[] = []
	let admitted = true
	const visit = (current: unknown, parent: AstNode | null): void => {
		if (!admitted) return
		if (Array.isArray(current)) {
			for (const child of current) visit(child, parent)
			return
		}
		if (!isNode(current)) return
		if (current.type === 'Identifier' && current.name === tName) {
			// Not a reference: a member's property name or an object key.
			if (
				(parent?.type === 'MemberExpression' &&
					parent.property === current &&
					!parent.computed) ||
				(parent?.type === 'Property' &&
					parent.key === current &&
					!parent.computed)
			)
				return
			const property =
				parent?.type === 'MemberExpression' && parent.object === current
					? parent.property
					: null
			const key = !isNode(property)
				? null
				: !parent?.computed
					? identifierName(property)
					: property.type === 'Literal' && typeof property.value === 'string'
						? property.value
						: null
			if (key !== null && Object.hasOwn(declaredKeys, key)) keys.push(key)
			else admitted = false
			return
		}
		// Type positions are skipped: `typeof t` reads no message.
		forEachChild(current, child => visit(child, current))
	}
	visit(node, null)
	return admitted ? keys : null
}

/** `{ a, b }` → `a` and `b`, for a closed list in copy. */
const argList = (names: readonly string[]): string =>
	names.map(name => `\`${name}\``).join(', ')

export const reportMessageCallSites = (
	ctx: ExtractContext,
	componentFn: AstNode,
	args: Readonly<Record<string, readonly MessageArg[]>>,
): void => {
	const params = asArray(componentFn.params)[0] ?? null
	const { tNames, recordNames } = messageBindingsOf(params)
	if (tNames.size === 0 && recordNames.size === 0) return
	const keyOf = (member: AstNode): string | null => {
		if (member.type !== 'MemberExpression') return null
		// A string-literal computed key (`t['task.one']`) is as static as a dotted one; any other computed key is not a site this can check.
		const property = member.property
		const key = !member.computed
			? identifierName(property)
			: isNode(property) &&
					property.type === 'Literal' &&
					typeof property.value === 'string'
				? property.value
				: null
		if (key === null) return null
		const object = member.object
		if (!isNode(object)) return null
		const isT =
			(object.type === 'Identifier' && tNames.has(String(object.name))) ||
			(object.type === 'MemberExpression' &&
				!object.computed &&
				identifierName(object.property) === 't' &&
				isNode(object.object) &&
				object.object.type === 'Identifier' &&
				recordNames.has(String(object.object.name)))
		return isT ? key : null
	}
	const check = (member: AstNode, key: string, call: AstNode | null): void => {
		const expected = args[key]
		if (expected === undefined) return
		const names = expected.map(arg => arg.name)
		const example = `\`t.${key}({ ${names.join(', ')} })\``
		const report = (problem: string, fix: string) =>
			ctx.diagnostics.push(
				diagnostic.messageArgumentMismatch(
					ctx.source,
					call ?? member,
					key,
					problem,
					fix,
				),
			)
		if (expected.length === 0) {
			if (call)
				report(
					'is called, but its pattern takes no arguments, so the message is a plain string',
					`Read it without a call: \`t.${key}\`.`,
				)
			return
		}
		if (!call) {
			report(
				`is read without a call, but its pattern takes ${argList(names)} — the message is a function, and would render as one`,
				`Call it: ${example}.`,
			)
			return
		}
		const callArgs = asArray(call.arguments)
		const record = callArgs[0]
		if (callArgs.length !== 1 || record?.type !== 'ObjectExpression') {
			report(
				'is not called with one object literal',
				`Pass its arguments as one object literal: ${example}.`,
			)
			return
		}
		const passed: string[] = []
		for (const prop of asArray(record.properties)) {
			const name =
				prop.type === 'Property' && !prop.computed
					? (identifierName(prop.key) ??
						(isNode(prop.key) &&
						prop.key.type === 'Literal' &&
						typeof prop.key.value === 'string'
							? prop.key.value
							: null))
					: null
			if (name === null) {
				report(
					'is called with a spread or a computed key — the build checks only an argument record whose keys it can read',
					`Name every argument as a plain key: ${example}.`,
				)
				return
			}
			passed.push(name)
		}
		const missing = names.filter(name => !passed.includes(name))
		const extra = passed.filter(name => !names.includes(name))
		if (missing.length === 0 && extra.length === 0) return
		report(
			[
				missing.length > 0 ? `is missing ${argList(missing)}` : '',
				extra.length > 0
					? `passes ${argList(extra)}, which its pattern never reads`
					: '',
			]
				.filter(Boolean)
				.join(' and '),
			`Pass exactly the arguments its pattern reads: ${example}.`,
		)
	}
	const visit = (node: unknown, parent: AstNode | null): void => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child, parent)
			return
		}
		if (!isNode(node)) return
		const key = keyOf(node)
		if (key !== null) {
			const call =
				parent?.type === 'CallExpression' && parent.callee === node
					? parent
					: null
			check(node, key, call)
		}
		// Type positions are skipped: a message read is a member expression, which never occurs in one.
		forEachChild(node, child => visit(child, node))
	}
	visit(componentFn.body, componentFn)
}

/** The TypeScript type a message argument of each kind accepts. */
const ARG_KIND_TYPES: Record<MessageArgKind, string> = {
	number: 'number',
	date: 'Date',
	string: 'string',
	plain: 'string | number',
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

export const messagesRecordType = (
	args: Record<string, readonly MessageArg[]>,
): string => {
	const member = (name: string) =>
		IDENTIFIER.test(name) ? name : JSON.stringify(name)
	const members = Object.entries(args).map(([key, list]) => {
		if (!list.length) return `${member(key)}: string`
		const record = list
			.map(arg => `${member(arg.name)}: ${ARG_KIND_TYPES[arg.kind]}`)
			.join('; ')
		return `${member(key)}: (args: { ${record} }) => string`
	})
	return members.length ? `{ ${members.join('; ')} }` : '{}'
}

export const i18nAnnotated = (
	paramsText: string,
	args: Record<string, readonly MessageArg[]> | null | undefined,
): string =>
	args
		? paramsText.replace(
				/\bI18n<\s*typeof\s+i18n\s*>/g,
				() => `I18n<${messagesRecordType(args)}>`,
			)
		: paramsText
