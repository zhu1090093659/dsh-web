/**
 * Browser half of the attach seam: pure draft-splicing math plus the
 * upload client for the host /describe-image/attach route. The browser
 * sends the picked image as base64 text; the host validates magic bytes,
 * persists the bytes in the attachment store, and returns the
 * `[image attachment …]` note text to splice into the composer draft.
 * Image bytes never enter the conversation log — only the note text does.
 * @module @linxin666/dsh-tool-describe-image/client/attach
 */

/** The host attach endpoint, same-origin with the web shell. */
export const ATTACH_ENDPOINT = '/describe-image/attach'

/** Image media types the button offers for upload (mirrors the host gate). */
export const ACCEPTED_IMAGE_MIME: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Client-side byte bound, matching the host default; the host re-checks. */
export const CLIENT_MAX_BYTES = 10 * 1024 * 1024

/**
 * Placeholder alt text of the markdown image reference; the model reads the
 * URL and extracts the attachment id. Kept deliberately short.
 */
export const IMAGE_ALT = '图片'

/**
 * Splice a note into a composer draft at the caret, following the same
 * separator rule the file-drag inlay uses: one space before the note unless
 * the caret sits at the start of the draft or right after whitespace; one
 * space after unless the caret sits at the end of the draft or right before
 * whitespace. Empty note or an out-of-range caret are no-ops.
 * @param draft - the current draft text.
 * @param note - the `[image attachment …]` note to insert.
 * @param caret - insertion offset (default: the end of the draft).
 * @returns the next draft; the caller owns writing it through the input facade.
 */
export function insertNoteIntoDraft(draft: string, note: string, caret?: number): string {
  if (note === '') return draft
  const at = caret === undefined ? draft.length : Math.min(Math.max(caret, 0), draft.length)
  const before = draft.slice(0, at)
  const after = draft.slice(at)
  const needBefore = before !== '' && !/\s$/.test(before)
  const needAfter = after !== '' && !/^\s/.test(after)
  return before + (needBefore ? ' ' : '') + note + (needAfter ? ' ' : '') + after
}

/**
 * Read a picked file as base64 text (no data-URL prefix).
 * @param file - the file the user picked.
 * @returns the base64 payload, or a structured rejection.
 */
export function readFileAsBase64(file: File): Promise<{ ok: true; base64: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve({ ok: false, message: 'read-failed' })
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      if (comma < 0) {
        resolve({ ok: false, message: 'read-failed' })
        return
      }
      resolve({ ok: true, base64: result.slice(comma + 1) })
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Upload base64 image bytes to the host attach route.
 * @param base64 - the base64 image payload.
 * @param mediaType - the declared media type (verified against magic bytes on the host).
 * @param name - optional display name.
 * @returns the `[image attachment …]` note text, or a structured rejection.
 */
export async function uploadImageForDescribe(
  base64: string,
  mediaType: string,
  name?: string,
): Promise<{ ok: true; note: string; markdown: string } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(ATTACH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: base64, mediaType, ...name === undefined ? {} : { name } }),
    })
  } catch {
    return { ok: false, message: 'network-failed' }
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return { ok: false, message: 'bad-response' }
  }
  const record = envelope as { ok?: unknown; value?: unknown; error?: unknown } | null
  if (typeof record !== 'object' || record === null) return { ok: false, message: 'bad-response' }
  if (record.ok === true && typeof record.value === 'object' && record.value !== null) {
    const value = record.value as { note?: unknown; markdown?: unknown }
    if (typeof value.note === 'string' && value.note !== '') {
      return { ok: true, note: value.note, markdown: typeof value.markdown === 'string' ? value.markdown : value.note }
    }
    return { ok: false, message: 'bad-response' }
  }
  const message = (record.error as { message?: unknown } | null)?.message
  return { ok: false, message: typeof message === 'string' && message !== '' ? message : 'server-failed' }
}

/**
 * Client-side admission for one picked file: accepted media type and byte
 * bound. The host re-validates everything, so this is fast feedback only.
 * @param file - the picked file.
 * @returns a structured rejection when the file cannot be uploaded.
 */
export function admitPickedImage(file: File): { ok: true } | { ok: false; reason: 'type' | 'size' } {
  if (!ACCEPTED_IMAGE_MIME.includes(file.type)) return { ok: false, reason: 'type' }
  if (file.size > CLIENT_MAX_BYTES) return { ok: false, reason: 'size' }
  return { ok: true }
}
