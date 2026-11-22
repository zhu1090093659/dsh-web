/**
 * The attachment field of the create and edit forms.
 *
 * A file the user picks is STAGED locally first: the form shows a preview,
 * the name and the size, and nothing leaves the browser until the card is
 * saved. The upload therefore happens on save, not on selection — a card the
 * user abandons never leaves a stored object behind.
 *
 * Three input modes are supported: drag and drop, paste, and the file picker.
 * All three end in the same staged list.
 */
import { useEffect, useRef, useState } from 'react'
import {
  TASK_ATTACHMENT_IMAGE_MEDIA_TYPES,
  TASK_ATTACHMENT_LIMIT,
  TASK_ATTACHMENT_MAX_BYTES,
  TASK_ATTACHMENT_TOTAL_MAX_BYTES,
  type TaskAttachment,
  type TaskAttachmentKind,
} from '../../core/attachment.ts'
import { attachmentImageUrl } from '../host-api.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { IconClose } from './icons.tsx'

/** One file the user staged locally; it is uploaded when the card is saved. */
export interface StagedAttachment {
  /** Stable id of the staged row (a monotonic counter, never a clock reading). */
  id: string
  /** The picked file. */
  file: File
  /** Whether the file is uploaded as an image or as a verbatim file. */
  kind: TaskAttachmentKind
  /** Display name of the file. */
  name: string
  /** Byte length of the file. */
  bytes: number
  /** Declared media type of the file. */
  mediaType: string
  /** Local object URL of the preview; images only. */
  previewUrl?: string
  /** True while the file is being uploaded. */
  pending?: boolean
  /** Why the upload failed, when it did. */
  error?: string
}

/** What the card will carry once the form is saved. */
export interface AttachmentSelection {
  /** The attachments already stored on the card and kept by the user. */
  persisted: TaskAttachment[]
  /** The files staged locally and uploaded on save. */
  staged: StagedAttachment[]
}

/** The limits the deployment publishes for attachments. */
export interface AttachmentLimits {
  maxAttachments: number
  maxBytes: number
  maxTotalBytes: number
  /** Maximum number of IMAGES one card may carry (the official per-message budget). */
  maxImages: number
  /** Maximum byte length of one image. */
  maxImageBytes: number
  /** Maximum byte length of all images of one card together. */
  maxMessageImageBytes: number
}

/** The board's own limits, used when the deployment publishes none. */
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxAttachments: TASK_ATTACHMENT_LIMIT,
  maxBytes: TASK_ATTACHMENT_MAX_BYTES,
  maxTotalBytes: TASK_ATTACHMENT_TOTAL_MAX_BYTES,
  maxImages: TASK_ATTACHMENT_LIMIT,
  maxImageBytes: TASK_ATTACHMENT_MAX_BYTES,
  maxMessageImageBytes: TASK_ATTACHMENT_TOTAL_MAX_BYTES,
}

/** A human-readable byte size. */
export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/**
 * Whether a picked file is uploaded as an image.
 *
 * Only the raster types the official image path accepts are images; every
 * other file is stored verbatim.
 */
export function attachmentKindOf(file: File): TaskAttachmentKind {
  const type = file.type.toLowerCase()
  return TASK_ATTACHMENT_IMAGE_MEDIA_TYPES.includes(type as typeof TASK_ATTACHMENT_IMAGE_MEDIA_TYPES[number])
    ? 'image'
    : 'file'
}

/** One row of the attachment list: a stored attachment or a staged file. */
interface AttachmentRow {
  /** Stable key of the row. */
  key: string
  /** The stored attachment, when the row shows one. */
  attachment?: TaskAttachment
  /** The staged file, when the row shows one. */
  staged?: StagedAttachment
}

/** The byte total of a selection: the stored attachments plus the staged files. */
function totalBytesOf(selection: AttachmentSelection): number {
  return selection.persisted.reduce((sum, attachment) => sum + attachment.bytes, 0)
    + selection.staged.reduce((sum, staged) => sum + staged.bytes, 0)
}

/** The byte total of the IMAGES of a selection. */
function imageBytesOf(selection: AttachmentSelection): number {
  return selection.persisted
    .filter(attachment => attachment.kind === 'image')
    .reduce((sum, attachment) => sum + attachment.bytes, 0)
    + selection.staged
    .filter(staged => staged.kind === 'image')
    .reduce((sum, staged) => sum + staged.bytes, 0)
}

/** The number of IMAGES of a selection. */
function imageCountOf(selection: AttachmentSelection): number {
  return selection.persisted.filter(attachment => attachment.kind === 'image').length
    + selection.staged.filter(staged => staged.kind === 'image').length
}

/**
 * The staged files the form already holds.
 *
 * The identity is the File OBJECT, never its metadata: two different files can
 * share a name, a size, a type and a modification time, and inferring byte
 * identity from those four would silently discard one of them. The form
 * therefore stages every distinct File it is handed.
 *
 * The content identity that actually matters — the storage identifier the Host
 * answers with — is applied AFTER the upload, where it is authoritative
 * (see the core dedupe). The only case the form skips is the very same File
 * object handed over twice, which is the same row twice.
 */
function stagedFileSet(staged: readonly StagedAttachment[]): Set<File> {
  return new Set(staged.map(entry => entry.file))
}

/**
 * The attachment field of a card form.
 *
 * The component owns the local staging only: the selection it reports is what
 * the card will carry, and the parent uploads the staged files on save.
 */
export function AttachmentField({
  selection,
  onChange,
  limits,
  disabled = false,
  lockedHint,
  onError,
}: {
  /** What the card currently carries and what is staged on top of it. */
  selection: AttachmentSelection
  /** Receives the new selection after every change. */
  onChange: (selection: AttachmentSelection) => void
  /** The deployment limits; the board's own limits are used when absent. */
  limits?: AttachmentLimits
  /** Whether the field refuses new input. */
  disabled?: boolean
  /** Replaces the inviting upload hint when the caller locks the field. */
  lockedHint?: string
  /** Receives the reason a selection was refused. */
  onError?: (message: string) => void
}) {
  const effective = limits ?? DEFAULT_ATTACHMENT_LIMITS
  const inputRef = useRef<HTMLInputElement | null>(null)
  const objectUrls = useRef<string[]>([])
  const counter = useRef(0)
  const [dragging, setDragging] = useState(false)

  // The object URLs belong to this component: they are released when the form
  // closes, so a discarded card leaves no preview behind.
  useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url)
    objectUrls.current = []
  }, [])

  const addFiles = (files: readonly File[]): void => {
    if (disabled || files.length === 0) return
    const staged = [...selection.staged]
    // Only the very same File object is skipped: the browser hands the same
    // object again when a picker reports one selection twice, and that is the
    // one case where a second row would duplicate the first. Two DIFFERENT
    // files that merely share their metadata are two files, and both stage.
    const seen = stagedFileSet(staged)
    let total = totalBytesOf(selection)
    let imageBytes = imageBytesOf(selection)
    let imageCount = imageCountOf(selection)
    let added = 0
    for (const file of files) {
      if (seen.has(file)) continue
      if (selection.persisted.length + staged.length >= effective.maxAttachments) {
        onError?.(t('new.attachments.limitCount', { count: String(effective.maxAttachments) }))
        break
      }
      const kind = attachmentKindOf(file)
      const limit = kind === 'image'
        ? Math.min(effective.maxBytes, effective.maxImageBytes ?? effective.maxBytes)
        : effective.maxBytes
      if (file.size > limit) {
        onError?.(t('new.attachments.limitSize', { name: file.name, size: formatAttachmentBytes(limit) }))
        continue
      }
      if (total + file.size > effective.maxTotalBytes) {
        onError?.(t('new.attachments.limitTotal', { size: formatAttachmentBytes(effective.maxTotalBytes) }))
        break
      }
      // The official per-message image budget: the count of images and their
      // total bytes are what one prompt carries.
      if (kind === 'image') {
        if (imageCount + 1 > effective.maxImages) {
          onError?.(t('new.attachments.limitImages', { count: String(effective.maxImages) }))
          break
        }
        if (imageBytes + file.size > effective.maxMessageImageBytes) {
          onError?.(t('new.attachments.limitImageBytes', { size: formatAttachmentBytes(effective.maxMessageImageBytes) }))
          break
        }
      }
      const previewUrl = kind === 'image' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : undefined
      if (previewUrl !== undefined) objectUrls.current.push(previewUrl)
      counter.current += 1
      seen.add(file)
      staged.push({
        id: `staged-${counter.current}`,
        file,
        kind,
        name: file.name,
        bytes: file.size,
        mediaType: file.type,
        ...(previewUrl === undefined ? {} : { previewUrl }),
      })
      total += file.size
      if (kind === 'image') {
        imageBytes += file.size
        imageCount += 1
      }
      added += 1
    }
    if (added > 0) onChange({ ...selection, staged })
  }

  const removeStaged = (id: string): void => {
    const target = selection.staged.find(staged => staged.id === id)
    if (target?.previewUrl !== undefined) {
      URL.revokeObjectURL(target.previewUrl)
      objectUrls.current = objectUrls.current.filter(url => url !== target.previewUrl)
    }
    onChange({ ...selection, staged: selection.staged.filter(staged => staged.id !== id) })
  }

  const removePersisted = (attachmentId: string): void => {
    onChange({
      ...selection,
      persisted: selection.persisted.filter(attachment => attachment.attachmentId !== attachmentId),
    })
  }

  // One row per attachment: the stored ones and the staged files, in the
  // order the user sees them.
  const rows: AttachmentRow[] = [
    ...selection.persisted.map(attachment => ({ key: attachment.attachmentId, attachment })),
    ...selection.staged.map(staged => ({ key: staged.id, staged })),
  ]

  return (
    <div className={css.field} data-dsh-part="form-section">
      <span className={css.fieldLabel}>{t('new.attachments')}</span>
      {/* When the caller locks the field (an executed card), the inviting
          upload hint is replaced by why the field refuses input. */}
      <span className={css.fieldHint}>{lockedHint ?? t('new.attachmentsHint')}</span>
      <div
        className={css.attachmentDrop}
        // A disabled field is not styled as a drop target: the drag state is
        // the field's own, and a field that refuses input must not invite it.
        data-state={dragging && !disabled ? 'active' : undefined}
        data-disabled={disabled ? 'true' : undefined}
        // The region is focusable and keyboard-operable: Enter or Space opens
        // the picker. The button inside it owns its own activation, so a key
        // press there is not handled twice. A DISABLED field leaves the tab
        // order and says so, instead of staying focusable and inert.
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled ? true : undefined}
        aria-label={t('new.attachments.drop')}
        onKeyDown={event => {
          if (disabled) return
          if (event.target !== event.currentTarget) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          inputRef.current?.click()
        }}
        onDragOver={event => {
          event.preventDefault()
          if (disabled) return
          setDragging(true)
        }}
        onDragLeave={() => { if (!disabled) setDragging(false) }}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          addFiles(Array.from(event.dataTransfer?.files ?? []))
        }}
        onPaste={event => {
          const files = Array.from(event.clipboardData?.files ?? [])
          if (files.length === 0) return
          event.preventDefault()
          addFiles(files)
        }}
      >
        <span className={css.attachmentDropHint}>{t('new.attachments.drop')}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          // A disabled field cannot be opened, so the picker itself is
          // disabled: the region never opens a picker it must not open.
          disabled={disabled}
          onChange={event => {
            addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className={css.ghostButton}
          disabled={disabled}
          onClick={() => {
            if (disabled) return
            inputRef.current?.click()
          }}
        >
          {t('new.attachments.pick')}
        </button>
      </div>
      {rows.length > 0 && (
        <ul className={css.attachmentList}>
          {rows.map(row => (
            <li className={css.attachmentRow} key={row.key}>
              {row.attachment !== undefined && row.attachment.kind === 'image'
                ? <img className={css.attachmentThumb} src={attachmentImageUrl(row.attachment.attachmentId)} alt={row.attachment.name} />
                : null}
              {row.staged !== undefined && row.staged.kind === 'image' && row.staged.previewUrl !== undefined
                ? <img className={css.attachmentThumb} src={row.staged.previewUrl} alt={row.staged.name} />
                : null}
              <span className={css.attachmentName}>
                {row.attachment?.name ?? row.staged?.name}
                <span className={css.attachmentMeta}>
                  {' '}
                  {formatAttachmentBytes(row.attachment?.bytes ?? row.staged?.bytes ?? 0)}
                  {row.staged?.pending === true ? ` · ${t('new.attachments.uploading')}` : ''}
                  {row.staged?.error !== undefined ? ` · ${row.staged.error}` : ''}
                </span>
              </span>
              <button
                type="button"
                className={css.iconButton}
                // A pending submission owns the set it is about to send: the
                // removal controls are disabled while it is in flight, so the
                // submitted set cannot race a user edit.
                disabled={disabled}
                aria-label={t('new.attachments.remove', { name: row.attachment?.name ?? row.staged?.name ?? '' })}
                onClick={() => {
                  if (row.attachment !== undefined) removePersisted(row.attachment.attachmentId)
                  else if (row.staged !== undefined) removeStaged(row.staged.id)
                }}
              >
                <IconClose size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
