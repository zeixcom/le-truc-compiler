/* === Types === */

/** How a target escapes a hole; every target switches exhaustively over the union. */
export type EscapeContext =
	| 'text'
	| 'quoted-attribute'
	| 'url-attribute'
	| 'boolean-attribute'
	| 'class-token'
	| 'style-value'
	| 'html'
	| 'composed-markup'

/** A value folded at build: `undefined` stays distinct from `null`. */
export type PortableValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly PortableValue[]
	| { readonly [key: string]: PortableValue }

export type ComparisonOperator = '===' | '!==' | '<' | '<=' | '>' | '>='

export type LogicalOperator = '&&' | '||' | '??'

/** One message call: the already-localized ICU pattern and its argument record. */
export type MessageCall = {
	pattern: string
	args: Readonly<Record<string, PortableExpr>>
}

/** An expression in the portable subset, with JavaScript semantics. */
export type PortableExpr =
	| { kind: 'literal'; value: PortableValue }
	/** A server arg; `fallback` applies when the arg is `undefined`, as a destructuring default does. */
	| { kind: 'arg'; name: string; fallback?: PortableExpr }
	/** A loop binding: the item or the index. */
	| { kind: 'item'; name: string }
	| { kind: 'member'; object: PortableExpr; property: string }
	| { kind: 'not'; operand: PortableExpr }
	| {
			kind: 'compare'
			operator: ComparisonOperator
			left: PortableExpr
			right: PortableExpr
	  }
	| {
			kind: 'logical'
			operator: LogicalOperator
			left: PortableExpr
			right: PortableExpr
	  }
	| {
			kind: 'conditional'
			test: PortableExpr
			consequent: PortableExpr
			alternate: PortableExpr
	  }
	| { kind: 'message'; message: MessageCall }

/** One piece of a segment list: literal text, or a hole converted to a string. */
export type Segment =
	| { kind: 'literal'; text: string }
	| { kind: 'hole'; value: PortableExpr }

/** A value position that also admits a template literal's segment list. */
export type HoleValue = PortableExpr | { kind: 'segments'; segments: Segment[] }

/** One arg or host attribute an include passes. */
export type IncludeArg = { name: string; value: HoleValue }

/**
 * One emission operation. An `attribute` names the attribute a hole renders:
 * `true` renders it bare, `false`/`null`/`undefined` omit it, anything else
 * renders its escaped string. Without one, the hole renders in content.
 */
export type TemplateOp =
	/** Markup the walk has already escaped. */
	| { op: 'text'; markup: string }
	| {
			op: 'hole'
			context: EscapeContext
			attribute?: string
			value: PortableExpr
	  }
	| {
			op: 'segments'
			context: EscapeContext
			attribute?: string
			segments: Segment[]
	  }
	| {
			op: 'message'
			context: EscapeContext
			attribute?: string
			message: MessageCall
	  }
	/** The first branch whose test is truthy renders, else `otherwise`. */
	| {
			op: 'conditional'
			branches: Array<{ test: PortableExpr; body: TemplateOp[] }>
			otherwise: TemplateOp[]
	  }
	/** `empty` renders when the source yields no item. */
	| {
			op: 'loop'
			source: PortableExpr
			item: string
			index: string | null
			body: TemplateOp[]
			empty: TemplateOp[]
	  }
	/** Another component's partial at `locale`, closed over `args`; `hostAttributes` land on its root. */
	| {
			op: 'include'
			tag: string
			locale: string
			args: IncludeArg[]
			hostAttributes: IncludeArg[]
	  }
	/** One inert `<template data-arms data-key>` arm. */
	| { op: 'arm-template'; armSet: string; key: string; body: TemplateOp[] }
	/** The async boundary over a three-state result arg. */
	| {
			op: 'boundary'
			armSet: string
			result: PortableExpr
			errorName: string | null
			ok: TemplateOp[]
			nil: TemplateOp[]
			err: TemplateOp[]
	  }
	/** A reactive list's inert item shape, stamped `data-list`. */
	| { op: 'list-template'; index: number; body: TemplateOp[] }

/** One component's partial at one locale. */
export type TemplatePartial = {
	tag: string
	locale: string
	/** The formatting configuration message calls run under. */
	timeZone: string
	currency: string
	ops: TemplateOp[]
}

/** A template target: syntax only — every decision is the walk's. */
export type TemplateTarget = {
	name: string
	/** The host helpers the target's output calls, which an integrator registers. */
	helpers: readonly string[]
	fileName: (tag: string, locale: string) => string
	emit: (partial: TemplatePartial) => string
}
