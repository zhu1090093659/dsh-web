/**
 * Send interception: image-bearing sends first use the shell's native path.
 * Only an authoritative model-capability rejection triggers a plain-text
 * prompt carrying describe-image references. The images are uploaded through
 * the host attach route (so bytes stay out of the conversation log), the
 * draft images are released, and the text-only model analyzes them through
 * the describe_image tool rather than receiving bytes it cannot read.
 *
 * The hook wraps the conversation service's sendSession method in place. It
 * is structural (no dependency on the conversation package's internal
 * types) and idempotent (a module marker guards against double install).
 * @module @linxin666/dsh-tool-describe-image/client/send-hook
 */

import { readFileAsBase64, uploadImageForDescribe } from './attach.ts'

/** One draft image as the conversation service hands it back. */
interface DraftImageFace {
  readonly id: string
  readonly file: File
}

/** One text prompt block. */
interface TextBlock { type: 'text'; text: string }

/** Prompt result shape returned by the session RPC. */
interface PromptResult { ok: boolean; error?: { code: string; message?: string } }

/** The session face needed to re-send a text-only prompt. */
interface SessionPromptFace {
  prompt(content: readonly TextBlock[], mode: string): Promise<PromptResult>
}

/** The conversation-service surface this hook wraps. */
interface ConversationSendFace {
  send(text: string): Promise<void>
  sendSession(session: SessionPromptFace, text: string, imageIds: readonly string[], mode: string): Promise<void>
  draftImages(ids: readonly string[]): readonly DraftImageFace[]
  releaseDraftImage(id: string): void
}

/** Installed-marker key on the wrapped service instance. */
const HOOK_MARKER = '__dshDescribeImageSendHooked'

/** The exact flattened capability rejection emitted by the conversation client. */
function isImageCapabilityRejection(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false
  const details = (cause as { details?: unknown }).details
  if (typeof details === 'object' && details !== null
    && (details as { reason?: unknown }).reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES') {
    return true
  }
  const message = (cause as { message?: unknown }).message
  return typeof message === 'string'
    && /^conversation\.send failed: attachment-error: Model "[^"\r\n]+" does not support image input\.$/.test(message)
}

/**
 * Wrap the conversation service so image-bearing sends fall back through the
 * describe-image attach seam when the model rejects native image input. No-op
 * when the service surface is unavailable (older shell) or already wrapped.
 * When `isEnabled` is given it is read on every send: a disabled interception
 * passes straight through to the original `sendSession` (issue #301).
 * @param conversation - the `conversation` service instance.
 * @param isEnabled - live switch; consulted per send (default: always on).
 */
export function installSendHook(conversation: unknown, isEnabled?: () => boolean): void {
  const face = conversation as ConversationSendFace
  if (face === null || typeof face !== 'object') return
  if (typeof face.sendSession !== 'function') return
  if (typeof face.draftImages !== 'function' || typeof face.releaseDraftImage !== 'function') return
  if ((face as unknown as Record<string, unknown>)[HOOK_MARKER] === true) return

  const original = face.sendSession
  face.sendSession = async (session, text, imageIds, mode): Promise<void> => {
    if (isEnabled !== undefined && !isEnabled()) {
      return original.call(face, session, text, imageIds, mode)
    }
    if (imageIds.length === 0) {
      return original.call(face, session, text, imageIds, mode)
    }
    let capabilityError: unknown
    try {
      await original.call(face, session, text, imageIds, mode)
      return
    } catch (cause) {
      if (!isImageCapabilityRejection(cause)) throw cause
      capabilityError = cause
    }
    const attachments = face.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw capabilityError
    }
    const refs: string[] = []
    for (const attachment of attachments) {
      const read = await readFileAsBase64(attachment.file)
      if (!read.ok) break
      const upload = await uploadImageForDescribe(read.base64, attachment.file.type, attachment.file.name)
      if (!upload.ok) break
      refs.push(upload.markdown)
    }
    if (refs.length !== attachments.length) {
      throw capabilityError
    }
    const fullText = [text.trim(), ...refs].filter(part => part !== '').join('\n')
    const result = await session.prompt([{ type: 'text', text: fullText }], mode)
    if (!result.ok) {
      throw new Error(`conversation.send failed: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`)
    }
    for (const id of imageIds) face.releaseDraftImage(id)
  }
  ;(face as unknown as Record<string, unknown>)[HOOK_MARKER] = true
}
