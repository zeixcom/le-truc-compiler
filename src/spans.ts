import { commonIndent, lineStartsInTemplate } from './indent'

/* === Types === */

/** One mapped range: `length` characters are byte-identical in both files. */
export type SourceSpan = {
	/** Character offset in the generated module. */
	generatedStart: number
	/** Character offset in the `.tsrx` source. */
	sourceStart: number
	length: number
}

/** A verbatim slice of `.tsrx` source embedded somewhere in a generated statement. */
export type SourceSlice = { text: string; start: number }

/** Running character offset into the generated lines built so far. */
export type SpanCursor = { offset: number }

/* === Internal Functions === */

/** Character offset where each line of `text` begins. */
const lineStarts = (text: string): number[] => {
	const starts = [0]
	for (let i = 0; i < text.length; i++)
		if (text.charCodeAt(i) === 10) starts.push(i + 1)
	return starts
}

/** `offset` within `text` (whose line-start table is `starts`) → {line, col}, 0-based. */
const offsetToLineCol = (
	starts: number[],
	offset: number,
): { line: number; col: number } => {
	let line = 0
	for (let i = 0; i < starts.length; i++) {
		if ((starts[i] as number) > offset) break
		line = i
	}
	return { line, col: offset - (starts[line] as number) }
}

/* === Exported Functions === */

export const reindent = (slice: string, level: number): string => {
	const lines = slice.split('\n')
	const mask = lineStartsInTemplate(lines)
	const common = commonIndent(lines, mask, { skipDocContinuations: true })
	const prefix = '\t'.repeat(level)
	return lines
		.map((line, i) => {
			if (mask[i]) return line
			if (line.trim().length === 0) return ''
			return (
				prefix + (line.startsWith(common) ? line.slice(common.length) : line)
			)
		})
		.join('\n')
}

export const appendWithSpans = (
	lines: string[],
	text: string,
	depth: number,
	slices: readonly SourceSlice[],
	spans: SourceSpan[],
	cursor: SpanCursor,
): void => {
	const statementLines = text.split('\n')
	const mask = lineStartsInTemplate(statementLines)
	const common = commonIndent(statementLines, mask, { skipFirst: true })
	const prefix = '\t'.repeat(depth)

	const strippedOf: number[] = []
	const addedOf: string[] = []
	const outLines: string[] = []
	for (let i = 0; i < statementLines.length; i++) {
		const line = statementLines[i] as string
		if (i === 0) {
			strippedOf.push(0)
			addedOf.push(prefix)
			outLines.push(`${prefix}${line}`)
			continue
		}
		if (mask[i]) {
			strippedOf.push(0)
			addedOf.push('')
			outLines.push(line)
			continue
		}
		if (line.trim().length === 0) {
			strippedOf.push(line.length)
			addedOf.push('')
			outLines.push('')
			continue
		}
		const strip = line.startsWith(common)
			? common.length
			: line.length - line.trimStart().length
		strippedOf.push(strip)
		addedOf.push(prefix)
		outLines.push(`${prefix}${line.slice(strip)}`)
	}

	const genLineStart: number[] = []
	let running = cursor.offset
	for (const out of outLines) {
		genLineStart.push(running)
		running += out.length + 1
	}

	const srcStarts = lineStarts(text)
	let searchFrom = 0
	for (const slice of slices) {
		if (!slice.text) continue
		const idx = text.indexOf(slice.text, searchFrom)
		if (idx === -1) continue
		searchFrom = idx + slice.text.length
		const from = offsetToLineCol(srcStarts, idx)
		const to = offsetToLineCol(srcStarts, idx + slice.text.length)
		for (let li = from.line; li <= to.line; li++) {
			const lineText = statementLines[li] as string
			const colStart = li === from.line ? from.col : 0
			const colEnd = li === to.line ? to.col : lineText.length
			const stripped = strippedOf[li] as number
			if (colEnd <= stripped) continue
			const clippedStart = Math.max(colStart, stripped)
			const length = colEnd - clippedStart
			if (length <= 0) continue
			const genCol = (addedOf[li] as string).length + (clippedStart - stripped)
			const sliceOffset =
				(li === from.line ? 0 : (srcStarts[li] as number) - idx) +
				(clippedStart - colStart)
			spans.push({
				generatedStart: (genLineStart[li] as number) + genCol,
				sourceStart: slice.start + sliceOffset,
				length,
			})
		}
	}

	for (const out of outLines) lines.push(out)
	cursor.offset = running
}

/** 1-based {line, col} in `text` for a 0-based character `offset`. */
export const fileOffsetToLineCol = (
	text: string,
	offset: number,
): { line: number; col: number } => {
	const starts = lineStarts(text)
	const { line, col } = offsetToLineCol(starts, offset)
	return { line: line + 1, col: col + 1 }
}

/** 0-based character offset in `text` for a 1-based {line, col}. */
export const fileLineColToOffset = (
	text: string,
	line: number,
	col: number,
): number => {
	const starts = lineStarts(text)
	const lineStart = (starts[line - 1] as number | undefined) ?? text.length
	return lineStart + (col - 1)
}

export const findSpanForGeneratedOffset = (
	spans: readonly SourceSpan[],
	offset: number,
): SourceSpan | null => {
	let best: SourceSpan | null = null
	for (const span of spans) {
		if (span.generatedStart > offset) continue
		if (!best || span.generatedStart > best.generatedStart) best = span
	}
	return best
}
