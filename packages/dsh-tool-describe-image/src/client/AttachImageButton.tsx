/**
 * Composer image attach button: the browser-side answer to text-only models
 * having no image entry in the input box. Picking an image uploads its bytes
 * to the host /describe-image/attach route (validated and persisted in the
 * attachment store) and splices the returned `[image attachment …]` note into
 * the active session's draft — the text model then hands that exact JSON to
 * describe_image. The button mounts in the official `conversation.input.dock`
 * band and is session-routed through the injected verbs, so it works for
 * vision models too (harmless duplicate entry) and never touches the image
 * pipeline the shell owns.
 * @module @linxin666/dsh-tool-describe-image/client/AttachImageButton
 */

import { useRef, useState, type ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { admitPickedImage, NOTE_GUIDANCE, readFileAsBase64, uploadImageForDescribe } from './attach.ts'
import { t } from './locales.ts'

/** Injected business face of the attach button (session-routed). */
export interface AttachImageInjected {
  /** Splice a note into the active session's draft; false when no session/facade is available. */
  insertNote: (note: string) => boolean
  /** Surface a composer notice on the active session. */
  notify: (level: 'info' | 'error', text: string) => void
}

/** Composed props: the dock entry's runtime share + the injected verbs. */
export type AttachImageButtonProps =
  PropsRuntime<'conversation.input.dock'>
  & AttachImageInjected

/**
 * The dock entry: a small image button next to the composer's resident
 * chrome. One in-flight upload at a time; failures surface through the
 * composer notice, successes splice the note into the draft.
 * @param props - the injected verbs.
 */
export function AttachImageButton(props: AttachImageButtonProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const onPick = async (file: File | undefined): Promise<void> => {
    if (file === undefined || busy) return
    const admitted = admitPickedImage(file)
    if (!admitted.ok) {
      props.notify('error', t(admitted.reason === 'type' ? 'attach.error.type' : 'attach.error.size'))
      return
    }
    setBusy(true)
    try {
      const read = await readFileAsBase64(file)
      if (!read.ok) {
        props.notify('error', t('attach.error.read'))
        return
      }
      const upload = await uploadImageForDescribe(read.base64, file.type, file.name)
      if (!upload.ok) {
        props.notify('error', t('attach.error.upload', { error: upload.message }))
        return
      }
      if (!props.insertNote(upload.note + NOTE_GUIDANCE)) {
        props.notify('error', t('attach.error.noSession'))
        return
      }
      props.notify('info', t('attach.success'))
    } finally {
      setBusy(false)
      if (inputRef.current !== null) inputRef.current.value = ''
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t('attach.button.aria')}
      title={t('attach.button.title')}
      data-testid="describe-image-attach"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 6,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.6 : 1,
        color: 'var(--ds-text-secondary, #667085)',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={['image/png', 'image/jpeg', 'image/gif', 'image/webp'].join(',')}
        style={{ display: 'none' }}
        onChange={(event) => void onPick(event.target.files?.[0])}
      />
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </span>
  )
}
