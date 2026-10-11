/* === Constants === */

/** Output root, relative to the project root. */
export const DEFAULT_OUT_DIR = 'server/generated/components'

export const DEFAULT_RUNTIME_IMPORT = '@zeix/le-truc-compiler/runtime'

/* === The CSS target === */

export type CssBrowser = 'chrome' | 'edge' | 'firefox' | 'safari'

export const CSS_BROWSERS: readonly CssBrowser[] = [
	'chrome',
	'edge',
	'firefox',
	'safari',
]

export const encodeCssVersion = (major: number, minor = 0, patch = 0): number =>
	(major << 16) | (minor << 8) | patch

export type CssTargets = Partial<Record<CssBrowser, number>>

export const DEFAULT_CSS_TARGETS: CssTargets = {
	chrome: encodeCssVersion(124),
	edge: encodeCssVersion(124),
	firefox: encodeCssVersion(125),
	safari: encodeCssVersion(17, 4),
}

/* === Types === */

export type EmitPaths = {
	/** `../` once per path segment from the output root back to the root. */
	outDirPrefix: string
	/** See `DEFAULT_RUNTIME_IMPORT`. */
	runtimeImport: string
	cssTargets: CssTargets
}

export const DEFAULT_EMIT_PATHS: EmitPaths = {
	outDirPrefix: '../'.repeat(DEFAULT_OUT_DIR.split('/').length),
	runtimeImport: DEFAULT_RUNTIME_IMPORT,
	cssTargets: DEFAULT_CSS_TARGETS,
}
