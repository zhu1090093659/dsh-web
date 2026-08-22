import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { loadPetPersist } from '../src/persist.ts'
import { PetService } from '../src/service.ts'
import { resolvePetManifest, type DecorationEntry, type PetRegistry } from '../src/registry.ts'
import { normalizeVoicePack } from '../src/voice-pack.ts'
import { parseDecorationManifest } from '../src/decoration.ts'
import { PET_DECORATION_API_VERSION } from '../src/contracts/status-decoration.ts'

/** Two-pet registry fixture (whale-girl + otter) for selection/name tests. */
function fixtureRegistry(): PetRegistry {
  const warnings: string[] = []
  const whale = resolvePetManifest({
    id: 'whale-girl',
    displayName: '鲸鱼娘',
    spritesheetPath: 'spritesheet.webp',
  }, join(tmpdir(), 'whale'), { warnings })
  const otter = resolvePetManifest({
    id: 'otter',
    displayName: '水獭',
    spritesheetPath: 'spritesheet.webp',
    remarks: { pet: '水獭专属摸头台词' },
  }, join(tmpdir(), 'otter'), { warnings })
  const entries = [whale!, otter!]
  return {
    entries,
    warnings,
    diagnostics: [],
    byId: id => entries.find(entry => entry.id === id),
    defaultEntry: () => entries[0]!,
  }
}

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

/** A session the host classifies as a subagent child (see SessionHeader). */
function makeSubagentSession(id: string, parentId: string): Session {
  return {
    id,
    header: {
      version: 0,
      id,
      createdAt: 0,
      parentSession: parentId,
      origin: 'subagent',
      delegationDepth: 1,
    },
  } as unknown as Session
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
      expect(await service.state()).toMatchObject({ animation: 'idle', phase: 'idle', sessionActive: false })
      expect((await service.state()).affinity.turns).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not restore in-flight activity whose terminal event was missed while disabled', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('stale')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', session, toolCall(1, 1, 'call-stale', 'shell', 1))
      expect(await service.state()).toMatchObject({
        animation: 'running-right',
        bubble: '正在使用 shell',
        sessionActive: true,
      })

      service.setEnabled(false)
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 2))
      service.setEnabled(true)

      const reopened = await service.state()
      expect(reopened).toMatchObject({ animation: 'idle', phase: 'idle', sessionActive: false })
      expect(reopened.bubble).toBeUndefined()
      expect(reopened.sessions).toEqual([])
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

  it('whispers an inner line woken by the model output, then expires it', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      // A reasoning chunk whose text matches the error mood wakes a whisper
      // while the status bubble reports the scene as usual.
      ctx.emit('session/event', session, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: '这里有个错误要修',
      }, 1))
      const view = await service.state()
      expect(view.bubble).toBe('正在思考')
      expect(view.whisper).toBe('哎呀，踩到小石子了')

      // The cooldown keeps a second keyword hit quiet right after.
      ctx.emit('session/event', session, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: '又一个错误',
      }, 2))
      expect((await service.state()).whisper).toBe('哎呀，踩到小石子了')

      // Past the TTL the whisper leaves the view.
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8100)
      try {
        expect((await service.state()).whisper).toBeUndefined()
      } finally {
        clock.mockRestore()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stays silent when the model output carries no whisper trigger', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', session, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: '嗯',
      }, 1))
      const view = await service.state()
      expect(view.bubble).toBe('正在思考')
      expect(view.whisper).toBeUndefined()
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
      // The failure voice rotates round-robin: the second tool failure in
      // one session speaks the pool's next line instead of repeating.
      expect(await service.state()).toMatchObject({
        animation: 'failed',
        bubble: '工具闹脾气了，哄哄它',
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

  it('renders concurrent sessions as separate bubbles, most recent first', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const sessionA = makeSession('s-a')
    const sessionB = makeSession('s-b')
    try {
      const service = new PetService(ctx, { persistDir: dir })

      ctx.emit('session/event', sessionA, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: 'A',
      }, 1))
      ctx.emit('session/event', sessionB, toolCall(1, 1, 'call-b', 'search', 1))

      let view = await service.state()
      expect(view).toMatchObject({ animation: 'running-right', bubble: '正在使用 search' })
      expect(view.sessions).toEqual([
        { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 search' },
        { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
      ])

      // A new event on A moves A to the top of the stack.
      ctx.emit('session/event', sessionA, assistantChunk(1, 1, {
        type: 'text-delta', index: 0, text: 'A',
      }, 2))
      view = await service.state()
      expect(view.sessions?.map(session => session.sessionId)).toEqual(['s-a', 's-b'])

      // Disposing B removes only B's bubble.
      ctx.emit('session/disposed', sessionB)
      view = await service.state()
      expect(view.sessions).toEqual([
        { sessionId: 's-a', animation: 'review', phase: 'review', bubble: '整理回复中' },
      ])

      ctx.emit('session/disposed', sessionA)
      view = await service.state()
      expect(view.sessions).toEqual([])
      expect(view).toMatchObject({ animation: 'idle', sessionActive: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps subagent sessions out of the bubble stack while they still drive the display', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const sessionA = makeSession('s-a')
    const sessionB = makeSession('s-b')
    const child = makeSubagentSession('s-child', 's-b')
    try {
      const service = new PetService(ctx, { persistDir: dir })

      ctx.emit('session/event', sessionA, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: 'A',
      }, 1))
      ctx.emit('session/event', sessionB, toolCall(1, 1, 'call-b', 'search', 1))
      // The subagent's activity is the most recent meaningful event: the
      // sprite follows it, but it must not occupy its own bubble.
      ctx.emit('session/event', child, toolCall(1, 1, 'call-c', 'run_code', 1))

      const view = await service.state()
      expect(view).toMatchObject({ animation: 'running-right', bubble: '正在使用 run_code' })
      expect(view.sessions).toEqual([
        { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 search' },
        { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
      ])
      expect(view.sessions?.some(entry => entry.sessionId === 's-child')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the single display bubble when only subagent sessions are active', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const child = makeSubagentSession('s-child', 's-parent')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', child, toolCall(1, 1, 'call-c', 'run_code', 1))

      const view = await service.state()
      // No top-level session: the stack is empty and the subagent's work is
      // reported through the legacy single bubble instead.
      expect(view.sessions ?? []).toEqual([])
      expect(view).toMatchObject({ animation: 'running-right', bubble: '正在使用 run_code' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the most recent remaining session when the display session is disposed', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const sessionA = makeSession('s-a')
    const sessionB = makeSession('s-b')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', sessionA, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: 'A',
      }, 1))
      ctx.emit('session/event', sessionB, toolCall(1, 1, 'call-b', 'search', 1))
      expect(await service.state()).toMatchObject({ animation: 'running-right' })

      // The display session (B) is disposed: the sprite replays A's last
      // input instead of resetting while A is still working.
      ctx.emit('session/disposed', sessionB)
      const view = await service.state()
      expect(view).toMatchObject({ animation: 'running', bubble: '正在思考', sessionActive: true })
      expect(view.sessions).toEqual([
        { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('caps simultaneous session bubbles at MAX_SESSION_BUBBLES, dropping the oldest', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      for (let index = 0; index < 14; index++) {
        const session = makeSession('s-' + index)
        ctx.emit('session/event', session, toolCall(1, 1, 'call-' + index, 'shell', index + 1))
      }
      const view = await service.state()
      expect(view.sessions?.length).toBe(12)
      expect(view.sessions?.some(entry => entry.sessionId === 's-0')).toBe(false)
      expect(view.sessions?.some(entry => entry.sessionId === 's-1')).toBe(false)
      expect(view.sessions?.[0]?.sessionId).toBe('s-13')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("speaks the selected pet's custom remarks and falls back to built-ins per slot", async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      // The otter's custom pet line replaces only its own slot.
      await service.setPetId('otter')
      const otterPet = await service.interact('pet')
      expect(otterPet.reaction).toBe('水獭专属摸头台词')
      // Slots the otter does not declare keep the built-in pools.
      const otterFeed = await service.interact('feed')
      expect(otterFeed.reaction).toBe('没有小鱼干了，多陪我工作一会儿吧～')

      // whale-girl declares no remarks: fully built-in. The pet cooldown
      // still gates across pets (the affinity ledger is shared).
      await service.setPetId('whale-girl')
      const whalePet = await service.interact('pet')
      expect(whalePet.reaction).toBe('摸过头啦，让鲸鱼娘歇口气～')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('evicts ledger bookkeeping when a session is disposed so a reused id re-awards', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const sessionA = makeSession('reuse')
    const sessionB = makeSession('reuse')
    try {
      const service = new PetService(ctx, { persistDir: dir })

      ctx.emit('session/event', sessionA, turnEnd(1, { kind: 'completed' }, 1))
      expect((await service.state()).affinity.turns).toBe(1)

      ctx.emit('session/disposed', sessionA)
      // The disposed listener evicts the per-session bookkeeping, so a fresh
      // session carrying the same id is treated as a new lifecycle and a
      // replayed turn is awarded again instead of being deduplicated.
      ctx.emit('session/event', sessionB, turnEnd(1, { kind: 'completed' }, 2))
      expect((await service.state()).affinity.turns).toBe(2)
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
      // A stopped session settles to idle without any bubble or stack entry.
      expect(view).toMatchObject({ animation: 'idle' })
      expect(view.bubble).toBeUndefined()
      expect(view.sessions ?? []).toEqual([])
      expect(view.affinity.turns).toBe(0)
      expect(view.treats.stocked).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops the bubble of a stopped session while concurrent sessions keep theirs', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const sessionA = makeSession('s-a')
    const sessionB = makeSession('s-b')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', sessionA, toolCall(1, 1, 'call-a', 'grep', 1))
      ctx.emit('session/event', sessionB, toolCall(1, 1, 'call-b', 'shell', 1))
      ctx.emit('session/event', sessionA, turnEnd(1, {
        kind: 'aborted', reason: { kind: 'user' },
      }, 2))
      const view = await service.state()
      // The stopped session leaves no bubble; B keeps reporting its tool work.
      expect(view.sessions).toEqual([
        { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 shell' },
      ])
      // The stopped session was the latest event, so the sprite settles to
      // idle while B's bubble stays in the stack.
      expect(view).toMatchObject({ animation: 'idle' })
      expect(view.bubble).toBeUndefined()
      expect(view.affinity.turns).toBe(0)
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

  it('expires failed session bubbles while other sessions remain active', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const failed = makeSession('failed')
    const active = makeSession('active')
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', failed, turnEnd(1, {
        kind: 'error', error: { message: 'boom', code: 'UNKNOWN' },
      }, 1))
      ctx.emit('session/event', active, toolCall(1, 1, 'call-active', 'search', 2))
      expect((await service.state()).sessions).toEqual([
        { sessionId: 'active', animation: 'running-right', phase: 'tool', bubble: '正在使用 search' },
        { sessionId: 'failed', animation: 'failed', phase: 'failed', bubble: '执行失败' },
      ])

      vi.advanceTimersByTime(2400)
      const view = await service.state()
      expect(view).toMatchObject({ animation: 'running-right', bubble: '正在使用 search' })
      expect(view.sessions).toEqual([
        { sessionId: 'active', animation: 'running-right', phase: 'tool', bubble: '正在使用 search' },
      ])
    } finally {
      vi.useRealTimers()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts each completed turn once and grants a work treat per 30 turns', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      for (let turn = 1; turn <= 30; turn++) {
        ctx.emit('session/event', session, turnEnd(turn, { kind: 'completed' }, turn))
      }
      // A duplicate delivery of turn 30 must not double count.
      ctx.emit('session/event', session, turnEnd(30, { kind: 'completed' }, 31))
      const view = await service.state()
      expect(view.affinity.turns).toBe(30)
      expect(view.affinity.points).toBe(30)
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

  it('keeps official reward deduplication across an enable toggle', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('toggle-dedup')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 1))
      expect((await service.state()).affinity.turns).toBe(1)

      service.setEnabled(false)
      service.setEnabled(true)
      ctx.emit('session/event', session, activity('done', 2, '完成啦'))

      expect((await service.state()).affinity.turns).toBe(1)
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
      for (let turn = 1; turn <= 30; turn++) {
        ctx.emit('session/event', session, turnEnd(turn, { kind: 'completed' }, turn))
      }
      const first = await service.interact('feed')
      expect(first.delta).toBe(5)
      expect(first.affinity.feeds).toBe(1)
      expect(first.affinity.points).toBe(35) // 30 turns (1 point each) + 5 feed points
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

  it('does not settle or write on a read-only state() call (settle removed from view)', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      expect(existsSync(join(dir, 'pet.json'))).toBe(false)
      await service.state()
      // Reads must not settle the economy nor write pet.json: settlement
      // moved to explicit economic events (turn rewards and feeds).
      expect(existsSync(join(dir, 'pet.json'))).toBe(false)
      expect(loadPetPersist(dir).treats.lastTreatGrantAt).toBe(0)
      // A repeated read is still a no-op.
      await service.state()
      expect(existsSync(join(dir, 'pet.json'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('settles the economy on the explicit turn-reward path and writes the anchor', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, { persistDir: dir })
      expect(existsSync(join(dir, 'pet.json'))).toBe(false)
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 1))
      // The completed-turn reward is an explicit economic event: it settles
      // (starting the idle clock) and persists to disk.
      expect(existsSync(join(dir, 'pet.json'))).toBe(true)
      expect(loadPetPersist(dir).treats.lastTreatGrantAt).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports the selected pet identity and the registry list', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      const view = await service.state()
      expect(view.pet.id).toBe('whale-girl')
      expect(view.pet.displayName).toBe('鲸鱼娘')
      expect(view.name).toBe('鲸鱼娘')
      const pets = await service.pets()
      expect(pets.map(entry => entry.id)).toEqual(['whale-girl', 'otter'])
      expect(pets[0]!.atlasUrl).toBe('/pet/whale-girl/spritesheet.webp')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('switches pets and keeps an independent name per pet', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      expect((await service.setName('小鲸')).ok).toBe(true)
      expect((await service.state()).name).toBe('小鲸')

      expect((await service.setPetId('otter')).ok).toBe(true)
      expect((await service.state()).pet.id).toBe('otter')
      // The new pet falls back to its manifest displayName until renamed.
      expect((await service.state()).name).toBe('水獭')

      expect((await service.setName('阿獭')).ok).toBe(true)
      expect((await service.setPetId('whale-girl')).ok).toBe(true)
      expect((await service.state()).name).toBe('小鲸')
      expect((await service.setPetId('otter')).ok).toBe(true)
      expect((await service.state()).name).toBe('阿獭')

      expect(loadPetPersist(dir)).toMatchObject({
        petId: 'otter',
        names: { 'whale-girl': '小鲸', otter: '阿獭' },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to switch to an unknown pet', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      const result = await service.setPetId('dragon')
      expect(result.ok).toBe(false)
      expect((await service.state()).pet.id).toBe('whale-girl')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies a settings section that selects another pet', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      service.applySettingsSection({
        petId: 'otter',
        visible: true,
        size: 160,
        right: 24,
        bottom: 20,
      })
      expect((await service.state()).pet.id).toBe('otter')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the default pet when the persisted selection is unknown', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({ petId: 'gone', display: { visible: true, size: 160, right: 24, bottom: 20 } }), 'utf8')
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      expect((await service.state()).pet.id).toBe('whale-girl')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates the legacy flat name onto the selected pet', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({ name: '泡泡' }), 'utf8')
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      expect((await service.state()).name).toBe('泡泡')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects whitespace-only renames without persisting them', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: fixtureRegistry() })
      const result = await service.setName('   ')
      expect(result.ok).toBe(false)
      expect(service.petName()).toBe('鲸鱼娘')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('voice packs in PetService (pet-center M4, issue #677)', () => {
  function voicedRegistry(petId: string, pack: unknown, extra?: Partial<PetRegistry>): PetRegistry {
    const warnings: string[] = []
    const base = resolvePetManifest({
      id: petId,
      displayName: petId,
      spritesheetPath: 'spritesheet.webp',
    }, join(tmpdir(), petId), { warnings })
    const entry = { ...base!, voice: normalizeVoicePack(pack) }
    const entries = [entry]
    return {
      entries,
      warnings,
      diagnostics: [],
      byId: id => entries.find(e => e.id === id),
      defaultEntry: () => entries[0]!,
      ...extra,
    }
  }

  it('speaks the selected pet pack for status scenes', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, {
        persistDir: dir,
        registry: voicedRegistry('talker', { status: { prepare: ['自定义开工'], done: ['自定义完工'] } }),
      })
      ctx.emit('session/event', session, turnStart(1, 1))
      expect(await service.state()).toMatchObject({ bubble: '自定义开工' })
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 2))
      expect(await service.state()).toMatchObject({ bubble: '自定义完工' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('re-voices a live session when the pet switches', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const warnings: string[] = []
      const otter = resolvePetManifest({
        id: 'otter',
        displayName: '水獭',
        spritesheetPath: 'spritesheet.webp',
      }, join(tmpdir(), 'otter'), { warnings })
      const talker = voicedRegistry('talker', { status: { done: ['自定义完工'] } })
      const entries = [...talker.entries, otter!]
      const registry: PetRegistry = {
        entries,
        warnings: [],
        diagnostics: [],
        byId: id => entries.find(entry => entry.id === id),
        defaultEntry: () => entries[0]!,
      }
      const service = new PetService(ctx, { persistDir: dir, registry })
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 1))
      expect(await service.state()).toMatchObject({ bubble: '自定义完工' })
      await service.setPetId('otter')
      // A new session's runtime resolves the provider against the now-
      // selected otter (no pack) and draws the built-in pool.
      const other = makeSession('s2')
      ctx.emit('session/event', other, turnEnd(2, { kind: 'completed' }, 2))
      expect(await service.state()).toMatchObject({ bubble: '完成啦' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the global override when the pet carries no pack', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const registry = voicedRegistry('plain', undefined, {
        globalVoice: normalizeVoicePack({ status: { done: ['全局完工'] } }),
      })
      const service = new PetService(ctx, { persistDir: dir, registry })
      ctx.emit('session/event', session, turnEnd(1, { kind: 'completed' }, 1))
      expect(await service.state()).toMatchObject({ bubble: '全局完工' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serves the global panel chrome on the pets list (pet over global, per slot)', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const registry = voicedRegistry('plain', { panel: { labels: { feed: '宠物投喂' } } }, {
        globalVoice: normalizeVoicePack({ panel: { labels: { feed: '全局投喂', hide: '全局藏' } } }),
      })
      const service = new PetService(ctx, { persistDir: dir, registry })
      const pets = await service.pets()
      const plain = pets.find(pet => pet.id === 'plain')
      expect(plain).toBeDefined()
      expect(plain!.panel?.labels).toEqual({ feed: '宠物投喂', hide: '全局藏' })
      // A pack-less pet receives the global panel as-is.
      const registryBare = voicedRegistry('bare', undefined, {
        globalVoice: normalizeVoicePack({ panel: { labels: { hide: '全局藏' } } }),
      })
      const ctxBare = new Context()
      const serviceBare = new PetService(ctxBare, { persistDir: join(dir, 'bare'), registry: registryBare })
      const bare = (await serviceBare.pets()).find(pet => pet.id === 'bare')
      expect(bare!.panel?.labels).toEqual({ hide: '全局藏' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('wakes a whisper from the pet pack keyword rules', async () => {
    const ctx = new Context()
    const dir = tempDir()
    const session = makeSession('s1')
    try {
      const service = new PetService(ctx, {
        persistDir: dir,
        registry: voicedRegistry('talker', {
          whispers: { rules: [{ keywords: ['测试通过'], pool: ['自定义全绿'] }] },
        }),
      })
      ctx.emit('session/event', session, assistantChunk(1, 1, {
        type: 'reasoning-delta', index: 0, text: '测试通过',
      }, 1))
      expect((await service.state()).whisper).toBe('自定义全绿')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
describe('status decorations in PetService (pet-center M5, #567)', () => {
  function decorationRegistry(): PetRegistry {
    const warnings: string[] = []
    const whale = resolvePetManifest({
      id: 'whale-girl',
      displayName: '鲸鱼娘',
      spritesheetPath: 'spritesheet.webp',
    }, join(tmpdir(), 'whale'), { warnings })
    const verdict = parseDecorationManifest({
      decorationManifestVersion: 1,
      id: 'whale',
      license: 'MIT',
      entry: 'whale-frames.png',
      cell: { width: 64, height: 48 },
      columns: 4,
      phases: { idle: 'hide', thinking: { from: 0, to: 3 } },
    }, 'whale/decoration.json')
    if (!verdict.ok) throw new Error('fixture decoration must parse')
    const manifest = verdict.manifest
    const entry: DecorationEntry = {
      apiVersion: PET_DECORATION_API_VERSION,
      id: manifest.id,
      dir: join(tmpdir(), 'whale'),
      entryPath: manifest.entry,
      servable: ['decoration.json', manifest.entry],
      license: manifest.license,
      assetBase: '/api/pet/decoration/whale',
      entryUrl: '/api/pet/decoration/whale/whale-frames.png',
      cell: manifest.cell,
      columns: manifest.columns,
      durations: manifest.durations,
      loop: manifest.loop,
      phases: manifest.phases,
    }
    const entries = [whale!]
    return {
      entries,
      warnings,
      diagnostics: [],
      byId: id => entries.find(e => e.id === id),
      defaultEntry: () => entries[0]!,
      decorations: [entry],
      decorationById: id => (id === 'whale' ? entry : undefined),
    }
  }

  it('serves the active decoration block by default', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: decorationRegistry() })
      const view = await service.state()
      expect(view.decoration?.id).toBe('whale')
      expect(view.decoration?.entryUrl).toBe('/api/pet/decoration/whale/whale-frames.png')
      expect(view.decoration?.phases.thinking).toEqual({ from: 0, to: 3 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('hides the decoration when the config switch is off', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: decorationRegistry(), decorationEnabled: false })
      expect((await service.state()).decoration).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('mirrors the settings-section switch', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir, registry: decorationRegistry() })
      service.applySettingsSection({
        visible: true,
        size: 160,
        right: 24,
        bottom: 120,
        petId: 'whale-girl',
        decorationEnabled: false,
      })
      expect((await service.state()).decoration).toBeUndefined()
      service.applySettingsSection({
        visible: true,
        size: 160,
        right: 24,
        bottom: 120,
        petId: 'whale-girl',
        decorationEnabled: true,
      })
      expect((await service.state()).decoration?.id).toBe('whale')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
