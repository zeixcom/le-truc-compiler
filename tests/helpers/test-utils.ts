import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Returns the path and a cleanup function. */
export function createTempDir(): { path: string; cleanup: () => void } {
	const tempPath = mkdtempSync(join(tmpdir(), 'le-truc-test-'))

	return {
		path: tempPath,
		cleanup: () => {
			try {
				rmSync(tempPath, { recursive: true, force: true })
			} catch (error) {
				console.error(`Failed to cleanup temp dir ${tempPath}:`, error)
			}
		},
	}
}

export function createTempFile(
	dir: string,
	filename: string,
	content: string,
): string {
	const filePath = join(dir, filename)
	writeFileSync(filePath, content, 'utf8')
	return filePath
}

export function createTempStructure(
	baseDir: string,
	structure: Record<string, string | Record<string, string>>,
): void {
	for (const [key, value] of Object.entries(structure)) {
		if (typeof value === 'string') {
			createTempFile(baseDir, key, value)
		} else {
			const dirPath = join(baseDir, key)
			mkdirSync(dirPath, { recursive: true })
			createTempStructure(dirPath, value)
		}
	}
}

/** Generate mock markdown content. */
export function mockMarkdown(options: {
	title?: string
	content?: string
	frontmatter?: Record<string, any>
}): string {
	const {
		title = 'Test Page',
		content = 'Test content',
		frontmatter = {},
	} = options

	const fm = {
		title,
		...frontmatter,
	}

	const frontmatterStr = Object.entries(fm)
		.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
		.join('\n')

	return `---
${frontmatterStr}
---

${content}
`
}

/** Generate mock HTML content. */
export function mockHtml(options: {
	title?: string
	body?: string
	head?: string
}): string {
	const {
		title = 'Test Page',
		body = '<p>Test content</p>',
		head = '',
	} = options

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${title}</title>
	${head}
</head>
<body>
	${body}
</body>
</html>`
}

/** Generate mock file info. */
export function mockFileInfo(options: {
	path?: string
	filename?: string
	content?: string
	hash?: string
	lastModified?: number
	size?: number
	exists?: boolean
}) {
	const {
		path = '/test/file.md',
		filename = 'file.md',
		content = 'test content',
		hash = 'abc123def456',
		lastModified = Date.now(),
		size = content.length,
		exists = true,
	} = options

	return {
		path,
		filename,
		content,
		hash,
		lastModified,
		size,
		exists,
	}
}

/** Await a promise that may reject and return its outcome: bun-types types every `expect()` matcher as returning void, so `await expect(p).rejects.toThrow(...)` draws TS 80007 even though the runtime promise is real — await through this instead and assert on the outcome. */
export function settle<T>(
	promise: Promise<T>,
): Promise<PromiseSettledResult<T>> {
	return promise.then(
		value => ({ status: 'fulfilled', value }),
		reason => ({ status: 'rejected', reason }),
	)
}

export function assertContains(actual: string, expected: string): void {
	if (!actual.includes(expected)) {
		throw new Error(
			`Expected string to contain "${expected}" but it didn't.\nActual: ${actual}`,
		)
	}
}

export function assertNotContains(actual: string, notExpected: string): void {
	if (actual.includes(notExpected)) {
		throw new Error(
			`Expected string not to contain "${notExpected}" but it did.\nActual: ${actual}`,
		)
	}
}

export function assertMatches(actual: string, pattern: RegExp): void {
	if (!pattern.test(actual)) {
		throw new Error(
			`Expected string to match pattern ${pattern} but it didn't.\nActual: ${actual}`,
		)
	}
}

/**
 * Assert that HTML is valid (basic checks)
 */
export function assertValidHtml(html: string): void {
	const openTags = (html.match(/<[^/][^>]*>/g) || []).length
	const closeTags = (html.match(/<\/[^>]*>/g) || []).length

	const selfClosing = (html.match(/<[^>]*\/>/g) || []).length

	// Not perfect, but catches obvious issues.
	if (openTags - selfClosing !== closeTags) {
		throw new Error(
			`HTML appears to have unbalanced tags.\nOpen: ${openTags}, Self-closing: ${selfClosing}, Close: ${closeTags}`,
		)
	}
}

export function mockRequestContext(options: {
	path?: string
	method?: string
	headers?: Record<string, string>
	acceptsGzip?: boolean
	acceptsBrotli?: boolean
}) {
	const {
		path = '/',
		method = 'GET',
		headers = {},
		acceptsGzip = false,
		acceptsBrotli = false,
	} = options

	const headersObj = new Headers(headers)

	return {
		path,
		method,
		headers: headersObj,
		acceptsGzip,
		acceptsBrotli,
	}
}

export async function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/** Retry a function until it succeeds or times out. `backoff` grows the wait after each failed attempt by the given factor (1 = fixed interval), capped at `maxInterval`. The `timeout` budget is wall-clock: give it enough room for a loaded CI runner, and raise bun's per-test timeout (third `test()` argument) to match — the lower of the two caps is the one that actually fires. */
export async function retryUntil<T>(
	fn: () => T | Promise<T>,
	options: {
		timeout?: number
		interval?: number
		backoff?: number
		maxInterval?: number
		condition?: (result: T) => boolean
	} = {},
): Promise<T> {
	const {
		timeout = 5000,
		interval = 100,
		backoff = 1,
		maxInterval = 1000,
		condition = () => true,
	} = options

	const startTime = Date.now()
	let currentInterval = interval

	while (Date.now() - startTime < timeout) {
		try {
			const result = await fn()
			if (condition(result)) {
				return result
			}
		} catch (_error) {}
		await wait(currentInterval)
		currentInterval = Math.min(currentInterval * backoff, maxInterval)
	}

	throw new Error(`retryUntil timed out after ${timeout}ms`)
}

export function normalizeWhitespace(str: string): string {
	return str.replace(/\s+/g, ' ').trim()
}

export function normalizeHtml(html: string): string {
	return html.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim()
}

export function normalizePathForTest(path: string): string {
	return path.replace(/\\/g, '/')
}
