/**
 * Handover bundle + manual confirmation gate (issue #5): a continuation
 * card may carry a handover bundle (pinned triplet + doc/script
 * references); an effective permission above the session default is an
 * unconfirmed binding — manual run refuses, cron refuses to schedule, and
 * the confirm-permission action resolves it (adversarial scenario b).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUpdateTask } from '../src/core/use-cases/task-update.ts'
import { createTask } from '../src/core/tasks.ts'
import { parseLedger } from '../src/core/store.ts'
import { parseActionEnvelope } from '../src/protocol.ts'
import { HostExecutionRunner } from '../src/host-runner.ts'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'

const NOW = 1_700_000_000_000

const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-handover-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function envelope(action: unknown): ReturnType<typeof parseActionEnvelope> {
  return parseActionEnvelope({ requestId: 'req-1', action })
}

const HANDOVER = { workspaceId: 'ws-1', mode: 'preset-a', permission: 'danger-full-access' as const, references: ['docs/handover.md', 'scripts/rebuild.sh'] }

describe('handover bundle: protocol gate', () => {
  it('accepts a create action carrying a handover bundle', () => {
    const parsed = envelope({ kind: 'create', id: 'card-1', input: { title: '交接', description: '', prompt: 'p', handover: HANDOVER } })
    expect(parsed).toBeDefined()
    if (parsed?.action.kind !== 'create') return
    expect(parsed.action.input.handover?.permission).toBe('danger-full-access')
    expect(parsed.action.input.handover?.references).toEqual(['docs/handover.md', 'scripts/rebuild.sh'])
  })

  it('rejects a malformed handover bundle (extra key / non-string reference / too many references)', () => {
    expect(envelope({ kind: 'create', id: 'c', input: { title: 't', description: '', prompt: 'p', handover: { ...HANDOVER, sneaky: 1 } } })).toBeUndefined()
    expect(envelope({ kind: 'create', id: 'c', input: { title: 't', description: '', prompt: 'p', handover: { ...HANDOVER, references: [7] } } })).toBeUndefined()
    expect(envelope({ kind: 'create', id: 'c', input: { title: 't', description: '', prompt: 'p', handover: { ...HANDOVER, references: Array.from({ length: 33 }, (_, i) => `ref-${i}`) } } })).toBeUndefined()
  })

  it('accepts an update patch attaching or clearing a handover (null clears)', () => {
    const attached = envelope({ kind: 'update', taskId: 'task-1', patch: { handover: HANDOVER } })
    expect(attached?.action.kind).toBe('update')
    const cleared = envelope({ kind: 'update', taskId: 'task-1', patch: { handover: null } })
    expect(cleared?.action.kind).toBe('update')
  })

  it('parses the confirm-permission action and rejects malformed variants', () => {
    expect(envelope({ kind: 'confirm-permission', taskId: 'task-1' })?.action.kind).toBe('confirm-permission')
    expect(envelope({ kind: 'confirm-permission' })).toBeUndefined()
    expect(envelope({ kind: 'confirm-permission', taskId: 'task-1', extra: true })).toBeUndefined()
  })
})

describe('handover bundle: use cases stamp and re-arm the confirmation', () => {
  it('createTask stamps the handover with bundledAt', () => {
    const task = createTask({ title: 't', description: '', prompt: 'p', handover: HANDOVER }, NOW, 'id-1')
    expect(task.handover).toBeDefined()
    expect(task.handover?.bundledAt).toBe(NOW)
    expect(task.handover?.permission).toBe('danger-full-access')
  })

  it('a permission or handover change clears an existing confirmation (re-arm)', () => {
    const base = { ...createTask({ title: 't', description: '', prompt: 'p', permission: 'workspace-write' }, NOW, 'id-1'), permissionConfirmedAt: NOW }
    const byPermission = applyUpdateTask([base], 'id-1', { permission: 'danger-full-access' }, NOW + 1)
    expect(byPermission[0].permissionConfirmedAt).toBeUndefined()
    const byHandover = applyUpdateTask([base], 'id-1', { handover: HANDOVER }, NOW + 1)
    expect(byHandover[0].permissionConfirmedAt).toBeUndefined()
    const untouched = applyUpdateTask([base], 'id-1', { title: '新标题' }, NOW + 1)
    expect(untouched[0].permissionConfirmedAt).toBe(NOW)
  })

  it('attaching via update persists the bundle and null clears it', () => {
    const base = createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'id-1')
    const attached = applyUpdateTask([base], 'id-1', { handover: HANDOVER }, NOW + 1)
    expect(attached[0].handover?.workspaceId).toBe('ws-1')
    expect(attached[0].handover?.bundledAt).toBe(NOW + 1)
    const cleared = applyUpdateTask(attached, 'id-1', { handover: null }, NOW + 2)
    expect(cleared[0].handover).toBeUndefined()
  })
})

describe('handover bundle: store and ledger parsing', () => {
  it('drops a malformed handover or confirmation stamp on legacy ledger load', () => {
    const row = JSON.stringify([{ ...createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'id-1'), handover: { bad: 1 }, permissionConfirmedAt: 'bad' }])
    const [task] = parseLedger(row)
    expect(task).toBeDefined()
    expect(task.handover).toBeUndefined()
    expect(task.permissionConfirmedAt).toBeUndefined()
  })

  it('keeps a well-formed handover and confirmation stamp through the round trip', () => {
    const row = JSON.stringify([{ ...createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'id-1'), handover: { ...HANDOVER, bundledAt: NOW }, permissionConfirmedAt: NOW + 5 }])
    const [task] = parseLedger(row)
    expect(task.handover?.references).toHaveLength(2)
    expect(task.permissionConfirmedAt).toBe(NOW + 5)
  })
})

function makeGateway(createSpy = vi.fn(async (_req?: unknown) => ({ sessionId: 'session-1' })), promptSpy = vi.fn(async (_req?: unknown) => ({ accepted: true }))) {
  const invoke = vi.fn(async ({ namespace, method, args }: { namespace: string; method: string; args: Record<string, unknown> }) => {
    if (namespace === 'workspace' && method === 'list') return { items: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-legacy' }] }
    if (namespace === 'agentPresets' && method === 'list') return { presets: [{ id: 'preset-a' }, { id: 'preset-legacy' }] }
    if (namespace === 'session' && method === 'create') return createSpy(args.request)
    if (namespace === 'session' && method === 'rename') return { title: 't', seq: 1 }
    if (namespace === 'session' && method === 'prompt') return promptSpy(args.request)
    return {}
  })
  return { gateway: { invoke } as unknown as TypertGateway, invoke, create: createSpy, prompt: promptSpy }
}

function makeService(ledger: HostTaskLedger, now: () => number) {
  const { gateway, create, prompt } = makeGateway()
  const service = new TaskBoardHostService(gateway, { ledger, power: new PowerInhibitor({ platform: 'linux' }), now })
  return { service, create, prompt }
}

describe('confirmation gate: unconfirmed high-permission binding refuses execution', () => {
  it('manual run on an unconfirmed card is rejected and opens no execution', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('req-create', { kind: 'create', id: 'card', input: { title: '高权卡', description: '', prompt: 'p', handover: HANDOVER } })
    const { service } = makeService(ledger, () => NOW)
    expect(() => service.apply('req-run', { kind: 'run', taskId: 'card' })).toThrow(/confirmation-required/)
    expect(ledger.state().tasks[0].executions).toEqual([])
    expect(ledger.state().tasks[0].status).toBe('todo')
    service.dispose()
  })

  it('after confirm-permission the same run executes', async () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('req-create', { kind: 'create', id: 'card', input: { title: '高权卡', description: '', prompt: 'p', handover: HANDOVER } })
    const { service, create } = makeService(ledger, () => NOW)
    service.apply('req-confirm', { kind: 'confirm-permission', taskId: 'card' })
    expect(ledger.state().tasks[0].permissionConfirmedAt).toBe(NOW)
    service.apply('req-run', { kind: 'run', taskId: 'card' })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(create).toHaveBeenCalledOnce()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    service.dispose()
  })

  it('a card at or below the session default runs without confirmation', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { sessionDefaultPermission: 'workspace-write' })
    ledger.applyRequest('req-create', { kind: 'create', id: 'card', input: { title: '平权卡', description: '', prompt: 'p', handover: { ...HANDOVER, permission: 'workspace-write' } } })
    const { service } = makeService(ledger, () => NOW)
    expect(() => service.apply('req-run', { kind: 'run', taskId: 'card' })).not.toThrow()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    service.dispose()
  })
})

describe('handover bundle: runner override and prompt preamble', () => {
  function apiCapture() {
    const calls: { create: unknown; prompt: unknown } = { create: undefined, prompt: undefined }
    const create = vi.fn(async (request: unknown) => { calls.create = request; return { sessionId: 'session-1' } })
    const prompt = vi.fn(async (request: unknown) => { calls.prompt = request; return { accepted: true } })
    const { gateway } = makeGateway(create, prompt)
    return { gateway, calls }
  }

  it('the bundle triplet overrides the legacy pins and the prompt carries the reference preamble', async () => {
    const { gateway, calls } = apiCapture()
    const task = {
      ...createTask({ title: '交接卡', description: '', prompt: '正文', workspaceId: 'ws-legacy', mode: 'preset-legacy' }, NOW, 'id-1'),
      handover: { ...HANDOVER, bundledAt: NOW },
    }
    const dispatched: string[] = []
    const runnerWithPermission = new HostExecutionRunner(gateway, {
      execute: async (_sessionId, line) => { dispatched.push(line); return { kind: 'success', text: 'ok' } as const },
    })
    await runnerWithPermission.launch(task)
    expect(dispatched).toEqual(['/permission danger-full-access'])
    expect(calls.create).toMatchObject({ workspaceId: 'ws-1', agentPreset: 'preset-a' })
    const text = (calls.prompt as { content: Array<{ text: string }> }).content[0].text
    expect(text).toContain('docs/handover.md')
    expect(text).toContain('scripts/rebuild.sh')
    expect(text).toContain('正文')
  })

  it('a card without a bundle keeps the legacy pin behavior and plain prompt', async () => {
    const { gateway, calls } = apiCapture()
    const runner = new HostExecutionRunner(gateway)
    await runner.launch(createTask({ title: '普通卡', description: '', prompt: '正文', workspaceId: 'ws-legacy', mode: 'preset-legacy' }, NOW, 'id-2'))
    expect(calls.create).toMatchObject({ workspaceId: 'ws-legacy', agentPreset: 'preset-legacy' })
    expect((calls.prompt as { content: Array<{ text: string }> }).content[0].text).toBe('正文')
  })
})

describe('confirmation gate: cron refuses unconfirmed cards', () => {
  it('a due schedule on an unconfirmed card does not launch and rolls forward', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(tempRoot(), () => now)
    ledger.applyRequest('req-create', {
      kind: 'create', id: 'card',
      input: { title: '定时高权卡', description: '', prompt: 'p', handover: HANDOVER, schedule: { enabled: true, cron: '* * * * *' } },
    })
    const { service, create } = makeService(ledger, () => now)
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await (service as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(false)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(create).not.toHaveBeenCalled()
    expect(ledger.state().tasks[0].executions).toEqual([])
    expect(ledger.state().tasks[0].schedule?.nextRunAt).toBe(new Date(2026, 7, 16, 10, 2, 0).getTime())
    service.dispose()
  })

  it('after confirmation the next due occurrence launches', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(tempRoot(), () => now)
    ledger.applyRequest('req-create', {
      kind: 'create', id: 'card',
      input: { title: '定时高权卡', description: '', prompt: 'p', handover: HANDOVER, schedule: { enabled: true, cron: '* * * * *' } },
    })
    ledger.applyRequest('req-confirm', { kind: 'confirm-permission', taskId: 'card' })
    const { service, create } = makeService(ledger, () => now)
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await (service as unknown as { tickSchedule(first: boolean): Promise<void> }).tickSchedule(false)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(create).toHaveBeenCalledOnce()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    service.dispose()
  })
})
