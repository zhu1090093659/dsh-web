/**
 * The host half against a fake cordis context: announcing (issue #839) and the
 * preset DECLARATION that replaces the pre-0.1.7 preset-file sync.
 *
 * Declare = enabled: activation registers the bundled preset with
 * `ctx.agentPresets` and keeps the returned disposer, a committed settings write
 * re-declares through `loader/volatile-update`, and unloading releases the
 * registration. Each test re-imports the module so the mount-once guard cannot
 * swallow a second apply call.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { bundledPresetDir, resolveConfig } from '../src/index.ts'

/** Disposer the fake registry hands back for one declaration. */
interface FakeRegistration {
  /** The definition the plugin declared. */
  definition: PresetDefinition
  /** Whether the plugin released this registration. */
  released: boolean
}

/** The host surface `apply` touches, with everything the tests observe. */
interface FakeHost {
  ctx: never
  /** The sections the announcement registered, in order. */
  sections: { name: string, order: number, text: string }[]
  /** The declarations the plugin submitted, in order. */
  declarations: FakeRegistration[]
  /** Logger lines the plugin emitted. */
  warnings: string[]
  /** Run every disposer the plugin registered through `ctx.effect`. */
  unload(): Promise<void>
  /** Dispatch `loader/volatile-update` to this fiber's listeners. */
  commit(): void
}

/** Build a fake host context; `withRegistry: false` models a deployment without one. */
function makeHost(options: { withRegistry?: boolean } = {}): FakeHost {
  const sections: FakeHost['sections'] = []
  const declarations: FakeRegistration[] = []
  const warnings: string[] = []
  const effects: unknown[] = []
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const registry = options.withRegistry === false ? undefined : {
    register: async (definition: PresetDefinition) => {
      const record: FakeRegistration = { definition, released: false }
      declarations.push(record)
      return async () => { record.released = true }
    },
  }
  const ctx = {
    systemPrompt: {
      section: (spec: { name: string, order: number, text: string }) => {
        sections.push(spec)
        return () => {}
      },
    },
    effect: (fn: () => unknown) => {
      const disposer = fn()
      effects.push(disposer)
      return disposer
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => { listeners.set(event, (listeners.get(event) ?? []).filter(entry => entry !== listener)) }
    },
    get: (name: string) => (name === 'agentPresets' ? registry : undefined),
    logger: { warn: (message: string) => { warnings.push(message) }, info: () => {} },
  }
  return {
    ctx: ctx as never,
    sections,
    declarations,
    warnings,
    async unload() {
      for (const disposer of effects.splice(0)) {
        if (typeof disposer === 'function') await (disposer as () => unknown)()
      }
    },
    commit() {
      for (const listener of listeners.get('loader/volatile-update') ?? []) listener([])
    },
  }
}

/**
 * Flush the declaration queue. It is pure promise chaining, so a bounded run of
 * microtask turns settles it without a timer (and without depending on wall
 * clock time).
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 64; turn += 1) await Promise.resolve()
}

/**
 * Hosts mounted by this file, released after each test: the plugin's mount-once
 * guard is process-wide, so a host left mounted would silence the next apply.
 */
const mounted: FakeHost[] = []

afterEach(async () => {
  for (const host of mounted.splice(0)) await host.unload()
})

/** One loaded module plus the host it was applied to. */
async function mount(
  config?: Record<string, unknown>,
  options: { withRegistry?: boolean } = {},
): Promise<{ mod: typeof import('../src/index.ts'), host: FakeHost }> {
  vi.resetModules()
  const mod = await import('../src/index.ts')
  const host = makeHost(options)
  mounted.push(host)
  mod.apply(host.ctx, config as never)
  await settle()
  return { mod, host }
}

describe('dsh-liangshen announcement (issue #839)', () => {
  it('operator keeps the announcement off until the schema default is changed', async () => {
    // Given the shipped Config schema, When the operator reads its defaults,
    // Then the announcement stays off while the plugin itself stays enabled.
    vi.resetModules()
    const mod = await import('../src/index.ts')
    expect(resolveConfig(mod.Config({}))).toMatchObject({ announceToAgent: false, enabled: true })
  })

  it('operator turns the announcement on and the section carries the guidance', async () => {
    // Given a config that announces the plugin, When the operator activates
    // it, Then one system-prompt section carries the guidance text.
    const { mod, host } = await mount({ announceToAgent: true })
    expect(host.sections.length).toBe(1)
    expect(host.sections[0]?.name).toBe('plugin:dsh-liangshen')
    expect(host.sections[0]?.text).toBe(mod.LIANGSHEN_GUIDANCE)
  })

  it('operator keeps every prompt clean under the default config', async () => {
    // Given an activation with no config at all, When the operator mounts the
    // plugin, Then no announcement section registers.
    const { host } = await mount(undefined)
    expect(host.sections.length).toBe(0)
  })
})

describe('dsh-liangshen preset declaration', () => {
  it('operator gets the bundled preset declared at activation and released on unload', async () => {
    // Given a host whose registry is mounted, When the operator activates the
    // plugin, Then the shipped preset is declared and unload releases it.
    const { host } = await mount(undefined)
    expect(host.declarations.length).toBe(1)
    const { definition } = host.declarations[0]!
    expect(definition.id).toBe('liangshen')
    // Display text comes from the preset's own preset.yml, so the roster shows
    // the same name an installed copy would.
    expect(definition.name).toBe('梁神模式')
    expect(definition.order).toBe(4)
    expect(definition.plugins.length).toBeGreaterThan(20)
    // Relative module names point inside the bundled preset directory: the
    // registry mounts the declaration under its own loader base.
    for (const plugin of definition.plugins) {
      if ((plugin.name ?? '').startsWith('file:')) expect(plugin.name).toContain('presets')
    }
    await host.unload()
    expect(host.declarations[0]?.released).toBe(true)
  })

  it('operator gets the committed settings applied to the rows they shape', async () => {
    // Given committed presentation and guard settings, When the operator
    // activates the plugin, Then the declared rows carry those values.
    const { host } = await mount({ presentation: 'ptc', guardEnabled: false, guardEchoFailures: 5 })
    const rows = host.declarations[0]!.definition.plugins as readonly { id?: string, config?: Record<string, unknown> }[]
    expect(rows.find(row => row.id === 'tool-catalog')?.config?.['presentation']).toBe('ptc')
    expect(rows.find(row => row.id === 'guard')?.config).toEqual({
      enabled: false,
      sensitivity: 'balanced',
      stallReasoningChars: 8000,
      globalStallCap: 4,
      echoFailures: 5,
    })
  })

  it('operator keeps the roster and the prompt untouched while the master switch is off', async () => {
    // Given a disabled row that still asks for the announcement, When the
    // operator activates it, Then nothing is declared and nothing is announced.
    const { host } = await mount({ enabled: false, announceToAgent: true })
    expect(host.declarations.length).toBe(0)
    expect(host.sections.length).toBe(0)
  })

  it('operator sees a committed settings write re-declare the preset', async () => {
    // Given a running row whose volatile references the Host commits into,
    // When the operator writes a new presentation and the Loader announces it,
    // Then the preset is declared again and the previous declaration released.
    vi.resetModules()
    const mod = await import('../src/index.ts')
    let presentation = 'both'
    let announceToAgent = false
    const host = makeHost()
    mounted.push(host)
    mod.apply(host.ctx, {
      presentation: { get: () => presentation } as never,
      announceToAgent: { get: () => announceToAgent } as never,
    })
    await settle()
    expect(host.declarations.length).toBe(1)

    presentation = 'native'
    announceToAgent = true
    host.commit()
    await settle()
    expect(host.declarations.length).toBe(2)
    expect(host.declarations[0]?.released).toBe(true)
    const rows = host.declarations[1]!.definition.plugins as readonly { id?: string, config?: Record<string, unknown> }[]
    expect(rows.find(row => row.id === 'tool-catalog')?.config?.['presentation']).toBe('native')
    expect(host.sections.length).toBe(1)
  })

  it('operator gets a burst of settings writes settled on the last one', async () => {
    // Given a running row and two committed writes in a row, When the operator
    // lets the declaration queue drain, Then one live declaration holds the
    // last value and every predecessor is released.
    vi.resetModules()
    const mod = await import('../src/index.ts')
    let presentation = 'both'
    const host = makeHost()
    mounted.push(host)
    mod.apply(host.ctx, { presentation: { get: () => presentation } as never })
    await settle()
    presentation = 'native'
    host.commit()
    presentation = 'ptc'
    host.commit()
    await settle()
    const live = host.declarations.filter(record => !record.released)
    expect(live.length).toBe(1)
    const rows = live[0]!.definition.plugins as readonly { id?: string, config?: Record<string, unknown> }[]
    expect(rows.find(row => row.id === 'tool-catalog')?.config?.['presentation']).toBe('ptc')
  })

  it('operator keeps a registry-less deployment running with a warning', async () => {
    // Given a deployment that composes no agent-preset registry, When the
    // operator activates the plugin, Then it warns instead of failing.
    const { host } = await mount(undefined, { withRegistry: false })
    expect(host.declarations.length).toBe(0)
    expect(host.warnings.join('\n')).toContain('agent-preset registry is unavailable')
  })

  it('operator gets no declaration when a write lands while the row unloads', async () => {
    // Given an unloaded row, When a settings write still reaches its
    // listener, Then no preset is declared for it.
    const { host } = await mount(undefined)
    await host.unload()
    host.commit()
    await settle()
    // The committed write must not re-declare a preset for an unloaded row.
    expect(host.declarations.filter(record => !record.released).length).toBe(0)
  })

  it('operator has the bundled preset directory holding the composition', () => {
    // Given the installed package, When the operator reads the bundled preset
    // directory, Then it names the presets tree.
    expect(bundledPresetDir()).toContain('presets')
  })
})
