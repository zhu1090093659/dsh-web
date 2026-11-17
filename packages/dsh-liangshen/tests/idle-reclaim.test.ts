/**
 * Deferred idle reclaim (issue #2066): the fold expires a namespace idle for N
 * steps but applies the expiry only at an activation touch or a compaction/end
 * boundary — moments the request's prompt prefix changes anyway. These tests
 * pin the cache contract (the applied active set moves only at activation and
 * compaction events, never at an ordinary use or a step boundary), the
 * mark/use semantics, the activation projection's report, and the wiring that
 * keeps catalog, activation tool and working context on one fact.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PAGED_TOOL_PATTERNS,
  projectActivation,
  replayActivations,
} from '../presets/liangshen/paging.mjs'
import { renderWorkingContext } from '../presets/liangshen/working-context.mjs'
import { apply as applyCatalog } from '../presets/liangshen/tool-catalog.mjs'
import { apply as applyActivate } from '../presets/liangshen/tool-activate.mjs'
import { applyPresetOverrides } from '../src/composition.ts'

const PATTERNS = DEFAULT_PAGED_TOOL_PATTERNS

/** One step boundary, the durable counter the expiry predicate reads. */
function step() {
  return { type: 'step/start', data: { turn: 1, step: 1 } }
}
function steps(n: number) {
  return Array.from({ length: n }, () => step())
}
/** A successful top-level activation. */
function activate(namespace: string, callId = `act-${namespace}`) {
  return { type: 'tool/call', data: { callId, name: 'tool_activate', arguments: JSON.stringify({ namespace }) } }
}
/** A successful top-level call into a paged family. */
function use(toolName: string, callId = `use-${toolName}`) {
  return { type: 'tool/call', data: { callId, name: toolName, arguments: '{}' } }
}
/** The ptc shape of an activation, the only shape a real activation takes under the shipped presentation. */
function activateDispatch(namespace: string) {
  return { type: 'tool/ptc-dispatch', data: { name: 'tool_activate', arguments: { namespace }, isError: false } }
}
function useDispatch(toolName: string, isError = false) {
  return { type: 'tool/ptc-dispatch', data: { name: toolName, arguments: {}, isError } }
}
function compactionEnd() {
  return { type: 'compaction/end', data: {} }
}
function failed(callId: string) {
  return { type: 'tool/result', data: { callId, error: 'boom' } }
}
const activeOf = (events: any[], idle = 0) => replayActivations(events, 3, PATTERNS, undefined, idle).active

describe('deferred idle reclaim fold', () => {
  it('operator gets the historical LRU replay with threshold 0', () => {
    // Given a log with activations, a recency refresh and a capacity eviction
    const log = [
      activate('task_board'), activate('browser'), activate('squad'),
      ...steps(5),
      useDispatch('task_board_list'),
      activate('team'),
    ]
    // When replayed with the explicit default and with the historical signature
    // Then both agree: task_board refreshed, browser evicted as the LRU
    expect(activeOf(log, 0)).toEqual(['squad', 'task_board', 'team'])
    expect(replayActivations(log, 3, PATTERNS)).toEqual(replayActivations(log, 3, PATTERNS, undefined, 0))
  })

  it('operator keeps an expired namespace resident until an application point', () => {
    // Given an activation followed by far more idle steps than the threshold
    const log = [activate('task_board'), ...steps(10)]
    // When replayed with reclaim enabled but no application point in the log
    // Then the namespace stays resident: expiry is a predicate, not an event
    expect(activeOf(log, 3)).toEqual(['task_board'])
  })

  it('operator sees a successful use cancel the expiry', () => {
    // Given an activation idle past the threshold but used again recently
    const log = [activate('task_board'), ...steps(2), use('task_board_list'), ...steps(2), activate('browser')]
    // When the next activation applies pending expiries
    // Then task_board survives: only 2 steps passed since its latest use
    expect(activeOf(log, 3)).toEqual(['task_board', 'browser'])
  })

  it('operator sees the next activation apply the pending expiry', () => {
    // Given an activation idle exactly to the threshold
    const log = [activate('task_board'), ...steps(3), activate('browser')]
    // When another namespace is activated
    // Then the expired one is reclaimed in the same transition
    expect(activeOf(log, 3)).toEqual(['browser'])
  })

  it('operator sees compaction/end apply the pending expiry', () => {
    // Given an activation idle to the threshold and a compaction boundary
    const log = [activate('task_board'), ...steps(3), compactionEnd()]
    // When the fold crosses the boundary
    // Then the expired namespace is reclaimed where history is rewritten anyway
    expect(activeOf(log, 3)).toEqual([])
  })

  it('operator gets no recency refresh from failed calls', () => {
    // Given a failed activation and a failed use of an idle active family
    const log = [
      activate('task_board', 'a1'), failed('a1'),
      activate('browser', 'a2'),
      ...steps(3),
      use('browser_navigate', 'u1'), failed('u1'),
      activate('squad', 'a3'),
    ]
    // When the fold replays the log
    // Then the failed activation never took effect and the failed use did not refresh
    expect(activeOf(log, 3)).toEqual(['squad'])
  })

  it('operator gets one expiry state from both event shapes', () => {
    // Given activations and uses recorded only as tool/ptc-dispatch
    const kept = [activateDispatch('task_board'), ...steps(2), useDispatch('task_board_list'), ...steps(2), activateDispatch('browser')]
    const reclaimed = [activateDispatch('task_board'), ...steps(3), activateDispatch('browser')]
    // When replayed with reclaim enabled
    // Then the dispatch shape refreshes and expires exactly like the top-level shape
    expect(activeOf(kept, 3)).toEqual(['task_board', 'browser'])
    expect(activeOf(reclaimed, 3)).toEqual(['browser'])
  })

  it('operator gets no reclaim from a log without step evidence', () => {
    // Given a log with activations and a compaction but no step/start events
    const log = [activate('task_board'), compactionEnd(), activate('browser')]
    // When replayed with reclaim enabled
    // Then nothing expires: no step evidence, no expiry
    expect(activeOf(log, 3)).toEqual(['task_board', 'browser'])
  })

  it('operator sees reclaim free capacity before LRU eviction', () => {
    // Given three activations all idle to the threshold
    const log = [activate('task_board'), activate('browser'), activate('squad'), ...steps(3), activate('team')]
    // When a fourth namespace is activated
    // Then reclaim empties the page first and no LRU eviction is needed
    const result = replayActivations(log, 3, PATTERNS, undefined, 3)
    expect(result.active).toEqual(['team'])
    expect(result.evicted).toEqual([])
  })

  it('operator keeps a re-activated expired namespace resident', () => {
    // Given an activation idle far past the threshold
    const log = [activate('task_board'), ...steps(5), activate('task_board', 'act-again')]
    // When the same namespace is activated again
    // Then its own recency refresh protects it from the reclaim it triggers
    expect(activeOf(log, 3)).toEqual(['task_board'])
  })

  it('operator gets a deterministic replay across runs', () => {
    // Given a mixed log with a use, a compaction and a later activation
    const log = [activate('task_board'), ...steps(2), useDispatch('task_board_list'), ...steps(4), compactionEnd(), activate('browser')]
    // When replayed twice
    // Then both runs agree, and the compaction reclaimed the idle namespace
    expect(activeOf(log, 3)).toEqual(activeOf(log, 3))
    expect(activeOf(log, 3)).toEqual(['browser'])
  })
})

describe('zero extra prefix rebuilds', () => {
  /**
   * Positions where the applied active SET (membership, not LRU order) changes.
   * The failed-call index is folded from the WHOLE log: a production sync runs
   * after the call's result lands, so a prefix never sees an activation whose
   * failure the session already recorded.
   */
  function changePositions(log: any[], idle: number): number[] {
    const errored = new Set<string>()
    for (const event of log) {
      if (event?.type === 'tool/result' && event.data?.error !== undefined) errored.add(String(event.data?.callId))
    }
    const positions: number[] = []
    let previous = ''
    for (let i = 1; i <= log.length; i += 1) {
      const key = [...replayActivations(log.slice(0, i), 3, PATTERNS, errored, idle).active].sort().join(',')
      if (key !== previous) positions.push(i - 1)
      previous = key
    }
    return positions
  }

  /** The only events allowed to move the applied set: successful activations and compaction boundaries. */
  function allowedPositions(log: any[]): Set<number> {
    const errored = new Set<string>()
    for (const event of log) {
      if (event?.type === 'tool/result' && event.data?.error !== undefined) errored.add(String(event.data?.callId))
    }
    const allowed = new Set<number>()
    log.forEach((event, index) => {
      if (event?.type === 'compaction/end') allowed.add(index)
      if (event?.type === 'tool/ptc-dispatch' && event.data?.name === 'tool_activate' && event.data?.isError !== true) allowed.add(index)
      if (event?.type === 'tool/call' && event.data?.name === 'tool_activate' && !errored.has(String(event.data?.callId))) allowed.add(index)
    })
    return allowed
  }

  /** A deterministic pseudo-random log: no wall clock, no Math.random. */
  function generatedLog(seed: number, length: number): any[] {
    let state = seed
    const rand = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
    const families = ['task_board', 'browser', 'squad', 'team']
    const tools: Record<string, string> = { task_board: 'task_board_list', browser: 'browser_navigate', squad: 'squads_create', team: 'team_comment' }
    const log: any[] = []
    for (let i = 0; i < length; i += 1) {
      const r = rand()
      const ns = families[Math.floor(rand() * families.length)]
      if (r < 0.35) log.push(step())
      else if (r < 0.55) log.push(activate(ns, `act-${i}`))
      else if (r < 0.7) log.push(useDispatch(tools[ns]))
      else if (r < 0.8) log.push(use(tools[ns], `use-${i}`))
      else if (r < 0.9) log.push(compactionEnd())
      else log.push(step())
    }
    return log
  }

  const SCRIPTED = [
    [activate('task_board'), ...steps(9), activate('task_board', 'again')],
    [activate('task_board'), activate('browser'), ...steps(4), useDispatch('task_board_list'), compactionEnd(), activate('squad')],
    [activate('task_board', 'a1'), failed('a1'), ...steps(4), activate('browser'), compactionEnd()],
    [activateDispatch('task_board'), ...steps(2), useDispatch('task_board_list', true), ...steps(2), activateDispatch('browser'), compactionEnd()],
  ]

  it('operator gets every applied change riding an activation or a compaction boundary', () => {
    // Given scripted and deterministically generated logs
    const logs = [...SCRIPTED, ...[1, 2, 3, 4, 5].map(seed => generatedLog(seed, 80))]
    for (const log of logs) {
      const allowed = allowedPositions(log)
      // When the applied set is folded prefix by prefix under reclaim and under the default
      // Then every membership change sits at an allowed event in BOTH modes:
      // reclaim adds no change position the shipped replay does not already have,
      // except compaction boundaries whose history rewrite already cold-starts the cache
      for (const position of changePositions(log, 3)) {
        expect(allowed.has(position), `reclaim change at ${position}`).toBe(true)
      }
      for (const position of changePositions(log, 0)) {
        expect(allowed.has(position), `baseline change at ${position}`).toBe(true)
      }
    }
  })
})

describe('projectActivation report', () => {
  it('operator gets a report carrying only this activation\'s eviction and reclaim', () => {
    // Given a log whose history already evicted task_board and left three idle families
    const log = [activate('task_board'), activate('browser'), activate('squad'), activate('team'), ...steps(3)]
    // When the next activation is projected
    // Then the report carries this transition alone, not the historical eviction
    const projection = projectActivation(log, 3, PATTERNS, 'ui', 3)
    expect(projection.wasActive).toBe(false)
    expect(projection.active).toEqual(['ui'])
    expect(projection.reclaimed).toEqual(['browser', 'squad', 'team'])
    expect(projection.evicted).toEqual([])
  })

  it('operator gets an already-active refusal for an expired-but-unapplied namespace', () => {
    // Given an activation idle far past the threshold with no application point
    const log = [activate('task_board'), ...steps(9)]
    // When the same namespace is projected for activation
    // Then it is still resident, so the tool must refuse it as already active
    expect(projectActivation(log, 3, PATTERNS, 'task_board', 3).wasActive).toBe(true)
  })

  it('operator gets the historical eviction report with the default threshold', () => {
    // Given three active namespaces at capacity
    const log = [activate('task_board'), activate('browser'), activate('squad')]
    // When a fourth activation is projected with reclaim off
    // Then one LRU eviction is reported and nothing is reclaimed
    const projection = projectActivation(log, 3, PATTERNS, 'team', 0)
    expect(projection.evicted).toEqual(['task_board'])
    expect(projection.reclaimed).toEqual([])
    expect(projection.active).toEqual(['browser', 'squad', 'team'])
  })
})

describe('working-context reflects the applied set', () => {
  it('operator sees the working-context line name an expired-but-unapplied namespace until an application point', () => {
    // Given an activation idle past the threshold
    const log = [activate('task_board'), ...steps(9)]
    // When the line renders before and after a compaction boundary
    // Then it names the namespace while resident and drops it once reclaimed
    const options = { pagedToolPatterns: PATTERNS, idleReclaimSteps: 3 }
    expect(renderWorkingContext(log, options) ?? '').toContain('active namespaces: task_board')
    expect(renderWorkingContext([...log, compactionEnd()], options) ?? '').not.toContain('task_board')
  })

  it('operator gets the historical working-context line with default options', () => {
    // Given the same idle log and a compaction, with no reclaim configured
    const log = [activate('task_board'), ...steps(9), compactionEnd()]
    // When the line renders with the shipped options
    // Then the namespace stays named: default behavior is unchanged
    expect(renderWorkingContext(log, { pagedToolPatterns: PATTERNS }) ?? '').toContain('active namespaces: task_board')
  })
})

describe('catalog restriction follows the applied set', () => {
  function catalogHarness(events: any[], idleReclaimSteps: number) {
    const surface = [
      { name: 'read', description: 'Read a file.' },
      { name: 'task_board_list', description: 'List cards.' },
      { name: 'task_board_create', description: 'Create a card.' },
      { name: 'browser_navigate', description: 'Open a page.' },
    ]
    const denied: string[][] = []
    const listeners = new Map<string, Function>()
    const ctx = {
      on: (event: string, fn: Function) => { listeners.set(event, fn) },
      get: () => undefined,
      logger: { warn: () => {} },
    }
    applyCatalog(ctx, { presentation: 'native', pagedToolPatterns: PATTERNS, idleReclaimSteps })
    const agent = {
      session: { events },
      ctx: { tools: { schemas: () => surface, restrict: ({ deny }: { deny: string[] }) => { denied.push([...deny]); return () => {} } } },
    }
    return { denied, assemble: () => (listeners.get('system-prompt/assemble') as Function)({}, { agent }, async () => ({})) }
  }

  it('operator keeps an expired-but-unapplied namespace resident in the catalog restriction', async () => {
    // Given an activation idle past the threshold with no application point
    const harness = catalogHarness([activate('task_board'), ...steps(9)], 3)
    // When the assembly syncs the page
    // Then only the never-activated family is withheld
    await harness.assemble()
    expect(harness.denied.at(-1)).toEqual(['browser_navigate'])
  })

  it('operator sees the catalog withhold the reclaimed namespace after compaction', async () => {
    // Given the same idle log plus a compaction boundary
    const harness = catalogHarness([activate('task_board'), ...steps(9), compactionEnd()], 3)
    // When the assembly syncs the page
    // Then the reclaimed family joins the withheld names
    await harness.assemble()
    expect(harness.denied.at(-1)).toEqual(['browser_navigate', 'task_board_create', 'task_board_list'])
  })
})

describe('activation tool reports reclaim', () => {
  function activateHarness(events: any[], idleReclaimSteps: number) {
    let tool: any
    const ctx = {
      tools: { register: (definition: any) => { tool = definition } },
      get: () => undefined,
      logger: { warn: () => {} },
    }
    applyActivate(ctx, { pagedToolPatterns: PATTERNS, idleReclaimSteps })
    const surface = [
      { name: 'task_board_list' }, { name: 'task_board_create' },
      { name: 'browser_navigate' }, { name: 'ui_present' },
    ]
    const agent = { session: { events }, ctx: { tools: { schemas: () => surface } } }
    return { run: (namespace: string) => tool.execute({ namespace }, { agent, callId: 'self' }) }
  }

  it('operator gets the reclaimed idle namespaces named in the activation result', async () => {
    // Given an activation idle past the threshold
    const harness = activateHarness([activate('task_board'), ...steps(4)], 3)
    // When another namespace is activated
    // Then the result names the reclaim alongside the activation
    const result = await harness.run('browser')
    expect(result.text).toContain('Activated namespace "browser"')
    expect(result.text).toContain('Idle namespace "task_board" was reclaimed')
  })

  it('operator gets an already-active refusal from the tool for an expired-but-unapplied namespace', async () => {
    // Given an activation idle past the threshold with no application point
    const harness = activateHarness([activate('task_board'), ...steps(9)], 3)
    // When the same namespace is activated
    // Then the tool refuses it: it is still resident and callable
    await expect(harness.run('task_board')).rejects.toThrow('already active')
  })

  it('operator gets the historical activation report with the default threshold', async () => {
    // Given three active namespaces at capacity and reclaim off
    const harness = activateHarness([activate('task_board'), activate('browser'), activate('squad')], 0)
    // When a fourth namespace is activated
    // Then the report names the LRU eviction and no reclaim
    const result = await harness.run('ui')
    expect(result.text).toContain('Least recently used namespace "task_board" was paged out')
    expect(result.text).not.toContain('reclaimed')
  })
})

describe('three-row overlay', () => {
  it('operator gets the threshold written to every paging row together', () => {
    // Given the three paging rows and a non-paging row
    const rows = [
      { id: 'tool-catalog', name: './tool-catalog.mjs', config: { pagedToolPatterns: ['task_board_*'], idleReclaimSteps: 0 } },
      { id: 'tool-activate', name: './tool-activate.mjs', config: { pagedToolPatterns: ['task_board_*'], idleReclaimSteps: 0 } },
      { id: 'working-context', name: './working-context.mjs', config: { pagedToolPatterns: ['task_board_*'], idleReclaimSteps: 0 } },
      { id: 'minimal-prompt', name: './minimal-prompt.mjs', config: {} },
    ]
    // When the overlay applies a threshold
    // Then all three replays receive it and the non-paging row is untouched
    const applied = applyPresetOverrides(rows as any, { idleReclaimSteps: 30 })
    for (const id of ['tool-catalog', 'tool-activate', 'working-context']) {
      expect((applied.find((row: any) => row.id === id) as any).config.idleReclaimSteps, id).toBe(30)
    }
    expect((applied.find((row: any) => row.id === 'minimal-prompt') as any).config).toEqual({})
  })

  it('operator gets no key written for an absent threshold', () => {
    // Given a row carrying the shipped threshold
    const rows = [{ id: 'tool-catalog', name: './tool-catalog.mjs', config: { idleReclaimSteps: 0 } }]
    // When the overlay carries no threshold
    // Then the row is returned unchanged
    expect(applyPresetOverrides(rows as any, {})).toEqual(rows)
  })
})