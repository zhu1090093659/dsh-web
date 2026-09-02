/**
 * Durable image-attachment reference parsing and Markdown serialization shared by
 * the host attach route and the vision loader. Generated Markdown carries the
 * complete immutable reference, so it survives process restarts and PTC Mode
 * nested tool dispatch without relying on the short-lived id registry.
 * @module @linxin666/dsh-tool-describe-image/attachment-reference
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { isImageMimeType } from './media.ts'

/** Error text shown when a model-supplied attachment reference does not validate. */
export const ATTACHMENT_REF_GUIDANCE =
  'describe-image: image is not a valid attachment reference; pass the complete [image attachment ...] note or generated Markdown reference'

const ATTACHMENT_NOTE_PREFIX = '[image attachment '
const MARKDOWN_REFERENCE = /^!\[[^\]]*]\((\/describe-image\/raw\/([^/?\s)]+)(?:\?[^)\s]*)?)\)$/

/** Escape a URL component for Markdown, including delimiters encodeURIComponent leaves literal. */
function encodeMarkdownComponent(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** One attachment reference found in the plugin's Markdown image syntax. */
export interface MarkdownAttachmentReference {
  /** Attachment id carried by the raw-image route path. */
  attachmentId: string
  /** Complete durable reference when the Markdown came from the current attach route. */
  ref?: ImageAttachmentRef
}

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Whether a record field holds a positive safe integer. */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** A non-empty string from a record under `key`, else undefined. */
function nonEmptyString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Remove the optional `[image attachment ...]` carrier around its JSON reference. */
function unwrapAttachmentNote(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith(ATTACHMENT_NOTE_PREFIX)) return trimmed
  if (!trimmed.endsWith(']')) throw new Error(ATTACHMENT_REF_GUIDANCE)
  return trimmed.slice(ATTACHMENT_NOTE_PREFIX.length, -1).trim()
}

/** Remove unambiguous structural JSON corruption produced during model transcriptions. */
function repairImageRefJson(raw: string): string {
  return raw
    .replace(/:\s*([}\]])/g, '$1')
    .replace(/,\s*,+/g, ',')
    .replace(/,\s*([}\]])/g, '$1')
    .trim()
}

/**
 * Validate and narrow a model-supplied attachment reference into its typed storage
 * form. It accepts either the raw JSON reference or its complete note carrier.
 * @param raw - JSON or `[image attachment ...]` content from a session message.
 * @returns the narrowed, typed reference.
 */
export function parseImageAttachmentRef(raw: string): ImageAttachmentRef {
  const unwrapped = unwrapAttachmentNote(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapped)
  } catch {
    try {
      parsed = JSON.parse(repairImageRefJson(unwrapped))
    } catch {
      throw new Error(ATTACHMENT_REF_GUIDANCE)
    }
  }
  const record = asRecord(parsed)
  if (record === undefined) throw new Error(ATTACHMENT_REF_GUIDANCE)
  const attachmentId = nonEmptyString(record, 'attachmentId')
  const mediaType = record['mediaType']
  const bytes = record['bytes']
  const width = record['width']
  const height = record['height']
  const name = record['name']
  if (attachmentId === undefined
    || !isImageMimeType(mediaType)
    || !isPositiveSafeInteger(bytes)
    || !isPositiveSafeInteger(width)
    || !isPositiveSafeInteger(height)
    || (name !== undefined && typeof name !== 'string')) {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  return {
    attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType,
    bytes,
    width,
    height,
    ...name === undefined ? {} : { name },
  }
}

/**
 * Parse the plugin's Markdown image form. Legacy id-only Markdown yields no `ref`;
 * current Markdown embeds the full immutable reference in its query string.
 * @param raw - a complete Markdown image reference.
 * @returns the parsed route id and optional durable reference, or undefined when not this syntax.
 */
export function parseMarkdownAttachmentReference(raw: string): MarkdownAttachmentReference | undefined {
  const match = MARKDOWN_REFERENCE.exec(raw.trim())
  if (match === null) return undefined
  let attachmentId: string
  try {
    attachmentId = decodeURIComponent(match[2] ?? '')
  } catch {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  if (attachmentId === '') throw new Error(ATTACHMENT_REF_GUIDANCE)
  const url = new URL(match[1] ?? '', 'http://dsh.local')
  const encodedRef = url.searchParams.get('ref')
  if (encodedRef === null) return { attachmentId }
  try {
    const ref = parseImageAttachmentRef(encodedRef)
    if (ref.attachmentId === attachmentId) {
      return { attachmentId, ref }
    }
  } catch {
    // Malformed/mismatched ref falls back to registry resolution by attachmentId
  }
  return { attachmentId }
}

/** Render a Markdown image reference for either a durable reference or a legacy id. */
export function attachmentMarkdown(ref: ImageAttachmentRef): string
/** Render the legacy id-only Markdown form for callers that have no metadata. */
export function attachmentMarkdown(attachmentId: string): string
export function attachmentMarkdown(refOrId: ImageAttachmentRef | string): string {
  const attachmentId = typeof refOrId === 'string' ? refOrId : refOrId.attachmentId
  const encodedId = encodeMarkdownComponent(attachmentId).replace(/%3A/gi, ':')
  if (typeof refOrId === 'string') return `![图片](/describe-image/raw/${encodedId})`
  const serializedRef = encodeMarkdownComponent(JSON.stringify(refOrId))
  return `![图片](/describe-image/raw/${encodedId}?ref=${serializedRef})`
}
