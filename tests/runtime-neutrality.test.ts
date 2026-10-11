/** Runtime-neutrality gate over `src/`: its sources are pure computation over strings — no `Bun` global, no `import.meta`, no built-in beyond the portable allowlist. The file-system seam's `node:` imports are a per-module carve-out; a new `node:` import anywhere else still fails, and widening the seam's list is a review-visible decision. The scan parses every non-test `.ts` and walks the AST, so static imports, re-exports, `import x = require(…)`, `require(…)` and dynamic `import(…)` are all seen whatever their formatting; a specifier must be a static string or name a module-level `const` bound to one. Browser loadability is NOT this gate's property. */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import * as path from 'node:path'
import { parse } from '@typescript-eslint/typescript-estree'
import {
	type AstNode,
	identifierName,
	isNode,
	walkNodes,
} from '../src/ast-utils'

const COMPILER_DIR = path.resolve(import.meta.dir, '../src')

/** The one built-in every compiler module may import. */
const ALLOWED_BUILTINS: ReadonlySet<string> = new Set(['node:path'])

/** The file-system seam's own built-ins: the corpus entry point's discovery and artifact writes live behind `fs.ts` and the catalog pipeline (`i18n-catalog.ts`), and only these modules may reach past `node:path`. Every member is a portable `node:` API — the neutrality this gate guards. */
const SEAM_MODULE_BUILTINS: Readonly<Record<string, readonly string[]>> = {
	'fs.ts': ['node:fs', 'node:fs/promises'],
	'i18n-catalog.ts': ['node:crypto'],
}

const BUILTINS: ReadonlySet<string> = new Set(builtinModules)

/* === Scanner === */

/** Module-level `const NAME = 'literal'` bindings. */
type Constants = ReadonlyMap<string, string>

/** A string literal or an expression-free template, else null. */
const staticString = (
	node: unknown,
	constants: Constants = new Map(),
): string | null => {
	if (!isNode(node)) return null
	if (node.type === 'Identifier')
		return constants.get(node.name as string) ?? null
	if (node.type === 'Literal' && typeof node.value === 'string')
		return node.value
	if (node.type === 'TemplateLiteral') {
		const quasis = node.quasis as AstNode[]
		const expressions = node.expressions as AstNode[]
		if (expressions.length === 0 && quasis.length === 1)
			return (
				(quasis[0]?.value as { cooked: string | null } | undefined)?.cooked ??
				null
			)
	}
	return null
}

/** Why `specifier` is not runtime-neutral, or null when it is. */
const specifierViolation = (
	specifier: string | null,
	file: string,
): string | null => {
	if (specifier === null) return 'non-static module specifier'
	if (ALLOWED_BUILTINS.has(specifier)) return null
	if (SEAM_MODULE_BUILTINS[file]?.includes(specifier)) return null
	if (
		specifier.startsWith('node:') ||
		specifier.startsWith('bun:') ||
		specifier === 'bun' ||
		BUILTINS.has(specifier)
	)
		return `built-in module '${specifier}'`
	return null
}

/** `Bun`, `globalThis.Bun`, `globalThis['Bun']`. */
const isBunGlobalMember = (node: AstNode): boolean =>
	node.type === 'MemberExpression' &&
	identifierName(node.object) === 'globalThis' &&
	(node.computed
		? staticString(node.property) === 'Bun'
		: identifierName(node.property) === 'Bun')

/**
 * Every runtime-neutrality violation in one module's source, as
 * `line: reason` strings in source order.
 */
const neutralityViolations = (source: string, filePath: string): string[] => {
	const program = parse(source, {
		filePath,
		jsx: filePath.endsWith('x'),
		range: true,
		loc: true,
	}) as unknown as AstNode
	const constants = new Map<string, string>()
	for (const statement of program.body as AstNode[]) {
		if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const')
			continue
		for (const declarator of statement.declarations as AstNode[]) {
			const name = identifierName(declarator.id)
			const value = staticString(declarator.init)
			if (name && value !== null) constants.set(name, value)
		}
	}
	const out: string[] = []
	const report = (node: AstNode, reason: string): void => {
		const line = (node.loc as { start: { line: number } }).start.line
		out.push(`${line}: ${reason}`)
	}
	const checkSpecifier = (node: AstNode, specifier: unknown): void => {
		const reason = specifierViolation(
			staticString(specifier, constants),
			filePath,
		)
		if (reason) report(node, reason)
	}
	// Identifiers that name a property or key rather than read a binding.
	const nonReads = new Set<AstNode>()
	walkNodes(program, node => {
		if (nonReads.has(node)) return
		switch (node.type) {
			case 'ImportDeclaration':
			case 'ExportAllDeclaration':
			case 'ExportNamedDeclaration':
				if (node.source) checkSpecifier(node, node.source)
				break
			case 'ImportExpression':
				checkSpecifier(node, node.source)
				break
			case 'TSExternalModuleReference':
				checkSpecifier(node, node.expression)
				break
			case 'CallExpression':
				if (identifierName(node.callee) === 'require')
					checkSpecifier(node, (node.arguments as AstNode[])[0])
				break
			case 'MetaProperty':
				if (
					identifierName(node.meta) === 'import' &&
					identifierName(node.property) === 'meta'
				)
					report(node, '`import.meta`')
				break
			case 'MemberExpression':
				if (isBunGlobalMember(node)) report(node, '`Bun` global')
				if (!node.computed && isNode(node.property)) nonReads.add(node.property)
				break
			case 'Property':
			case 'PropertyDefinition':
			case 'MethodDefinition':
			case 'TSPropertySignature':
				if (!node.computed && isNode(node.key)) nonReads.add(node.key)
				break
			case 'Identifier':
				if (node.name === 'Bun') report(node, '`Bun` global')
				break
		}
	})
	return out
}

/** Every non-test `.ts` source under `server/compiler/`, repo-relative paths. */
const compilerSources = (): string[] =>
	readdirSync(COMPILER_DIR, { recursive: true, encoding: 'utf8' })
		.filter(file => file.endsWith('.ts') && !/\.test\.ts$/.test(file))
		.sort()

/* === Tests === */

describe('runtime-neutrality scanner', () => {
	const scan = (source: string) => neutralityViolations(source, 'fixture.ts')

	test('flags a `Bun` global read', () => {
		expect(scan("const f = Bun.file('x')")).toEqual(['1: `Bun` global'])
		expect(scan("globalThis.Bun.file('x')")).toEqual(['1: `Bun` global'])
		expect(scan("globalThis['Bun']")).toEqual(['1: `Bun` global'])
	})

	test('a property or key named `Bun` is not a global read', () => {
		expect(scan('const o = { Bun: 1 }; o.Bun')).toEqual([])
	})

	test('flags `import.meta`', () => {
		expect(scan('const dir = import.meta.dir')).toEqual(['1: `import.meta`'])
		expect(scan("new URL('.', import.meta.url)")).toEqual(['1: `import.meta`'])
	})

	test('flags a static `node:` import and re-export', () => {
		expect(scan("import * as fs from 'node:fs'")).toEqual([
			"1: built-in module 'node:fs'",
		])
		expect(scan("export { tmpdir } from 'node:os'")).toEqual([
			"1: built-in module 'node:os'",
		])
	})

	test('flags `require(…)` and `import x = require(…)`', () => {
		expect(scan("const os = require('node:os')")).toEqual([
			"1: built-in module 'node:os'",
		])
		expect(scan("import os = require('node:os')")).toEqual([
			"1: built-in module 'node:os'",
		])
	})

	test('flags a dynamic `import(…)`, template-literal specifiers included', () => {
		expect(scan("await import('node:child_process')")).toEqual([
			"1: built-in module 'node:child_process'",
		])
		expect(scan('await import(`node:child_process`)')).toEqual([
			"1: built-in module 'node:child_process'",
		])
	})

	test('flags bare built-ins and Bun modules', () => {
		expect(scan("import fs from 'fs'")).toEqual(["1: built-in module 'fs'"])
		expect(scan("import { test } from 'bun:test'")).toEqual([
			"1: built-in module 'bun:test'",
		])
	})

	test('flags a non-static specifier', () => {
		expect(scan('await import(name)')).toEqual([
			'1: non-static module specifier',
		])
		expect(scan('require(name)')).toEqual(['1: non-static module specifier'])
		expect(scan("let name = './x'\nawait import(name)")).toEqual([
			'2: non-static module specifier',
		])
	})

	test('resolves a module-level `const` specifier', () => {
		expect(scan("const D = './driver.ts'\nawait import(D)")).toEqual([])
		expect(scan("const D = 'node:fs'\nawait import(D)")).toEqual([
			"2: built-in module 'node:fs'",
		])
	})

	test('allows `node:path` and third-party packages', () => {
		expect(
			scan(
				"import { resolve } from 'node:path'\nimport { KEYS } from 'eslint-visitor-keys'\nimport type { X } from './x'",
			),
		).toEqual([])
	})
})

describe('src/ is runtime-neutral (ADR 0016 s2)', () => {
	const sources = compilerSources()

	test('the scan reaches both front ends and the shared machinery', () => {
		expect(sources).toContain('pipeline.ts')
		expect(sources).toContain('frontend/tsrx/index.ts')
		expect(sources).toContain('frontend/tsx/to-estree.ts')
	})

	test.each(sources)('%s', file => {
		const source = readFileSync(path.join(COMPILER_DIR, file), 'utf8')
		expect(neutralityViolations(source, file)).toEqual([])
	})
})
