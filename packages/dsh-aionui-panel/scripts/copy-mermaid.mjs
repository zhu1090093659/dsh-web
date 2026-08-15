/**
 * Build-time asset copy: place the mermaid IIFE bundle where the host vendor
 * route serves it from (lib/assets/mermaid.min.js). The mermaid version is
 * pinned in package.json; this script only copies, never downloads.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** Candidate resolutions for the mermaid dist bundle (exports-map tolerant). */
function resolveMermaidDist() {
  const candidates = []
  for (const specifier of ['mermaid/dist/mermaid.min.js', 'mermaid/package.json']) {
    try {
      candidates.push(require.resolve(specifier))
    } catch {
      // try the next candidate
    }
  }
  for (const candidate of candidates) {
    if (candidate.endsWith('mermaid.min.js')) return candidate
    const beside = join(dirname(candidate), 'dist', 'mermaid.min.js')
    try {
      require.resolve(beside)
      return beside
    } catch {
      // keep walking candidates
    }
  }
  throw new Error('cannot resolve mermaid/dist/mermaid.min.js — run pnpm install first')
}

const source = resolveMermaidDist()
const target = join(packageRoot, '..', 'lib', 'assets', 'mermaid.min.js')
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
const info = await stat(target)
console.log(`[dsh-aionui-panel] mermaid asset: ${source} -> ${target} (${info.size} bytes)`)
