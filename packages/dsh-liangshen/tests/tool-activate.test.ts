/**
 * tool_activate and the paging helpers: namespace derivation, wire partition,
 * LRU replay from the durable event stream, and the tool's own validation and
 * eviction reporting. The activation state must rebuild from session events
 * alone — resume, reload, and compaction recovery depend on it.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_ACTIVE_NAMESPACES,
  namespaceOf,
  partitionWireTools,
  patternNamespace,
  replayActivations,
  summarizeInactive,
  validatePagedToolPatterns,
} from '../presets/liangshen/paging.mjs'
import { apply, name } from '../presets/liangshen/tool-activate.mjs'

/** A successful tool call/result pair in the durable log. */
function call(callId: string, toolName: string, args: unknown) {
  return [
    { type: 'tool/call', data: { callId, name: toolName, arguments: JSON.stringify(args) } },
    { type: 'tool/result', data: { message: { source: { callId }, content: [{ type: 'text', text: 'ok' }] } } },
  ]
}

function activation(namespace: string, callId: string) {
  return call(callId, 'tool_activate', { namespace })
}

function erroredActivation(namespace: string, callId: string) {
  return [
    { type: 'tool/call', data: { callId, name: 'tool_activate', arguments: JSON.stringify({ namespace }) } },
    { type: 'tool/result', data: { message: { source: { callId }, content: [{ type: 'text', text: 'boom', isError: true }] } } },
  ]
}

describe('paging helpers', () => {
  it('derives namespaces from prefix patterns', () => {
    expect(patternNamespace('mcp__codegraph__codegraph_explore', 'mcp__*')).toBe('codegraph')
    expect(patternNamespace('mcp__github__create_issue', 'mcp__*')).toBe('github')
    expect(patternNamespace('mcp__github__create_issue', 'mcp__github__*')).toBe('create_issue')
    expect(patternNamespace('read', 'mcp__*')).toBeUndefined()
    expect(patternNamespace('mcp__', 'mcp__*')).toBeUndefined()
    expect(namespaceOf('mcp__a__x', ['zzz_*', 'mcp__*'])).toBe('a')
    expect(namespaceOf('read', ['mcp__*'])).toBeUndefined()
  })

  it('validates the pattern config', () => {
    expect(validatePagedToolPatterns('p', undefined)).toEqual(['mcp__*'])
    expect(validatePagedToolPatterns('p', ['foo_*'])).toEqual(['foo_*'])
    expect(() => validatePagedToolPatterns('p', 'mcp__*' as never)).toThrow(/must be an array/)
    expect(() => validatePagedToolPatterns('p', [''])).toThrow(/non-empty/)
    expect(() => validatePagedToolPatterns('p', ['mcp__'])).toThrow(/trailing/)
    expect(() => validatePagedToolPatterns('p', ['m*p__*'])).toThrow(/trailing/)
  })

  it('partitions the wire into resident tools and inactive namespaces', () => {
    const wire = [
      { name: 'bash' },
      { name: 'mcp__github__create_issue' },
      { name: 'mcp__github__list_prs' },
      { name: 'mcp__codegraph__explore' },
    ]
    const { resident, inactive } = partitionWireTools(wire, ['mcp__*'], new Set())
    expect(resident.map((tool: any) => tool.name)).toEqual(['bash'])
    expect([...inactive.keys()]).toEqual(['codegraph', 'github'])
    expect(inactive.get('github')?.map((tool: any) => tool.name)).toEqual(['mcp__github__create_issue', 'mcp__github__list_prs'])

    const activated = partitionWireTools(wire, ['mcp__*'], new Set(['github']))
    expect(activated.resident.map((tool: any) => tool.name)).toEqual(['bash', 'mcp__github__create_issue', 'mcp__github__list_prs'])
    expect([...activated.inactive.keys()]).toEqual(['codegraph'])
  })

  it('replays activations from the event stream, oldest-first, with LRU eviction', () => {
    const events = [
      ...activation('github', 'c1'),
      ...activation('codegraph', 'c2'),
      ...activation('ssh', 'c3'),
      // The fourth activation evicts the least recently used (github).
      ...activation('docker', 'c4'),
    ]
    const { active, evicted } = replayActivations(events, DEFAULT_MAX_ACTIVE_NAMESPACES, ['mcp__*'])
    expect(active).toEqual(['codegraph', 'ssh', 'docker'])
    expect(evicted).toEqual(['github'])
  })

  it('refreshes recency on re-activation and on use of an active namespace', () => {
    const events = [
      ...activation('github', 'c1'),
      ...activation('codegraph', 'c2'),
      ...activation('ssh', 'c3'),
      // Using a github tool refreshes github, so the next activation evicts codegraph.
      ...call('c4', 'mcp__github__list_prs', {}),
      ...activation('docker', 'c5'),
    ]
    const { active, evicted } = replayActivations(events, 3, ['mcp__*'])
    expect(active).toEqual(['ssh', 'github', 'docker'])
    expect(evicted).toEqual(['codegraph'])
  })

  it('ignores errored activations and tolerates string arguments', () => {
    const events = [
      ...erroredActivation('github', 'c1'),
      ...activation('ssh', 'c2'),
    ]
    const { active } = replayActivations(events, 3, ['mcp__*'])
    expect(active).toEqual(['ssh'])
  })

  it('summarizes inactive namespaces with count, sample, and description', () => {
    const wire = [
      { name: 'mcp__github__list_prs', description: 'List pull requests.' },
      { name: 'mcp__github__create_issue', description: 'Create an issue.' },
    ]
    const { inactive } = partitionWireTools(wire, ['mcp__*'], new Set())
    const summaries = summarizeInactive(inactive, (d: string) => d)
    expect(summaries).toEqual([
      { namespace: 'github', count: 2, sample: 'mcp__github__create_issue', description: 'Create an issue.' },
    ])
  })
})

describe('liangshen-tool-activate', () => {
  const SCHEMAS = [
    { name: 'bash', description: 'shell' },
    { name: 'mcp__github__create_issue', description: 'Create an issue.' },
    { name: 'mcp__github__list_prs', description: 'List prs.' },
    { name: 'mcp__codegraph__explore', description: 'Explore.' },
  ]

  function makeCtx(events: unknown[] = [], selfCallId = 'self-1') {
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      tools: {
        register: (spec: Record<string, unknown>) => { registered.push(spec) },
        schemas: () => SCHEMAS,
      },
      get: () => undefined,
    } as never
    const exec = {
      callId: selfCallId,
      agent: { session: { snapshotEvents: () => events } },
    } as never
    return { ctx, registered, exec }
  }

  async function executeOf(m: ReturnType<typeof makeCtx>, namespace: string) {
    expect(m.registered).toHaveLength(1)
    const tool = m.registered[0]
    expect(tool.name).toBe('tool_activate')
    const execute = tool.execute as (args: Record<string, unknown>, exec: never) => Promise<{ text: string }>
    return execute({ namespace }, m.exec)
  }

  it('exports a diagnostic plugin name and requires the tools registry', async () => {
    expect(name).toBe('liangshen-tool-activate')
    const mod = await import('../presets/liangshen/tool-activate.mjs')
    expect(mod.inject).toEqual(['tools'])
  })

  it('declares the activation call concurrency-safe so it can overlap', () => {
    // The host scheduler classifies a call through `isConcurrencySafe`: only an
    // exact true joins a parallel group, everything else forms a barrier. The
    // handler only reads the event stream and reports, so it must not serialize
    // against independent read-only siblings.
    const m = makeCtx()
    apply(m.ctx, {})
    const tool = m.registered[0]
    const classify = tool.isConcurrencySafe as (args: Record<string, unknown>) => unknown
    expect(typeof classify).toBe('function')
    expect(classify({ namespace: 'github' })).toBe(true)
  })

  it('registers a minimal namespace-only schema', () => {
    const m = makeCtx()
    apply(m.ctx, {})
    const tool = m.registered[0]
    const schema = tool.parameters as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
    expect(schema.required).toEqual(['namespace'])
    expect(Object.keys(schema.properties)).toEqual(['namespace'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('activates an inactive paged namespace and names its tools', async () => {
    const m = makeCtx()
    apply(m.ctx, {})
    const result = await executeOf(m, 'github')
    expect(result.text).toContain('Activated namespace "github" (2 tools): mcp__github__create_issue, mcp__github__list_prs.')
    expect(result.text).toContain('on the wire from the next request')
  })

  it('rejects an unknown namespace with the available list', async () => {
    const m = makeCtx()
    apply(m.ctx, {})
    await expect(executeOf(m, 'docker')).rejects.toThrow(/unknown paged namespace "docker".*"codegraph", "github"/)
  })

  it('rejects a namespace whose activation is already in the log', async () => {
    const m = makeCtx(activation('github', 'past-1'))
    apply(m.ctx, {})
    await expect(executeOf(m, 'github')).rejects.toThrow(/namespace "github" is already active/)
  })

  it('does not mistake its own in-flight call for a prior activation', async () => {
    // The harness appends the tool/call event before executing: the log already
    // carries THIS call. The tool must exclude it when testing "already active".
    const m = makeCtx([
      { type: 'tool/call', data: { callId: 'self-1', name: 'tool_activate', arguments: '{"namespace":"github"}' } },
    ])
    apply(m.ctx, {})
    const result = await executeOf(m, 'github')
    expect(result.text).toContain('Activated namespace "github"')
  })

  it('reports the LRU eviction when activating beyond the cap', async () => {
    const events = [
      ...activation('github', 'c1'),
      ...activation('codegraph', 'c2'),
      ...activation('ssh', 'c3'),
    ]
    const schemasWithSsh = [...SCHEMAS, { name: 'mcp__ssh__exec', description: 'Run ssh.' }, { name: 'mcp__docker__ps', description: 'List containers.' }]
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      tools: { register: (spec: Record<string, unknown>) => { registered.push(spec) }, schemas: () => schemasWithSsh },
      get: () => undefined,
    } as never
    apply(ctx, {})
    const execute = registered[0].execute as (args: Record<string, unknown>, exec: never) => Promise<{ text: string }>
    const result = await execute({ namespace: 'docker' }, {
      callId: 'self-1',
      agent: { session: { snapshotEvents: () => events } },
    } as never)
    expect(result.text).toContain('Activated namespace "docker"')
    expect(result.text).toContain('Least recently used namespace "github" was paged out (capacity 3)')
  })
})
