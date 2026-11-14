/**
 * Mount contract: which hosts get the win_bash tool and what an unsupported
 * host, a rejected payload or a rejected config sees instead.
 *
 * This is the package's platform AND registration contract, so it is asserted
 * against the shipped entry's own apply, never a copy. Registration follows the
 * platform, the shipped payload and the configuration alone: no mount here
 * publishes an agent-preset registry, and the registration cases additionally
 * fail if the entry so much as asks for one.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.ts'
import { CONFIG_DEFAULTS, resolveConfig } from '../src/config.ts'
import { RUNTIME_ROOT_ENV, resolveRuntime } from '../src/runtime.ts'

/** The plugin surface one host would see, recorded instead of asserted on a mock. */
interface Recorded {
  /** Every tool definition the entry registered. */
  readonly tools: { name: string }[]
  /** Whether the fiber-level tool effect was installed at all. */
  effectInstalled: boolean
  /** Log lines the entry emitted, each tagged with its severity. */
  readonly logs: string[]
  /** Every service name the entry asked the context for. */
  readonly serviceReads: string[]
}

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
  // prepareRuntime() can fall back to an isolated cache root when the DSH home
  // tree is labelled Low. Keep that fallback inside this suite's temp home too,
  // so a mount can never write into the cache of whoever runs the tests.
  process.env[RUNTIME_ROOT_ENV] = join(HOME, 'isolated')
})

afterAll(() => {
  delete process.env.DSH_HOME
  delete process.env[RUNTIME_ROOT_ENV]
  rmSync(HOME, { recursive: true, force: true })
})

/**
 * The payload resolution this host produces. A host that cannot serve the
 * vendored shell has no runtime to mount, and every registration assertion is a
 * statement about a host that CAN; the platform contract test pins the refusal,
 * and the registration suite skips on such a host.
 */
const runtime = resolveRuntime({ platform: process.platform, arch: process.arch })
const isWindowsX64 = process.platform === 'win32' && process.arch === 'x64'

/**
 * The structural context every mount in this suite runs against.
 *
 * It is a plain object rather than the module graph's real Context: this test
 * certifies the entry's OWN decision to register, so it must be able to present
 * a deployment with no agent-preset registry at all. Only the members the entry
 * actually reads exist here, and every service lookup is recorded so a case can
 * prove the entry never reached for a registry.
 * @param recorded - the sink the context writes its observations into.
 * @param options - services the context publishes, plus a tool-registry override.
 * @returns the context, typed as the entry's parameter.
 */
function structuralContext(
  recorded: Recorded,
  options: {
    services?: Record<string, unknown>
    registerTool?: (tool: { name: string }) => void
  } = {},
): Context {
  const services = options.services ?? {}
  const registerTool = options.registerTool ?? ((tool: { name: string }) => { recorded.tools.push(tool) })
  return {
    logger: {
      info: (message: string) => { recorded.logs.push('info ' + message) },
      warn: (message: string) => { recorded.logs.push('warn ' + message) },
      error: (message: string) => { recorded.logs.push('error ' + message) },
    },
    get: (service: string) => {
      recorded.serviceReads.push(service)
      return services[service]
    },
    on: () => () => {},
    effect: (body: () => unknown) => {
      recorded.effectInstalled = true
      if (typeof body === 'function') body()
    },
    tools: { register: (tool: { name: string }) => { registerTool(tool); return () => {} } },
    subprocess: { spawn: () => { throw new Error('this host must never reach a spawn') } },
    inject: () => ({ dispose: () => {} }),
  } as unknown as Context
}

/**
 * Drive the SHIPPED apply — the entry point the loader calls — and report what
 * it did. apply registers synchronously once the payload and config check out.
 * @param config - the row config to mount with.
 * @param options - services published to the context and a tool-registry override.
 * @returns what the entry registered and logged.
 */
function mountOn(
  config: unknown,
  options: Parameters<typeof structuralContext>[1] = {},
): Recorded {
  const recorded: Recorded = { tools: [], effectInstalled: false, logs: [], serviceReads: [] }
  apply(structuralContext(recorded, options), config as never)
  return recorded
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

  it('operator on a host without the payload is refused with a line saying so', () => {
    // Given a host that cannot serve the vendored shell,
    if (isWindowsX64) return
    // When the entry mounts with no config,
    const recorded = mountOn(undefined)
    // Then it registers nothing and says the mount was refused.
    expect(recorded.tools).toEqual([])
    expect(recorded.logs.join('\n')).toContain('was not mounted')
  })

  it('operator on any host never gets a tool named bash or pwsh from this package', () => {
    // Given the shipped entry,
    // When it mounts,
    const recorded = mountOn(undefined)
    // Then it claims no name the host's own bash-family tools already use:
    // a colliding id would replace or be replaced, silently either way.
    expect(recorded.tools.some(tool => tool.name === 'bash')).toBe(false)
    expect(recorded.tools.some(tool => tool.name === 'pwsh')).toBe(false)
  })
})

describe('the win_bash registration contract', () => {
  const registrationIt = isWindowsX64 ? it : it.skip

  registrationIt('operator on a supported host gets the win_bash tool with no preset registry present', () => {
    // Given a deployment that publishes no agent-preset registry (and no
    // registry is available for the entry to read),
    // When the entry mounts with no config,
    const recorded = mountOn(undefined)
    // Then the tool registers from the platform and the payload alone,
    expect(recorded.tools.map(tool => tool.name)).toEqual(['win_bash'])
    // And the entry never even asked for a registry: no roster was read.
    expect(recorded.serviceReads).not.toContain('agentPresets')
  })

  registrationIt('operator whose deployment carries a registry that would fail still gets the tool', () => {
    // Given a deployment where reading a roster would throw,
    const registry = { list: () => { throw new Error('the roster must never be read') } }
    // When the entry mounts,
    const recorded = mountOn(undefined, { services: { agentPresets: registry } })
    // Then registration does not depend on that registry at all: the tool is
    // registered and the failing roster was never consulted.
    expect(recorded.tools.map(tool => tool.name)).toEqual(['win_bash'])
    expect(recorded.serviceReads).not.toContain('agentPresets')
  })

  registrationIt('operator mounting a legacy row that still carries syncWithLiangShen gets the tool', () => {
    // Given an old profile row still carrying the retired availability key,
    const legacy: Record<string, unknown> = { syncWithLiangShen: false }
    // When the config is resolved and the entry mounts,
    expect(() => resolveConfig(legacy as never)).not.toThrow()
    const recorded = mountOn(legacy)
    // Then the leftover key is ignored and the tool registers as usual.
    expect(recorded.tools.map(tool => tool.name)).toEqual(['win_bash'])
  })

  registrationIt('operator mounting a config the schema rejects gets no tool and one rejection', () => {
    // Given a supported host and a config the schema rejects,
    const recorded: Recorded = { tools: [], effectInstalled: false, logs: [], serviceReads: [] }
    let threw = false
    // When the entry mounts with that config,
    try {
      apply(structuralContext(recorded), { timeoutMs: 1 })
    } catch {
      threw = true
    }
    // Then the config error is thrown and no tool was registered before it.
    expect(threw).toBe(true)
    expect(recorded.tools).toEqual([])
  })

  registrationIt('operator whose tool registry refuses the registration gets a registration error', () => {
    // Given a supported host whose tool registry refuses the registration,
    const recorded = mountOn(undefined, {
      registerTool: () => { throw new Error('tool id already claimed') },
    })
    // Then the failure is logged as a registration error rather than escaping
    // apply as an unhandled rejection or silently dropping the tool.
    expect(recorded.logs.join('\n')).toContain('could not be registered')
  })
})
