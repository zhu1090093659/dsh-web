/**
 * The REAL board behind a spec.
 *
 * The ledger, the Host service, the extension registry, the launch gate and the
 * external-outcome action are the production implementations imported from the
 * board package's own sources, so these specs exercise the board's real gates
 * rather than a stand-in that agrees with the provider. Only the deployment's
 * session gateway is a script: it records what a run would have sent into a
 * session, and refuses to be reached at all when a spec is proving that a direct
 * run creates no local session.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { HostTaskLedger } from '../../../dsh-task-board/src/host-ledger.ts'
import { TaskBoardHostService } from '../../../dsh-task-board/src/host-service.ts'
import { PowerInhibitor } from '../../../dsh-task-board/src/power-inhibitor.ts'
import type { ExecutionRecord, NewTaskInput, TaskRecord } from '../../../dsh-task-board/src/core/tasks.ts'
import type { TaskBoardAction } from '../../../dsh-task-board/src/protocol.ts'
import { fixtureWorkspaces } from '../../../dsh-task-board/tests/workspace-fixture.ts'

/** Fixed clock the board and every fake read. */
export const NOW = 1_700_000_000_000

/** The workspace this deployment serves, so a local run really starts. */
export const WORKSPACE_ID = 'workspace-fixture'

/** One prompt a local run queued into a session. */
export interface DeliveredPrompt {
  /** Session the board opened. */
  sessionId: string
  /** Text it queued. */
  text: string
  /** Mode the prompt was sent with. */
  mode: string
}

type GatewayRequest = { namespace: string; method: string; args: Record<string, unknown> }

/**
 * The gateway a board that really starts sessions speaks to.
 * @returns the gateway and the prompts it received.
 */
function scriptedGateway(): { gateway: TypertGateway; prompts: DeliveredPrompt[] } {
  const prompts: DeliveredPrompt[] = []
  const sessions: string[] = []
  let created = 0
  async function invoke(request: GatewayRequest): Promise<unknown> {
    const body = (request.args.request ?? {}) as Record<string, unknown>
    if (request.namespace === 'agentPresets' && request.method === 'list') {
      return { presets: [{ id: 'liangshen' }, { id: 'review' }] }
    }
    if (request.namespace !== 'session') throw new Error('unexpected gateway namespace: ' + request.namespace)
    if (request.method === 'modelCatalog') return {}
    if (request.method === 'list') return { items: sessions.map(sessionId => ({ sessionId, running: false })) }
    if (request.method === 'create') {
      created += 1
      const sessionId = 'session-' + String(created)
      sessions.push(sessionId)
      return { sessionId }
    }
    if (request.method === 'rename') return { title: 'x', seq: 1 }
    if (request.method === 'selectModel') return {}
    if (request.method === 'projections') return { values: {} }
    if (request.method === 'prompt') {
      const content = body.content as Array<{ text: string }>
      prompts.push({ sessionId: String(body.sessionId), text: content[0]?.text ?? '', mode: String(body.mode) })
      return { accepted: true }
    }
    throw new Error('unexpected gateway call: ' + request.method)
  }
  return { gateway: { invoke } as unknown as TypertGateway, prompts }
}

/** The board behind one spec. */
export interface BoardHarness {
  /** The production Host service. */
  board: TaskBoardHostService
  /** The production ledger. */
  ledger: HostTaskLedger
  /** Prompts the board queued into local sessions. */
  prompts: DeliveredPrompt[]
  /** Create one card with a deterministic id. */
  createCard(id: string, input: Partial<NewTaskInput>): TaskRecord
  /** Apply one board action through the board's own gates. */
  apply(action: Exclude<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string): unknown
  /** One card as the ledger stores it. */
  task(taskId: string): TaskRecord | undefined
  /** Every card the ledger holds. */
  tasks(): readonly TaskRecord[]
  /** Close the board and remove its scratch ledger directory. */
  dispose(): void
}

/** How the board's session gateway behaves. */
export interface BoardOptions {
  /**
   * Whether this deployment really starts local sessions. A spec proving that a
   * direct run creates none turns this off, and any gateway call then fails the
   * test instead of passing quietly.
   */
  sessions?: boolean
}

/**
 * Build the real board.
 * @param options - which gateway this deployment serves.
 * @returns the board harness.
 */
export function createBoard(options: BoardOptions = {}): BoardHarness {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-board-ssh-'))
  const sessions = options.sessions === true ? scriptedGateway() : undefined
  const gateway = sessions?.gateway ?? ({
    invoke: async () => { throw new Error('this deployment starts no local session, but the board asked one to start') },
  } as unknown as TypertGateway)
  const ledger = new HostTaskLedger(dir, () => NOW)
  const board = new TaskBoardHostService(gateway, {
    ledger,
    power: new PowerInhibitor({ platform: 'linux' }),
    now: () => NOW,
    workspaceRegistry: fixtureWorkspaces([WORKSPACE_ID]),
  })
  let created = 0
  return {
    board,
    ledger,
    prompts: sessions?.prompts ?? [],
    createCard(id, input) {
      created += 1
      board.apply(randomUUID(), {
        kind: 'create',
        id,
        input: {
          title: 'card ' + String(created),
          description: '',
          prompt: 'do the work',
          workspaceId: WORKSPACE_ID,
          ...input,
        },
      })
      const task = ledger.getTask(id)
      if (task === undefined) throw new Error('the board did not store the card ' + id)
      return task
    },
    apply(action, initiator) {
      return board.apply(randomUUID(), action, initiator)
    },
    task: taskId => ledger.getTask(taskId),
    tasks: () => ledger.allTasks(),
    dispose() {
      try {
        board.dispose()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}

/**
 * The execution records of one card, as the board stores them.
 * @param task - the card to read.
 * @returns its records, oldest first.
 */
export function executionsOf(task: TaskRecord | undefined): ExecutionRecord[] {
  const executions = (task as { executions?: unknown } | undefined)?.executions
  return Array.isArray(executions) ? executions as ExecutionRecord[] : []
}
