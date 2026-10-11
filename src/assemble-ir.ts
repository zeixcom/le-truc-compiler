import type { AstNode } from './ast-utils'
import {
	asArray,
	collectBoundNames,
	identifierName,
	isNode,
	text,
} from './ast-utils'
import { readConfig } from './config'
import { diagnostic } from './diagnostics'
import { foldableHostProps, initializerHostReads } from './evaluability'
import type { ExtractContext } from './extract-context'
import {
	declaresI18nOf,
	langArgDefaultOf,
	langBindingOf,
	messageBindingsOf,
	readI18nDecl,
} from './i18n'
import type { MessageArg } from './icu/parse'
import {
	type LeTrucImport,
	type PlainImportIR,
	placeLeTrucImports,
	placePlainImports,
} from './imports'
import {
	isOptionalBinding,
	typeAnnotationForBinding,
	typeOfAnnotation,
} from './infer-type'
import { resolveInitialWinners } from './initial-winner'
import type { ComponentIR, ComponentParam, ConfigIR, ForIR } from './ir'
import type { ComponentParams } from './params'
import { onServer, type SetupExtraction } from './setup-extraction'
import type { ResolvedTemplate } from './template-output'
import { rangeFields, resolutionOf } from './tier'

/** Module-level declarations beside the component function. */
export type ModuleDecls = {
	typeDecls: string[]
	globalDecl: string | null
	propsTypeName: string | null
	config: ConfigIR | null
	i18nMessages: Record<string, string> | null
	/** Per key, the arguments its source pattern takes (`I18nDecl.args`). */
	i18nArgs: Record<string, readonly MessageArg[]> | null
	/** Module-level value names (`ComponentIR.moduleBindings`). */
	moduleBindings: string[]
}

export const readModuleDecls = (
	ctx: ExtractContext,
	ast: AstNode,
	componentName: string,
): ModuleDecls => {
	const typeDecls: string[] = []
	let globalDecl: string | null = null
	let propsTypeName: string | null = null
	let config: ConfigIR | null = null
	let i18nMessages: Record<string, string> | null = null
	let i18nArgs: Record<string, readonly MessageArg[]> | null = null
	const moduleBindings = new Set<string>()
	for (const stmt of asArray(ast.body)) {
		const valueDecl =
			stmt.type === 'ExportNamedDeclaration' && isNode(stmt.declaration)
				? stmt.declaration
				: stmt
		if (valueDecl.type === 'VariableDeclaration')
			for (const d of asArray(valueDecl.declarations))
				collectBoundNames(d.id, moduleBindings)
		else if (
			valueDecl.type === 'FunctionDeclaration' ||
			valueDecl.type === 'ClassDeclaration'
		) {
			const declName = identifierName(valueDecl.id)
			if (declName && declName !== componentName) moduleBindings.add(declName)
		}
		const declaredConfig = readConfig(ctx, stmt)
		if (declaredConfig) {
			config = declaredConfig
			continue
		}
		const declaredI18n = readI18nDecl(ctx, stmt)
		if (declaredI18n) {
			i18nMessages = declaredI18n.messages
			i18nArgs = declaredI18n.args
			continue
		}
		// Exported or not: a module-local `type`/`interface` is as much a
		// part of the setup's typing as an exported one, and a generated
		// module that drops it names a type it never declares.
		if (
			valueDecl.type === 'TSTypeAliasDeclaration' ||
			valueDecl.type === 'TSInterfaceDeclaration'
		) {
			typeDecls.push(text(ctx.source, stmt))
			const declName = identifierName(valueDecl.id)
			if (stmt !== valueDecl && declName === `${componentName}Props`)
				propsTypeName = declName
		}
		if (stmt.type === 'TSModuleDeclaration' && String(stmt.kind) === 'global')
			globalDecl = text(ctx.source, stmt)
	}
	return {
		typeDecls,
		globalDecl,
		propsTypeName,
		config,
		i18nMessages,
		i18nArgs,
		moduleBindings: [...moduleBindings],
	}
}

const leadingDocComment = (source: string, before: number): string | null => {
	const head = source.slice(0, before)
	const close = head.lastIndexOf('*/')
	if (close === -1) return null
	const open = head.lastIndexOf('/**', close)
	if (open === -1) return null
	if (head.slice(close + 2).trim() !== '') return null
	return source.slice(open, close + 2)
}

const paramPropsOf = (
	ctx: ExtractContext,
	paramsNode: AstNode | null,
): ComponentParam[] => {
	if (!paramsNode || paramsNode.type !== 'ObjectPattern') return []
	const props: ComponentParam[] = []
	for (const prop of asArray(paramsNode.properties)) {
		if (prop.type !== 'Property') continue
		const name = identifierName(prop.key)
		if (!name || !isNode(prop.value)) continue
		const value = prop.value
		const annotation = typeAnnotationForBinding(paramsNode, name)
		const annotationText = annotation
			? text(
					ctx.source,
					annotation.type === 'TSTypeAnnotation' &&
						isNode(annotation.typeAnnotation)
						? (annotation.typeAnnotation as AstNode)
						: annotation,
				)
			: 'unknown'
		props.push({
			name,
			typeText: annotationText,
			optional: isOptionalBinding(paramsNode, name),
			hasDefault: value.type === 'AssignmentPattern',
			isString: annotation ? typeOfAnnotation(annotation) === 'string' : false,
			isNumber: annotation ? typeOfAnnotation(annotation) === 'number' : false,
		})
	}
	return props
}

export const assembleComponentIR = (
	ctx: ExtractContext,
	{
		componentName,
		fnStmtStart,
		paramsNode,
		paramNames,
		contextParam,
		extraction,
		resolved,
		decls,
		plainImports,
		leTrucImports,
	}: {
		componentName: string
		fnStmtStart: number
		paramsNode: AstNode | null
		paramNames: ReadonlySet<string>
		contextParam: ComponentParams['contextParam']
		extraction: SetupExtraction
		resolved: ResolvedTemplate & { fors: Map<AstNode, ForIR> }
		decls: ModuleDecls
		plainImports: PlainImportIR[]
		leTrucImports: LeTrucImport[]
	},
): ComponentIR | null => {
	if (contextParam?.annotationName) {
		const formAssociated = !!decls.config?.form
		if (formAssociated && contextParam.annotationName === 'FactoryContext')
			ctx.diagnostics.push(
				diagnostic.formContextMismatch(
					ctx.source,
					contextParam.annotation,
					'FactoryContext',
				),
			)
		else if (
			!formAssociated &&
			contextParam.annotationName === 'FormFactoryContext'
		)
			ctx.diagnostics.push(
				diagnostic.formContextMismatch(
					ctx.source,
					contextParam.annotation,
					'FormFactoryContext',
				),
			)
	}
	const serverKnown = ctx.serverKnown
	const itemSetup = [...resolved.fors.values()].flatMap(loop =>
		loop.kind === 'reconcile' ? loop.setup : [],
	)

	const listItemTypeTexts = extraction.signals.flatMap(signal =>
		signal.family === 'declared' && signal.listItem?.typeText
			? [signal.listItem.typeText]
			: [],
	)
	const plainPlacement = placePlainImports(
		ctx,
		{
			root: resolved.root,
			setup: extraction.setup,
			plainSetup: extraction.plainSetup,
			clientSetup: extraction.clientSetup,
			signals: extraction.signals,
			itemSetup,
			serverKnown,
		},
		plainImports,
		{
			server: [
				...decls.typeDecls,
				paramsNode ? text(ctx.source, paramsNode) : '',
				...extraction.setup.map(stmt => stmt.text),
			],
			client: [
				...decls.typeDecls,
				...(decls.globalDecl ? [decls.globalDecl] : []),
				...extraction.setup.map(stmt => stmt.text),
				...listItemTypeTexts,
			],
		},
	)
	const leTrucPlacement = placeLeTrucImports(
		ctx,
		{
			root: resolved.root,
			setup: extraction.setup,
			plainSetup: extraction.plainSetup,
			clientSetup: extraction.clientSetup,
			signals: extraction.signals,
			itemSetup,
			serverKnown,
		},
		leTrucImports,
		{
			server: [
				...decls.typeDecls,
				...extraction.setup.map(stmt => stmt.text),
				...itemSetup.filter(onServer).map(stmt => stmt.text),
			],
			client: [
				...decls.typeDecls,
				...(decls.globalDecl ? [decls.globalDecl] : []),
				...extraction.setup.map(stmt => stmt.text),
				...itemSetup.map(stmt => stmt.text),
				...listItemTypeTexts,
			],
		},
	)
	const imports = {
		server: [...plainPlacement.server, ...leTrucPlacement.server],
		client: [...plainPlacement.client, ...leTrucPlacement.client],
		serverLocalNames: new Set([
			...plainPlacement.serverLocalNames,
			...leTrucPlacement.serverNames,
		]),
		clientLeTrucNames: leTrucPlacement.clientNames,
		plainLocalNames: new Set(plainImports.flatMap(i => i.localNames)),
	}

	const gated = ctx.diagnostics.some(d => d.code === 'LTC001')
	if (gated) return null

	const component: ComponentIR = {
		name: componentName,
		source: ctx.source,
		surface: ctx.surface,
		tag: resolved.root.tag,
		paramsText: paramsNode ? text(ctx.source, paramsNode) : '',
		paramNames: [...paramNames],
		moduleBindings: decls.moduleBindings,
		messageTBindings: [...messageBindingsOf(paramsNode).tNames],
		handlerArgs: ctx.handlerArgs,
		messageRecordBindings: [...messageBindingsOf(paramsNode).recordNames],
		paramProps: paramPropsOf(ctx, paramsNode),
		i18nMessages: decls.i18nMessages,
		i18nArgs: decls.i18nArgs,
		declaresI18n: declaresI18nOf(paramsNode),
		langBinding: langBindingOf(paramsNode),
		langArgDefault: langArgDefaultOf(paramsNode),
		setup: extraction.setup,
		clientSetup: extraction.clientSetup,
		plainSetup: extraction.plainSetup,
		itemSetup,
		signals: extraction.signals,
		expose: extraction.expose,
		exposeProps: extraction.exposeProps,
		contextRefs: [...extraction.contextRefs].sort(),
		config: decls.config,
		root: resolved.root,
		firstRefs: resolved.firstRefs,
		...(ctx.childrenContract ? { childrenContract: ctx.childrenContract } : {}),
		fors: resolved.fors,
		css: resolved.css,
		sheetText: resolved.sheetText,
		sheet: resolved.sheet,
		typeDecls: decls.typeDecls,
		globalDecl: decls.globalDecl,
		propsTypeName: decls.propsTypeName,
		componentDoc: leadingDocComment(ctx.source, fnStmtStart),
		serverKnown,
		imports,
	}
	routeHostSeededSignals(ctx, component)
	resolveInitialWinners(component)
	return component
}

const routeHostSeededSignals = (
	ctx: ExtractContext,
	component: ComponentIR,
): void => {
	const foldable = foldableHostProps(component)
	const unresolved = component.signals.flatMap(signal => {
		if (signal.family !== 'declared') return []
		const stmt = component.setup.find(s => s.name === signal.name)
		if (!stmt || initializerHostReads(stmt.node, foldable) !== null) return []
		return [{ signal, stmt }]
	})
	for (const { signal, stmt } of unresolved) {
		signal.unresolvable = true
		ctx.serverKnown.delete(signal.name)
		ctx.routingSignals.push({
			origin: 'LTC013',
			detail: `\`${signal.name}\`'s ${signal.constructor}() initializer reads host with no server value`,
			...rangeFields(ctx.source, stmt.node),
			resolution: resolutionOf(stmt.node, ctx.serverKnown),
		})
	}
}
