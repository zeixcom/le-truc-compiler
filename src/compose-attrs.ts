import { attr } from './runtime'

export const composeHostAttrs = (
	markup: string,
	tag: string,
	attrs: Record<string, string | number | null | undefined>,
): string => {
	const openTag = `<${tag}`
	const followsTag = markup.charAt(openTag.length)
	const atRoot =
		markup.startsWith(openTag) &&
		(followsTag === '' || ' \t\n\r/>'.includes(followsTag))
	if (!atRoot)
		throw new Error(
			`composeHostAttrs: child markup for ${tag} does not start with its root open tag — compose-site class/id/data-* cannot be applied.`,
		)
	const tagClose = markup.indexOf('>')
	if (tagClose < 0)
		throw new Error(
			`composeHostAttrs: malformed child markup for ${tag} — no open-tag end.`,
		)
	let opening = markup.slice(0, tagClose)
	let extra = ''
	for (const [name, value] of Object.entries(attrs)) {
		if (value == null) continue
		if (name === 'class') {
			const merged = mergeClassToken(opening, String(value))
			if (merged != null) {
				opening = merged
				continue
			}
		}
		extra += attr(name, value)
	}
	return opening + extra + markup.slice(tagClose)
}

const mergeClassToken = (opening: string, token: string): string | null => {
	const marker = ' class="'
	const start = opening.indexOf(marker)
	if (start < 0) return null
	const valueStart = start + marker.length
	const valueEnd = opening.indexOf('"', valueStart)
	if (valueEnd < 0) return null
	const merged = `${opening.slice(valueStart, valueEnd)} ${token}`.trim()
	return (
		opening.slice(0, valueStart) +
		attr('class', merged) +
		opening.slice(valueEnd + 1)
	)
}
