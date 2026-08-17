/**
 * Browser half of dsh-file-drop.
 *
 * Listens for files dropped anywhere on the window, uploads each file to the
 * host upload route, and fills the composer input with a message carrying the
 * resulting on-disk path. It only fills the input — it never sends — so the
 * user can pair the file reference with task instructions before submitting.
 *
 * Failure policy: a failing drop or upload logs and leaves the composer
 * untouched; the plugin must never take the GUI down.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { dictionary } from './locales.ts'

/** One uploaded file: the user-facing name plus the on-disk path. */
export interface DroppedFile {
  name: string
  path: string
  /** Whether the path is the original location (false = a staged copy). */
  resolved?: boolean
}

/**
 * Compose the message text for a set of dropped files (pure, testable).
 * Just the paths — the path already carries the filename, so no header or
 * name lines. An unresolved (staged) copy keeps a short note so the user
 * knows the agent is reading a copy, not the original.
 */
export function composeDropMessage(files: readonly DroppedFile[], lang: string): string {
  const stagedNote = lang.toLowerCase().startsWith('en')
    ? ' (original not found; staged copy)'
    : '（未找到原路径，已暂存副本）'
  return files.map(file => file.path + (file.resolved === false ? stagedNote : '')).join('\n')
}

/**
 * Extract file:// original paths from an OS drag's text/uri-list payload
 * (macOS Finder drags sometimes carry them). Returns an absolute path whose
 * basename matches the given file name, or undefined.
 */
export function claimedOriginalPath(dataTransfer: DataTransfer | null, name: string): string | undefined {
  if (dataTransfer === null) return undefined
  const uriList = dataTransfer.getData('text/uri-list')
  if (uriList === '') return undefined
  const wanted = name.toLowerCase()
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (!trimmed.startsWith('file://')) continue
    try {
      const path = decodeURIComponent(trimmed.slice('file://'.length))
      const slash = path.indexOf('/')
      const local = slash === -1 ? '/' + path : path.slice(slash)
      if (local.split('/').pop()?.toLowerCase() === wanted) return local
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * Locate the conversation composer textarea. The composer input is the only
 * textarea carrying a data-phase attribute (its phase switch); context-form
 * textareas do not. A composer-seat scoped match wins, then any data-phase
 * textarea, then any editable textarea.
 */
export function findComposerTextarea(doc: Document): HTMLTextAreaElement | undefined {
  const editable = (element: HTMLTextAreaElement): boolean =>
    !element.disabled && !element.readOnly && element.getAttribute('aria-hidden') !== 'true'
  const phaseCandidates = Array.from(doc.querySelectorAll('textarea[data-phase]') as NodeListOf<HTMLTextAreaElement>)
    .filter(editable)
  const seated = phaseCandidates.find(element => element.closest('[data-composer-seat], [data-composer-card]') !== null)
  if (seated !== undefined) return seated
  if (phaseCandidates.length > 0) return phaseCandidates[0]
  return Array.from(doc.querySelectorAll('textarea') as NodeListOf<HTMLTextAreaElement>).find(editable)
}

/** Set a controlled React textarea via the native setter + input event. */
export function setTextareaValue(element: HTMLTextAreaElement, value: string): void {
  const prototype = window.HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter !== undefined) setter.call(element, value)
  else element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Upload one file to the host route; returns the resolved path or undefined. */
export async function uploadFile(file: File, originalPath?: string): Promise<DroppedFile | undefined> {
  try {
    // Filenames ride the header URI-encoded: raw non-ASCII (Chinese, spaces
    // and friends) is not a valid HTTP header value and fetch would throw.
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    }
    if (originalPath !== undefined) headers['x-original-path'] = encodeURIComponent(originalPath)
    const response = await fetch('/api/dsh-file-drop/upload', {
      method: 'POST',
      headers,
      body: await file.arrayBuffer(),
    })
    if (!response.ok) return undefined
    const body = await response.json() as { path?: unknown; resolved?: unknown }
    if (typeof body.path !== 'string') return undefined
    return { name: file.name, path: body.path, resolved: body.resolved === true }
  } catch (error) {
    console.error('[dsh-file-drop] upload failed:', error)
    return undefined
  }
}

/**
 * Mount the drop listener.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const onDragOver = (event: DragEvent): void => {
    // Capture phase: the GUI's own drag handlers may stop propagation, so the
    // window must see the event first and allow the drop everywhere.
    if (event.dataTransfer?.types.includes('Files') !== true) return
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (event: DragEvent): void => {
    const files = event.dataTransfer?.files
    if (files === undefined || files.length === 0) return
    event.preventDefault()
    void handleDrop(files, event.dataTransfer)
  }

  const handleDrop = async (fileList: FileList, dataTransfer: DataTransfer | null): Promise<void> => {
    const uploaded: DroppedFile[] = []
    for (const file of Array.from(fileList)) {
      const result = await uploadFile(file, claimedOriginalPath(dataTransfer, file.name))
      if (result !== undefined) uploaded.push(result)
    }
    if (uploaded.length === 0) return
    const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
    const message = composeDropMessage(uploaded, lang)
    const textarea = findComposerTextarea(document)
    if (textarea === undefined) {
      console.warn('[dsh-file-drop] composer textarea not found; message dropped:', message)
      return
    }
    const current = textarea.value
    const next = current === '' ? message : current + '\n' + message
    setTextareaValue(textarea, next)
    textarea.focus()
    try {
      textarea.setSelectionRange(next.length, next.length)
    } catch {
      // The selection APIs are unavailable on some synthetic textareas.
    }
  }

  ctx.effect(() => {
    // Capture phase so the window sees the drag before any inner handler can
    // stop propagation (the GUI's own drop zones included).
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, 'dsh-file-drop: drop listeners')
}

// Re-export the dictionary for the rare caller that wants the raw table.
export { dictionary }
