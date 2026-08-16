import type { ApiProxy, RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { TaskRecord } from './core/tasks.ts'

function request<T>(payload: T) {
  return { rpcId: `task-board-${crypto.randomUUID()}` as RpcId, payload }
}

function failure(error: { code: string; message: string }): Error {
  return new Error(`${error.code}: ${error.message}`)
}

export type ExecutionInspection =
  | { outcome: 'pending' }
  | { outcome: 'succeeded' }
  | { outcome: 'failed'; error: string }
  | { outcome: 'cancelled'; error: string }

function isErrorTurnEnd(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'object' && reason !== null && (reason as { kind?: unknown }).kind === 'error'
}

export class HostExecutionRunner {
  constructor(private readonly api: ApiProxy) {}

  async launch(task: TaskRecord): Promise<string> {
    if (task.workspaceId !== undefined) {
      const workspaces = await this.api.workspace.list(request({}))
      if (!workspaces.result.ok) throw failure(workspaces.result.error)
      if (!workspaces.result.value.items.some(item => item.workspaceId === task.workspaceId)) {
        throw new Error(`workspace not found: ${task.workspaceId}`)
      }
    }
    if (task.mode !== undefined) {
      const presets = await this.api.agentPresets.list(request({}))
      if (!presets.result.ok) throw failure(presets.result.error)
      const preset = presets.result.value.presets.find(item => item.id === task.mode)
      if (preset === undefined) throw new Error(`agent preset not found: ${task.mode}`)
      if (preset.broken !== undefined) throw new Error(`agent preset is unavailable: ${preset.broken}`)
    }
    const created = await this.api.sessions.create(request({
      ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId as never }),
      ...(task.mode === undefined ? {} : { agentPreset: task.mode }),
    }))
    if (!created.result.ok) throw failure(created.result.error)
    const sessionId = created.result.value.sessionId
    const renamed = await this.api.sessions.rename(request({ sessionId, title: task.title }))
    if (!renamed.result.ok) throw failure(renamed.result.error)
    if (task.permission !== undefined) {
      const command = await this.api.sessions.prompt(request({
        sessionId,
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: `/permission ${task.permission}` }],
      }))
      if (!command.result.ok) throw failure(command.result.error)
      if (command.result.value.command?.kind !== 'success') throw new Error('permission command was not acknowledged')
    }
    const prompt = await this.api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: task.prompt !== '' ? task.prompt : task.title }],
    }))
    if (!prompt.result.ok) throw failure(prompt.result.error)
    return sessionId
  }

  async listRunning(): Promise<{ known: true; count: number } | { known: false }> {
    try {
      const response = await this.api.sessions.list(request({}))
      return response.result.ok
        ? { known: true, count: response.result.value.items.filter(item => item.running).length }
        : { known: false }
    } catch {
      return { known: false }
    }
  }

  async inspect(sessionId: string): Promise<ExecutionInspection> {
    const sessions = await this.api.sessions.list(request({}))
    if (!sessions.result.ok) return { outcome: 'pending' }
    const summary = sessions.result.value.items.find(item => item.sessionId === sessionId)
    if (summary === undefined) return { outcome: 'cancelled', error: 'execution session no longer exists' }
    if (summary.running) return { outcome: 'pending' }
    const history = await this.api.sessions.history(request({ sessionId: summary.sessionId, maxMessages: 20 }))
    if (!history.result.ok) return { outcome: 'pending' }
    const turnEnd = [...history.result.value.events].reverse().find(entry => entry.event.type === 'turn/end')
    if (turnEnd === undefined) return { outcome: 'pending' }
    return isErrorTurnEnd(turnEnd.event.data)
      ? { outcome: 'failed', error: 'agent turn ended with an error' }
      : { outcome: 'succeeded' }
  }
}
