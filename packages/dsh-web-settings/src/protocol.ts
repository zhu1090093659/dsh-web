/**
 * Settings-bridge protocol shared by the host and client halves of
 * dsh-web-settings.
 *
 * The Host settings surface (`ctx.settings`, the new SettingsForms service)
 * describes ONE form per active profile entry id and writes by that id; the
 * settings namespace a family plugin used to register no longer exists as a
 * separate key. The bridge keeps serving the family plugins their own view of
 * that surface over a same-origin, loopback-only HTTP pair, gated by the
 * user's web_settings_namespaces allowlist from settings.yaml with a built-in
 * family fallback list: each view now carries the profile entry id
 * ({@link BridgeNamespaceView.entryId}) that owns the namespace, and the
 * client half uses it to bind the native `ctx.configForms` form. The bridge
 * HTTP transport stays the fallback for pages whose entry id cannot be
 * resolved.
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
  /**
   * Profile entry id that owns this namespace on the new settings surface,
   * when the Host resolved one. The settings namespace IS the entry id there,
   * so a client holding this id reads and writes the entry natively through
   * ctx.configForms instead of the bridge; absent when the namespace was
   * served without a profile-entry identity (the pre-0.1.7 layout).
   */
  entryId?: string
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
