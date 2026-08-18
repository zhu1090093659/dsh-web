import { describe, expect, it, vi } from 'vitest'

import { parseInteractionResult, parsePetSnapshot, PetClient, PetEventDecoder } from './pet-client.ts'

const NATIVE_TOKEN = 'n'.repeat(43)

const snapshot = {
  animation: 'waiting',
  bubble: '等待回复',
  phase: 'waiting',
  sessionActive: true,
  companion: { enabled: true, visible: true, alwaysOnTop: true, locked: false, scale: 1 },
  affinity: {
    points: 12,
    rank: '幼鲸',
    pets: 2,
    feeds: 1,
    turns: 9,
    petCooldown: false,
    feedCooldown: true,
  },
  treats: { stocked: 3, max: 20 },
}

const intent = {
  version: 2,
  id: 'activity:tool',
  source: 'activity',
  createdAt: 100,
  priority: 40,
  interruptible: true,
  expression: 'focused',
  motion: 'working',
  playback: 'loop',
  speech: { id: 'speech:tool:100', text: '正在运行测试', createdAt: 100 },
  sourceTaskIds: ['task'],
}

describe('desktop pet client', () => {
  it('accepts only the state fields used by the desktop surface', () => {
    expect(parsePetSnapshot(snapshot)).toMatchObject({ animation: 'waiting' })
    expect(parsePetSnapshot({ ...snapshot, intent })).toMatchObject({
      intent: { version: 2, id: 'activity:tool', motion: 'working' },
    })
    expect(parsePetSnapshot({ ...snapshot, whisper: '我在这里陪着你' })).toMatchObject({
      whisper: '我在这里陪着你',
    })
    expect(parsePetSnapshot({
      ...snapshot,
      sessions: [
        { sessionId: 'session-1', animation: 'running', bubble: '正在调用工具', phase: 'tool' },
      ],
    })).toMatchObject({
      sessions: [{ sessionId: 'session-1', bubble: '正在调用工具', phase: 'tool' }],
    })
    expect(parsePetSnapshot({
      ...snapshot,
      intent: {
        id: '2:task:tool', createdAt: 100, priority: 30, ttlMs: 12_000,
        expression: 'focused', motion: 'working', speech: '正在运行测试',
        sourceTaskIds: ['task'], interruptible: true,
      },
    })).toMatchObject({ intent: { version: 2, id: 'legacy:2:task:tool', motion: 'working' } })
    expect(() => parsePetSnapshot({ ...snapshot, animation: 'unknown' })).toThrow('invalid pet snapshot')
    expect(() => parsePetSnapshot({ ...snapshot, intent: { ...intent, motion: 'teleport' } }))
      .toThrow('invalid pet intent')
    expect(() => parsePetSnapshot({ ...snapshot, affinity: { points: Number.NaN } })).toThrow('invalid pet snapshot')
    expect(() => parsePetSnapshot({ ...snapshot, whisper: 1 })).toThrow('invalid pet snapshot')
    expect(() => parsePetSnapshot({ ...snapshot, sessions: [{ sessionId: '', bubble: 1 }] }))
      .toThrow('invalid pet session status')
  })

  it('decodes fragmented SSE data records and ignores heartbeats', () => {
    const decoder = new PetEventDecoder()
    expect(decoder.push('data: {"animation":')).toEqual([])
    expect(decoder.push('"idle"}\r\n\r\n: heartbeat\n\n')).toEqual(['{"animation":"idle"}'])
    expect(decoder.push('data: first\ndata: second\n\n')).toEqual(['first\nsecond'])
  })

  it('validates interaction results', () => {
    expect(parseInteractionResult({ reaction: '好呀', delta: 1 }, 'pet', 100))
      .toMatchObject({
        reaction: '好呀',
        accepted: true,
        intent: { id: 'interaction:pet:100', motion: 'pet' },
      })
    expect(parseInteractionResult({ reaction: '冷却中', delta: 0 }, 'feed', 200))
      .toMatchObject({
        reaction: '冷却中',
        accepted: false,
        intent: { id: 'interaction:feed:200', motion: 'feed' },
      })
    expect(() => parseInteractionResult({ reaction: 1 })).toThrow('invalid pet interaction result')
  })

  it('uses the fixed loopback API and refreshes after an interaction', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/interact')) {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe('{"kind":"pet"}')
        return new Response(JSON.stringify({ reaction: '摸摸成功', delta: 1, affinity: snapshot.affinity }))
      }
      return new Response(JSON.stringify(snapshot))
    })
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)

    await client.refresh()
    expect(client.state()).toMatchObject({ connection: 'ready', snapshot: { animation: 'waiting' } })
    await expect(client.interact('pet')).resolves.toMatchObject({
      reaction: '摸摸成功', accepted: true, intent: { source: 'interaction', motion: 'pet' },
    })
    expect(fetchImpl.mock.calls.every(([url, init]) => {
      const headers = init?.headers as Record<string, string> | undefined
      return String(url).startsWith('http://127.0.0.1:3080/api/pet/native/')
        && headers?.authorization === `Bearer ${NATIVE_TOKEN}`
        && !String(url).includes(NATIVE_TOKEN)
    })).toBe(true)
  })

  it('writes desktop window changes back to the Host settings namespace', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"locked":true}')
      return new Response(JSON.stringify({
        ok: true,
        companion: { enabled: true, visible: true, alwaysOnTop: true, locked: true, scale: 1.25 },
      }))
    })
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)

    await expect(client.setCompanionSettings({ locked: true })).resolves.toMatchObject({
      locked: true,
      scale: 1.25,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3080/api/pet/native/surface-settings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: `Bearer ${NATIVE_TOKEN}` }),
      }),
    )
  })

  it('keeps the last valid snapshot when Harness is temporarily unavailable', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
      .mockRejectedValueOnce(new Error('offline'))
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)

    await client.refresh()
    await client.refresh()
    expect(client.state()).toMatchObject({ connection: 'unavailable', snapshot: { animation: 'waiting' } })
  })

  it('switches future REST requests to a newly configured local origin', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(snapshot)))
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)
    client.setOrigin('http://localhost:4080/')

    await client.refresh()
    expect(client.originUrl()).toBe('http://localhost:4080')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:4080/api/pet/native/state',
      expect.objectContaining({
        headers: { accept: 'application/json' },
      }),
    )
  })

  it('rotates the managed credential without placing it in the request URL', async () => {
    const nextToken = 'r'.repeat(43)
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(snapshot)))
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)
    client.setConnection('http://127.0.0.1:3080', nextToken)

    await client.refresh()
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3080/api/pet/native/state',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${nextToken}` }),
      }),
    )
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain(nextToken)
  })

  it('starts a new-generation refresh immediately and ignores a stale host response', async () => {
    let resolveOld!: (response: Response) => void
    const oldResponse = new Promise<Response>(resolve => { resolveOld = resolve })
    const fetchImpl = vi.fn()
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot, bubble: '新 Host' })))
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)

    const stale = client.refresh()
    expect(client.reconnect()).toMatchObject({ connection: 'connecting' })
    const fresh = client.refresh()
    resolveOld(new Response(JSON.stringify({ ...snapshot, bubble: '旧 Host' })))
    await Promise.all([stale, fresh])

    expect(client.state()).toMatchObject({ connection: 'ready', snapshot: { bubble: '新 Host' } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('aborts the old stream and reconnects immediately after host restart or wake', async () => {
    const streamSignals: AbortSignal[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/events')) {
        if (init?.signal != null) streamSignals.push(init.signal)
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        })
      }
      return new Response(JSON.stringify(snapshot))
    })
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)

    client.start()
    await vi.waitFor(() => expect(streamSignals).toHaveLength(1))
    client.reconnect()
    await vi.waitFor(() => expect(streamSignals).toHaveLength(2))
    expect(streamSignals[0]?.aborted).toBe(true)
    expect(streamSignals[1]?.aborted).toBe(false)
    client.stop()
    expect(streamSignals[1]?.aborted).toBe(true)
  })

  it('uses the Web DSH event stream as the primary state source', async () => {
    const streamed = { ...snapshot, intent }
    const encoder = new TextEncoder()
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/events')) {
        await new Promise(resolve => setTimeout(resolve, 10))
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(streamed)}\n\n`))
          },
        }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
      }
      return new Response(JSON.stringify(snapshot))
    })
    const client = new PetClient(fetchImpl, undefined, NATIVE_TOKEN)

    client.start()
    await vi.waitFor(() => expect(client.state()).toMatchObject({
      connection: 'ready',
      snapshot: { intent: { motion: 'working' } },
    }))
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3080/api/pet/native/events',
      expect.objectContaining({
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${NATIVE_TOKEN}`,
        },
      }),
    )
    client.stop()
  })
})
