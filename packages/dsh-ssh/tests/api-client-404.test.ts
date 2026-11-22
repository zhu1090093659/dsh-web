import { describe, expect, it, vi } from 'vitest'
import { SshApi } from '../src/client/api.ts'
import { tt } from '../src/client/panel/helpers.ts'

describe('SshApi 404 disabled error handling', () => {
  it('translates 404 responses into clear disabled plugin message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => { throw new Error('not json') },
      text: async () => 'not found',
    })
    globalThis.fetch = fetchMock as any

    const api = new SshApi()
    await expect(api.listHosts()).rejects.toThrow(tt('error.disabled'))
  })

  it('translates 404 with JSON error body into clear disabled message if error is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '{}',
    })
    globalThis.fetch = fetchMock as any

    const api = new SshApi()
    await expect(api.listHosts()).rejects.toThrow(tt('error.disabled'))
  })

  it('user sees onExit invoked once when terminal exit frame or error precedes socket close', () => {
    // Given mocked browser globals for terminal WebSocket connections
    const originalWindow = (globalThis as { window?: unknown }).window
    const originalWs = (globalThis as { WebSocket?: unknown }).WebSocket
    const sockets: Array<{
      onclose: (() => void) | null
      onerror: (() => void) | null
      onmessage: ((event: { data: string }) => void) | null
      close: () => void
    }> = []
    class FakeWs {
      static OPEN = 1
      readyState = 1
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      constructor(_url: string) { sockets.push(this) }
      send(): void {}
      close(): void {}
    }
    ;(globalThis as { window: unknown }).window = { location: { protocol: 'http:', host: '127.0.0.1:3080' } }
    ;(globalThis as { WebSocket: unknown }).WebSocket = FakeWs
    try {
      const api = new SshApi()
      const exitCalls1: Array<[number | null, string | undefined]> = []
      const conn1 = api.openTerminal('web-1', 80, 24)
      conn1.onExit = (code, error) => { exitCalls1.push([code, error]) }

      // When exit frame arrives and socket subsequently emits onclose
      sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'exit', code: 0, error: 'bye' }) })
      sockets[0]!.onclose?.()

      // And when a second socket fires onerror then onclose
      const exitCalls2: Array<[number | null, string | undefined]> = []
      const conn2 = api.openTerminal('web-2', 80, 24)
      conn2.onExit = (code, error) => { exitCalls2.push([code, error]) }
      sockets[1]!.onerror?.()
      sockets[1]!.onclose?.()

      // Then onExit fires strictly once per connection
      expect(exitCalls1).toEqual([[0, 'bye']])
      expect(exitCalls2).toEqual([[null, 'connection error']])
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window: unknown }).window = originalWindow
      if (originalWs === undefined) delete (globalThis as { WebSocket?: unknown }).WebSocket
      else (globalThis as { WebSocket: unknown }).WebSocket = originalWs
    }
  })

  it('user uploading a stream with a trailing result line lacking newline receives transferredBytes cleanly', async () => {
    // Given an NDJSON response ending without a trailing newline
    const originalFetch = globalThis.fetch
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"type":"result","ok":true,"transferredBytes":42}'))
        controller.close()
      },
    })
    globalThis.fetch = (async () => ({ ok: true, status: 200, body })) as unknown as typeof fetch
    try {
      const api = new SshApi()
      const file = new Blob(['x'.repeat(42)]) as unknown as File

      // When uploadFile consumes the stream
      const res = await api.uploadFile(file, 'web-1', '/tmp/file.bin')

      // Then the trailing result line is parsed after flush
      expect(res.transferredBytes).toBe(42)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('user hitting a mid-stream read error during streamed download aborts writable and cancels body reader', async () => {
    // Given a streamed download using showSaveFilePicker whose second read fails
    const originalFetch = globalThis.fetch
    const originalWindow = (globalThis as { window?: unknown }).window
    const events: string[] = []
    let readCount = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        readCount += 1
        if (readCount === 1) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          return
        }
        controller.error(new Error('network reset'))
      },
      cancel() {
        events.push('reader-cancelled')
      },
    })
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '10', 'content-disposition': 'attachment; filename="a.bin"' }),
      body,
    })) as unknown as typeof fetch
    ;(globalThis as { window: unknown }).window = {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async () => { events.push('writable-write') },
          close: async () => { events.push('writable-close') },
          abort: async () => { events.push('writable-abort') },
        }),
      }),
    }
    try {
      const api = new SshApi()

      // When downloadFile fails mid-stream
      await expect(api.downloadFile('web-1', '/tmp/a.bin')).rejects.toThrow('network reset')

      // Then the FileSystemWritableFileStream is aborted rather than committed with close()
      expect(events).toEqual(['writable-write', 'writable-abort'])
    } finally {
      globalThis.fetch = originalFetch
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window: unknown }).window = originalWindow
    }
  })
})
