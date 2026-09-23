/**
 * working-context: the one-line recency projection. Fields fold from the
 * durable session events (plan/mode, tool_activate calls, todo/write), unread
 * fields are omitted, an all-empty state injects nothing, and the persistent
 * message republishes only when the rendered line changes or leaves the
 * visible surface.
 */

import { describe, expect, test } from 'vitest'

import {
  apply,
  createContextMessage,
  inProgressTodos,
  name,
  planModeState,
  renderWorkingContext,
} from '../presets/liangshen/working-context.mjs'

type Listener = (first: any, second: any, third: any) => Promise<any>

function register(config: Record<string, unknown> = {}) {
  const listeners = new Map<string, { listener: Listener, options: any }>()
  const ctx = {
    on(event: string, callback: Listener, options?: any) {
      listeners.set(event, { listener: callback, options })
    },
  }
  apply(ctx as never, config)
  return { listeners }
}

function listenerOf(harness: ReturnType<typeof register>, event: string): Listener {
  const entry = harness.listeners.get(event)
  expect(entry).toBeDefined()
  return entry!.listener
}

function agentOf(events: unknown[] = [], surface?: number[]) {
  const session: any = { snapshotEvents: () => events }
  if (surface !== undefined) session.surface = { nodes: surface }
  return { session }
}

async function preStep(harness: ReturnType<typeof register>, agent: unknown, messages: unknown[] = [{ id: 'user', source: { kind: 'user' } }]) {
  return listenerOf(harness, 'agent/pre-step')(
    { agent, messages, turn: 1, step: 1, signal: {} },
    async () => ({ kind: 'enter', messages }),
  )
}

function contextOf(messages: unknown[]) {
  return messages.find((message: any) => message?.source?.kind === name || message?.source?.plugin === name)
}

function activation(namespace: string, callId: string) {
  return [
    { type: 'tool/call', data: { callId, name: 'tool_activate', arguments: JSON.stringify({ namespace }) } },
    { type: 'tool/result', data: { message: { source: { callId }, content: [{ type: 'text', text: 'ok' }] } } },
  ]
}

describe('liangshen-working-context', () => {
  test('exports a diagnostic plugin name and prepends its pre-step hook', () => {
    expect(name).toBe('liangshen-working-context')
    const harness = register()
    expect(harness.listeners.get('agent/pre-step')?.options).toMatchObject({ prepend: true })
  })

  test('folds plan mode from the last plan/mode event', () => {
    expect(planModeState([])).toEqual({ seen: false, active: false })
    expect(planModeState([{ type: 'plan/mode', data: { active: true } }])).toEqual({ seen: true, active: true })
    expect(planModeState([
      { type: 'plan/mode', data: { active: true } },
      { type: 'plan/mode', data: { active: false } },
    ])).toEqual({ seen: true, active: false })
    expect(planModeState([{ type: 'plan/mode', data: {} }])).toEqual({ seen: false, active: false })
  })

  test('folds in-progress todos from the latest todo/write, cleared by turn/start', () => {
    const write = { type: 'todo/write', data: { todos: [
      { content: 'Fix auth', status: 'in_progress' },
      { content: 'Done thing', status: 'completed' },
      { content: 'Later', status: 'pending' },
      { content: 'Update docs', status: 'in_progress' },
    ] } }
    expect(inProgressTodos([write])).toEqual(['Fix auth', 'Update docs'])
    expect(inProgressTodos([write, { type: 'turn/start' }])).toEqual([])
    expect(inProgressTodos([{ type: 'turn/start' }, write])).toEqual(['Fix auth', 'Update docs'])
    expect(inProgressTodos([])).toEqual([])
  })

  test('renders only the fields the log has evidence for', () => {
    expect(renderWorkingContext([])).toBeUndefined()
    // Plan mode renders only once a plan/mode event exists.
    expect(renderWorkingContext([{ type: 'plan/mode', data: { active: true } }]))
      .toBe('[Working Context: plan mode: on]')
    expect(renderWorkingContext([{ type: 'plan/mode', data: { active: false } }]))
      .toBe('[Working Context: plan mode: off]')
    // Active namespaces render sorted for byte-stable dedup.
    expect(renderWorkingContext([...activation('ssh', 'c1'), ...activation('github', 'c2')]))
      .toBe('[Working Context: active namespaces: github, ssh]')
    expect(renderWorkingContext([{ type: 'todo/write', data: { todos: [{ content: 'Fix auth', status: 'in_progress' }] } }]))
      .toBe('[Working Context: in progress: Fix auth]')
  })

  test('renders the full line with every field present', () => {
    const line = renderWorkingContext([
      { type: 'plan/mode', data: { active: true } },
      ...activation('github', 'c1'),
      { type: 'todo/write', data: { todos: [{ content: 'Fix auth', status: 'in_progress' }] } },
    ])
    expect(line).toBe('[Working Context: plan mode: on | active namespaces: github | in progress: Fix auth]')
  })

  test('clips long titles and collapses the rest', () => {
    const long = 'x'.repeat(120)
    const line = renderWorkingContext([{ type: 'todo/write', data: { todos: [
      { content: long, status: 'in_progress' },
      { content: 'two', status: 'in_progress' },
      { content: 'three', status: 'in_progress' },
      { content: 'four', status: 'in_progress' },
    ] } }])
    expect(line).toContain('x'.repeat(77) + '...')
    expect(line).toContain('; two; three; +1 more]')
    expect(line).not.toContain('four')
  })

  test('injects nothing when no field has anything to say', async () => {
    const harness = register()
    const result = await preStep(harness, agentOf([]))
    expect(result.messages).toHaveLength(1)
  })

  test('injects the line as a durable plugin message after the user message', async () => {
    const harness = register()
    const agent = agentOf([{ type: 'plan/mode', data: { active: true } }])
    const result = await preStep(harness, agent)
    expect(result.messages.map((message: any) => message.id)).toEqual(['user', expect.any(String)])
    const message = contextOf(result.messages)
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: name })
    expect(message.content[0].text).toBe('[Working Context: plan mode: on]')
  })

  test('does not republish while the same line is still visible', async () => {
    const harness = register()
    const events = [
      { type: 'plan/mode', data: { active: true } },
      { type: 'user/message', seq: 2, data: createContextMessage('[Working Context: plan mode: on]') },
    ]
    const agent = agentOf(events, [2])
    const result = await preStep(harness, agent)
    expect(result.messages).toHaveLength(1)
  })

  test('republishes when the state changed', async () => {
    const harness = register()
    const events = [
      { type: 'plan/mode', data: { active: true } },
      { type: 'user/message', seq: 2, data: createContextMessage('[Working Context: plan mode: on]') },
      ...activation('github', 'c1'),
    ]
    const agent = agentOf(events, [2])
    const result = await preStep(harness, agent)
    const message = contextOf(result.messages)
    expect(message.content[0].text).toBe('[Working Context: plan mode: on | active namespaces: github]')
  })

  test('republishes after a compaction shadows the published line', async () => {
    const harness = register()
    const events = [
      { type: 'plan/mode', data: { active: true } },
      { type: 'user/message', seq: 2, data: createContextMessage('[Working Context: plan mode: on]') },
    ]
    // seq 2 is no longer on the visible surface.
    const agent = agentOf(events, [9])
    const result = await preStep(harness, agent)
    expect(contextOf(result.messages)).toBeDefined()
  })

  test('drops a stale batch copy when the state went empty', async () => {
    const harness = register()
    const stale = createContextMessage('[Working Context: plan mode: on]')
    const result = await preStep(harness, agentOf([]), [{ id: 'user', source: { kind: 'user' } }, stale])
    expect(result.messages.map((message: any) => message.id)).toEqual(['user'])
  })

  test('leaves a rejected step decision untouched', async () => {
    const harness = register()
    const result = await listenerOf(harness, 'agent/pre-step')(
      { agent: agentOf([]), messages: [], turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'reject' }),
    )
    expect(result).toEqual({ kind: 'reject' })
  })

  test('rejects invalid paging config', () => {
    expect(() => register({ pagedToolPatterns: 'mcp__*' })).toThrow(/pagedToolPatterns must be an array/)
    expect(() => register({ maxActiveNamespaces: 0 })).toThrow(/maxActiveNamespaces must be an integer >= 1/)
  })
})
