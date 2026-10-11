import { assembleComponentIR, readModuleDecls } from './assemble-ir'
import {
	type AstNode,
	asArray,
	collectBoundNames,
	identifierName,
	isNode,
} from './ast-utils'
import { diagnostic, type LocalDiagnostic } from './diagnostics'
import type { EmitPaths } from './emit-paths'
import type { ExtractContext } from './extract-context'
import { messageBindingsOf } from './i18n'
import {
	parseComposeImports,
	parseLeTrucImports,
	parseMarkerImports,
	parsePlainImports,
	reportUnclaimedMarkers,
	shadowMarkers,
} from './imports'
import type { ComponentIR, ForIR, SignalIR, TemplateNode } from './ir'
import { collectModuleTypes } from './list-item'
import {
	reportDeferredCollectorCalls,
	reportLeTrucImportMismatch,
	reportMalformedSelectors,
} from './module-scans'
import { extractParams } from './params'
import { extractSetup, seedExtractionContext } from './setup-extraction'
import { type Surface, wordingOf } from './surface'
import { resolveTemplateOutput, type StylesheetRead } from './template-output'
import type { LocalRoutingSignal } from './tier'
import { validateLoweredComponent } from './validate-lowered'

/* === Types === */

export type CompileResult = {
	component: ComponentIR | null
	diagnostics: LocalDiagnostic[]
	routingSignals: LocalRoutingSignal[]
}

/** What one surface's grammar decides; everything else is shared. */
export type SurfaceAdapter = {
	surface: Surface
	/** The component function's body node type (`JSXCodeBlock` / `BlockStatement`). */
	componentBodyType: string
	/** Grammar-specific module scans, run before the shared ones. */
	preScans?: (ctx: ExtractContext, ast: AstNode) => void
	splitSetupAndOutput: (
		ctx: ExtractContext,
		fn: AstNode,
		filename: string,
	) => { setup: AstNode[]; output: AstNode | undefined } | null
	stylesheetOf: (ctx: ExtractContext, node: AstNode) => StylesheetRead
	lowerElement: (
		ctx: ExtractContext,
		element: AstNode,
		signals: ReadonlyMap<string, SignalIR>,
		fors: Map<AstNode, ForIR>,
	) => TemplateNode & { kind: 'element' }
}

/* === Internal Functions === */

const componentScopeNames = (
	paramNames: ReadonlySet<string>,
	setup: readonly AstNode[],
): Set<string> => {
	const names = new Set(paramNames)
	for (const stmt of setup) {
		if (stmt.type === 'VariableDeclaration')
			for (const decl of asArray(stmt.declarations))
				collectBoundNames(decl.id, names)
		else if (
			stmt.type === 'FunctionDeclaration' ||
			stmt.type === 'ClassDeclaration'
		) {
			const id = identifierName(stmt.id)
			if (id) names.add(id)
		}
	}
	return names
}

/* === Exported Functions === */

export const runFrontEnd = (
	ctx: ExtractContext,
	ast: AstNode,
	filename: string,
	emitPaths: EmitPaths,
	adapter: SurfaceAdapter,
): CompileResult => {
	const wording = wordingOf(ctx)
	const done = (component: ComponentIR | null = null): CompileResult => ({
		component,
		diagnostics: ctx.diagnostics,
		routingSignals: ctx.routingSignals,
	})

	adapter.preScans?.(ctx, ast)
	reportMalformedSelectors(ctx, ast)
	ctx.composeImports = parseComposeImports(ast, filename)
	ctx.markers = parseMarkerImports(ast)
	const importedMarkers = ctx.markers
	ctx.moduleTypes = collectModuleTypes(ast)
	const plainImports = parsePlainImports(
		ctx,
		ast,
		filename,
		emitPaths.outDirPrefix,
	)
	const leTrucImports = parseLeTrucImports(ast)
	reportLeTrucImportMismatch(ctx, ast, leTrucImports)
	const importedNames = new Set<string>([
		...plainImports.flatMap(i => i.localNames),
		...leTrucImports.flatMap(i => i.names),
	])

	// Locate the single component function (by its body's node type).
	let fn: AstNode | null = null
	let fnStmtStart = 0
	for (const stmt of asArray(ast.body)) {
		const decl =
			stmt.type === 'ExportNamedDeclaration' && isNode(stmt.declaration)
				? stmt.declaration
				: stmt
		if (
			decl.type !== 'FunctionDeclaration' ||
			!isNode(decl.body) ||
			decl.body.type !== adapter.componentBodyType
		)
			continue
		if (fn) {
			ctx.diagnostics.push(
				diagnostic.invalidSource(
					ctx.source,
					stmt,
					`${filename}: multiple component functions per file are outside the sanctioned subset.`,
				),
			)
		} else {
			fn = decl
			fnStmtStart = typeof stmt.start === 'number' ? stmt.start : 0
		}
	}
	if (!fn) {
		ctx.diagnostics.push(
			diagnostic.invalidSource(
				ctx.source,
				undefined,
				`${filename}: ${wording.noComponent}`,
			),
		)
		return done()
	}

	if (fn.async === true) {
		const at = ctx.source.indexOf('async', fnStmtStart)
		ctx.diagnostics.push(
			diagnostic.invalidSource(
				ctx.source,
				at === -1 ? fn : { start: at, end: at + 'async'.length },
				`${filename}: the component function must not be \`async\` — setup runs synchronously on both halves (the server render function stringifies its result, and the client factory's effect collector is only active for the duration of the call). Await inside an event handler or a client-only setup statement instead.`,
			),
		)
		return done()
	}
	reportDeferredCollectorCalls(ctx, fn)

	const params = extractParams(ctx, filename, fn)
	if (!params) return done()

	const split = adapter.splitSetupAndOutput(ctx, fn, filename)
	if (!split) return done()
	shadowMarkers(ctx, componentScopeNames(params.paramNames, split.setup))
	const name = identifierName(fn.id) ?? 'Component'
	const decls = readModuleDecls(ctx, ast, name)
	const extraction = extractSetup(
		ctx,
		split.setup,
		params.paramsNode,
		params.paramNames,
		importedNames,
		{
			tNames: messageBindingsOf(params.paramsNode).tNames,
			declaredKeys: decls.i18nMessages ?? {},
		},
	)

	const output = split.output
	const bareRoot = output?.type === 'JSXElement' ? output : null
	if (!bareRoot) {
		if (output?.type === 'JSXFragment') {
			ctx.diagnostics.push(diagnostic.fragmentRoot(ctx.source, output))
		} else {
			ctx.diagnostics.push(
				diagnostic.invalidSource(
					ctx.source,
					output,
					`${filename}: ${wording.outputShape}`,
				),
			)
		}
		return done()
	}
	seedExtractionContext(ctx, { paramNames: params.paramNames, extraction })

	const fors = new Map<AstNode, ForIR>()
	const lowered: TemplateNode[] = [
		adapter.lowerElement(ctx, bareRoot, extraction.signalByName, fors),
	]
	const resolved = resolveTemplateOutput(
		ctx,
		filename,
		extraction,
		lowered,
		adapter.stylesheetOf,
		wording.outputLabel,
		fors,
	)
	if (!resolved) return done()

	// Every marker reference no consumer read is refused.
	reportUnclaimedMarkers(ctx, fn, importedMarkers)
	validateLoweredComponent(ctx, {
		root: resolved.root,
		config: decls.config,
		i18nMessages: decls.i18nMessages,
		i18nArgs: decls.i18nArgs,
		componentFn: fn,
		extraction,
		fors,
	})
	return done(
		assembleComponentIR(ctx, {
			componentName: name,
			fnStmtStart,
			paramsNode: params.paramsNode,
			paramNames: params.paramNames,
			contextParam: params.contextParam,
			extraction,
			resolved: { ...resolved, fors },
			decls,
			plainImports,
			leTrucImports,
		}),
	)
}
