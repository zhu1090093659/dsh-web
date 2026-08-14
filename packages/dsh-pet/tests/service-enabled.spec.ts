import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { loadPetPersist } from '../src/persist.ts'
import { PetService } from '../src/service.ts'

// The former working-activity plugin extended the mergeable event map. Keep
// that external declaration test-only so dsh-pet itself does not claim the
// compatibility event as part of the current durable session vocabulary.
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'activity/status': {
      phase: string
      line?: string
      phrase?: string
    }
  }
}

type AssistantChunk = SessionEvent<'assistant/chunk'>['data']['chunk']
type AssistantMessage = SessionEvent<'assistant/message'>['data']['message']
type ToolCallId = SessionEvent<'tool/call'>['data']['callId']
type ToolResultMessage = SessionEvent<'tool/result'>['data']['message']
type ToolResultError = NonNullable<SessionEvent<'tool/result'>['data']['error']>

function makeSession(id: string): Session {
  return { id } as unknown as Session
}

function callId(value: string): ToolCallId {
  return value as ToolCallId
}

function messageId(value: string): ToolResultMessage['id'] {
  return value as ToolResultMessage['id']
}

function turnStart(turn: number, seq: number): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq, time: seq, data: { turn } }
}

function stepStart(turn: number, step: number, seq: number): SessionEvent<'step/start'> {
  return { type: 'step/start', seq, time: seq, data: { turn, step } }
}

function assistantChunk(
  turn: number,
  step: number,
  chunk: AssistantChunk,
  seq: number,
): SessionEvent<'assistant/chunk'> {
  return { type: 'assistant/chunk', seq, time: seq, data: { turn, step, chunk } }
}

function assistantMessage(
  turn: number,
  step: number,
  text: string,
  seq: number,
): SessionEvent<'assistant/message'> {
  const message: AssistantMessage = {
    id: messageId(`message-${seq}`),
    role: 'assistant',
    source: { kind: 'model', provider: 'mock', model: 'mock' },
    content: [{ type: 'text', text }],
  }
  return { type: 'assistant/message', seq, time: seq, data: { turn, step, message } }
}

function toolCall(
  turn: number,
  step: number,
  id: string,
  name: string,
  seq: number,
): SessionEvent<'tool/call'> {
  return {
    type: 'tool/call',
    seq,
    time: seq,
    data: { turn, step, callId: callId(id), name, arguments: '{}' },
  }
}

function toolResult(
  turn: number,
  step: number,
  id: string,
  seq: number,
  isError = false,
  error?: ToolResultError,
): SessionEvent<'tool/result'> {
  const correlatedId = callId(id)
  return {
    type: 'tool/result',
    seq,
    time: seq,
    data: {
      turn,
      step,
      message: {
        id: messageId(`message-${seq}`),
        role: 'user',
        source: { kind: 'tool', callId: correlatedId },
        content: [{
          type: 'tool-result',
          toolCallId: correlatedId,
          content: [{ type: 'text', text: isError ? 'failed' : 'ok' }],
          isError,
        }],
      },
      ...(error === undefined ? {} : { error }),
    },
  }
}

function turnEnd(
  turn: number,
  reason: TurnEndReason,
  seq: number,
): SessionEvent<'turn/end'> {
  return { type: 'turn/end', seq, time: seq, data: { turn, reason } }
}

function activity(
  phase: string,
  seq: number,
  line?: string,
): SessionEvent<'activity/status'> {
  return {
    type: 'activity/status',
    seq,
    time: seq,
    data: { phase, ...(line === undefined ? {} : { line }) },
  }
}

/** A fresh temp persistence dir per test, so tests never touch the real pet.json. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-spec-'))
}

describe('PetService (rc.6 session events)', () => {
  it('stops consuming session events while disabled and resumes on re-enable', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { enabled: false, persistDir: dir })
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 1))
      expect((await service.state()).animation).toBe('idle')
      expect((await service.state()).affinity.turns).toBe(0)

      service.setEnabled(true)
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 2))
      expect((await service.state()).animation).toBe('jumping')
      expect((await service.state()).affinity.turns).toBe(1)

      service.setEnabled(false)
      ctx.emit('session/event', session, turnEnd(2, { kind: 'completed' }, 3))
      expect((await service.state()).animation).toBe('jumping')
      expect((await service.state()).affinity.turns).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('projects the full official work sequence onto animations and bubbles', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })

      ctx.emit('session/event', session, turnStart(1, 1))
      expect(await service.state()).toMatchObject({ animation: 'waiting', bubble: '准备开始' })

      ctx.emit('session/event', session, stepStart(1, 1, 2))
      expect(await service.state()).toMatchObject({ animation: 'waiting', bubble: '等待模型响应' })

      ctx.emit('session/event', session, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: '分析',
      }, 3))
      expect(await service.state()).toMatchObject({ animation: 'running', bubble: '正在思考' })

      ctx.emit('session/event', session, assistantMessage(1, 1, '完整回复', 4))
      expect(await service.state()).toMatchObject({ animation: 'review', bubble: '整理回复中' })

      ctx.emit('session/event', session, assistantChunk(1, 1, {
        type: 'text-delta', index: 0, text: '回答',
      }, 5))
      expect(await service.state()).toMatchObject({ animation: 'review', bubble: '整理回复中' })

      ctx.emit('session/event', session, toolCall(1, 1, 'call-1', 'shell', 6))
      expect(await service.state()).toMatchObject({
        animation: 'running-right',
        bubble: '正在使用 shell',
      })

      ctx.emit('session/event', session, toolResult(1, 1, 'call-1', 7))
      expect(await service.state()).toMatchObject({ animation: 'running', bubble: '处理工具结果' })

      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 8))
      expect(await service.state()).toMatchObject({ animation: 'jumping', bubble: '完成啦' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps parallel tool activity visible and surfaces a failed result', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', session, toolCall(1, 1, 'call-1', 'shell', 1))
      ctx.emit('session/event', session, toolCall(1, 1, 'call-2', 'search', 2))

      ctx.emit('session/event', session, toolResult(1, 1, 'call-1', 3))
      expect(await service.state()).toMatchObject({
        animation: 'running-right',
        bubble: '还有 1 个工具运行中',
      })

      ctx.emit('session/event', session, toolResult(1, 1, 'call-2', 4, true))
      expect(await service.state()).toMatchObject({
        animation: 'failed',
        bubble: '工具执行失败',
      })

      ctx.emit('session/event', session, stepStart(1, 2, 5))
      ctx.emit('session/event', session, toolCall(1, 2, 'call-3', 'write', 6))
      ctx.emit('session/event', session, toolResult(1, 2, 'call-3', 7, false, {
        name: 'ToolError',
        code: 'WRITE_FAILED',
      }))
      expect(await service.state()).toMatchObject({
        animation: 'failed',
        bubble: '工具执行失败',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses the latest meaningful event for the global display and rewards every session', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const sessionA = makeSession('s-a')
    const sessionB = makeSession('s-b')
    try {
      const service = new PetService(ctx, { persistDir: dir })

      ctx.emit('session/event', sessionA, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: 'A',
      }, 1))
      expect(await service.state()).toMatchObject({ animation: 'running', bubble: '正在思考' })

      ctx.emit('session/event', sessionB, toolCall(1, 1, 'call-b', 'search', 1))
      expect(await service.state()).toMatchObject({
        animation: 'running-right',
        bubble: '正在使用 search',
      })

      ctx.emit('session/event', sessionA, assistantChunk(1, 1, {
        type: 'text-delta', index: 0, text: 'A',
      }, 2))
      expect(await service.state()).toMatchObject({ animation: 'review', bubble: '整理回复中' })

      ctx.emit('session/event', sessionB, turnEnd(1, { kind: 'completed' }, 2))
      expect(await service.state()).toMatchObject({ animation: 'jumping', bubble: '完成啦' })
      expect((await service.state()).affinity.turns).toBe(1)

      ctx.emit('session/event', sessionA, assistantChunk(1, 1, {
        type: 'text-delta', index: 0, text: 'A2',
      }, 3))
      ctx.emit('session/disposed', sessionB)
      expect(await service.state()).toMatchObject({
        animation: 'review',
        bubble: '整理回复中',
        sessionActive: true,
      })

      ctx.emit('session/event', sessionA, turnEnd(1, { kind: 'completed' }, 4))
      expect((await service.state()).affinity.turns).toBe(2)
      ctx.emit('session/disposed', sessionA)
      expect(await service.state()).toMatchObject({ animation: 'idle', sessionActive: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clears an aborted turn without rewarding it', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', session, toolCall(1, 1, 'call-1', 'grep', 1))
      ctx.emit('session/event', session, turnEnd(1, {
        kind: 'aborted', reason: { kind: 'user' },
      }, 2))
      const view = await service.state()
      expect(view).toMatchObject({ animation: 'idle', bubble: '已停止' })
      expect(view.affinity.turns).toBe(0)
      expect(view.treats.stocked).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('projects unsuccessful terminal reasons without rewarding them', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      const cases: Array<{
        reason: TurnEndReason
        expected: { animation: string; bubble: string }
      }> = [
        {
          reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } },
          expected: { animation: 'failed', bubble: '执行失败' },
        },
        {
          reason: { kind: 'max-tokens' },
          expected: { animation: 'failed', bubble: '达到输出上限' },
        },
        {
          reason: { kind: 'interrupted' },
          expected: { animation: 'failed', bubble: '执行意外中断' },
        },
        {
          reason: { kind: 'blocked' },
          expected: { animation: 'waiting', bubble: '等待继续' },
        },
      ]
      for (const [index, entry] of cases.entries()) {
        ctx.emit('session/event', session, turnEnd(index + 1, entry.reason, index + 1))
        expect(await service.state()).toMatchObject(entry.expected)
      }
      expect((await service.state()).affinity.turns).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts each completed turn once and grants a work treat per 3 turns', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 1))
      ctx.emit('session/event', session, turnEnd(2, { kind: 'completed' }, 2))
      ctx.emit('session/event', session, turnEnd(3, { kind: 'completed' }, 3))
      // A duplicate delivery of turn 3 must not double count.
      ctx.emit('session/event', session, turnEnd(3, { kind: 'completed' }, 4))
      const view = await service.state()
      expect(view.affinity.turns).toBe(3)
      expect(view.affinity.points).toBe(3)
      expect(view.treats.stocked).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps legacy activity rewards without double-counting official turns', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const legacySession = makeSession('legacy')
    const officialSession = makeSession('official')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', legacySession, activity('done', 1, '完成啦'))
      ctx.emit('session/event', legacySession, activity('done', 2, '完成啦'))
      expect((await service.state()).affinity.turns).toBe(1)

      ctx.emit('session/event', officialSession, turnStart(1, 1))
      ctx.emit('session/event', officialSession, turnEnd(1, { kind: 'completed' }, 2))
      ctx.emit('session/event', officialSession, activity('done', 3, '完成啦'))
      expect((await service.state()).affinity.turns).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('feed consumes a work treat and grants +5 affinity inside the 30s cooldown', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      for (let turn = 1; turn <= 3; turn++) {
        ctx.emit('session/event', session, turnEnd(turn, { kind: 'completed' }, turn))
      }
      const first = await service.interact('feed')
      expect(first.delta).toBe(5)
      expect(first.affinity.feeds).toBe(1)
      expect(first.affinity.points).toBe(8) // 3 turns (1 point each) + 5 feed points
      expect((await service.state()).treats.stocked).toBe(0)
      // Inside the feed cooldown the feed is refused and burns nothing.
      const second = await service.interact('feed')
      expect(second.delta).toBe(0)
      expect(second.reaction).toContain('吃饱啦')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to feed on an empty stock without burning anything', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      const res = await service.interact('feed')
      expect(res.delta).toBe(0)
      expect(res.affinity.feeds).toBe(0)
      expect(res.reaction).toContain('没有小鱼干')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists the time anchor on a zero-gain settlement (anchor deadlock)', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      expect(loadPetPersist(dir).treats.lastTreatGrantAt).toBe(0)
      // A state read settles the economy; with no turns and no elapsed time
      // it must still write the clock-start anchor.
      await service.state()
      expect(loadPetPersist(dir).treats.lastTreatGrantAt).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('trims settings names so whitespace-only values cannot persist', () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      service.applySettingsSection({
        visible: true,
        size: 160,
        right: 24,
        bottom: 20,
        name: '  鲸鱼娘  ',
      })
      expect(service.petName()).toBe('鲸鱼娘')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
