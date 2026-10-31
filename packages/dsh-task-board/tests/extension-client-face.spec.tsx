// @vitest-environment jsdom
/**
 * The board's browser-half extension capability face, driven by a fake provider
 * through the real {@link TaskBoardClientService} and a real board controller
 * over a fake same-origin channel. No provider vocabulary is involved: the
 * point is that an arbitrary provider gets dispatch, visibility, subscription
 * and release semantics from the contract alone.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { BoardController, type SessionsControllerFace, type TaskBoardTransport } from '../src/core/controller.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { TaskBoardClientService } from '../src/client/service.ts'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import type { TaskBoardClientMirror } from '../src/core/extension.ts'
import type { TaskBoardAction, TaskBoardSnapshot } from '../src/protocol.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = 1_700_000_000_000
const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

/** Sessions face the board needs but this suite never navigates. */
class FakeSessions implements SessionsControllerFace {
  current(): string | undefined { return undefined }
  open(): void {}
  subscribe(): () => void { return () => {} }
}

/**
 * The board's same-origin channel, standing in for the Host. It records every
 * action, refuses a configured set of extension ids the way the host registry
 * would, and answers with one immutable snapshot.
 */
class FakeHostChannel implements TaskBoardTransport {
  readonly actions: TaskBoardAction[] = []
  readonly unknownExtensions = new Set(['ghost'])

  constructor(
    private readonly tasks: readonly TaskRecord[],
    private readonly extensions: Readonly<Record<string, unknown>>,
  ) {}

  async bootstrap(): Promise<TaskBoardSnapshot> { return this.snapshot() }
  async state(): Promise<TaskBoardSnapshot> { return this.snapshot() }
  async action(action: TaskBoardAction): Promise<TaskBoardSnapshot> {
    this.actions.push(action)
    if (action.kind === 'extension-action' && this.unknownExtensions.has(action.extensionId)) {
      throw new Error(`task-board extension [unknown-extension]: no extension "${action.extensionId}" is registered`)
    }
    return this.snapshot()
  }
  subscribe(): () => void { return () => {} }

  private snapshot(): TaskBoardSnapshot {
    return {
      schemaVersion: 7,
      revision: 1,
      tasks: [...this.tasks],
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-fake' },
      power: {
        platform: 'linux', phase: 'unsupported', enabled: false,
        runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
      },
      extensions: { ...this.extensions },
    }
  }
}

/** One card with an optional provider payload. */
function card(id: string, title: string, integrations?: Record<string, Record<string, unknown>>): TaskRecord {
  return createTask(
    { title, description: '', prompt: 'p', ...(integrations === undefined ? {} : { integrations }) },
    NOW,
    id,
  )
}

/** A board controller bootstrapped from the fake channel, plus its client face. */
async function makeFace(tasks: readonly TaskRecord[], extensions: Record<string, unknown> = { fake: { provider: 'fake', version: 1 } }): Promise<{
  channel: FakeHostChannel
  controller: BoardController
  service: TaskBoardClientService
}> {
  const channel = new FakeHostChannel(tasks, extensions)
  const controller = new BoardController({
    store: new InMemoryTaskStore(),
    sessions: new FakeSessions(),
    transport: channel,
    now: () => NOW,
  })
  controller.start()
  await controller.retryHostSync()
  const service = new TaskBoardClientService()
  service.attach(controller)
  return { channel, controller, service }
}

/** Render one element into a fresh container. */
function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return container
}

/** The visible text of one rendered container. */
function textOf(container: HTMLElement): string {
  return container.textContent ?? ''
}

describe('client extension capability face', () => {
  it('operator dispatching a provider action sees it routed verbatim and an unregistered id refused', async () => {
    // Given an attached client face over a board with one card
    const { channel, controller, service } = await makeFace([card('t1', 'Task one')])
    const payload = { cursor: 3, nested: { tags: ['alpha', 'beta'] }, cleared: undefined }

    // When the provider dispatches an opaque action and then an action for an
    // extension the board has not registered
    const accepted = await service.dispatch({ extensionId: 'fake', action: 'sync', taskId: 't1', payload })
    const refused = await service.dispatch({ extensionId: 'ghost', action: 'sync' })

    // Then the action travelled the same-origin channel byte-for-byte, the
    // unknown provider was refused with the host's reason, and the client never
    // interpreted the payload
    expect(accepted).toBe(true)
    expect(channel.actions[0]).toEqual({
      kind: 'extension-action',
      extensionId: 'fake',
      action: 'sync',
      taskId: 't1',
      payload: { cursor: 3, nested: { tags: ['alpha', 'beta'] }, cleared: undefined },
    })
    expect(refused).toBe(false)
    expect(channel.actions[1]).toEqual({ kind: 'extension-action', extensionId: 'ghost', action: 'sync' })
    expect(controller.getSnapshot().transportError).toContain('no extension "ghost" is registered')
    controller.dispose()
  })

  it('operator registering two providers visibility predicates sees both narrow the board cards', async () => {
    // Given four cards, two of them marked hidden by one of two providers
    const { controller, service } = await makeFace([
      card('visible', 'Visible card'),
      card('hidden-a', 'Hidden by A', { providerA: { hidden: true } }),
      card('hidden-b', 'Hidden by B', { providerB: { hidden: true } }),
      card('hidden-both', 'Hidden by both', { providerA: { hidden: true }, providerB: { hidden: true } }),
    ])
    const container = render(<TaskBoard controller={controller} />)

    // Then with no provider registered every card is visible
    expect(textOf(container)).toContain('Visible card')
    expect(textOf(container)).toContain('Hidden by A')
    expect(textOf(container)).toContain('Hidden by B')
    expect(textOf(container)).toContain('Hidden by both')

    // When the first provider registers its own predicate over its own payload
    let offA: () => void = () => {}
    act(() => {
      offA = service.registerVisibility(task => (task.integrations?.providerA as { hidden?: unknown } | undefined)?.hidden !== true)
    })

    // Then only that provider's card leaves the board
    expect(textOf(container)).toContain('Visible card')
    expect(textOf(container)).not.toContain('Hidden by A')
    expect(textOf(container)).toContain('Hidden by B')

    // When a second provider registers an unrelated predicate
    let offB: () => void = () => {}
    act(() => {
      offB = service.registerVisibility(task => (task.integrations?.providerB as { hidden?: unknown } | undefined)?.hidden !== true)
    })

    // Then the two predicates stack: each hides its own cards, both hide the
    // card they share, and the unmarked card stays
    expect(textOf(container)).toContain('Visible card')
    expect(textOf(container)).not.toContain('Hidden by A')
    expect(textOf(container)).not.toContain('Hidden by B')
    expect(textOf(container)).not.toContain('Hidden by both')

    // When the first provider withdraws its predicate
    act(() => { offA() })

    // Then only the second provider's rule remains
    expect(textOf(container)).toContain('Hidden by A')
    expect(textOf(container)).not.toContain('Hidden by B')
    act(() => { offB() })
    controller.dispose()
  })

  it('operator subscribing to the board mirror receives tasks, enabled state and summaries', async () => {
    // Given a subscriber on the client face
    const { controller, service } = await makeFace([card('t1', 'Task one'), card('t2', 'Task two')])
    const received: TaskBoardClientMirror[] = []
    const off = service.subscribe(mirror => { received.push(mirror) })

    // When the board master switch turns on and a provider predicate registers
    service.setEnabled(true)
    service.registerVisibility(() => true)

    // Then every delivery carried the task mirror, the enabled flag and the
    // published provider summary, and snapshot() agrees with the last delivery
    const last = received.at(-1) as TaskBoardClientMirror
    expect(last.enabled).toBe(true)
    expect(last.tasks.map(task => task.id)).toEqual(['t1', 't2'])
    expect(last.extensions).toEqual({ fake: { provider: 'fake', version: 1 } })
    expect(service.snapshot()).toEqual(last)

    // When the subscription is released and the board changes again
    off()
    const delivered = received.length
    service.setEnabled(false)

    // Then no further delivery arrives
    expect(received).toHaveLength(delivered)
    controller.dispose()
  })

  it('operator removing a provider sees its visibility predicate and subscription withdrawn together', async () => {
    // Given a provider contribution that hides one card and watches the mirror
    const { controller, service } = await makeFace([
      card('visible', 'Visible card'),
      card('hidden', 'Hidden card', { providerA: { hidden: true } }),
    ])
    const delivery: TaskBoardClientMirror[] = []
    const offVisibility = service.registerVisibility(task => task.id !== 'hidden')
    const offSubscription = service.subscribe(mirror => { delivery.push(mirror) })
    service.setEnabled(true)
    const container = render(<TaskBoard controller={controller} />)
    expect(textOf(container)).not.toContain('Hidden card')

    // When the provider is unregistered (both disposers called)
    act(() => { offVisibility() })
    offSubscription()

    // Then its card is visible again and the closed window receives nothing more
    expect(textOf(container)).toContain('Hidden card')
    const delivered = delivery.length
    service.setEnabled(false)
    expect(delivery).toHaveLength(delivered)
    controller.dispose()
  })

  it('operator registering visibility before the board controller attaches sees it apply on attach', async () => {
    // Given a client face with no controller yet and one buffered provider predicate
    const service = new TaskBoardClientService()
    const off = service.registerVisibility(task => task.id !== 'hidden')

    // When a board controller attaches with one visible and one hidden card
    const channel = new FakeHostChannel([card('visible', 'Visible card'), card('hidden', 'Hidden card')], {})
    const controller = new BoardController({ store: new InMemoryTaskStore(), sessions: new FakeSessions(), transport: channel, now: () => NOW })
    controller.start()
    await controller.retryHostSync()
    service.attach(controller)
    const container = render(<TaskBoard controller={controller} />)

    // Then the buffered predicate participated in visibility
    expect(textOf(container)).toContain('Visible card')
    expect(textOf(container)).not.toContain('Hidden card')
    off()
    controller.dispose()
  })

  it('operator registering source groups before attach sees replay, first-match ownership and disposal', async () => {
    // Given a provider source selector registered before any controller exists
    const service = new TaskBoardClientService()
    const offSource = service.registerGrouping(task => {
      const source = (task.integrations?.fake as { source?: string } | undefined)?.source
      return source === undefined ? undefined : { id: 'fake:' + source, label: source }
    })
    const channel = new FakeHostChannel([
      card('linked', 'Linked card', { fake: { source: 'owner/repository' } }),
      card('local', 'Local card'),
    ], {})
    const controller = new BoardController({ store: new InMemoryTaskStore(), sessions: new FakeSessions(), transport: channel, now: () => NOW })
    controller.start()
    await controller.retryHostSync()

    // When the controller attaches and a second selector registers later
    service.attach(controller)
    const container = render(<TaskBoard controller={controller} />)
    let offFallback: () => void = () => {}
    act(() => {
      offFallback = service.registerGrouping(task => task.id === 'linked' ? { id: 'fallback:' + task.id, label: 'fallback/source' } : undefined)
    })

    // Then the buffered selector wins and unclaimed cards use the local group
    expect(textOf(container)).toContain('owner/repository')
    expect(textOf(container)).toContain('本地任务')
    expect(textOf(container)).not.toContain('fallback/source')

    // When the first provider withdraws, the next selector takes ownership
    act(() => { offSource() })
    expect(textOf(container)).toContain('fallback/source')
    act(() => { offFallback() })
    expect(textOf(container)).toContain('本地任务')
    controller.dispose()
  })
})
