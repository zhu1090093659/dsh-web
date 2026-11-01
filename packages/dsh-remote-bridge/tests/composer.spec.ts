import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FRAME_BYTES } from '../src/core/envelope.ts'
import { METHOD_APPROVAL_RESOLVE, METHOD_SESSION_ATTACHMENT, METHOD_SESSION_MODELS, METHOD_SESSION_PERMISSIONS, METHOD_SESSION_SET_EFFORT, METHOD_SESSION_SET_MODEL, METHOD_SESSION_SET_PERMISSION, KNOWN_METHODS } from '../src/core/protocol.ts'
import { ModelEffortPreferences } from '../src/core/model-efforts.ts'
import { PROMPT_ATTACHMENT_MAX_BYTES } from '../src/core/connection.ts'
import { SessionPermissions, type PermissionFaces, type PresetOptionFace } from '../src/core/session-permissions.ts'
import { ControllableStream, answerOf, makeConnection, requestFrame, settle, type ConnectionHarness } from './support/harness.ts'

/** One durable session event as DSH writes it. */
function record(type: string, seq: number, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time: 100 + seq, data } }
}

/** One assistant-stream chunk frame. */
function chunk(index: number, body: unknown): unknown {
  return { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a-1', revision: 1, index, time: 10 + index, chunk: body } }
}

/** Subscribe one connection to `s-1` through a stream the test drives. */
async function subscribe(harness: ConnectionHarness, id: number): Promise<ControllableStream> {
  const follow = new ControllableStream()
  harness.gateway.follow = call => follow.attach(call.signal).iterable()
  const pending = harness.connection.handleText(requestFrame(id, 'session.snapshot', { sessionId: 's-1' }))
  follow.push({ type: 'snapshot', header: {}, cursor: 0, hasMore: false, projections: {}, records: [] })
  await pending
  return follow
}

/** @returns every `session.delta` payload this connection published, in order. */
function deltasOf(harness: ConnectionHarness): Record<string, unknown>[] {
  return harness.transport
    .ofType('ev')
    .filter(frame => frame.m === 'session.delta')
    .map(frame => frame.p as Record<string, unknown>)
}

/** The preset table the permission doubles serve unless a test says otherwise. */
const PRESET_TABLE: readonly PresetOptionFace[] = [
  { value: 'workspace-write', name: 'Workspace Write' },
  { value: 'danger-full-access', name: 'Full access', description: 'no confirmation steps' },
  { value: 'custom', name: 'Custom' },
]

/** One knob double: the session's own override plus the deployment default. */
interface KnobSpec {
  readonly override?: string
  readonly fallback?: string
}

/** What a permission double is built with. */
interface PermissionDoubleSpec {
  /** The preset the service reports as current; a test may switch it through `set`. */
  readonly preset?: string
  /** Ids the session store reports as live; defaults to `s-1`. */
  readonly live?: readonly string[]
  readonly sandbox?: KnobSpec
  readonly approval?: KnobSpec
}

/** The faces one {@link SessionPermissions} is built from, plus the switch log. */
interface PermissionDouble {
  readonly faces: PermissionFaces
  /** Every `set` call the service received, in order. */
  readonly switched: { readonly session: unknown; readonly id: string }[]
  /** The preset the double currently reports. */
  readonly state: { preset: string }
}

/** Build the permission services a host would mount, over one fixed table. */
function permissionDouble(spec: PermissionDoubleSpec = {}): PermissionDouble {
  const live = spec.live ?? ['s-1']
  const state = { preset: spec.preset ?? 'workspace-write' }
  const switched: { session: unknown; id: string }[] = []
  const faces: PermissionFaces = {
    sessions: { get: id => (live.includes(id) ? { id } : undefined) },
    presets: {
      catalog: () => ({ options: [...PRESET_TABLE] }),
      current: () => state.preset,
      set: (session, id) => {
        switched.push({ session, id })
        state.preset = id
      },
      optionOf: name => PRESET_TABLE.find(option => option.value === name) ?? { value: name, name },
    },
    ...(spec.sandbox === undefined
      ? {}
      : {
        sandbox: {
          ...(spec.sandbox.fallback === undefined ? {} : { defaultMode: spec.sandbox.fallback }),
          overrideOf: () => spec.sandbox?.override,
        },
      }),
    ...(spec.approval === undefined
      ? {}
      : {
        approval: {
          ...(spec.approval.fallback === undefined ? {} : { config: { policy: spec.approval.fallback } }),
          overrideOf: () => spec.approval?.override,
        },
      }),
  }
  return { faces, switched, state }
}

/** One connection over a permission double. */
function connectionWith(double: PermissionDouble, paired = true): ConnectionHarness {
  return makeConnection({ paired, permissions: new SessionPermissions(() => double.faces, () => {}) })
}

describe('protocol v1 composer parity: deltas', () => {
  it('user sees a prompt typed on the desktop as a user-message increment', async () => {
    // Given a phone subscribed to one session
    const harness = makeConnection({ paired: true })
    const follow = await subscribe(harness, 20)
    // When a durable user message arrives from another client
    follow.push(record('user/message', 2, {
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: 'ship it' }],
      source: { kind: 'user' },
    }))
    await settle()
    // Then it crosses as one increment, with no attachments key at all
    expect(deltasOf(harness)).toEqual([
      { sessionId: 's-1', kind: 'user-message', text: 'ship it', messageId: 'msg-1', actor: { kind: 'human', sourceKind: 'user' } },
    ])
  })

  it('user sees several text blocks joined in order while one image rides as an attachment', async () => {
    // Given a phone subscribed to one session
    const harness = makeConnection({ paired: true })
    const follow = await subscribe(harness, 21)
    // When a durable user message carries two text blocks around one image
    follow.push(record('user/message', 3, {
      id: 'msg-2',
      role: 'user',
      content: [
        { type: 'text', text: 'first' },
        { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 2048, width: 40, height: 30, name: 'shot.png' } },
        { type: 'text', text: 'second' },
      ],
      source: { kind: 'user' },
    }))
    await settle()
    // Then the text blocks are joined with newlines and the image is an attachment
    expect(deltasOf(harness)).toEqual([
      {
        sessionId: 's-1',
        kind: 'user-message',
        text: 'first\nsecond',
        messageId: 'msg-2',
        attachments: [{ attachmentId: 'att-1', mediaType: 'image/png', name: 'shot.png' }],
        actor: { kind: 'human', sourceKind: 'user' },
      },
    ])
  })

  it('user sees an image-only prompt with empty text and its attachment', async () => {
    // Given a phone subscribed to one session
    const harness = makeConnection({ paired: true })
    const follow = await subscribe(harness, 22)
    // When a durable user message carries an offloaded image and no text block
    follow.push(record('user/message', 4, {
      id: 'msg-3',
      role: 'user',
      content: [{ type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/webp', bytes: 90, width: 3, height: 3 }, offloaded: true }],
      source: { kind: 'user' },
    }))
    await settle()
    // Then the text is the empty string and the attachment has no name key
    expect(deltasOf(harness)).toEqual([
      {
        sessionId: 's-1',
        kind: 'user-message',
        text: '',
        messageId: 'msg-3',
        attachments: [{ attachmentId: 'att-2', mediaType: 'image/webp' }],
        actor: { kind: 'human', sourceKind: 'user' },
      },
    ])
  })

  it('user sees a replayed desktop prompt only once', async () => {
    // Given a phone that already received one durable user message
    const harness = makeConnection({ paired: true })
    const follow = await subscribe(harness, 23)
    const event = record('user/message', 5, { id: 'msg-4', role: 'user', content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } })
    follow.push(event)
    await settle()
    // When the same durable event arrives a second time
    follow.push(event)
    await settle()
    // Then the transcript gained one line, not two
    expect(deltasOf(harness)).toEqual([
      { sessionId: 's-1', kind: 'user-message', text: 'again', messageId: 'msg-4', actor: { kind: 'human', sourceKind: 'user' } },
    ])
  })

  it('user sees the token usage of a finished assistant message, field for field', async () => {
    // Given a phone subscribed to one session
    const harness = makeConnection({ paired: true })
    const follow = await subscribe(harness, 24)
    // When a durable assistant message reports its usage
    follow.push(record('assistant/message', 6, {
      turn: 2,
      step: 1,
      message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model' } },
      stream: [],
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, cacheReadTokens: 3 },
    }))
    await settle()
    // Then every reported counter crosses unconverted and unreported ones are absent
    expect(deltasOf(harness)).toEqual([
      {
        sessionId: 's-1',
        kind: 'usage',
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, cacheReadTokens: 3 },
        turn: 2,
        step: 1,
      },
    ])
  })

  it('user sees no usage increment when the assistant message reports none', async () => {
    // Given a phone subscribed to one session
    const harness = makeConnection({ paired: true })
    const follow = await subscribe(harness, 25)
    // When a durable assistant message carries no usage at all
    follow.push(record('assistant/message', 7, {
      turn: 1,
      step: 1,
      message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: 'hi' }], source: { kind: 'model' } },
      stream: [],
    }))
    await settle()
    // Then no delta is published: absent usage is not zero usage
    expect(deltasOf(harness)).toEqual([])
  })

  it('user still sees tool results, assembled calls, text and turn ends exactly as before', async () => {
    // Given a phone subscribed to one session
    const harness = makeConnection({ paired: true })
    const follow = await subscribe(harness, 26)
    // When the durable events from before this extension arrive
    follow.push(record('tool/result', 11, {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'exit 1' }], isError: true },
    }))
    follow.push(record('tool/call', 12, { turn: 1, step: 1, callId: 'call-2', name: 'read', arguments: '{"path":"a"}' }))
    follow.push(chunk(0, { type: 'text-delta', index: 0, text: 'Hel' }))
    follow.push(record('turn/end', 13, { turn: 1, reason: { kind: 'completed' } }))
    await settle()
    // Then every pre-existing delta keeps its own kind and fields
    expect(deltasOf(harness)).toEqual([
      { sessionId: 's-1', kind: 'tool-result', callId: 'call-1', output: 'exit 1', isError: true },
      { sessionId: 's-1', kind: 'tool-call', callId: 'call-2', name: 'read', argumentsDelta: '{"path":"a"}' },
      { sessionId: 's-1', kind: 'text', text: 'Hel', blockIndex: 0 },
      { sessionId: 's-1', kind: 'turn-end', reason: 'completed' },
    ])
  })
})

describe('protocol v1 composer parity: prompt attachments', () => {
  it('user prompts with images and the host receives text first, then each image in order', async () => {
    // Given a paired connection and a host that accepts prompts
    const harness = makeConnection({ paired: true })
    // When the user sends text with two images, the second unnamed
    await harness.connection.handleText(requestFrame(30, 'session.prompt', {
      sessionId: 's-1',
      text: 'compare',
      requestId: 'r-30',
      attachments: [
        { mediaType: 'image/png', data: 'QUJD', name: 'a.png' },
        { mediaType: 'image/jpeg', data: 'REVG' },
      ],
    }))
    // Then one queued message carries the text part and both image parts in order
    expect(answerOf(harness, 30).r).toEqual({ accepted: true })
    expect(harness.gateway.lastArgs('session', 'prompt')).toEqual({
      request: {
        requestId: 'r-30',
        sessionId: 's-1',
        mode: 'queue',
        content: [
          { type: 'text', text: 'compare' },
          { type: 'image', mediaType: 'image/png', data: 'QUJD', name: 'a.png' },
          { type: 'image', mediaType: 'image/jpeg', data: 'REVG' },
        ],
        clientTimeZone: 'Asia/Shanghai',
      },
    })
  })

  it('user prompts with an oversized attachment and nothing at all is sent', async () => {
    // Given a paired connection and a second image past the per-attachment budget
    const harness = makeConnection({ paired: true })
    const oversized = 'A'.repeat(PROMPT_ATTACHMENT_MAX_BYTES + 1)
    // When the user sends it beside a valid image
    await harness.connection.handleText(requestFrame(31, 'session.prompt', {
      sessionId: 's-1',
      text: 'hi',
      requestId: 'r-31',
      attachments: [
        { mediaType: 'image/png', data: 'QUJD', name: 'ok.png' },
        { mediaType: 'image/png', data: oversized, name: 'huge.png' },
      ],
    }))
    // Then the refusal names that attachment and its exact size, and the host
    // was neither prompted nor even subscribed to: no partial send exists
    const answer = answerOf(harness, 31)
    expect(answer.e?.code).toBe('invalid-args')
    expect(answer.e?.msg).toContain('huge.png')
    expect(answer.e?.msg).toContain(String(PROMPT_ATTACHMENT_MAX_BYTES + 1))
    expect(harness.gateway.invocations).toEqual([])
    expect(harness.gateway.streamRequests).toEqual([])
  })

  it('user prompts with an attachment that has no base64 body and is refused by name', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When one attachment arrives without its data
    await harness.connection.handleText(requestFrame(32, 'session.prompt', {
      sessionId: 's-1',
      text: 'hi',
      requestId: 'r-32',
      attachments: [{ mediaType: 'image/png', name: 'broken.png' }],
    }))
    // Then the refusal names the attachment and no prompt was sent
    const answer = answerOf(harness, 32)
    expect(answer.e?.code).toBe('invalid-args')
    expect(answer.e?.msg).toContain('broken.png')
    expect(harness.gateway.invocations).toEqual([])
  })
})

describe('protocol v1 composer parity: attachments', () => {
  it('user asks for one attachment and the harness value crosses unchanged', async () => {
    // Given a host that serves one durable image
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({
      attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'a.png' },
      data: 'QUJD',
    })
    // When the user reads it
    await harness.connection.handleText(requestFrame(40, 'session.attachment', { sessionId: 's-1', attachmentId: 'att-1' }))
    // Then the request rode the plain request key and the answer is the harness's own
    expect(harness.gateway.lastArgs('session', 'attachment')).toEqual({
      request: { sessionId: 's-1', attachmentId: 'att-1' },
    })
    expect(answerOf(harness, 40).r).toEqual({
      attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'a.png' },
      data: 'QUJD',
    })
  })

  it('user asks for an attachment larger than one frame and is refused as too large', async () => {
    // Given a host whose stored image cannot fit one frame
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({
      attachment: { attachmentId: 'att-2', mediaType: 'image/png', bytes: MAX_FRAME_BYTES, width: 1, height: 1 },
      data: 'A'.repeat(MAX_FRAME_BYTES),
    })
    // When the user reads it
    await harness.connection.handleText(requestFrame(41, 'session.attachment', { sessionId: 's-1', attachmentId: 'att-2' }))
    // Then the refusal says the frame is too large rather than answering without a body
    expect(answerOf(harness, 41).e?.code).toBe('frame-too-large')
  })
})

describe('protocol v1 composer parity: permissions', () => {
  it('user reads the permission modes and current is the folded value, never a default', async () => {
    // Given a session folded to the full-access preset
    const double = permissionDouble({ preset: 'danger-full-access' })
    const harness = connectionWith(double)
    // When the user asks for the modes
    await harness.connection.handleText(requestFrame(50, 'session.permissions', { sessionId: 's-1' }))
    // Then current is that preset with its label, and the switchable options never
    // include the derived custom value
    expect(answerOf(harness, 50).r).toEqual({
      current: { id: 'danger-full-access', name: 'Full access' },
      options: [
        { id: 'workspace-write', name: 'Workspace Write' },
        { id: 'danger-full-access', name: 'Full access', description: 'no confirmation steps' },
      ],
      custom: false,
    })
  })

  it('user reads a custom permission and the answer carries both real knob values', async () => {
    // Given a session whose knobs match no preset, with overrides that differ
    // from both deployment defaults
    const double = permissionDouble({
      preset: 'custom',
      sandbox: { override: 'read-only', fallback: 'workspace-write' },
      approval: { override: 'never', fallback: 'ask' },
    })
    const harness = connectionWith(double)
    // When the user asks for the modes
    await harness.connection.handleText(requestFrame(51, 'session.permissions', { sessionId: 's-1' }))
    // Then current is custom with the session's own two knob values, not the defaults
    const answer = answerOf(harness, 51)
    expect((answer.r as { current: unknown }).current).toEqual({
      id: 'custom',
      name: 'Custom',
      sandbox: 'read-only',
      approval: 'never',
    })
    expect((answer.r as { custom: boolean }).custom).toBe(true)
  })

  it('user reads a custom permission without overrides and the deployment defaults apply', async () => {
    // Given a session with no knob override that still matches no preset
    const double = permissionDouble({ preset: 'custom', sandbox: {}, approval: {} })
    const harness = connectionWith(double)
    // When the user asks for the modes
    await harness.connection.handleText(requestFrame(52, 'session.permissions', { sessionId: 's-1' }))
    // Then the real defaults fill the knobs instead of the keys being invented
    expect((answerOf(harness, 52).r as { current: unknown }).current).toEqual({
      id: 'custom',
      name: 'Custom',
      approval: 'ask',
    })
  })

  it('user reads the modes of a session this process does not hold and is refused by name', async () => {
    // Given a roster id that is not a live session of this host process
    const double = permissionDouble({ live: [] })
    const harness = connectionWith(double)
    // When the user asks for that session's modes
    await harness.connection.handleText(requestFrame(53, 'session.permissions', { sessionId: 's-9' }))
    // Then the harness's own not-found code crosses, with nothing invented
    expect(answerOf(harness, 53).e?.code).toBe('session/not-found')
  })

  it('user asks a host that composes no permission service and is told the method is unavailable', async () => {
    // Given a host without the permission plugin
    const harness = makeConnection({ paired: true })
    // When the user asks for the modes
    await harness.connection.handleText(requestFrame(54, 'session.permissions', { sessionId: 's-1' }))
    // Then the answer is the protocol's own "this host cannot" code
    expect(answerOf(harness, 54).e?.code).toBe('unknown-method')
  })

  it('user switches to a preset and the response carries the new current value', async () => {
    // Given a session on the workspace-write preset
    const double = permissionDouble()
    const harness = connectionWith(double)
    // When the user switches it to the full-access preset
    await harness.connection.handleText(requestFrame(55, 'session.setPermission', { sessionId: 's-1', id: 'danger-full-access' }))
    // Then the service was switched on that live session and the answer echoes it
    expect(double.switched).toEqual([{ session: { id: 's-1' }, id: 'danger-full-access' }])
    expect(answerOf(harness, 55).r).toEqual({ ok: true, current: { id: 'danger-full-access', name: 'Full access' } })
  })

  it('user switches to an id this host does not offer and nothing is switched', async () => {
    // Given a session on the workspace-write preset
    const double = permissionDouble()
    const harness = connectionWith(double)
    // When the user names the derived custom value, which is never a switch target
    await harness.connection.handleText(requestFrame(56, 'session.setPermission', { sessionId: 's-1', id: 'custom' }))
    // Then the refusal is about the argument and the service was never called
    expect(answerOf(harness, 56).e?.code).toBe('invalid-args')
    expect(double.switched).toEqual([])
    expect(double.state.preset).toBe('workspace-write')
  })

  it('user unpaired reaches for a permission mode and is refused before any service read', async () => {
    // Given an unpaired connection over live permission services
    const double = permissionDouble()
    const harness = connectionWith(double, false)
    // When the user asks for the modes
    await harness.connection.handleText(requestFrame(57, 'session.permissions', { sessionId: 's-1' }))
    // Then pairing is required and nothing was switched
    expect(answerOf(harness, 57).e?.code).toBe('unpaired')
    expect(double.switched).toEqual([])
  })
})

describe('protocol v1 composer parity: models', () => {
  /** One catalog answer, with a default the session may not be using. */
  const CATALOG = {
    default: { provider: 'p-1', model: 'default-model' },
    routableProviders: ['p-1'],
    groups: [{ id: 'p-1', name: 'Provider One', models: [{ id: 'default-model', name: 'Default' }, { id: 'next-model', name: 'Next' }] }],
    failures: [],
  }

  it('user reads models and current is the pending next selection, above the default', async () => {
    // Given a session with a pending selection and a different last-used one
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async call => (call.method === 'modelCatalog'
      ? CATALOG
      : { asOfSeq: 9, values: { modelSelection: { lastUsed: { provider: 'p-1', model: 'default-model' }, next: { provider: 'p-1', model: 'next-model', reasoningEffort: 'high' } } } })
    // When the user asks for the models
    await harness.connection.handleText(requestFrame(60, 'session.models', { sessionId: 's-1' }))
    // Then current is the pending selection, and the catalog crosses unchanged
    expect(answerOf(harness, 60).r).toEqual({
      current: { provider: 'p-1', model: 'next-model', reasoningEffort: 'high' },
      default: { provider: 'p-1', model: 'default-model' },
      groups: CATALOG.groups,
      failures: [],
    })
    expect(harness.gateway.lastArgs('session', 'modelCatalog')).toEqual({})
    expect(harness.gateway.lastArgs('session', 'projections')).toEqual({ request: { sessionId: 's-1' } })
  })

  it('user reads models with no pending selection and current falls back to last used', async () => {
    // Given a session whose last used selection differs from the catalog default
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async call => (call.method === 'modelCatalog'
      ? CATALOG
      : { asOfSeq: 9, values: { modelSelection: { lastUsed: { provider: 'p-1', model: 'next-model' }, next: null } } })
    // When the user asks for the models
    await harness.connection.handleText(requestFrame(61, 'session.models', { sessionId: 's-1' }))
    // Then current is the last used model, not the default
    expect((answerOf(harness, 61).r as { current: unknown }).current).toEqual({ provider: 'p-1', model: 'next-model' })
  })

  it('user reads models on a session that never ran and current is the catalog default', async () => {
    // Given a session with neither a pending nor a used selection
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async call => (call.method === 'modelCatalog'
      ? CATALOG
      : { asOfSeq: 0, values: { modelSelection: { lastUsed: null, next: null } } })
    // When the user asks for the models
    await harness.connection.handleText(requestFrame(62, 'session.models', { sessionId: 's-1' }))
    // Then the only truthful value left is the catalog default, and it is also reported as such
    const answer = answerOf(harness, 62).r as { current: unknown; default: unknown }
    expect(answer.current).toEqual({ provider: 'p-1', model: 'default-model' })
    expect(answer.default).toEqual({ provider: 'p-1', model: 'default-model' })
  })

  it('user switches the model and the host receives provider, model and effort, and the selection is echoed', async () => {
    // Given a host that accepts a model selection
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ selected: { provider: 'p-1', model: 'next-model', reasoningEffort: 'high' } })
    // When the user picks a model with an effort
    await harness.connection.handleText(requestFrame(63, 'session.setModel', {
      sessionId: 's-1',
      provider: 'p-1',
      model: 'next-model',
      effort: 'high',
    }))
    // Then the request carries the harness's own field name and the answer echoes it
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'next-model', reasoningEffort: 'high' },
    })
    expect(answerOf(harness, 63).r).toEqual({
      ok: true,
      current: { provider: 'p-1', model: 'next-model', reasoningEffort: 'high' },
    })
  })

  it('user switches the model without an effort and the request carries no effort key', async () => {
    // Given a host that accepts a model selection
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ selected: { provider: 'p-1', model: 'default-model' } })
    // When the user picks a model and nothing else
    await harness.connection.handleText(requestFrame(64, 'session.setModel', {
      sessionId: 's-1',
      provider: 'p-1',
      model: 'default-model',
    }))
    // Then no reasoningEffort key is invented and the echo is the harness's selection
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'default-model' },
    })
    expect(answerOf(harness, 64).r).toEqual({ ok: true, current: { provider: 'p-1', model: 'default-model' } })
  })
})

describe('protocol v1 composer parity: model efforts', () => {
  /** One catalog whose models publish their own efforts, beside a default nobody has chosen. */
  const EFFORT_CATALOG = {
    default: { provider: 'p-1', model: 'default-model' },
    routableProviders: ['p-1'],
    groups: [{
      id: 'p-1',
      name: 'Provider One',
      models: [
        { id: 'default-model', name: 'Default', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } },
        { id: 'next-model', name: 'Next', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } },
      ],
    }],
    failures: [],
  }

  /** One session on the catalog default, so the fold is a fact each test can name. */
  const ON_DEFAULT = { asOfSeq: 9, values: { modelSelection: { lastUsed: null, next: { provider: 'p-1', model: 'default-model' } } } }

  let directory: string
  let file: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-efforts-'))
    file = join(directory, 'model-efforts.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  /** One connection over the catalog above, sharing the given preference table. */
  function connectionOver(table: ModelEffortPreferences, onDefault = true): ConnectionHarness {
    const harness = makeConnection({ paired: true, modelEfforts: table })
    harness.gateway.handler = async call => {
      if (call.method === 'modelCatalog') return EFFORT_CATALOG
      if (call.method === 'projections') return onDefault ? ON_DEFAULT : { asOfSeq: 9, values: { modelSelection: { lastUsed: null, next: { provider: 'p-1', model: 'next-model', reasoningEffort: 'low' } } } }
      return { selected: { provider: 'p-1', model: 'next-model', reasoningEffort: 'high' } }
    }
    return harness
  }

  it('user reads models and only the remembered model carries preferredEffort', async () => {
    // Given a host that remembers "high" for one of the two models it publishes
    const table = new ModelEffortPreferences({ file })
    await table.save('p-1', 'next-model', 'high')
    const harness = connectionOver(table)
    // When the user reads the catalog
    await harness.connection.handleText(requestFrame(70, 'session.models', { sessionId: 's-1' }))
    // Then the remembered row names the level beside the catalog's own reasoning block, and the other row has no such key
    const groups = (answerOf(harness, 70).r as { groups: { models: Record<string, unknown>[] }[] }).groups
    expect(groups[0]?.models[0]).toEqual(EFFORT_CATALOG.groups[0]?.models[0])
    expect(Object.hasOwn(groups[0]?.models[0] ?? {}, 'preferredEffort')).toBe(false)
    expect(groups[0]?.models[1]).toEqual({ ...EFFORT_CATALOG.groups[0]?.models[1], preferredEffort: 'high' })
  })

  it('user sets the effort of a model the session is not on, and nothing is switched', async () => {
    // Given a session on the catalog default and a host that remembers nothing yet
    const table = new ModelEffortPreferences({ file })
    const harness = connectionOver(table)
    // When the user picks a level for the other model
    await harness.connection.handleText(requestFrame(71, 'session.setEffort', {
      sessionId: 's-1',
      provider: 'p-1',
      model: 'next-model',
      effort: 'high',
    }))
    // Then the table holds it, the session's own selection is untouched, and the harness was never asked to switch
    expect(answerOf(harness, 71).r).toEqual({
      ok: true,
      saved: { provider: 'p-1', model: 'next-model', effort: 'high' },
      current: { provider: 'p-1', model: 'default-model' },
    })
    expect(harness.gateway.countOf('session', 'selectModel')).toBe(0)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      efforts: [{ provider: 'p-1', model: 'next-model', effort: 'high' }],
    })
    // And the next read of the catalog publishes it, with the fold still the default
    await harness.connection.handleText(requestFrame(72, 'session.models', { sessionId: 's-1' }))
    const answer = answerOf(harness, 72).r as { current: unknown; groups: { models: Record<string, unknown>[] }[] }
    expect(answer.current).toEqual({ provider: 'p-1', model: 'default-model' })
    expect(answer.groups[0]?.models[1]?.preferredEffort).toBe('high')
  })

  it('user sets the effort of the model the session is on, and the new level is what it runs next', async () => {
    // Given a session already on the model whose level the user is changing
    const table = new ModelEffortPreferences({ file })
    const harness = connectionOver(table, false)
    // When the user picks another level for that same model
    await harness.connection.handleText(requestFrame(73, 'session.setEffort', {
      sessionId: 's-1',
      provider: 'p-1',
      model: 'next-model',
      effort: 'high',
    }))
    // Then the harness is asked to select the same model with the new level, and its answer is the current selection
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'next-model', reasoningEffort: 'high' },
    })
    expect(answerOf(harness, 73).r).toEqual({
      ok: true,
      saved: { provider: 'p-1', model: 'next-model', effort: 'high' },
      current: { provider: 'p-1', model: 'next-model', reasoningEffort: 'high' },
    })
  })

  it('user switches to a model with no effort of its own and the remembered level is what the harness is given', async () => {
    // Given a host that remembers "high" for the model the user is about to pick
    const table = new ModelEffortPreferences({ file })
    await table.save('p-1', 'next-model', 'high')
    const harness = connectionOver(table)
    // When the user switches to it without naming a level
    await harness.connection.handleText(requestFrame(74, 'session.setModel', { sessionId: 's-1', provider: 'p-1', model: 'next-model' }))
    // Then the request carries the remembered level
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'next-model', reasoningEffort: 'high' },
    })
    // When the user switches to a model this host remembers nothing for
    await harness.connection.handleText(requestFrame(75, 'session.setModel', { sessionId: 's-1', provider: 'p-1', model: 'default-model' }))
    // Then no effort key is invented
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'default-model' },
    })
  })

  it('user names a model or a level this host does not publish and the table is not written', async () => {
    // Given a host that remembers nothing
    const table = new ModelEffortPreferences({ file })
    const harness = connectionOver(table)
    // When the user names a model the catalog does not carry, then a level that model does not offer
    await harness.connection.handleText(requestFrame(76, 'session.setEffort', { sessionId: 's-1', provider: 'p-1', model: 'ghost-model', effort: 'high' }))
    await harness.connection.handleText(requestFrame(77, 'session.setEffort', { sessionId: 's-1', provider: 'p-1', model: 'default-model', effort: 'medium' }))
    // Then both are argument refusals, nothing was selected, and no table exists
    expect(answerOf(harness, 76).e?.code).toBe('invalid-args')
    expect(answerOf(harness, 77).e?.code).toBe('invalid-args')
    expect(table.effortOf('p-1', 'ghost-model')).toBeUndefined()
    expect(table.effortOf('p-1', 'default-model')).toBeUndefined()
    expect(harness.gateway.countOf('session', 'selectModel')).toBe(0)
    expect(await readFile(file, 'utf8').catch(() => undefined)).toBeUndefined()
  })

  it('operator restarts the bridge over the same data directory and the remembered levels are still there', async () => {
    // Given one process that remembered a level and wrote it to this host's file
    const first = new ModelEffortPreferences({ file })
    await first.load()
    await first.save('p-1', 'next-model', 'high')
    // When a second process reads the same file
    const second = new ModelEffortPreferences({ file })
    await second.load()
    // Then it answers the level the first one stored
    expect(second.effortOf('p-1', 'next-model')).toBe('high')
    expect(second.effortOf('p-1', 'default-model')).toBeUndefined()
  })

  it('operator leaves a corrupt effort file behind and the host reads it as an empty table without failing', async () => {
    // Given a file that is not the table
    await writeFile(file, 'not a table', 'utf8')
    const logs: string[] = []
    const table = new ModelEffortPreferences({ file, log: message => { logs.push(message) } })
    // When the host reads it
    await table.load()
    // Then the table is empty and the damage was reported once
    expect(table.effortOf('p-1', 'next-model')).toBeUndefined()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('continuing with an empty table')
  })

  it('operator leaves one unreadable row in the effort file and the readable rows survive the next write', async () => {
    // Given a file carrying one readable row and one row that names no model
    await writeFile(file, JSON.stringify({
      version: 1,
      efforts: [
        { provider: 'p-1', model: 'next-model', effort: 'high' },
        { provider: 'p-1', model: '', effort: 'low' },
      ],
    }), 'utf8')
    const logs: string[] = []
    const table = new ModelEffortPreferences({ file, log: message => { logs.push(message) } })
    // When this process reads it and remembers one more level
    await table.load()
    expect(table.effortOf('p-1', 'next-model')).toBe('high')
    await table.save('p-1', 'default-model', 'low')
    // Then the whole table was rewritten without losing the row it could read, and the bad row was counted once
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      efforts: [
        { provider: 'p-1', model: 'next-model', effort: 'high' },
        { provider: 'p-1', model: 'default-model', effort: 'low' },
      ],
    })
    expect(logs.filter(line => line.includes('dropped 1 unreadable row'))).toHaveLength(1)
  })

  it('user switches to a model whose remembered level the catalog no longer offers and no level is sent', async () => {
    // Given a host that remembers "high" for a model which has since stopped publishing it
    const logs: string[] = []
    const table = new ModelEffortPreferences({ file, log: message => { logs.push(message) } })
    await table.save('p-1', 'next-model', 'high')
    const harness = makeConnection({ paired: true, modelEfforts: table })
    harness.gateway.handler = async call => (call.method === 'modelCatalog'
      ? {
        ...EFFORT_CATALOG,
        groups: [{
          id: 'p-1',
          name: 'Provider One',
          models: [
            { id: 'default-model', name: 'Default', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } },
            { id: 'next-model', name: 'Next', reasoning: { efforts: [{ id: 'low' }], defaultEffort: 'low' } },
          ],
        }],
      }
      : { selected: { provider: 'p-1', model: 'next-model' } })
    // When the user switches to it without naming a level of its own
    await harness.connection.handleText(requestFrame(78, 'session.setModel', { sessionId: 's-1', provider: 'p-1', model: 'next-model' }))
    // Then the stale level is withheld rather than sent, and the row is gone so the model can be switched from now on
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'next-model' },
    })
    expect(table.effortOf('p-1', 'next-model')).toBeUndefined()
    expect(JSON.parse(await readFile(file, 'utf8')).efforts).toEqual([])
    expect(logs.filter(line => line.includes('dropped p-1/next-model = high'))).toHaveLength(1)
  })

  it('user picks a new level for a model while a switch for it is reading the catalog, and the newer level survives', async () => {
    // Given a host that remembers "high" for a model whose ladder has since dropped it
    const logs: string[] = []
    const table = new ModelEffortPreferences({ file, log: message => { logs.push(message) } })
    await table.save('p-1', 'next-model', 'high')
    const harness = makeConnection({ paired: true, modelEfforts: table })
    harness.gateway.handler = async call => {
      if (call.method === 'modelCatalog') {
        // The user drags the slider for the very model this switch is deciding about
        await table.save('p-1', 'next-model', 'medium')
        return {
          ...EFFORT_CATALOG,
          groups: [{ id: 'p-1', name: 'Provider One', models: [{ id: 'next-model', name: 'Next', reasoning: { efforts: [{ id: 'low' }], defaultEffort: 'low' } }] }],
        }
      }
      return { selected: { provider: 'p-1', model: 'next-model' } }
    }
    // When the switch that read that catalog settles
    await harness.connection.handleText(requestFrame(79, 'session.setModel', { sessionId: 's-1', provider: 'p-1', model: 'next-model' }))
    // Then the level the user just wrote is still the table's — the stale one that was judged is not the one that got dropped
    expect(table.effortOf('p-1', 'next-model')).toBe('medium')
    expect(JSON.parse(await readFile(file, 'utf8')).efforts).toEqual([{ provider: 'p-1', model: 'next-model', effort: 'medium' }])
    expect(logs.filter(line => line.includes('dropped p-1/next-model'))).toHaveLength(0)
    // And this switch carried no level, because the one it read had gone stale
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'next-model' },
    })
  })

  it('user switches to a model the catalog does not list this time, and the remembered level is kept', async () => {
    // Given a host that remembers a level for a model this catalog answer leaves out
    const logs: string[] = []
    const table = new ModelEffortPreferences({ file, log: message => { logs.push(message) } })
    await table.save('p-1', 'next-model', 'high')
    const harness = makeConnection({ paired: true, modelEfforts: table })
    harness.gateway.handler = async call => (call.method === 'modelCatalog'
      ? {
        ...EFFORT_CATALOG,
        groups: [{ id: 'p-1', name: 'Provider One', models: [{ id: 'default-model', name: 'Default', reasoning: { efforts: [{ id: 'low' }], defaultEffort: 'low' } }] }],
      }
      : { selected: { provider: 'p-1', model: 'next-model' } })
    // When the user switches to that model
    await harness.connection.handleText(requestFrame(80, 'session.setModel', { sessionId: 's-1', provider: 'p-1', model: 'next-model' }))
    // Then the level is withheld for this switch only, and the row survives for the answer that lists the model again
    expect(harness.gateway.lastArgs('session', 'selectModel')).toEqual({
      request: { sessionId: 's-1', provider: 'p-1', model: 'next-model' },
    })
    expect(table.effortOf('p-1', 'next-model')).toBe('high')
    expect(JSON.parse(await readFile(file, 'utf8')).efforts).toEqual([{ provider: 'p-1', model: 'next-model', effort: 'high' }])
    expect(logs.filter(line => line.includes('dropped'))).toHaveLength(0)
  })
})

describe('protocol v1 composer parity: method set', () => {
  it('operator reads the method set and finds every composer method in it', () => {
    // Given the frozen method set of this protocol version
    const composer = [
      METHOD_SESSION_ATTACHMENT,
      METHOD_SESSION_PERMISSIONS,
      METHOD_SESSION_SET_PERMISSION,
      METHOD_SESSION_MODELS,
      METHOD_SESSION_SET_MODEL,
      METHOD_SESSION_SET_EFFORT,
    ]
    // When the composer methods are looked up
    const missing = composer.filter(method => !KNOWN_METHODS.has(method))
    // Then every one of them is served, and the pre-existing set is untouched
    expect(missing).toEqual([])
    expect([...composer]).toEqual([
      'session.attachment',
      'session.permissions',
      'session.setPermission',
      'session.models',
      'session.setModel',
      'session.setEffort',
    ])
    expect(KNOWN_METHODS.has(METHOD_APPROVAL_RESOLVE)).toBe(true)
    // The question channel, the job channel, the deep-history channel and the
    // question list each added exactly one more method to the frozen set, the
    // agent channel two, the usage channel two, the session-admin channel six, the
    // usage stats channel one, the interactive-reply channel two (ui.event and
    // ui.list), the effort preference one (session.setEffort), and the second
    // meeting point one (relay.grant, which only a host configured with that
    // meeting point serves); none renamed or removed one.
    expect(KNOWN_METHODS.size).toBe(43)
  })
})
