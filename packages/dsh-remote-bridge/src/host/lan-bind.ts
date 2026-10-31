/**
 * The lan-bind block this plugin used to write, and its removal (issue #1917).
 *
 * Up to 0.4.8 the toggle pinned the LAN address into the profile's
 * `cordis.patch.yml` as a managed `- id: webserver` row. That approach is
 * retired for two measured reasons:
 *
 * 1. A same-id patch row REPLACES the whole row config, so the block silently
 *    swallowed the official row's own bind expression; the CLI `--host` /
 *    `--port` never reached the running row, and the machine's port came from
 *    a literal this plugin guessed.
 * 2. The profile patch is exactly what the Host's HMR config watcher refreshes
 *    from, so writing it recomposed the running process and rebound the live
 *    listener - the "takes effect on the next start" premise was false, and a
 *    write made mid-session moved the bind under the running host.
 *
 * LAN reachability now comes from a runtime forwarder instead (lan-forward.ts),
 * so the host always listens on loopback and this module's only remaining job
 * is to remove the block older versions left behind. The removal is
 * strip-only: no write appends anything, so the official webserver row (and
 * every other row) stays byte-identical. The block discipline (markers, atomic
 * write) follows the dsh-LAN reference implementation (MIT).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { dshHome } from './dsh-home.ts'

/** Profile names safe to interpolate into the patch path: one path segment, no traversal. */
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const LAN_BIND_BLOCK_BEGIN = '# --- remote-web-ui lan-bind block (managed - do not edit) ---'
export const LAN_BIND_BLOCK_END = '# --- end remote-web-ui lan-bind block ---'

/**
 * A bind host the managed block may pin. `'0.0.0.0'` only on a host whose
 * webserver schema still accepts the wildcard, `'127.0.0.1'` for the toggle
 * off, and otherwise one concrete interface address of this machine (see
 * lan-bind-plan.ts / host-bind-capability.ts, issue #1893).
 */
export type LanBindHost = string

/**
 * The absolute path of the profile patch file this toggle manages. The value
 * is config-controlled (and the runtime/environment fallbacks bypass schema
 * validation entirely), so the path is guarded twice: the profile must be a
 * single safe path segment, and the resolved file must stay under the
 * profiles directory.
 */
export function profilePatchFile(profile: string, home: string = dshHome()): string {
  if (!PROFILE_PATTERN.test(profile)) {
    throw new Error(`remote-bridge: unsafe lan-bind profile ${JSON.stringify(profile)}`)
  }
  const file = resolve(join(home, 'profiles', profile, 'cordis.patch.yml'))
  const root = resolve(join(home, 'profiles')) + sep
  if (!file.startsWith(root)) {
    throw new Error(`remote-bridge: lan-bind profile ${JSON.stringify(profile)} escapes the profiles directory`)
  }
  return file
}

function readPatchContent(file: string): string {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8')
}

/** One top-level sequence item inside a managed-block region. */
interface BlockItem {
  /** Offset of the item's first character inside the region. */
  start: number
  /** Offset just past the item's last character inside the region. */
  end: number
  /** The item's source text, line terminator included. */
  text: string
}

/**
 * Split a block-sequence region into its top-level items. Only a column-0 `-`
 * starts an item: that is the shape every writer of this file produces - the
 * managed block itself and the YAML document API's block-style re-emission.
 * @param region - text between two line boundaries.
 * @returns the items in source order; text outside them is not returned.
 */
function blockItems(region: string): BlockItem[] {
  const items: BlockItem[] = []
  let start = -1
  let offset = 0
  for (const line of region.split('\n')) {
    if (line.startsWith('- ') || line === '-') {
      if (start !== -1) items.push({ start, end: offset, text: region.slice(start, offset) })
      start = offset
    }
    offset += line.length + 1
  }
  if (start !== -1) items.push({ start, end: region.length, text: region.slice(start) })
  return items
}

/**
 * Whether one top-level item is the webserver row this plugin's block owns.
 * The row id is the whole signal: the markers declare everything inside them
 * managed, our block always writes `- id: webserver`, and a same-id row later
 * in the patch replaces this one wholesale anyway - so an id-webserver row
 * found inside our markers is this plugin's row (a hand-truncated block may
 * have lost its `name` line).
 * @param item - one top-level item's text.
 * @returns true when the item is the managed webserver row.
 */
function isManagedWebserverItem(item: string): boolean {
  return /^- id:\s*['"]?webserver['"]?[ \t]*(?:\r?\n|$)/.test(item)
}

/**
 * The text between a block's BEGIN and END markers: from the character after
 * the BEGIN line's terminator to the start of the END marker's line (or to
 * the end of the content without an END marker).
 * @param content - the patch file text.
 * @param begin - index of the BEGIN marker.
 * @param end - index of the END marker, or -1 when the block is unterminated.
 * @returns the region's text.
 */
function managedRegion(content: string, begin: number, end: number): string {
  const newlineAfterBegin = content.indexOf('\n', begin)
  const innerStart = newlineAfterBegin === -1 ? content.length : newlineAfterBegin + 1
  const endLineStart = end === -1 ? content.length : content.lastIndexOf('\n', end - 1) + 1
  return content.slice(innerStart, Math.max(innerStart, endLineStart))
}

/**
 * Remove the managed block (its markers and the webserver row this plugin
 * wrote) from patch content, keeping every other row.
 *
 * The markers travel with the file through writers that append rows through
 * the YAML document API: the appended rows land at the end of the sequence,
 * which is BEFORE a trailing END comment, so the region between the markers
 * can hold rows this plugin never wrote. Deleting the whole region silently
 * removed the user's model, plugin and remote-control rows on the next rewrite
 * - the remote-control row carries the LAN toggle itself, so the feature reset
 * to `undefined` and the phone was locked out again after a restart (DSH
 * Desktop report, 2026-09-30). Only the managed item is removed here; every
 * foreign row is kept in place and the fresh block is appended after them (the
 * same-id row last wins).
 * @param content - the patch file text.
 * @returns the text with the markers and the managed row removed.
 */
export function stripManagedBlock(content: string): string {
  let text = content
  for (;;) {
    const begin = text.indexOf(LAN_BIND_BLOCK_BEGIN)
    if (begin === -1) return text
    const end = text.indexOf(LAN_BIND_BLOCK_END, begin)
    const blockStart = text.lastIndexOf('\n', begin - 1) + 1
    const newlineAfterEnd = end === -1 ? -1 : text.indexOf('\n', end)
    const resumeAt = end === -1 ? text.length : (newlineAfterEnd === -1 ? text.length : newlineAfterEnd + 1)
    const region = managedRegion(text, begin, end)
    let kept = ''
    let cursor = 0
    for (const item of blockItems(region)) {
      if (!isManagedWebserverItem(item.text)) continue
      kept += region.slice(cursor, item.start)
      cursor = item.end
    }
    kept += region.slice(cursor)
    text = text.slice(0, blockStart) + kept + text.slice(resumeAt)
  }
}

/** The bind state a managed block pinned (undefined when there is no block). */
export interface ManagedBindState {
  host: LanBindHost | (string & {})
  port: number | undefined
}

/**
 * Parse the block's pinned bind out of patch content. A block whose values
 * were hand-edited reports the literals as-is so the card can surface them
 * instead of silently claiming one of the two known states.
 */
export function managedBindOf(content: string): ManagedBindState | undefined {
  const begin = content.indexOf(LAN_BIND_BLOCK_BEGIN)
  if (begin === -1) return undefined
  const end = content.indexOf(LAN_BIND_BLOCK_END, begin)
  const region = managedRegion(content, begin, end)
  // Read the bind out of the managed row itself. A region a YAML writer
  // displaced holds foreign rows too, and their `host`/`port` keys are not
  // this block's bind - reading them made the boot re-assert
  // believe the block was already applied. A region without a recognizable
  // managed row (hand-edited literals) keeps the historical whole-region read.
  const items = blockItems(region).filter(item => isManagedWebserverItem(item.text))
  const scope = items.length > 0 ? items.map(item => item.text).join('') : region
  const hostMatch = /host:\s*'([^']+)'/.exec(scope)
  const portMatch = /port:\s*(\d+)/.exec(scope)
  return {
    host: hostMatch?.[1] ?? '',
    port: portMatch !== null ? Number(portMatch[1]) : undefined,
  }
}

/** File-level state of a patch file a previous version wrote to. */
export function lanBindState(profile: string, home: string = dshHome()): { blockPresent: boolean; host?: string; port?: number } {
  const state = managedBindOf(readPatchContent(profilePatchFile(profile, home)))
  if (state === undefined) return { blockPresent: false }
  return { blockPresent: true, host: state.host, port: state.port }
}

/** What one legacy-block cleanup did, for the settings card and the log. */
export interface LegacyBlockCleanup {
  /** Whether the file actually carried the managed block. */
  removed: boolean
  /** The bind the removed block pinned, when it could be read. */
  host: string | undefined
  /** The port the removed block pinned, when it could be read. */
  port: number | undefined
}

/**
 * Remove the managed block a previous version wrote, and nothing else.
 *
 * The file is rewritten atomically (unique temp file + rename, so a concurrent
 * reader never sees a half-written patch) with its original permissions
 * preserved, and only when the block is actually there: a second run finds no
 * markers, writes nothing, and leaves the bytes identical, which is what makes
 * the plugin's once-per-boot call idempotent.
 *
 * The official `- id: webserver` row every profile carries is a FOREIGN row -
 * the strip keeps it verbatim (see stripManagedBlock). Nothing is appended, so
 * the profile keeps the row's own bind expression and the CLI flags keep
 * reaching it.
 *
 * A failure (an unreadable file, a read-only profile) is NOT swallowed here:
 * callers report it, because a silent failure leaves a block that keeps
 * swallowing the bind on every later start.
 * @param profile - the managed profile name.
 * @param home - DSH home (test seam).
 * @returns what was removed; `removed: false` when there was nothing to do.
 */
export function removeManagedBlock(profile: string, home: string = dshHome()): LegacyBlockCleanup {
  const file = profilePatchFile(profile, home)
  if (!existsSync(file)) return { removed: false, host: undefined, port: undefined }
  const content = readFileSync(file, 'utf8')
  const state = managedBindOf(content)
  const stripped = stripManagedBlock(content)
  if (stripped === content) return { removed: false, host: undefined, port: undefined }
  const mode = statSync(file).mode & 0o777
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.remote-web-ui-tmp-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  writeFileSync(temp, stripped, { mode })
  renameSync(temp, file)
  return { removed: true, host: state?.host, port: state?.port }
}