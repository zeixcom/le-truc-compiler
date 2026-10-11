/** This repo's corpus facts: the repo root, and the configuration the test suite and runner scripts compile under. The loading and globbing half lives in `src/corpus-scan.ts`; what stays here is everything anchored to this repository. */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CorpusConfig } from '../src/corpus-config'
import { collectSiblingModules, loadCorpusConfig } from '../src/corpus-scan'

/** This repo's own root — the default project root, and the directory the config loader starts from. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The configuration the in-repo pipeline runs under, discovered from the root exactly as the scripts discover it. */
export const REPO_CONFIG: CorpusConfig = loadCorpusConfig(REPO_ROOT)

/** Where the corpus compile writes its artifacts, including the registry the tier census reads. Exported for the scripts and tests that address the same directory the pipeline defaults to. */
export const GENERATED_DIR = REPO_CONFIG.outDir

/** Custom element tags of the hand-written example components, mapped to their source paths (relative to the generated dir). */
export const handwrittenExampleModules = (): Map<string, string> =>
	collectSiblingModules(REPO_CONFIG)
