/**
 * Minimal `~/.ssh/config` reader for the one-shot host import: Host blocks with
 * `Include` expansion and explicit skip reasons. Values stay raw strings; the
 * store maps them onto a HostPayload.
 *
 * Deliberate simplifications (documented in the package README):
 *   - `Match` blocks are skipped — their options are conditional and must never
 *     merge into the Host block above them.
 *   - A multi-pattern `Host a b` line only exposes its first pattern.
 *   - Include pathnames accept `~`, globs, and several whitespace-separated
 *     pathnames, but not environment variables, `%` tokens, or quoting.
 *   - Relative Include pathnames resolve against the directory of the config
 *     file the import started from (OpenSSH: `~/.ssh` for a user config).
 *   - A file that already contributed lines is never read twice, which doubles
 *     as the Include cycle guard.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { ImportSkipBlock } from './protocol.ts'

/** One parsed Host block. */
export interface SshBlock {
  /** Raw Host line value (may hold several whitespace-separated patterns). */
  pattern: string
  /** Lowercased option key/value pairs; the last occurrence of a key wins. */
  props: Record<string, string>
}

/** One config file read, with every Include expanded in place. */
export interface SshConfigRead {
  blocks: SshBlock[]
  skipped: ImportSkipBlock[]
}

/** Include recursion guard: a cycle or a runaway chain stops here. */
const MAX_INCLUDE_DEPTH = 16

/** The only line shape ssh_config knows: `Keyword value...` (case-insensitive). */
const LINE_RE = /^([A-Za-z0-9_-]+)\s+(.+)$/

/** Expand a leading `~` the way OpenSSH does for user configuration files. */
function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/** Turn one glob segment into a matcher (`*` and `?` only). */
function segmentMatcher(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
}

/**
 * Expand a segment list against the filesystem. Wildcards match whole segments
 * only; matches are sorted so a glob import stays deterministic.
 */
function globSegments(prefix: string, segments: string[]): string[] {
  const [head, ...rest] = segments
  if (head === undefined) return [prefix]
  if (!/[*?]/.test(head)) return globSegments(join(prefix, head), rest)
  let names: string[]
  try {
    names = readdirSync(prefix)
  } catch {
    return []
  }
  const matcher = segmentMatcher(head)
  return names.filter(name => matcher.test(name)).sort().flatMap(name => globSegments(join(prefix, name), rest))
}

/** Resolve one Include pathname into the existing regular files it names. */
function resolveInclude(spec: string, baseDir: string): string[] {
  const expanded = expandTilde(spec)
  const full = isAbsolute(expanded) ? expanded : join(baseDir, expanded)
  if (!/[*?]/.test(full)) return existsSync(full) ? [full] : []
  const root = /^([A-Za-z]:[\\/]|[\\/])/.exec(full)?.[1] ?? ''
  const segments = full.slice(root.length).split(/[\\/]+/).filter(part => part !== '')
  const files = globSegments(root === '' ? '.' : root, segments)
  return files.filter(path => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  })
}

/** Read one file into lines, splicing every `Include` in place. */
function readLines(file: string, baseDir: string, visited: Set<string>, depth: number): string[] {
  if (depth > MAX_INCLUDE_DEPTH) return []
  let key: string
  try {
    key = realpathSync(file)
  } catch {
    return []
  }
  if (visited.has(key)) return []
  visited.add(key)
  let text: string
  try {
    text = readFileSync(key, 'utf8')
  } catch {
    return []
  }
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const match = LINE_RE.exec(raw.trim())
    if (match === null || match[1].toLowerCase() !== 'include') {
      out.push(raw)
      continue
    }
    for (const spec of match[2].trim().split(/\s+/).filter(part => part !== '')) {
      for (const included of resolveInclude(spec, baseDir)) {
        out.push(...readLines(included, baseDir, visited, depth + 1))
      }
    }
  }
  return out
}

/**
 * Parse one ssh_config file (Include expanded) into Host blocks plus the
 * `Match` blocks that were deliberately skipped.
 */
export function readSshConfigBlocks(configPath: string): SshConfigRead {
  const blocks: SshBlock[] = []
  const skipped: ImportSkipBlock[] = []
  const lines = readLines(configPath, dirname(configPath), new Set<string>(), 0)
  let current: SshBlock | undefined
  for (const raw of lines) {
    const match = LINE_RE.exec(raw.trim())
    if (match === null) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'host') {
      current = { pattern: value, props: {} }
      blocks.push(current)
      continue
    }
    if (key === 'match') {
      // Everything below a Match line is conditional; attributing it to the
      // Host block above would import a wrong HostName / ProxyCommand.
      skipped.push({ name: 'Match ' + value, reason: 'match' })
      current = undefined
      continue
    }
    if (current !== undefined) current.props[key] = value
  }
  return { blocks, skipped }
}
