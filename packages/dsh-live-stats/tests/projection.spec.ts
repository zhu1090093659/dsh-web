import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createMessage, createToolResultMessage, createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { CallId, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { apply, inject, resolveEstimatorConfig } from '../src/index.ts'
import { createLiveTokenUsageProjectionDefinition } from '../src/projection.ts'
import type { LiveTokenUsageProjection } from '../src/projection.ts'
import {
  estimateAssistantBlockTokens,
  estimateContentTokens,
  estimateMessageTokens,
  estimateTextBlockTokens,
  estimateToolCallBlockTokens,
} from '../src/estimator.ts'

afterEach(() => { vi.useRealTimers() })

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin({ inject, apply })
  return { ctx, session: ctx.sessions.create() }
}

function projected(ctx: Context, session: Session): LiveTokenUsageProjection {
  const value = ctx.sessionProjections.snapshot(session).values.liveTokenUsage
  if (value === undefined) throw new Error('liveTokenUsage projection is absent')
  return value
}

function usageChunk(session: Session, usage: TokenUsage): number {
  return session.append('assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'usage', usage },
  }).seq
}

describe('liveTokenUsage projection', () => {
  it('resolves configurable estimation parameters and rejects invalid values', () => {
    expect(resolveEstimatorConfig({
      charsPerToken: 2,
      blockOverhead: 1,
      roleOverhead: 3,
    })).toEqual({
      charsPerToken: 2,
      blockOverhead: 1,
      roleOverhead: 3,
    })
    expect(() => resolveEstimatorConfig({ charsPerToken: 0 })).toThrow('charsPerToken')
    expect(() => resolveEstimatorConfig({ blockOverhead: 0.5 })).toThrow('blockOverhead')
    expect(() => resolveEstimatorConfig({ unknown: 1 } as never)).toThrow('unknown config key')
  })

  it('updates input, output, and TPS per chunk, then accepts provider correction', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { ctx, session } = await harness()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'abcd' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' }, system: 'abcd' },
      reason: 'initial',
    })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 14,
      outputTokens: 0,
      estimated: true,
    })

    vi.setSystemTime(2_000)
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'abcd' },
    })
    vi.setSystemTime(3_000)
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'efgh' },
    })
    expect(projected(ctx, session)).toMatchObject({
      outputTokens: 10,
      estimated: true,
      tokensPerSecond: 10,
    })

    vi.setSystemTime(4_000)
    usageChunk(session, { inputTokens: 20, outputTokens: 30, cacheReadTokens: 80 })
    expect(projected(ctx, session)).toEqual({
      uncachedInputTokens: 20,
      outputTokens: 30,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      estimated: false,
      tokensPerSecond: 15,
    })

    // Settling with a positive elapsed window keeps the rate on the last row.
    session.append('step/end', { turn: 1, step: 1 })
    expect(projected(ctx, session).tokensPerSecond).toBe(15)
  })

  it('keeps a usage-exact output exact against later output deltas', async () => {
    const { ctx, session } = await harness()
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'abcd' },
    })
    expect(projected(ctx, session)).toMatchObject({ estimated: true })

    usageChunk(session, { inputTokens: 5, outputTokens: 30 })
    expect(projected(ctx, session)).toMatchObject({ outputTokens: 30, estimated: false })

    // A trailing output delta after the exact usage must not re-estimate it.
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'extra' },
    })
    expect(projected(ctx, session)).toMatchObject({ outputTokens: 30, estimated: false })
  })

  it('keeps the last measured rate resident across rate-less steps', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { ctx, session } = await harness()
    session.append('step/start', { turn: 1, step: 1 })
    vi.setSystemTime(2_000)
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'abcd' },
    })
    vi.setSystemTime(3_000)
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'efgh' },
    })
    // 10 estimated tokens over the 1s window.
    session.append('step/end', { turn: 1, step: 1 })
    expect(projected(ctx, session).tokensPerSecond).toBe(10)

    // A new step before its first output keeps the last rate on the row.
    session.append('step/start', { turn: 2, step: 1 })
    expect(projected(ctx, session).tokensPerSecond).toBe(10)

    // A step that settles without output does not erase it either.
    session.append('step/end', { turn: 2, step: 1 })
    expect(projected(ctx, session).tokensPerSecond).toBe(10)
  })

  it('replaces same-step retry estimates and drops aborted estimates', async () => {
    const { ctx, session } = await harness()
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'discarded' },
    })
    session.append('step/end', { turn: 1, step: 1 })

    session.append('step/start', { turn: 1, step: 1 })
    const source = usageChunk(session, { inputTokens: 20, outputTokens: 5, cacheReadTokens: 80 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 80 },
    }, { surfaceOp: 'append', sourceEventSeqs: [source] })
    session.append('step/end', { turn: 1, step: 1 })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 20,
      outputTokens: 5,
      cacheReadTokens: 80,
      estimated: false,
    })

    session.append('step/start', { turn: 2, step: 1 })
    session.append('assistant/chunk', {
      turn: 2,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'partial' },
    })
    session.append('step/end', { turn: 2, step: 1 })
    session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 20,
      outputTokens: 5,
      cacheReadTokens: 80,
      estimated: false,
    })
  })

  it('prices every streaming chunk kind, including no-op deltas', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { ctx, session } = await harness()
    // A header arriving before any step only refreshes the stored header.
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' }, system: 'pre' },
      reason: 'initial',
    })
    session.append('step/start', { turn: 1, step: 1 })
    // A header arriving mid-step refreshes the input estimate.
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' }, system: 'abcd' },
      reason: 'change',
    })
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'th' },
    })
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'ink' },
    })
    // Empty deltas never create or extend blocks.
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 0, text: '' },
    })
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: '' },
    })
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'tool-call-delta', index: 1, id: 'call_1' as CallId, argumentsDelta: '' },
    })
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'tool-call-delta', index: 1, id: 'call_1' as CallId, name: 'bash', argumentsDelta: '{}' },
    })
    // A nameless continuation extends the existing tool-call block.
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'tool-call-delta', index: 1, id: 'call_1' as CallId, argumentsDelta: ' more' },
    })
    // A nameless delta on a fresh index prices with zero name characters.
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'tool-call-delta', index: 4, id: 'call_2' as CallId, argumentsDelta: 'x' },
    })
    // Block-start chunks are inert for estimation.
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    })
    // A settled block pins its exact estimate.
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'fixed' } },
    })
    // A chunk landing past a gap leaves the gap blocks unpriced.
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 3, text: 'tail' },
    })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 5,
      estimated: true,
    })
    const outputTokens = projected(ctx, session).outputTokens
    expect(outputTokens).toBeGreaterThan(0)

    // Provider usage without cache-read reporting fills the buckets from scratch.
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } },
    })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 7,
      outputTokens: 2,
      cacheReadTokens: 0,
      estimated: false,
    })

    // An assistant message without usage keeps the output-timing window open.
    vi.setSystemTime(2_000)
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'settled' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    expect(projected(ctx, session).tokensPerSecond).toBeGreaterThan(0)
  })

  it('settles zero-output steps without a rate and accepts zero-output usage', async () => {
    const { ctx, session } = await harness()
    session.append('step/start', { turn: 1, step: 1 })
    session.append('step/end', { turn: 1, step: 1 })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 0,
      outputTokens: 0,
      estimated: true,
    })
    expect(projected(ctx, session).tokensPerSecond).toBeUndefined()

    session.append('step/start', { turn: 2, step: 1 })
    usageChunk(session, { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0 })
    session.append('step/end', { turn: 2, step: 1 })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 5,
      outputTokens: 0,
      estimated: true,
    })
  })

  it('views during an active step, replacing same-step and keeping other-step estimates', async () => {
    const { ctx, session } = await harness()
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'first' },
    })
    session.append('step/end', { turn: 1, step: 1 })
    expect(projected(ctx, session).estimated).toBe(true)

    // A retry of the same step: the view replaces the settled estimate.
    session.append('step/start', { turn: 1, step: 1 })
    expect(projected(ctx, session)).toMatchObject({ estimated: true })
    session.append('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'retry' },
    })
    expect(projected(ctx, session)).toMatchObject({
      uncachedInputTokens: 0,
      estimated: true,
    })

    // A different-turn step keeps the settled totals visible underneath.
    session.append('step/start', { turn: 2, step: 1 })
    const during = projected(ctx, session)
    expect(during.estimated).toBe(true)
    expect(during.outputTokens).toBeGreaterThan(0)
  })

  it('settles an output-less assistant message without opening the timing window', async () => {
    const { ctx, session } = await harness()
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'none' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    expect(projected(ctx, session).tokensPerSecond).toBeUndefined()
    expect(projected(ctx, session)).toMatchObject({ outputTokens: 0, estimated: true })
  })

  it('prices tool results and user messages on the surface', async () => {
    const { ctx, session } = await harness()
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: 'call_1' as CallId,
        content: [{ type: 'text', text: 'abcd' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'efgh' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    // Tool result: 5 (text) + 4 (block) + 4 (role); user message: 5 + 4 (role).
    expect(projected(ctx, session).uncachedInputTokens).toBe(22)
  })

  it('replaces surface ranges and rejects invalid ranges', async () => {
    const { ctx, session } = await harness()
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const second = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'three' }],
      source: { kind: 'user' },
    }), { surfaceOp: { op: 'replace', start: first.seq, end: second.seq }, sourceEventSeqs: [first.seq, second.seq] })
    session.append('step/start', { turn: 1, step: 1 })
    // One message (5 chars → 2 + 4 + 4): the replaced pair is gone.
    expect(projected(ctx, session).uncachedInputTokens).toBe(10)

    const definition = createLiveTokenUsageProjectionDefinition(resolveEstimatorConfig({}))
    let state = definition.init()
    const append = (text: string, surfaceOp: unknown): void => {
      state = definition.apply(state, {
        type: 'user/message',
        seq: 1,
        time: 1,
        data: createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }),
        surfaceOp,
      } as unknown as SessionEvent)
    }
    append('one', 'append')
    expect(() => { append('bad', { op: 'replace', start: 5, end: 2 }) }).toThrow('invalid current range')
  })

  it('incremental output pricing matches a straight rescan on a large sparse block index space', async () => {
    const { ctx, session } = await harness()
    // The defaults the harness fold resolves from resolveEstimatorConfig({}).
    const spec = { charsPerToken: 4, blockOverhead: 4, roleOverhead: 4 }
    session.append('step/start', { turn: 1, step: 1 })

    // Reference reimplementation of the previous algorithm: a sparse array of
    // blocks rescaned at every checkpoint with the same estimator formulas.
    type RefBlock =
      | { kind: 'text'; characters: number }
      | { kind: 'reasoning'; characters: number }
      | { kind: 'tool-call'; nameCharacters: number; argumentCharacters: number }
      | { kind: 'fixed'; tokens: number }
    const refBlocks: Array<RefBlock | undefined> = []
    const refEstimate = (block: RefBlock): number => {
      switch (block.kind) {
        case 'text':
        case 'reasoning':
          return estimateTextBlockTokens(block.characters, spec)
        case 'tool-call':
          return estimateToolCallBlockTokens(block.nameCharacters, block.argumentCharacters, spec)
        case 'fixed':
          return block.tokens
      }
    }
    const refOutputTokens = (): number => {
      const tokens: number[] = []
      for (const block of refBlocks) {
        if (block === undefined) continue
        tokens.push(refEstimate(block))
      }
      return estimateAssistantBlockTokens(tokens, spec)
    }
    const refApply = (chunk: StreamChunk): void => {
      switch (chunk.type) {
        case 'text-delta': {
          if (chunk.text === '') return
          const previous = refBlocks[chunk.index]
          refBlocks[chunk.index] = {
            kind: 'text',
            characters: (previous?.kind === 'text' ? previous.characters : 0) + chunk.text.length,
          }
          return
        }
        case 'reasoning-delta': {
          if (chunk.text === '') return
          const previous = refBlocks[chunk.index]
          refBlocks[chunk.index] = {
            kind: 'reasoning',
            characters: (previous?.kind === 'reasoning' ? previous.characters : 0) + chunk.text.length,
          }
          return
        }
        case 'tool-call-delta': {
          if (chunk.name === undefined && chunk.argumentsDelta === '') return
          const previous = refBlocks[chunk.index]
          refBlocks[chunk.index] = {
            kind: 'tool-call',
            nameCharacters: chunk.name?.length ?? (previous?.kind === 'tool-call' ? previous.nameCharacters : 0),
            argumentCharacters: (previous?.kind === 'tool-call' ? previous.argumentCharacters : 0)
              + chunk.argumentsDelta.length,
          }
          return
        }
        case 'block-end':
          refBlocks[chunk.index] = { kind: 'fixed', tokens: estimateContentTokens([chunk.block], spec) }
          return
        default:
          return
      }
    }

    // Deterministic scripted mix: sparse indices up to ~2000, heavy index
    // reuse, kind switches on the same index, and every no-op delta shape.
    let seed = 0x2f6e2b1
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const textOf = (length: number): string => {
      let text = ''
      for (let i = 0; i < length; i++) text += CHARS[Math.floor(random() * CHARS.length)]
      return text
    }
    const NAMES = ['bash', 'read', 'write', 'search', 'code', 'tool']
    let lastIndex = 0
    let callId = 0
    for (let eventIndex = 0; eventIndex < 3000; eventIndex++) {
      if (random() < 0.3) lastIndex = Math.floor(random() * 2000)
      const index = lastIndex
      const roll = random()
      let chunk: StreamChunk
      if (roll < 0.3) {
        chunk = { type: 'text-delta', index, text: random() < 0.1 ? '' : textOf(1 + Math.floor(random() * 40)) }
      } else if (roll < 0.45) {
        chunk = { type: 'reasoning-delta', index, text: random() < 0.1 ? '' : textOf(1 + Math.floor(random() * 40)) }
      } else if (roll < 0.7) {
        const kind = random()
        chunk = {
          type: 'tool-call-delta',
          index,
          id: `call_${callId++}` as CallId,
          ...(kind < 0.4 ? { name: NAMES[Math.floor(random() * NAMES.length)] } : {}),
          argumentsDelta: kind >= 0.2 && kind < 0.9 ? textOf(Math.floor(random() * 50)) : '',
        }
      } else if (roll < 0.75) {
        chunk = { type: 'block-start', index, blockType: 'text' }
      } else if (roll < 0.85) {
        chunk = { type: 'block-end', index, block: { type: 'text', text: textOf(Math.floor(random() * 20)) } }
      } else {
        chunk = { type: 'finish', reason: { kind: 'stop' } }
      }
      refApply(chunk)
      session.append('assistant/chunk', { turn: 1, step: 1, chunk })
      if ((eventIndex + 1) % 500 === 0) {
        expect(projected(ctx, session).outputTokens).toBe(refOutputTokens())
      }
    }
    expect(projected(ctx, session).outputTokens).toBe(refOutputTokens())
    expect(projected(ctx, session).outputTokens).toBeGreaterThan(0)
  })

  it('keeps a stable blocks reference across in-place deltas and drops replaced surface seqs', () => {
    const spec = resolveEstimatorConfig({})
    const definition = createLiveTokenUsageProjectionDefinition(spec)
    const chunkEvent = (chunk: unknown, time: number): SessionEvent => ({
      type: 'assistant/chunk',
      time,
      data: { turn: 1, step: 1, chunk },
    } as unknown as SessionEvent)

    let state = definition.init()
    state = definition.apply(state, {
      type: 'step/start',
      time: 1,
      data: { turn: 1, step: 1 },
    } as unknown as SessionEvent)
    const active = state.active
    if (active === null) throw new Error('active step is absent')
    expect(active.pricedTokens).toBe(0)
    expect(active.pricedBlocks).toBe(0)

    // A no-op delta leaves the state reference untouched.
    const beforeNoop = state
    state = definition.apply(state, chunkEvent({ type: 'text-delta', index: 0, text: '' }, 2))
    expect(state).toBe(beforeNoop)


    // Every mutating delta rewrites its slot in place: the blocks array is
    // allocated once at step/start and never reallocated within the step, and
    // the active step object is reused rather than rebuilt per chunk. This is
    // the coalescing guard: streaming deltas stop allocating a fresh active
    // object (and copying buckets) on every event.
    const blocks = active.blocks
    state = definition.apply(state, chunkEvent({ type: 'text-delta', index: 0, text: 'first' }, 3))
    expect(state.active?.blocks).toBe(blocks)
    expect(state.active).toBe(active)
    state = definition.apply(state, chunkEvent({ type: 'text-delta', index: 0, text: 'second' }, 4))
    expect(state.active?.blocks).toBe(blocks)
    expect(state.active).toBe(active)
    state = definition.apply(state, chunkEvent({ type: 'reasoning-delta', index: 7, text: 'think' }, 5))
    expect(state.active?.blocks).toBe(blocks)
    state = definition.apply(state, chunkEvent({
      type: 'tool-call-delta', index: 7, id: 'call_1' as CallId, name: 'bash', argumentsDelta: '{}',
    }, 6))
    expect(state.active?.blocks).toBe(blocks)
    state = definition.apply(state, chunkEvent({
      type: 'block-end', index: 7, block: { type: 'text', text: 'fixed' },
    }, 7))
    expect(state.active?.blocks).toBe(blocks)
    // A kind switch on an occupied slot re-prices without recounting blocks.
    state = definition.apply(state, chunkEvent({
      type: 'tool-call-delta', index: 7, id: 'call_2' as CallId, argumentsDelta: 'x',
    }, 8))
    expect(state.active?.blocks).toBe(blocks)
    expect(state.active?.pricedBlocks).toBe(2)

    // The incremental sums still equal a full rescan with the same formulas.
    const final = state.active
    if (final === null) throw new Error('active step is absent')
    const rescan = (): number => {
      const tokens: number[] = []
      for (const block of Object.values(final.blocks)) {
        tokens.push(block.kind === 'text' || block.kind === 'reasoning'
          ? estimateTextBlockTokens(block.characters, spec)
          : block.kind === 'tool-call'
            ? estimateToolCallBlockTokens(block.nameCharacters, block.argumentCharacters, spec)
            : block.tokens)
      }
      return estimateAssistantBlockTokens(tokens, spec)
    }
    expect(final.buckets.outputTokens).toBe(rescan())
    expect(final.pricedTokens + spec.roleOverhead).toBe(rescan())

    // Surface replaces drop the replaced seqs and keep only the new entry.
    const surfaceEvent = (seq: number, text: string, surfaceOp: unknown): SessionEvent => ({
      type: 'user/message',
      seq,
      time: 1,
      data: createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }),
      surfaceOp,
    } as unknown as SessionEvent)
    state = definition.init()
    state = definition.apply(state, surfaceEvent(1, 'one', 'append'))
    state = definition.apply(state, surfaceEvent(2, 'two', 'append'))
    state = definition.apply(state, surfaceEvent(3, 'three', { op: 'replace', start: 1, end: 2 }))
    expect(Object.prototype.hasOwnProperty.call(state.surface, 1)).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(state.surface, 2)).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(state.surface, 3)).toBe(true)
    expect(state.surfaceTokens).toBe(estimateMessageTokens(
      createUserMessage({ content: [{ type: 'text', text: 'three' }], source: { kind: 'user' } }),
      spec,
    ))
    expect(() => definition.apply(state, surfaceEvent(4, 'bad', { op: 'replace', start: 5, end: 2 })))
      .toThrow('invalid current range')
    expect(() => definition.apply(state, surfaceEvent(4, 'bad', { op: 'replace', start: 3, end: 99 })))
      .toThrow('invalid current range')
  })

  it('keeps the projection state losslessly JSON-serializable across a stress stream', () => {
    const spec = resolveEstimatorConfig({})
    const definition = createLiveTokenUsageProjectionDefinition(spec)
    let state = definition.init()
    const apply = (event: SessionEvent): void => { state = definition.apply(state, event) }
    expect(() => assertLosslessJson(state)).not.toThrow()

    // Header before any step, then a step whose deltas land at a far-apart
    // index (a sparse blocks layout under the old array representation).
    apply({
      type: 'request/header',
      time: 1,
      data: { header: { config: { provider: 'mock', model: 'mock' }, system: 'abcd' }, reason: 'initial' },
    } as unknown as SessionEvent)
    apply({ type: 'step/start', time: 2, data: { turn: 1, step: 1 } } as unknown as SessionEvent)
    apply({
      type: 'assistant/chunk',
      time: 3,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 7, text: 'sparse' } },
    } as unknown as SessionEvent)
    // Mid-stream: the active step holds priced blocks.
    expect(() => assertLosslessJson(state)).not.toThrow()

    // A rate-less step settles with no measured throughput: the carried
    // tokensPerSecond must be null, never undefined.
    apply({ type: 'step/end', time: 4, data: { turn: 1, step: 1 } } as unknown as SessionEvent)
    expect(state.last?.tokensPerSecond).toBeNull()
    expect(() => assertLosslessJson(state)).not.toThrow()

    // Surface appends plus a range replace exercise the plain-object map.
    const surfaceEvent = (seq: number, text: string, surfaceOp: unknown): SessionEvent => ({
      type: 'user/message',
      seq,
      time: 5,
      data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
      surfaceOp,
    } as unknown as SessionEvent)
    apply(surfaceEvent(1, 'one', 'append'))
    apply(surfaceEvent(2, 'two', 'append'))
    apply(surfaceEvent(3, 'three', { op: 'replace', start: 1, end: 2 }))
    expect(() => assertLosslessJson(state)).not.toThrow()

    // The persisted-checkpoint contract: a lossless JSON round trip.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})

/**
 * Assert the DSH session-projection checkpoint contract: every value must
 * survive a lossless JSON round trip (no undefined, no non-finite or -0
 * numbers, no sparse arrays, no exotic objects such as Map/Set/Date, and no
 * class instances). A violation here would poison the persisted projection
 * cache checkpoint for the whole session.
 */
function assertLosslessJson(value: unknown, path = '$'): void {
  if (value === null) return
  if (value === undefined) throw new Error(`lossless JSON violation: undefined at ${path}`)
  const type = typeof value
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error(`lossless JSON violation: non-finite number at ${path}`)
    if (Object.is(value, -0)) throw new Error(`lossless JSON violation: negative zero at ${path}`)
    return
  }
  if (type === 'string' || type === 'boolean') return
  if (type === 'bigint' || type === 'function' || type === 'symbol') {
    throw new Error(`lossless JSON violation: ${type} at ${path}`)
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new Error(`lossless JSON violation: sparse array at ${path}[${i}]`)
      assertLosslessJson(value[i], `${path}[${i}]`)
    }
    return
  }
  if (value instanceof Map || value instanceof Set || value instanceof Date) {
    throw new Error(`lossless JSON violation: ${value.constructor.name} at ${path}`)
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`lossless JSON violation: non-plain object (${(value as object).constructor?.name}) at ${path}`)
  }
  for (const [key, child] of Object.entries(value)) assertLosslessJson(child, `${path}.${key}`)
}
