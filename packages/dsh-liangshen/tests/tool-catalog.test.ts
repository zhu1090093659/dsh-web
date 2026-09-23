import { describe, expect, test } from 'vitest'

import {
  apply,
  catalogDescription,
  catalogEntries,
  createCatalogMessage,
  estimateSurfaceTokens,
  name,
  PRESENTATION_MODES,
  renderCatalogText,
  renderJsonSchemaType,
  renderSignature,
} from '../presets/liangshen/tool-catalog.mjs'

type Listener = (first: any, second: any, third: any) => Promise<any>

interface Harness {
  listeners: Map<string, { listener: Listener, options: any }>
  presentCalls: string[]
  warnings: string[]
  /** The inputs of the assembly in flight, reused when the plugin re-enters it. */
  assemblyInput?: { tools: unknown[]; sections: unknown[] }
  /** Declarations already landed when the effective assembly's providers were read. */
  declarationsBeforeNext: number
  /** Replace the surface the registry projects, as a mid-session tool change would. */
  setSdk(schemas: unknown[]): void
  /** Make the projection start throwing, as a mid-session breakage would. */
  failSdk(): void
}

interface HarnessOptions {
  /** The surface the registry's `sdkSchemas` projects; defaults to {@link SDK_SURFACE}. */
  sdk?: unknown[]
  /** When true the registry advertises no `sdkSchemas` at all. */
  noSdkSchemas?: boolean
  /** When true `sdkSchemas` throws, as a hostile definition would. */
  sdkThrows?: boolean
  /** When false the context exposes no code runtime. */
  ptcRuntime?: boolean
  /** When true the context exposes no SystemPrompt, so nothing can re-assemble. */
  noPromptService?: boolean
}

const SDK_SURFACE = [
  {
    name: 'bash',
    description: 'Run commands in a bash shell\n* State is persistent across command calls.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' }, timeoutMs: { type: 'integer' } },
      required: ['command'],
    },
  },
  { name: 'read', description: 'Read a UTF-8 text file and return line-numbered content.' },
]

/** The run_code transport schema the harness adds for code presentations. */
const RUN_CODE = {
  name: 'run_code',
  description: 'Execute a TypeScript program against the available tools.',
  parameters: {
    type: 'object',
    properties: { code: { type: 'string' }, description: { type: 'string' } },
    required: ['code', 'description'],
  },
}

function register(config: Record<string, unknown> = {}, options: HarnessOptions = {}): Harness {
  const listeners = new Map<string, { listener: Listener, options: any }>()
  const presentCalls: string[] = []
  const warnings: string[] = []
  let sdk = options.sdk ?? SDK_SURFACE
  let sdkFails = options.sdkThrows === true
  const tools: Record<string, unknown> = {
    sdkSchemas: () => {
      if (sdkFails) throw new Error('unsupported schema')
      return sdk
    },
  }
  if (options.noSdkSchemas === true) delete tools.sdkSchemas
  const services: Record<string, unknown> = { tools }
  if (options.ptcRuntime !== false) services.ptcRuntime = { language: 'typescript' }
  const ctx = {
    on(event: string, callback: Listener, opts?: any) {
      listeners.set(event, { listener: callback, options: opts })
    },
    get: (service: string) => services[service],
    logger: { warn: (message: string) => { warnings.push(message) } },
  }
  apply(ctx, config)
  const harness: Harness = {
    listeners,
    presentCalls,
    warnings,
    setSdk(next: unknown[]) { sdk = next },
    failSdk() { sdkFails = true },
  }
  // A faithful SystemPrompt: it snapshots the presentation before the waterfall runs
  // -- which is exactly why a declaration made inside one cannot reach that same
  // assembly -- and re-entering it is what a declaration relies on. A stub whose
  // wire ignored the declared mode could not tell those two apart.
  if (options.noPromptService !== true) {
    services.systemPrompt = {
      assemble: async (context: any) => (await runAssembly(harness, context?.agent)).assembled,
    }
  }
  return harness
}

function listener(harness: Harness, event: string): Listener {
  const entry = harness.listeners.get(event)
  expect(entry).toBeDefined()
  return entry!.listener
}

/** The assembled wire the harness hands the plugin: a native Standard-like roster. */
const WIRE = [
  { name: 'bash', description: 'Run commands in a bash shell', parameters: { type: 'object', properties: {} } },
  { name: 'read', description: 'Read a UTF-8 text file', parameters: { type: 'object', properties: {} } },
  { name: 'web_search', description: 'Search the web.', parameters: { type: 'object', properties: {} } },
]

/** One paged MCP namespace the paging tests add to the wire and projection. */
const MCP_TOOLS = [
  { name: 'mcp__github__create_issue', description: 'Create a GitHub issue.', parameters: { type: 'object', properties: {} } },
  { name: 'mcp__github__list_prs', description: 'List pull requests.', parameters: { type: 'object', properties: {} } },
  { name: 'mcp__codegraph__explore', description: 'Explore the code graph.', parameters: { type: 'object', properties: {} } },
]

/**
 * One live agent: the catalog stash and the declaration latch are keyed by the
 * agent object, so a test that spans several steps reuses the same one.
 * `events` is the durable log the catalog history and the paging state are
 * read back from, `surface` its visible positions, and
 * `ctx.tools.presentAs` the per-session presentation declaration.
 */
function agentOf(
  events: unknown[] = [],
  surface?: number[],
  harness?: Harness,
  options?: { presentThrows?: boolean; disposers?: (() => void)[] },
) {
  const session: any = { snapshotEvents: () => events }
  if (surface !== undefined) session.surface = { nodes: surface }
  const agent: any = {
    session,
    // The scope's current presentation, exactly as the real registry tracks it: a
    // declaration changes what the NEXT assembly collects, not the one in flight.
    mode: undefined as string | undefined,
    ctx: {
      tools: {
        presentAs(mode: string) {
          if (options?.presentThrows) throw new Error('presentation declaration rejected by host policy')
          harness?.presentCalls.push(mode)
          agent.mode = mode
          const disposer = () => {
            agent.mode = undefined
            options?.disposers?.push(disposer)
          }
          return disposer
        },
      },
    },
  }
  return agent
}

/** A successful tool_activate call/result pair for the durable log. */
function activationEvents(namespace: string, callId: string) {
  return [
    { type: 'tool/call', data: { callId, name: 'tool_activate', arguments: JSON.stringify({ namespace }) } },
    { type: 'tool/result', data: { message: { source: { callId }, content: [{ type: 'text', text: 'ok' }] } } },
  ]
}

/**
 * One assembly, as the harness performs it: the wire is built from the presentation
 * the agent had BEFORE the waterfall ran, and the count of declarations already
 * landed is recorded at that same moment.
 */
async function runAssembly(harness: Harness, agent: any, tools: unknown[] = WIRE, sections: unknown[] = []) {
  // The caller's inputs are remembered, so a re-entry triggered from inside the
  // waterfall assembles the SAME prompt rather than falling back to the defaults.
  if (tools !== WIRE || sections.length > 0) harness.assemblyInput = { tools, sections }
  const input = harness.assemblyInput ?? { tools: WIRE, sections: [] }
  const wire = agent?.mode === 'ptc'
    ? [{ ...RUN_CODE }]
    : agent?.mode === 'both'
      ? [...input.tools, { ...RUN_CODE }]
      : input.tools
  harness.declarationsBeforeNext = -1
  const assembled = await listener(harness, 'system-prompt/assemble')(
    { sections: input.sections },
    { agent },
    async () => {
      harness.declarationsBeforeNext = harness.presentCalls.length
      return { sections: input.sections, contexts: [], tools: wire, variables: {} }
    },
  )
  return { assembled, declarationsBeforeNext: harness.declarationsBeforeNext }
}

/** Assemble through the same entry the harness uses, so re-entry behaves identically. */
async function assemble(harness: Harness, agent: unknown, tools: unknown[] = WIRE, sections: unknown[] = []) {
  return runAssembly(harness, agent, tools, sections)
}

async function preStep(harness: Harness, agent: unknown, messages: unknown[] = [{ id: 'user', source: { kind: 'user' } }]) {
  return listener(harness, 'agent/pre-step')(
    { agent, messages, turn: 1, step: 1, signal: {} },
    async () => ({ kind: 'enter', messages }),
  )
}

function catalogOf(messages: unknown[]) {
  return messages.find((message: any) => message?.source?.kind === name || message?.source?.plugin === name)
}

function catalogText(messages: unknown[]): string {
  return (catalogOf(messages) as any)?.content[0].text ?? ''
}

/** A durable catalog event carrying one injected message's data. */
function durableEvent(seq: number, message: any) {
  return { type: 'user/message', seq, data: message }
}

describe('liangshen-tool-catalog', () => {
  test('exports a diagnostic plugin name and injects the prompt registry', () => {
    expect(name).toBe('liangshen-tool-catalog')
    expect(PRESENTATION_MODES).toEqual(['native', 'ptc', 'both'])
  })

  test('registers both hooks outermost in their waterfalls', () => {
    const harness = register()
    expect(harness.listeners.get('system-prompt/assemble')?.options).toMatchObject({ prepend: true })
    expect(harness.listeners.get('agent/pre-step')?.options).toMatchObject({ prepend: true })
  })

  test('injects the on-wire surface with argument signatures after the user message', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const result = await preStep(harness, agent, [{ id: 'user', source: { kind: 'user' } }])
    expect(result.messages.map((message: any) => message.id)).toEqual(['user', expect.any(String)])
    const catalog = catalogOf(result.messages)
    expect(catalog.role).toBe('user')
    expect(catalog.content[0].text).toContain('The following tools are available in this session:')
    expect(catalog.content[0].text).toContain('- `bash({ command: string, timeoutMs?: number })`: Run commands in a bash shell * State is persistent across command calls.')
    expect(catalog.content[0].text).toContain('- `read`: Read a UTF-8 text file and return line-numbered content.')
  })

  test("default presentation is 'ptc': the wire collapses to the run_code transport", async () => {
    const harness = register()
    const agent = agentOf([], undefined, harness)
    const { assembled, declarationsBeforeNext } = await assemble(harness, agent)
    expect(declarationsBeforeNext).toBe(1)
    expect(harness.presentCalls).toEqual(['ptc'])
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['run_code'])
    // Declared once per agent scope.
    await assemble(harness, agent)
    expect(harness.presentCalls).toEqual(['ptc'])
  })

  test("'both' catalog lists run_code like any other tool and carries no PTC exclusivity contract", async () => {
    const harness = register({ presentation: 'both' })
    const agent = agentOf()
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `run_code({ code: string, description: string })`: Execute a TypeScript program against the available tools.')
    expect(text).toContain('- `bash')
    expect(text).toContain('Prefer calling the tools above directly by name')
    expect(text).toContain('`await tools.<name>({ ... })`')
    expect(text).toContain('`Promise.all`')
    expect(text).toContain('`ToolCallError`')
    // The PTC exclusivity contract belongs to the collapsed wire only.
    expect(text).not.toContain('only tool that can be called directly')
    expect(text).not.toContain('presents these tools through `run_code`')
  })

  test("'ptc' presentation collapses the wire and ships the program contract", async () => {
    const harness = register({ presentation: 'ptc' })
    const agent = agentOf([], undefined, harness)
    const { assembled } = await assemble(harness, agent)
    expect(harness.presentCalls).toEqual(['ptc'])
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['run_code'])
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('presents these tools through `run_code`')
    expect(text).toContain('Compose one program per intent instead of one tool call per step')
    expect(text).toContain('only tool that can be called directly')
    // The SDK-reachable roster is listed; run_code itself is not an entry.
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
    expect(text).not.toContain('- `run_code(')
  })

  test("'native' presentation never declares and never mentions run_code", async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    const { assembled } = await assemble(harness, agent)
    expect(harness.presentCalls).toEqual([])
    expect(assembled.tools).toBe(WIRE)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('run_code')
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
  })

  test('rejects an invalid presentation value', () => {
    expect(() => register({ presentation: 'yes' })).toThrow(/presentation must be one of/)
    expect(() => register({ presentation: '' })).toThrow(/presentation must be one of/)
  })

  test('maps the legacy ptcPresentation key onto the enum with one deprecation warning', async () => {
    const ptc = register({ ptcPresentation: true })
    const ptcAgent = agentOf([], undefined, ptc)
    const { assembled } = await assemble(ptc, ptcAgent)
    expect(ptc.presentCalls).toEqual(['ptc'])
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['run_code'])
    expect(ptc.warnings.filter(w => w.includes('ptcPresentation key is deprecated'))).toHaveLength(1)

    const native = register({ ptcPresentation: false })
    const nativeAgent = agentOf()
    const nativeAssembled = await assemble(native, nativeAgent)
    expect(native.presentCalls).toEqual([])
    expect(nativeAssembled.assembled.tools).toBe(WIRE)
    expect(native.warnings.filter(w => w.includes('ptcPresentation key is deprecated'))).toHaveLength(1)
  })

  test('an explicit presentation wins over the legacy key and still warns once', async () => {
    const harness = register({ presentation: 'native', ptcPresentation: true })
    const agent = agentOf()
    const { assembled } = await assemble(harness, agent)
    expect(harness.presentCalls).toEqual([])
    expect(assembled.tools).toBe(WIRE)
    expect(harness.warnings.filter(w => w.includes('ptcPresentation key is deprecated'))).toHaveLength(1)
  })

  test('the retired anchorTools key warns once and no longer narrows the wire', async () => {
    const harness = register({ anchorTools: ['bash'], presentation: 'native' })
    const agent = agentOf([{ type: 'turn/start' }], undefined, harness)
    const { assembled } = await assemble(harness, agent)
    // No anchor narrowing: the full wire survives even on the first turn.
    expect(assembled.tools).toBe(WIRE)
    expect(harness.warnings.filter(w => w.includes('anchor-turn staging is retired'))).toHaveLength(1)
    await assemble(harness, agent)
    expect(harness.warnings.filter(w => w.includes('anchor-turn staging is retired'))).toHaveLength(1)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `bash')
    expect(text).toContain('- `read')
  })

  test('still rejects a malformed retired anchorTools key', () => {
    expect(() => register({ anchorTools: 'bash' })).toThrow(/anchorTools must be an array/)
    expect(() => register({ anchorTools: ['bash', ''] })).toThrow(/anchorTools entries must be non-empty/)
    expect(() => register({ ptcPresentation: 'yes' })).toThrow(/ptcPresentation must be a boolean/)
  })

  test('rejects invalid configuration', () => {
    expect(() => register({ descriptionMaxLength: 0 })).toThrow(/descriptionMaxLength must be an integer >= 1/)
    expect(() => register({ descriptionMaxLength: 1.5 })).toThrow(/descriptionMaxLength must be an integer >= 1/)
    expect(() => register({ pagedToolPatterns: 'mcp__*' })).toThrow(/pagedToolPatterns must be an array/)
    expect(() => register({ pagedToolPatterns: ['mcp__*', ''] })).toThrow(/pagedToolPatterns entries must be non-empty/)
    expect(() => register({ pagedToolPatterns: ['mcp__*__*'] })).toThrow(/prefix patterns ending in one trailing/)
    expect(() => register({ maxActiveNamespaces: 0 })).toThrow(/maxActiveNamespaces must be an integer >= 1/)
  })

  test('marks the message with the minimal plugin source shape', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const catalog = catalogOf((await preStep(harness, agent)).messages)
    // The durable validator whitelists `kind`, `plugin`, `form`, `sections`
    // and `summary` for a plugin source; anything else risks rejection.
    expect(catalog.source).toEqual({ kind: name })
    expect(typeof catalog.id).toBe('string')
    expect(catalog.id.length).toBeGreaterThan(0)
  })

  test('appends nothing when no assembly was observed', async () => {
    const result = await preStep(register(), agentOf())
    expect(result.messages).toHaveLength(1)
  })

  test('appends nothing for an empty surface that was never published', async () => {
    const harness = register({ presentation: 'native' }, { sdk: [] })
    const agent = agentOf()
    await assemble(harness, agent, [])
    const result = await preStep(harness, agent)
    expect(result.messages).toHaveLength(1)
  })

  test('does not republish while the published catalog is still visible', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const first = await preStep(harness, agent)
    const events = [
      { type: 'user/message', seq: 1, data: { id: 'user', source: { kind: 'user' } } },
      durableEvent(2, catalogOf(first.messages)),
    ]
    const next = agentOf(events, [1, 2], harness)
    await assemble(harness, next)
    const second = await preStep(harness, next)
    expect(second.messages).toHaveLength(1)
  })

  test('republishes when the surface changed', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const first = await preStep(harness, agent)
    const history = agentOf([durableEvent(2, catalogOf(first.messages))], [2], harness)
    await assemble(harness, history)
    harness.setSdk([...SDK_SURFACE, { name: 'edit', description: 'Edit one file.' }])
    await assemble(harness, history, [...WIRE, { name: 'edit', description: 'Edit one file.' }])
    const second = await preStep(harness, history)
    const update = catalogOf(second.messages)
    expect(update.content[0].text).toContain('- `edit`: Edit one file.')
    expect(update.content[0].text).toContain('replaces any earlier available-tools list')
  })

  test('republishes after a compaction shadows the published catalog', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const first = await preStep(harness, agent)
    // The event survives in the log but is no longer on the visible surface.
    const compacted = agentOf([durableEvent(2, catalogOf(first.messages))], [1], harness)
    await assemble(harness, compacted)
    const second = await preStep(harness, compacted)
    expect(catalogOf(second.messages)).toBeDefined()
  })

  test('reads the published state back through the legacy events array', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const first = await preStep(harness, agent)
    const legacy = agentOf([durableEvent(2, catalogOf(first.messages))], undefined, harness)
    delete (legacy.session as any).snapshotEvents
    ;(legacy.session as any).events = [durableEvent(2, catalogOf(first.messages))]
    await assemble(harness, legacy)
    const second = await preStep(harness, legacy)
    expect(second.messages).toHaveLength(1)
  })

  test('ignores an unusable catalog record instead of throwing', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf([
      { type: 'user/message', seq: 1, data: { id: 'x', role: 'user', source: { kind: 'plugin', plugin: name } } },
    ], [1], harness)
    await assemble(harness, agent)
    const result = await preStep(harness, agent)
    expect(catalogOf(result.messages)).toBeDefined()
  })

  test('keeps an already-current catalog message in the batch', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const first = await preStep(harness, agent)
    const catalog = catalogOf(first.messages)
    const second = await preStep(harness, agent, [{ id: 'user', source: { kind: 'user' } }, catalog])
    expect(second.messages).toHaveLength(2)
  })

  test('drops a batch catalog message that is already on the visible surface', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const first = await preStep(harness, agent)
    const catalog = catalogOf(first.messages)
    const withHistory = agentOf([durableEvent(2, catalog)], [2], harness)
    await assemble(harness, withHistory)
    const second = await preStep(harness, withHistory, [{ id: 'user', source: { kind: 'user' } }, catalog])
    expect(second.messages.map((message: any) => message.id)).toEqual(['user'])
  })

  test('reports an empty surface that replaced a published one', async () => {
    const harness = register({ presentation: 'native' }, { sdk: [] })
    const agent = agentOf()
    await assemble(harness, agent)
    const first = await preStep(harness, agent)
    const next = agentOf([durableEvent(2, catalogOf(first.messages))], [2], harness)
    await assemble(harness, next, [])
    const second = await preStep(harness, next)
    const update = catalogOf(second.messages)
    expect(update.content[0].text).toContain('No tools are currently available in this session.')
  })

  test('leaves a rejected step decision untouched', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf()
    await assemble(harness, agent)
    const result = await listener(harness, 'agent/pre-step')(
      { agent, messages: [], turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'reject' }),
    )
    expect(result).toEqual({ kind: 'reject' })
  })

  test('paged namespaces stay off the wire and appear in the catalog summary', async () => {
    const harness = register({ presentation: 'native' }, { sdk: [...SDK_SURFACE, ...MCP_TOOLS] })
    const agent = agentOf()
    const { assembled } = await assemble(harness, agent, [...WIRE, ...MCP_TOOLS])
    // The wire keeps only the resident tools.
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read', 'web_search'])
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('<inactive_namespaces>')
    expect(text).toContain('- `codegraph` (1 tool, e.g. `mcp__codegraph__explore`): Explore the code graph. Call `tool_activate({ namespace: "codegraph" })`')
    expect(text).toContain('- `github` (2 tools, e.g. `mcp__github__create_issue`): Create a GitHub issue. Call `tool_activate({ namespace: "github" })`')
    expect(text).not.toContain('- `mcp__github__create_issue')
    // The catalog no longer claims completeness while namespaces are paged out.
    expect(text).toContain('This is the current on-wire list')
  })

  test('an activated namespace returns to the wire, rebuilt from the event stream', async () => {
    const harness = register({ presentation: 'native' }, { sdk: [...SDK_SURFACE, ...MCP_TOOLS] })
    // The durable log already carries a successful tool_activate call: a resumed
    // session rebuilds the active set without any process-memory state.
    const agent = agentOf(activationEvents('github', 'c1'))
    const { assembled } = await assemble(harness, agent, [...WIRE, ...MCP_TOOLS])
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual([
      'bash', 'read', 'web_search', 'mcp__github__create_issue', 'mcp__github__list_prs',
    ])
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `mcp__github__create_issue')
    expect(text).toContain('- `codegraph` (1 tool')
    expect(text).not.toContain('- `github` (2 tools')
  })

  test('an errored activation never takes effect in the replay', async () => {
    const harness = register({ presentation: 'native' }, { sdk: [...SDK_SURFACE, ...MCP_TOOLS] })
    const errored = [
      { type: 'tool/call', data: { callId: 'c1', name: 'tool_activate', arguments: '{"namespace":"github"}' } },
      { type: 'tool/result', data: { message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'unknown paged namespace', isError: true }] } } },
    ]
    const agent = agentOf(errored)
    const { assembled } = await assemble(harness, agent, [...WIRE, ...MCP_TOOLS])
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read', 'web_search'])
  })

  test("the collapsed 'ptc' wire still pages the SDK projection the wire cannot carry", async () => {
    // The wire itself has nothing left to filter, so this assertion is about the
    // OTHER half of paging: the per-scope registry restriction is exercised in
    // tool-paging-registry.test.ts against a faithful registry stub. What this
    // test pins is the catalog's side under a scope that exposes no restriction
    // API at all: no crash, no false claim that a namespace is unreachable.
    // This harness declares the presentation but exposes no restrict() API, so
    // paging cannot be enforced here. What it pins is the fallback: paging must
    // never cost the session its tools, and the catalog must not claim a
    // namespace is unreachable when nothing withheld it.
    const harness = register({ presentation: 'ptc' }, { sdk: [...SDK_SURFACE, ...MCP_TOOLS] })
    const agent = agentOf([], undefined, harness)
    const { assembled } = await assemble(harness, agent, [...WIRE, ...MCP_TOOLS])
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['run_code'])
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `mcp__github__create_issue')
    expect(text).not.toContain('<inactive_namespaces>')
  })

  test("under 'both' the paged note says the SDK still reaches paged namespaces", async () => {
    const harness = register({ presentation: 'both' }, { sdk: [...SDK_SURFACE, ...MCP_TOOLS] })
    const agent = agentOf()
    await assemble(harness, agent, [...WIRE, ...MCP_TOOLS])
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `run_code({ code: string, description: string })`')
    expect(text).toContain('<inactive_namespaces>')
    // 'both' is the one presentation that leaves the registry unrestricted: the
    // page is on the NATIVE wire only, so the SDK inside a program still reaches
    // a paged namespace before activation. Only 'ptc' pages the whole surface.
    expect(text).toContain('Paged-out namespaces below stay off the NATIVE wire but stay reachable through the SDK inside a program even before activation')
  })

  test('stays native and says nothing about run_code without a PTC runtime', async () => {
    const harness = register({}, { ptcRuntime: false })
    const agent = agentOf([], undefined, harness)
    const { assembled } = await assemble(harness, agent)
    expect(harness.presentCalls).toEqual([])
    expect(assembled.tools).toBe(WIRE)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('run_code')
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
  })

  test('degrades to the assembled wire when the registry publishes no SDK projection', async () => {
    const harness = register({ presentation: 'native' }, { noSdkSchemas: true })
    const agent = agentOf()
    const { assembled } = await assemble(harness, agent)
    expect(assembled.tools).toEqual(WIRE)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `web_search(')
  })

  test('survives a hostile SDK projection with one warning', async () => {
    const harness = register({ presentation: 'native' }, { sdkThrows: true })
    const agent = agentOf()
    await assemble(harness, agent)
    await assemble(harness, agent)
    expect(harness.warnings).toHaveLength(1)
    expect(catalogText((await preStep(harness, agent)).messages)).toContain('- `web_search(')
  })

  test('warns once when a session has no scoped tools view to declare through', async () => {
    const harness = register()
    const agent: any = { session: { snapshotEvents: () => [] } }
    await assemble(harness, agent)
    await assemble(harness, agent)
    expect(harness.warnings).toHaveLength(1)
    expect(harness.warnings[0]).toContain('keeping the native tool surface')
  })

  test('never announces a transport its own assembly wire does not carry', async () => {
    // The declaration succeeds, but this deployment offers nothing to re-assemble
    // with, so the presentation cannot reach the request in flight. The catalog
    // describes the WIRE, so it must keep describing native tools.
    const harness = register({}, { noPromptService: true })
    const agent = agentOf([], undefined, harness)
    const { assembled } = await assemble(harness, agent)
    // The declaration is attempted (the shipped default is 'ptc') but cannot reach
    // this assembly, so the wire stays native and the catalog must describe that.
    expect(harness.presentCalls).toEqual(['ptc'])
    expect(assembled.tools).toBe(WIRE)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('run_code')
    expect(text).toContain('- `bash')
  })

  test('a declined declaration degrades to native, does not announce run_code, and warns once', async () => {
    const harness = register({ presentation: 'ptc' })
    const agent = agentOf([], undefined, harness, { presentThrows: true })
    const { assembled } = await assemble(harness, agent)
    expect(assembled.tools).toBe(WIRE)
    expect(harness.warnings).toHaveLength(1)
    expect(harness.warnings[0]).toContain('presentation was declined')
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('run_code')
    expect(text).toContain('- `bash')
  })

  test('wire carrying only run_code reverts the declaration when the projection is unavailable', async () => {
    const disposers: (() => void)[] = []
    const harness = register({ presentation: 'ptc' })
    const priorCatalog = createCatalogMessage([{ name: 'prior_tool', signature: '()', description: 'Prior' }], 'native')
    const agent = agentOf([durableEvent(2, priorCatalog)], [2], harness, { disposers })
    await assemble(harness, agent)
    expect(harness.presentCalls).toEqual(['ptc'])
    // The projection breaks under the already-collapsed wire.
    harness.failSdk()
    const { assembled } = await assemble(harness, agent, [{ ...RUN_CODE }])
    expect(disposers.length).toBeGreaterThanOrEqual(1)
    expect(harness.warnings.some(w => w.includes('tool schemas available') || w.includes('native tool surface'))).toBe(true)
    const text = catalogText((await preStep(harness, agent)).messages)
    // Does not falsely claim full tools exist; truthfully reports the empty surface
    expect(text).toContain('No tools are currently available in this session.')
    expect(text).not.toContain('await tools.run_code')
    expect(text).not.toContain('presents these tools through `run_code`')
    expect(assembled.tools).toEqual([])
  })

  test('refreshes fallback every assembly when sdkSchemas fails instead of keeping stale catalog', async () => {
    const harness = register({ presentation: 'native' }, { sdk: [{ name: 'custom_turn1', description: 'Turn 1 tool' }] })
    const agent = agentOf()
    await assemble(harness, agent, [{ name: 'custom_turn1', description: 'Turn 1 tool' }])
    const firstText = catalogText((await preStep(harness, agent)).messages)
    expect(firstText).toContain('custom_turn1')

    // In a later assembly the SDK projection throws; the wire fallback rules.
    const harnessFail = register({ presentation: 'native' }, { sdkThrows: true })
    const agent2 = agentOf()
    await assemble(harnessFail, agent2, [{ name: 'wire_fresh', description: 'Fresh fallback tool' }])
    const secondText = catalogText((await preStep(harnessFail, agent2)).messages)
    expect(secondText).toContain('wire_fresh')
    expect(secondText).not.toContain('custom_turn1')
  })

  test('catalogDescription collapses whitespace and truncates', () => {
    expect(catalogDescription('  a\n\n b  ', 20)).toBe('a b')
    expect(catalogDescription('abcdefghij', 7)).toBe('abcd...')
    expect(catalogDescription(undefined, 20)).toBe('')
  })

  test('renderJsonSchemaType renders the supported constructs and degrades the rest', () => {
    expect(renderJsonSchemaType({ type: 'string' })).toBe('string')
    expect(renderJsonSchemaType({ type: 'integer' })).toBe('number')
    expect(renderJsonSchemaType({ type: 'boolean' })).toBe('boolean')
    expect(renderJsonSchemaType({ enum: ['a', 'b'] })).toBe('"a" | "b"')
    expect(renderJsonSchemaType({ const: 3 })).toBe('3')
    expect(renderJsonSchemaType({ oneOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null')
    expect(renderJsonSchemaType({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null')
    expect(renderJsonSchemaType({ type: ['string', 'null'] })).toBe('string | null')
    expect(renderJsonSchemaType({ type: 'array', items: { type: 'number' } })).toBe('number[]')
    expect(renderJsonSchemaType({ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } })).toBe('(string | number)[]')
    expect(renderJsonSchemaType({ type: 'object' })).toBe('Record<string, JsonValue>')
    expect(renderJsonSchemaType({})).toBe('JsonValue')
    expect(renderJsonSchemaType(undefined)).toBe('JsonValue')
    expect(renderJsonSchemaType({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'string' } } }, required: ['a'] }))
      .toBe('{ a: string, b?: string[] }')
  })

  test('renderJsonSchemaType stops expanding past the nesting cap', () => {
    const deep = (depth: number): any => (
      depth === 0
        ? { type: 'string' }
        : { type: 'object', properties: { next: deep(depth - 1) }, required: ['next'] }
    )
    expect(renderJsonSchemaType(deep(3))).toContain('{ next:')
    expect(renderJsonSchemaType(deep(6))).toContain('JsonValue')
  })

  test('renderSignature renders a parenthesized argument list or nothing', () => {
    expect(renderSignature({ type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }))
      .toBe('({ command: string })')
    expect(renderSignature({})).toBe('')
    expect(renderSignature(undefined)).toBe('')
  })

  test('catalogEntries sorts by name, skips nameless tools, and gates run_code on the option', () => {
    const entries = catalogEntries([
      { name: 'b', description: 'second' },
      { description: 'nameless' },
      { name: 'run_code', description: 'transport' },
      { name: 'a', description: 'first', parameters: { type: 'object', properties: {} } },
    ], 200)
    expect(entries).toEqual([
      { name: 'a', signature: '(Record<string, JsonValue>)', description: 'first' },
      { name: 'b', signature: '', description: 'second' },
    ])
    const withRunCode = catalogEntries([
      { name: 'run_code', description: 'transport' },
      { name: 'a', description: 'first' },
    ], 200, { includeRunCode: true })
    expect(withRunCode.map((entry: any) => entry.name)).toEqual(['a', 'run_code'])
    expect(catalogEntries(undefined, 200)).toEqual([])
  })

  test('renderCatalogText frames a list, the contracts, and the paged summary', () => {
    const list = renderCatalogText([{ name: 'read', signature: '()', description: 'Read a file.' }], 'native')
    expect(list).toContain('<available_tools>')
    expect(list).toContain('- `read()`: Read a file.')
    expect(list).not.toContain('the full parameter schema travels with its own tool definition')
    expect(list).toContain('This is the complete current list and replaces any earlier available-tools list in this session.')
    expect(list).not.toContain('run_code')
    expect(renderCatalogText([], 'native')).toContain('No tools are currently available in this session.')
    expect(renderCatalogText([], 'ptc')).toContain('presents these tools through `run_code`')
    expect(renderCatalogText([], 'ptc')).toContain('Compose one program per intent')
    expect(renderCatalogText([], 'native')).not.toContain('Promise.all')
    const both = renderCatalogText([{ name: 'run_code', signature: '()', description: 'Run a program.' }], 'both')
    expect(both).toContain('Prefer calling the tools above directly by name')
    expect(both).not.toContain('only tool that can be called directly')
    const paged = renderCatalogText([], 'native', [
      { namespace: 'github', count: 2, sample: 'mcp__github__create_issue', description: 'Create a GitHub issue.' },
    ])
    expect(paged).toContain('<inactive_namespaces>')
    expect(paged).toContain('`tool_activate({ namespace: "github" })`')
    expect(paged).toContain('This is the current on-wire list')
  })

  test('groups activated paged families under their namespace heading', () => {
    const entries = [
      { name: 'bash', signature: '()', description: 'Shell.' },
      { name: 'mcp__github__create_issue', signature: '()', description: 'Create an issue.', namespace: 'github' },
      { name: 'mcp__github__list_prs', signature: '()', description: 'List PRs.', namespace: 'github' },
    ]
    const text = renderCatalogText(entries, 'native')
    // Plain tools stay in the flat list; the family is grouped under its heading.
    expect(text).toContain('- `bash()`: Shell.')
    expect(text).toContain('- namespace `github` (activated):')
    expect(text).toContain('  - `mcp__github__create_issue()`: Create an issue.')
    // Every tool is still named exactly once, and grouping is byte-stable.
    expect(text.match(/mcp__github__create_issue/g)).toHaveLength(1)
    expect(renderCatalogText(entries, 'native')).toBe(text)
  })

  test('catalogEntries carries the paging namespace so grouping can render it', () => {
    const entries = catalogEntries([
      { name: 'mcp__github__create_issue', description: 'Issue.' },
      { name: 'bash', description: 'Shell.' },
    ], 200, { patterns: ['mcp__*'] })
    expect(entries.find((entry: any) => entry.name === 'bash')?.namespace).toBeUndefined()
    expect(entries.find((entry: any) => entry.name === 'mcp__github__create_issue')?.namespace).toBe('github')
    // Without patterns nothing is grouped, so the plain list is unchanged.
    expect(catalogEntries([{ name: 'mcp__github__x', description: 'X.' }], 200)
      .find((entry: any) => entry.name === 'mcp__github__x')?.namespace).toBeUndefined()
  })

  test('estimates the resident surface and how it maps onto the ceiling', () => {
    expect(estimateSurfaceTokens([])).toBe(0)
    expect(estimateSurfaceTokens(undefined)).toBe(0)
    // Four characters per token, rounded up, over the serialized schema.
    const payload = JSON.stringify({ name: 'a', description: 'abcd' })
    expect(estimateSurfaceTokens([{ name: 'a', description: 'abcd' }])).toBe(Math.ceil(payload.length / 4))
    const circular: any = { name: 'weird' }
    circular.self = circular
    // A schema JSON cannot serialize contributes nothing instead of throwing.
    expect(estimateSurfaceTokens([circular])).toBe(0)
  })

  test('warns once when the resident surface crosses the token budget', async () => {
    // A wire far over the default ceiling, with nothing matchable by paging.
    const huge = Array.from({ length: 40 }, (_, index) => ({
      name: `tool_${index}`,
      description: 'x'.repeat(400),
      parameters: { type: 'object', properties: {} },
    }))
    // An explicit ceiling keeps the test independent of the calibrated default.
    const harness = register({ presentation: 'native', maxResidentTokens: 1000 })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent, huge)
    await assemble(harness, agent, huge)
    const budget = harness.warnings.filter(w => w.includes('resident tool surface'))
    expect(budget).toHaveLength(1)
    expect(budget[0]).toContain('pagedToolPatterns')
    // The warning names the heaviest tools so the remedy is actionable.
    expect(budget[0]).toContain('heaviest:')
  })

  test('the shipped default clears a realistic full preset roster', async () => {
    // Gentle paging keeps every non-MCP tool resident, so the calibrated default
    // must sit above a full roster: a ceiling below the factory baseline would
    // fire on every ordinary session and train the reader to ignore it.
    const roster = Array.from({ length: 26 }, (_, index) => ({
      name: `tool_${index}`,
      description: 'x'.repeat(220),
      parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    }))
    const harness = register({ presentation: 'native' })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent, roster)
    expect(harness.warnings.filter(w => w.includes('resident tool surface'))).toHaveLength(0)
    // And real growth beyond that baseline still trips it.
    const grown = [...roster, ...Array.from({ length: 70 }, (_, index) => ({
      name: `extra_${index}`,
      description: 'y'.repeat(400),
      parameters: { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
    }))]
    const grownHarness = register({ presentation: 'native' })
    const grownAgent = agentOf([], undefined, grownHarness)
    await assemble(grownHarness, grownAgent, grown)
    expect(grownHarness.warnings.filter(w => w.includes('resident tool surface'))).toHaveLength(1)
  })

  test('stays silent when the resident surface fits the budget', async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    expect(harness.warnings.filter(w => w.includes('resident tool surface'))).toHaveLength(0)
  })

  test('a raised budget silences the warning, and validation rejects a non-positive one', async () => {
    const huge = Array.from({ length: 40 }, (_, index) => ({
      name: `tool_${index}`,
      description: 'x'.repeat(400),
      parameters: { type: 'object', properties: {} },
    }))
    const harness = register({ presentation: 'native', maxResidentTokens: 100000 })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent, huge)
    expect(harness.warnings.filter(w => w.includes('resident tool surface'))).toHaveLength(0)
    expect(() => register({ maxResidentTokens: 0 })).toThrow(/maxResidentTokens must be an integer >= 1/)
  })

  test('does not duplicate giant SDK declarations in the durable message', async () => {
    const harness = register({ presentation: 'ptc' })
    const agent = agentOf()
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    // PTC contract and compact index are present
    expect(text).toContain('presents these tools through `run_code`')
    expect(text).toContain('- `bash')
    // Giant TypeScript SDK interface is NOT duplicated in durable message
    expect(text).not.toContain('interface ToolArgsMap')
    expect(text).not.toContain('interface ToolOutputMap')
    // The false statement is removed
    expect(text).not.toContain('the full parameter schema travels with its own tool definition')
  })

  test('prefers public schemas API over private methods', async () => {
    let publicSchemasCalled = false
    const harness = register({ presentation: 'native' })
    const customAgent: any = {
      session: { snapshotEvents: () => [] },
      ctx: {
        tools: {
          presentAs: () => () => {},
          schemas: () => {
            publicSchemasCalled = true
            return [{ name: 'public_tool', description: 'From public API' }]
          },
        },
      },
    }
    // Under native presentation the catalog describes the wire, so the public
    // API's tool has to be on it for the preference to be observable.
    await assemble(harness, customAgent, [{ name: 'public_tool', description: 'From public API' }])
    const text = catalogText((await preStep(harness, customAgent)).messages)
    expect(publicSchemasCalled).toBe(true)
    expect(text).toContain('public_tool')
  })
})
