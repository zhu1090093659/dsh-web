/**
 * Wire contract between the host half (routes.ts) and the browser half
 * (client/api.ts). Pure types only — imported by both halves, bundled into
 * each, no runtime identity to share.
 */

/** Authentication flavors a host entry may carry. */
export type SshAuthKind = 'key' | 'password' | 'agent'

/** One stored host entry (the ~/.dsh/dsh-ssh.json store shape). */
export interface SshHostEntry {
  /** Stable, user-chosen identifier used by every operation. */
  alias: string
  /** Hostname or IP of the target. */
  host: string
  /** SSH port (default 22). */
  port: number
  /** Login user. */
  user: string
  /** Authentication. */
  auth: {
    kind: SshAuthKind
    /** Absolute path to the private key for 'key' auth. */
    keyPath?: string
    /** Passphrase for an encrypted key. */
    passphrase?: string
    /** Password for 'password' auth. */
    password?: string
    /**
     * ssh-agent endpoint for 'agent' auth. A socket path, the special value
     * 'pageant' (PuTTY Pageant on Windows), or undefined for auto-detect
     * (SSH_AUTH_SOCK, then Pageant on Windows).
     */
    agentPath?: string
  }
  /** Jump chain: local aliases connected through in order (ProxyJump). */
  proxyJump: string[]
  /** Free-form note. */
  description?: string
  /** Deployment environment label (development / production / ...). */
  environment?: string
  /** Free-form tags. */
  tags: string[]
  /** Physical location note. */
  location?: string
  createdAt: number
  updatedAt: number
}

/** Public (secret-free) projection of an entry, safe for the browser/agent. */
export interface SshHostSummary {
  alias: string
  host: string
  port: number
  user: string
  auth: SshAuthKind
  /** Whether the key path exists on the host machine (key auth only). */
  keyReady: boolean
  proxyJump: string[]
  description?: string
  environment?: string
  tags: string[]
  location?: string
  createdAt: number
  updatedAt: number
}

/** Result of one non-interactive command execution. */
export interface ExecResult {
  success: boolean
  /** Remote exit code, or null when the channel died without one. */
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  /** Wall-clock duration of the round trip in ms. */
  durationMs: number
  /** Connection error message when the command never ran. */
  error?: string
}

/** One server entry in a cluster run. */
export interface ClusterResult {
  alias: string
  ok: boolean
  exitCode?: number | null
  timedOut?: boolean
  stdout?: string
  stderr?: string
  durationMs?: number
  error?: string
}

/** SFTP transfer progress frame (upload stream). */
export interface TransferProgress {
  phase: 'connecting' | 'transferring' | 'done' | 'error'
  file: string
  transferred: number
  total: number
  percent: number
  speedBps?: number
  error?: string
}

/** One active local port-forward tunnel. */
export interface TunnelInfo {
  id: string
  alias: string
  localPort: number
  remoteHost: string
  remotePort: number
  state: 'forwarding' | 'connecting' | 'failed'
  error?: string
  startedAt: number
}

/** One directory listing entry (remote file browser). */
export interface RemoteDirEntry {
  name: string
  type: 'dir' | 'file' | 'other'
  size: number
  mtimeMs: number
  mode?: number
}

/** Test-connection outcome. */
export interface TestResult {
  ok: boolean
  latencyMs?: number
  error?: string
}

/** Host edit payload (create/update); 'alias' comes from the URL for updates. */
export interface HostPayload {
  alias?: string
  host: string
  port?: number
  user: string
  /**
   * Authentication. Required on create; on update an omitted auth keeps the
   * stored secrets (the browser never receives them back).
   */
  auth?: SshHostEntry['auth']
  proxyJump?: string[]
  description?: string
  environment?: string
  tags?: string[]
  location?: string
}

/** Import outcome from ~/.ssh/config. */
export interface ImportResult {
  parsed: number
  added: number
  skipped: number
  /** Aliases that failed to map (wildcard patterns, missing HostName, ...). */
  skippedNames: string[]
}

/** JSON error body used by every route. */
export interface ApiErrorBody {
  error: string
}

/** WebSocket terminal protocol frames (host -> client and client -> host). */
export type TerminalServerFrame =
  | { type: 'ready'; alias: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number | null; error?: string }

export type TerminalClientFrame =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

/** Route paths the client calls (shared literals). */
export const SSH_API_BASE = '/api/dsh-ssh' as const

export const SSH_API = {
  hosts: SSH_API_BASE + '/hosts',
  importSshConfig: SSH_API_BASE + '/hosts/import-ssh-config',
  test: SSH_API_BASE + '/test',
  exec: SSH_API_BASE + '/exec',
  cluster: SSH_API_BASE + '/cluster',
  upload: SSH_API_BASE + '/upload',
  download: SSH_API_BASE + '/download',
  ls: SSH_API_BASE + '/ls',
  tunnel: SSH_API_BASE + '/tunnel',
  terminal: SSH_API_BASE + '/terminal',
} as const

/** NDJSON transfer stream line shapes (upload). */
export type TransferStreamLine =
  | { type: 'progress'; progress: TransferProgress }
  | { type: 'result'; ok: boolean; transferredBytes?: number; error?: string }
