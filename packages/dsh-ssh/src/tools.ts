/**
 * Agent tools: the DSH-native counterpart of ssh-skill's CLI. Every tool
 * talks to the same engine the web UI uses, so a host configured in the GUI
 * is immediately operable by any agent, and vice versa.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SshEngine } from './engine.ts'
import type { ClusterResult, ExecResult, SshHostSummary, TunnelInfo } from './protocol.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Host table render shared by list surfaces. */
function renderHosts(hosts: SshHostSummary[]): string {
  if (hosts.length === 0) return 'no hosts configured'
  const rows = hosts.map(host => [
    host.alias,
    host.host,
    String(host.port),
    host.user,
    host.auth,
    host.environment ?? '-',
    (host.tags.length > 0 ? host.tags.join(',') : '-'),
    host.description ?? '',
  ].join(' | '))
  return ['alias | host | port | user | auth | environment | tags | description', '--- | --- | --- | --- | --- | --- | --- | ---', ...rows].join('\n')
}

/** Render one exec result (mirrors the bash-tool exit-code convention). */
function renderExec(result: ExecResult): string {
  const marker = result.timedOut
    ? '[timed out]'
    : `[exit code: ${result.exitCode ?? 'null'}]`
  const parts = [marker]
  if (result.stdout !== '') parts.push('stdout:\n' + result.stdout)
  if (result.stderr !== '') parts.push('stderr:\n' + result.stderr)
  if (result.error !== undefined) parts.push('error: ' + result.error)
  parts.push(`duration: ${result.durationMs} ms`)
  return parts.join('\n')
}

/** Render cluster outcomes compactly. */
function renderCluster(results: ClusterResult[]): string {
  if (results.length === 0) return 'no hosts matched'
  return results.map(result => {
    const status = result.ok ? 'ok' : result.timedOut === true ? 'timed out' : 'failed'
    const tail = result.error !== undefined ? ' (' + result.error + ')' : ''
    return `${result.alias}: ${status} [exit code: ${result.exitCode ?? 'null'}]${tail}`
  }).join('\n')
}

/** One tunnel line. */
function renderTunnel(tunnel: TunnelInfo): string {
  return `${tunnel.id} ${tunnel.alias} 127.0.0.1:${tunnel.localPort} -> ${tunnel.remoteHost}:${tunnel.remotePort} [${tunnel.state}]`
}

/** The host-list tool. */
export function sshListTool(engine: SshEngine) {
  return defineTool({
    name: 'ssh_list',
    description: 'List configured SSH hosts (alias, host, user, auth, environment, tags, description). Use ssh_exec etc. with the alias. ' +
      'Triggers: SSH, remote server, server IP/hostname, connect/login, check server/status, deploy, upload/download, jump host, tunnel, port forward.',
    parameters: {
      query: { type: 'string', description: 'Optional fuzzy match against alias, description, host, and tags.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hosts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                alias: { type: 'string', required: true },
                host: { type: 'string', required: true },
                port: { type: 'integer', required: true },
                user: { type: 'string', required: true },
                auth: { type: 'string', enum: ['key', 'password', 'agent'], required: true },
                keyReady: { type: 'boolean', required: true },
                proxyJump: { type: 'array', items: { type: 'string' }, required: true },
                description: { type: 'string' },
                environment: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' }, required: true },
                location: { type: 'string' },
                createdAt: { type: 'integer', required: true },
                updatedAt: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value: { hosts?: SshHostSummary[] }) => text(renderHosts(value.hosts ?? [])),
    },
    async execute(args) {
      return { hosts: engine.list(args.query) }
    },
  })
}

/** The command-execution tool. */
export function sshExecTool(engine: SshEngine) {
  return defineTool({
    name: 'ssh_exec',
    description: 'Execute a command on a configured SSH host by alias. Prefer combining independent read-only queries into one command. ' +
      'Triggers: run command on server, deploy, check server/status, service control, view logs, any remote operation.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Host alias from ssh_list.' },
      command: { type: 'string', required: true, description: 'The shell command to run remotely.' },
      timeoutMs: { type: 'integer', description: 'Timeout in milliseconds (default 60000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          timedOut: { type: 'boolean', required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          durationMs: { type: 'integer', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: ExecResult) => text(renderExec(value)),
    },
    async execute(args) {
      try {
        return await engine.exec(args.alias, args.command, args.timeoutMs)
      } catch (error) {
        return {
          success: false,
          exitCode: null,
          timedOut: false,
          stdout: '',
          stderr: '',
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
}

/** The upload tool. */
export function sshUploadTool(engine: SshEngine) {
  return defineTool({
    name: 'ssh_upload',
    description: 'Upload a local file to a configured SSH host. The local path is on THIS machine (the dsh host). ' +
      'Triggers: upload file to server, deploy artifact, copy config to server.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Host alias from ssh_list.' },
      localPath: { type: 'string', required: true, description: 'Absolute local file path on this machine.' },
      remotePath: { type: 'string', required: true, description: 'Destination path on the remote host (parent dirs are created).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          transferredBytes: { type: 'integer' },
          files: { type: 'integer' },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { ok: boolean; transferredBytes?: number; files?: number; error?: string }) => text(value.ok
        ? `uploaded ${value.files ?? 1} file(s), ${value.transferredBytes ?? 0} bytes`
        : `upload failed: ${value.error ?? 'unknown error'}`),
    },
    async execute(args) {
      try {
        const outcome = await engine.upload(args.alias, args.localPath, args.remotePath, false)
        return { ok: true, transferredBytes: outcome.bytes, files: outcome.files }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** The download tool. */
export function sshDownloadTool(engine: SshEngine) {
  return defineTool({
    name: 'ssh_download',
    description: 'Download a remote FILE from a configured SSH host to a local path on this machine. Directory download is not supported — download files individually. ' +
      'Triggers: download file from server, fetch remote log/artifact.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Host alias from ssh_list.' },
      remotePath: { type: 'string', required: true, description: 'Remote file path.' },
      localPath: { type: 'string', required: true, description: 'Absolute destination path on this machine.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          bytes: { type: 'integer' },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { ok: boolean; bytes?: number; error?: string }) => text(value.ok
        ? `downloaded ${value.bytes ?? 0} bytes`
        : `download failed: ${value.error ?? 'unknown error'}`),
    },
    async execute(args) {
      try {
        const outcome = await engine.download(args.alias, args.remotePath, args.localPath)
        return { ok: true, bytes: outcome.bytes }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** The tunnel tool. */
export function sshTunnelTool(engine: SshEngine) {
  return defineTool({
    name: 'ssh_tunnel',
    description: 'Manage local port-forward tunnels to a configured SSH host. Start a tunnel to reach a remote internal service (database, web UI, API) through 127.0.0.1 on this machine. ' +
      'Triggers: tunnel, port forward, connect database, access internal service.',
    parameters: {
      action: { type: 'string', required: true, enum: ['start', 'list', 'stop', 'stop-all'], description: 'start / list / stop / stop-all.' },
      alias: { type: 'string', description: 'Host alias (required for start, optional for stop-all).' },
      remotePort: { type: 'integer', description: 'Port on the remote side (required for start).' },
      remoteHost: { type: 'string', description: 'Remote host to forward to (default 127.0.0.1 — the server itself).' },
      localPort: { type: 'integer', description: 'Local listening port (default: auto-assigned).' },
      tunnelId: { type: 'string', description: 'Tunnel id (required for stop).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          tunnel: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              alias: { type: 'string', required: true },
              localPort: { type: 'integer', required: true },
              remoteHost: { type: 'string', required: true },
              remotePort: { type: 'integer', required: true },
              state: { type: 'string', enum: ['forwarding', 'connecting', 'failed'], required: true },
              error: { type: 'string' },
              startedAt: { type: 'integer', required: true },
            },
          },
          tunnels: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                alias: { type: 'string', required: true },
                localPort: { type: 'integer', required: true },
                remoteHost: { type: 'string', required: true },
                remotePort: { type: 'integer', required: true },
                state: { type: 'string', enum: ['forwarding', 'connecting', 'failed'], required: true },
                error: { type: 'string' },
                startedAt: { type: 'integer', required: true },
              },
            },
          },
          stopped: { type: 'integer' },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { ok: boolean; tunnel?: TunnelInfo; tunnels?: TunnelInfo[]; stopped?: number; error?: string }) => {
        if (value.error !== undefined) return text(`tunnel error: ${value.error}`)
        if (value.tunnel !== undefined) {
          if (value.tunnel.state === 'failed') return text(`tunnel failed: ${value.tunnel.error ?? 'unknown error'}`)
          return text(`tunnel started: ${renderTunnel(value.tunnel)}`)
        }
        if (value.tunnels !== undefined) return text(value.tunnels.length === 0 ? 'no active tunnels' : value.tunnels.map(renderTunnel).join('\n'))
        return text(`stopped ${value.stopped ?? 0} tunnel(s)`)
      },
    },
    async execute(args) {
      if (args.action === 'list') {
        return { ok: true, tunnels: engine.listTunnels() }
      }
      if (args.action === 'start') {
        if (args.alias === undefined || args.remotePort === undefined) {
          throw new Error('alias and remotePort are required for start')
        }
        try {
          const tunnel = await engine.startTunnel(args.alias, {
            remotePort: args.remotePort,
            remoteHost: args.remoteHost,
            localPort: args.localPort,
          })
          return { ok: true, tunnel }
        } catch (error) {
          return { ok: false, tunnel: { id: '', alias: args.alias, localPort: 0, remoteHost: args.remoteHost ?? '127.0.0.1', remotePort: args.remotePort, state: 'failed' as const, error: error instanceof Error ? error.message : String(error), startedAt: Date.now() } }
        }
      }
      if (args.action === 'stop') {
        if (args.tunnelId === undefined) throw new Error('tunnelId is required for stop')
        const stopped = engine.stopTunnel(args.tunnelId)
        return stopped
          ? { ok: true, stopped: 1 }
          : { ok: false, stopped: 0, error: `tunnel '${args.tunnelId}' not found` }
      }
      if (args.action === 'stop-all') {
        const stopped = engine.stopAllTunnels(args.alias)
        return { ok: true, stopped }
      }
      throw new Error(`unknown action '${String(args.action)}'`)
    },
  })
}

/** The cluster tool. */
export function sshClusterTool(engine: SshEngine) {
  return defineTool({
    name: 'ssh_cluster',
    description: 'Run one command concurrently across many SSH hosts (all hosts, or filtered by aliases / environment / tags). ' +
      'Triggers: run on all servers, batch operation, production servers, cluster command.',
    parameters: {
      command: { type: 'string', required: true, description: 'The shell command to run on every matched host.' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'Explicit alias list; when absent every configured host matches.' },
      environment: { type: 'string', description: 'Only hosts with this environment label.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Only hosts carrying ALL these tags.' },
      timeoutMs: { type: 'integer', description: 'Per-host timeout in milliseconds.' },
      maxWorkers: { type: 'integer', description: 'Concurrency cap (default 8).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                alias: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
                timedOut: { type: 'boolean' },
                stdout: { type: 'string' },
                stderr: { type: 'string' },
                durationMs: { type: 'integer' },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value: { results?: ClusterResult[] }) => text(renderCluster(value.results ?? [])),
    },
    async execute(args) {
      return { results: await engine.cluster(args) }
    },
  })
}
