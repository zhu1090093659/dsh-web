/**
 * tool_activate and the paging helpers: namespace derivation, wire partition,
 * LRU replay from the durable event stream, and the tool's own validation and
 * eviction reporting. The activation state must rebuild from session events
 * alone — resume, reload, and compaction recovery depend on it.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_ACTIVE_NAMESPACES,
  DEFAULT_PAGED_TOOL_PATTERNS,
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

/** One activation dispatched from inside a program, the way ptc records it. */
function dispatch(namespace: string, subCallId: string, isError = false) {
  return [{
    type: 'tool/ptc-dispatch',
    data: {
      rootCallId: 'call_root',
      parentCallId: 'call_root',
      subCallId,
      name: 'tool_activate',
      arguments: { namespace },
      isError,
      content: [{ type: 'text', text: isError ? 'unknown paged namespace' : 'Activated' }],
    },
  }]
}

/**
 * One ordinary tool call dispatched from inside a program, the way ptc records
 * it: under the default presentation a top-level `tool/call` is always
 * `run_code`, so this is the only shape a real tool call takes.
 */
function toolDispatch(toolName: string, subCallId: string, isError = false) {
  return [{
    type: 'tool/ptc-dispatch',
    data: {
      rootCallId: 'call_root',
      parentCallId: 'call_root',
      subCallId,
      name: toolName,
      arguments: {},
      isError,
      content: [{ type: 'text', text: isError ? 'boom' : 'ok' }],
    },
  }]
}

describe('paging helpers', () => {
  it('operator gets namespaces derived from prefix patterns', () => {
    // Given a wire name and the patterns a profile declares
    // When the name is resolved against the pattern chain
    // Then the middle segment is the namespace, and a name no pattern claims has none
    expect(patternNamespace('mcp__codegraph__codegraph_explore', 'mcp__*')).toBe('codegraph')
    expect(patternNamespace('mcp__github__create_issue', 'mcp__*')).toBe('github')
    expect(patternNamespace('mcp__github__create_issue', 'mcp__github__*')).toBe('create_issue')
    expect(patternNamespace('read', 'mcp__*')).toBeUndefined()
    expect(patternNamespace('mcp__', 'mcp__*')).toBeUndefined()
    expect(namespaceOf('mcp__a__x', ['zzz_*', 'mcp__*'])).toBe('a')
    expect(namespaceOf('read', ['mcp__*'])).toBeUndefined()
  })

  it('operator gets a plugin family named by the pattern head, not by the tool name', () => {
    // Given the shipped plugin patterns and the tool names they claim
    // When each name is resolved against its own pattern
    // Then the family is the pattern's head with one trailing "_" dropped, so one
    //      plugin's whole family shares one namespace
    expect(patternNamespace('task_board_create', 'task_board_*')).toBe('task_board')
    expect(patternNamespace('task_board_list', 'task_board_*')).toBe('task_board')
    expect(patternNamespace('browser_navigate', 'browser_*')).toBe('browser')
    expect(patternNamespace('team_comment', 'team_*')).toBe('team')
    expect(patternNamespace('ui_present', 'ui_*')).toBe('ui')
    expect(patternNamespace('ssh_exec', 'ssh_*')).toBe('ssh')
    // "squad*" carries no separator of its own, so it covers both spellings.
    expect(patternNamespace('squads_create', 'squad*')).toBe('squad')
    expect(patternNamespace('squad_member_add', 'squad*')).toBe('squad')
    // The MCP derivation is untouched: a "__"-headed pattern still reads the
    // server segment out of the tool name.
    expect(patternNamespace('mcp__github__create_issue', 'mcp__*')).toBe('github')
    // A name the head does not claim, one that leaves no family name at all, and
    // a bare head with no remainder all stay resident.
    expect(patternNamespace('bash', 'browser_*')).toBeUndefined()
    expect(patternNamespace('_x', '_*')).toBeUndefined()
    expect(patternNamespace('browser_', 'browser_*')).toBeUndefined()
  })

  it('operator gets the shipped default list: the MCP bridge plus the plugin families', () => {
    // Given no pagedToolPatterns in the config
    // When the default is resolved
    // Then it names the MCP bridge and the six plugin families this preset mounts
    expect(DEFAULT_PAGED_TOOL_PATTERNS)
      .toEqual(['mcp__*', 'browser_*', 'task_board_*', 'team_*', 'squad*', 'ui_*', 'ssh_*'])
    expect(validatePagedToolPatterns('p', undefined)).toBe(DEFAULT_PAGED_TOOL_PATTERNS)
  })

  it('operator keeps every host builtin resident under the shipped patterns', () => {
    // Given the shipped patterns and the host builtins the preset mounts
    // When each builtin is resolved against the whole pattern chain
    // Then none is claimed: paging only ever reaches plugin tool families
    const builtins = [
      'bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'str_replace_editor',
      'glob', 'grep', 'job_output', 'job_list', 'job_kill', 'skill',
      'ask_user_question', 'todo_write', 'web_search', 'subagent', 'subagent_fork',
      'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent', 'ralph',
      'exit_plan_mode', 'create_goal', 'get_goal', 'update_goal', 'fact_register',
      'tool_activate', 'run_code', 'list_mcp_resources', 'list_mcp_resource_templates',
      'read_mcp_resource',
    ]
    for (const builtin of builtins) expect(namespaceOf(builtin, DEFAULT_PAGED_TOOL_PATTERNS)).toBeUndefined()
  })

  it('operator gets the declared pattern config validated', () => {
    // Given an absent config and the configs a profile could declare
    // When the config is validated
    // Then the default fills in, a valid list passes through, and each malformed entry throws its own reason
    expect(validatePagedToolPatterns('p', undefined)).toEqual(DEFAULT_PAGED_TOOL_PATTERNS)
    expect(validatePagedToolPatterns('p', ['foo_*'])).toEqual(['foo_*'])
    expect(() => validatePagedToolPatterns('p', 'mcp__*' as never)).toThrow(/must be an array/)
    expect(() => validatePagedToolPatterns('p', [''])).toThrow(/non-empty/)
    expect(() => validatePagedToolPatterns('p', ['mcp__'])).toThrow(/trailing/)
    expect(() => validatePagedToolPatterns('p', ['m*p__*'])).toThrow(/trailing/)
    // A head-less "*" is refused instead of accepted and inert: the family is
    // read from the pattern's head, so a bare wildcard would page nothing.
    expect(() => validatePagedToolPatterns('p', ['*'])).toThrow(/trailing/)
    expect(() => validatePagedToolPatterns('p', [' *'])).toThrow(/trailing/)
  })

  it('operator gets the wire partitioned into resident tools and inactive namespaces', () => {
    // Given a wire carrying resident tools and namespaced ones
    // When the wire is partitioned with nothing activated, then with github activated
    // Then resident tools stay reachable while namespaced ones page under their namespace
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

  it('operator gets one plugin family paged under a single namespace, however its tools are spelled', () => {
    // Given a wire carrying both squad spellings beside another plugin family and a builtin
    // When the wire is partitioned with nothing activated, then with squad activated
    // Then both spellings page under the one "squad" namespace and the builtin never moves
    const wire = [
      { name: 'bash' },
      { name: 'squads_create' },
      { name: 'squad_member_add' },
      { name: 'task_board_list' },
    ]
    const { resident, inactive } = partitionWireTools(wire, DEFAULT_PAGED_TOOL_PATTERNS, new Set())
    expect(resident.map((tool: any) => tool.name)).toEqual(['bash'])
    expect([...inactive.keys()]).toEqual(['squad', 'task_board'])
    expect(inactive.get('squad')?.map((tool: any) => tool.name)).toEqual(['squads_create', 'squad_member_add'])

    const activated = partitionWireTools(wire, DEFAULT_PAGED_TOOL_PATTERNS, new Set(['squad']))
    expect(activated.resident.map((tool: any) => tool.name)).toEqual(['bash', 'squads_create', 'squad_member_add'])
    expect([...activated.inactive.keys()]).toEqual(['task_board'])
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

  it('operator sees the least recently used plugin family evicted exactly as an MCP server is', () => {
    // Given four plugin families activated in order through the shipped patterns
    // When the log is replayed at the shipped capacity
    // Then the oldest family is evicted and the newest three stay active
    const events = [
      ...activation('task_board', 'c1'),
      ...activation('squad', 'c2'),
      ...activation('browser', 'c3'),
      ...activation('ssh', 'c4'),
    ]
    const { active, evicted } = replayActivations(events, DEFAULT_MAX_ACTIVE_NAMESPACES, DEFAULT_PAGED_TOOL_PATTERNS)
    expect(active).toEqual(['squad', 'browser', 'ssh'])
    expect(evicted).toEqual(['task_board'])
  })

  it('operator keeps a plugin family fresh when one of its tools is called, whatever the suffix', () => {
    // Given three active families and a call into one of the oldest family's tools
    // When the log is replayed and a fourth family is activated
    // Then the used family survives and the family that was not touched is evicted
    const events = [
      ...activation('task_board', 'c1'),
      ...activation('squad', 'c2'),
      ...activation('browser', 'c3'),
      ...call('c4', 'task_board_update', {}),
      ...activation('ssh', 'c5'),
    ]
    const { active, evicted } = replayActivations(events, DEFAULT_MAX_ACTIVE_NAMESPACES, DEFAULT_PAGED_TOOL_PATTERNS)
    expect(active).toEqual(['browser', 'task_board', 'ssh'])
    expect(evicted).toEqual(['squad'])
  })

  it('operator keeps a plugin family fresh when its tools are called from inside a program', () => {
    // Given three active families and a use of the OLDEST one through a ptc dispatch
    // When the log is replayed and a fourth family is activated
    // Then the used family survives and the untouched one is evicted, so the LRU
    //      is not activation order
    const events = [
      ...activation('task_board', 'c1'),
      ...activation('squad', 'c2'),
      ...activation('browser', 'c3'),
      ...toolDispatch('task_board_list', 'call_root:ptc:1'),
      ...activation('ssh', 'c4'),
    ]
    const { active, evicted } = replayActivations(events, DEFAULT_MAX_ACTIVE_NAMESPACES, DEFAULT_PAGED_TOOL_PATTERNS)
    expect(active).toEqual(['browser', 'task_board', 'ssh'])
    expect(evicted).toEqual(['squad'])
  })

  it('operator gets no recency from a tool dispatch that reported an error', () => {
    // Given three active families and a FAILED use of the oldest one
    // When the log is replayed and a fourth family is activated
    // Then the failed call refreshed nothing and the oldest family is evicted
    const events = [
      ...activation('task_board', 'c1'),
      ...activation('squad', 'c2'),
      ...activation('browser', 'c3'),
      ...toolDispatch('task_board_list', 'call_root:ptc:1', true),
      ...activation('ssh', 'c4'),
    ]
    const { active, evicted } = replayActivations(events, DEFAULT_MAX_ACTIVE_NAMESPACES, DEFAULT_PAGED_TOOL_PATTERNS)
    expect(active).toEqual(['squad', 'browser', 'ssh'])
    expect(evicted).toEqual(['task_board'])
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

  it('reads an activation dispatched from inside a program, which is the only shape ptc records', () => {
    // Under the collapsed wire the model reaches tool_activate from inside
    // run_code, so the session carries tool/ptc-dispatch and no tool/call.
    const events = [
      ...dispatch('github', 'call_root:ptc:1'),
      ...dispatch('codegraph', 'call_root:ptc:2'),
    ]
    const { active } = replayActivations(events, 3, ['mcp__*'])
    expect(active).toEqual(['github', 'codegraph'])
  })

  it('ignores a dispatched activation that reported an error', () => {
    const events = [
      ...dispatch('github', 'call_root:ptc:1', true),
      ...dispatch('ssh', 'call_root:ptc:2'),
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

  /** One scope whose paged families are plugin tools rather than MCP servers. */
  const PLUGIN_SCHEMAS = [
    { name: 'bash', description: 'shell' },
    { name: 'squads_create', description: 'Create a squad.' },
    { name: 'squad_member_add', description: 'Add a member.' },
    { name: 'browser_navigate', description: 'Open a page.' },
    { name: 'task_board_list', description: 'List cards.' },
  ]

  function makeCtx(events: unknown[] = [], selfCallId = 'self-1', schemas: unknown[] = SCHEMAS) {
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      tools: {
        register: (spec: Record<string, unknown>) => { registered.push(spec) },
        schemas: () => schemas,
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
    // The parameter NAME is frozen: old sessions' tool/call events replay
    // through it. The description names both derivation shapes, so the model
    // can reach an MCP server and a plugin family the same way.
    const namespace = schema.properties.namespace as { description: string }
    expect(namespace.description).toContain('mcp__codegraph__*')
    expect(namespace.description).toContain('task_board_*')
  })

  it('operator activates a plugin family and gets every tool behind it named', async () => {
    // Given a scope whose paged families are plugin tools
    // When the squad family is activated
    // Then both squad spellings are named back, and the other families stay paged
    const m = makeCtx([], 'self-1', PLUGIN_SCHEMAS)
    apply(m.ctx, {})
    const result = await executeOf(m, 'squad')
    expect(result.text).toContain('Activated namespace "squad" (2 tools): squad_member_add, squads_create.')
    await expect(executeOf(m, 'docker')).rejects.toThrow(/unknown paged namespace "docker".*"browser", "squad", "task_board"/)
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
