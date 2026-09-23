/**
 * Tool-layer tests: every factory must construct (the rc.6 defineTool DSL
 * rejects raw JSON Schema 'required' arrays — a regression here would fail
 * plugin startup), and the execute/render contracts must not drift.
 */

import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SshEngine } from '../src/engine.ts'
import type { ExecResult, SshHostSummary, TunnelInfo } from '../src/protocol.ts'
import {
  sshClusterTool,
  sshDownloadTool,
  sshExecTool,
  sshListTool,
  sshTunnelTool,
  sshUploadTool,
} from '../src/tools.ts'

/** In-memory engine stub: enough surface for the tool factories. */
class StubEngine {
  hosts: SshHostSummary[] = []
  execFailure: Error | undefined
  tunnelStartError: Error | undefined
  tunnelExists = true

  list(): SshHostSummary[] {
    return this.hosts
  }
  find(): SshHostSummary | undefined {
    return undefined
  }
  async exec(_alias: string, _command: string, _timeoutMs?: number): Promise<ExecResult> {
    if (this.execFailure !== undefined) throw this.execFailure
    return { success: true, exitCode: 0, timedOut: false, stdout: 'hello out', stderr: '', durationMs: 5 }
  }
  async cluster(): Promise<unknown[]> {
    return []
  }
  async upload(): Promise<{ bytes: number; files: number }> {
    return { bytes: 12, files: 1 }
  }
  async download(): Promise<{ bytes: number }> {
    return { bytes: 34 }
  }
  listTunnels(): TunnelInfo[] {
    return []
  }
  async startTunnel(): Promise<TunnelInfo> {
    if (this.tunnelStartError !== undefined) throw this.tunnelStartError
    throw new Error('unexpected')
  }
  stopTunnel(_id: string): boolean {
    return this.tunnelExists
  }
  stopAllTunnels(): number {
    return 0
  }
  async test(): Promise<{ ok: boolean }> {
    return { ok: true }
  }
}

const engine = (stub: StubEngine): SshEngine => stub as unknown as SshEngine

/** ToolDefinition.execute needs a ToolRunContext; tests pass a dummy. */
function run(tool: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return tool.execute(args, {} as never) as Promise<Record<string, unknown>>
}

function render(tool: ToolDefinition, value: unknown): string {
  const blocks = tool.output.render({}, value as never)
  const first = blocks[0]
  return first !== undefined && 'text' in first ? first.text : ''
}

const host: SshHostSummary = {
  alias: 'web-01',
  host: '10.0.0.1',
  port: 22,
  user: 'root',
  auth: 'key',
  keyReady: true,
  proxyJump: [],
  description: 'web',
  environment: 'production',
  tags: ['web'],
  location: 'dc-a',
  createdAt: 1,
  updatedAt: 1,
}

describe('tool factories (defineTool DSL regression)', () => {
  it('constructs every tool without throwing', () => {
    const stub = new StubEngine()
    const factories = [
      sshListTool, sshExecTool, sshUploadTool, sshDownloadTool, sshTunnelTool, sshClusterTool,
    ]
    for (const factory of factories) {
      expect(() => factory(engine(stub))).not.toThrow()
    }
  })
})

describe('ssh_list', () => {
  it('returns hosts and renders a table', async () => {
    const stub = new StubEngine()
    stub.hosts = [host]
    const tool = sshListTool(engine(stub))
    const result = await run(tool, {})
    // The model-facing row never carries the ProxyCommand string itself, only
    // whether one is configured (it may embed bastion credentials).
    expect(result.hosts).toEqual([{ ...host, proxyCommandConfigured: false }])
    const text = render(tool, result)
    expect(text).toContain('web-01')
    expect(text).toContain('10.0.0.1')
    expect(text).toContain('| - |')
  })

  it('marks a ProxyCommand host and a jump chain in the table', async () => {
    const stub = new StubEngine()
    stub.hosts = [
      { ...host, proxyCommand: 'corp proxy %h %p' },
      { ...host, alias: 'jump-host', proxyJump: ['bastion'] },
    ]
    const tool = sshListTool(engine(stub))
    const result = await run(tool, {})
    const rows = result.hosts as Array<Record<string, unknown>>
    expect(rows[0]?.['proxyCommandConfigured']).toBe(true)
    expect('proxyCommand' in (rows[0] ?? {})).toBe(false)
    const text = render(tool, result)
    expect(text).toContain('proxy-command')
    expect(text).toContain('jump:bastion')
  })
})

describe('ssh_exec', () => {
  it('propagates engine failures as a failed result, not a throw', async () => {
    const stub = new StubEngine()
    stub.execFailure = new Error('connection refused')
    const tool = sshExecTool(engine(stub))
    const result = await run(tool, { alias: 'web-01', command: 'true' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('connection refused')
  })

  it('renders timed-out results with the timed-out marker', async () => {
    const stub = new StubEngine()
    const tool = sshExecTool(engine(stub))
    const result = await run(tool, { alias: 'web-01', command: 'hang' })
    const text = render(tool, { ...result, timedOut: true, exitCode: null, stdout: '', stderr: '' })
    expect(text).toContain('[timed out]')
  })
})

describe('ssh_tunnel', () => {
  it('reports an unknown tunnel id honestly (stopped: 0 + error)', async () => {
    const stub = new StubEngine()
    stub.tunnelExists = false
    const tool = sshTunnelTool(engine(stub))
    const result = await run(tool, { action: 'stop', tunnelId: 'tun-999' })
    expect(result.ok).toBe(false)
    expect(result.stopped).toBe(0)
    expect(result.error).toContain('not found')
    const text = render(tool, result)
    expect(text).toContain('tunnel error')
  })

  it('renders a failed start as a failure, not "tunnel started"', async () => {
    const stub = new StubEngine()
    stub.tunnelStartError = new Error('EADDRINUSE')
    const tool = sshTunnelTool(engine(stub))
    const result = await run(tool, { action: 'start', alias: 'web-01', remotePort: 5432 })
    expect(result.ok).toBe(false)
    expect((result.tunnel as { state?: string } | undefined)?.state).toBe('failed')
    const text = render(tool, result)
    expect(text).toContain('tunnel failed')
    expect(text).toContain('EADDRINUSE')
  })
})

describe('ssh_upload / ssh_download', () => {
  it('maps engine outcomes into ok results', async () => {
    const stub = new StubEngine()
    const upload = sshUploadTool(engine(stub))
    const up = await run(upload, { alias: 'web-01', localPath: '/tmp/a', remotePath: '/tmp/b' })
    expect(up.ok).toBe(true)
    expect(up.transferredBytes).toBe(12)

    const download = sshDownloadTool(engine(stub))
    const down = await run(download, { alias: 'web-01', remotePath: '/tmp/b', localPath: '/tmp/a' })
    expect(down.ok).toBe(true)
    expect(down.bytes).toBe(34)
  })
})

describe('path-scope guidance for agents (issue #760)', () => {
  it('ssh_upload draws the local-vs-remote boundary and points local files to local tools', () => {
    const tool = sshUploadTool(engine(new StubEngine()))
    const name = tool.description.toLowerCase()
    expect(name).toContain('from this machine')
    expect(name).toContain('remote ssh host')
    expect(name).toContain('local file tools')
    const lparams = tool.parameters as unknown as { properties: Record<string, { description: string }> }
    const localPath = lparams.properties.localPath.description.toLowerCase()
    expect(localPath).toContain('this machine')
    expect(localPath).toContain('not a path on the remote host')
    const remotePath = lparams.properties.remotePath.description.toLowerCase()
    expect(remotePath).toContain('remote ssh host')
  })

  it('ssh_download draws the same boundary', () => {
    const tool = sshDownloadTool(engine(new StubEngine()))
    const name = tool.description.toLowerCase()
    expect(name).toContain('remote file')
    expect(name).toContain('local file tools')
    const dparams = tool.parameters as unknown as { properties: Record<string, { description: string }> }
    const remotePath = dparams.properties.remotePath.description.toLowerCase()
    expect(remotePath).toContain('remote ssh host')
    const localPath = dparams.properties.localPath.description.toLowerCase()
    expect(localPath).toContain('this machine')
  })

  it('ssh_exec is scoped to the remote host only', () => {
    const tool = sshExecTool(engine(new StubEngine()))
    const name = tool.description.toLowerCase()
    expect(name).toContain('remote ssh host')
    expect(name).toContain('never on this machine')
    expect(name).toContain('local bash tool')
  })
})

describe('ssh_cluster', () => {
  it('enforces selector requirement in execute', async () => {
    const stub = new StubEngine()
    const tool = sshClusterTool(engine(stub))
    await expect(run(tool, { command: 'uptime' })).rejects.toThrow(/ssh_cluster requires aliases, environment, or tags/)
    await expect(run(tool, { command: 'uptime', aliases: [] })).rejects.toThrow(/ssh_cluster requires aliases, environment, or tags/)
    await expect(run(tool, { command: 'uptime', aliases: [' '], environment: '', tags: [] })).rejects.toThrow(/ssh_cluster requires aliases, environment, or tags/)

    const valid = await run(tool, { command: 'uptime', aliases: ['srv-1'] })
    expect(valid).toEqual({ results: [] })

    const validEnv = await run(tool, { command: 'uptime', environment: 'production' })
    expect(validEnv).toEqual({ results: [] })

    const validTags = await run(tool, { command: 'uptime', tags: ['api'] })
    expect(validTags).toEqual({ results: [] })
  })

  it('documents selector requirement in tool and parameter descriptions', () => {
    const tool = sshClusterTool(engine(new StubEngine()))
    expect(tool.description).toContain('at least one aliases, environment, or tags filter is required')
    const params = tool.parameters as unknown as { properties: Record<string, { description: string }> }
    expect(params.properties.aliases.description).toContain('at least one')
    expect(params.properties.environment.description).toContain('at least one')
    expect(params.properties.tags.description).toContain('at least one')
  })
})

