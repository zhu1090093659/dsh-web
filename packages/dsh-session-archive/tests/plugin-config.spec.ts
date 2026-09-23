// @vitest-environment node
/**
 * Host-half activation contract under the 0.1.7 settings model: the plugin's own
 * Config schema is what the Host serves as this profile entry's settings page,
 * the effective settings are the values handed to `apply`, and a settings write
 * reaches a running row as a `loader/volatile-update` on its own fiber — which
 * must re-arm the runtime from the committed values without a remount.
 * @module tests/plugin-config.spec
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { Config, apply } from '../src/index.ts'
import { readArchiveConfig, type SessionArchiveConfigFields } from '../src/core/config.ts'

/** The auto-maintenance defaults the shipped settings page documents. */
const DOCUMENTED_DEFAULTS = {
  enabled: true,
  autoArchiveEnabled: false,
  autoArchiveDays: 7,
  autoDeleteEnabled: false,
  autoDeleteDays: 7,
  checkIntervalMin: 60,
}

/** The route paths one enabled plugin instance serves. */
const ROUTE_PATHS = [
  '/api/dsh-session-archive/inventory',
  '/api/dsh-session-archive/preview',
  '/api/dsh-session-archive/archive',
  '/api/dsh-session-archive/unarchive',
  '/api/dsh-session-archive/delete',
  '/api/dsh-session-archive/auto/preview',
  '/api/dsh-session-archive/auto/run',
]

/** One volatile field as the 0.1.7 loader commits it into a running fiber. */
function volatileField<T>(value: T): { get(): T; set(next: T): void } {
  let current = value
  return {
    get: () => current,
    set: (next) => { current = next },
  }
}

interface HostMount {
  /** Routes the host webserver currently holds for this plugin. */
  routes: WebRoute[]
  /** Commit a volatile config change into the running activation, as the loader does. */
  commitVolatile(paths?: readonly (readonly string[])[]): void
  /** Dispose the activation, releasing its routes, timer and services. */
  dispose(): void
}

/** Mount the host half against a capture-only ctx (no real webserver, no real DSH home). */
function mountHost(config: SessionArchiveConfigFields): HostMount {
  const routes: WebRoute[] = []
  const disposers: Array<() => void> = []
  let volatileListener: ((paths: readonly (readonly string[])[]) => void) | undefined
  const ctx = {
    effect: (run: () => unknown) => {
      const dispose = run()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
      return () => {}
    },
    on: (name: string, listener: never) => {
      if (name === 'loader/volatile-update') volatileListener = listener
      return () => {}
    },
    get: () => undefined,
    webServer: {
      register: (route: WebRoute) => {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
  }
  apply(ctx as never, config)
  return {
    routes,
    commitVolatile: (paths = [['enabled']]) => { volatileListener?.(paths) },
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

function routePaths(mount: HostMount): string[] {
  return mount.routes.map((route) => route.path)
}

/**
 * The serialized Config schema the Host's settings surface reads: one form per
 * profile entry, generated from the fields the schema declares volatile.
 */
function formFields(): Record<string, { meta?: { volatile?: boolean } } | undefined> {
  const json = Config.toJSON() as unknown as {
    uid: number
    refs?: Record<string, { meta?: { volatile?: boolean }; dict?: Record<string, number> }>
  }
  const root = json.refs?.[String(json.uid)]
  const fields: Record<string, { meta?: { volatile?: boolean } } | undefined> = {}
  for (const [field, id] of Object.entries(root?.dict ?? {})) fields[field] = json.refs?.[String(id)]
  return fields
}

let previousHome: string | undefined

beforeEach(() => {
  // The plugin resolves $DSH_HOME when it builds its service; keep every test
  // off the user's real DSH home.
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-session-archive-plugin-'))
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

describe('host activation settings', () => {
  it('admin sees every documented setting served by the plugin schema with its default', () => {
    // Given the plugin Config schema the Host serves as this entry's settings page
    const dict = formFields()

    // When the schema fields and the values the Host hands the activation are read
    const fields = Object.keys(dict)
    const effective = readArchiveConfig(Config({}) as SessionArchiveConfigFields)

    // Then every documented field is live-editable and defaults to the documented value
    expect(fields).toEqual(Object.keys(DOCUMENTED_DEFAULTS))
    for (const field of fields) expect(dict[field]?.meta?.volatile).toBe(true)
    expect(effective).toEqual(DOCUMENTED_DEFAULTS)
  })

  it('operator switching the plugin off unmounts the archive routes without a remount', () => {
    // Given a running activation with its management routes registered
    const enabled = volatileField(true)
    const mount = mountHost({ enabled })
    expect(routePaths(mount)).toEqual(ROUTE_PATHS)

    // When the Host commits the user's write to `enabled: false` and the loader announces it
    enabled.set(false)
    mount.commitVolatile([['enabled']])

    // Then the whole management surface is gone
    expect(routePaths(mount)).toEqual([])

    // And switching it back on restores the surface from the same row
    enabled.set(true)
    mount.commitVolatile([['enabled']])
    expect(routePaths(mount)).toEqual(ROUTE_PATHS)

    mount.dispose()
  })

  it('operator sees the plugin serve nothing when it is activated already switched off', () => {
    // Given a row whose committed settings have the plugin disabled
    const mount = mountHost({ enabled: volatileField(false) })

    // When the activation is inspected
    // Then no route, and therefore no session mutation surface, was mounted
    expect(routePaths(mount)).toEqual([])

    mount.dispose()
  })
})
