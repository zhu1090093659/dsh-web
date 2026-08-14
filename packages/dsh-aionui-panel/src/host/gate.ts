/**
 * Workspace gate for the /aionui-panel routes: canonicalize the requested
 * project root and require it to be a registered workspace (or a directory
 * inside one). This is the security boundary of the panel's fs/git routes -
 * the browser may only read and mutate files under registered workspace
 * roots, never arbitrary host directories.
 * @module dsh-aionui-panel/host/gate
 */

import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type { PanelError } from '../core/types.ts'

/** The gate verdict for one project root. */
export type GateVerdict = { ok: true; canonical: string } | { ok: false; error: PanelError }

/** The workspace-membership check the services run on every request. */
export type WorkspaceGate = (root: string) => Promise<GateVerdict>

/**
 * Normalize a path for prefix comparison: collapse Windows separators to `/`
 * and drop any trailing slash. On win32 the whole path is also lower-cased so
 * a case-insensitive FS cannot trip the membership check (the drive letter and
 * every segment are compared case-insensitively). On any other platform the
 * path separator and case are left untouched.
 */
export function normalizeForPrefix(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * The canonical prefix check: child must live inside (or equal) the root.
 * Separator- and case-robust on Windows: `path.join` yields backslashes while
 * git (`rev-parse --show-toplevel`) and the browser (`./x`) yield forward
 * slashes, so both sides are normalized to forward slashes before comparing,
 * and the comparison is case-insensitive on win32 (the FS is case-insensitive).
 */
export function isPathInside(root: string, child: string): boolean {
  if (root === '' || child === '') return false
  const normRoot = normalizeForPrefix(root)
  const normChild = normalizeForPrefix(child)
  if (normChild === normRoot) return true
  return normChild.startsWith(`${normRoot}/`)
}

/**
 * Production gate: canonicalize the requested root and require it to be a
 * registered workspace path (or a subdirectory of one). The host's workspace
 * registry owns canonicalization, so an unowned path is rejected outright.
 * @param ctx - context carrying the workspace service.
 * @returns the gate.
 */
export function createWorkspaceGate(ctx: Context): WorkspaceGate {
  return async (root) => {
    if (typeof root !== 'string' || root === '') {
      return { ok: false, error: { code: 'workspace-unknown', message: 'empty project root' } }
    }
    let canonical: string
    try {
      canonical = await realpath(root)
    } catch {
      return { ok: false, error: { code: 'workspace-unknown', message: 'path does not resolve on disk' } }
    }
    const workspaces = ctx.workspaceRegistry.list()
    for (const workspace of workspaces) {
      if (isPathInside(workspace.path, canonical)) {
        return { ok: true, canonical }
      }
    }
    return { ok: false, error: { code: 'workspace-unknown', message: 'path is not inside a registered workspace' } }
  }
}