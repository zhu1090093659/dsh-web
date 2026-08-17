/**
 * Build-time asset copy: place the KaTeX runtime, stylesheet and fonts where
 * the host vendor routes serve them from (lib/assets/katex/). The katex
 * version is pinned in package.json; this script only copies, never
 * downloads. The CSS references fonts through relative url(fonts/...) paths,
 * so the directory layout mirrors the dist tree to keep those intact.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** Resolve the katex dist directory (exports-map tolerant). */
function resolveKatexDist() {
  let manifest = ''
  try {
    manifest = require.resolve('katex/package.json')
  } catch {
    // try the plain specifier (some pnpm layouts resolve only the entry)
    manifest = require.resolve('katex')
  }
  return join(dirname(manifest), 'dist')
}

const dist = resolveKatexDist()
const targetDir = join(packageRoot, '..', 'lib', 'assets', 'katex')
const fontsDir = join(targetDir, 'fonts')
await mkdir(fontsDir, { recursive: true })

const files = ['katex.min.js', 'katex.min.css']
for (const file of files) {
  const source = join(dist, file)
  await copyFile(source, join(targetDir, file))
}

let copiedFonts = 0
for (const entry of await readdir(join(dist, 'fonts'))) {
  if (!entry.endsWith('.woff2')) continue
  await copyFile(join(dist, 'fonts', entry), join(fontsDir, entry))
  copiedFonts += 1
}

const info = await stat(join(targetDir, 'katex.min.js'))
console.log(`[dsh-aionui-panel] katex assets: ${dist} -> ${targetDir} (${info.size} bytes js, ${copiedFonts} fonts)`)
