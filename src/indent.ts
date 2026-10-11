/** Template-literal-safe line classification for verbatim-slice reindentation. */

/* === Internal Functions === */
type Mode =
	| 'code'
	| 'lineComment'
	| 'blockComment'
	| 'single'
	| 'double'
	| 'template'

/* === Exported Functions === */

export const lineStartsInTemplate = (lines: string[]): boolean[] => {
	const mask: boolean[] = new Array(lines.length).fill(false)
	let mode: Mode = 'code'
	// Brace depth inside each open `${ … }`, innermost last. Non-empty means we are inside template interpolation(s).
	const interpDepths: number[] = []
	let templateDepth = 0
	let escaped = false

	for (let i = 0; i < lines.length; i++) {
		mask[i] = templateDepth > 0
		const line = lines[i] as string
		for (let j = 0; j < line.length; j++) {
			const ch = line[j] as string
			const next = j + 1 < line.length ? (line[j + 1] as string) : ''

			if (escaped) {
				escaped = false
				continue
			}

			switch (mode) {
				case 'lineComment':
					j = line.length
					continue
				case 'blockComment':
					if (ch === '*' && next === '/') {
						mode = 'code'
						j++
					}
					continue
				case 'single':
				case 'double':
					if (ch === '\\') escaped = true
					else if (
						(mode === 'single' && ch === "'") ||
						(mode === 'double' && ch === '"')
					)
						mode = 'code'
					continue
				case 'template':
					if (ch === '\\') escaped = true
					else if (ch === '`') {
						templateDepth--
						mode = 'code'
					} else if (ch === '$' && next === '{') {
						interpDepths.push(0)
						mode = 'code'
						j++
					}
					continue
				case 'code':
					if (ch === '/' && next === '/') {
						mode = 'lineComment'
						j = line.length
					} else if (ch === '/' && next === '*') {
						mode = 'blockComment'
						j++
					} else if (ch === "'") mode = 'single'
					else if (ch === '"') mode = 'double'
					else if (ch === '`') {
						templateDepth++
						mode = 'template'
					} else if (ch === '{' && interpDepths.length > 0) {
						const depth = interpDepths.pop() as number
						interpDepths.push(depth + 1)
					} else if (ch === '}' && interpDepths.length > 0) {
						const depth = interpDepths.pop() as number
						if (depth === 0) {
							// Closes the innermost `${ … }` — back into its literal.
							mode = 'template'
						} else interpDepths.push(depth - 1)
					}
					continue
			}
		}

		// A line comment never survives the newline; strings and templates do.
		if (mode === 'lineComment') mode = 'code'
	}

	return mask
}

export const commonIndent = (
	lines: readonly string[],
	mask: readonly boolean[],
	options: { skipFirst?: boolean; skipDocContinuations?: boolean } = {},
): string => {
	let common: string | null = null
	for (let i = options.skipFirst ? 1 : 0; i < lines.length; i++) {
		const line = lines[i] as string
		if (line.trim().length === 0 || mask[i]) continue
		if (options.skipDocContinuations && line.trimStart().startsWith('*'))
			continue
		const indent = line.match(/^[ \t]*/)?.[0] ?? ''
		if (common === null || indent.length < common.length) common = indent
	}
	return common ?? ''
}
