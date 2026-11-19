/**
 * The cordis service `dsh-ssh` publishes to sibling plugins.
 *
 * A plugin that needs the host inventory or the shared connection pool injects
 * this service (`ctx.inject(['dshSsh'], ...)`) instead of importing this
 * package. The face is a thin forwarder over the same `SshEngine` instance the
 * routes, the agent tools and the panel drive, so a consumer shares one host
 * store and one connection pool with the surfaces the user already operates.
 *
 * This module is the published contract and is deliberately import-free: a
 * consuming package restates these declarations verbatim and resolves the
 * service by {@link DSH_SSH_SERVICE} at runtime, so the two packages share a
 * shape without sharing a module. Only the members named here exist — the web
 * terminal, tunnels, cluster runs, directory listing and any streaming log
 * stay behind the plugin's own surfaces.
 *
 * @module @linxin666/dsh-ssh/service
 */

/** Cordis service name the host half publishes the face under. */
export const DSH_SSH_SERVICE = 'dshSsh'

/** Version of this contract; a consumer restates the number it was built against. */
export const DSH_SSH_API_VERSION = 1

/** Authentication flavors a host entry may carry. */
export type DshSshAuthKind = 'key' | 'password' | 'agent'

/**
 * One host as the service reports it: the fields the plugin's own
 * `SshHostSummary` already publishes, minus the `proxyCommand` text.
 *
 * The omission is the trust boundary, not an oversight. A ProxyCommand is a
 * shell line the host process executes with its own privileges, so no consumer
 * receives it — the agent tools project it to a boolean for the same reason.
 * Passwords, key passphrases and private-key paths are absent as well: this
 * face describes a host, it never hands out credentials.
 */
export interface DshSshHost {
  /** Stable, user-chosen identifier every operation addresses. */
  alias: string
  /** Hostname or IP of the target. */
  host: string
  /** SSH port. */
  port: number
  /** Login user. */
  user: string
  /** Authentication flavor the stored entry uses. */
  auth: DshSshAuthKind
  /** Whether the configured private-key file exists on this machine (key auth only). */
  keyReady: boolean
  /** Jump chain: local aliases connected through in order. */
  proxyJump: string[]
  /** Free-form note. */
  description?: string
  /** Deployment environment label. */
  environment?: string
  /** Free-form tags. */
  tags: string[]
  /** Physical location note. */
  location?: string
  /** Whether this host's sessions forward the local ssh-agent. */
  forwardAgent: boolean
  /** Creation timestamp (ms). */
  createdAt: number
  /** Last-change timestamp (ms). */
  updatedAt: number
}

/** Ceiling and cancellation for one remote command. */
export interface DshSshExecOptions {
  /** Wall-clock ceiling for the remote command; the engine default applies when absent. */
  timeoutMs?: number
  /** Aborting closes the remote channel and settles the call as a cancelled command. */
  signal?: AbortSignal
}

/** One finished remote command. */
export interface DshSshExecResult {
  /** Whether the command exited zero. */
  success: boolean
  /** Remote exit code, or null when the channel died without one. */
  exitCode: number | null
  /** Whether the ceiling stopped the run. */
  timedOut: boolean
  /** Captured standard output, verbatim. */
  stdout: string
  /** Captured standard error, verbatim. */
  stderr: string
  /** Round trip in milliseconds. */
  durationMs: number
  /** Connection error message when the command never ran. */
  error?: string
}

/** Outcome of one upload. */
export interface DshSshUploadResult {
  /** Bytes written. */
  bytes: number
  /** Files written (one for a single-file upload). */
  files: number
}

/** Outcome of one download. */
export interface DshSshDownloadResult {
  /** Bytes written locally. */
  bytes: number
}

/**
 * The face a sibling plugin receives under the `dshSsh` service name.
 *
 * Every member is a forward: no gate, no cache and no state of its own lives
 * here, so a consumer is refused by exactly what refuses the GUI and the agent
 * tools, and a settings change to the plugin reaches all of them at once.
 */
export interface DshSshService {
  /** Contract version this face implements. */
  readonly apiVersion: typeof DSH_SSH_API_VERSION
  /** The host inventory the plugin's own surfaces read. */
  readonly hosts: {
    /** Every configured host, secret-free, in store order. */
    list(): DshSshHost[]
    /** One host by alias, or undefined when the alias is not configured. */
    find(alias: string): DshSshHost | undefined
  }
  /**
   * Run one command on a host through the shared pool.
   * @param alias - configured host alias.
   * @param command - command line handed to the remote shell.
   * @param options - ceiling and cancellation.
   * @returns the finished command.
   */
  exec(alias: string, command: string, options?: DshSshExecOptions): Promise<DshSshExecResult>
  /**
   * Upload one local file to an absolute remote path.
   * @param alias - configured host alias.
   * @param localPath - file on this machine (a directory is not part of this face).
   * @param remotePath - absolute destination path on the host.
   * @returns bytes and files written.
   */
  upload(alias: string, localPath: string, remotePath: string): Promise<DshSshUploadResult>
  /**
   * Download one remote file to a local path.
   * @param alias - configured host alias.
   * @param remotePath - file on the host.
   * @param localPath - destination path on this machine.
   * @returns bytes written.
   */
  download(alias: string, remotePath: string, localPath: string): Promise<DshSshDownloadResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The dsh-ssh face, published while the plugin's master switch is on. */
    dshSsh: DshSshService
  }
}
