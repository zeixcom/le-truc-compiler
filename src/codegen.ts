import {
	appendWithSpans,
	type SourceSlice,
	type SourceSpan,
	type SpanCursor,
} from './spans'

/* === Types === */

export type TemplatePart = { static: string } | { expr: string }

/* === Internal Functions === */

/** Plain printable ASCII without `'` or `\`: safe inside single quotes. */
const JS_PLAIN_STRING = /^[\x20-\x26\x28-\x5b\x5d-\x7e]*$/

/** Escape a static segment for use inside a generated template literal. */
const templateEscape = (s: string): string =>
	s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

/** Escape a static attribute value for a double-quoted HTML attribute. */
const escapeAttrValue = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')

/* === Exported Functions === */

export const jsString = (
	value: string,
	quote: 'single' | 'double' = 'single',
): string =>
	quote === 'single' && JS_PLAIN_STRING.test(value)
		? `'${value}'`
		: JSON.stringify(value)

export const jsTemplate = (parts: readonly TemplatePart[]): string => {
	if (parts.every(p => 'static' in p))
		return jsString(
			parts.map(p => (p as { static: string }).static).join(''),
			'double',
		)
	const body = parts
		.map(p => ('static' in p ? templateEscape(p.static) : `\${${p.expr}}`))
		.join('')
	return `\`${body}\``
}

/** A structured data literal (arrays, records) — JSON is valid JS. */
export const jsData = (value: unknown): string => JSON.stringify(value)

/** Whether `name` can be written as a bare identifier / dot member. */
export const isJsIdentifier = (name: string): boolean =>
	/^[A-Za-z_$][\w$]*$/.test(name)

export const dataArmsSelector = (armSet: string | number): string =>
	`:scope > template[data-arms="${armSet}"]`

/* === Classes === */

/** One markup push: static text plus expressions of type `E` — generated code for the SSG emitter, emission operations for a template target. */
export class HtmlWriter<E = string> {
	readonly #parts: Array<{ static: string } | { expr: E }> = []

	static(markup: string): this {
		const last = this.#parts.at(-1)
		if (last && 'static' in last) last.static += markup
		else this.#parts.push({ static: markup })
		return this
	}

	/** A static attribute: bare when `value` is null, else escaped. */
	attr(name: string, value: string | null): this {
		return this.static(
			value === null ? ` ${name}` : ` ${name}="${escapeAttrValue(value)}"`,
		)
	}

	/** A static attribute value fragment, HTML-escaped. */
	text(value: string): this {
		return this.static(escapeAttrValue(value))
	}

	/** An expression whose value is markup. */
	expr(expr: E): this {
		this.#parts.push({ expr })
		return this
	}

	/** The expressions, in order. */
	get exprs(): E[] {
		return this.#parts.flatMap(p => ('expr' in p ? [p.expr] : []))
	}

	/** Static text and expressions, in order. */
	get parts(): ReadonlyArray<{ static: string } | { expr: E }> {
		return this.#parts
	}

	/** The JS expression for this markup; meaningful only when `E` is code. */
	toString(): string {
		return jsTemplate(this.#parts as TemplatePart[])
	}
}

export class CodeBuilder {
	readonly lines: string[] = []
	readonly spans: SourceSpan[] = []
	readonly #cursor: SpanCursor = { offset: 0 }
	readonly #reindent: boolean
	depth: number

	constructor(options: { depth?: number; reindent?: boolean } = {}) {
		this.depth = options.depth ?? 0
		this.#reindent = options.reindent ?? false
	}

	/** Offset of `lines.join('\n')`'s next line: where the next write starts. */
	get offset(): number {
		return this.#cursor.offset
	}

	/** One statement at the current depth. */
	line(text: string, slices: readonly SourceSlice[] = []): this {
		if (this.#reindent || slices.length > 0)
			appendWithSpans(
				this.lines,
				text,
				this.depth,
				slices,
				this.spans,
				this.#cursor,
			)
		else this.#push(`${'\t'.repeat(this.depth)}${text}`)
		return this
	}

	/** A statement that opens a block; the block's body is one level deeper. */
	open(text: string, slices: readonly SourceSlice[] = []): this {
		this.line(text, slices)
		this.depth++
		return this
	}

	/** Close the current block with `text`, one level shallower. */
	close(text = '}'): this {
		this.depth--
		return this.line(text)
	}

	/** A line at the enclosing depth between two block bodies (`} else {`). */
	between(text: string): this {
		this.depth--
		this.line(text)
		this.depth++
		return this
	}

	/** An empty builder at this one's depth and mode, for deferred output. */
	fork(): CodeBuilder {
		return new CodeBuilder({ depth: this.depth, reindent: this.#reindent })
	}

	append(other: CodeBuilder | readonly string[]): this {
		const base = this.#cursor.offset
		if (other instanceof CodeBuilder)
			for (const span of other.spans)
				this.spans.push({ ...span, generatedStart: span.generatedStart + base })
		for (const line of other instanceof CodeBuilder ? other.lines : other)
			this.#push(line)
		return this
	}

	/** The block's text. */
	toString(): string {
		return this.lines.join('\n')
	}

	#push(line: string): void {
		this.lines.push(line)
		this.#cursor.offset += line.length + 1
	}
}
