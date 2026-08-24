/**
 * Settings-bridge protocol shared by the host and client halves of
 * dsh-web-settings.
 *
 * DSH 0.1.0-rc.6 host-apiproxy serves only its hard-coded settings allowlist
 * (WEB_SETTINGS_NAMESPACES plus product namespaces), so every third-party
 * namespace answers "settings-not-exposed" and the family plugin cards can
 * only explain the gap. This bridge re-serves the dsh-web family
 * namespaces through the host settings seam over a same-origin, loopback-only
 * HTTP pair, gated by the user's web_settings_namespaces allowlist from
 * settings.yaml with a built-in family fallback list. On hosts whose
 * apiproxy already exposes the namespaces, the official settings scope stays
 * the primary transport and this bridge never activates.
 */

/** Bridge route prefix (same-origin, loopback-only). */
export const WEB_UI_SETTINGS_BRIDGE_PREFIX = '/api/dsh-web-ui-settings'

/** One path-addressed settings edit, mirroring the official mutate op. */
export interface BridgeSettingsOp {
  /** set stores a value at the path; unset drops the leaf. */
  op: 'set' | 'unset'
  /** Field path inside the namespace section. */
  path: string[]
  /** Value for op set (absent for unset). */
  value?: unknown
}

/** Wire view of one settings namespace (mirrors the official apiproxy view). */
export interface BridgeNamespaceView {
  /** The settings namespace name. */
  ns: string
  /** Serialized schemastery schema (schema.toJSON()). */
  schema: unknown
  /** Current resolved value (secrets redacted). */
  value: unknown
  /** Registrant's composition base layer, when declared. */
  base?: unknown
  /** Raw user section, when present and well-formed. */
  user?: unknown
  /** Schema-declared secret positions (present under redaction). */
  secrets?: { path: string[]; set: boolean }[]
  /** Monotonic revision of the user section this view was read at. */
  revision: number
}

/** Payload of a successful describe response. */
export interface BridgeDescribeValue {
  /** Namespace views inside the bridge allowlist. */
  namespaces: BridgeNamespaceView[]
  /** Whether the settings document accepts writes. */
  writable: boolean
}

/** Describe result, shaped like an official RPC result envelope. */
export type BridgeDescribeResult =
  | { ok: true; value: BridgeDescribeValue }
  | { ok: false; code: string; message: string }

/** Mutate request body. */
export interface BridgeMutateRequest {
  /** Target settings namespace. */
  ns: string
  /** Ordered path edits. */
  ops: BridgeSettingsOp[]
  /** Revision the caller read; a moved namespace rejects the write. */
  expectedRevision?: number
}

/** Mutate result: the namespace's fresh view, or a refusal. */
export type BridgeMutateResult =
  | { ok: true; value: BridgeNamespaceView }
  | { ok: false; code: string; message: string }
