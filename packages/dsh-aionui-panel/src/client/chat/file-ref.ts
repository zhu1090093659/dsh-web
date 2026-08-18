/**
 * Chat file-reference click handling (issue #314): the transcript renders
 * workspace file paths as inline code, and clicking one should locate the
 * file in the Explorer (switch to the Files tab, expand the ancestor chain,
 * select the node) and open it in the Preview panel — directories are
 * reveal-only. A document-level click listener (wired in the client apply)
 * recognizes a conservative subset: a single-line `code` element whose text
 * is a workspace-relative path or an absolute path under the project root.
 * Links (`a`), multi-line fences, URLs, escaped (`..`) paths and anything
 * inside the panels' own subtrees keep their existing behavior.
 * @module dsh-aionui-panel/client/chat/file-ref
 */

import type { PanelApi } from '../api.ts'
import type { PanelStores } from '../store.ts'
import { parentRel } from '../fileType.ts'

/** Longest candidate text (arbitrary safety cap against huge code spans). */
const MAX_REF_LENGTH = 512

/** Normalize both separators to '/'. */
function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

/**
 * Interpret a code span's text as a workspace path. Returns the workspace
 * RELATIVE path ('' = the root itself), or null when the text is not a
 * recognizable in-workspace path. Never resolves above the root: `..`
 * segments, absolute outside paths, URLs and whitespace/multi-line text all
 * fall back to null so the transcript keeps its normal behavior.
 */
export function pathFromText(text: string, root: string): string | null {
  const raw = text.trim()
  if (raw === '' || raw.length > MAX_REF_LENGTH) return null
  if (/[\r\n]/.test(raw)) return null
  if (raw.includes('://')) return null
  const normalized = normalizeSlashes(raw)
  const rootNorm = normalizeSlashes(root).replace(/\/+$/, '')
  if (rootNorm === '') return null

  // Absolute path inside the workspace. Posix paths start with '/'
  // (case-sensitive prefix match); Windows drive paths carry a drive
  // letter (case-insensitive prefix match with a separator boundary).
  if (normalized.startsWith('/')) {
    if (normalized === rootNorm) return ''
    if (!normalized.startsWith(rootNorm + '/')) return null
    const rel = normalized.slice(rootNorm.length).replace(/^\/+/, '')
    return validRelative(rel) ? rel : null
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    const lower = normalized.toLowerCase()
    const lowerRoot = rootNorm.toLowerCase()
    if (lower === lowerRoot) return ''
    if (!lower.startsWith(lowerRoot + '/')) return null
    const rel = normalized.slice(rootNorm.length).replace(/^\/+/, '')
    return validRelative(rel) ? rel : null
  }

  // Workspace-relative path ('.' prefix stripped).
  const rel = normalized.startsWith('./') ? normalized.slice(2) : normalized
  return validRelative(rel) ? rel : null
}

/** Validate a relative path: no escapes, no whitespace, looks path-like. */
function validRelative(rel: string): boolean {
  if (rel === '' || rel.length > MAX_REF_LENGTH) return false
  if (/\s/.test(rel)) return false
  const segments = rel.split('/')
  if (segments.length < 2) {
    // A bare name is accepted only when it looks like a file (dotted), so
    // ordinary words in code spans never trigger a locate.
    return /^[^/]*\.[^/]+$/.test(rel)
  }
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return false
  }
  return true
}

/** The `code` element a click targets, when it is a candidate file ref. */
export function fileRefElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const code = target.closest('code')
  if (code === null) return null
  // Links keep their own navigation; the panels' own code blocks (preview
  // editors, tree rows) never trigger the transcript locate.
  if (code.closest('a') !== null) return null
  if (code.closest('.aionui-root') !== null) return null
  if (code.closest('[data-aionui-preview-col], [data-aionui-explorer-col]') !== null) return null
  return code
}

/**
 * Locate a workspace-relative path from the transcript: Files tab + expand
 * ancestors + select; directories stay reveal-only, files also open in the
 * Preview panel (dedup focuses the existing tab). The parent listing is
 * consulted to classify the node; unknown paths keep the reveal and never
 * issue a preview request.
 */
export async function locateFileRef(stores: PanelStores, api: PanelApi, rel: string): Promise<void> {
  const explorer = stores.explorer
  explorer.setActiveTab('files')
  if (rel !== '') explorer.reveal(rel)

  const root = stores.layout.getSnapshot().root
  if (root === '' || rel === '') return

  const name = rel.split('/').pop() ?? ''
  const parent = parentRel(rel)
  let entry = explorer.getSnapshot().dirs[parent]?.find((item) => item.name === name)
  if (entry === undefined) {
    const result = await api.list(root, parent)
    if (result.ok) entry = result.value.entries.find((item) => item.name === name)
  }
  // Known directories: reveal-only (their children list is the tree's job).
  // Known files: open in the preview panel. Unknown: no preview request.
  if (entry !== undefined && !entry.isDir) {
    stores.preview.openFile(root, rel)
  }
}

/** Document-level click handler: locate recognized chat file references. */
export function handleFileRefClick(stores: PanelStores, api: PanelApi, event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return
  const code = fileRefElement(event.target)
  if (code === null) return
  const root = stores.layout.getSnapshot().root
  if (root === '') return
  const rel = pathFromText(code.textContent ?? '', root)
  if (rel === null) return
  // The explorer must be visible for the reveal to be seen: un-collapse the
  // column (persisted like the chevron toggle does).
  const layout = stores.layout.getSnapshot()
  if (layout.explorerCollapsed) {
    stores.layout.update((prev) => ({ ...prev, explorerCollapsed: false }))
    try {
      localStorage.setItem(`project-panel-collapse:${root}`, 'expanded')
    } catch {
      // best-effort
    }
  }
  void locateFileRef(stores, api, rel)
}
