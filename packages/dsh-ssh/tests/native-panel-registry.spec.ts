// @vitest-environment jsdom
/**
 * The SSH panel's registrations validated against the REAL slot core.
 *
 * Every other spec in this package drives a fake seats service or the panel
 * component directly, so it checks the wiring but not the registry's own
 * rules. This spec runs `registerSshPanel` against the genuine `SlotCore` the
 * running shell installs, so an option shape the registry rejects fails here
 * instead of in the GUI, and it pins the semantic anchor the page carries
 * (the L2 contract skins target in place of the old takeover container).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Source-level assertions read files inside this package. Resolve them from the
// test file's own directory so a run started from the repository root, where
// process.cwd() is the monorepo root, still finds them.
function packageRoot(): string {
  const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname
  if (!dirname) throw new Error('import.meta.dirname is unavailable; run the suite through vitest')
  return join(dirname, '..')
}
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SshApi } from '../src/client/api.ts'
import { registerSshPanel } from '../src/client/native-panel.tsx'
import { PanelController } from '../src/client/panel/controller.ts'

/** The API face the page receives; the registration never calls it. */
const api = {} as SshApi

/**
 * A client context whose slots service is the real SlotCore. `inject` answers
 * immediately (the real one defers until ui-layout / ui-sidebar declare the
 * seats), which is the point: the core itself validates the option shapes.
 */
function realCoreContext() {
  const core = new SlotCore()
  const slots = {
    register: (options: never, component: never) => core.register(options, component as never),
    inject: (_key: string, callback: () => () => void) => callback(),
  }
  const ctx = {
    effect(callback: () => void | (() => void)) { callback() },
    get: () => undefined,
    on: () => () => {},
    slots,
  }
  return { ctx: ctx as never, core, declare: () => {
    core.register({
      name: 'root',
      children: {
        main: { kind: 'keyed', scope: 'root' },
        sidebar: { kind: 'single', scope: 'root' },
      },
    } as never, (() => null) as never)
    core.register({
      name: 'sidebar',
      children: {
        'sidebar.panellist': { kind: 'list', scope: 'root' },
      },
    } as never, (() => null) as never)
  } }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })

describe('ssh registrations against the real slot core', () => {
  it('operator sees the SSH panel occupy the keyed main seat and a list row seat', () => {
    // Given the genuine slot registry the shell installs
    const { ctx, core, declare } = realCoreContext()
    declare()

    // When the panel registers its seats
    const dispose = registerSshPanel(ctx, new PanelController(), api)

    // Then the registry holds one keyed main entry and one list row entry
    const main = core.entries('main')
    const rows = core.entries('sidebar.panellist')
    expect(main).toHaveLength(1)
    expect(main[0]!.options.key).toBe('ssh')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.options.id).toBe('ssh')
    expect(rows[0]!.options.order).toBe(40)

    dispose()
    // And disposal clears both, so a rebuilt bundle re-registers cleanly
    expect(core.entries('main')).toHaveLength(0)
    expect(core.entries('sidebar.panellist')).toHaveLength(0)
  })

  it('operator switching language sees the row label resolve through the registry', () => {
    // Given a registered panel whose row carries a function label
    const { ctx, core, declare } = realCoreContext()
    declare()
    const dispose = registerSshPanel(ctx, new PanelController(), api)

    // When the shell resolves the row label
    const label = core.entries('sidebar.panellist')[0]!.options.label

    // Then it is a function, so the shell re-resolves it on every locale
    // change instead of freezing the mount-time copy
    expect(typeof label).toBe('function')
    const text = (label as () => string)()
    expect(text).not.toBe('entry.label')
    expect(text.length).toBeGreaterThan(0)

    dispose()
  })

  it('operator sees the page keep the semantic anchor and plugin marker', () => {
    // Given the registration source and the page stylesheet
    const source = readFileSync(join(packageRoot(), 'src', 'client', 'native-panel.tsx'), 'utf8')
    const css = readFileSync(join(packageRoot(), 'src', 'client', 'panel', 'panel.module.css'), 'utf8')

    // When the page renders in the layout's main seat
    // Then the takeover container's semantic anchors are preserved, so skin
    // and semantic-attribute rules anchored on [data-dsh-ssh-view] still match
    expect(source).toContain('data-dsh-ssh-view=""')
    expect(source).toContain('data-dsh-plugin="ssh"')
    // And the takeover's occupancy rules are gone: the shell decides what
    // renders, so nothing here keys off an activation attribute or reaches
    // into the conversation column
    expect(css).not.toContain('data-dsh-ssh-active')
    expect(css).not.toContain("data-pane='conversation'")
    expect(css).not.toContain('centerCol')
  })
})
