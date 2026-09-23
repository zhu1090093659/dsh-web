/**
 * Host-half settings surfaces: under the 0.1.7 settings model the plugin's own
 * Config schema is the entry's settings page, so the SSH surfaces (routes,
 * tools, prompt section) follow the config this instance was activated with —
 * including a settings edit the loader commits into its volatile references
 * without remounting the instance.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '../src/index.ts'

/**
 * The shared reference protocol cosmokit commits a volatile value through
 * (`Symbol.for` keys it so an ESM and a CJS copy agree on the same slot).
 * The loader writes through it; the test stands in for the loader.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** What the fake Host context recorded, as the live registrations stand now. */
interface RecordedSurfaces {
  routes: string[]
  tools: string[]
  sections: string[]
  upgrades: number
}

/** A fake host context: effects, the three surface registries, and the loader entry. */
interface FakeHost {
  ctx: Context
  recorded: RecordedSurfaces
  /** Deliver an event to the listeners this plugin installed. */
  emit: (event: string) => void
  /** Run every recorded disposer in reverse registration order. */
  teardown: () => void
}

/** One registration that removes itself from its log when disposed. */
function register(log: string[], name: string): () => void {
  log.push(name)
  return () => {
    const at = log.indexOf(name)
    if (at >= 0) log.splice(at, 1)
  }
}

/**
 * Build the fake host context for one mount.
 * @param profileEntryConfig - the raw config the profile row declares, when it declares one.
 * @returns the context, its recorded surfaces, and its teardown.
 */
function fakeHost(profileEntryConfig?: Record<string, unknown>): FakeHost {
  const recorded: RecordedSurfaces = { routes: [], tools: [], sections: [], upgrades: 0 }
  const disposers: Array<() => void> = []
  const listeners = new Map<string, Array<() => void>>()
  const ctx = {
    fiber: { entry: profileEntryConfig === undefined ? undefined : { options: { config: profileEntryConfig } } },
    effect: (fn: () => unknown) => {
      const result = fn()
      const release = typeof result === 'function' ? result as () => void : () => {}
      let released = false
      // cordis runs the effect body, returns a handle that releases it, and
      // releases everything again when the fiber unloads.
      const dispose = () => {
        if (released) return
        released = true
        release()
      }
      disposers.push(dispose)
      return dispose
    },
    on: (event: string, listener: () => void) => {
      const held = listeners.get(event) ?? []
      held.push(listener)
      listeners.set(event, held)
    },
    systemPrompt: {
      section: (options: { name: string }) => register(recorded.sections, options.name),
    },
    webServer: {
      register: (route: { path: string }) => register(recorded.routes, route.path),
      registerUpgrade: () => {
        recorded.upgrades += 1
        return () => { recorded.upgrades -= 1 }
      },
    },
    tools: {
      register: (tool: { name: string }) => register(recorded.tools, tool.name),
    },
  }
  return {
    ctx: ctx as unknown as Context,
    recorded,
    emit: (event) => {
      for (const listener of listeners.get(event) ?? []) listener()
    },
    teardown: () => {
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
  }
}

/** Directory holding this test's DSH home, so no real host store is touched. */
const homes: string[] = []
/** DSH home the process environment pointed at before the first test. */
const originalDshHome = process.env.DSH_HOME

/**
 * Point DSH_HOME at a fresh directory.
 * @param hosts - host records to seed the store file with.
 * @returns the directory.
 */
function useDshHome(hosts: Array<Record<string, unknown>> = []): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-ssh-settings-'))
  homes.push(home)
  if (hosts.length > 0) writeFileSync(join(home, 'dsh-ssh.json'), JSON.stringify({ version: 1, hosts }), 'utf8')
  process.env.DSH_HOME = home
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

describe('dsh-ssh host surfaces follow the plugin config', () => {
  it('operator gets a generated settings page because every configurable field is volatile', () => {
    // Given the plugin Config schema the Host projects the entry's settings form from
    const schema = Config as unknown as { dict: Record<string, { meta: { volatile?: boolean } }> }

    // When the Host reads each field's declared live-update metadata
    const declared = Object.entries(schema.dict).map(([field, node]) => [field, node.meta.volatile === true])

    // Then every field is volatile, which is what puts it on that page and lets an edit land live
    expect(declared).toEqual([
      ['announceToAgent', true],
      ['enabled', true],
      ['terminalFontFamily', true],
    ])
  })

  it('operator gets routes and tools but no announcement from the schema defaults', () => {
    // Given a profile entry that declares no config
    useDshHome()
    const host = fakeHost()

    // When the plugin applies
    apply(host.ctx, Config({}))

    // Then the routes, their terminal upgrade and the tools are registered, and the prompt stays clean
    expect(host.recorded.routes.length).toBeGreaterThan(0)
    expect(host.recorded.upgrades).toBe(1)
    expect(host.recorded.tools).toEqual([
      'ssh_list', 'ssh_exec', 'ssh_upload', 'ssh_download', 'ssh_tunnel', 'ssh_cluster',
    ])
    expect(host.recorded.sections).toEqual([])
    host.teardown()
  })

  it('operator gets no surface when the config disables the plugin', () => {
    // Given a profile entry that turns the master switch off
    useDshHome()
    const host = fakeHost({ enabled: false })

    // When the plugin applies
    apply(host.ctx, Config({ enabled: false }))

    // Then nothing is registered
    expect(host.recorded).toEqual({ routes: [], tools: [], sections: [], upgrades: 0 })
    host.teardown()
  })

  it('operator loses and regains every surface when the settings edit lands without a remount', () => {
    // Given a running instance whose config was resolved from the schema defaults
    useDshHome()
    const host = fakeHost()
    const config = Config({})
    apply(host.ctx, config)
    const reference = config.enabled as unknown as Record<symbol, (next: boolean) => void>

    // When the Host commits enabled false and announces the volatile update
    reference[VOLATILE_WRITE](false)
    host.emit('loader/volatile-update')

    // Then every surface is gone
    expect(host.recorded).toEqual({ routes: [], tools: [], sections: [], upgrades: 0 })

    // When the operator turns the switch back on through the same reference
    reference[VOLATILE_WRITE](true)
    host.emit('loader/volatile-update')

    // Then the routes and the tools are registered again
    expect(host.recorded.routes.length).toBeGreaterThan(0)
    expect(host.recorded.tools.length).toBe(6)
    host.teardown()
  })

  it('operator keeps an existing host store reachable when the deployment seeded the plugin disabled', () => {
    // Given an entry seeded disabled by an inherited bundle layer, a profile that never set the switch, and hosts on disk
    useDshHome([{ alias: 'web-01', host: '192.168.1.10', port: 22, user: 'root', auth: { kind: 'password', password: 'pw' } }])
    const host = fakeHost({})

    // When the plugin applies with the seeded config
    apply(host.ctx, Config({ enabled: false }))

    // Then the surfaces stay up so the existing hosts keep working (issue #1250)
    expect(host.recorded.routes.length).toBeGreaterThan(0)
    host.teardown()
  })

  it('operator wins over the legacy seed when the profile itself disabled the plugin', () => {
    // Given hosts on disk and a profile row that explicitly sets enabled false
    useDshHome([{ alias: 'web-01', host: '192.168.1.10', port: 22, user: 'root', auth: { kind: 'password', password: 'pw' } }])
    const host = fakeHost({ enabled: false })

    // When the plugin applies
    apply(host.ctx, Config({ enabled: false }))

    // Then the explicit switch stands and no surface is registered
    expect(host.recorded).toEqual({ routes: [], tools: [], sections: [], upgrades: 0 })
    host.teardown()
  })

  it('operator gets the announcement section only when the config asks for it', () => {
    // Given a profile entry that opts into the agent announcement
    useDshHome()
    const host = fakeHost({ announceToAgent: true })

    // When the plugin applies
    apply(host.ctx, Config({ announceToAgent: true }))

    // Then the prompt section carries the plugin guidance under the stable name
    expect(host.recorded.sections).toEqual(['plugin:dsh-ssh'])
    host.teardown()
  })})
