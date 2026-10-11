import type { Message } from './evaluate'

/** JSON with object keys sorted, so two equal values serialize equal. */
const canonicalJson = (value: unknown): string =>
	JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
				)
			: v,
	)

/** The client keys whose form at the render locale differs from their source form. */
export const changedClientForms = (
	forms: Readonly<Record<string, string | Message | undefined>>,
	keys: readonly string[],
	source: Readonly<Record<string, unknown>>,
): Record<string, string | Message> => {
	const picked: Record<string, string | Message> = {}
	for (const key of keys) {
		const form = forms[key]
		if (
			form !== undefined &&
			canonicalJson(form) !== canonicalJson(source[key])
		)
			picked[key] = form
	}
	return picked
}
