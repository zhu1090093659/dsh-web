/**
 * Card attachments: the durable metadata a card keeps about the files and
 * images it carries.
 *
 * The ledger stores METADATA only — never bytes, never base64, never a data
 * URL, never an upload timestamp. The bytes live in the official attachment
 * storage; this record says WHICH object, how large it is, and what it is, so
 * an execution can resolve the object and the Host can prove the recorded
 * claim against the storage before the claim reaches the ledger.
 *
 * The module is pure (no cordis, no runtime imports) so both halves — the Host
 * ledger and the browser form — share one vocabulary and one set of limits.
 */

/** What one attachment holds: a raster image or an arbitrary file. */
export type TaskAttachmentKind = 'image' | 'file'

/**
 * One attachment of a card: identity, size and type, plus the digest of the
 * exact bytes the Host stored.
 *
 * An image carries its intrinsic pixel size; a file carries neither. The
 * display name is always the CANONICAL form (see
 * {@link canonicalAttachmentName}): single-line, without any path part, so a
 * name can never break the prompt an execution reads.
 */
export interface TaskAttachment {
  /** Whether the object is a raster image or an arbitrary file. */
  kind: TaskAttachmentKind
  /** Opaque storage identifier of the stored object; never a path or a URL. */
  attachmentId: string
  /** Canonical display name; never a local path, never multi-line. */
  name: string
  /** Exact stored byte length. */
  bytes: number
  /** Media type of the stored bytes. */
  mediaType: string
  /** Lowercase hex sha256 digest of the exact stored bytes. */
  sha256: string
  /** Intrinsic pixel width; images only, always positive. */
  width?: number
  /** Intrinsic pixel height; images only, always positive. */
  height?: number
}

/** Maximum number of attachments one card may carry. */
export const TASK_ATTACHMENT_LIMIT = 8
/** Maximum byte length of one attachment (10 MiB). */
export const TASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
/** Maximum byte length of all attachments of one card together (32 MiB). */
export const TASK_ATTACHMENT_TOTAL_MAX_BYTES = 32 * 1024 * 1024
/** Raster media types the official image path accepts. */
export const TASK_ATTACHMENT_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Longest accepted display name of an attachment. */
const ATTACHMENT_NAME_MAX_LENGTH = 255
/** Longest accepted media type of an attachment. */
const ATTACHMENT_MEDIA_TYPE_MAX_LENGTH = 255
/** Longest accepted storage identifier of an attachment. */
const ATTACHMENT_ID_MAX_LENGTH = 512

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

/** Every key one attachment may carry. */
const ATTACHMENT_KEYS = ['kind', 'attachmentId', 'name', 'bytes', 'mediaType', 'sha256', 'width', 'height'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is a well-formed positive pixel count. */
function isPixelCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * The canonical display name of an attachment.
 *
 * A name reaches the ledger from two directions: the browser picks it, and an
 * execution prompt reads it. Both make one form mandatory — the name must be
 * a single line without any path part, so it can neither break out of the
 * prompt line nor point at a directory.
 *
 * The canonical form is therefore: the LEAF of whatever path-like text was
 * offered, every control character (a newline included) turned into a space,
 * whitespace runs collapsed into one space, the result trimmed and bounded.
 * An empty result becomes a fixed placeholder.
 *
 * The Host upload path canonicalizes the name BEFORE publishing it, and the
 * wire gate accepts only a name that already IS canonical — so the name the
 * ledger holds and the name the storage holds are the same string.
 * @param value - the offered name.
 * @returns the canonical name.
 */
export function canonicalAttachmentName(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  const leaf = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = leaf
    // oxlint-disable-next-line no-control-regex -- folding control characters into spaces IS the normalization.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return 'attachment'
  return cleaned.slice(0, ATTACHMENT_NAME_MAX_LENGTH)
}

/**
 * Whether an unknown value is a well-formed attachment (the STRICT gate: the
 * wire path uses it, so a hand-written payload cannot smuggle an extra field
 * onto the ledger, a path-like name, or an image without its pixel size).
 * @param value - the candidate attachment.
 * @returns whether the value is a usable attachment.
 */
export function isTaskAttachment(value: unknown): value is TaskAttachment {
  if (!isPlainObject(value)) return false
  if (Object.keys(value).some(key => !(ATTACHMENT_KEYS as readonly string[]).includes(key))) return false
  if (value.kind !== 'image' && value.kind !== 'file') return false
  if (typeof value.attachmentId !== 'string') return false
  const id = value.attachmentId
  if (id === '' || id.length > ATTACHMENT_ID_MAX_LENGTH) return false
  // A storage identifier is opaque: a value that looks like a path or a URL is
  // refused rather than stored, so no consumer can mistake it for one.
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return false
  if (typeof value.name !== 'string') return false
  // The name must ALREADY be canonical: a payload that carries a path, a
  // newline or a control character is refused rather than repaired, because
  // the client and the Host must agree on one name.
  if (value.name !== canonicalAttachmentName(value.name)) return false
  if (typeof value.bytes !== 'number' || !Number.isInteger(value.bytes) || value.bytes < 0) return false
  if (typeof value.mediaType !== 'string' || value.mediaType.length > ATTACHMENT_MEDIA_TYPE_MAX_LENGTH) return false
  if (!MEDIA_TYPE_PATTERN.test(value.mediaType)) return false
  // The media type is stored lowercased by the Host upload path, so the gate
  // requires the same form the Host produces.
  if (value.mediaType !== value.mediaType.toLowerCase()) return false
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) return false
  if (value.kind === 'image') {
    if (!TASK_ATTACHMENT_IMAGE_MEDIA_TYPES.includes(value.mediaType.toLowerCase() as typeof TASK_ATTACHMENT_IMAGE_MEDIA_TYPES[number])) return false
    // An image always carries its intrinsic pixel size: a record without one
    // cannot address the stored object, so it is refused rather than
    // completed with a manufactured 0x0.
    if (!isPixelCount(value.width) || !isPixelCount(value.height)) return false
  } else {
    // A file carries no pixel size: the fields exist for images only.
    if (value.width !== undefined || value.height !== undefined) return false
  }
  return true
}

/**
 * Repair one persisted attachment entry: canonicalize its name and keep the
 * fields that are usable. An entry that cannot be repaired — an unknown kind,
 * a malformed identifier, an image without its pixel size — is dropped.
 * @param value - the persisted entry.
 * @returns the repaired attachment, or undefined when it cannot be repaired.
 */
export function repairAttachment(value: unknown): TaskAttachment | undefined {
  if (!isPlainObject(value)) return undefined
  if (value.kind !== 'image' && value.kind !== 'file') return undefined
  if (typeof value.attachmentId !== 'string') return undefined
  const id = value.attachmentId
  if (id === '' || id.length > ATTACHMENT_ID_MAX_LENGTH) return undefined
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return undefined
  if (typeof value.bytes !== 'number' || !Number.isInteger(value.bytes) || value.bytes < 0) return undefined
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE_PATTERN.test(value.mediaType)) return undefined
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) return undefined
  const name = canonicalAttachmentName(value.name)
  if (value.kind === 'image') {
    if (!TASK_ATTACHMENT_IMAGE_MEDIA_TYPES.includes(value.mediaType.toLowerCase() as typeof TASK_ATTACHMENT_IMAGE_MEDIA_TYPES[number])) return undefined
    if (!isPixelCount(value.width) || !isPixelCount(value.height)) return undefined
    return {
      kind: 'image',
      attachmentId: id,
      name,
      bytes: value.bytes,
      mediaType: value.mediaType.toLowerCase(),
      sha256: value.sha256,
      width: value.width,
      height: value.height,
    }
  }
  if (value.width !== undefined || value.height !== undefined) return undefined
  return {
    kind: 'file',
    attachmentId: id,
    name,
    bytes: value.bytes,
    mediaType: value.mediaType.toLowerCase(),
    sha256: value.sha256,
  }
}

/**
 * Whether a list satisfies the card-wide attachment limits: the count, the
 * per-item byte cap, and the total byte cap.
 * @param attachments - the candidate list.
 * @returns whether the list fits every limit.
 */
export function attachmentsWithinLimits(attachments: readonly TaskAttachment[]): boolean {
  if (attachments.length > TASK_ATTACHMENT_LIMIT) return false
  let total = 0
  for (const attachment of attachments) {
    if (attachment.bytes > TASK_ATTACHMENT_MAX_BYTES) return false
    total += attachment.bytes
  }
  return total <= TASK_ATTACHMENT_TOTAL_MAX_BYTES
}

/**
 * Drop the repeated storage identifiers of a list, keeping the FIRST entry of
 * each identifier.
 *
 * The storage is content-addressed, so the same bytes uploaded twice produce
 * the same identifier. A list that carried the identifier twice would render
 * two rows for one object and claim it twice against the card's limits, so the
 * list is deduplicated at the boundary that can produce it.
 * @param attachments - the candidate list.
 * @returns the deduplicated list, in the original order.
 */
export function dedupeAttachments(attachments: readonly TaskAttachment[]): TaskAttachment[] {
  const seen = new Set<string>()
  const unique: TaskAttachment[] = []
  for (const attachment of attachments) {
    if (seen.has(attachment.attachmentId)) continue
    seen.add(attachment.attachmentId)
    unique.push(attachment)
  }
  return unique
}

/**
 * Whether an unknown value is a well-formed attachment LIST (the strict wire
 * gate). The list must be non-empty: clearing attachments is expressed by
 * omitting the field (create) or by an explicit null (update), never by an
 * empty array. A list that repeats one storage identifier is refused: one
 * object cannot be claimed twice.
 * @param value - the candidate list.
 * @returns whether the list may reach the ledger.
 */
export function isTaskAttachmentList(value: unknown): value is TaskAttachment[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0 || value.length > TASK_ATTACHMENT_LIMIT) return false
  if (!value.every(isTaskAttachment)) return false
  const list = value as TaskAttachment[]
  if (new Set(list.map(attachment => attachment.attachmentId)).size !== list.length) return false
  return attachmentsWithinLimits(list)
}

/**
 * Repair a persisted attachment list: canonicalize the names, drop the
 * entries that cannot be repaired, deduplicate the storage identifiers, and
 * cap the count and the byte totals. Returns undefined when nothing usable
 * remains, so the caller clears the field instead of storing an empty list —
 * the same policy the tag and schedule repairs follow.
 * @param value - the persisted value.
 * @returns the repaired list, or undefined when nothing survives.
 */
export function normalizeAttachments(value: unknown): TaskAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const repaired: TaskAttachment[] = []
  const seen = new Set<string>()
  let total = 0
  for (const entry of value) {
    const attachment = repairAttachment(entry)
    if (attachment === undefined) continue
    if (attachment.bytes > TASK_ATTACHMENT_MAX_BYTES) continue
    if (total + attachment.bytes > TASK_ATTACHMENT_TOTAL_MAX_BYTES) continue
    if (seen.has(attachment.attachmentId)) continue
    seen.add(attachment.attachmentId)
    total += attachment.bytes
    repaired.push(attachment)
    if (repaired.length >= TASK_ATTACHMENT_LIMIT) break
  }
  return repaired.length === 0 ? undefined : repaired
}

/**
 * The attachment of a list whose storage identifier matches, or undefined.
 * @param attachments - the list to search.
 * @param attachmentId - the storage identifier to find.
 * @returns the matching attachment, or undefined.
 */
export function findAttachment(
  attachments: readonly TaskAttachment[] | undefined,
  attachmentId: string,
): TaskAttachment | undefined {
  return attachments?.find(attachment => attachment.attachmentId === attachmentId)
}
