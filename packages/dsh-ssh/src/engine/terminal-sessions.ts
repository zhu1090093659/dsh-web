/**
 * Host-side terminal sessions for the web terminal.
 *
 * The PTY shell is owned here, not by the browser view: a view can detach
 * (panel switch, page unmount, a dropped socket) and reattach by session id
 * without tearing the remote shell down, which is what makes the terminal
 * survival property the old DOM takeover used to provide. A session with no
 * attached socket is reaped after an idle window, and an exited one is kept
 * for a short grace window so a reattaching view still sees the final screen.
 */
import { randomBytes } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { WebSocket } from 'ws'
import type { KeyboardInteractiveHandler } from './connection-pool.ts'
import type { ShellSession } from './pty.ts'
import type { TerminalServerFrame } from '../protocol.ts'

/** Pause the shell when an attached socket's send buffer exceeds this… */
const BACKPRESSURE_HIGH_WATER = 1024 * 1024

/** …and resume once every attached socket drains below this. */
const BACKPRESSURE_LOW_WATER = 512 * 1024

/** Scrollback retained for a reattaching view (bytes of UTF-8 output). */
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024

/** A detached session is reaped after this long. */
const DEFAULT_IDLE_MS = 10 * 60 * 1000

/** An exited session is kept this long for a reattaching view. */
const DEFAULT_EXIT_GRACE_MS = 60 * 1000

/** Clamp a terminal column/row dimension to an integer >= `min`. */
function clampDimension(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.trunc(value))
}

/** One live terminal session and the sockets currently watching it. */
interface HostedTerminal {
  id: string
  alias: string
  shell?: ShellSession
  sockets: Set<WebSocket>
  decoder: StringDecoder
  /** Bounded scrollback ring replayed to an attaching socket. */
  buffer: string[]
  bufferChunkBytes: number[]
  bufferHead: number
  bufferBytes: number
  paused: boolean
  /** Cached drain callback reused across backed-up sends without per-frame allocation. */
  onDrain?: () => void
  exited: boolean
  exit?: { code: number | null; error?: string }
  /** Pending keyboard-interactive challenge, whoever attached when it arrived. */
  pendingAuthFinish?: (responses: string[]) => void
  reapTimer?: ReturnType<typeof setTimeout>
}

/** What the registry needs from the engine (swappable in tests). */
export interface TerminalSessionDeps {
  /** Open one PTY shell for the alias (engine.openShell). */
  openShell(alias: string, size: { cols: number; rows: number }, onKeyboardInteractive?: KeyboardInteractiveHandler): Promise<ShellSession>
  /** @returns the current time (defaults to Date.now). */
  now?: () => number
  /** Bounded scrollback per session. */
  maxBufferBytes?: number
  /** Idle window before a detached session is reaped. */
  idleMs?: number
  /** Grace window an exited session is kept for reattaching views. */
  exitGraceMs?: number
}

/**
 * The host's terminal session table: open one session per connect, attach any
 * number of sockets, and keep the shell alive across detach.
 */
export class TerminalSessionRegistry {
  private readonly sessions = new Map<string, HostedTerminal>()
  private readonly deps: TerminalSessionDeps
  private readonly maxBufferBytes: number
  private readonly idleMs: number
  private readonly exitGraceMs: number

  constructor(deps: TerminalSessionDeps) {
    this.deps = deps
    this.maxBufferBytes = deps.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    this.idleMs = deps.idleMs ?? DEFAULT_IDLE_MS
    this.exitGraceMs = deps.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS
  }

  /** Open a new session for the alias and attach the requesting socket to it. */
  async open(ws: WebSocket, alias: string, size: { cols: number; rows: number }): Promise<void> {
    const session: HostedTerminal = {
      id: randomBytes(9).toString('hex'),
      alias,
      sockets: new Set(),
      decoder: new StringDecoder('utf8'),
      buffer: [],
      bufferChunkBytes: [],
      bufferHead: 0,
      bufferBytes: 0,
      paused: false,
      exited: false,
    }
    session.onDrain = () => {
      if (session.paused) this.applyBackpressure(session)
    }
    this.sessions.set(session.id, session)
    this.bind(ws, session)
    try {
      const shell = await this.deps.openShell(alias, size, this.keyboardInteractive(session))
      if (!this.sessions.has(session.id)) {
        // The session was ended (or the host torn down) while it connected.
        shell.close()
        return
      }
      session.shell = shell
      shell.onData = data => {
        const text = session.decoder.write(data)
        if (text !== '') this.pushOutput(session, text)
      }
      shell.onExit = (code, error) => { this.finish(session, code, error) }
      this.send(session, { type: 'ready', alias, sessionId: session.id })
    } catch (error) {
      this.send(session, { type: 'exit', code: null, error: error instanceof Error ? error.message : String(error) })
      this.end(session)
    }
  }

  /**
   * Attach a socket to an existing session, replaying its scrollback first.
   * @returns false when the session is unknown (expired or already reaped).
   */
  attach(ws: WebSocket, sessionId: string, size: { cols: number; rows: number }): boolean {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return false
    this.bind(ws, session)
    this.clearReap(session)
    for (let index = session.bufferHead; index < session.buffer.length; index += 1) {
      this.sendPayload(session, ws, JSON.stringify({ type: 'output', data: session.buffer[index]! }))
    }
    this.sendPayload(session, ws, JSON.stringify({ type: 'ready', alias: session.alias, sessionId: session.id }))
    if (session.exited) {
      this.sendPayload(session, ws, JSON.stringify({ type: 'exit', code: session.exit?.code ?? null, error: session.exit?.error }))
      // Re-arm the grace window: this socket now holds the exited session open.
      this.scheduleReap(session, this.exitGraceMs)
    } else {
      session.shell?.resize(clampDimension(size.cols, 2, 80), clampDimension(size.rows, 1, 24))
      this.applyBackpressure(session)
    }
    return true
  }

  /** End every session (host teardown, plugin dispose). */
  dispose(): void {
    for (const session of [...this.sessions.values()]) this.end(session)
    this.sessions.clear()
  }

  /** Number of live sessions (introspection for tests and diagnostics). */
  size(): number {
    return this.sessions.size
  }

  /** Wire one socket's frames and lifecycle onto a session. */
  private bind(ws: WebSocket, session: HostedTerminal): void {
    session.sockets.add(ws)
    ws.on('message', (data) => {
      let frame: { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown; responses?: unknown }
      try {
        frame = JSON.parse(String(data)) as typeof frame
      } catch {
        return
      }
      if (typeof frame !== 'object' || frame === null) return
      if (frame.type === 'input') {
        if (typeof frame.data === 'string') session.shell?.send(frame.data)
      } else if (frame.type === 'resize') {
        session.shell?.resize(clampDimension(frame.cols, 2, 80), clampDimension(frame.rows, 1, 24))
      } else if (frame.type === 'auth_response') {
        const finish = session.pendingAuthFinish
        session.pendingAuthFinish = undefined
        const responses = Array.isArray(frame.responses)
          ? frame.responses.filter((item): item is string => typeof item === 'string')
          : []
        try { finish?.(responses) } catch { /* the connect already failed */ }
      } else if (frame.type === 'close') {
        this.end(session)
      } else if (frame.type === 'detach') {
        this.detach(ws)
      }
    })
    ws.on('close', () => { this.detach(ws) })
    ws.on('error', () => { this.detach(ws) })
  }

  /** Remove a socket from its session, keeping the shell alive. */
  private detach(ws: WebSocket): void {
    for (const session of this.sessions.values()) {
      if (!session.sockets.delete(ws)) continue
      if (session.sockets.size === 0) {
        // Nobody is watching: give the view a window to come back before the
        // remote shell is torn down (or, for an exited one, before its final
        // screen is dropped).
        this.scheduleReap(session, session.exited ? this.exitGraceMs : this.idleMs)
      }
      if (session.paused) this.applyBackpressure(session)
      return
    }
  }

  /** End the session and close every socket still attached to it. */
  private end(session: HostedTerminal): void {
    this.clearReap(session)
    this.sessions.delete(session.id)
    if (session.pendingAuthFinish !== undefined) {
      const finish = session.pendingAuthFinish
      session.pendingAuthFinish = undefined
      try { finish([]) } catch { /* the connect already failed */ }
    }
    for (const ws of [...session.sockets]) {
      session.sockets.delete(ws)
      try { ws.close(1000) } catch { /* already closed */ }
    }
    try { session.shell?.close() } catch { /* channel gone */ }
  }

  /** Mark a session exited and keep it briefly so a reattaching view sees it. */
  private finish(session: HostedTerminal, code: number | null, error?: string): void {
    if (session.exited) return
    const tail = session.decoder.end()
    if (tail !== '') this.pushOutput(session, tail)
    session.exited = true
    session.exit = { code, error }
    this.send(session, { type: 'exit', code, error })
    // The view has its exit frame; close the sockets so neither the browser
    // nor the host holds a dead transport open. The session record itself
    // survives the grace window, so a reattach still replays the final screen.
    for (const ws of [...session.sockets]) {
      session.sockets.delete(ws)
      try { ws.close(1000) } catch { /* already closed */ }
    }
    this.scheduleReap(session, this.exitGraceMs)
  }

  /** Keep at most `maxBytes` from the tail of `data` on a valid UTF-8 boundary. */
  private trimTailToUtf8Bytes(data: string, maxBytes: number): { text: string; bytes: number } {
    if (maxBytes <= 0) return { text: '', bytes: 0 }
    const buf = Buffer.from(data, 'utf8')
    if (buf.byteLength <= maxBytes) return { text: data, bytes: buf.byteLength }
    let start = buf.byteLength - maxBytes
    while (start < buf.byteLength && (buf[start]! & 0xc0) === 0x80) start += 1
    const tail = buf.subarray(start)
    return { text: tail.toString('utf8'), bytes: tail.byteLength }
  }

  /** Append output to the O(1) replay ring, trimmed to the byte cap. */
  private pushOutput(session: HostedTerminal, data: string): void {
    const chunkBytes = Buffer.byteLength(data, 'utf8')
    if (chunkBytes > this.maxBufferBytes) {
      const trimmed = this.trimTailToUtf8Bytes(data, this.maxBufferBytes)
      session.buffer = trimmed.text === '' ? [] : [trimmed.text]
      session.bufferChunkBytes = trimmed.text === '' ? [] : [trimmed.bytes]
      session.bufferHead = 0
      session.bufferBytes = trimmed.bytes
    } else {
      session.buffer.push(data)
      session.bufferChunkBytes.push(chunkBytes)
      session.bufferBytes += chunkBytes
      while (session.bufferBytes > this.maxBufferBytes && session.buffer.length - session.bufferHead > 1) {
        session.bufferBytes -= session.bufferChunkBytes[session.bufferHead]!
        session.bufferHead += 1
      }
      if (session.bufferHead >= 64 && session.bufferHead * 2 >= session.buffer.length) {
        session.buffer = session.buffer.slice(session.bufferHead)
        session.bufferChunkBytes = session.bufferChunkBytes.slice(session.bufferHead)
        session.bufferHead = 0
      }
    }
    this.send(session, { type: 'output', data })
  }

  /** Broadcast one frame to every attached socket, honoring backpressure. */
  private send(session: HostedTerminal, frame: TerminalServerFrame): void {
    const payload = JSON.stringify(frame)
    for (const ws of session.sockets) this.sendPayload(session, ws, payload)
    this.applyBackpressure(session)
  }

  private sendPayload(session: HostedTerminal, ws: WebSocket, payload: string): void {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      // Attach the drain callback only when buffered output is near/above the
      // low-water mark so uncontested frames incur zero callback overhead.
      if ((session.paused || ws.bufferedAmount + payload.length > BACKPRESSURE_LOW_WATER) && session.onDrain !== undefined) {
        ws.send(payload, session.onDrain)
      } else {
        ws.send(payload)
      }
    } catch { /* socket raced away */ }
  }

  /** Pause while any attached socket is backed up; resume once all drained. */
  private applyBackpressure(session: HostedTerminal): void {
    const shell = session.shell
    if (shell === undefined || session.exited) return
    let high = false
    let low = true
    for (const ws of session.sockets) {
      if (ws.bufferedAmount > BACKPRESSURE_HIGH_WATER) high = true
      if (ws.bufferedAmount > BACKPRESSURE_LOW_WATER) low = false
    }
    if (high && !session.paused) {
      session.paused = true
      shell.pause()
    } else if (low && session.paused) {
      session.paused = false
      shell.resume()
    }
  }

  /** Answer a keyboard-interactive challenge through whoever is attached. */
  private keyboardInteractive(session: HostedTerminal): KeyboardInteractiveHandler {
    return (name, instructions, _lang, prompts, finish) => {
      session.pendingAuthFinish = finish
      this.send(session, {
        type: 'auth_prompt',
        name,
        instructions,
        prompts: prompts.map(p => ({ prompt: p.prompt, echo: p.echo })),
      })
    }
  }

  private scheduleReap(session: HostedTerminal, delayMs: number): void {
    this.clearReap(session)
    const timer = setTimeout(() => {
      session.reapTimer = undefined
      if (session.sockets.size > 0) return
      this.end(session)
    }, delayMs)
    // Never hold the host process open for an idle terminal.
    ;(timer as { unref?: () => void }).unref?.()
    session.reapTimer = timer
  }

  private clearReap(session: HostedTerminal): void {
    if (session.reapTimer !== undefined) {
      clearTimeout(session.reapTimer)
      session.reapTimer = undefined
    }
  }
}
