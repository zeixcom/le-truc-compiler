#!/usr/bin/env bun

/**
 * Demo corpus compile + browser bundle (owner ruling 2026-10-10).
 *
 *   bun run build:demo
 *
 * The demo corpus (demo/**\/*.tsx) is deliberately separate from examples/:
 * examples is the compiler's TEST corpus — dozens of tests compile it behind
 * golden baselines — and internal tooling UI belongs outside that baseline.
 * The board's components rarely change (owner: "tear down, recompile,
 * restart" is tolerable), so this build is run on demand, not watched.
 *
 * Two steps:
 * 1. `compileCorpus` with a hand-built config (the contract's sanctioned
 *    form): demo/ sources in, `server/generated/demo/` out, the runtime
 *    import pinned repo-relative (`../../../src/runtime`) so the emitted
 *    server modules run under Bun without a prior package build. The i18n
 *    dir points at demo/ (no catalogs): the demo does not translate, and a
 *    nonexistent dir is the documented "zero locales, zero gaps" case.
 * 2. A generated `client-entry.ts` side-effect-imports every emitted client
 *    module (each `defineComponent` self-registers its tag) and `Bun.build`
 *    bundles it for the browser — the client modules import the runtime
 *    directly from `@zeix/le-truc`, which rides along.
 *
 * The dev server (server/queue-board.ts) serves what this wrote; it refuses
 * to start without it.
 */

import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileCorpus } from '../src/contract'
import { resolveCorpusConfig } from '../src/corpus-config'

const ROOT = realpathSync(`${import.meta.dir}/..`)

const config = resolveCorpusConfig(ROOT, {
	sources: ['demo/**/*.tsx'],
	siblingModules: [],
	outDir: 'server/generated/demo',
	i18nDir: 'demo/i18n',
	locales: ['en'],
	runtimeImport: '../../../src/runtime',
})

const { diagnostics, summary } = await compileCorpus(config)
for (const diagnostic of diagnostics)
	console.error(
		`${diagnostic.severity}: ${diagnostic.code} ${diagnostic.message}`,
	)
if (diagnostics.some(d => d.severity === 'error')) {
	console.error(
		`❌ Demo corpus compilation failed — ${diagnostics.filter(d => d.severity === 'error').length} error-severity diagnostic(s).`,
	)
	process.exit(1)
}

// The browser bundle: one entry, every emitted client module. The registry
// names them; reading it keeps this script honest about what compiled.
const registry = JSON.parse(
	await Bun.file(join(config.outDir, 'registry.json')).text(),
) as Record<string, { clientModule: string }>
const clients = Object.values(registry).map(entry => entry.clientModule)
if (!clients.length) {
	console.error('❌ Demo corpus compiled no components — nothing to bundle.')
	process.exit(1)
}
const entry = join(config.outDir, 'client-entry.ts')
writeFileSync(
	entry,
	`${clients.map(client => `import './${client}'`).join('\n')}\n`,
)
const build = await Bun.build({
	entrypoints: [entry],
	outdir: config.outDir,
	target: 'browser',
})
if (!build.success) {
	for (const log of build.logs) console.error(log)
	process.exit(1)
}

console.log(
	`📦 ${summary.components} component(s) → server/generated/demo (+ client-entry.js, ${clients.length} client module(s) bundled)`,
)
if (!existsSync(join(config.outDir, 'client-entry.js'))) process.exit(1)
