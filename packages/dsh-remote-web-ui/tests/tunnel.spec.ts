/**
 * TunnelManager lifecycle: binary readiness, URL surfacing, URL timeout,
 * crash-restart backoff, and stop semantics — all against injected fakes
 * (no real cloudflared binary or network).
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { MAX_BINARY_INSTALL_ATTEMPTS, quickTunnelFlags, namedTunnelArgs, withTunnelTokenEnv, TunnelManager, namedTunnelHandle, binaryRuns, createBinaryReadiness, type TunnelHandle, type TunnelPhase, type TunnelTarget } from '../src/tunnel.ts'

/** A fake tunnel process: an EventEmitter the test drives by hand. */
class FakeTunnel extends EventEmitter implements TunnelHandle {
  readonly stop = vi.fn(() => true)
  /** Emit the minted URL exactly like the cloudflared package does. */
  emitUrl(url: string): void { this.emit('url', url) }
  /** Emit an unexpected exit like the package's process wrapper does. */
  emitExit(code = 1, signal: NodeJS.Signals | null = null): void { this.emit('exit', code, signal) }
}

/** Manually-driven timer queue. */
interface TimerTask { fn: () => void; id: number }
function makeTimers() {
  const tasks: TimerTask[] = []
  let nextId = 1
  const timer = {
    setTimeout: (fn: () => void): number => {
      tasks.push({ fn, id: nextId })
      return nextId++
    },
    clearTimeout: (t: unknown): void => {
      const index = tasks.findIndex(task => task.id === t)
      if (index >= 0) tasks.splice(index, 1)
    },
  }
  /** Run the first pending task (the only one a phase transition schedules). */
  const fireOne = (): void => {
    const task = tasks.shift()
    if (task !== undefined) task.fn()
  }
  return { timer, tasks, fireOne }
}

interface Harness {
  manager: TunnelManager
  tunnels: FakeTunnel[]
  targets: TunnelTarget[]
  phases: TunnelPhase[]
  urls: string[]
  ensure: ReturnType<typeof vi.fn<() => Promise<void>>>
  fireOne: () => void
}

function makeHarness(overrides: { urlTimeoutMs?: number; restartBaseMs?: number } = {}): Harness {
  const tunnels: FakeTunnel[] = []
  const targets: TunnelTarget[] = []
  const ensure = vi.fn(async () => {})
  const { timer, fireOne } = makeTimers()
  const phases: TunnelPhase[] = []
  const urls: string[] = []
  const manager = new TunnelManager({
    factory: (target) => {
      targets.push(target)
      const tunnel = new FakeTunnel()
      tunnels.push(tunnel)
      return tunnel
    },
    ensureBinary: ensure,
    timer,
    urlTimeoutMs: overrides.urlTimeoutMs ?? 30_000,
    restartBaseMs: overrides.restartBaseMs ?? 5_000,
    restartMaxMs: overrides.restartMaxMs ?? 60_000,
  })
  manager.onPhase(info => { phases.push(info.phase) })
  manager.onUrl(url => { urls.push(url) })
  return { manager, tunnels, targets, phases, urls, ensure, fireOne }
}

/** Wait until the manager spawned its next tunnel process. */
async function nextTunnel(h: Harness): Promise<FakeTunnel> {
  await vi.waitFor(() => { expect(h.tunnels.length).toBeGreaterThan(0) })
  return h.tunnels[h.tunnels.length - 1]
}

describe('TunnelManager', () => {
  it('mints a URL: starting → running with the URL surfaced', async () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    await vi.waitFor(() => { expect(h.ensure).toHaveBeenCalledOnce() })
    const tunnel = await nextTunnel(h)
    expect(h.manager.info.phase).toBe('starting')
    tunnel.emitUrl('https://abc.trycloudflare.com')
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://abc.trycloudflare.com' })
    expect(h.urls).toEqual(['https://abc.trycloudflare.com'])
    expect(h.phases).toEqual(['starting', 'running'])
  })

  it('is idempotent while running against the same target', async () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    const tunnel = await nextTunnel(h)
    tunnel.emitUrl('https://a.trycloudflare.com')
    h.manager.start('http://127.0.0.1:3080')
    await new Promise(resolve => setImmediate(resolve))
    expect(h.tunnels).toHaveLength(1)
  })

  it('restarts when the target URL changes', async () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    const first = await nextTunnel(h)
    first.emitUrl('https://a.trycloudflare.com')
    h.manager.start('http://127.0.0.1:3081')
    const second = await nextTunnel(h)
    expect(h.tunnels).toHaveLength(2)
    expect(first.stop).toHaveBeenCalled()
    expect(h.manager.info.phase).toBe('starting')
    second.emitUrl('https://b.trycloudflare.com')
    expect(h.manager.info.url).toBe('https://b.trycloudflare.com')
  })

  it('fails on URL timeout, then retries with backoff', async () => {
    const h = makeHarness({ urlTimeoutMs: 5_000, restartBaseMs: 10 })
    h.manager.start('http://127.0.0.1:3080')
    const first = await nextTunnel(h)
    h.fireOne() // the URL timeout fires
    expect(h.manager.info.phase).toBe('failed')
    expect(h.manager.info.error).toContain('timed out')
    expect(first.stop).toHaveBeenCalled()
    // Backoff elapses → a fresh attempt spawns a fresh process.
    h.fireOne()
    const second = await nextTunnel(h)
    expect(second).not.toBe(first)
    expect(h.manager.info.phase).toBe('starting')
  })

  it('drops a stale ensureBinary resolution after stop/start (no double handle)', async () => {
    const releases: Array<() => void> = []
    const ensure = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve) }))
    const tunnels: FakeTunnel[] = []
    const { timer } = makeTimers()
    const manager = new TunnelManager({
      factory: () => {
        const tunnel = new FakeTunnel()
        tunnels.push(tunnel)
        return tunnel
      },
      ensureBinary: ensure,
      timer,
      urlTimeoutMs: 30_000,
      restartBaseMs: 5_000,
      restartMaxMs: 60_000,
    })

    manager.start('http://127.0.0.1:3080')
    expect(releases.length).toBe(1)
    manager.stop()
    manager.start('http://127.0.0.1:3081')
    expect(releases.length).toBe(2)

    // The first (stale) resolution must NOT spawn a handle — a second start
    // superseded it.
    releases[0]!()
    await vi.waitFor(() => { expect(tunnels.length).toBe(0) })

    // The current attempt's resolution spawns exactly one handle.
    releases[1]!()
    await vi.waitFor(() => { expect(tunnels.length).toBe(1) })
  })

  it('restarts after an unexpected exit and recovers to running', async () => {
    const h = makeHarness({ restartBaseMs: 10 })
    h.manager.start('http://127.0.0.1:3080')
    const first = await nextTunnel(h)
    first.emitExit(1)
    expect(h.manager.info.phase).toBe('failed')
    h.fireOne() // backoff
    const second = await nextTunnel(h)
    expect(second).not.toBe(first)
    second.emitUrl('https://c.trycloudflare.com')
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://c.trycloudflare.com' })
  })

  it('stop() halts restarts and resets state', async () => {
    const h = makeHarness({ urlTimeoutMs: 5_000, restartBaseMs: 10 })
    h.manager.start('http://127.0.0.1:3080')
    await nextTunnel(h)
    h.fireOne() // timeout → failed, backoff scheduled
    h.manager.stop()
    expect(h.manager.info.phase).toBe('stopped')
    h.fireOne() // the pending backoff must be gone
    await new Promise(resolve => setImmediate(resolve))
    expect(h.tunnels).toHaveLength(1)
    expect(h.tunnels[0].stop).toHaveBeenCalled()
  })

  it('never restarts after stop() following a crash', async () => {
    const h = makeHarness({ restartBaseMs: 10 })
    h.manager.start('http://127.0.0.1:3080')
    const tunnel = await nextTunnel(h)
    tunnel.emitUrl('https://a.trycloudflare.com')
    h.manager.stop()
    tunnel.emitExit(0) // a late exit after teardown must be ignored
    expect(h.manager.info.phase).toBe('stopped')
    expect(h.tunnels).toHaveLength(1)
  })

  it('reports a binary install failure with the error message', async () => {
    const failing = new TunnelManager({
      factory: () => new FakeTunnel(),
      ensureBinary: async () => { throw new Error('network unreachable') },
      timer: makeTimers().timer,
      restartBaseMs: 10,
    })
    failing.start('http://127.0.0.1:3080')
    await vi.waitFor(() => {
      expect(failing.info.phase).toBe('failed')
      expect(failing.info.error).toContain('could not obtain the cloudflared binary')
      expect(failing.info.error).toContain('network unreachable')
    })
  })

  it('keeps retrying after a binary failure until the binary exists', async () => {
    const spawned: FakeTunnel[] = []
    let fails = true
    const { timer, fireOne } = makeTimers()
    const flaky = new TunnelManager({
      factory: () => {
        const tunnel = new FakeTunnel()
        spawned.push(tunnel)
        return tunnel
      },
      ensureBinary: async () => {
        if (fails) throw new Error('offline')
      },
      timer,
      restartBaseMs: 10,
    })
    flaky.start('http://127.0.0.1:3080')
    await vi.waitFor(() => { expect(flaky.info.phase).toBe('failed') })
    expect(flaky.info.error).toContain('offline')
    fails = false
    fireOne() // backoff elapses → retry, this time the binary exists
    await vi.waitFor(() => { expect(spawned).toHaveLength(1) })
    spawned[0].emitUrl('https://d.trycloudflare.com')
    expect(flaky.info).toEqual({ phase: 'running', url: 'https://d.trycloudflare.com' })
  })
})

describe('TunnelManager named mode', () => {
  const NAMED: TunnelTarget = { kind: 'named', token: 'tok-1', publicUrl: 'https://dsh.example.com' }

  it('runs a named target and surfaces the fixed URL like a minted one', async () => {
    const h = makeHarness()
    h.manager.start(NAMED)
    await vi.waitFor(() => { expect(h.ensure).toHaveBeenCalledOnce() })
    const tunnel = await nextTunnel(h)
    expect(h.targets).toEqual([NAMED])
    tunnel.emitUrl('https://dsh.example.com') // what namedTunnelHandle synthesizes
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://dsh.example.com' })
    expect(h.urls).toEqual(['https://dsh.example.com'])
  })

  it('accepts a bare string as the quick target', async () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    await nextTunnel(h)
    expect(h.targets).toEqual([{ kind: 'quick', targetUrl: 'http://127.0.0.1:3080' }])
  })

  it('restarts when the quick target gains or drops the origin Host header', async () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    const first = await nextTunnel(h)
    h.manager.start({ kind: 'quick', targetUrl: 'http://127.0.0.1:3080', originHostHeader: '69f563d2939cc1f9.dsh-market.com' })
    const second = await nextTunnel(h)
    expect(h.tunnels).toHaveLength(2)
    expect(first.stop).toHaveBeenCalled()
    second.emitUrl('https://e.trycloudflare.com')
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://e.trycloudflare.com' })
    h.manager.start('http://127.0.0.1:3080')
    await nextTunnel(h)
    expect(h.tunnels).toHaveLength(3)
  })

  it('is idempotent while running the same named target', async () => {
    const h = makeHarness()
    h.manager.start(NAMED)
    await nextTunnel(h)
    h.manager.start({ kind: 'named', token: 'tok-1', publicUrl: 'https://dsh.example.com' })
    await new Promise(resolve => setImmediate(resolve))
    expect(h.tunnels).toHaveLength(1)
  })

  it('restarts when the named target changes (new token or new hostname)', async () => {
    const h = makeHarness()
    h.manager.start(NAMED)
    const first = await nextTunnel(h)
    h.manager.start({ kind: 'named', token: 'tok-1', publicUrl: 'https://other.example.com' })
    const second = await nextTunnel(h)
    expect(h.tunnels).toHaveLength(2)
    expect(first.stop).toHaveBeenCalled()
    expect(h.targets[1]).toEqual({ kind: 'named', token: 'tok-1', publicUrl: 'https://other.example.com' })
    second.emitUrl('https://other.example.com')
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://other.example.com' })
  })

  it('crash-restarts a named tunnel with backoff like the quick mode', async () => {
    const h = makeHarness({ restartBaseMs: 10 })
    h.manager.start(NAMED)
    const first = await nextTunnel(h)
    first.emitExit(1)
    expect(h.manager.info.phase).toBe('failed')
    h.fireOne()
    const second = await nextTunnel(h)
    second.emitUrl('https://dsh.example.com')
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://dsh.example.com' })
  })
})

describe('namedTunnelHandle', () => {
  it('reports the fixed URL once, after the first registered connection', () => {
    const inner = new FakeTunnel()
    const handle = namedTunnelHandle(inner, 'https://dsh.example.com')
    const urls: string[] = []
    handle.on('url', (value: string) => { urls.push(value) })
    inner.emit('connected', { id: 'c0', ip: '1.2.3.4', location: 'HKG' })
    inner.emit('connected', { id: 'c1', ip: '1.2.3.4', location: 'HKG' })
    inner.emit('connected', { id: 'c2', ip: '1.2.3.4', location: 'HKG' })
    expect(urls).toEqual(['https://dsh.example.com'])
  })

  it('passes exit through and detaches inner listeners on stop', () => {
    const inner = new FakeTunnel()
    const handle = namedTunnelHandle(inner, 'https://dsh.example.com')
    const exits: Array<[number | null, NodeJS.Signals | null]> = []
    const urls: string[] = []
    handle.on('exit', (code: number | null, signal: NodeJS.Signals | null) => { exits.push([code, signal]) })
    handle.on('url', (value: string) => { urls.push(value) })
    handle.stop()
    inner.emitExit(1)
    inner.emit('connected', { id: 'c0', ip: '1.2.3.4', location: 'HKG' })
    expect(inner.stop).toHaveBeenCalled()
    expect(exits).toEqual([])
    expect(urls).toEqual([])
  })
})

describe('quickTunnelFlags', () => {
  it('shares the lifecycle flags and stamps the origin Host header only when set', () => {
    expect(quickTunnelFlags()).toEqual({ '--no-autoupdate': true, '--protocol': 'http2' })
    expect(quickTunnelFlags('69f563d2939cc1f9.dsh-market.com')).toEqual({
      '--no-autoupdate': true,
      '--protocol': 'http2',
      '--http-host-header': '69f563d2939cc1f9.dsh-market.com',
    })
  })
})

describe('namedTunnelArgs', () => {
  it('operator keeps the account token out of the child argv', () => {
    // Given the named tunnel's spawn flags.
    const args = namedTunnelArgs()
    // When cloudflared is spawned with them, then the top-level flags precede
    // the run subcommand (issues #1432/#1433) and no token reaches argv, where
    // any local user could read it from ps/proc.
    expect(args).toEqual(['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run'])
    const runIdx = args.indexOf('run')
    expect(args.indexOf('--no-autoupdate')).toBeLessThan(runIdx)
    expect(args.indexOf('--protocol')).toBeLessThan(runIdx)
    expect(args).not.toContain('--token')
  })
})

describe('withTunnelTokenEnv', () => {
  it('operator gets the token in the environment for the spawn call only', () => {
    // Given no TUNNEL_TOKEN in the ambient environment.
    delete process.env.TUNNEL_TOKEN
    let seen: string | undefined
    // When the spawn call runs.
    const result = withTunnelTokenEnv('tok-abc', () => {
      seen = process.env.TUNNEL_TOKEN
      return 'handle'
    })
    // Then the child would have inherited it and the host environment is clean.
    expect(seen).toBe('tok-abc')
    expect(result).toBe('handle')
    expect(process.env.TUNNEL_TOKEN).toBeUndefined()
  })

  it('operator keeps a pre-existing TUNNEL_TOKEN value across the spawn call', () => {
    // Given the host already carries a value.
    process.env.TUNNEL_TOKEN = 'ambient'
    try {
      // When a named tunnel spawns, then the previous value is restored even
      // though the spawn call itself saw the tunnel's own token.
      expect(withTunnelTokenEnv('tok-1', () => process.env.TUNNEL_TOKEN)).toBe('tok-1')
      expect(process.env.TUNNEL_TOKEN).toBe('ambient')
    } finally {
      delete process.env.TUNNEL_TOKEN
    }
  })

  it('operator keeps the ambient environment clean when the spawn call throws', () => {
    // Given no TUNNEL_TOKEN in the ambient environment.
    delete process.env.TUNNEL_TOKEN
    // When the spawn call fails, then the variable is still removed.
    expect(() => withTunnelTokenEnv('tok-2', () => { throw new Error('spawn failed') })).toThrow('spawn failed')
    expect(process.env.TUNNEL_TOKEN).toBeUndefined()
  })
})

describe('createBinaryReadiness', () => {
  it('skips the reinstall when the staged binary exists and runs, and caches the verdict', async () => {
    const exists = vi.fn(() => true)
    const runs = vi.fn(async () => true)
    const install = vi.fn(async () => undefined)
    const ensure = createBinaryReadiness('/payload/bin/cloudflared', { exists, runs, install })
    await ensure()
    await ensure()
    expect(install).not.toHaveBeenCalled()
    expect(runs).toHaveBeenCalledTimes(1)
  })

  it('reinstalls when the binary exists but does not run (wrong arch), then trusts the result', async () => {
    let installed = false
    const exists = vi.fn(() => true)
    const runs = vi.fn(async () => installed)
    const install = vi.fn(async () => { installed = true })
    const ensure = createBinaryReadiness('/payload/bin/cloudflared', { exists, runs, install })
    await ensure()
    expect(install).toHaveBeenCalledOnce()
  })

  it('downloads when the binary is absent and fails loudly when the reinstall still does not run', async () => {
    const exists = vi.fn(() => false)
    const runs = vi.fn(async () => false)
    const install = vi.fn(async () => undefined)
    const ensure = createBinaryReadiness('/payload/bin/cloudflared.exe', { exists, runs, install })
    await expect(ensure()).rejects.toThrow(/still does not run/)
    expect(install).toHaveBeenCalledOnce()
  })

  it('operator is not charged one archive download per restart attempt', async () => {
    // Given a binary that can never be made to run (the documented wrong-arch
    // payload) and a manager that retries forever.
    const exists = vi.fn(() => false)
    const runs = vi.fn(async () => false)
    const install = vi.fn(async () => undefined)
    const ensure = createBinaryReadiness('/payload/bin/cloudflared.exe', { exists, runs, install })
    // When the readiness check is consulted across restart rounds.
    for (let round = 0; round < 6; round += 1) {
      await expect(ensure()).rejects.toThrow()
    }
    // Then the platform archive is fetched at most MAX_BINARY_INSTALL_ATTEMPTS
    // times instead of once per attempt.
    expect(install).toHaveBeenCalledTimes(MAX_BINARY_INSTALL_ATTEMPTS)
  })

  it('binaryRuns probes real executability: node runs, a missing file does not', async () => {
    expect(await binaryRuns(process.execPath)).toBe(true)
    expect(await binaryRuns('/definitely/not/an/executable/binary')).toBe(false)
  })
})
