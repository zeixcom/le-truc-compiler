/**
 * This repo's corpus facts (ported from the source repo's
 * `server/corpus-sources.ts`): the repo root, and the configuration the
 * test suite and runner scripts compile under.
 *
 * The loading and globbing half lives in the compiler package
 * (`src/corpus-scan.ts`). What stays here is everything anchored to THIS
 * repository. No `le-truc.config.json` exists here, so the boundary rule
 * lands on this root and the defaults apply — and the defaults are this
 * repo's paths (`examples/**` in, `server/generated/components/` out).
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CorpusConfig } from '../src/corpus-config'
import { collectSiblingModules, loadCorpusConfig } from '../src/corpus-scan'

/* === Constants === */

/**
 * This repo's own root — the default project root, and the directory the
 * config loader starts from. Anchored to this module's location,
 * portably: the module is the constant, whichever runtime loads it.
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The configuration the in-repo pipeline runs under, discovered from the
 * root exactly as the scripts discover it — one fact, one loader.
 */
export const REPO_CONFIG: CorpusConfig = loadCorpusConfig(REPO_ROOT)

/**
 * Where the corpus compile writes its artifacts, including the registry the
 * tier census reads. Exported for the scripts and tests that address the
 * same directory the pipeline defaults to.
 */
export const GENERATED_DIR = REPO_CONFIG.outDir

/**
 * Custom element tags of the hand-written example components, mapped to
 * their source paths (relative to the generated dir).
 */
export const handwrittenExampleModules = (): Map<string, string> =>
	collectSiblingModules(REPO_CONFIG)
