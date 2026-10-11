/** The file record corpus tests build fixtures as. Only `path`, `filename` and `content` reach the compiler (`CorpusFile` in `src/corpus-scan.ts`); the rest are watch-system fields kept so the fixture objects stay shaped like the pipeline's. */

export type FileInfo = {
	path: string
	filename: string
	content: string
	hash: string
	lastModified: number
	size: number
	exists: boolean
}
