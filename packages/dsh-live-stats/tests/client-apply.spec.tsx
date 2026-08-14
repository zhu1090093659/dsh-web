import { describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the apply chain needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => ({
    get: () => init,
    set: () => {},
    subscribe: () => () => {},
  }),
}))
import { apply } from '../src/client/index.ts'

describe('live-stats client apply', () => {
  it('registers the plugin settings card and the TPS line into the composer dock', async () => {
    const injected: string[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        inject: (key: string) => { injected.push(key); return () => {} },
        register: () => () => {},
      },
      settingsScope: {
        bind: () => ({
          getSnapshot: () => ({ status: 'unavailable' as const, writable: false }),
          subscribe: () => () => {},
          set: async () => {},
          unset: async () => {},
        }),
      },
    }
    apply(ctx as never)
    // The card mounts into the Web UI plugin group; the TPS line mounts into
    // the composer dock (the shipped stats-line seat, whose standard kit
    // supplies useProjection) so the live throughput row actually renders.
    expect(injected).toEqual(['web-ui.plugin.item', 'conversation.composer.dock'])
  })
})
