import { parse } from '@typescript-eslint/typescript-estree'
import type { AstNode } from '../../ast-utils'

export type { AstNode }

type RawNode = {
	type: string
	range?: [number, number]
	[key: string]: unknown
}

const isRawNode = (value: unknown): value is RawNode =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as { type?: unknown }).type === 'string'

/** Keys typescript-estree adds that carry no shape the stages read. */
const DROPPED_KEYS: ReadonlySet<string> = new Set(['range', 'loc', 'parent'])

/** A JSX string's characters as authored, quotes stripped. */
const authoredString = (raw: unknown): string | undefined =>
	typeof raw === 'string' ? raw.slice(1, -1) : undefined

const normalizeValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(normalizeValue)
	if (isRawNode(value)) return normalize(value)
	return value
}

/** One typescript-estree node → the stages' `AstNode` shape. */
const normalize = (node: RawNode): AstNode | null => {
	if (node.type === 'ChainExpression')
		return normalize(node.expression as RawNode)
	if (node.type === 'JSXEmptyExpression') return null
	const out: AstNode = { type: node.type }
	if (node.range) {
		out.start = node.range[0]
		out.end = node.range[1]
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'type' || DROPPED_KEYS.has(key)) continue
		out[key] = normalizeValue(value)
	}
	switch (node.type) {
		case 'CallExpression':
			if (node.optional) out.type = 'OptionalCallExpression'
			break
		case 'JSXText':
			out.value = node.raw
			break
		case 'JSXAttribute': {
			const value = out.value as AstNode | null
			if (value?.type === 'Literal') value.value = authoredString(value.raw)
			break
		}
		case 'TemplateElement': {
			const value = node.value as { raw: string; cooked: string | null }
			out.value = { raw: value.cooked ?? value.raw, cooked: value.cooked }
			break
		}
		case 'ExportNamedDeclaration': {
			const declaration = out.declaration as AstNode | null
			if (declaration && out.start !== undefined) declaration.start = out.start
			break
		}
	}
	return out
}

export const parseTsxModule = (source: string, filename: string): AstNode => {
	// Throws on the first TypeScript parse diagnostic (`compileSourceTsx` reports it as LTC008).
	const estree = parse(source, {
		filePath: filename,
		jsx: true,
		range: true,
		loc: false,
		comment: false,
		tokens: false,
		suppressDeprecatedPropertyWarnings: true,
	})
	return {
		...(normalize(estree as unknown as RawNode) as AstNode),
		start: 0,
		end: source.length,
	}
}
