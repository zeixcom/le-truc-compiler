import { dirname, join, resolve } from 'node:path'
import {
	CONFIG_FILENAME,
	type CorpusConfig,
	type CorpusConfigInput,
	outDirPrefix,
	resolveCorpusConfig,
} from './corpus-config'
import {
	pathExistsSync,
	readTextFile,
	readTextFileSync,
	scanGlobSync,
} from './fs'

/* === Types === */

export type CorpusFile = {
	/** Source path on disk, as the scan (or the caller) produced it. */
	path: string
	/** Path relative to the scan root — the tag's derivation input. */
	filename: string
	content: string
}

/* === Internal Functions === */

const findConfigFile = (
	from: string,
): { file: string } | { boundary: string } | {} => {
	let dir = resolve(from)
	for (;;) {
		const candidate = join(dir, CONFIG_FILENAME)
		if (pathExistsSync(candidate)) return { file: candidate }
		if (
			pathExistsSync(join(dir, 'package.json')) ||
			pathExistsSync(join(dir, '.git'))
		)
			return { boundary: dir }
		const parent = dirname(dir)
		if (parent === dir) return {}
		dir = parent
	}
}

/* === Exported Functions === */

export const loadCorpusConfig = (
	cwd: string = process.cwd(),
	fallbackRoot: string = resolve(cwd),
): CorpusConfig => {
	const found = findConfigFile(cwd)
	if ('file' in found) {
		let input: CorpusConfigInput
		try {
			input = JSON.parse(readTextFileSync(found.file)) as CorpusConfigInput
		} catch (e) {
			throw new Error(
				`${found.file}: not valid JSON — ${e instanceof Error ? e.message : String(e)}`,
			)
		}
		return resolveCorpusConfig(dirname(found.file), input)
	}
	if ('boundary' in found) return resolveCorpusConfig(found.boundary)
	return resolveCorpusConfig(fallbackRoot)
}

export const collectCorpusSources = async (
	config: CorpusConfig,
): Promise<CorpusFile[]> => {
	const byPath = new Map<string, CorpusFile>()
	for (const pattern of config.sources) {
		for (const rel of scanGlobSync(pattern, config.root)) {
			const path = join(config.root, rel)
			if (byPath.has(path)) continue
			byPath.set(path, {
				path,
				filename: rel,
				content: await readTextFile(path),
			})
		}
	}
	return [...byPath.values()]
}

export const collectSiblingModules = (
	config: CorpusConfig,
): Map<string, string> => {
	const prefix = outDirPrefix(config.root, config.outDir)
	const modules = new Map<string, string>()
	for (const pattern of config.siblingModules) {
		for (const rel of scanGlobSync(pattern, config.root)) {
			const tag = (rel.split('/').pop() ?? '').replace(/\.ts$/, '')
			if (!/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/.test(tag)) continue
			modules.set(tag, `${prefix}${rel.replace(/\.ts$/, '')}`)
		}
	}
	return modules
}
