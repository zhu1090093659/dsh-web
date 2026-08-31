/**
 * Browser-side API client for the /api/dsh-ssh route family. The only data
 * access path the panel components use — plain fetch/WebSocket, same origin.
 */

import {
  SSH_API,
  type ClusterResult,
  type ExecResult,
  type HostPayload,
  type ImportResult,
  type RemoteDirEntry,
  type SshHostSummary,
  type TerminalClientFrame,
  type TerminalServerFrame,
  type TestResult,
  type TransferProgress,
  type TransferStreamLine,
  type TunnelInfo,
} from '../protocol.ts'
import { tt } from './panel/helpers.ts'

/** Minimal File System Access API surface (not in all lib.dom versions). */
interface WindowWithFileSystemAccess {
  showSaveFilePicker?: (options: { suggestedName?: string }) => Promise<{
    createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>
  }>
}

/** Error carrying the route's JSON error message. */
export class SshApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SshApiError'
  }
}

/** Extract the `.error` message from a JSON error body; undefined when absent. */
function extractError(text: string): string | undefined {
  if (text === '') return undefined
  try {
    const parsed = JSON.parse(text) as { error?: unknown } | null
    return typeof parsed?.error === 'string' ? parsed.error : undefined
  } catch {
    return undefined
  }
}

/** Parse a JSON response or throw an SshApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (response.status === 404) {
      throw new SshApiError(tt('error.disabled'))
    }
    throw new SshApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : (response.status === 404 ? tt('error.disabled') : `HTTP ${response.status}`)
    throw new SshApiError(message)
  }
  return body as T
}

/** Query-string helper. */
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? '' : '?' + text
}

/** One open terminal connection (WebSocket JSON frames). */
export interface TerminalConnection {
  /** Fired on the ready frame (shell is up). */
  onReady: (() => void) | undefined
  /** Fired on every output frame. */
  onOutput: ((data: string) => void) | undefined
  /** Fired on the exit frame (or transport error). */
  onExit: ((code: number | null, error?: string) => void) | undefined
  /** Fired when the server requests keyboard-interactive 2FA. */
  onAuthPrompt: ((name: string, instructions: string, prompts: Array<{ prompt: string; echo: boolean }>) => void) | undefined
  /** Send raw input to the remote shell. */
  send(data: string): void
  /** Resize the remote PTY. */
  resize(cols: number, rows: number): void
  /** Send interactive 2FA response codes to the remote server. */
  sendAuthResponse(responses: string[]): void
  /** Close the socket and the remote session. */
  close(): void
}

/** The browser half's only data entry point. */
export class SshApi {
  // -------------------------------------------------------------- hosts
  async listHosts(queryText?: string): Promise<SshHostSummary[]> {
    const response = await fetch(SSH_API.hosts + query({ query: queryText }))
    const body = await readJson<{ hosts: SshHostSummary[] }>(response)
    return body.hosts
  }

  async createHost(payload: HostPayload): Promise<SshHostSummary> {
    const response = await fetch(SSH_API.hosts, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await readJson<{ host: SshHostSummary }>(response)
    return body.host
  }

  async updateHost(alias: string, patch: HostPayload): Promise<SshHostSummary> {
    const response = await fetch(SSH_API.hosts + query({ alias }), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await readJson<{ host: SshHostSummary }>(response)
    return body.host
  }

  async deleteHost(alias: string): Promise<void> {
    const response = await fetch(SSH_API.hosts + query({ alias }), { method: 'DELETE' })
    await readJson<{ ok: boolean }>(response)
  }

  async importSshConfig(): Promise<ImportResult> {
    const response = await fetch(SSH_API.importSshConfig, { method: 'POST' })
    const body = await readJson<{ result: ImportResult }>(response)
    return body.result
  }

  // ---------------------------------------------------------------- ops
  async testHost(alias: string): Promise<TestResult> {
    const response = await fetch(SSH_API.test, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias }),
    })
    const body = await readJson<{ result: TestResult }>(response)
    return body.result
  }

  async exec(alias: string, command: string, timeoutMs?: number): Promise<ExecResult> {
    const response = await fetch(SSH_API.exec, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias, command, timeoutMs }),
    })
    const body = await readJson<{ result: ExecResult }>(response)
    return body.result
  }

  async cluster(options: {
    command: string
    aliases?: string[]
    environment?: string
    tags?: string[]
    timeoutMs?: number
    maxWorkers?: number
  }): Promise<ClusterResult[]> {
    const response = await fetch(SSH_API.cluster, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options),
    })
    const body = await readJson<{ results: ClusterResult[] }>(response)
    return body.results
  }

  // ----------------------------------------------------------------- ls
  async ls(alias: string, path: string): Promise<RemoteDirEntry[]> {
    const response = await fetch(SSH_API.ls + query({ alias, path }))
    const body = await readJson<{ entries: RemoteDirEntry[] }>(response)
    return body.entries
  }

  // ------------------------------------------------------------- tunnel
  async listTunnels(): Promise<TunnelInfo[]> {
    const response = await fetch(SSH_API.tunnel, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    })
    const body = await readJson<{ tunnels: TunnelInfo[] }>(response)
    return body.tunnels
  }

  async startTunnel(options: { alias: string; remotePort: number; remoteHost?: string; localPort?: number }): Promise<TunnelInfo> {
    const response = await fetch(SSH_API.tunnel, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', ...options }),
    })
    const body = await readJson<{ tunnel: TunnelInfo }>(response)
    return body.tunnel
  }

  async stopTunnel(tunnelId: string): Promise<boolean> {
    const response = await fetch(SSH_API.tunnel, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop', tunnelId }),
    })
    const body = await readJson<{ ok: boolean }>(response)
    return body.ok
  }

  async stopAllTunnels(alias?: string): Promise<number> {
    const response = await fetch(SSH_API.tunnel, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop-all', alias }),
    })
    const body = await readJson<{ stopped: number }>(response)
    return body.stopped
  }

  // ------------------------------------------------------------ transfer
  /**
   * Upload one file (raw bytes) to a remote path. Progress arrives through
   * the NDJSON response stream; resolves when the result frame lands.
   */
  async uploadFile(
    file: File,
    alias: string,
    remotePath: string,
    onProgress?: (progress: TransferProgress) => void,
  ): Promise<{ transferredBytes: number }> {
    const response = await fetch(SSH_API.upload + query({ alias, remotePath }), {
      method: 'POST',
      body: file,
    })
    if (!response.ok || response.body === null) {
      const text = await response.text().catch(() => '')
      const error = extractError(text)
      throw new SshApiError(error ?? `upload failed: HTTP ${response.status}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalError: string | undefined
    let sawResult = false
    let transferredBytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() === '') continue
        let parsed: TransferStreamLine
        try {
          parsed = JSON.parse(line) as TransferStreamLine
        } catch {
          continue
        }
        if (parsed.type === 'progress') {
          onProgress?.(parsed.progress)
        } else if (parsed.type === 'result') {
          sawResult = true
          if (parsed.ok) transferredBytes = parsed.transferredBytes ?? 0
          finalError = parsed.ok ? undefined : parsed.error ?? 'upload failed'
        }
      }
    }
    if (finalError !== undefined) throw new SshApiError(finalError)
    if (!sawResult) throw new SshApiError('upload ended without a result frame — the transfer did not complete')
    return { transferredBytes }
  }

  /**
   * Download a remote file with client-side progress. Streams straight to
   * disk when the File System Access API is available (no full-file RAM
   * copy); otherwise falls back to an in-memory Blob.
   */
  async downloadFile(
    alias: string,
    remotePath: string,
    onProgress?: (progress: TransferProgress) => void,
  ): Promise<{ blob?: Blob; filename: string; streamed: boolean; bytes: number }> {
    const response = await fetch(SSH_API.download + query({ alias, remotePath }))
    if (!response.ok || response.body === null) {
      const text = await response.text().catch(() => '')
      const error = extractError(text)
      throw new SshApiError(error ?? `download failed: HTTP ${response.status}`)
    }
    const total = Number(response.headers.get('content-length') ?? '0')
    const disposition = response.headers.get('content-disposition') ?? ''
    const match = /filename="([^"]+)"/.exec(disposition)
    const filename = match?.[1] ?? remotePath.split('/').pop() ?? 'download'
    const reader = response.body.getReader()
    const picker = typeof window !== 'undefined'
      ? (window as WindowWithFileSystemAccess).showSaveFilePicker
      : undefined
    let streamed = false
    let writable: { write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> } | undefined
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let received = 0
    const progress = (): void => {
      onProgress?.({
        phase: 'transferring',
        file: remotePath,
        transferred: received,
        total,
        percent: total > 0 ? Math.round((received / total) * 1000) / 10 : 0,
      })
    }
    try {
      if (picker !== undefined) {
        const handle = await picker.call(window, { suggestedName: filename })
        writable = await handle.createWritable()
        streamed = true
      }
    } catch {
      // User cancelled the save dialog or the API is unavailable: fall back.
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (writable !== undefined) {
        await writable.write(value as Uint8Array)
      } else {
        chunks.push(value as Uint8Array<ArrayBuffer>)
      }
      received += value.length
      progress()
    }
    if (writable !== undefined) await writable.close()
    onProgress?.({ phase: 'done', file: remotePath, transferred: received, total: received > 0 ? received : total, percent: 100 })
    return {
      blob: streamed ? undefined : new Blob(chunks),
      filename,
      streamed,
      bytes: received,
    }
  }

  // ------------------------------------------------------------ terminal
  /** Open a WebSocket terminal session. */
  openTerminal(alias: string, cols: number, rows: number): TerminalConnection {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = scheme + '://' + window.location.host + SSH_API.terminal + query({ alias, cols, rows })
    const socket = new WebSocket(url)
    const connection: TerminalConnection = {
      onReady: undefined,
      onOutput: undefined,
      onExit: undefined,
      onAuthPrompt: undefined,
      send: (data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data } satisfies TerminalClientFrame))
        }
      },
      resize: (cols, rows) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols, rows } satisfies TerminalClientFrame))
        }
      },
      sendAuthResponse: (responses) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'auth_response', responses } satisfies TerminalClientFrame))
        }
      },
      close: () => {
        try { socket.close() } catch { /* already closed */ }
      },
    }
    socket.onmessage = (event: MessageEvent<string>) => {
      let frame: TerminalServerFrame
      try {
        frame = JSON.parse(event.data) as TerminalServerFrame
      } catch {
        return
      }
      if (frame.type === 'ready') connection.onReady?.()
      else if (frame.type === 'output') connection.onOutput?.(frame.data)
      else if (frame.type === 'exit') connection.onExit?.(frame.code, frame.error)
      else if (frame.type === 'auth_prompt') connection.onAuthPrompt?.(frame.name, frame.instructions, frame.prompts)
    }
    socket.onclose = () => { connection.onExit?.(null, 'connection closed') }
    socket.onerror = () => { connection.onExit?.(null, 'connection error') }
    return connection
  }
}
