import { describe, expect, test } from 'vitest'

import {
  apply,
  catalogDescription,
  catalogEntries,
  createCatalogMessage,
  CURATED_TOOL_SUMMARIES,
  estimateSurfaceTokens,
  name,
  PRESENTATION_MODES,
  renderCatalogText,
  renderJsonSchemaType,
  renderSignature,
  toolSummary,
} from '../presets/liangshen/tool-catalog.mjs'

type Listener = (first: any, second: any, third: any) => Promise<any>

interface Harness {
  listeners: Map<string, { listener: Listener, options: any }>
  warnings: string[]
  /** Replace the surface the registry projects, as a mid-session tool change would. */
  setSurface(schemas: unknown[]): void
  /** Make the projection start throwing, as a mid-session breakage would. */
  failSurface(): void
  /** The names the live scope restriction withholds from one scope. */
  withheld(agent: unknown): string[]
}

interface HarnessOptions {
  /** The surface the registry projects; defaults to {@link WIRE}. */
  surface?: unknown[]
  /** When true the registry advertises no read method at all. */
  noSurface?: boolean
  /** When true the projection throws, as a hostile definition would. */
  surfaceThrows?: boolean
  /** When false the context exposes no code runtime. */
  ptcRuntime?: boolean
}

/**
 * The step admission the harness hands the plugin through the assemble context.
 * Nothing in the catalog inspects it: like the shipped `tools.schemas(agent,
 * toolSet)` contract, it only carries it back to the registry, which is where a
 * step's conditional admission is applied.
 */
const STEP_TOOL_SET = Object.freeze({ admitted: 'step' })

/**
 * The names each scope's live restriction withholds, keyed by the agent whose
 * `agent.ctx.tools.restrict()` installed it. The registry stub below enforces
 * them exactly as the official one does, so a paging assertion is about what
 * the wire and a program can reach, not about an array a listener returned.
 */
const DENIED = new WeakMap<object, Set<string>>()

function register(config: Record<string, unknown> = {}, options: HarnessOptions = {}): Harness {
  const listeners = new Map<string, { listener: Listener, options: any }>()
  const warnings: string[] = []
  let surface = options.surface ?? WIRE
  let surfaceFails = options.surfaceThrows === true
  /** The scope's visible projection: the surface minus that scope's restriction. */
  const visible = (agent: any) => {
    if (surfaceFails) throw new Error('unsupported schema')
    const deny = typeof agent === 'object' && agent !== null ? DENIED.get(agent) : undefined
    return deny === undefined ? surface : surface.filter((tool: any) => !deny.has(tool?.name))
  }
  const tools: Record<string, unknown> = { schemas: (agent: any) => visible(agent) }
  if (options.noSurface === true) delete tools.schemas
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
    warnings,
    setSurface(next: unknown[]) { surface = next },
    failSurface() { surfaceFails = true },
    withheld(agent: unknown) {
      return [...DENIED.get(agent as object) ?? []]
    },
  }
  // A faithful SystemPrompt: the shipped host keeps one assembly entry point, and
  // this stub re-enters it exactly as a re-assembly would.
  services.systemPrompt = {
    assemble: async (context: any) => (await runAssembly(harness, context?.agent, undefined, context?.sections ?? [])).assembled,
  }
  return harness
}

function listener(harness: Harness, event: string): Listener {
  const entry = harness.listeners.get(event)
  expect(entry).toBeDefined()
  return entry!.listener
}

/**
 * The surface the registry projects for one scope, and therefore the list the
 * request's own wire carries: the executor renders tool declarations from the
 * same `schemas()` read the catalog performs.
 *
 * The bash entry keeps a real argument signature and the read entry declares no
 * parameters at all, so the catalog has to render both shapes: a signature, and
 * the bare name a tool that takes no declared argument gets.
 */
const WIRE = [
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
 * read back from, `visible` its visible positions, `ctx.tools.presentAs` the
 * per-session presentation declaration and `ctx.tools.restrict` the paging
 * filter that withholds a namespace until it is activated.
 */
function agentOf(
  events: unknown[] = [],
  visible?: number[],
  harness?: Harness,
  options?: { restrictThrows?: boolean },
) {
  const session: any = { snapshotEvents: () => events }
  if (visible !== undefined) session.surface = { nodes: visible }
  const agent: any = {
    session,
    ctx: {
      tools: {
        restrict(filter: { deny?: string[] }) {
          if (options?.restrictThrows) throw new Error('registry refused the filter')
          const deny = new Set(filter?.deny ?? [])
          DENIED.set(agent, deny)
          return () => { DENIED.delete(agent) }
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
 * One assembly, exactly as the shipped harness performs it: the waterfall's
 * `PromptPresentation` carries sections, contexts and variables and NO tool
 * array (tool declarations are provider-owned), while the step's admitted
 * selection arrives in the assemble context. The count of declarations already
 * landed is recorded when the providers would have been read.
 *
 * `surface` replaces what the registry projects for this and later assemblies,
 * the way a mid-session tool change does; omitted, the current surface stays.
 */
async function runAssembly(harness: Harness, agent: any, surface?: unknown[], sections: unknown[] = []) {
  if (surface !== undefined) harness.setSurface(surface)
  const assembled = await listener(harness, 'system-prompt/assemble')(
    { sections },
    { agent, toolSet: STEP_TOOL_SET },
    async () => ({ sections, contexts: [], variables: {} }),
  )
  return { assembled }
}

/** Assemble through the same entry the harness uses, so re-entry behaves identically. */
async function assemble(harness: Harness, agent: unknown, surface?: unknown[], sections: unknown[] = []) {
  return runAssembly(harness, agent, surface, sections)
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
    expect(PRESENTATION_MODES).toEqual(['native', 'ptc'])
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
    // bash and read are curated host builtins, so both render their hand-written
    // line instead of the schema description WIRE_SDK_SURFACE carries.
    expect(catalog.content[0].text).toContain(`- \`bash({ command: string, timeoutMs?: number })\`: ${CURATED_TOOL_SUMMARIES.get('bash')}`)
    expect(catalog.content[0].text).toContain(`- \`read\`: ${CURATED_TOOL_SUMMARIES.get('read')}`)
  })

  test('operator opening a seeded child session gets its own surface, never an inherited "no tools" (issue #2016)', async () => {
    // Given a session whose durable log already carries the catalog a PARENT
    // published (a seeded sidebar child, or a fork of a conversation), When that
    // scope assembles on a host whose waterfall no longer carries a tool array
    // and prepares its first step, Then the catalog names the tools this request
    // really opens. The inherited record is the parent's, so it can neither
    // suppress the child's own catalog nor be mistaken for "this session has no
    // tools" — the two faces of the 2.0.22 defect.
    // Both presentations: the seeded child must describe the surface it opens
    // whichever transport the composition mounted.
    await Promise.all(PRESENTATION_MODES.map(async (presentation) => {
      const harness = register({ presentation })
      const parentCatalog = createCatalogMessage(
        [{ name: 'retired_tool', signature: '()', description: 'A tool only the parent had.' }],
        'native',
      )
      const agent = agentOf([durableEvent(2, parentCatalog)], [2], harness)
      await assemble(harness, agent)
      const text = catalogText((await preStep(harness, agent)).messages)
      expect(text).toContain('The following tools are available in this session:')
      expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
      expect(text).toContain('- `web_search')
      expect(text).not.toContain('No tools are currently available in this session.')
      expect(text).not.toContain('retired_tool')
    }))
  })

  test('operator sees the assembly travel back untouched: tool declarations are provider-owned', async () => {
    // The 0.2.2 waterfall transforms a PromptPresentation with no tool array. A
    // listener that still tried to page or restore `tools` here would be
    // rewriting a field the harness owns and overwrites.
    const harness = register({ presentation: 'native' })
    const agent = agentOf([], undefined, harness)
    const { assembled } = await assemble(harness, agent)
    expect(assembled).toEqual({ sections: [], contexts: [], variables: {} })
  })

  test("default presentation is 'ptc': the catalog announces the program transport", async () => {
    // The composition mounts the ptc executor from this same setting, so the
    // shipped default makes the first request open the collapsed wire and the
    // catalog has to describe it.
    const harness = register()
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('presents these tools through `run_code`')
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
  })

  test("'ptc' presentation collapses the wire and ships the program contract", async () => {
    const harness = register({ presentation: 'ptc' })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('presents these tools through `run_code`')
    expect(text).toContain('Compose one program per intent instead of one tool call per step')
    expect(text).toContain('only tool that can be called directly')
    // The SDK-reachable roster is listed; run_code itself is not an entry.
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
    expect(text).not.toContain('- `run_code(')
  })

  test("'native' presentation never mentions run_code", async () => {
    const harness = register({ presentation: 'native' })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('run_code')
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
  })

  test('rejects an invalid presentation value', () => {
    expect(() => register({ presentation: 'yes' })).toThrow(/presentation must be one of/)
    expect(() => register({ presentation: '' })).toThrow(/presentation must be one of/)
  })

  test("maps the retired 'both' presentation onto 'ptc' with one deprecation warning", async () => {
    // Pre-0.2.1 profiles persisted `presentation: 'both'` (the former default);
    // mapping it to `'ptc'` with a deprecation warning keeps existing profiles
    // booting cleanly after the SDK removed `'both'` from ToolPresentationMode.
    const harness = register({ presentation: 'both' })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    // The mapped value reaches the catalog as the collapsed transport.
    expect(catalogText((await preStep(harness, agent)).messages)).toContain('presents these tools through `run_code`')
    expect(harness.warnings.filter(w => w.includes("the 'both' presentation was removed in 0.2.1; mapping 'both' -> 'ptc'"))).toHaveLength(1)
  })

  test('maps the legacy ptcPresentation key onto the enum with one deprecation warning', async () => {
    const ptc = register({ ptcPresentation: true })
    const ptcAgent = agentOf([], undefined, ptc)
    await assemble(ptc, ptcAgent)
    expect(catalogText((await preStep(ptc, ptcAgent)).messages)).toContain('presents these tools through `run_code`')
    expect(ptc.warnings.filter(w => w.includes('ptcPresentation key is deprecated'))).toHaveLength(1)

    const native = register({ ptcPresentation: false })
    const nativeAgent = agentOf([], undefined, native)
    await assemble(native, nativeAgent)
    expect(catalogText((await preStep(native, nativeAgent)).messages)).not.toContain('run_code')
    expect(native.warnings.filter(w => w.includes('ptcPresentation key is deprecated'))).toHaveLength(1)
  })

  test('an explicit presentation wins over the legacy key and still warns once', async () => {
    const harness = register({ presentation: 'native', ptcPresentation: true })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    expect(catalogText((await preStep(harness, agent)).messages)).not.toContain('run_code')
    expect(harness.warnings.filter(w => w.includes('ptcPresentation key is deprecated'))).toHaveLength(1)
  })

  test('the retired anchorTools key warns once and no longer narrows the surface', async () => {
    const harness = register({ anchorTools: ['bash'], presentation: 'native' })
    const agent = agentOf([{ type: 'turn/start' }], undefined, harness)
    await assemble(harness, agent)
    // No anchor narrowing: the full surface survives even on the first turn.
    expect(harness.withheld(agent)).toEqual([])
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
    await assemble(harness, history, [...WIRE, { name: 'edit', description: 'Edit one file.' }])
    const second = await preStep(harness, history)
    const update = catalogOf(second.messages)
    expect(update.content[0].text).toContain(`- \`edit\`: ${CURATED_TOOL_SUMMARIES.get('edit')}`)
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
    const harness = register({ presentation: 'native' }, { surface: [...WIRE, ...MCP_TOOLS] })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    // The scope's restriction withholds exactly the paged namespaces, so the
    // wire (rendered from the same registry read) keeps only the resident tools.
    expect(harness.withheld(agent).sort()).toEqual(MCP_TOOLS.map(tool => tool.name).sort())
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('<inactive_namespaces>')
    expect(text).toContain('- `codegraph` (1 tool, e.g. `mcp__codegraph__explore`): Explore the code graph. Call `tool_activate({ namespace: "codegraph" })`')
    expect(text).toContain('- `github` (2 tools, e.g. `mcp__github__create_issue`): Create a GitHub issue. Call `tool_activate({ namespace: "github" })`')
    expect(text).not.toContain('- `mcp__github__create_issue')
    // The catalog no longer claims completeness while namespaces are paged out.
    expect(text).toContain('This is the current on-wire list')
  })

  test('an activated namespace returns to the wire, rebuilt from the event stream', async () => {
    const harness = register({ presentation: 'native' }, { surface: [...WIRE, ...MCP_TOOLS] })
    // The durable log already carries a successful tool_activate call: a resumed
    // session rebuilds the active set without any process-memory state.
    const agent = agentOf(activationEvents('github', 'c1'), undefined, harness)
    await assemble(harness, agent)
    expect(harness.withheld(agent)).toEqual(['mcp__codegraph__explore'])
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `mcp__github__create_issue')
    expect(text).toContain('- `codegraph` (1 tool')
    expect(text).not.toContain('- `github` (2 tools')
  })

  test('an errored activation never takes effect in the replay', async () => {
    const harness = register({ presentation: 'native' }, { surface: [...WIRE, ...MCP_TOOLS] })
    const errored = [
      { type: 'tool/call', data: { callId: 'c1', name: 'tool_activate', arguments: '{"namespace":"github"}' } },
      { type: 'tool/result', data: { message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'unknown paged namespace', isError: true }] } } },
    ]
    const agent = agentOf(errored, undefined, harness)
    await assemble(harness, agent)
    expect(harness.withheld(agent).sort()).toEqual(MCP_TOOLS.map(tool => tool.name).sort())
  })

  test("a 'ptc' scope with no restriction API still lists every tool it can reach", async () => {
    // Paging is enforced at the registry, so a scope that exposes no
    // restrict() cannot page anything - and the catalog must not claim it did.
    // What this pins is that fallback: paging never costs the session its
    // tools, and nothing is announced as withheld that nothing withheld.
    const harness = register({ presentation: 'ptc' }, { surface: [...WIRE, ...MCP_TOOLS] })
    const agent = agentOf([], undefined, harness)
    agent.ctx.tools.restrict = undefined
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `mcp__github__create_issue')
    expect(text).not.toContain('<inactive_namespaces>')
  })

  test('stays native and says nothing about run_code without a PTC runtime', async () => {
    const harness = register({}, { ptcRuntime: false })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('run_code')
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
  })

  test('injects nothing when the registry offers no readable surface', async () => {
    // Given a deployment whose tools service publishes no read method, When a
    // step is prepared, Then no catalog is injected at all: an unreadable
    // projection is not an empty one, and announcing "no tools" over it is the
    // defect this contract exists to prevent (issue #2016).
    const harness = register({ presentation: 'native' }, { noSurface: true })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    const result = await preStep(harness, agent)
    expect(catalogOf(result.messages)).toBeUndefined()
    expect(result.messages).toHaveLength(1)
  })

  test('survives a hostile projection with one warning and keeps the last catalog', async () => {
    // Given a surface that was readable once, When a later read throws, Then the
    // warning is reported once and the published catalog stays: a transient read
    // failure must not rewrite the session's tool list into "none".
    const harness = register({ presentation: 'native' })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    harness.failSurface()
    await assemble(harness, agent)
    await assemble(harness, agent)
    expect(harness.warnings.filter(w => w.includes('no tool schemas available'))).toHaveLength(1)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `web_search(')
    expect(text).not.toContain('No tools are currently available in this session.')
  })

  test('catalogs a scope that reaches the registry only through the service', async () => {
    // Given a scope with no scoped tools view at all (only a session), When its
    // step is prepared, Then the global registry still supplies the surface: an
    // absent scoped view is not an absent tool set.
    const harness = register()
    const agent: any = { session: { snapshotEvents: () => [] } }
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('- `bash({ command: string, timeoutMs?: number })`')
  })

  test('keeps the native wording when the composition mounts no code executor', async () => {
    // Without a code runtime the composition cannot mount the ptc executor, so
    // the request opens the native roster and the catalog must describe that.
    const harness = register({}, { ptcRuntime: false })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    expect(harness.withheld(agent)).toEqual([])
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('run_code')
    expect(text).toContain('- `bash')
  })

  test('keeps the ptc wording while the composition still mounts the code executor', async () => {
    // The catalog no longer declares anything, so nothing can be declined here:
    // the transport is the composition's, and the catalog follows it.
    const harness = register({ presentation: 'ptc' })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).toContain('presents these tools through `run_code`')
    expect(text).toContain('- `bash')
  })

  test('a broken projection under ptc keeps the last catalog instead of asserting no tools', async () => {
    // The transport is the composition's, so a read failure cannot revert it;
    // what must never happen is the catalog turning that failure into "this
    // session has no tools".
    const harness = register({ presentation: 'ptc' })
    const priorCatalog = createCatalogMessage([{ name: 'prior_tool', signature: '()', description: 'Prior' }], 'native')
    const agent = agentOf([durableEvent(2, priorCatalog)], [2], harness)
    await assemble(harness, agent)
    harness.failSurface()
    await assemble(harness, agent)
    expect(harness.warnings.some(w => w.includes('no tool schemas available'))).toBe(true)
    const text = catalogText((await preStep(harness, agent)).messages)
    expect(text).not.toContain('No tools are currently available in this session.')
    expect(text).toContain('- `bash')
    expect(text).toContain('presents these tools through `run_code`')
  })

  test('reads the surface fresh on every assembly instead of keeping a stale catalog', async () => {
    // Given one scope that is assembled twice with a different registry surface,
    // When the second catalog is published, Then it describes the new surface:
    // the read happens per assembly, not once per session.
    const harness = register({ presentation: 'native' }, { surface: [{ name: 'custom_turn1', description: 'Turn 1 tool' }] })
    const agent = agentOf([], undefined, harness)
    await assemble(harness, agent)
    const firstText = catalogText((await preStep(harness, agent)).messages)
    expect(firstText).toContain('custom_turn1')

    await assemble(harness, agent, [{ name: 'surface_fresh', description: 'Fresh tool' }])
    const secondText = catalogText((await preStep(harness, agent)).messages)
    expect(secondText).toContain('surface_fresh')
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

  test('catalogEntries sorts by name, skips nameless tools, and never lists the run_code transport', () => {
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
    expect(catalogEntries(undefined, 200)).toEqual([])
  })

  test('operator gets the curated line ahead of the mechanical cap', () => {
    // Given one curated host builtin, one uncurated tool and one cap far below
    // both texts, When each renders its summary, Then the curated name renders
    // the table line verbatim - never truncated, however small the cap - while
    // the uncurated name keeps the existing mechanical cap.
    const curated = new Map(CURATED_TOOL_SUMMARIES)
    expect(curated.size).toBeGreaterThan(0)
    expect([...curated.keys()].every(tool => typeof tool === 'string' && tool !== '')).toBe(true)

    const cap = 12
    for (const [tool, line] of curated) {
      expect(toolSummary({ name: tool, description: 'a schema description long enough to be cut down' }, cap)).toBe(line)
    }

    // The fallback survives curation: a tool the table does not name is still
    // capped the way it always was, and no curated key is truncated.
    const uncurated = 'An uncurated tool description that outruns any short cap'
    expect(toolSummary({ name: 'not_a_curated_tool', description: uncurated }, cap))
      .toBe(catalogDescription(uncurated, cap))
    expect(toolSummary({ name: 'not_a_curated_tool', description: uncurated }, cap).endsWith('...')).toBe(true)
    expect([...curated.values()].every(line => line.length <= 200)).toBe(true)
  })

  test('operator gets curated entries from catalogEntries while uncurated tools still cap', () => {
    // Given one curated host builtin, one uncurated tool and one cap far below
    // both texts, When the entries are built, Then the curated name renders the
    // whole table line and the uncurated name still truncates at the same cap.
    const entries = catalogEntries([
      { name: 'read', description: 'Read a UTF-8 text file and return line-numbered content.' },
      { name: 'vendor_tool', description: 'A'.repeat(60) },
    ], 20)
    const byName = new Map(entries.map((entry: any) => [entry.name, entry]))
    const curatedLine = CURATED_TOOL_SUMMARIES.get('read')!
    // A curated name ignores the cap entirely: the line ships whole.
    expect(curatedLine.length).toBeGreaterThan(20)
    expect(byName.get('read')).toEqual({ name: 'read', signature: '', description: curatedLine })
    // An uncurated name still truncates at the same cap.
    expect(byName.get('vendor_tool')).toEqual({ name: 'vendor_tool', signature: '', description: `${'A'.repeat(17)}...` })
  })

  test('operator gets a curated table covering exactly the host builtins this preset opens', () => {
    // Given the roster the preset's own rows register for a session, When the
    // curated table is inspected, Then its key set is exactly that roster: a
    // tool dropped from the table would silently fall back to the cap, and a
    // tool added for a row this composition does not mount would announce a
    // surface the request never opens. Every curated key also wins over a
    // hostile one-character cap, and every line stays one printable ASCII
    // line well inside the shipped 200-character summary budget.
    const hostBuiltins = [
      'bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'str_replace_editor',
      'glob', 'grep', 'job_output', 'job_list', 'job_kill', 'todo_write',
      'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode',
      'subagent', 'subagent_fork', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent',
      'ask_user_question', 'web_search', 'skill', 'tool_activate', 'fact_register', 'ralph',
      'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
    ].sort()
    expect([...CURATED_TOOL_SUMMARIES.keys()].sort()).toEqual(hostBuiltins)

    // The transport itself is deliberately uncurated: the catalog never lists
    // run_code as an entry — under 'ptc' the program contract describes it,
    // under 'native' the request does not carry it.
    expect(CURATED_TOOL_SUMMARIES.has('run_code')).toBe(false)

    for (const tool of hostBuiltins) {
      expect(toolSummary({ name: tool, description: 'x' }, 1)).toBe(CURATED_TOOL_SUMMARIES.get(tool))
    }
    for (const line of CURATED_TOOL_SUMMARIES.values()) {
      expect(/^[\x20-\x7e]+$/u.test(line)).toBe(true)
      expect(line.length).toBeLessThanOrEqual(200)
    }
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
    // The transport never renders as a list entry: catalogEntries is the gate
    // (under 'ptc' the program contract describes run_code, under 'native' the
    // request does not carry it), so a surface that includes it yields no
    // entry for it.
    const entries = catalogEntries([{ name: 'run_code', signature: '()', description: 'Run a program.' }], 200)
    expect(entries).toEqual([])
    const ptc = renderCatalogText(entries, 'ptc')
    expect(ptc).not.toContain('- `run_code')
    expect(ptc).toContain('only tool that can be called directly')
    const paged = renderCatalogText([], 'native', [
      { namespace: 'github', count: 2, sample: 'mcp__github__create_issue', description: 'Create a GitHub issue.' },
    ])
    expect(paged).toContain('<inactive_namespaces>')
    expect(paged).toContain('`tool_activate({ namespace: "github" })`')
    expect(paged).toContain('This is the current on-wire list')
  })

  test('operator reads the ptc program contract as the run_code usage note', () => {
    // Given the collapsed wire, When the contract renders, Then it teaches the
    // program discipline: one program per intent, SDK access, Promise.all
    // overlap, ToolCallError handling, and the exclusivity of the transport.
    // A soft summary would leave the boundary to the model's judgement, which
    // is exactly what the contract exists to remove.
    const text = renderCatalogText([], 'ptc')
    expect(text).toContain('The session presents these tools through `run_code`')
    expect(text).toContain('Compose one program per intent instead of one tool call per step')
    expect(text).toContain('`await tools.<name>({ ... })`')
    expect(text).toContain('`Promise.all`')
    expect(text).toContain('`ToolCallError`')
    expect(text).toContain('`run_code` is the only tool that can be called directly once it is on the wire')
    // The paged-out page covers the whole surface under the collapsed wire.
    expect(text).toContain('the page is a page on the whole surface, not only on the wire')
  })

  test('operator sees the ptc contract statement stay byte-stable', () => {
    // Given the program note a 'ptc' session reads, When it renders twice, Then
    // the bytes match: the note is part of the durable message and its
    // republish rule compares text.
    const first = renderCatalogText([], 'ptc')
    expect(renderCatalogText([], 'ptc')).toBe(first)
    // The exclusivity claim and the SDK access shape are both reachable from
    // the ONE contract the catalog ships, so neither can drift out of it.
    expect(first).toContain('only tool that can be called directly')
    expect(first).toContain('Compose one program per intent')
  })

  test('operator sees the two shell curated lines stay silent about run_code', () => {
    // Given the curated table, When the bash and pwsh lines are read, Then
    // each says what its own tool IS and how it is called, and neither names
    // `run_code`: under `native` no program exists to point at, and under
    // `ptc` the program contract owns the batching guidance. A shell line that
    // named the transport would announce a surface the native request never
    // opens — the one claim this catalog contract forbids.
    for (const shell of ['bash', 'pwsh']) {
      const line = CURATED_TOOL_SUMMARIES.get(shell)!
      expect(line).not.toContain('run_code')
    }
    expect(CURATED_TOOL_SUMMARIES.get('bash')).toContain('`command`')
    expect(CURATED_TOOL_SUMMARIES.get('pwsh')).toContain('native Windows paths')
  })

  test('operator sees the paged summary state its reachability per presentation', () => {
    // Given one paged-out namespace and both presentations, When the
    // operator's catalog renders each of them, Then every presentation names
    // its own reachability next to the summary, so the model never has to
    // derive it from the program contract further down.
    const inactive = [
      { namespace: 'github', count: 2, sample: 'mcp__github__create_issue', description: 'Create a GitHub issue.' },
    ]
    const native = renderCatalogText([], 'native', inactive)
    const ptc = renderCatalogText([], 'ptc', inactive)

    // Each presentation names its own reachability next to the summary.
    expect(native).toContain('This presentation carries no program transport, so the wire is the only surface these namespaces can be reached through.')
    expect(ptc).toContain('The page covers the whole surface here, not the wire alone: these namespaces are unreachable from inside a program too until they are activated.')

    // The sentences are mutually exclusive: a model in one presentation never
    // reads another presentation's claim.
    expect(native).not.toContain('unreachable from inside a program too')
    expect(ptc).not.toContain('This presentation carries no program transport')

    // Nothing paged means no summary and no reachability sentence at all.
    expect(renderCatalogText([], 'native')).not.toContain('This presentation carries no program transport')
    expect(renderCatalogText([], 'ptc')).not.toContain('unreachable from inside a program')
  })

  test('operator sees repeated renders of one tool surface be byte-identical', () => {
    // Given one tool surface and both presentations, When the catalog
    // renders that surface twice and then renders an equal copy of it, Then the
    // bytes match every time, because the catalog is republished only when its
    // text changes; the paged summary and the program notes are part of it.
    const entries = [
      { name: 'run_code', signature: '({ code: string, description: string })', description: 'Run a program.' },
      { name: 'bash', signature: '({ command: string })', description: 'Shell.' },
      { name: 'mcp__github__create_issue', signature: '()', description: 'Issue.', namespace: 'github' },
    ]
    const inactive = [
      { namespace: 'codegraph', count: 1, sample: 'mcp__codegraph__explore', description: 'Explore the graph.' },
    ]
    for (const presentation of PRESENTATION_MODES) {
      const first = renderCatalogText(entries, presentation, inactive)
      expect(renderCatalogText(entries, presentation, inactive)).toBe(first)
      // A fresh, equal entry list renders the same bytes too: nothing in the
      // renderer depends on object identity or iteration order.
      const copy = entries.map(entry => ({ ...entry }))
      expect(renderCatalogText(copy, presentation, inactive.map(ns => ({ ...ns })))).toBe(first)
    }
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
