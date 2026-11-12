/**
 * check-dispatcher-rules -- does the block this preset ships still match the
 * lineage it was extracted from?
 *
 * The block is maintained here, so nothing forces it to move when the origin
 * package moves. This script is the signal: it reads the installed origin
 * package's dispatch preset, normalizes both texts, and reports the sentences
 * that differ. It never edits anything and it never guesses: when the package
 * is absent, or its layout is not the one this script knows, it says so and
 * exits without failing, because absence is not evidence of drift.
 *
 * Exit codes
 *   0  no drift, or nothing to compare against
 *   3  drift found
 *   4  the package is absent (only with --strict)
 *
 * Usage: node tools/check-dispatcher-rules.mjs [--strict] [--verbose]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { DISPATCHER_RULES, DISPATCHER_RULES_PROVENANCE } from '../presets/liangshen/dispatcher-rules.mjs'

const require = createRequire(import.meta.url)
const ORIGIN = DISPATCHER_RULES_PROVENANCE.package

/** The installed origin package's root, or undefined when it is not installed. */
export function originRoot() {
  try {
    return dirname(require.resolve(ORIGIN + '/package.json'))
  } catch {
    return undefined
  }
}

/** Find the dispatch preset file by content rather than by an assumed path. */
export function originPresetFile(root) {
  const queue = [root]
  let seen = 0
  while (queue.length > 0 && seen < 500) {
    const current = queue.shift()
    seen += 1
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') queue.push(path)
        continue
      }
      if (entry.name !== 'agent.cordis.yml') continue
      let text
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      if (text.includes('prefix:') && text.includes('[Role Identification]')) return path
    }
  }
  return undefined
}

/** Natural sentences of a rule text, normalized for comparison. */
export function sentences(text) {
  return String(text)
    .replace(/\r/g, '')
    .split(/\n\s*-\s+|\n\n+|(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, ' ').replace(/^[\s>*#-]+/, '').trim())
    .filter((part) => part.length > 12)
}

/** A rough overlap score: how much of one sentence survives inside the other. */
function sameSentence(left, right) {
  const key = (value) => value.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const a = key(left)
  const b = key(right)
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length < 40) return false
  return longer.includes(shorter)
}

/** Report the origin sentences this block does not carry, and the reverse. */
export function compare(originText, localText = DISPATCHER_RULES) {
  const origin = sentences(originText)
  const local = sentences(localText)
  const missing = origin.filter((candidate) => local.some((entry) => sameSentence(candidate, entry)) !== true)
  const extra = local.filter((candidate) => origin.some((entry) => sameSentence(candidate, entry)) !== true)
  return { missing, extra }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('check-dispatcher-rules.mjs')
if (isMain) {
  const strict = process.argv.includes('--strict')
  const verbose = process.argv.includes('--verbose')
  const root = originRoot()
  if (root === undefined) {
    console.log(ORIGIN + ' is not installed; nothing to compare against. '
      + DISPATCHER_RULES_PROVENANCE.package + ' was last read at version ' + DISPATCHER_RULES_PROVENANCE.inheritedVersion
      + ', re-extracted ' + DISPATCHER_RULES_PROVENANCE.reExtractedAt + '.')
    process.exit(strict ? 4 : 0)
  }
  const file = originPresetFile(root)
  if (file === undefined) {
    console.log('installed ' + ORIGIN + ', but no dispatch preset with a persona prefix was found under ' + root + '; layout not recognized.')
    process.exit(0)
  }
  const originText = readFileSync(file, 'utf8')
  const result = compare(originText)
  const drifted = result.missing.length > 0 || result.extra.length > 0
  console.log('origin ' + file)
  console.log('local  ' + DISPATCHER_RULES_PROVENANCE.reExtractedAt + ', ' + DISPATCHER_RULES_PROVENANCE.corrections.length + ' correction(s) recorded')
  if (drifted === false) {
    console.log('no drift: every comparable sentence matches.')
    process.exit(0)
  }
  console.log('drift: ' + result.missing.length + ' origin sentence(s) not carried, ' + result.extra.length + ' local sentence(s) not in origin.')
  const show = verbose ? 40 : 8
  for (const entry of result.missing.slice(0, show)) console.log('  origin only: ' + entry.slice(0, 160))
  for (const entry of result.extra.slice(0, show)) console.log('  local only:  ' + entry.slice(0, 160))
  console.log('A difference is not automatically a defect: the provenance record lists the corrections that are meant to differ.')
  process.exit(3)
}