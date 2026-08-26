/**
 * Official-market provenance verification (issue #1073).
 *
 * Skins installed one-click from the DSH Market carry a
 * dsh-market.provenance.json written by the market installer at install
 * time, pinning every installed file to its sha256 and to the market
 * origin. The market's skin content is built from THIS repository (same
 * review, same release), so when the on-disk skin.json and hooks entry
 * hash-match the provenance, the hooks bytes are exactly the reviewed
 * bytes and may run like a built-in skin's.
 *
 * Fail-closed: invalid provenance and any post-install byte mismatch keep the
 * hooks-refused behavior for user-directory skins. A pre-provenance install
 * recovers only by matching this release's generated reviewed identity.
 * Forging the provenance
 * requires write access to $DSH_HOME itself — an attacker with that access
 * can already install full plugins, so the file is a provenance record,
 * not a capability guard against the local user.
 * @module @linxin666/dsh-client-ui-skin-center/provenance
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { REVIEWED_SKIN_HOOKS } from './reviewed-hooks.generated.ts'

/** Provenance filename written by the market installer (mirrors PROVENANCE_FILENAME in @linxin666/dsh-client-ui-market; no cross-package runtime import). */
export const MARKET_PROVENANCE_FILENAME = 'dsh-market.provenance.json'

/** Market origin the provenance must pin (mirrors MARKET_ORIGIN in @linxin666/dsh-client-ui-market). */
export const MARKET_PROVENANCE_SOURCE = 'https://dsh-market.com'

function sha256Hex(abs: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Whether the skin directory at dir carries valid official-market
 * provenance for skinId whose declared hooks entry (already validated as a
 * safe relative path by the manifest validator) hash-matches the recorded
 * bytes — skin.json included, so the facet entry path itself is pinned.
 */
export function verifyMarketProvenance(dir: string, skinId: string, hooksEntry: string): boolean {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dir, MARKET_PROVENANCE_FILENAME), 'utf8'))
  } catch {
    return false
  }
  if (typeof raw !== 'object' || raw === null) return false
  const prov = raw as Record<string, unknown>
  if (prov.version !== 1) return false
  if (prov.source !== MARKET_PROVENANCE_SOURCE) return false
  if (prov.id !== skinId) return false
  const files = prov.files
  if (typeof files !== 'object' || files === null) return false
  const hashes = files as Record<string, unknown>
  for (const rel of ['skin.json', hooksEntry]) {
    const expected = hashes[rel]
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) return false
    const actual = sha256Hex(join(dir, ...rel.split('/')))
    if (actual === null || actual !== expected) return false
  }
  return true
}

/**
 * Recover a pre-provenance Workshop install only when its executable identity
 * is byte-for-byte one of this release's reviewed market skins. This is a
 * read-only fallback: no provenance is minted and no user file is replaced.
 */
export function verifyReviewedLegacyHooks(dir: string, skinId: string, hooksEntry: string): boolean {
  const reviewed = REVIEWED_SKIN_HOOKS[skinId]
  if (reviewed === undefined || reviewed.entry !== hooksEntry) return false
  const manifestHash = sha256Hex(join(dir, 'skin.json'))
  const hooksHash = sha256Hex(join(dir, ...hooksEntry.split('/')))
  return manifestHash === reviewed.manifestSha256 && hooksHash === reviewed.hooksSha256
}
