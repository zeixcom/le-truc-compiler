import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/* === Glob translation === */

/** One path segment: `*` → any-without-slash, `?` → one-not-slash, rest literal. */
const translateSegment = (segment: string): string => {
	let out = ''
	for (const char of segment) {
		if (char === '*') out += '[^/]*'
		else if (char === '?') out += '[^/]'
		// Escape every regex metacharacter — the grammar has no others.
		else out += char.replace(/[\\^$.+()|[\]{}]/g, '\\$&')
	}
	// A literal segment may address a dotfile; a wildcard one may not.
	return segment.startsWith('.') ? out : `(?!\\.)${out}`
}

/** Anchor a glob pattern to whole paths, `/`-separated. */
export const globToRegExp = (pattern: string): RegExp => {
	const segments = pattern.split('/')
	let rx = ''
	// True when the `/` before the next segment is already accounted for — at the pattern's start, and after an interior `**` whose group ends with its own slash.
	let noSeparatorNeeded = true
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i] as string
		if (segment === '**') {
			const isLast = i === segments.length - 1
			if (isLast) {
				// `a/**` keeps its slash (`a/…`); the trailing `**` is zero or more dot-guarded directories plus one dot-guarded file, so it never admits a hidden entry the walk skips.
				rx +=
					(noSeparatorNeeded || rx.length === 0 ? '' : '/') +
					'(?:(?![.])[^/]+/)*(?![.])[^/]+'
				noSeparatorNeeded = false
			} else {
				// `**/` = the slash before it (unless `**` leads the pattern) + zero or more dot-guarded directories — the zero case lets `a/**/b` match `a/b`.
				rx +=
					noSeparatorNeeded || rx.length === 0
						? '(?:(?![.])[^/]+/)*'
						: '/(?:(?![.])[^/]+/)*'
				noSeparatorNeeded = true
			}
			continue
		}
		const translated = translateSegment(segment)
		rx += noSeparatorNeeded || rx.length === 0 ? translated : `/${translated}`
		noSeparatorNeeded = false
	}
	return new RegExp(`^${rx}$`)
}

/** The explicit-dot segments of a pattern as whole-name matchers — the walk's prune step for dot entries. */
const dotSegmentMatchers = (pattern: string): RegExp[] =>
	pattern
		.split('/')
		.filter(segment => segment.startsWith('.'))
		.map(segment => new RegExp(`^${translateSegment(segment)}$`))

/**
 * Full-path glob match with the shared semantics. Paths use `/` separators.
 */
export const matchGlob = (pattern: string, path: string): boolean =>
	globToRegExp(pattern).test(path)

export const scanGlobSync = (pattern: string, cwd: string): string[] => {
	const regex = globToRegExp(pattern)
	const dotMatchers = dotSegmentMatchers(pattern)
	const matches: string[] = []
	const walk = (dir: string, prefix: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (
				entry.name.startsWith('.') &&
				!dotMatchers.some(matcher => matcher.test(entry.name))
			)
				continue
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.isDirectory()) {
				walk(join(dir, entry.name), rel)
				continue
			}
			if (entry.isFile() && regex.test(rel)) matches.push(rel)
		}
	}
	walk(cwd, '')
	return matches.sort()
}

/* === File IO === */

/** Whole file as UTF-8 text. */
export const readTextFile = async (path: string): Promise<string> =>
	await readFile(path, 'utf8')

export const readTextFileSync = (path: string): string =>
	readFileSync(path, 'utf8')

/** Whether a regular file exists at `path` — a directory answers false. */
export const fileExists = async (path: string): Promise<boolean> => {
	try {
		return (await stat(path)).isFile()
	} catch {
		return false
	}
}

export const pathExistsSync = (path: string): boolean => existsSync(path)

/** Write UTF-8 text, creating parent directories. */
export const writeTextFile = async (
	path: string,
	content: string,
): Promise<void> => {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, content, 'utf8')
}

/** Delete a file; a missing file is not an error. */
export const removeFile = async (path: string): Promise<void> => {
	await rm(path, { force: true })
}

export const readDir = async (path: string): Promise<string[]> =>
	(await readdir(path)).sort()
