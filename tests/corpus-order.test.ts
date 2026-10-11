/** Corpus compile-order invariance: `compileCorpus` discovers tags in a first pass that grows the registry as it visits files, so a pass target whose file comes later only becomes registry-known once visited. These tests pin that the compiled tag set is independent of the input file order. */
import { afterAll, describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { compileCorpus } from './corpus-compile'
import { loadCorpus } from './corpus-fixture'
import type { FileInfo } from './file-signals'
import { createGeneratedDir } from './helpers/generated-corpus'
import { settle } from './helpers/test-utils'

const ROOT = path.resolve(import.meta.dir, '..')

// These tests run the real corpus runner, which writes every generated module — point it at a per-run directory so it never races the build pipeline writing the same files.
const generated = createGeneratedDir('corpus-order')
afterAll(() => generated.cleanup())

describe('corpus compile order invariance', () => {
	test('module-list compiles even when it precedes its pass() target', async () => {
		const files = await loadCorpus()
		const first = files.filter(f => f.filename.endsWith('module-list.tsrx'))
		const rest = files.filter(f => !f.filename.endsWith('module-list.tsrx'))
		const compiled = await compileCorpus([...first, ...rest], generated.path)
		const tags = compiled.map(info => info.tag)
		expect(tags).toContain('module-list')
		expect(tags).toContain('basic-button')
	})

	test('every corpus file compiles in reverse order too', async () => {
		const files = await loadCorpus()
		const compiled = await compileCorpus([...files].reverse(), generated.path)
		const tags = new Set(compiled.map(info => info.tag))
		for (const file of files) {
			// Component files are named for their tag (repo convention, the same one handwrittenExampleModules relies on).
			const tag = (file.filename.split('/').pop() ?? '').replace(
				/\.(tsrx|tsx)$/,
				'',
			)
			expect(tags.has(tag)).toBeTrue()
		}
	})
})

describe('corpus error policy', () => {
	// The runner promises "errors fail the build run"; logging and returning normally instead let a silently dropped component reach later checks far from the real diagnostic.
	test('an error-severity diagnostic fails the run', async () => {
		const files = await loadCorpus()
		const bad: FileInfo = {
			path: path.join(ROOT, 'examples', 'module', 'bad-pass.tsrx'),
			filename: 'examples/module/bad-pass.tsrx',
			content: `export function C({})
@{
	expose({})
		<c-el>
			<div truc:pass={{ disabled: () => false }}></div>
			<style>@scope {
	:scope {
		  color: red;
		}
}</style>
		</c-el>
}`,
			hash: '',
			lastModified: 0,
			size: 0,
			exists: true,
		}
		// Via settle() rather than `expect(...).rejects`: bun-types types every matcher as returning void, so the awaited-matcher form draws TS 80007 even though the runtime promise is real.
		const settled = await settle(compileCorpus([...files, bad], generated.path))
		if (settled.status !== 'rejected')
			throw new Error('the run should have failed with LTC012')
		expect(String(settled.reason)).toMatch(
			/examples\/module\/bad-pass\.tsrx[\s\S]*LTC012/,
		)
	})
})
