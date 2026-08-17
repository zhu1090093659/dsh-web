/**
 * Build-time asset copy: place the KaTeX runtime, stylesheet and fonts where
 * the host vendor route serves them from (lib/assets/katex/). The katex
 * version is pinned in package.json; this script only copies, never
 * downloads. Mirrors scripts/copy-mermaid.mjs.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** The katex dist dir (exports-map tolerant resolution). */
function resolveKatexDist() {
  let anchor
  try {
    anchor = require.resolve('katex/package.json')
  } catch {
    anchor = null
  }
  if (anchor === null) {
    throw new Error('cannot resolve katex/package.json — run pnpm install first')
  }
  return join(dirname(anchor), 'dist')
}

const dist = resolveKatexDist()
const targetDir = join(packageRoot, '..', 'lib', 'assets', 'katex')
await mkdir(join(targetDir, 'fonts'), { recursive: true })

let copied = 0
for (const file of ['katex.min.js', 'katex.min.css']) {
  await copyFile(join(dist, file), join(targetDir, file))
  copied += 1
}
// The stylesheet's @font-face rules resolve fonts/ relative to the served CSS
// URL; ship every font file the dist carries (woff2/woff/ttf variants).
for (const entry of await readdir(join(dist, 'fonts'))) {
  await copyFile(join(dist, 'fonts', entry), join(targetDir, 'fonts', entry))
  copied += 1
}
console.log(`[dsh-aionui-panel] katex assets: ${dist} -> ${targetDir} (${copied} files)`)
