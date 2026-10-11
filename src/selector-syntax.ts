import * as cssWhat from 'css-what'

/* === Internal Functions === */

const unquotedChars = (
	selector: string,
): Array<{ char: string; index: number; depth: number }> => {
	const chars: Array<{ char: string; index: number; depth: number }> = []
	let quote: string | null = null
	let depth = 0
	for (let i = 0; i < selector.length; i++) {
		const char = selector[i] as string
		if (char === '\\') {
			i++
			continue
		}
		if (quote) {
			if (char === quote) quote = null
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === ')') depth = Math.max(0, depth - 1)
		chars.push({ char, index: i, depth })
		if (char === '(') depth++
	}
	return chars
}

/** Whether a comma-separated group at paren depth 0 is empty. */
const hasEmptyTopLevelGroup = (selector: string): boolean => {
	let groupHasContent = false
	for (const { char, depth } of unquotedChars(selector)) {
		if (depth > 0) {
			groupHasContent = true
			continue
		}
		if (char === ',') {
			if (!groupHasContent) return true
			groupHasContent = false
		} else if (!/\s/.test(char)) groupHasContent = true
	}
	return !groupHasContent
}

/** Whether the last unquoted `[` has no unquoted `]` after it. */
const leavesBracketOpen = (selector: string): boolean => {
	let open = false
	for (const { char } of unquotedChars(selector)) {
		if (char === '[') open = true
		else if (char === ']') open = false
	}
	return open
}

/** The traversal entries a css-what branch spells combinators with. */
const TRAVERSALS = new Set([
	'descendant',
	'child',
	'adjacent',
	'sibling',
	'column-combinator',
])

const COMBINATOR_CHAR: Record<string, string> = {
	descendant: ' ',
	child: '>',
	adjacent: '+',
	sibling: '~',
	'column-combinator': '||',
}

const isTraversal = (simple: cssWhat.Selector): boolean =>
	TRAVERSALS.has(simple.type)

const successiveCombinatorChar = (selector: string): string => {
	let quote: string | null = null
	let prev = ''
	for (let i = 0; i < selector.length; i++) {
		const char = selector[i] as string
		if (quote) {
			if (char === '\\') i++
			else if (char === quote) quote = null
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			prev = ''
			continue
		}
		if (/[>+~]/.test(char) && /[>+~]/.test(prev)) return char
		if (!/\s/.test(char)) prev = char
	}
	return '>'
}

const throwReason = (selector: string, error: unknown): string | null => {
	const message = error instanceof Error ? error.message : String(error)
	if (message.startsWith('Empty sub-selector'))
		return hasEmptyTopLevelGroup(selector)
			? 'it has an empty selector between commas'
			: null
	if (message.startsWith('Attribute selector didn'))
		return leavesBracketOpen(selector) ? 'it leaves a `[` unclosed' : null
	if (message.startsWith('Attribute value didn'))
		return 'it has an unterminated quoted string'
	if (message.startsWith('Missing closing parenthesis'))
		return 'it leaves a `(` unclosed'
	if (message.startsWith('Parenthesis not matched'))
		return 'it leaves a `(` unclosed'
	if (message.startsWith('Did not expect successive traversals'))
		return `two combinators follow each other (\`${successiveCombinatorChar(selector)}\`)`
	const unmatched = message.match(/^Unmatched selector: (.+)$/)
	if (unmatched) {
		const char = (unmatched[1] as string)[0]
		if (char === ']') return 'it closes a `]` that was never opened'
		if (char === ')') return 'it closes a `)` that was never opened'
		if (char === '"' || char === "'")
			return 'it has an unterminated quoted string'
		if (char === '(') return 'it leaves a `(` unclosed'
	}
	if (message.startsWith('Expected name, found ')) {
		const found = message.slice('Expected name, found '.length)
		// End of input where a name was expected: an attribute selector left open (`button[`).
		if (found === '') return 'it leaves a `[` unclosed'
		return `\`${found[0]}\` is not followed by a name`
	}
	return null
}

/* === Exported Functions === */

export const malformedSelectorReason = (selector: string): string | null => {
	if (selector.trim() === '') return 'it is empty'
	// The nesting selector and comments: browser-valid, css-what-invalid.
	const unquoted = unquotedChars(selector)
	if (
		unquoted.some(
			({ char, index }) =>
				char === '&' || (char === '/' && selector[index + 1] === '*'),
		)
	)
		return null

	let branches
	try {
		branches = cssWhat.parse(selector)
	} catch (error) {
		return throwReason(selector, error)
	}

	for (const branch of branches) {
		const last = branch.at(-1)
		if (last && isTraversal(last)) return 'it ends with a combinator'
		const first = branch[0]
		if (first && isTraversal(first))
			return `the combinator \`${COMBINATOR_CHAR[first.type] ?? '?'}\` has no selector before it`
	}
	return null
}
