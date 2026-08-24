/**
 * Diagnosis, snapshot, planning, gate, lock, and transaction state types.
 *
 * Supervisor-facing protocol types live in protocol.ts; this module carries the
 * per-profile diagnosis and repair-engineering state types only. Everything
 * here is JSON-serializable and carries no runtime dependency beyond RegExp
 * (redaction rules) and generic object fields.
 */

/** Diagnostic severity, ordered from the most to least severe. */
export type Severity = 'critical' | 'error' | 'warn' | 'info'

/** Health gate identifiers. */
export type GateId = 'dump-default' | 'start' | 'one-shot'

export interface Diagnostic {
  /** Stable code, e.g. D-040 (broken profile patch). */
  code: string
  severity: Severity
  /** The file or logical path the finding concerns. */
  path: string
  detail: string
  /** Human-readable repair hint shown in plans. */
  remediation?: string
  /** Which health gate is affected, if any. */
  gate?: GateId | 'none'
  /** Short stable evidence fragment (hash or redacted value prefix). */
  evidence?: string
}

export type DependencyKind = 'exact' | 'range' | 'link' | 'file' | 'github' | 'git' | 'tarball' | 'registry' | 'workspace' | 'unknown'

/** A classified dependency specification from a profile manifest. */
export interface DependencySpec {
  raw: string
  kind: DependencyKind
  /** Package name when derivable (registry-ish specs), otherwise the target. */
  name?: string
  /** Version or specifier fragment when present. */
  version?: string
  /** Git ref / branch / commit for git specs. */
  ref?: string
  /** Local path target for link/file specs. */
  target?: string
}

/** Parsed profile manifest facts. */
export interface ManifestFacts {
  raw: Record<string, unknown>
  private?: boolean
  bundles: string[]
  hasDshProfile: boolean
  dependencies: Record<string, string>
}

/** One row in a cordis entry list (patch or composed tree). */
export interface EntryRow {
  id?: string
  name?: string
  disabled?: boolean
  config?: unknown
  group?: unknown
  [key: string]: unknown
}

/** One loader patch entry (the DSH patch-list dialect). */
export interface PatchEntry extends EntryRow {
  insert?: PatchEntry[]
}

export interface PatchParseResult {
  entries: PatchEntry[]
  /** Parse/validation error text; entries is empty when set. */
  error?: string
  /** Non-fatal diagnostics (skipped patches, no-op entries). */
  warnings: string[]
}


export interface PatchLayer {
  /** Source label shown in dumps, e.g. a bundle package name or file path. */
  label: string
  patches: PatchEntry[]
  /** True when layer.patches failed to parse. */
  broken?: boolean
}

export interface InventoryRow {
  name: string
  declared: string
  spec: DependencySpec
  /** Resolved version from the lockfile importer, when present. */
  locked?: string
  /** Lockfile entry disagrees with a pinned declaration. */
  mismatch: boolean
  /** The package directory exists in profile node_modules. */
  installed: boolean
}

export interface InventoryReport {
  rows: InventoryRow[]
  lockfile: 'missing' | 'broken' | 'ok'
  lockfileVersion?: string
  workspace?: WorkspaceSettings
  nodeModules: 'missing' | 'present' | 'unreadable'
}

export interface WorkspaceSettings {
  nodeLinker?: string
  autoInstallPeers?: boolean
  allowBuilds: string[]
  minimumReleaseAgeExclude: string[]
}

export interface RedactionRule {
  id: string
  kind: 'key' | 'pattern'
  re: RegExp
}

export interface RedactionHit {
  rule: string
  count: number
}

export interface RedactionResult {
  text: string
  fingerprint: string
  hits: RedactionHit[]
}

export type SnapshotFileKind = 'text' | 'binary'

export interface SnapshotFileEntry {
  /** Profile-relative POSIX path. */
  path: string
  /** SHA-256 of the stored original; absent on omitted entries. */
  hash?: string
  size: number
  /** text/binary classification; absent on omitted entries. */
  kind?: SnapshotFileKind
  /** Hash of the redacted copy; present for text files. */
  redactedHash?: string
  /** Large files are recorded but not stored. */
  omitted?: boolean
}

export interface SnapshotDump {
  mode: 'default' | 'full'
  exitCode: number
  fingerprint: string
  sha256: string
}

export interface SnapshotManifest {
  schemaVersion: 1
  snapshotId: string
  createdAt: string
  sourceHome: string
  profile: string
  dshVersion?: string
  files: SnapshotFileEntry[]
  dumps: SnapshotDump[]
  /** Opaque engine state (inventory, gate reports) captured alongside. */
  state?: unknown
  parent?: string
}


export interface GateReport {
  gate: GateId
  profile: string
  ok: boolean
  skipped?: boolean
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  durationMs: number
  fingerprint?: string
  url?: string
  httpStatus?: number
  markerHits?: number
  stderrSample?: string
  error?: string
}

export type LockScope = 'global' | 'profile'

export interface LockToken {
  pid: number
  host: string
  intent: string
  startedAt: string
  heartbeatAt: number
  nonce: string
  /** A released lease is immediately reclaimable but remains atomic on disk. */
  released?: boolean
}

export interface LockState {
  scope: LockScope
  key: string
  path: string
  held: boolean
  stolen?: boolean
  stale?: boolean
  token?: LockToken
}

export type PlanOp = 'write-file' | 'move-path' | 'link-file' | 'json-edit'

export interface JsonEdit {
  /** Object properties to set, keyed by dotted path. */
  set?: Record<string, unknown>
  /** Dotted paths of object properties to remove. */
  remove?: string[]
}

export interface PlanAction {
  op: PlanOp
  /** Target path (profile-relative for manifest/patch fixes). */
  target: string
  /** write-file: exact content to write. */
  content?: string
  /** move-path: destination (from target). */
  to?: string
  /** link-file: symlink target to create at target. */
  linkTo?: string
  /** json-edit: structured manifest edit. */
  edit?: JsonEdit
  /** Diagnostic codes that motivated this action. */
  sourceCode?: string[]
}

export interface PlanResult {
  actions: PlanAction[]
  hash: string
}

export type CandidatePhase = 'created' | 'staged' | 'promoted' | 'committed' | 'rolled-back' | 'aborted' | 'failed'

export interface CandidateRecord {
  txnId: string
  profile: string
  phase: CandidatePhase
  livePath: string
  stagingPath: string
  quarantinePath: string
  /** Ordered step log: what moved where, with content hashes. */
  steps: { step: string; from?: string; to?: string; hash?: string; copied?: boolean }[]
  error?: string
}

export interface JournalEntry {
  seq: number
  at: string
  op: string
  ok: boolean
  detail?: Record<string, unknown>
}

export interface ToolchainReport {
  /** Node semver-ish version string, e.g. 22.19.0. */
  node: string
  pnpm?: string
  git?: boolean
  /** lockfileVersion from the profile lockfile. */
  lockfileVersion?: string
}

export interface CandidateHomeMeta {
  kind: 'live' | 'backup' | 'quarantine' | 'trash' | 'store' | 'snapshot' | 'source'
  path: string
  profile?: string
  note?: string
}

/** Describes one external process invocation. */
export interface ProcessSpec {
  cmd: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  timeoutMs: number
}

export interface ProcessResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
}

export interface HttpResult {
  status: number
  body: string
}
