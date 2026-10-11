/** The repo's shorthand caller of the corpus pass. The pass returns diagnostics and a summary instead of throwing; this runner keeps the "errors fail the build run" contract — thrown after the artifacts are written — and the shorthand that a bare path means "the repo's configuration, but write here", which is what tests use so they never race the build. */

import { type CompiledSpanInfo, compileCorpusFiles } from '../src/corpus'
import { type CorpusConfig } from '../src/corpus-config'
import type { CorpusFile } from '../src/corpus-scan'
import { REPO_CONFIG } from './corpus-sources'

export { relocateClientSpecifiers } from '../src/corpus'
export {
	GENERATED_DIR,
	handwrittenExampleModules,
	REPO_CONFIG,
} from './corpus-sources'
export type { CompiledSpanInfo }

/** Compile the given corpus files under the repo's (or the caller's) configuration and fail the run on error diagnostics. A bare `target` path means "the repo's config, but write here". */
export const compileCorpus = async (
	files: readonly CorpusFile[],
	target: string | CorpusConfig = REPO_CONFIG,
): Promise<CompiledSpanInfo[]> => {
	const config: CorpusConfig =
		typeof target === 'string' ? { ...REPO_CONFIG, outDir: target } : target
	const result = await compileCorpusFiles(files, config)
	if (result.errors.length > 0) {
		throw new Error(
			`Corpus compilation failed — ${result.errors.length} file(s) with error-severity diagnostics (dropped from the generated output):\n` +
				result.errors
					.map(({ file, label }) => `  • ${file} — ${label}`)
					.join('\n'),
		)
	}
	return [...result.spanInfos]
}
