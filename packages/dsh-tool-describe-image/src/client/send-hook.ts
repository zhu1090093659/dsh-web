/**
 * Send interception: text-only models reject image blocks at submit, so a
 * send that carries draft images is rewritten into a plain-text prompt that
 * carries durable describe-image references instead. The images are uploaded
 * through the host attach route (so bytes stay out of the conversation log),
 * the draft images are released, and the model analyzes them through the
 * describe_image tool rather than receiving the bytes it cannot read.
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
  prompt(content: readonly TextBlock[], mode: string, signal?: AbortSignal): Promise<PromptResult>
}

/** Submission result consumed by the conversation input state machine. */
interface SubmitOutcome { kind: 'success' | 'error'; text?: string }

/**
 * The conversation-service surface this hook wraps. rc.8 added the optional
 * AbortSignal (send cancellation) and a SubmitOutcome return on sendSession;
 * the wrapper forwards both so a wrapped send behaves exactly like an
 * unwrapped one, while the rewritten path passes the signal into the
 * session's prompt RPC.
 */
interface ConversationSendFace {
  send(text: string): Promise<void>
  sendSession(session: SessionPromptFace, text: string, imageIds: readonly string[], mode: string, signal?: AbortSignal): Promise<SubmitOutcome>
  draftImages(ids: readonly string[]): readonly DraftImageFace[]
  releaseDraftImage(id: string): void
}

/** Installed-marker key on the wrapped service instance. */
const HOOK_MARKER = '__dshDescribeImageSendHooked'

/**
 * Wrap the conversation service so image-bearing sends route through the
 * describe-image attach seam. No-op when the service surface is unavailable
 * (older shell) or already wrapped. When `isEnabled` is given it is read on
 * every send: a send that reports the interception disabled passes straight
 * through to the original `sendSession`, so other vision plugins keep the
 * raw image blocks (issue #301). When `acceptsImages` is given it is
 * consulted per image-bearing send: a session whose model accepts image
 * input passes straight through with the raw image blocks — rewriting them
 * into references would hide the images behind a redundant describe_image
 * call the model never needed. A checker failure answers false and the
 * legacy rewrite proceeds, so text-only models never lose the feature.
 * @param conversation - the `conversation` service instance.
 * @param isEnabled - live switch; consulted per send (default: always on).
 * @param acceptsImages - per-session capability predicate (default: always false).
 */
export function installSendHook(conversation: unknown, isEnabled?: () => boolean, acceptsImages?: (session: unknown) => Promise<boolean>): void {
  const face = conversation as ConversationSendFace
  if (face === null || typeof face !== 'object') return
  if (typeof face.sendSession !== 'function') return
  if (typeof face.draftImages !== 'function' || typeof face.releaseDraftImage !== 'function') return
  if ((face as unknown as Record<string, unknown>)[HOOK_MARKER] === true) return

  const original = face.sendSession
  face.sendSession = async (session, text, imageIds, mode, signal): Promise<SubmitOutcome> => {
    if (isEnabled !== undefined && !isEnabled()) {
      return original.call(face, session, text, imageIds, mode, signal)
    }
    if (imageIds.length === 0) {
      return original.call(face, session, text, imageIds, mode, signal)
    }
    if (acceptsImages !== undefined) {
      let native = false
      try {
        native = await acceptsImages(session)
      } catch {
        native = false
      }
      // The session's model takes image input: the raw blocks reach it
      // directly, so no describe-image reference rewrite is needed.
      if (native) {
        return original.call(face, session, text, imageIds, mode, signal)
      }
    }
    const attachments = face.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      return original.call(face, session, text, imageIds, mode, signal)
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
      // Upload fell short: keep the shell's original behavior (which will
      // reject the image block for a text-only model).
      return original.call(face, session, text, imageIds, mode, signal)
    }
    const fullText = [text.trim(), ...refs].filter(part => part !== '').join('\n')
    // Delegate to the original sendSession with the rewritten text and no image
    // IDs so the conversation service manages its state (clears the input, updates
    // the transcript, etc.) exactly as it would for a normal text-only send.
    // Only release draft images after a successful send so a failure preserves
    // the user's pasted images for retry.
    const outcome = await original.call(face, session, fullText, [], mode, signal)
    if (outcome.kind === 'success') for (const id of imageIds) face.releaseDraftImage(id)
    return outcome
  }
  ;(face as unknown as Record<string, unknown>)[HOOK_MARKER] = true
}
