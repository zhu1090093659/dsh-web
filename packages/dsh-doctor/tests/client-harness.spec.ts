/**
 * Send-to-Harness tests: prompt composition, the sessions-backed port, the
 * controller send flow and the failed-plugin scan (grace window, dedupe,
 * late-materialization forgiveness).
 */
import { describe, expect, it, vi } from 'vitest'
import { DoctorController } from '../src/client/doctor-controller.ts'
import { DoctorApi } from '../src/client/doctor-api.ts'
import { PassiveProbe } from '../src/client/doctor-passive.ts'
import { composeHarnessPrompt, createHarnessPort } from '../src/client/harness-send.ts'
import type { PluginModulesSeam } from '../src/client/plugin-failures.ts'

const LINES = {
  title: 'TITLE',
  summary: 'SUMMARY',
  kind: 'KIND',
  stack: 'STACK',
  environment: 'ENV',
}

describe('composeHarnessPrompt', () => {
  it('folds summary, kind, stack and environment into one prompt', () => {
    const prompt = composeHarnessPrompt(
      { summary: 'boom', kind: 'window-error', stack: 'at fn (a.ts:1)', at: 1700000000000 },
      { webVersion: '9.9.9', supervisorVersion: '0.2.8' },
      LINES,
    )
    expect(prompt).toContain('TITLE')
    expect(prompt).toContain('## SUMMARY')
    expect(prompt).toContain('boom')
    expect(prompt).toContain('KIND: window-error')
    expect(prompt).toContain('## STACK')
    expect(prompt).toContain('at fn (a.ts:1)')
    expect(prompt).toContain('## ENV')
    expect(prompt).toContain('Doctor Web 9.9.9')
    expect(prompt).toContain('Supervisor 0.2.8')
  })

  it('omits empty stack and environment facts', () => {
    const prompt = composeHarnessPrompt({ summary: 'boom' }, {}, LINES)
    expect(prompt).not.toContain('## STACK')
    expect(prompt).not.toContain('## ENV')
    expect(prompt).not.toContain('undefined')
  })
})

describe('createHarnessPort', () => {
  it('is undefined without a sessions service', () => {
    expect(createHarnessPort(undefined)).toBeUndefined()
    expect(createHarnessPort(null)).toBeUndefined()
  })

  it('resolves the current session and queues the prompt', async () => {
    const prompt = vi.fn(async () => ({ ok: true as const }))
    const sessions = {
      list: {
        getSnapshot: () => ({ byId: { s1: { id: 's1', displayTitle: 'My Session', retainedBy: { mainView: 1 } } } }),
      },
      binding: vi.fn(() => ({ session: { prompt } })),
    }
    const port = createHarnessPort(sessions)
    expect(port?.current()).toEqual({ id: 's1', label: 'My Session' })
    const result = await port!.send({ id: 's1', label: 'My Session' }, 'hello harness')
    expect(result).toEqual({ ok: true })
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello harness' }], 'queue')
  })

  it('reports a refused send and a missing binding', async () => {
    const sessions = {
      list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) },
      binding: vi.fn(() => undefined),
    }
    const port = createHarnessPort(sessions)!
    const refused = await port.send({ id: 'none', label: 'x' }, 'text')
    expect(refused).toMatchObject({ ok: false })
    const failed = createHarnessPort({
      list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) },
      binding: vi.fn(() => ({ session: { prompt: vi.fn(async () => ({ ok: false, error: { code: 'REFUSED', message: 'nope' } })) } })),
    })!
    const outcome = await failed.send({ id: 's1', label: 'x' }, 'text')
    expect(outcome).toMatchObject({ ok: false, message: 'REFUSED: nope' })
  })
})

function stubControllerApi(): DoctorApi {
  return { status: vi.fn(async () => ({ ok: false, kind: 'not-available' as const })) } as unknown as DoctorApi
}

describe('DoctorController.sendToHarness', () => {
  it('queues the prompt and records a sent outcome', async () => {
    const controller = new DoctorController({
      api: stubControllerApi(),
      passive: new PassiveProbe({ notify: () => {} }),
      harness: {
        current: () => ({ id: 's1', label: 'My Session' }),
        send: vi.fn(async () => ({ ok: true as const })),
      },
    })
    const result = await controller.sendToHarness('  diagnose this  ')
    expect(result).toEqual({ ok: true })
    const view = controller.getSnapshot()
    expect(view.action).toEqual({ ok: true, kind: 'sent' })
  })

  it('reports send failures and missing targets without throwing', async () => {
    const rejected = new DoctorController({
      api: stubControllerApi(),
      passive: new PassiveProbe({ notify: () => {} }),
      harness: {
        current: () => ({ id: 's1', label: 'x' }),
        send: vi.fn(async () => ({ ok: false as const, message: 'REFUSED: nope' })),
      },
    })
    const failed = await rejected.sendToHarness('diagnose this')
    expect(failed).toMatchObject({ ok: false, message: 'REFUSED: nope' })

    const noTarget = new DoctorController({
      api: stubControllerApi(),
      passive: new PassiveProbe({ notify: () => {} }),
      harness: { current: () => undefined, send: vi.fn() },
    })
    const missing = await noTarget.sendToHarness('diagnose this')
    expect(missing).toMatchObject({ ok: false })

    const noPort = new DoctorController({ api: stubControllerApi(), passive: new PassiveProbe({ notify: () => {} }) })
    expect(await noPort.sendToHarness('diagnose this')).toMatchObject({ ok: false })

    const empty = new DoctorController({ api: stubControllerApi(), passive: new PassiveProbe({ notify: () => {} }) })
    expect(await empty.sendToHarness('   ')).toMatchObject({ ok: false })
  })
})

describe('DoctorController.notePluginStartupFailure', () => {
  it('records a loader-signaled failure once and dedupes repeats', () => {
    const controller = new DoctorController({ api: stubControllerApi(), passive: new PassiveProbe({ notify: () => {} }) })
    controller.notePluginStartupFailure('qa-broken')
    controller.notePluginStartupFailure('qa-broken')
    const probe = controller.getSnapshot().probe
    expect(probe).toHaveLength(1)
    expect(probe[0].kind).toBe('plugin-startup-failure')
    expect(probe[0].message).toBe('plugin failed to start: qa-broken')
    controller.notePluginStartupFailure('')
    expect(controller.getSnapshot().probe).toHaveLength(1)
  })
})

describe('DoctorController.scanPluginFailures', () => {
  it('records a plugin only after it stayed missing through the grace window', async () => {
    let nowMs = 1000
    const modules: PluginModulesSeam = {
      manifest: { plugins: [{ id: 'a' }, { id: 'b' }] },
      loadCache: { has: id => id === 'a' },
    }
    const controller = new DoctorController({
      api: stubControllerApi(),
      passive: new PassiveProbe({ notify: () => {}, now: () => nowMs }),
      now: () => nowMs,
      modules,
      failureGraceMs: 5000,
    })
    await controller.refresh()
    expect(controller.getSnapshot().probe).toHaveLength(0)
    nowMs = 7000
    await controller.refresh()
    const probe = controller.getSnapshot().probe
    expect(probe).toHaveLength(1)
    expect(probe[0].kind).toBe('plugin-startup-failure')
    expect(probe[0].message).toContain('b')
    nowMs = 9000
    await controller.refresh()
    expect(controller.getSnapshot().probe).toHaveLength(1)
  })

  it('forgives a plugin that materializes before the window closes', async () => {
    let nowMs = 1000
    let present = false
    const modules: PluginModulesSeam = {
      manifest: { plugins: [{ id: 'slow' }] },
      loadCache: { has: () => present },
    }
    const controller = new DoctorController({
      api: stubControllerApi(),
      passive: new PassiveProbe({ notify: () => {}, now: () => nowMs }),
      now: () => nowMs,
      modules,
      failureGraceMs: 50000,
    })
    await controller.refresh()
    present = true
    nowMs = 60000
    await controller.refresh()
    expect(controller.getSnapshot().probe).toHaveLength(0)
  })
})
