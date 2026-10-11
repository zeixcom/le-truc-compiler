/** `@zeix/le-truc-compiler/macros` — the compile-time markers an authored source imports: calls the compiler consumes and never runs, typed as stubs that throw when a source runs uncompiled. */

export type FieldParser<V> = (value: string | null | undefined) => V

/** The message a marker stub throws when its source ran uncompiled. */
const uncompiled = (name: string): Error =>
	new Error(
		`\`${name}\` ran in a source that was not compiled — it is a compile-time marker from \`@zeix/le-truc-compiler/macros\`, and only the compiler reads it. Load the component's generated module, not its authored source.`,
	)

/**
 * The CSS template tag: `<style>{css`…`}</style>` is the default spelling for a component's stylesheet.
 *
 * @throws {Error} Always — reached only when the source was not compiled.
 */
export const css = (
	_source: TemplateStringsArray,
	..._substitutions: never[]
): string => {
	throw uncompiled('css')
}

/**
 * The per-field parsers of a list seeded from server args.
 *
 * @param seed - The server-side seed, an array of items from server args
 * @param parsers - A parser per field, each typed against its field
 * @returns `seed`, on the server
 * @throws {Error} Always — reached only when the source was not compiled.
 */
export function harvest<T extends object>(
	seed: T[],
	parsers: { [K in keyof T]?: FieldParser<T[K]> },
): T[]
/**
 * The parser of a scalar signal seed.
 *
 * @param seed - The server-side seed, from server args
 * @param parser - The parser the client reads the render site through
 * @returns `seed`, on the server
 * @throws {Error} Always — reached only when the source was not compiled.
 */
export function harvest<T>(seed: T, parser: FieldParser<T>): T
export function harvest(_seed: unknown, _parsers: unknown): unknown {
	throw uncompiled('harvest')
}
