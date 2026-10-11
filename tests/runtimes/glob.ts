/** The shared glob machinery, re-exported from the compiler package where the semantics are owned (`src/fs.ts`, the file-system seam). This keeps the runtime seam's import graph stable: `bun.ts` and `node.ts` share one translator, so a consumer's corpus cannot match one file set under Bun and another under Node. */

export { globToRegExp, matchGlob, scanGlobSync } from '../../src/fs'
