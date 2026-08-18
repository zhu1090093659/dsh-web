/**
 * The family package walker: every package.json under packages/ and
 * packages/skins/ (the two package roots), deterministically ordered.
 * Shared by verify-version, release-assets, verify-docs, and link-profile,
 * which each used to carry their own drifting copy.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * @param {string} root - repository root to walk.
 * @returns {{ dir: string, pkgPath: string }[]} absolute package dirs and
 *   their package.json paths, sorted per root (packages/ then packages/skins/).
 */
export function walkFamilyPackages(root) {
  const out = []
  for (const base of ['packages', join('packages', 'skins')]) {
    const absBase = resolve(root, base)
    if (!existsSync(absBase)) continue
    for (const entry of readdirSync(absBase).sort()) {
      const dir = resolve(absBase, entry)
      const pkgPath = join(dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      out.push({ dir, pkgPath })
    }
  }
  return out
}
