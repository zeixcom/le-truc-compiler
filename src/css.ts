import type { CssNode, CssTreeDeclaration } from 'css-tree/dist/csstree.esm'
import {
	lexer,
	parse,
	parse as parseDeclarationList,
} from 'css-tree/dist/csstree.esm'
import type { StyleSheet } from 'lightningcss-wasm'
import { transform } from 'lightningcss-wasm'
import { anchorRelativeSelectors } from './css-scope'

/* === Types === */

/** What a sheet error says is wrong. */
export type SheetErrorFace =
	/** The sheet does not parse (lightningcss refused it). */
	| 'syntax'
	/** A declaration names a property the CSS grammar does not define. */
	| 'unknown-property'
	/** A declaration's value is outside its property's grammar. */
	| 'invalid-value'

/** One spec-grammar finding over the authored sheet. */
export type SheetError = {
	face: SheetErrorFace
	offset?: number
	end?: number
	/** The offending property, for the declaration faces. */
	property?: string
	/** The echoed value text, for the invalid-value face. */
	value?: string
	/** The parser's own wording, for the message body. */
	detail: string
}

export type ParsedComponentSheet = {
	/** The parsed sheet, or null when it does not parse (or is absent). */
	sheet: StyleSheet | null
	/** Every grammar finding; empty for a valid sheet. */
	errors: SheetError[]
}

/* === Internal Functions === */

const lineColToOffset = (source: string, line: number, column: number) => {
	let offset = 0
	for (let i = 1; i < line; i++) {
		const next = source.indexOf('\n', offset)
		if (next === -1) return source.length
		offset = next + 1
	}
	return Math.min(source.length, offset + Math.max(0, column - 1))
}

/** First line of a parser message — the detail never spans lines. */
const firstLine = (message: string): string => message.split('\n')[0] ?? ''

/** css-tree node children, iterating its List (or plain array) shape. */
const childrenOf = (node: CssNode): CssNode[] => {
	const children = (node as { children?: Iterable<CssNode> }).children
	return children ? [...children].filter(Boolean) : []
}

/** A `var()`/`env()` reference anywhere in a value's component tree. */
const mentionsSubstitution = (node: CssNode | undefined): boolean =>
	!!node &&
	(node.type === 'Function' && /^(var|env)$/i.test(String(node.name))
		? true
		: childrenOf(node).some(mentionsSubstitution))

const nestedBlockRegions = (text: string): Array<[number, number]> => {
	const regions: Array<[number, number]> = []
	let depth = 0
	let start = -1
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === '"' || ch === "'") {
			const quote = ch
			i++
			while (i < text.length && text[i] !== quote) {
				if (text[i] === '\\') i++
				i++
			}
			continue
		}
		if (text.startsWith('/*', i)) {
			const end = text.indexOf('*/', i + 2)
			if (end === -1) break
			i = end + 1
			continue
		}
		if (ch === '{') {
			if (depth === 0) start = i
			depth++
		} else if (ch === '}') {
			if (depth > 0 && --depth === 0 && start >= 0) {
				regions.push([start + 1, i])
				start = -1
			}
		}
	}
	return regions
}

const MAX_VALUE_ECHO = 60

const DESCRIPTOR_ATRULES = new Set([
	'font-face',
	'property',
	'counter-style',
	'font-palette-values',
	'font-feature-values',
	'page',
	'view-transition',
	'color-profile',
])

const grammarErrors = (source: string): SheetError[] => {
	const errors: SheetError[] = []
	let ast: CssNode
	try {
		ast = parse(source, { positions: true })
	} catch {
		return errors
	}

	const trimmedEnd = (text: string, end: number): number => {
		while (end > 0 && /\s/.test(text[end - 1] ?? '')) end--
		return end
	}

	const checkDeclaration = (node: CssTreeDeclaration, base: number): void => {
		const property = String(node.property)
		if (property.startsWith('--')) return
		const value = node.value as CssNode | undefined
		if (!value || value.type === 'Raw' || mentionsSubstitution(value)) return
		const match = lexer.matchDeclaration(node)
		if (match.matched !== null) return
		const message = String(match.error?.message ?? '')
		const unknown = message.startsWith('Unknown property')
		let echoed: string | undefined
		if (!unknown && value.loc) {
			echoed = source
				.slice(base + value.loc.start.offset, base + value.loc.end.offset)
				.trim()
			if (echoed.length > MAX_VALUE_ECHO)
				echoed = `${echoed.slice(0, MAX_VALUE_ECHO)}…`
		}
		errors.push({
			face: unknown ? 'unknown-property' : 'invalid-value',
			offset: base + (node.loc?.start.offset ?? 0),
			...(node.loc
				? { end: trimmedEnd(source, base + node.loc.end.offset) }
				: {}),
			property,
			...(echoed !== undefined ? { value: echoed } : {}),
			detail: unknown ? message : 'Mismatch',
		})
	}

	const visit = (node: CssNode, base: number, inDescriptors: boolean): void => {
		switch (node.type) {
			case 'Rule':
				if ((node as { block?: CssNode }).block)
					visit((node as { block: CssNode }).block, base, false)
				return
			case 'Atrule': {
				const block = (node as { block?: CssNode }).block
				if (block)
					visit(
						block,
						base,
						inDescriptors ||
							DESCRIPTOR_ATRULES.has(String(node.name).toLowerCase()),
					)
				return
			}
			case 'Declaration':
				if (!inDescriptors) checkDeclaration(node as CssTreeDeclaration, base)
				return
			case 'Raw': {
				const raw = String((node as { value?: unknown }).value ?? '')
				const rawStart = node.loc?.start.offset ?? 0
				for (const [from, to] of nestedBlockRegions(raw)) {
					try {
						const inner = parseDeclarationList(raw.slice(from, to), {
							positions: true,
							context: 'declarationList',
						})
						visit(inner, base + rawStart + from, inDescriptors)
					} catch {
						// A region css-tree cannot read gets no declaration check.
					}
				}
				return
			}
			default:
				for (const child of childrenOf(node)) visit(child, base, inDescriptors)
		}
	}
	visit(ast, 0, false)
	return errors
}

/* === Exported Functions === */

export const parseComponentSheet = (source: string): ParsedComponentSheet => {
	let captured: StyleSheet | undefined
	try {
		transform({
			code: new TextEncoder().encode(
				anchorRelativeSelectors(source, '&'),
			) as Buffer,
			filename: 'stylesheet.css',
			// Read-only: never return nodes into the parser (see module doc).
			visitor: {
				StyleSheet(sheet) {
					captured = sheet
				},
			},
		})
	} catch (error) {
		const err = error as {
			message: string
			loc?: { line: number; column: number }
		}
		const offset =
			err.loc?.line !== undefined && err.loc?.column !== undefined
				? lineColToOffset(source, err.loc.line, err.loc.column)
				: undefined
		return {
			sheet: null,
			errors: [
				{
					face: 'syntax',
					...(offset !== undefined ? { offset } : {}),
					detail: firstLine(err.message),
				},
			],
		}
	}
	if (!captured) return { sheet: null, errors: [] }
	return { sheet: captured, errors: grammarErrors(source) }
}

export const dedentCss = (source: string): string => {
	const lines = source.split('\n')
	const indents = lines
		.filter(line => line.trim().length > 0)
		.map(line => line.match(/^[ \t]*/)?.[0] ?? '')
	const common = indents.length
		? (indents.reduce((min, ind) => (ind.length < min.length ? ind : min)) ??
			'')
		: ''
	const stripped = lines.map(line =>
		line.startsWith(common) ? line.slice(common.length) : line.trimStart(),
	)
	// Trim fully-blank lines at both ends, keep interior structure verbatim
	while (stripped.length && stripped[0]?.trim() === '') stripped.shift()
	while (stripped.length && stripped.at(-1)?.trim() === '') stripped.pop()
	return stripped.length ? `${stripped.join('\n')}\n` : ''
}
