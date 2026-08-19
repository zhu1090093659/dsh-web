/**
 * Browser-side API client for the page-annotate panel: screenshot capture
 * through the host route, and image upload through the describe-image attach
 * seam (falling back to the plugin's own attach route).
 * @module @linxin666/dsh-page-annotate/client/api
 */

/** One screenshot capture request. */
export interface CaptureRequest {
  url: string
  width: number
  height: number
}

/** A successful capture value. */
export interface CaptureValue {
  data: string
  mediaType: string
  width: number
  height: number
  engine: string
}

/** Result of a capture call. */
export type CaptureOutcome = { ok: true; value: CaptureValue } | { ok: false; code: string; message: string }

interface BrowserEnvelopeValue extends Partial<CaptureValue> {
  url?: string
}

/** Open or navigate the user-triggered persistent desktop browser. */
export async function openInteractiveBrowser(url: string): Promise<{ ok: true; url: string } | { ok: false; code: string; message: string }> {
  const outcome = await postBrowser('/page-annotate/browser/open', { url })
  if (!outcome.ok) return outcome
  return { ok: true, url: typeof outcome.value.url === 'string' ? outcome.value.url : url }
}

/** Capture the current page in the persistent desktop browser. */
export async function captureInteractiveBrowser(width: number, height: number): Promise<CaptureOutcome & { url?: string }> {
  const outcome = await postBrowser('/page-annotate/browser/capture', { viewport: { width, height } })
  if (!outcome.ok) return outcome
  const value = outcome.value as CaptureValue
  if (typeof value.data !== 'string' || value.data === '') return { ok: false, code: 'bad-response', message: 'capture returned no image data' }
  return { ok: true, value, url: typeof outcome.value.url === 'string' ? outcome.value.url : undefined }
}

async function postBrowser(path: string, body: unknown): Promise<{ ok: true; value: BrowserEnvelopeValue } | { ok: false; code: string; message: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
    const envelope = (await response.json()) as { ok?: unknown; value?: BrowserEnvelopeValue; error?: { code?: unknown; message?: unknown } } | null
    if (envelope?.ok === true && envelope.value !== undefined) return { ok: true, value: envelope.value }
    return { ok: false, code: typeof envelope?.error?.code === 'string' ? envelope.error.code : 'server-failed', message: typeof envelope?.error?.message === 'string' ? envelope.error.message : 'HTTP ' + response.status }
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError'
    return { ok: false, code: timedOut ? 'timeout' : 'network-failed', message: timedOut ? 'interactive browser request timed out' : 'interactive browser request failed' }
  } finally {
    clearTimeout(timer)
  }
}

/** Request a screenshot from the host route. */
export async function captureScreenshot(request: CaptureRequest): Promise<CaptureOutcome> {
  try {
    const response = await fetch('/page-annotate/screenshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: request.url, viewport: { width: request.width, height: request.height } }),
    })
    const envelope = (await response.json()) as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } } | null
    if (envelope !== null && envelope.ok === true && typeof envelope.value === 'object' && envelope.value !== null) {
      const value = envelope.value as CaptureValue
      if (typeof value.data === 'string' && value.data !== '') {
        return { ok: true, value }
      }
      return { ok: false, code: 'bad-response', message: 'capture returned no image data' }
    }
    const code = envelope?.error?.code
    const message = envelope?.error?.message
    return { ok: false, code: typeof code === 'string' ? code : 'server-failed', message: typeof message === 'string' ? message : 'HTTP ' + response.status }
  } catch {
    return { ok: false, code: 'network-failed', message: 'capture request failed' }
  }
}

/** Upload one image and receive the durable Markdown reference. */
export type UploadOutcome = { ok: true; markdown: string } | { ok: false; message: string }

/** Try the describe-image attach route first, then the plugin's own seam. */
export async function uploadAnnotatedImage(base64: string, mediaType: string, name: string): Promise<UploadOutcome> {
  const body = JSON.stringify({ data: base64, mediaType, name })
  const describe = await postAttach('/describe-image/attach', body)
  if (describe.ok) return describe
  return postAttach('/page-annotate/attach', body)
}

/** POST one attach route and unwrap the envelope. */
async function postAttach(path: string, body: string): Promise<UploadOutcome> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const envelope = (await response.json()) as { ok?: unknown; value?: unknown; error?: { message?: unknown } } | null
    if (envelope !== null && envelope.ok === true && typeof envelope.value === 'object' && envelope.value !== null) {
      const markdown = (envelope.value as { markdown?: unknown }).markdown
      if (typeof markdown === 'string' && markdown !== '') return { ok: true, markdown }
    }
    const message = envelope?.error?.message
    return { ok: false, message: typeof message === 'string' ? message : 'HTTP ' + response.status }
  } catch {
    return { ok: false, message: 'upload request failed' }
  }
}

/**
 * Splice a note into a composer draft at the caret, following the same
 * separator rule as the family's file-drag inlay.
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
