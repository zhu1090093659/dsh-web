import type { TaskRecord } from '../core/tasks.ts'
import {
  TASK_BOARD_API_PREFIX,
  type TaskBoardAction,
  type TaskBoardActionEnvelope,
  type TaskBoardEventPayload,
  type TaskBoardSnapshot,
} from '../protocol.ts'

const IMPORT_MARKER = 'dsh.taskBoard.v2.hostImported'
const SOURCE_KEY = 'dsh.taskBoard.v2.sourceId'
const IMPORT_REQUEST_KEY = 'dsh.taskBoard.v2.importRequestId'
const REQUEST_TIMEOUT_MS = 15_000

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `task-board request failed: ${response.status}`)
  return body
}

export interface TaskBoardHostTransport {
  bootstrap(legacy: readonly TaskRecord[]): Promise<TaskBoardSnapshot>
  state(): Promise<TaskBoardSnapshot>
  action(action: TaskBoardAction): Promise<TaskBoardSnapshot>
  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void
}

export class HttpTaskBoardHostTransport implements TaskBoardHostTransport {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {}

  async bootstrap(legacy: readonly TaskRecord[]): Promise<TaskBoardSnapshot> {
    const initial = await this.state()
    const ledgerId = initial.scheduler.ledgerId
    if (legacy.length > 0 && ledgerId !== undefined && this.storage?.getItem(IMPORT_MARKER) !== ledgerId) {
      let sourceId = this.storage?.getItem(SOURCE_KEY)
      if (sourceId === null || sourceId === undefined || sourceId === '') {
        sourceId = uuid()
        this.storage?.setItem(SOURCE_KEY, sourceId)
      }
      let requestId = this.storage?.getItem(IMPORT_REQUEST_KEY)
      if (requestId === null || requestId === undefined || requestId === '') {
        requestId = uuid()
        this.storage?.setItem(IMPORT_REQUEST_KEY, requestId)
      }
      const snapshot = await this.post(requestId, { kind: 'import', sourceId, tasks: [...legacy] })
      this.storage?.setItem(IMPORT_MARKER, snapshot.scheduler.ledgerId ?? ledgerId)
      return snapshot
    }
    return initial
  }

  async state(): Promise<TaskBoardSnapshot> {
    return await this.request(`${TASK_BOARD_API_PREFIX}/state`, { cache: 'no-store' })
  }

  async action(action: TaskBoardAction): Promise<TaskBoardSnapshot> {
    return await this.post(uuid(), action)
  }

  private async post(requestId: string, action: TaskBoardAction): Promise<TaskBoardSnapshot> {
    const envelope: TaskBoardActionEnvelope = { requestId, action }
    return await this.request(`${TASK_BOARD_API_PREFIX}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
  }

  private async request(url: string, init: RequestInit): Promise<TaskBoardSnapshot> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
    try {
      return await readJson<TaskBoardSnapshot>(await fetch(url, { ...init, signal: controller.signal }))
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`task-board Host request timed out after ${REQUEST_TIMEOUT_MS / 1_000}s`)
      throw error
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }

  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void {
    const events = new EventSource(`${TASK_BOARD_API_PREFIX}/events`)
    events.onmessage = (message: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(message.data) as TaskBoardEventPayload
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.revision !== 'number') throw new Error('invalid event frame')
        listener(parsed)
      } catch {
        listener()
      }
    }
    const onVisible = (): void => { if (document.visibilityState === 'visible') listener() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      events.close()
    }
  }
}
