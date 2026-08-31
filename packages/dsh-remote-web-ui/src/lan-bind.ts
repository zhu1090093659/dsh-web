/**
 * LAN bind toggle: the managed cordis patch block that pins the web
 * server's bind. On = a block binding 0.0.0.0; off = the same block binding
 * 127.0.0.1. The block takes effect on the next `dsh web` start (the live
 * patch watcher cannot rebind a running listener, and on this harness line
 * the user patch layer cannot evaluate webStartup-dependent expressions
 * reliably - static values are the only dependable form), so the plugin
 * re-asserts the block at every boot and the settings card reports the
 * running bind honestly.
 *
 * Same-id patch rows REPLACE the row config wholesale, so the block carries
 * the official web-app webserver row's full config (bind + compression)
 * with the bind values materialized. The CLI's --host 0.0.0.0 guard stays
 * intact: deliberate LAN exposure happens through this configuration layer
 * only. Until the user flips the toggle once, the plugin never touches the
 * patch file.
 *
 * The block discipline (markers, atomic write, strip-and-rewrite) follows
 * the dsh-LAN reference implementation (MIT).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { dshHome } from './dsh-home.ts'

/** Profile names safe to interpolate into the patch path: one path segment, no traversal. */
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const LAN_BIND_BLOCK_BEGIN = '# --- remote-web-ui lan-bind block (managed - do not edit) ---'
export const LAN_BIND_BLOCK_END = '# --- end remote-web-ui lan-bind block ---'

/** The two bind hosts the managed block pins. */
export type LanBindHost = '0.0.0.0' | '127.0.0.1'

/**
 * The absolute path of the profile patch file this toggle manages. The value
 * is config-controlled (and the DSH_PROFILE env fallback bypasses schema
 * validation entirely), so the path is guarded twice: the profile must be a
 * single safe path segment, and the resolved file must stay under the
 * profiles directory.
 */
export function profilePatchFile(profile: string, home: string = dshHome()): string {
  if (!PROFILE_PATTERN.test(profile)) {
    throw new Error(`remote-web-ui: unsafe lan-bind profile ${JSON.stringify(profile)}`)
  }
  const file = resolve(join(home, 'profiles', profile, 'cordis.patch.yml'))
  const root = resolve(join(home, 'profiles')) + sep
  if (!file.startsWith(root)) {
    throw new Error(`remote-web-ui: lan-bind profile ${JSON.stringify(profile)} escapes the profiles directory`)
  }
  return file
}

function readPatchContent(file: string): string {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8')
}

/** Escape one literal string for embedding into a RegExp pattern. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Remove the managed block (and its markers) from patch content. */
export function stripManagedBlock(content: string): string {
  const begin = escapeRegex(LAN_BIND_BLOCK_BEGIN)
  const end = escapeRegex(LAN_BIND_BLOCK_END)
  const pattern = new RegExp(`\\r?\\n?${begin}[\\s\\S]*?${end}\\r?\\n?`, 'g')
  return content.replace(pattern, '\n')
}

/**
 * Render the managed block for one bind state. The values are static: the
 * user patch layer has no reliable lazy service evaluation, and the plugin
 * re-asserts the block at every boot so CLI flags (--port, --host) win by
 * rewriting it before the next start.
 */
export function managedBlock(host: LanBindHost, port: number): string {
  return [
    LAN_BIND_BLOCK_BEGIN,
    '- id: webserver',
    "  name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    `    host: '${host}'`,
    `    port: ${String(port)}`,
    '    compression: gzip',
    '    compressionLevel: 1',
    '    compressionThresholdBytes: 1024',
    LAN_BIND_BLOCK_END,
    '',
  ].join('\n')
}

/** The bind state a managed block pins (undefined when there is no block). */
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
  const block = end === -1 ? content.slice(begin) : content.slice(begin, end)
  const hostMatch = /host:\s*'([^']+)'/.exec(block)
  const portMatch = /port:\s*(\d+)/.exec(block)
  return {
    host: hostMatch?.[1] ?? '',
    port: portMatch !== null ? Number(portMatch[1]) : undefined,
  }
}

/** Full file-level state for the settings card and the boot re-assert. */
export function lanBindState(profile: string, home: string = dshHome()): { blockPresent: boolean; host?: string; port?: number } {
  const state = managedBindOf(readPatchContent(profilePatchFile(profile, home)))
  if (state === undefined) return { blockPresent: false }
  return { blockPresent: true, host: state.host, port: state.port }
}

/**
 * Write (or rewrite) the managed block with the given bind. The rest of the
 * patch file is preserved; the block is rewritten atomically (unique temp
 * file + rename, so concurrent writers can never rename a half-written
 * file) with the original file's permissions preserved. A hand-truncated
 * unterminated block (BEGIN marker without END, which stripManagedBlock
 * cannot match) is truncated at its BEGIN marker first so the rewrite can
 * never stack a second webserver row onto the orphan.
 */
export function writeLanBind(host: LanBindHost, port: number, profile: string, home: string = dshHome()): void {
  const file = profilePatchFile(profile, home)
  const stripped = stripManagedBlock(readPatchContent(file))
  const orphanBegin = stripped.indexOf(LAN_BIND_BLOCK_BEGIN)
  const base = (orphanBegin === -1 ? stripped : stripped.slice(0, orphanBegin)).trimEnd()
  const content = `${base}\n\n${managedBlock(host, port)}`
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o600
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.remote-web-ui-tmp-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  writeFileSync(temp, content, { mode })
  renameSync(temp, file)
}