import type {
  DesktopCompanionSettings,
  PetAnimation,
  PetBridgeState,
  PetExpression,
  PetIntent,
  PetInteraction,
  PetInteractionResult,
  PetMotion,
  PetSessionStatus,
  PetSnapshot,
} from '../shared/desktop-api.ts'
import {
  createInteractionIntent,
  PET_INTENT_VERSION,
} from '../../../src/core/intent.ts'
import { PET_DESKTOP_SCALE_MAX, PET_DESKTOP_SCALE_MIN } from '../../../src/contracts/desktop-host.ts'
import { DEFAULT_WEB_DSH_URL, normalizeWebDshUrl } from '../shared/web-dsh-url.ts'

export const PET_ORIGIN = DEFAULT_WEB_DSH_URL
const POLL_INTERVAL_MS = 800
const REQUEST_TIMEOUT_MS = 2_500
const STREAM_RETRY_MS = 5_000
const MAX_EVENT_BUFFER = 64 * 1024
const NATIVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

type PetStateListener = (state: PetBridgeState) => void
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const animations = new Set<PetAnimation>([
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
])
const expressions = new Set<PetExpression>([
  'neutral',
  'curious',
  'focused',
  'happy',
  'worried',
  'questioning',
])
const motions = new Set<PetMotion>([
  'idle',
  'waiting',
  'thinking',
  'working',
  'reviewing',
  'request-input',
  'celebrate',
  'failure',
  'pet',
  'feed',
])
const intentSources = new Set(['activity', 'interaction', 'system'])
const playbacks = new Set(['loop', 'once', 'hold'])
const legacyMotions = new Map<string, { motion: PetMotion; playback: 'loop' | 'once' | 'hold' }>([
  ['idle', { motion: 'idle', playback: 'loop' }],
  ['look-around', { motion: 'waiting', playback: 'loop' }],
  ['thinking', { motion: 'thinking', playback: 'loop' }],
  ['working', { motion: 'working', playback: 'loop' }],
  ['cheer', { motion: 'celebrate', playback: 'once' }],
  ['confused', { motion: 'failure', playback: 'hold' }],
  ['wave', { motion: 'request-input', playback: 'hold' }],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseCompanionSettings(value: unknown): DesktopCompanionSettings {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.visible !== 'boolean'
    || typeof value.alwaysOnTop !== 'boolean' || typeof value.locked !== 'boolean'
    || (value.scale !== undefined && (!finiteNumber(value.scale)
      || value.scale < PET_DESKTOP_SCALE_MIN || value.scale > PET_DESKTOP_SCALE_MAX))) {
    throw new TypeError('invalid desktop companion settings')
  }
  return {
    enabled: value.enabled,
    visible: value.visible,
    alwaysOnTop: value.alwaysOnTop,
    locked: value.locked,
    scale: value.scale === undefined ? 1 : value.scale,
  }
}

function parsePetIntent(value: unknown): PetIntent {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === ''
    || !finiteNumber(value.createdAt) || !finiteNumber(value.priority)
    || !expressions.has(value.expression as PetExpression)
    || !Array.isArray(value.sourceTaskIds)
    || !value.sourceTaskIds.every(taskId => typeof taskId === 'string')
    || typeof value.interruptible !== 'boolean') {
    throw new TypeError('invalid pet intent')
  }
  if (value.version !== PET_INTENT_VERSION) {
    const legacy = legacyMotions.get(String(value.motion))
    if (value.version !== undefined || legacy === undefined
      || !finiteNumber(value.ttlMs) || value.ttlMs <= 0
      || (value.speech !== undefined && typeof value.speech !== 'string')) {
      throw new TypeError('invalid pet intent')
    }
    return {
      version: PET_INTENT_VERSION,
      id: `legacy:${value.id}`,
      source: 'activity',
      createdAt: value.createdAt,
      expiresAt: value.createdAt + value.ttlMs,
      priority: value.priority,
      interruptible: value.interruptible,
      expression: value.expression as PetExpression,
      motion: legacy.motion,
      playback: legacy.playback,
      ...(typeof value.speech === 'string'
        ? {
            speech: {
              id: `speech:legacy:${value.id}`,
              text: value.speech,
              createdAt: value.createdAt,
            },
          }
        : {}),
      sourceTaskIds: [...value.sourceTaskIds] as string[],
    }
  }
  if (!intentSources.has(String(value.source))
    || !motions.has(value.motion as PetMotion)
    || !playbacks.has(String(value.playback))
    || (value.expiresAt !== undefined && (!finiteNumber(value.expiresAt) || value.expiresAt <= value.createdAt))
    || (value.speech !== undefined && (!isRecord(value.speech)
      || typeof value.speech.id !== 'string' || value.speech.id === ''
      || typeof value.speech.text !== 'string'
      || !finiteNumber(value.speech.createdAt)))) {
    throw new TypeError('invalid pet intent')
  }
  return {
    version: PET_INTENT_VERSION,
    id: value.id,
    source: value.source as PetIntent['source'],
    createdAt: value.createdAt,
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt as number }),
    priority: value.priority,
    interruptible: value.interruptible,
    expression: value.expression as PetExpression,
    motion: value.motion as PetMotion,
    playback: value.playback as PetIntent['playback'],
    ...(isRecord(value.speech)
      ? {
          speech: {
            id: value.speech.id as string,
            text: value.speech.text as string,
            createdAt: value.speech.createdAt as number,
          },
        }
      : {}),
    sourceTaskIds: [...value.sourceTaskIds] as string[],
  }
}

function parsePetSessionStatus(value: unknown): PetSessionStatus {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || value.sessionId === ''
    || !animations.has(value.animation as PetAnimation)
    || typeof value.bubble !== 'string' || value.bubble === ''
    || typeof value.phase !== 'string' || value.phase === '') {
    throw new TypeError('invalid pet session status')
  }
  return {
    sessionId: value.sessionId,
    animation: value.animation as PetAnimation,
    bubble: value.bubble,
    phase: value.phase,
  }
}

export function parsePetSnapshot(value: unknown): PetSnapshot {
  if (!isRecord(value) || !animations.has(value.animation as PetAnimation)
    || typeof value.phase !== 'string' || typeof value.sessionActive !== 'boolean'
    || !isRecord(value.affinity) || !isRecord(value.treats)) {
    throw new TypeError('invalid pet snapshot')
  }
  const affinity = value.affinity
  const treats = value.treats
  if (value.sessions !== undefined && (!Array.isArray(value.sessions) || value.sessions.length > 12)) {
    throw new TypeError('invalid pet snapshot')
  }
  const sessions = Array.isArray(value.sessions)
    ? value.sessions.map(parsePetSessionStatus)
    : undefined
  if (!finiteNumber(affinity.points) || typeof affinity.rank !== 'string'
    || !finiteNumber(affinity.pets) || !finiteNumber(affinity.feeds) || !finiteNumber(affinity.turns)
    || typeof affinity.petCooldown !== 'boolean' || typeof affinity.feedCooldown !== 'boolean'
    || !finiteNumber(treats.stocked) || !finiteNumber(treats.max)
    || (value.bubble !== undefined && typeof value.bubble !== 'string')
    || (value.whisper !== undefined && typeof value.whisper !== 'string')) {
    throw new TypeError('invalid pet snapshot')
  }
  return {
    animation: value.animation as PetAnimation,
    ...(typeof value.bubble === 'string' ? { bubble: value.bubble } : {}),
    ...(typeof value.whisper === 'string' ? { whisper: value.whisper } : {}),
    phase: value.phase,
    sessionActive: value.sessionActive,
    ...(sessions === undefined ? {} : { sessions }),
    ...(value.companion === undefined ? {} : { companion: parseCompanionSettings(value.companion) }),
    ...(value.intent === undefined ? {} : { intent: parsePetIntent(value.intent) }),
    affinity: {
      points: affinity.points,
      rank: affinity.rank,
      pets: affinity.pets,
      feeds: affinity.feeds,
      turns: affinity.turns,
      petCooldown: affinity.petCooldown,
      feedCooldown: affinity.feedCooldown,
    },
    treats: {
      stocked: treats.stocked,
      max: treats.max,
    },
  }
}

/** Incremental decoder for the `data:` records emitted by the Web DSH SSE route. */
export class PetEventDecoder {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    if (this.buffer.length > MAX_EVENT_BUFFER) throw new Error('pet event is too large')
    const messages: string[] = []
    let boundary = /\r?\n\r?\n/.exec(this.buffer)
    while (boundary !== null) {
      const event = this.buffer.slice(0, boundary.index)
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length)
      const data = event.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data !== '') messages.push(data)
      boundary = /\r?\n\r?\n/.exec(this.buffer)
    }
    return messages
  }
}

export function parseInteractionResult(
  value: unknown,
  fallbackKind?: PetInteraction,
  nowMs = Date.now(),
): PetInteractionResult {
  if (!isRecord(value) || typeof value.reaction !== 'string') {
    throw new TypeError('invalid pet interaction result')
  }
  const accepted = typeof value.accepted === 'boolean'
    ? value.accepted
    : finiteNumber(value.delta)
      ? value.delta > 0
      : undefined
  if (accepted === undefined) throw new TypeError('invalid pet interaction result')
  const intent = value.intent === undefined
    ? fallbackKind === undefined
      ? undefined
      : createInteractionIntent(fallbackKind, value.reaction, nowMs, accepted)
    : parsePetIntent(value.intent)
  if (intent === undefined) throw new TypeError('invalid pet interaction result')
  return {
    reaction: value.reaction,
    accepted,
    intent,
  }
}

export class PetClient {
  private current: PetBridgeState = { connection: 'connecting', snapshot: null }
  private pollTimer: NodeJS.Timeout | undefined
  private reconnectTimer: NodeJS.Timeout | undefined
  private streamAbort: AbortController | undefined
  private streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  private refreshingGeneration: number | undefined
  private running = false
  private readonly listeners = new Set<PetStateListener>()
  private origin: string
  private nativeToken: string | undefined
  private connectionGeneration = 0

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    origin: string = PET_ORIGIN,
    nativeToken?: string,
  ) {
    this.origin = normalizeWebDshUrl(origin)
    this.nativeToken = nativeToken
  }

  state(): PetBridgeState {
    return this.current
  }

  /** Resolve after the first successfully parsed Host snapshot. */
  whenReady(): Promise<void> {
    if (this.current.connection === 'ready') return Promise.resolve()
    return new Promise((resolve) => {
      let unsubscribe = (): void => undefined
      const finish = (state: PetBridgeState): void => {
        if (state.connection !== 'ready') return
        unsubscribe()
        resolve()
      }
      unsubscribe = this.subscribe(finish)
      // Close the state/subscribe race without resolving on a mere HTTP 200:
      // `ready` is assigned only after parsePetSnapshot succeeds.
      finish(this.current)
    })
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startPolling()
    void this.connectEventStream()
  }

  stop(): void {
    this.running = false
    this.stopPolling()
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.streamAbort?.abort()
    this.streamAbort = undefined
    void this.streamReader?.cancel().catch(() => undefined)
    this.streamReader = undefined
    this.listeners.clear()
  }

  subscribe(listener: PetStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  originUrl(): string {
    return this.origin
  }

  setOrigin(origin: string): PetBridgeState {
    const next = normalizeWebDshUrl(origin)
    if (next === this.origin) return this.current
    // A credential is scoped to the managed Host origin that delivered it.
    // Manual address changes must not forward that secret to another port.
    return this.setConnection(next, undefined)
  }

  setNativeToken(nativeToken: string | undefined): PetBridgeState {
    return this.setConnection(this.origin, nativeToken)
  }

  /** Force a fresh stream and poll after host restart, network resume, or wake. */
  reconnect(): PetBridgeState {
    this.connectionGeneration += 1
    return this.restartConnection()
  }

  /** Switch origin and per-boot credential as one atomic connection update. */
  setConnection(origin: string, nativeToken: string | undefined): PetBridgeState {
    const next = normalizeWebDshUrl(origin)
    if (next === this.origin && nativeToken === this.nativeToken) return this.current
    this.origin = next
    this.nativeToken = nativeToken
    this.connectionGeneration += 1
    return this.restartConnection(true)
  }

  private restartConnection(clearSnapshot = false): PetBridgeState {
    this.setState({
      connection: 'connecting',
      snapshot: clearSnapshot ? null : this.current.snapshot,
    })
    if (!this.running) return this.current
    this.stopPolling()
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.streamAbort?.abort()
    this.streamAbort = undefined
    void this.streamReader?.cancel().catch(() => undefined)
    this.streamReader = undefined
    this.startPolling()
    void this.connectEventStream()
    return this.current
  }

  async refresh(): Promise<PetBridgeState> {
    const origin = this.origin
    const generation = this.connectionGeneration
    if (this.refreshingGeneration === generation) return this.current
    this.refreshingGeneration = generation
    try {
      const snapshot = await this.getJson('/api/pet/native/state', origin)
      if (origin !== this.origin || generation !== this.connectionGeneration) return this.current
      this.setState({ connection: 'ready', snapshot: parsePetSnapshot(snapshot) })
    } catch {
      if (origin !== this.origin || generation !== this.connectionGeneration) return this.current
      this.setState({ connection: 'unavailable', snapshot: this.current.snapshot })
    } finally {
      if (this.refreshingGeneration === generation) this.refreshingGeneration = undefined
    }
    return this.current
  }

  async interact(kind: PetInteraction): Promise<PetInteractionResult> {
    const result = parseInteractionResult(await this.postJson('/api/pet/native/interact', { kind }), kind)
    await this.refresh()
    return result
  }

  async setCompanionSettings(
    patch: Partial<DesktopCompanionSettings>,
  ): Promise<DesktopCompanionSettings> {
    const result = await this.postJson('/api/pet/native/surface-settings', patch)
    if (!isRecord(result) || result.ok !== true) throw new Error('companion settings were rejected')
    return parseCompanionSettings(result.companion)
  }

  /** Write settings to one explicit managed Host without switching the active view. */
  async setCompanionSettingsForConnection(
    origin: string,
    nativeToken: string,
    patch: Partial<DesktopCompanionSettings>,
  ): Promise<DesktopCompanionSettings> {
    if (!NATIVE_TOKEN_PATTERN.test(nativeToken)) throw new Error('invalid native token')
    const result = await this.postJson(
      '/api/pet/native/surface-settings',
      patch,
      normalizeWebDshUrl(origin),
      nativeToken,
    )
    if (!isRecord(result) || result.ok !== true) throw new Error('companion settings were rejected')
    return parseCompanionSettings(result.companion)
  }

  /**
   * Verify one explicit managed Host generation without changing the active
   * connection or relying on readiness established for an older credential.
   */
  async verifyConnection(origin: string, nativeToken: string): Promise<PetSnapshot> {
    const response = await this.fetchImpl(
      `${normalizeWebDshUrl(origin)}/api/pet/native/state`,
      {
        headers: {
          accept: 'application/json',
          ...this.authorizationHeader(nativeToken),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )
    if (!response.ok) throw new Error(`pet connection verification failed: ${response.status}`)
    return parsePetSnapshot(await response.json())
  }

  /**
   * Confirm that the primary Electron instance finished initialization for one
   * managed Host registration. An existing primary may acknowledge a source
   * whose short-lived launcher process has already exited.
   */
  async announcePresentationReady(
    sourceId: string,
    desktopPid: number,
    origin: string = this.origin,
    nativeToken: string | undefined = this.nativeToken,
  ): Promise<void> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(sourceId)
      || !Number.isSafeInteger(desktopPid)
      || desktopPid <= 0
      || desktopPid > 0x7fff_ffff
      || nativeToken === undefined) throw new Error('invalid presentation readiness')
    const response = await this.fetchImpl(`${normalizeWebDshUrl(origin)}/api/pet/native/ready`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...this.authorizationHeader(nativeToken),
      },
      body: JSON.stringify({ sourceId, desktopPid }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`pet ready acknowledgement failed: ${response.status}`)
    const result = await response.json() as unknown
    if (!isRecord(result) || result.ok !== true) throw new Error('pet ready acknowledgement was rejected')
  }

  private async connectEventStream(): Promise<void> {
    if (!this.running || this.streamAbort !== undefined) return
    const abort = new AbortController()
    this.streamAbort = abort
    const origin = this.origin
    const generation = this.connectionGeneration
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await this.fetchImpl(`${origin}/api/pet/native/events`, {
        headers: { accept: 'text/event-stream', ...this.authorizationHeader() },
        signal: abort.signal,
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')
        || response.body === null) {
        throw new Error(`pet event stream failed: ${response.status}`)
      }
      reader = response.body.getReader()
      this.streamReader = reader
      const text = new TextDecoder()
      const events = new PetEventDecoder()
      while (this.running && !abort.signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('pet event stream closed')
        for (const data of events.push(text.decode(chunk.value, { stream: true }))) {
          if (origin !== this.origin || generation !== this.connectionGeneration) return
          const snapshot = parsePetSnapshot(JSON.parse(data))
          this.stopPolling()
          this.setState({ connection: 'ready', snapshot })
        }
      }
    } catch {
      if (this.running && !abort.signal.aborted) {
        this.setState({ connection: 'unavailable', snapshot: this.current.snapshot })
        this.startPolling()
        this.scheduleReconnect()
      }
    } finally {
      if (this.streamReader === reader) this.streamReader = undefined
      try {
        reader?.releaseLock()
      } catch {
        // A reader cancelled during shutdown may already have released its lock.
      }
      if (this.streamAbort === abort) this.streamAbort = undefined
    }
  }

  private startPolling(): void {
    if (!this.running || this.pollTimer !== undefined) return
    void this.refresh()
    this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS)
    this.pollTimer.unref?.()
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== undefined) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connectEventStream()
    }, STREAM_RETRY_MS)
    this.reconnectTimer.unref?.()
  }

  private async getJson(path: string, origin: string = this.origin): Promise<unknown> {
    const response = await this.fetchImpl(`${origin}${path}`, {
      headers: { accept: 'application/json', ...this.authorizationHeader() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`pet request failed: ${response.status}`)
    return response.json()
  }

  private async postJson(
    path: string,
    body: unknown,
    origin: string = this.origin,
    nativeToken: string | undefined = this.nativeToken,
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${origin}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...this.authorizationHeader(nativeToken),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`pet request failed: ${response.status}`)
    return response.json()
  }

  private authorizationHeader(nativeToken: string | undefined = this.nativeToken): Record<string, string> {
    return nativeToken === undefined
      ? {}
      : { authorization: `Bearer ${nativeToken}` }
  }

  private setState(state: PetBridgeState): void {
    if (state.connection === this.current.connection && state.snapshot === this.current.snapshot) return
    this.current = state
    for (const listener of this.listeners) listener(state)
  }
}
