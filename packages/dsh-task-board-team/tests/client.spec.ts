/**
 * The browser half: dictionaries, the published-summary store and the seat
 * registration lifecycle.
 *
 * The seats are driven through a fake slot registry and a fake board client face
 * because that is exactly the boundary the provider is written against; nothing
 * here reaches the network, and no module is patched.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskBoardClientFace, TaskBoardClientMirror, TaskBoardExtensionActionRequest } from '../src/core/contract.ts'
import { zh, en, setRuntimeTranslate } from '../src/client/locales.ts'
import {
  acceptPublishedSummaries,
  cardViewOf,
  clearSummary,
  getSummary,
  readSummary,
} from '../src/client/team/summary.ts'
import { issueLabel, statusLabel } from '../src/client/team/sections.tsx'
import { readConfiguration } from '../src/client/team/settings.tsx'
import { installTeamClientHalf } from '../src/client/team/extension.ts'
import { apply } from '../src/client/index.ts'
import type { TaskRecord } from '../src/core/task-record.ts'

/** The one card these specs render. */
const CARD: TaskRecord = {
  id: 'card-1',
  title: 'Mirror',
  description: '',
  prompt: '',
  status: 'running',
  createdAt: 1,
  updatedAt: 1,
  executions: [],
  integrations: {
    'task-board-team': {
      issueId: 'issue_1',
      issueNumber: 12,
      attemptId: 'attempt_1',
      leaseToken: 'lease_1',
      agentMemberId: 'mem_builder',
      hubStatus: 'in_review',
      assignee: 'alice',
      reviewer: 'bob',
    },
  },
}

/** One published summary the fake board serves. */
function publishedPayload(): Record<string, unknown> {
  return {
    connection: { state: 'online', hostId: 'host_1', reconnects: 0 },
    capabilities: { followUp: true, rework: false, run: true },
    agents: [{ memberId: 'mem_builder', name: 'builder', preset: 'liangshen' }],
    problems: ['one binding is stale'],
    cards: {
      'card-1': {
        issueId: 'issue_1',
        issueNumber: 12,
        hubStatus: 'in_review',
        comments: [{ id: 'c1', author: 'alice', content: 'looks good', createdAt: 5 }],
        activity: [{ id: 'a1', type: 'issue.status_changed', text: 'in_review', createdAt: 6 }],
      },
    },
    pendingQuestions: [{ id: 'q1', taskId: 'card-1', issueId: 'issue_1', question: 'Ship it?', askedAt: 7 }],
    configuration: { hubUrl: 'https://hub.example.com', teamId: 'team_1', hostname: 'laptop', tokenConfigured: true },
  }
}

afterEach(() => {
  clearSummary()
})

describe('dictionaries', () => {
  it('member sees every key translated in both shipped languages', () => {
    // Given the two dictionaries this package ships
    // When their key sets are compared
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()

    // Then they are identical, so no locale renders a missing key
    expect(enKeys).toEqual(zhKeys)
    expect(zhKeys.length).toBeGreaterThan(20)
  })

  it('member sees the English copy free of Chinese glyphs', () => {
    // Given the English dictionary
    // When each value is inspected
    const leaked = Object.entries(en).filter(([, value]) => /[\u4e00-\u9fff]/.test(value))

    // Then nothing is left behind in the other language
    expect(leaked).toEqual([])
  })

  it('member sees the runtime locale drive the seat copy', () => {
    // Given a bound translate seat for the English dictionary
    setRuntimeTranslate(key => en[key])

    // When a seat translates one status
    // Then the English wording is used
    expect(statusLabel('in_review')).toBe('In review')
    setRuntimeTranslate(key => zh[key])
  })
})

describe('published summary', () => {
  it('member sees the card view built from the published summary', () => {
    // Given a summary a Host published
    // When the browser half takes it
    acceptPublishedSummaries({ 'task-board-team': publishedPayload() })

    // Then the card view carries the comments, activity and hub status
    expect(cardViewOf('card-1')?.comments).toHaveLength(1)
    expect(cardViewOf('card-1')?.hubStatus).toBe('in_review')
    expect(getSummary()?.pendingQuestions[0]?.question).toBe('Ship it?')
  })

  it('member sees a summary from another revision read for the fields it has', () => {
    // Given a payload missing most optional fields
    // When it is read
    const summary = readSummary({ connection: { state: 'reconnecting', reconnects: 3 } })

    // Then the known fields survive and the unknown ones default safely
    expect(summary?.connection.state).toBe('reconnecting')
    expect(summary?.capabilities.followUp).toBe(false)
    expect(summary?.cards).toEqual({})
  })

  it('member sees a non-summary payload ignored', () => {
    // Given a payload that is not a summary at all
    // When it is read and then cleared
    acceptPublishedSummaries({ 'task-board-team': 'not a summary' })

    // Then the store stays empty instead of rendering nonsense
    expect(getSummary()).toBeUndefined()
  })

  it('member sees the configuration block read the non-secret settings', () => {
    // Given a summary carrying the configuration half
    // When the block reads it
    const configuration = readConfiguration(readSummary(publishedPayload()))

    // Then the values the form pre-fills come from there
    expect(configuration).toEqual({
      hubUrl: 'https://hub.example.com',
      teamId: 'team_1',
      hostname: 'laptop',
      tokenConfigured: true,
    })
  })

  it('member sees the issue label rendered without a number when the hub gave none', () => {
    // Given a linkage with only an id, and one with a number
    // When both are labelled
    // Then the number is used when present
    expect(issueLabel({ issueId: 'issue_1' })).toBe('issue_1')
    expect(issueLabel({ issueId: 'issue_1', issueNumber: 12 })).toBe('issue #12')
  })
})

describe('seat registration', () => {
  /** A minimal slot registry and cordis-like client context. */
  function makeClient(mirror: { enabled: boolean; extensions: Record<string, unknown> }): {
    ctx: unknown
    registered: string[]
    flip(next: { enabled: boolean; extensions: Record<string, unknown> }): void
  } {
    const registered: string[] = []
    const listeners = new Set<(value: TaskBoardClientMirror) => void>()
    let current: TaskBoardClientMirror = { enabled: mirror.enabled, tasks: [CARD], extensions: mirror.extensions }
    const face: TaskBoardClientFace = {
      dispatch: async (_request: TaskBoardExtensionActionRequest) => true,
      registerVisibility: () => () => {},
      subscribe: (callback) => {
        listeners.add(callback)
        return () => { listeners.delete(callback) }
      },
      snapshot: () => current,
    }
    const slots = {
      register(options: { name: string }) {
        registered.push(options.name)
        return () => {
          const index = registered.indexOf(options.name)
          if (index >= 0) registered.splice(index, 1)
        }
      },
      inject(_key: string, callback: () => () => void) {
        return callback()
      },
    }
    const resolve = (name: string): unknown => {
      if (name === 'taskBoard') return face
      if (name === 'slots') return slots
      return undefined
    }
    const scope = {
      slots,
      get: resolve,
      effect(fn: () => (() => void) | void) {
        return fn() ?? (() => {})
      },
    }
    const ctx = {
      slots,
      get: resolve,
      inject: (_deps: string[], callback: (value: typeof scope) => void) => {
        callback(scope)
        return { dispose: async () => {} }
      },
    }
    return {
      ctx,
      registered,
      flip(next) {
        current = { enabled: next.enabled, tasks: [CARD], extensions: next.extensions }
        for (const listener of [...listeners]) listener(current)
      },
    }
  }

  it('member sees both rendering seats registered while the board and extension are on', () => {
    // Given a page whose board is running and switched on
    const client = makeClient({ enabled: true, extensions: { 'task-board-team': publishedPayload() } })
    let enabled = true

    // When the browser half installs
    installTeamClientHalf(client.ctx as never, {
      read: () => enabled,
      subscribe: () => () => {},
    })

    // Then the detail and decoration seats are there, plus the settings block
    expect(client.registered).toContain('task-board.detail.section')
    expect(client.registered).toContain('task-board.card.decoration')
    expect(client.registered).toContain('task-board.settings.section')
  })

  it('member sees the rendering seats released while the extension is switched off', () => {
    // Given an installed browser half whose board is running
    const client = makeClient({ enabled: true, extensions: {} })

    // When the extension's own switch is off as the half installs
    installTeamClientHalf(client.ctx as never, {
      read: () => false,
      subscribe: () => () => {},
    })

    // Then only the configuration block is registered, because it is where the
    // switch is turned back on
    expect(client.registered).toEqual(['task-board.settings.section'])
  })

  it('member sees the seats collapse when the board master switch goes off', () => {
    // Given an installed browser half with both switches on
    const client = makeClient({ enabled: true, extensions: {} })
    installTeamClientHalf(client.ctx as never, {
      read: () => true,
      subscribe: () => () => {},
    })
    expect(client.registered).toHaveLength(3)

    // When the board's own master switch turns off
    client.flip({ enabled: false, extensions: {} })

    // Then the rendering seats are released and the summary is dropped
    expect(client.registered).toEqual(['task-board.settings.section'])
    expect(getSummary()).toBeUndefined()
  })
})

describe('boot tolerance', () => {
  /**
   * A shell context with the inject contract the Web UI enforces: a service read
   * the plugin never declared throws, and `ctx.get` is the only way to probe it.
   * @returns the context and the seat names it registered.
   */
  function makeInjectStrictClient(): { ctx: unknown; registered: string[] } {
    const registered: string[] = []
    const slots = {
      register(options: { name: string }) {
        registered.push(options.name)
        return () => {}
      },
      inject(_key: string, callback: () => () => void) {
        return callback()
      },
    }
    const services: Record<string, unknown> = { slots }
    const ctx = {
      effect(fn: () => (() => void) | void) {
        return fn() ?? (() => {})
      },
      get: (name: string) => services[name],
      inject: (_deps: string[], callback: (scope: unknown) => void) => {
        callback(ctx)
        return { dispose: async () => {} }
      },
    }
    const guarded = new Proxy(ctx, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop.startsWith('_') || prop in target) {
          return Reflect.get(target, prop, receiver)
        }
        throw new Error(`cannot get property "${prop}" without inject`)
      },
    })
    return { ctx: guarded, registered }
  }

  it('member sees the browser half mount without throwing on a shell that gates undeclared services', () => {
    // Given a page whose shell throws on every undeclared service read
    const client = makeInjectStrictClient()

    // When the entry applies and the board never publishes its service
    // Then applying does not throw, so the web shell can finish its boot
    expect(() => apply(client.ctx as never)).not.toThrow()
    // And the one seat that needs no board service is registered through the
    // probed registry instead of a property read the shell would reject
    expect(client.registered).toEqual(['task-board.settings.section'])
  })
})