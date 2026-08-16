// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConnectionHandle, MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createEditableUserMessageNode, findEditableConversationMessage } from './ConversationEditAction.tsx'

const sessionId = 'session-1' as SessionId
const assistantId = 'assistant-1' as MessageId

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId,
    views: {} as ConversationSnapshot['views'],
    chat: {} as ConversationSnapshot['chat'],
    nodes: [
      {
        kind: 'user',
        seq: 1,
        time: 1,
        content: [{ type: 'text', text: '原始问题' }],
        source: { kind: 'user' },
      },
      {
        kind: 'assistant',
        seq: 3,
        time: 3,
        turn: 1,
        step: 1,
        blocks: [],
        messageId: assistantId,
      },
    ],
    turnTimings: new Map([[1, { startTime: 1, endTime: 3 }]]),
    turnEnds: new Map([[1, 3]]),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'idle' as never,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...overrides,
  } as unknown as ConversationSnapshot
}

function userNode(data: unknown = snapshot().nodes[0]): unknown {
  return {
    key: 'user-1',
    kind: 'user',
    id: 'user-1',
    target: 'chat',
    anchorSeq: 1,
    location: { kind: 'turn', turn: 1, step: 1 },
    visibility: 'visible',
    data,
  }
}

function props(current: ConversationSnapshot, data: unknown = current.nodes[0]): Record<string, unknown> {
  const useSession = <T,>(selector: (value: ConversationSnapshot) => T): T => selector(current)
  const useSessions = <T,>(selector: (value: { byId: Record<string, { id: SessionId; cwd: string }> }) => T): T => selector({
    byId: { [sessionId]: { id: sessionId, cwd: 'C:\\workspace' } },
  })
  return {
    node: userNode(data),
    useSession,
    useSessions,
    useProjection: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    sessionId,
    selectedCallId: undefined,
    cwd: 'C:\\workspace',
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    loadImage: vi.fn().mockResolvedValue('data:image/png;base64,image'),
    fileMentions: vi.fn(),
    hooks: {},
  }
}

const translate = ((key: string) => key) as never

afterEach(() => { cleanup() })

describe('desktop inline conversation edit', () => {
  it('only accepts the latest settled human text message', () => {
    expect(findEditableConversationMessage(snapshot(), 1)).toEqual({ seq: 1, text: '原始问题' })
    expect(findEditableConversationMessage(snapshot(), 99)).toBeUndefined()
    expect(findEditableConversationMessage(snapshot({ running: true }), 1)).toBeUndefined()
    expect(findEditableConversationMessage(snapshot({ nodes: [
      { kind: 'user', seq: 1, time: 1, content: [{ type: 'image', data: 'x' } as never], source: { kind: 'user' } },
      snapshot().nodes[1]!,
    ] }), 1)).toBeUndefined()
    expect(findEditableConversationMessage(snapshot({ nodes: [
      { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: '注入' }], source: { kind: 'plugin' } },
      snapshot().nodes[1]!,
    ] }), 1)).toBeUndefined()
  })

  it('accepts the latest human text message after a failed model request', () => {
    const failed = snapshot({
      nodes: [
        ...snapshot().nodes,
        { kind: 'user', seq: 4, time: 4, content: [{ type: 'text', text: '失败的问题' }], source: { kind: 'user' } },
      ],
      promptError: { message: 'request failed' } as never,
      lastAgentError: { message: 'request failed' } as never,
    })

    expect(findEditableConversationMessage(failed, 1)).toBeUndefined()
    expect(findEditableConversationMessage(failed, 4)).toEqual({ seq: 4, text: '失败的问题' })
  })

  it('renders the pencil in the user bubble and opens an inline editor', () => {
    const sessions = { binding: vi.fn(), open: vi.fn() } as unknown as ISessions
    const connection = {} as ConnectionHandle
    const Node = createEditableUserMessageNode(sessions, connection, translate)
    render(<Node {...props(snapshot()) as unknown as Parameters<typeof Node>[0]} />)

    expect(screen.getByRole('button', { name: 'conversation.edit' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'conversation.edit' }))
    expect((screen.getByRole('textbox', { name: 'conversation.edit.input' }) as HTMLTextAreaElement).value).toBe('原始问题')
    expect(screen.getByRole('button', { name: 'conversation.edit.cancel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'conversation.edit.cancel' }))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('sends the replacement in a new first-turn session', async () => {
    const childId = 'session-child' as SessionId
    const prompt = vi.fn().mockResolvedValue({ result: { ok: true, value: { accepted: true } } })
    const create = vi.fn().mockResolvedValue({ result: { ok: true, value: { sessionId: childId } } })
    const models = vi.fn().mockResolvedValue({ result: { ok: true, value: { current: { provider: 'p', model: 'm' } } } })
    const selectModel = vi.fn().mockResolvedValue({ result: { ok: true, value: { selected: { provider: 'p', model: 'm' } } } })
    const open = vi.fn()
    const sessions = {
      binding: vi.fn(() => ({ sessionId: childId, session: {} })),
      open,
    } as unknown as ISessions
    const connection = { api: { sessions: { create, models, selectModel, prompt } } } as unknown as ConnectionHandle
    const Node = createEditableUserMessageNode(sessions, connection, translate)
    render(<Node {...props(snapshot()) as unknown as Parameters<typeof Node>[0]} />)

    fireEvent.click(screen.getByRole('button', { name: 'conversation.edit' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '修改后的问题' } })
    fireEvent.click(screen.getByRole('button', { name: 'conversation.edit.save' }))
    await waitFor(() => expect(prompt).toHaveBeenCalledWith({
      sessionId: childId,
      mode: 'queue',
      content: [{ type: 'text', text: '修改后的问题' }],
    }))
    expect(create).toHaveBeenCalledWith({ cwd: 'C:\\workspace' })
    expect(models).toHaveBeenCalledWith({ sessionId })
    expect(selectModel).toHaveBeenCalledWith({ sessionId: childId, provider: 'p', model: 'm' })
    expect(open).toHaveBeenCalledWith(childId)
  })

  it('forks from the previous completed boundary for later turns', async () => {
    const childId = 'session-child' as SessionId
    const fork = vi.fn().mockResolvedValue(childId)
    const prompt = vi.fn().mockResolvedValue({ result: { ok: true, value: { accepted: true } } })
    const open = vi.fn()
    const sessions = {
      binding: vi.fn(() => ({ sessionId: childId, session: {} })),
      fork,
      open,
    } as unknown as ISessions
    const connection = { api: { sessions: { prompt } } } as unknown as ConnectionHandle
    const laterTurn = snapshot({
      nodes: [
        snapshot().nodes[0]!,
        snapshot().nodes[1]!,
        { kind: 'user', seq: 4, time: 4, content: [{ type: 'text', text: '第二个问题' }], source: { kind: 'user' } },
        { kind: 'assistant', seq: 6, time: 6, turn: 2, step: 1, blocks: [], messageId: assistantId },
      ],
      turnTimings: new Map([[1, { startTime: 1, endTime: 3 }], [2, { startTime: 4, endTime: 6 }]]),
      turnEnds: new Map([[1, 3], [2, 6]]),
    })
    const Node = createEditableUserMessageNode(sessions, connection, translate)
    render(<Node {...props(laterTurn, laterTurn.nodes[2]) as unknown as Parameters<typeof Node>[0]} />)

    fireEvent.click(screen.getByRole('button', { name: 'conversation.edit' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '替换第二个问题' } })
    fireEvent.click(screen.getByRole('button', { name: 'conversation.edit.save' }))
    await waitFor(() => expect(prompt).toHaveBeenCalledWith({
      sessionId: childId,
      mode: 'queue',
      content: [{ type: 'text', text: '替换第二个问题' }],
    }))
    expect(fork).toHaveBeenCalledWith({ sessionId, atSeq: 3 })
    expect(open).toHaveBeenCalledWith(childId)
  })
})
