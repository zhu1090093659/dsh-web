/**
 * Fake Host for the forked Agent Teams runtime.
 *
 * The service injects five cordis services and drives them as a real deployment
 * would, so this harness provides those five on a real root Context instead of
 * stubbing the service: the vendored code runs unmodified, and the assertions
 * read what it actually asked the Host to do (registration order, the pin calls,
 * the child-session checkpoint).
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TeamService } from '../src/team/index.ts'

/** One fake live session's durable log. */
interface FakeSession {
  header: { id: string; parentSession?: string }
  inheritedEventCount: number
  snapshotEvents(): SessionEvent[]
  append(type: string, data: unknown): void
}

/** Projected Team state the fake projection service answers with. */
interface FakeTeamState {
  id: string
  members: unknown[]
  tasks: unknown[]
  messages: unknown[]
  delivered: unknown[]
  nextTaskNumber: number
}

/** A fake live Agent with its own scoped system-prompt and tool registries. */
export interface FakeAgent {
  id: string
  session: FakeSession
  options: Record<string, unknown>
  status: 'idle' | 'running'
  ctx: {
    tools: { register(definition: { name: string }): () => void }
    systemPrompt: {
      section(section: { name: string }): () => void
      context(context: { name: string; order: number }): () => void
      getSectionOrder(name: string): number
    }
  }
}

/** Everything a spec observes about the fake Host. */
export interface TeamHarness {
  readonly ctx: Context
  readonly order: string[]
  readonly tools: string[]
  readonly sections: string[]
  readonly contexts: string[]
  /** Registered context orders, in registration order; the position each context claims. */
  readonly contextOrders: number[]
  readonly projections: Array<{ key: string; stateVersion: number }>
  readonly agents: Map<string, FakeAgent>
  /** The activation request the fake subagent service received, when one arrived. */
  readonly started: unknown[]
  createAgent(id: string, parentSessionId?: string): FakeAgent
  /** Publish one live Agent the way the Host's registry does. */
  published(agent: FakeAgent): void
  teamService: TeamService | undefined
}

function emptyState(id: string): FakeTeamState {
  return { id, members: [], tasks: [], messages: [], delivered: [], nextTaskNumber: 1 }
}

/**
 * Build the fake Host.
 * @returns the context, the observation log, and helpers to create live Agents.
 */
export function createTeamHarness(): TeamHarness {
  const ctx = new Context()
  const agents = new Map<string, FakeAgent>()
  const sessions = new Map<string, FakeSession>()
  const states = new Map<string, FakeTeamState>()
  const order: string[] = []
  const tools: string[] = []
  const sections: string[] = []
  const contexts: string[] = []
  const contextOrders: number[] = []
  const projections: Array<{ key: string; stateVersion: number }> = []
  const started: unknown[] = []

  const stateFor = (id: string): FakeTeamState => {
    let state = states.get(id)
    if (state === undefined) {
      state = emptyState(id)
      states.set(id, state)
    }
    return state
  }

  const harness = {
    ctx,
    order,
    tools,
    sections,
    contexts,
    contextOrders,
    projections,
    agents,
    started,
    teamService: undefined as TeamService | undefined,
    createAgent(id: string, parentSessionId?: string): FakeAgent {
      const events: SessionEvent[] = []
      const session: FakeSession = {
        header: { id, ...(parentSessionId === undefined ? {} : { parentSession: parentSessionId }) },
        inheritedEventCount: 0,
        snapshotEvents: () => [...events],
        append: (type: string, data: unknown) => {
          events.push({ type, data } as SessionEvent)
          if (type === 'team/member') {
            const member = (data as { member: { id: string } }).member
            const state = stateFor(id)
            state.members = [...state.members.filter(candidate => (candidate as { id: string }).id !== member.id), member]
          }
        },
      }
      sessions.set(id, session)
      const agent: FakeAgent = {
        id,
        session,
        options: {},
        status: 'idle',
        ctx: {
          tools: {
            register: (definition) => {
              tools.push(definition.name)
              return () => undefined
            },
          },
          systemPrompt: {
            section: (section) => {
              sections.push(id + ':' + section.name)
              return () => undefined
            },
            context: (context) => {
              contexts.push(id + ':' + context.name)
              contextOrders.push(context.order)
              return () => undefined
            },
            getSectionOrder: () => 600,
          },
        },
      }
      agents.set(id, agent)
      return agent
    },
    published(agent: FakeAgent): void {
      // The cordis event surface is this-typed per event; the harness only needs
      // the emit entry point to replay the Host creation edge.
      const bus = ctx as unknown as { emit(name: string, payload: { agent: Agent }): void }
      bus.emit('agent/created', { agent: agent as unknown as Agent })
    },
    dispose(): void {
      void ctx
    },
  }

  ctx.provide('agents', {
    get: (id: string) => agents.get(id) as unknown as Agent | undefined,
    list: () => [...agents.values()] as unknown as Agent[],
  })
  ctx.provide('sessions', {
    get: (id: string) => sessions.get(id),
    flush: async (session: FakeSession) => {
      // Only the child checkpoint is ordered evidence; the Lead's own journal
      // flushes are not part of the spawn sequence this harness asserts.
      if (session.header.parentSession !== undefined) order.push('checkpoint')
    },
  })
  ctx.provide('sessionPersistence', {
    open: async (id: string) => {
      const session = sessions.get(id)
      return {
        header: session?.header,
        inheritedEventCount: 0,
        read: async () => ({ events: session?.snapshotEvents() ?? [] }),
        close: async () => undefined,
      }
    },
  })
  ctx.provide('sessionProjections', {
    register: async (definition: { key: string; stateVersion: number }) => {
      projections.push({ key: definition.key, stateVersion: definition.stateVersion })
      return { stateOf: (session: FakeSession) => stateFor(session.header.id) }
    },
  })
  ctx.provide('subagents', {
    startActivation: async (spec: { childId: string; request: { parent: { id: string } } }) => {
      order.push('start')
      started.push(spec)
      const child = harness.createAgent(String(spec.childId), spec.request.parent.id)
      const messageId = 'message-1'
      child.session.append('user/message', { id: messageId, content: [], source: { kind: 'user' } })
      return {
        childId: spec.childId,
        messageId,
        result: Promise.resolve({ output: [], stopReason: 'completed' }),
        dispose: async () => undefined,
      }
    },
    interrupt: () => undefined,
    drainChildren: async () => undefined,
  })

  return harness
}
