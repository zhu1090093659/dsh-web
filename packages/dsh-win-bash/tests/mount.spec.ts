/**
 * Mount gating: which hosts get the win_bash tool, what the LiangShen
 * availability gate decides, and what a host that gets nothing sees instead.
 * This is the package's platform AND availability contract, so it is asserted
 * against the shipped entry's own apply and mountWithGate, never a copy.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, mountWithGate, name } from '../src/index.ts'
import { CONFIG_DEFAULTS, resolveConfig } from '../src/config.ts'
import { resolveRuntime } from '../src/runtime.ts'

/** The plugin surface one host would see, recorded instead of asserted on a mock. */
interface Recorded {
  /** Every tool definition the entry registered. */
  readonly tools: { name: string }[]
  /** Whether the fiber-level tool effect was installed at all. */
  effectInstalled: boolean
  /** Log lines the entry emitted, each tagged with its severity. */
  readonly logs: string[]
}

/**
 * Gate deadlines small enough to exercise the bounded waits without a slow
 * suite: a declaration that never appears is chased on a millisecond cadence
 * for a few milliseconds instead of the shipped five seconds.
 */
const FAST_GATE = {
  settleTimeoutMs: 200,
  readTimeoutMs: 200,
  declarationWaitMs: 20,
  pollIntervalMs: 5,
} as const

/**
 * The DSH home this suite publishes the payload into.
 *
 * apply() prepares the runtime before the tool is built, which on Windows x64
 * publishes a payload copy under the DSH home. A real home would make this
 * suite write into whoever runs it; an isolated one keeps that inside the test.
 */
const HOME = mkdtempSync(join(tmpdir(), 'dsh-win-bash-mount-spec-'))

beforeAll(() => {
  process.env.DSH_HOME = HOME
})

afterAll(() => {
  delete process.env.DSH_HOME
  rmSync(HOME, { recursive: true, force: true })
})

/**
 * The payload resolution this host produces. A host that cannot serve the
 * vendored shell has no runtime to mount, and every availability assertion
 * below is a statement about a host that CAN; the platform contract test pins
 * the refusal, and the availability suite skips on such a host.
 */
const runtime = resolveRuntime({ platform: process.platform, arch: process.arch })
const isWindowsX64 = process.platform === 'win32' && process.arch === 'x64'

/**
 * The structural context every mount in this suite runs against.
 *
 * It is a plain object rather than the module graph's real Context: this test
 * certifies the entry's OWN gating decision, so it must be able to present a
 * deployment whose agent-preset registry declares one roster or another. Only
 * the members the entry actually reads exist here.
 * @param recorded - the sink the context writes its observations into.
 * @param services - services the context publishes (agentPresets, loader).
 * @returns the context, typed as the entry's parameter.
 */
function structuralContext(recorded: Recorded, services: Record<string, unknown>): Context {
  return {
    logger: {
      info: (message: string) => { recorded.logs.push('info ' + message) },
      warn: (message: string) => { recorded.logs.push('warn ' + message) },
      error: (message: string) => { recorded.logs.push('error ' + message) },
    },
    get: (service: string) => services[service],
    on: () => () => {},
    effect: (body: () => unknown) => {
      recorded.effectInstalled = true
      if (typeof body === 'function') body()
    },
    tools: { register: (tool: { name: string }) => { recorded.tools.push(tool); return () => {} } },
    subprocess: { spawn: () => { throw new Error('this host must never reach a spawn') } },
    inject: () => ({ dispose: () => {} }),
  } as unknown as Context
}

/**
 * Drive one mount through the shipped gate seam and report what it did.
 * @param config - the row config to mount with.
 * @param services - services the context publishes (agentPresets, loader).
 * @returns what the entry registered and logged.
 */
async function mountOn(config: unknown, services: Record<string, unknown> = {}): Promise<Recorded> {
  const recorded: Recorded = { tools: [], effectInstalled: false, logs: [] }
  if ('code' in runtime) throw new Error('this host cannot serve the vendored payload')
  await mountWithGate(structuralContext(recorded, services), resolveConfig(config as never), runtime, FAST_GATE)
  return recorded
}

/**
 * Drive the SHIPPED apply — the entry point the loader calls — and report what
 * it did.
 *
 * apply registers the gate continuation instead of awaiting it, so this waits
 * one macrotask turn for that continuation. The gate then uses the SHIPPED
 * deadlines, which is why every caller of this helper is a refusal that returns
 * before the gate is reached.
 * @param config - the row config to mount with.
 * @returns what the entry registered and logged.
 */
async function applyOn(config: unknown): Promise<Recorded> {
  const recorded: Recorded = { tools: [], effectInstalled: false, logs: [] }
  apply(structuralContext(recorded, {}), config as never)
  await new Promise<void>((resolve) => { setImmediate(resolve) })
  return recorded
}

/**
 * The declarations one stand-in agent-preset registry answers with.
 * @param ids - preset ids the roster carries.
 * @param options - throws: fail every read. declareAfter: answer an empty
 *   roster for that many reads first, which is how the declaring plugin's
 *   detached publication looks to this gate.
 */
function presetRegistry(
  ids: readonly string[],
  options: { throws?: boolean; declareAfter?: number } = {},
) {
  const reads: string[] = []
  return {
    reads,
    reader: {
      list: async () => {
        reads.push('read')
        if (options.throws === true) throw new Error('roster unavailable')
        if (options.declareAfter !== undefined && reads.length <= options.declareAfter) return []
        return ids.map(id => ({ id }))
      },
    },
  }
}

describe('the plugin entry surface', () => {
  it('operator mapping profile rows back to the plugin gets one name matching the package', () => {
    // Given the entry's exported cordis identity,
    // When it is compared with the row the bundle patch declares,
    // Then they agree, so a mounted row is never ambiguous.
    expect(name).toBe('dsh-win-bash')
    expect(inject).toEqual(['tools', 'subprocess'])
  })
})

describe('the win_bash platform contract', () => {
  it(
    isWindowsX64
      ? 'operator on a Windows x64 host resolves the vendored shell and nothing else'
      : 'operator on a host without the vendored payload is refused instead of falling back to PATH',
    () => {
      // Given the shipped payload resolution for this host,
      // When it is inspected,
      if (isWindowsX64) {
        // Then Windows x64 resolves the absolute vendored bash.
        expect('code' in runtime).toBe(false)
        if (!('code' in runtime)) expect(runtime.bash).toContain('win32-x64')
      } else {
        // Then every other host is refused with a machine-readable reason, so
        // no code path can quietly substitute a bash found on PATH.
        expect('code' in runtime).toBe(true)
        if ('code' in runtime) expect(runtime.message.length).toBeGreaterThan(0)
      }
    },
  )

  it('operator on a host without the payload is refused with a line saying so', async () => {
    // Given a host that cannot serve the vendored shell,
    if (isWindowsX64) return
    // When the entry mounts with no config,
    const recorded = await applyOn(undefined)
    // Then it registers nothing and says the mount was refused.
    expect(recorded.tools).toEqual([])
    expect(recorded.logs.join('\n')).toContain('was not mounted')
  })

  it('operator on any host never gets a tool named bash or pwsh from this package', async () => {
    // Given the shipped entry,
    // When it mounts,
    const recorded = await applyOn(undefined)
    // Then it claims no name the host's own bash-family tools already use:
    // a colliding id would replace or be replaced, silently either way.
    expect(recorded.tools.some(tool => tool.name === 'bash')).toBe(false)
    expect(recorded.tools.some(tool => tool.name === 'pwsh')).toBe(false)
  })

  it('operator mounting a config the schema rejects gets no tool, not a half-mounted one', async () => {
    // Given a host whose process.platform this package reads directly,
    // When the entry mounts with a config the schema would reject,
    const recorded = (await (async () => {
      try {
        return { tools: (await applyOn({ timeoutMs: 1 })).tools, threw: false }
      } catch {
        return { tools: [] as { name: string }[], threw: true }
      }
    })())
    // Then it registers nothing before validating.
    expect(recorded.threw || recorded.tools.length === 0).toBe(true)
  })
})

describe('the LiangShen availability gate', () => {
  const gateIt = isWindowsX64 ? it : it.skip

  gateIt('operator whose deployment declares the liangshen preset gets the win_bash tool from one roster read', async () => {
    // Given a deployment whose agent-preset registry declares liangshen,
    const registry = presetRegistry(['liangshen'])
    // When the entry mounts,
    const recorded = await mountOn(undefined, { agentPresets: registry.reader })
    // Then the tool registers, and a declaration already visible cost exactly
    // one read: the grace period is not paid.
    expect(recorded.tools.map(tool => tool.name)).toEqual(['win_bash'])
    expect(registry.reads).toHaveLength(1)
  })

  gateIt('operator whose deployment declares no liangshen preset gets no tool and one reason line', async () => {
    // Given a deployment whose registry answers with a different roster,
    const registry = presetRegistry(['standard', 'minimal'])
    // When the entry mounts,
    const recorded = await mountOn(undefined, { agentPresets: registry.reader })
    // Then nothing registers, the gate chased the declaration on its bounded
    // schedule rather than deciding on one read, and the log names the missing
    // declaration instead of failing silently.
    expect(recorded.tools).toEqual([])
    expect(registry.reads.length).toBeGreaterThan(1)
    expect(recorded.logs.join('\n')).toContain('no preset with id liangshen is declared')
  })

  gateIt('operator on a deployment that declares the preset late still gets the tool', async () => {
    // Given a registry whose first reads do not yet carry the declaration —
    // the shape of a declaring plugin publishing off its activation return, so
    // the tree settles before the definition lands,
    const registry = presetRegistry(['liangshen'], { declareAfter: 2 })
    // When the entry mounts,
    const recorded = await mountOn(undefined, { agentPresets: registry.reader })
    // Then the gate keeps re-reading and registers the tool once the
    // declaration appears, instead of refusing a deployment that has it.
    expect(recorded.tools.map(tool => tool.name)).toEqual(['win_bash'])
    expect(registry.reads.length).toBeGreaterThan(2)
  })

  gateIt('operator whose deployment publishes no preset registry gets no tool and one reason line', async () => {
    // Given a deployment with no agent-preset registry at all,
    // When the entry mounts,
    const recorded = await mountOn(undefined, {})
    // Then nothing registers and the log names the absent registry.
    expect(recorded.tools).toEqual([])
    expect(recorded.logs.join('\n')).toContain('publishes no agent-preset registry')
  })

  gateIt('operator whose registry roster cannot be read gets no tool rather than a broken one', async () => {
    // Given a published registry whose roster read fails,
    const registry = presetRegistry([], { throws: true })
    // When the entry mounts,
    const recorded = await mountOn(undefined, { agentPresets: registry.reader })
    // Then nothing registers, and the log separates this from an ordinary
    // undeclared roster so an operator sees the real problem.
    expect(recorded.tools).toEqual([])
    expect(recorded.logs.join('\n')).toContain('roster could not be read')
  })

  gateIt('operator turning the escape hatch off gets the tool with no roster read at all', async () => {
    // Given a deployment that declares no liangshen preset,
    const registry = presetRegistry(['standard'])
    // When the row sets the escape hatch,
    const recorded = await mountOn(
      { ...CONFIG_DEFAULTS, syncWithLiangShen: false },
      { agentPresets: registry.reader },
    )
    // Then the gate is skipped entirely: no roster read, no reason line, and
    // the tool still registers.
    expect(registry.reads).toEqual([])
    expect(recorded.tools.map(tool => tool.name)).toEqual(['win_bash'])
    expect(recorded.logs.join('\n')).not.toContain('was not registered')
  })

  gateIt('operator leaving the sync switch at its default keeps the gate in force', async () => {
    // Given a row that configures the timeout only,
    const registry = presetRegistry(['standard'])
    // When the entry mounts,
    const recorded = await mountOn({ timeoutMs: 2000 }, { agentPresets: registry.reader })
    // Then the shipped default kept the gate on: the roster was read and the
    // refusal names the missing preset.
    expect(recorded.tools).toEqual([])
    expect(registry.reads.length).toBeGreaterThan(0)
    expect(recorded.logs.join('\n')).toContain('syncWithLiangShen is on')
  })

  gateIt('operator whose tool registry refuses the registration gets a registration error, not a gate one', async () => {
    // Given a deployment that declares the preset but whose tool registry
    // refuses the registration,
    const registry = presetRegistry(['liangshen'])
    const recorded: Recorded = { tools: [], effectInstalled: false, logs: [] }
    const ctx = {
      logger: {
        info: (message: string) => { recorded.logs.push('info ' + message) },
        warn: (message: string) => { recorded.logs.push('warn ' + message) },
        error: (message: string) => { recorded.logs.push('error ' + message) },
      },
      get: (service: string) => (service === 'agentPresets' ? registry.reader : undefined),
      on: () => () => {},
      effect: (body: () => unknown) => { if (typeof body === 'function') body() },
      tools: { register: () => { throw new Error('tool id already claimed') } },
      subprocess: { spawn: () => { throw new Error('this host must never reach a spawn') } },
    } as unknown as Context
    // When the entry mounts,
    if ('code' in runtime) throw new Error('this host cannot serve the vendored payload')
    await mountWithGate(ctx, resolveConfig(undefined), runtime, FAST_GATE)
    // Then the log attributes the failure to registration and does NOT blame the
    // availability gate, which is what would send an operator to the wrong place.
    const logged = recorded.logs.join('\n')
    expect(logged).toContain('could not be registered')
    expect(logged).not.toContain('availability gate failed')
  })

  gateIt('operator on a deployment whose host tree never settles still gets a verdict', async () => {
    // Given a loader service that never settles,
    const never = { await: () => new Promise<void>(() => {}) }
    const registry = presetRegistry(['liangshen'])
    // When the entry mounts,
    const recorded = await mountOn(undefined, { loader: never, agentPresets: registry.reader })
    // Then the bounded settle wait expires instead of hanging the boot, and
    // the roster is still read, so the verdict arrives either way.
    expect(recorded.tools.map(tool => tool.name)).toEqual(['win_bash'])
  })
})
