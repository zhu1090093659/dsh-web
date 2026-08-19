/**
 * Agent-tool permission policy for the SSH tools.
 *
 * The GUI surfaces (host manager, terminal, transfers, tunnels) are manual
 * user actions and are never gated by this policy. It only applies to the six
 * agent-facing tools, so deployments can keep a remote-operations toolbelt
 * visible to the model while restricting what it may actually do.
 */

/** All SSH agent tools governed by the permission policy. */
export const SSH_PERMISSION_TOOLS = [
  'ssh_list',
  'ssh_exec',
  'ssh_upload',
  'ssh_download',
  'ssh_tunnel',
  'ssh_cluster',
] as const

/** Tools still allowed when the mode is `readonly`. */
export const SSH_READONLY_TOOLS = ['ssh_list'] as const

/** Supported permission modes for the SSH agent tools. */
export type SshPermissionMode = 'allow' | 'readonly' | 'deny' | 'ask'

/** Policy inputs resolved from the plugin settings. */
export interface SshPermissionOptions {
  /** Default mode; `allow` when omitted. */
  mode?: SshPermissionMode
  /** Tools governed by the mode; all six SSH tools when omitted. */
  tools?: readonly string[]
  /** Tools allowed under `readonly`; `ssh_list` when omitted. */
  readonlyTools?: readonly string[]
}

/** One pre-dispatch decision for an SSH tool call. */
export type SshPermissionDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

/**
 * Resolve the policy for one tool call. Tools outside `tools` are always
 * allowed so the policy never broadens or narrows anything it does not own.
 */
export function resolveSshPermission(
  name: string,
  options: SshPermissionOptions = {},
): SshPermissionDecision {
  const mode = options.mode ?? 'allow'
  const governed = new Set(options.tools ?? SSH_PERMISSION_TOOLS)
  if (!governed.has(name)) return { kind: 'allow' }

  if (mode === 'deny') {
    return { kind: 'deny', reason: `SSH operation "${name}" is disabled by dsh-ssh permission policy (mode=deny)` }
  }

  if (mode === 'readonly') {
    const allowed = new Set(options.readonlyTools ?? SSH_READONLY_TOOLS)
    if (allowed.has(name)) return { kind: 'allow' }
    return { kind: 'deny', reason: `SSH operation "${name}" is not allowed in readonly mode by dsh-ssh permission policy` }
  }

  if (mode === 'ask') {
    return { kind: 'ask', reason: `SSH operation "${name}" requires approval (mode=ask)` }
  }

  return { kind: 'allow' }
}
