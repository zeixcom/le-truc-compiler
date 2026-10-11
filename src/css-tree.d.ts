declare module 'css-tree/dist/csstree.esm' {
	/** A source position css-tree records with `positions: true`. */
	export type CssTreePosition = {
		/** 0-based offset within the parsed text. */
		offset: number
		/** 1-based line. */
		line: number
		/** 1-based column. */
		column: number
	}

	export type CssTreeLocation = {
		start: CssTreePosition
		end: CssTreePosition
	}

	export type CssNode = {
		type: string
		loc?: CssTreeLocation
		property?: string
		name?: string
		value?: CssNode
		block?: CssNode
		children?: Iterable<CssNode>
		[key: string]: unknown
	}

	/** A `Declaration` node (`property` plus a parsed or Raw `value`). */
	export type CssTreeDeclaration = CssNode & {
		property: string
		value?: CssNode
	}

	export type CssTreeParseOptions = {
		positions?: boolean
		context?:
			| 'stylesheet'
			| 'atrule'
			| 'atrulePrelude'
			| 'attributeSelector'
			| 'declaration'
			| 'declarationList'
			| 'selector'
			| 'value'
	}

	/** Parse CSS text into an AST (see css-tree's parse contexts). */
	export function parse(source: string, options?: CssTreeParseOptions): CssNode

	/** The spec-grammar lexer over the package's built-in dictionary. */
	export const lexer: {
		matchDeclaration(node: CssTreeDeclaration): {
			/** The matched AST, or null when the declaration mismatches. */
			matched: CssNode | null
			/** Why the match failed (null when matched). */
			error: { message: string } | null
		}
	}
}
