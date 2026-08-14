/**
 * Pet atlas resolution — where the browser-facing spritesheet + manifest
 * come from. The maid artwork is a community Codex Pet without a
 * redistribution license, so the package never bundles it: the host serves
 * the atlas from the user's local Codex Pet install (or an explicit asset
 * directory) and falls back to the bundled default whale atlas only when no
 * local theme is present. Resolution order: `assetDir` config override, then
 * `~/.codex/pets/maid-deepseek-whale`, then the bundled `assets/whale`.
 * @module @linxin666/dsh-pet-maid/asset-source
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** One resolved atlas source. */
export interface PetAssetSource {
  /** Absolute directory holding pet.json + spritesheet.webp. */
  dir: string
  /** Where the atlas came from, for the UI to surface. */
  kind: 'local' | 'bundled'
}

/** The Codex Pet theme this pet adapts (its own local install directory name). */
export const MAID_THEME_ID = 'maid-deepseek-whale'

/** Default local Codex Pet root (~/.codex/pets). */
export function codexPetsDir(home: string = homedir()): string {
  return join(home, '.codex', 'pets')
}

/** Bundled fallback atlas directory (whale assets shipped with the package). */
export function bundledAssetDir(packageRoot: string): string {
  return join(packageRoot, 'assets', 'whale')
}

/** True when a directory looks like a pet atlas (pet.json + spritesheet.webp). */
function isPetAtlasDir(dir: string): boolean {
  return existsSync(join(dir, 'pet.json')) && existsSync(join(dir, 'spritesheet.webp'))
}

/**
 * Resolve the atlas source for one config.
 * @param config - plugin config (assetDir override).
 * @param packageRoot - absolute package root (bundled fallback anchor).
 * @returns the resolved source (always resolves: the bundled fallback exists).
 */
export function resolvePetAssetDir(config: { assetDir?: string }, packageRoot: string): PetAssetSource {
  const override = config.assetDir
  if (override !== undefined && override.trim() !== '' && isPetAtlasDir(override)) {
    return { dir: override, kind: 'local' }
  }
  const localTheme = join(codexPetsDir(), MAID_THEME_ID)
  if (isPetAtlasDir(localTheme)) {
    return { dir: localTheme, kind: 'local' }
  }
  return { dir: bundledAssetDir(packageRoot), kind: 'bundled' }
}
