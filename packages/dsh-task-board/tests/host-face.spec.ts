/**
 * The `taskBoard` cordis service as an IN-PROCESS consumer sees it.
 *
 * The board publishes more than the provider-registration pair: the read/write
 * face the remote bridge forwards to a paired phone lives on the same service.
 * These tests mount the real activation and drive the board only through that
 * service, so what they observe is the board's own ledger and its own gates —
 * not a second path that could ever be more permissive than a browser.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { Config, apply } from '../src/index.ts'
import { HostTaskLedger } from '../src/host-ledger.ts'
import type { TaskBoardSnapshot, TaskBoardAction, TaskBoardModelCatalog } from '../src/protocol.ts'
import { TASK_BOARD_SERVICE_NAME, type TaskBoardExtension } from '../src/core/extension.ts'

/** The face a consumer inside the Host process drives the board through. */
interface PublishedFace {
  registerExtension(extension: TaskBoardExtension): () => void
  isExtensionEnabled(extensionId: string): boolean
  snapshot(): TaskBoardSnapshot
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot | Promise<TaskBoardSnapshot>
  subscribe(listener: () => void): () => void
  modelCatalogOptions(): Promise<TaskBoardModelCatalog>
}

/** One mounted activation, observed through the service it published. */
interface MountedFace {
  readonly face: PublishedFace
  dispose(): void
}

/** A gateway with no sessions: the board has nothing to reconcile here. */
function emptyGateway(): TypertGateway {
  return {
    invoke: async () => ({ items: [] }),
    stream: async () => ({ async *[Symbol.asyncIterator]() {} }),
  } as unknown as TypertGateway
}

/**
 * Mount the board's host half into a capture-only context and keep the service
 * it published.
 * @param config - the parsed row config the Host hands the activation.
 */
function mountFace(config: ReturnType<typeof Config>): MountedFace {
  const disposers: (() => void)[] = []
  const published = new Map<string, unknown>()
  const ctx = {
    get: () => undefined,
    typertGateway: emptyGateway(),
    workspaceRegistry: {},
    agents: { get: () => undefined },
    commands: { execute: async () => undefined },
    systemPrompt: { section: () => () => undefined },
    webServer: { register: () => () => undefined },
    provide: (name: string, value: unknown) => {
      published.set(name, value)
      return () => { published.delete(name) }
    },
    effect: (body: () => unknown) => {
      const dispose = body()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
    },
    on: () => () => undefined,
  }
  apply(ctx as never, config)
  const face = published.get(TASK_BOARD_SERVICE_NAME)
  if (face === undefined) throw new Error('the board published no taskBoard service')
  return {
    face: face as PublishedFace,
    dispose: () => {
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
  }
}

let previousHome: string | undefined
let scratchHome: string | undefined
const mounted: MountedFace[] = []

beforeEach(() => {
  // The activation builds a disk-backed ledger: keep every test off the real DSH home.
  previousHome = process.env.DSH_HOME
  scratchHome = mkdtempSync(join(tmpdir(), 'dsh-task-board-face-'))
  process.env.DSH_HOME = scratchHome
})

afterEach(() => {
  for (const board of mounted.splice(0)) board.dispose()
  if (scratchHome !== undefined) rmSync(scratchHome, { recursive: true, force: true })
  scratchHome = undefined
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

/** Mount one board and register it for teardown. */
function mount(config: ReturnType<typeof Config>): MountedFace {
  const board = mountFace(config)
  mounted.push(board)
  return board
}

describe('the published taskBoard service', () => {
  it('admin reads the read/write face beside the provider registration pair', () => {
    // Given a mounted board
    const board = mount(Config({ enabled: true }))
    // When a consumer inside the Host process reads the service it published
    const face = board.face as unknown as Record<string, unknown>
    // Then both the provider pair and the four capability members answer as functions
    for (const member of ['registerExtension', 'isExtensionEnabled', 'snapshot', 'apply', 'subscribe', 'modelCatalogOptions']) {
      expect(typeof face[member]).toBe('function')
    }
  })

  it('admin reads the board through the face and receives the Host ledger document', () => {
    // Given a mounted board holding one card
    const board = mount(Config({ enabled: true }))
    board.face.apply('req-create', { kind: 'create', id: 'card', input: { title: 'Ship it', description: '', prompt: 'work' } })
    // When a consumer reads the board
    const snapshot = board.face.snapshot()
    // Then it sees the ledger's own shape, revision included
    expect(snapshot.schemaVersion).toBe(7)
    expect(snapshot.revision).toBeGreaterThan(0)
    expect(snapshot.tasks.map(task => task.id)).toEqual(['card'])
  })

  it('admin applying a move through the face gets the new revision back', async () => {
    // Given a mounted board with one card
    const board = mount(Config({ enabled: true }))
    const created = board.face.apply('req-create', { kind: 'create', id: 'card', input: { title: 'Ship it', description: '', prompt: 'work' } })
    const before = (await created).revision
    // When the consumer moves it through the same face
    const moved = await board.face.apply('req-move', { kind: 'move', taskId: 'card', status: 'done' })
    // Then the answer is the applied ledger, one revision newer
    expect(moved.revision).toBeGreaterThan(before)
    expect(moved.tasks[0]?.status).toBe('done')
  })

  it('admin is refused a run through the face when the card outranks the session permission', () => {
    // Given a card whose handover pins a permission above the read-only baseline
    const board = mount(Config({ enabled: true, sessionDefaultPermission: 'read-only' }))
    board.face.apply('req-create', {
      kind: 'create',
      id: 'elevated',
      input: {
        title: 'Elevated',
        description: '',
        prompt: 'work',
        handover: { permission: 'danger-full-access', references: [] },
      },
    })
    // When the consumer tries to run it through the published face
    const run = (): unknown => board.face.apply('req-run', { kind: 'run', taskId: 'elevated' })
    // Then the Host's own confirmation gate refuses it, exactly as for a browser
    expect(run).toThrow(/confirmation-required/)
    expect(board.face.snapshot().tasks[0]?.executions).toEqual([])
    expect(board.face.snapshot().tasks[0]?.status).toBe('todo')
  })

  it('admin hears about a change through the face until the subscription is released', async () => {
    // Given a mounted board and a listener subscribed through the face
    const board = mount(Config({ enabled: true }))
    let heard = 0
    const unsubscribe = board.face.subscribe(() => { heard += 1 })
    // When one action lands and the subscription is then released before another
    await board.face.apply('req-create', { kind: 'create', id: 'card', input: { title: 'Ship it', description: '', prompt: 'work' } })
    const afterFirst = heard
    unsubscribe()
    await board.face.apply('req-move', { kind: 'move', taskId: 'card', status: 'done' })
    // Then the first change was announced and the released listener heard nothing more
    expect(afterFirst).toBeGreaterThan(0)
    expect(heard).toBe(afterFirst)
  })

  it('admin reads the model catalog through the face', async () => {
    // Given a mounted board
    const board = mount(Config({ enabled: true }))
    // When a consumer asks for the model catalog
    const options = await board.face.modelCatalogOptions()
    // Then the catalog the model and level pickers read crosses, and nothing else
    expect(options.catalog.groups).toEqual([])
  })

  it('admin applying an action kind this build does not implement is refused and changes nothing', () => {
    // Given a mounted board with one card and a listener subscribed afterwards
    const board = mount(Config({ enabled: true }))
    board.face.apply('req-create', { kind: 'create', id: 'card', input: { title: 'Ship it', description: '', prompt: 'work' } })
    let heard = 0
    board.face.subscribe(() => { heard += 1 })
    const before = board.face.snapshot()
    // When the consumer forwards an action whose kind is not part of the protocol
    const apply = (): unknown => board.face.apply('req-unknown', { kind: 'no-such-action-kind', taskId: 'card' } as unknown as TaskBoardAction)
    // Then the board refuses it by name instead of committing an unchanged document
    expect(apply).toThrow(/unknown task board action kind: no-such-action-kind/)
    const after = board.face.snapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.tasks).toEqual(before.tasks)
    // And no client is told to reload a snapshot that did not change
    expect(heard).toBe(0)
  })

  it('admin reaching the ledger without the service guard is refused instead of committing', () => {
    // Given a ledger held directly, the way a future call path would hold it
    const ledger = new HostTaskLedger(join(scratchHome as string, 'ledger-direct'), () => Date.now())
    ledger.applyRequest('req-create', { kind: 'create', id: 'card', input: { title: 'Ship it', description: '', prompt: 'work' } })
    const before = ledger.state()
    // When an unknown kind reaches that ledger directly
    const apply = (): unknown => ledger.applyRequest('req-unknown', { kind: 'no-such-action-kind', taskId: 'card' } as unknown as TaskBoardAction)
    // Then the ledger's own default refuses it and the revision does not move
    expect(apply).toThrow(/unknown task board action kind: no-such-action-kind/)
    expect(ledger.state().revision).toBe(before.revision)
    ledger.dispose()
  })

  it('admin applies the action kinds the board defines exactly as before', async () => {
    // Given a mounted board
    const board = mount(Config({ enabled: true }))
    // When the consumer walks several kinds the protocol defines, in order
    const revisions = [(await board.face.apply('req-create', { kind: 'create', id: 'card', input: { title: 'Ship it', description: '', prompt: 'work' } })).revision]
    revisions.push((await board.face.apply('req-update', { kind: 'update', taskId: 'card', patch: { title: 'Renamed' } })).revision)
    revisions.push((await board.face.apply('req-move', { kind: 'move', taskId: 'card', status: 'done' })).revision)
    revisions.push((await board.face.apply('req-archive', { kind: 'archive', taskId: 'card' })).revision)
    revisions.push((await board.face.apply('req-restore', { kind: 'restore', taskId: 'card' })).revision)
    // Then every one still lands, each moving the revision forward
    for (let index = 1; index < revisions.length; index += 1) expect(revisions[index] ?? 0).toBeGreaterThan(revisions[index - 1] ?? 0)
    const snapshot = board.face.snapshot()
    expect(snapshot.tasks[0]).toMatchObject({ id: 'card', title: 'Renamed', status: 'done' })
    expect(snapshot.tasks[0]?.archivedAt).toBeUndefined()
  })

  it('admin finds every kind of the action union either accepted or refused on its own merits', async () => {
    // Given one minimal action per member of the TaskBoardAction union
    const board = mount(Config({ enabled: true }))
    const actions: Record<string, Record<string, unknown>> = {
      import: { kind: 'import', sourceId: 'src', tasks: [] },
      create: { kind: 'create', id: 'walked', input: { title: 'Walked', description: '', prompt: 'work' } },
      update: { kind: 'update', taskId: 'missing', patch: { title: 'Renamed' } },
      delete: { kind: 'delete', taskId: 'missing' },
      move: { kind: 'move', taskId: 'missing', status: 'done' },
      archive: { kind: 'archive', taskId: 'missing' },
      restore: { kind: 'restore', taskId: 'missing' },
      settle: { kind: 'settle', taskId: 'missing' },
      'record-external-outcome': { kind: 'record-external-outcome', taskId: 'missing', result: 'succeeded', initiatedBy: 'walk' },
      'set-schedule': { kind: 'set-schedule', taskId: 'missing', patch: {} },
      run: { kind: 'run', taskId: 'missing' },
      rerun: { kind: 'rerun', taskId: 'missing' },
      'confirm-permission': { kind: 'confirm-permission', taskId: 'missing' },
      'set-parent': { kind: 'set-parent', taskId: 'missing', parentId: null },
      'rename-tag': { kind: 'rename-tag', from: 'old', to: 'new' },
      'delete-tag': { kind: 'delete-tag', name: 'old' },
      'extension-action': { kind: 'extension-action', extensionId: 'missing', action: 'noop' },
    }
    // When each one reaches the published face
    const refusals: string[] = []
    for (const [kind, action] of Object.entries(actions)) {
      try {
        const answer = board.face.apply(`req-${kind}`, action as unknown as TaskBoardAction)
        if (answer instanceof Promise) await answer.catch((error: unknown) => { refusals.push(`${kind}: ${String(error)}`) })
      } catch (error) {
        refusals.push(`${kind}: ${String(error)}`)
      }
    }
    // Then none of them is refused as an unknown kind: each is implemented, so a refusal
    // that does happen is the action's own (a missing card, a missing extension)
    expect(Object.keys(actions)).toHaveLength(17)
    expect(refusals.filter(entry => entry.includes('unknown task board action kind'))).toEqual([])
  })
})
