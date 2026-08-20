/**
 * Status-decoration contract — the L3 extension slot for small status
 * ornaments (issue #623 milestone M5, protocol #567, first reference
 * implementation #463). A decoration is an INDEPENDENT content entry (own
 * id, own directory, own descriptor) whose PNG/WebP sprite strip ornaments
 * the pet center's status bubble chrome; it never touches the pet
 * manifests and never changes the bubble's semantics.
 *
 * Adopted disciplines (#623): entry assets are PNG/WebP sprite strips only
 * (no SVG, no CSS animation); the bubble's own role=status/aria-live (or
 * session-bubble button semantics) always stays intact and the ornament is
 * aria-hidden; load failure or prefers-reduced-motion degrades to no
 * ornament or the static first frame.
 *
 * The ActivityPhase stream the pet center owns drives the ornament: each
 * phase binds to a frame segment (inclusive from/to indices into the
 * strip) or to 'hide' (no ornament for that phase; the default).
 * @module @linxin666/dsh-pet/contracts/status-decoration
 */

import type { ActivityPhase } from '../state.ts'

/** Contract version decorations declare against (independent of manifests). */
export const PET_DECORATION_API_VERSION = 'x-org.linxin666.pet-center/status-decoration-v1' as const

/** One phase binding: a frame segment, or hidden. */
export type PhaseSegment = { from: number; to: number } | 'hide'

/** The ActivityPhase -> frame-segment binding table (unmapped phases hide). */
export type PhaseBindings = Partial<Record<ActivityPhase, PhaseSegment>>

/** Normalized decoration descriptor as the registry consumes it. */
export interface DecorationManifest {
  decorationManifestVersion: 1
  id: string
  displayName: string
  license: string
  /** Strip path relative to the descriptor directory (PNG/WebP). */
  entry: string
  cell: { width: number; height: number }
  columns: number
  /** Per-frame duration ms (same length as columns, or a single constant). */
  durations: number[]
  loop: boolean
  phases: PhaseBindings
}

/** One structured diagnostic emitted while parsing a descriptor. */
export interface DecorationDiagnostic {
  level: 'error' | 'warning'
  message: string
}

/** Parse outcome: a usable descriptor plus diagnostics, or rejection. */
export type DecorationManifestParse =
  | { ok: true; manifest: DecorationManifest; diagnostics: DecorationDiagnostic[] }
  | { ok: false; diagnostics: DecorationDiagnostic[] }

/**
 * The decoration block the host serves inside the pet state view — exactly
 * what the browser half needs to render the ornament, nothing more. The
 * apiVersion rides the wire so a future protocol revision can be detected
 * and negotiated by clients (review-spd follow-up, pet-center M5).
 */
export interface DecorationView {
  /** The protocol version this view speaks (PET_DECORATION_API_VERSION). */
  apiVersion: typeof PET_DECORATION_API_VERSION
  id: string
  /** Same-origin URL prefix of the decoration's assets. */
  assetBase: string
  /** Browser URL of the strip. */
  entryUrl: string
  cell: { width: number; height: number }
  columns: number
  durations: number[]
  loop: boolean
  phases: PhaseBindings
}