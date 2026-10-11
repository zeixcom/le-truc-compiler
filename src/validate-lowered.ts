/** The post-lowering validation tail, shared by both front ends: every check that needs the lowered `root`, `config`, or the extracted `expose()` argument. */

import {
	type AstNode,
	asArray,
	forEachFreeIdentifier,
	identifierName,
} from './ast-utils'
import { diagnostic } from './diagnostics'
import type { ExtractContext } from './extract-context'
import { reportDuplicatedChannels } from './first-refs'
import { reportMessageCallSites } from './i18n'
import type { MessageArg } from './icu/parse'
import type { ConfigIR, ForIR, TemplateNode } from './ir'
import type { SetupExtraction } from './setup-extraction'
import { wordingOf } from './surface'
import {
	MANAGED_FORM_MEMBERS,
	RESERVED_PROP_NAMES,
	SUBMITTABLE_FORM_CONTROL_TAGS,
} from './vocabulary'
import { childNodes, walkTemplate } from './walk'

/** Report a `name` (static or bound) on a descendant `input`/`select`/`textarea`/`button` inside a form-associated component's template: a named inner control submits the field twice (once via `setFormValue`, once natively), a server-side failure invisible in the browser. */
const reportNamedFormControls = (
	ctx: ExtractContext,
	root: TemplateNode,
): void => {
	walkTemplate(
		root,
		node => {
			if (
				node.kind !== 'element' ||
				!SUBMITTABLE_FORM_CONTROL_TAGS.has(node.tag)
			)
				return
			const nameAttr = node.attrs.find(
				a =>
					(a.kind === 'static' ||
						a.kind === 'server' ||
						a.kind === 'reactive') &&
					a.name === 'name',
			)
			if (nameAttr)
				ctx.diagnostics.push(
					diagnostic.formControlHasName(ctx.source, node.node, node.tag),
				)
		},
		{ intoCompose: false },
	)
}

/** Report a loop whose output is a direct root of an `if`/`switch` branch — the client addresses a branch by its roots, so only the loop's first item gets its handlers; a loop wrapped in an element is not this shape, and a loop's `@empty` arm is not a branch. */
const reportLoopsInBranches = (
	ctx: ExtractContext,
	root: TemplateNode,
	fors: ReadonlyMap<AstNode, ForIR>,
): void => {
	const outputs = new Set<TemplateNode>([...fors.values()].map(f => f.output))
	walkTemplate(root, (node, parent) => {
		if (outputs.has(node) && parent?.kind === 'conditional')
			ctx.diagnostics.push(
				diagnostic.loopInBranch(
					ctx.source,
					node.node,
					wordingOf(ctx),
					parent.construct,
				),
			)
	})
}

/** LTC081's placement rules for handler args: an arg may be read only as an event attribute's value on a raw element or a composed child's forwarded handler arg, and neither may sit inside a reactive arm or a reactive-list item (the parent's connect-time query would go stale) nor inside a server-data loop body. */
const reportHandlerArgPlacements = (
	ctx: ExtractContext,
	root: TemplateNode,
	componentFn: AstNode,
	fors: ReadonlyMap<AstNode, ForIR>,
): void => {
	if (ctx.handlerArgs.size === 0) return
	forEachFreeIdentifier(componentFn.body, id => {
		const arg = ctx.handlerArgs.get(String(id.name))
		if (arg && !ctx.handlerArgRefs.has(id))
			ctx.diagnostics.push(
				diagnostic.unaddressableHandlerArg(ctx.source, id, arg, {
					kind: 'read',
				}),
			)
	})
	const wording = wordingOf(ctx)
	const itemRoots = new Set<TemplateNode>(
		[...fors.values()].flatMap(loop =>
			loop.kind === 'reconcile' ? [loop.output] : [],
		),
	)
	const loopRoots = new Set<TemplateNode>(
		[...fors.values()].flatMap(loop =>
			loop.kind === 'each' ? [loop.output] : [],
		),
	)
	const inLoop = new Set<AstNode>()
	walkTemplate(
		root,
		node => {
			if (!loopRoots.has(node)) return
			walkTemplate(node, inner => {
				for (const { arg, at } of placementsOf(inner))
					if (!inLoop.has(at) && inLoop.add(at))
						ctx.diagnostics.push(
							diagnostic.unaddressableHandlerArg(ctx.source, at, arg, {
								kind: 'in-loop',
								loop: wording.loop,
							}),
						)
			})
		},
		{ intoCompose: false },
	)
	const lead = (phrase: string): string =>
		phrase.charAt(0).toLowerCase() + phrase.slice(1)
	const visit = (
		node: TemplateNode,
		scope: { where: string; scope: 'arm' | 'item' } | null,
	): void => {
		// An item root is inside its own item, its placements included.
		let inner = itemRoots.has(node)
			? {
					where: `a reactive-list ${wording.loop} item`,
					scope: 'item' as const,
				}
			: scope
		if (inner)
			for (const { arg, at } of placementsOf(node))
				ctx.diagnostics.push(
					diagnostic.unaddressableHandlerArg(ctx.source, at, arg, {
						kind: 'in-scope',
						...inner,
					}),
				)
		if (node.kind === 'conditional' && node.mode === 'reactive')
			inner = {
				where: `an arm of ${lead(wording.reactiveConditional)}`,
				scope: 'arm',
			}
		else if (node.kind === 'try' && node.pendingChildren !== null)
			inner = { where: `an arm of a ${wording.boundary}`, scope: 'arm' }
		for (const child of childNodes(node)) visit(child, inner)
	}
	visit(root, null)
}

/** The handler-arg placements a template node carries. */
const placementsOf = (
	node: TemplateNode,
): Array<{ arg: string; at: AstNode }> => {
	if (node.kind === 'element')
		return node.attrs.flatMap(attr =>
			attr.kind === 'handler-arg' ? [{ arg: attr.arg, at: attr.node }] : [],
		)
	if (node.kind === 'compose')
		return node.attrs.flatMap(attr =>
			attr.kind === 'handler' && attr.forward !== null
				? [{ arg: attr.forward, at: attr.handler }]
				: [],
		)
	return []
}

export const validateLoweredComponent = (
	ctx: ExtractContext,
	{
		root,
		config,
		i18nMessages,
		i18nArgs,
		componentFn,
		extraction,
		fors,
	}: {
		root: TemplateNode & { kind: 'element' }
		config: ConfigIR | null
		i18nMessages: Record<string, string> | null
		i18nArgs: Record<string, readonly MessageArg[]> | null
		componentFn: AstNode
		extraction: SetupExtraction
		fors: ReadonlyMap<AstNode, ForIR>
	},
): void => {
	const source = ctx.source
	const exposeArgNode = extraction.expose?.argNode ?? null

	reportDuplicatedChannels({
		root,
		source,
		diagnostics: ctx.diagnostics,
		argNames: ctx.argNames,
		parserProps: ctx.parserProps,
		parserFactoryOf: ctx.parserFactoryOf,
		parserFallbackRefsOf: ctx.parserFallbackRefsOf,
		formResetProp: config?.form
			? config.form === 'value'
				? 'value'
				: 'checked'
			: null,
	})

	if (i18nMessages)
		walkTemplate(root, node => {
			if (node.kind !== 'text' || !/[A-Za-z]{2}/.test(node.value)) return
			ctx.diagnostics.push(
				diagnostic.untranslatedLiteral(source, node.node, node.value),
			)
		})

	if (i18nArgs) reportMessageCallSites(ctx, componentFn, i18nArgs)

	if (config)
		for (const attr of config.observedAttributes) {
			if (!extraction.exposeProps.get(attr)?.parser)
				ctx.diagnostics.push(
					diagnostic.invalidConfig(
						source,
						undefined,
						`config.observedAttributes names \`${attr}\`, which is not a Parser-exposed prop — the extension would be inert. Declare it as expose({ ${attr}: asString(…) }).`,
					),
				)
		}

	if (exposeArgNode) {
		for (const prop of asArray(exposeArgNode.properties)) {
			if (prop.type !== 'Property') continue
			const propName = identifierName(prop.key)
			if (propName && RESERVED_PROP_NAMES.has(propName))
				ctx.diagnostics.push(
					diagnostic.reservedExposeName(source, prop, propName),
				)
		}
	}

	if (config?.form && exposeArgNode) {
		const defaultPropName =
			config.form === 'value' ? 'defaultValue' : 'defaultChecked'
		const extensionName =
			config.form === 'value' ? 'formAssociated' : 'formAssociatedCheckbox'
		for (const prop of asArray(exposeArgNode.properties)) {
			if (prop.type !== 'Property') continue
			const propName = identifierName(prop.key)
			if (
				propName &&
				(MANAGED_FORM_MEMBERS.has(propName) || propName === defaultPropName)
			)
				ctx.diagnostics.push(
					diagnostic.managedFormMemberShadowed(
						source,
						prop,
						propName,
						extensionName,
					),
				)
		}
	}

	if (config?.form) reportNamedFormControls(ctx, root)

	reportLoopsInBranches(ctx, root, fors)
	reportHandlerArgPlacements(ctx, root, componentFn, fors)
}
