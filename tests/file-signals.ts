/**
 * The file record corpus tests build fixtures as (`FileInfo` in the source
 * repo's docs pipeline, `server/file-signals.ts`).
 *
 * Only `path`, `filename` and `content` reach the compiler — `CorpusFile`
 * in `src/corpus-scan.ts` — the rest are the watch-system fields the tests
 * kept setting so the fixture objects stay shaped like the pipeline's.
 */

export type FileInfo = {
	path: string
	filename: string
	content: string
	hash: string
	lastModified: number
	size: number
	exists: boolean
}
