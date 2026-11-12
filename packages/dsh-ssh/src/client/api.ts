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

/** The location facts a terminal socket URL is built from. */
interface PageLocation {
  /** Page scheme with its colon (for example `https:` or `dsh-app:`). */
  protocol: string
  /** Page authority, empty for a scheme that carries none. */
  host: string
}

/**
 * The WebSocket URL the terminal route is reached at, or undefined when this
 * page cannot carry one.
 *
 * A web page resolves the socket against its own origin, exactly as before.
 *
 * A page delivered by an application on this machine (the official DSH Desktop
 * shell serves its Web GUI from `dsh-app://app/`) cannot carry a socket on its
 * own scheme: the protocol handler forwards HTTP to the local Host but has no
 * upgrade to forward. That is exactly the case the official transport hook
 * covers - the shell publishes `__DSH_TRANSPORT__.streamBaseUrl`, the loopback
 * authority of the Host it owns and already forwards every other request to
 * (issue #1744). The socket is therefore dialed there instead, with the `ws`/
 * `wss` scheme derived from that base, which is what the shell's
 * `onBeforeSendHeaders` hook expects to see before it attaches its
 * authority-bound credential.
 *
 * The base is used only on an application-delivered page. A web page that
 * somehow carries the hook (the remote channel grants `ownsHost` to a paired
 * LAN page, and that page is fenced behind a pairing channel) keeps resolving
 * against its own origin, so this cannot reroute gated traffic onto a host the
 * page is not entitled to reach. A blank authority is treated the same as an
 * application scheme with no base: there is nothing to dial, and the caller
 * gets the actionable reason instead of a socket that can only fail.
 *
 * @param location - the page location to read.
 * @param search - the query string carrying `alias` or `session`.
 * @param streamBaseUrl - `__DSH_TRANSPORT__.streamBaseUrl`, when the shell published one.
 * @returns the absolute `ws:`/`wss:` URL, or undefined when the page cannot carry one.
 */
export function terminalSocketUrl(
  location: PageLocation,
  search: string,
  streamBaseUrl?: string | undefined,
): string | undefined {
  if (WEB_PAGE_PROTOCOLS.has(location.protocol)) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    return scheme + '://' + location.host + SSH_API.terminal + search
  }
  // Application-delivered page: the shell-owned Host authority is the only
  // origin the socket can reach. An unparsable or non-network base is ignored
  // rather than guessed at, so the caller reports the actionable reason.
  const base = hostAuthorityOf(streamBaseUrl)
  if (base === undefined) return undefined
  const scheme = base.protocol === 'https:' ? 'wss' : 'ws'
  return scheme + '://' + base.authority + SSH_API.terminal + search
}

/**
 * The authority and scheme of a shell-owned Host base, or undefined when the
 * value is absent, unparsable, or not a network origin this Host can serve
 * (an application scheme could only resolve back to the page that has no
 * socket transport in the first place).
 * @param base - the raw `streamBaseUrl` as published by the transport hook.
 */
function hostAuthorityOf(base: string | undefined): { protocol: string; authority: string } | undefined {
  if (base === undefined || base === '') return undefined
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  // A base carrying userinfo or credentials would put them on the wire.
  if (url.username !== '' || url.password !== '') return undefined
  if (url.host === '') return undefined
  return { protocol: url.protocol, authority: url.host }
}

/**
 * The shell-owned Host authority the page is told to reach, read from the
 * official transport hook. The global is written by the shell before any boot
 * entry runs, so it is absent on every page it does not own.
 * @param globals - the global object to read (defaults to the real one).
 * @returns the published base URL, or undefined when the page carries none.
 */
function transportStreamBaseUrl(
  globals: { __DSH_TRANSPORT__?: { streamBaseUrl?: unknown } } = globalThis as never,
): string | undefined {
  const published = (globals as { __DSH_TRANSPORT__?: { streamBaseUrl?: unknown } }).__DSH_TRANSPORT__?.streamBaseUrl
  return typeof published === 'string' ? published : undefined
}

/**
 * Schemes a network page can be delivered with. Every other scheme belongs to
 * an application on this machine, which is the same classification the remote
 * channel and the update seat use (`isWebPageProtocol` / `isApplicationDeliveredPage`).
 */
const WEB_PAGE_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'blob:',
  'data:',
  'about:',
  'filesystem:',
])

/**
 * A terminal connection that never opened: it reports one failure once the
 * view has attached its `onExit`, so the tab shows why instead of sitting on a
 * spinner, and every later frame is a no-op.
 */
function failedTerminal(reason: string): TerminalConnection {
  const connection: TerminalConnection = {
    onReady: undefined,
    onOutput: undefined,
    onExit: undefined,
    onAuthPrompt: undefined,
    send: () => undefined,
    resize: () => undefined,
    sendAuthResponse: () => undefined,
    detach: () => undefined,
    close: () => undefined,
  }
  // The view binds onExit after the open() call returns, so the failure is
  // delivered on the next microtask - never synchronously, which would race
  // the handler the caller is about to assign.
  queueMicrotask(() => { connection.onExit?.(null, reason) })
  return connection
}

/** One open terminal connection (WebSocket JSON frames). */
export interface TerminalConnection {
  /** Fired on the ready frame (shell is up); carries the host session id and alias. */
  onReady: ((sessionId: string, alias: string) => void) | undefined
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
  /**
   * Leave the socket while the host keeps the remote shell alive, so a later
   * {@link SshApi.attachTerminal} picks the session up where it left off.
   * This is what a view does on unmount; it is not a disconnect.
   */
  detach(): void
  /** Close the socket and end the remote session. */
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
  /**
   * Open a new host terminal session for the alias.
   * @param alias - the configured host alias.
   * @param cols - initial PTY width.
   * @param rows - initial PTY height.
   * @returns the live connection; its ready callback carries the session id
   *   {@link attachTerminal} uses after a view detach.
   */
  openTerminal(alias: string, cols: number, rows: number): TerminalConnection {
    return this.terminalSocket(query({ alias, cols, rows }))
  }

  /**
   * Reattach to a host-side session that outlived its view (a panel switch, a
   * page navigation). The host replays its scrollback before the ready frame.
   * @param sessionId - the id the previous connection reported on ready.
   * @param cols - the view's current width.
   * @param rows - the view's current height.
   */
  attachTerminal(sessionId: string, cols: number, rows: number): TerminalConnection {
    return this.terminalSocket(query({ session: sessionId, cols, rows }))
  }

  /**
   * End a host session this view is not attached to (closing a background
   * tab). The session has no other handle from the browser: giving it a
   * dedicated HTTP route would widen the host's surface for one frame, so this
   * opens one short-lived attach instead and sends the close frame as soon as
   * the socket is open.
   *
   * The answer is "is this session no longer running", which has three
   * truthful answers and one lie to avoid:
   *   - the frame went out on an open socket: the host ends the session;
   *   - the host answered with an exit frame: an unknown id is reported as
   *     `terminal session expired` and an ended shell also exits, and in both
   *     cases nothing is running, so the tab really is closed;
   *   - the socket errored, closed before opening, or never settled inside
   *     `timeoutMs`: delivery is unproven, so the session may still be alive and
   *     the caller must keep the tab instead of claiming it closed.
   * @param sessionId - the session id the host reported on its ready frame.
   * @param timeoutMs - bounded wait for the delivery signal (default 5000).
   * @returns true when the session is known to be gone.
   */
  closeTerminalSession(sessionId: string, timeoutMs = 5000): Promise<boolean> {
    const target = terminalSocketUrl(
      window.location,
      query({ session: sessionId, cols: 2, rows: 1 }),
      transportStreamBaseUrl(),
    )
    if (target === undefined) return Promise.resolve(false)
    let socket: WebSocket
    try {
      socket = new WebSocket(target)
    } catch {
      return Promise.resolve(false)
    }
    return new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (gone: boolean): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        try { socket.close() } catch { /* already closed */ }
        resolve(gone)
      }
      timer = setTimeout(() => { finish(false) }, timeoutMs)
      socket.onopen = () => {
        const closeFrame: TerminalClientFrame = { type: 'close' }
        try {
          socket.send(JSON.stringify(closeFrame))
          finish(true)
        } catch {
          // The frame never left, which proves nothing either way: wait for the
          // host's own answer (an exit frame for an id that no longer exists),
          // for the socket to fail, or for the bounded wait to expire.
        }
      }
      socket.onmessage = (event: MessageEvent<string>) => {
        let frame: TerminalServerFrame
        try {
          frame = JSON.parse(event.data) as TerminalServerFrame
        } catch {
          return
        }
        // Exit (expired id or an ended shell) means there is nothing left to end.
        if (frame.type === 'exit') finish(true)
      }
      socket.onerror = () => { finish(false) }
      socket.onclose = () => { finish(false) }
    })
  }

  /** One terminal socket over either an alias (open) or a session id (attach). */
  private terminalSocket(search: string): TerminalConnection {
    const target = terminalSocketUrl(window.location, search, transportStreamBaseUrl())
    if (target === undefined) {
      // This page has no WebSocket transport at all: an application-delivered
      // page whose shell published no Host authority to dial. Say so plainly
      // instead of opening a socket that can only report "connection error".
      return failedTerminal(tt('terminal.noWebSocket'))
    }
    let socket: WebSocket
    try {
      socket = new WebSocket(target)
    } catch (error) {
      return failedTerminal(error instanceof Error ? error.message : String(error))
    }
    // A deliberate detach/close must not surface as a transport error: the
    // view tears down silently, and only an UNEXPECTED close reports exit.
    let leaving = false
    const sendFrame = (frame: TerminalClientFrame): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
    }
    const connection: TerminalConnection = {
      onReady: undefined,
      onOutput: undefined,
      onExit: undefined,
      onAuthPrompt: undefined,
      send: (data) => { sendFrame({ type: 'input', data }) },
      resize: (cols, rows) => { sendFrame({ type: 'resize', cols, rows }) },
      sendAuthResponse: (responses) => { sendFrame({ type: 'auth_response', responses }) },
      detach: () => {
        leaving = true
        sendFrame({ type: 'detach' })
        try { socket.close() } catch { /* already closed */ }
      },
      close: () => {
        leaving = true
        sendFrame({ type: 'close' })
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
      if (frame.type === 'ready') connection.onReady?.(frame.sessionId, frame.alias)
      else if (frame.type === 'output') connection.onOutput?.(frame.data)
      else if (frame.type === 'exit') connection.onExit?.(frame.code, frame.error)
      else if (frame.type === 'auth_prompt') connection.onAuthPrompt?.(frame.name, frame.instructions, frame.prompts)
    }
    socket.onclose = () => { if (!leaving) connection.onExit?.(null, 'connection closed') }
    socket.onerror = () => { if (!leaving) connection.onExit?.(null, 'connection error') }
    return connection
  }
}
