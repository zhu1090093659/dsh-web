/**
 * Gentle paging at the REGISTRY, under the shipped 'ptc' presentation.
 *
 * The wire partition alone cannot page anything under a collapsed wire: the
 * request opens only `run_code`, every other tool is reached from inside a
 * program, and the `tools:sdk` section renders the scope's visible set. These
 * tests run the catalog against a faithful miniature of the official tool
 * registry (global surface + per-scope restrictions + the reserved transport)
 * so the assertions are about what the model can actually reach:
 *
 * - `registry.get(name, agent)` is {@link ToolRuntime.resolveExecution}, the
 *   lookup a program's nested dispatch performs;
 * - `registry.sdkSchemas(agent)` is the generated SDK, i.e. the same list the
 *   official `tools:sdk` section renders;
 * - `registry.schemas(agent)` is the scope's visible projection.
 *
 * Timing matters as much as the filter itself: `SystemPrompt.assemble()`
 * collects the providers and renders every section BEFORE the
 * `system-prompt/assemble` waterfall runs, so paging is installed from the
 * lifecycle hooks and after each tool call instead. The harness replays that
 * production order, which is what lets these tests assert that the FIRST ptc
 * request already renders a page-consistent SDK section — and that a
 * deployment whose wire cannot collapse is never paged at all.
 */

import { describe, expect, it } from 'vitest'

import { apply, name } from '../presets/liangshen/tool-catalog.mjs'
import { apply as applyActivate } from '../presets/liangshen/tool-activate.mjs'

type Listener = (first: any, second: any, third: any) => Promise<any>

const RESIDENT = [
  { name: 'bash', description: 'Run commands in a bash shell.' },
  { name: 'read', description: 'Read a UTF-8 text file.' },
]

const PAGED = [
  { name: 'mcp__github__create_issue', description: 'Create a GitHub issue.' },
  { name: 'mcp__github__list_prs', description: 'List pull requests.' },
  { name: 'mcp__codegraph__explore', description: 'Explore the code graph.' },
  { name: 'mcp__ssh__exec', description: 'Run a remote command.' },
  { name: 'mcp__docker__ps', description: 'List containers.' },
]

/**
 * One family ONLY a custom pattern list claims. Under the shipped list this
 * name belongs to no family at all, which is exactly the asymmetry a row
 * carrying its own pattern list would reintroduce.
 */
const FOO_TOOL = { name: 'foo_exec', description: 'Run a foo command.' }

/**
 * The plugin tool families the shipped patterns page: each is named by a
 * literal prefix of its own rather than by an `mcp__` bridge, and
 * `squads_*` / `squad_member_*` share the one `squad*` pattern.
 */
const PLUGIN = [
  { name: 'browser_navigate', description: 'Open a page.' },
  { name: 'browser_snapshot', description: 'Read the page DOM.' },
  { name: 'task_board_list', description: 'List task board cards.' },
  { name: 'task_board_create', description: 'Create a task board card.' },
  { name: 'team_comment', description: 'Comment on a team issue.' },
  { name: 'squads_create', description: 'Create a squad.' },
  { name: 'squad_member_add', description: 'Add a squad member.' },
  { name: 'ui_present', description: 'Present a page to the client.' },
  { name: 'ssh_exec', description: 'Run a command on a host.' },
]

interface RegistryOptions {
  restrictThrows?: boolean
}

/**
 * The miniature registry: one global surface and per-scope restriction layers.
 * The reserved transport is never part of it - the shipped ptc executor keeps
 * `run_code` outside the registry and only its `describe()` names it - which is
 * exactly why the catalog cannot read the transport from a schema list.
 */
function registry(surface: unknown[], options: RegistryOptions = {}) {
  const layers = new Map<unknown, Array<{ allow?: Set<string>; deny?: Set<string> }>>()
  const visible = (agent: any): any[] => {
    const filters = agent?.ctx === undefined ? [] : layers.get(agent.ctx) ?? []
    return surface.filter((tool: any) => filters.every(filter => (
      !(filter.allow !== undefined && !filter.allow.has(tool.name))
      && !(filter.deny !== undefined && filter.deny.has(tool.name))
    )))
  }
  return {
    /** The scope's visible projection, exactly like ToolRuntime.schemas(agent). */
    schemas: (agent?: any) => visible(agent).map(tool => ({ ...(tool as object) })),
    /** The generated-SDK projection, i.e. what the tools:sdk section renders. */
    sdkSchemas: (agent?: any) => visible(agent),
    /** The dispatch lookup a program's nested call performs. */
    get: (toolName: string, agent?: any) => visible(agent).find((tool: any) => tool.name === toolName),
    /**
     * The scoped face the plugin reaches as `agent.ctx.tools`. On the real
     * runtime this is the service instance the scope resolves, whose methods
     * read their own context (that is what makes `agent.ctx.tools.restrict` a
     * per-scope call); here the scope is captured in the closure instead.
     */
    scoped: (agent: any) => ({
      schemas: () => visible(agent),
      sdkSchemas: () => visible(agent),
      restrict(filter: { allow?: string[]; deny?: string[] }) {
        if (options.restrictThrows === true) throw new Error('registry refused the filter')
        if (filter.allow === undefined && filter.deny === undefined) throw new Error('tools.restrict({}) is a no-op')
        const known = new Set(surface.map((tool: any) => tool.name))
        const named = [...filter.allow ?? [], ...filter.deny ?? []]
        const unknown = named.filter(toolName => !known.has(toolName))
        if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool "${unknown[0]}"`)
        const compiled = {
          ...filter.allow !== undefined ? { allow: new Set(filter.allow) } : {},
          ...filter.deny !== undefined ? { deny: new Set(filter.deny) } : {},
        }
        const layer = layers.get(agent.ctx) ?? []
        layer.push(compiled)
        layers.set(agent.ctx, layer)
        return () => {
          const index = layer.indexOf(compiled)
          if (index >= 0) layer.splice(index, 1)
          if (layer.length === 0) layers.delete(agent.ctx)
        }
      },
    }),
  }
}

interface Harness {
  listeners: Map<string, { listener: Listener; options: any }>
  warnings: string[]
  tools: ReturnType<typeof registry>
  /** Fire one hook the plugin registered; a missing hook is a test bug. */
  emit(event: string, ...args: unknown[]): Promise<unknown>
  /** Assemble for one agent, the way the harness does before the waterfall. */
  assemble(agent: any): Promise<any>
  /** The names the request's own wire carries for one scope. */
  wireNames(agent: any): string[]
  /** The durable catalog message this session would publish next step. */
  catalog(agent: any): Promise<string>
}

/**
 * The step admission the harness passes through the assemble context. The
 * catalog never inspects it: it hands it back to `tools.schemas(agent, toolSet)`
 * exactly as the shipped contract reads it, and the miniature registry applies
 * the scope's restriction on the way out.
 */
const TOOL_SET = Object.freeze({ admitted: 'step' })

interface HarnessOptions {
  restrictThrows?: boolean
  pageable?: boolean
  /** The surface the registry projects; defaults to {@link RESIDENT} plus {@link PAGED}. */
  surface?: unknown[]
  /** Omit the PTC runtime, as a deployment without one does. */
  ptcRuntime?: boolean
}

function harness(config: Record<string, unknown> = {}, options: HarnessOptions = {}): Harness {
  const surface = options.surface ?? (options.pageable === false ? RESIDENT : [...RESIDENT, ...PAGED])
  const tools = registry(surface, options)
  const listeners = new Map<string, { listener: Listener; options: any }>()
  const warnings: string[] = []
  const services: Record<string, unknown> = { tools }
  if (options.ptcRuntime !== false) services.ptcRuntime = { language: 'typescript' }
  const ctx = {
    on(event: string, callback: Listener, opts?: any) { listeners.set(event, { listener: callback, options: opts }) },
    get: (service: string) => services[service],
    logger: { warn: (message: string) => { warnings.push(message) } },
  }
  apply(ctx, config)
  const harnessed: Harness = {
    listeners,
    warnings,
    tools: tools as never,
    async emit(event: string, ...args: unknown[]) {
      return listeners.get(event)!.listener(...(args as [any, any, any]))
    },
    async assemble(agent: any) {
      // The shipped harness collects the tool providers BEFORE the waterfall and
      // merges the authoritative `tools` back AFTER it, so the presentation this
      // listener transforms carries no tool array at all; the step's admission
      // arrives in the assemble context instead.
      return listeners.get('system-prompt/assemble')!.listener(
        { sections: [] },
        { agent, toolSet: TOOL_SET },
        async () => ({ sections: [], contexts: [], variables: {} }),
      )
    },
    /** The names the request's own wire carries, as the executor renders them. */
    wireNames(agent: any) {
      return tools.schemas(agent).map((tool: any) => tool.name)
    },
    async catalog(agent: any) {
      const decision = await listeners.get('agent/pre-step')!.listener(
        { agent, messages: [{ id: 'user', source: { kind: 'user' } }], turn: 1, step: 1, signal: {} },
        async () => ({ kind: 'enter', messages: [{ id: 'user', source: { kind: 'user' } }] }),
      )
      return decision.messages.find((message: any) => message?.source?.kind === name || message?.source?.plugin === name)?.content[0].text ?? ''
    },
  }
  // A faithful SystemPrompt: the presentation a scope declares lands on the NEXT
  // assembly, which the plugin triggers by re-entering this same entry point.
  services.systemPrompt = { assemble: async (context: any) => harnessed.assemble(context?.agent) }
  return harnessed
}

/**
 * One live agent in production order: the scope is created before the first turn
 * assembles a prompt. The 0.1.6 cohort folded the former `agent/session-start`
 * into the async serial `agent/created`, so one emission carries both, and that
 * ordering is exactly what the paging sync hangs on.
 */
async function agentOf(h: Harness, events: unknown[] = []) {
  const agent: any = { session: { snapshotEvents: () => events } }
  agent.ctx = { tools: h.tools.scoped(agent) }
  await h.emit('agent/created', { agent, source: 'startup' })
  return agent
}

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

describe('gentle paging under the collapsed ptc wire', () => {
  it('operator gets the scope paged before its first request, so that request renders a consistent SDK section', async () => {
    // Given a harness whose wire carries resident tools and paged namespaces
    // When the scope is read before any assembly has run, and then assembled
    // Then the first request already excludes the withheld namespaces and the wire itself stays collapsed
    const h = harness()
    const agent = await agentOf(h)

    // No assembly has run yet. The official tools:sdk section renders exactly
    // this list, so the first request already excludes the withheld namespaces
    // instead of listing them one request too long.
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    expect(h.tools.get('mcp__codegraph__explore', agent)).toBeUndefined()

    await h.assemble(agent)
    // The registry is where paging bites, and since the waterfall cannot filter
    // the wire it is the only place it can: a program cannot reach the paged
    // tools, and neither can the generated SDK the tools:sdk section renders.
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    expect(h.tools.get('bash', agent)).toBeDefined()

    const text = await h.catalog(agent)
    expect(text).not.toContain('- `mcp__github__create_issue')
    expect(text).toContain('<inactive_namespaces>')
    expect(text).toContain('Call `tool_activate({ namespace: "github" })`')
    expect(text).toContain('Call `tool_activate({ namespace: "codegraph" })`')
    expect(text).toContain('presents these tools through `run_code`')
    // The program contract states the page is a page on the whole surface.
    expect(text).toContain('cannot be reached from inside a program either')
  })

  it('operator activates a namespace through the post-call hook, onto the program surface and into the SDK projection', async () => {
    // Given a harness whose collapsed wire has already been assembled
    // When a tool_activate call lands and the next request is assembled
    // Then the namespace reaches the program surface and the SDK projection while every other namespace stays withheld
    const h = harness()
    const agent = await agentOf(h)
    await h.assemble(agent)

    // The harness appends the tool/call before executing and the tool/result
    // after, so the post-execute hook sees the completed pair and re-pages the
    // scope before the next assembly collects its providers.
    ;(agent.session as any).snapshotEvents = () => activation('github', 'c1')
    await h.emit('tools/post-execute', { agent, name: 'tool_activate' }, {}, () => Promise.resolve({ kind: 'accept' }))
    // The next request is assembled from the re-paged registry.
    await h.assemble(agent)

    expect(h.tools.get('mcp__github__create_issue', agent)?.name).toBe('mcp__github__create_issue')
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toContain('mcp__github__list_prs')
    // Everything else stays withheld.
    expect(h.tools.get('mcp__codegraph__explore', agent)).toBeUndefined()

    const text = await h.catalog(agent)
    expect(text).toContain('- namespace `github` (activated):')
    expect(text).toContain('  - `mcp__github__create_issue')
    expect(text).toContain('Call `tool_activate({ namespace: "codegraph" })`')
    expect(text).not.toContain('Call `tool_activate({ namespace: "github" })`')
  })

  it('operator sees the evicted namespace withheld again once a fourth activation pages it out', async () => {
    // Given four activations recorded in the durable event stream
    // When the next assembly publishes the page
    // Then the least recently used namespace is withheld again while the newer ones stay reachable
    const h = harness()
    const agent = await agentOf(h, [
      ...activation('github', 'c1'),
      ...activation('codegraph', 'c2'),
      ...activation('ssh', 'c3'),
      ...activation('docker', 'c4'),
    ])
    // The page is installed before this request; the assembly publishes it.
    await h.assemble(agent)

    // LRU capacity three: github went back to the paged summary.
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    expect(h.tools.get('mcp__ssh__exec', agent)).toBeDefined()
    expect(h.tools.get('mcp__docker__ps', agent)).toBeDefined()

    const text = await h.catalog(agent)
    expect(text).toContain('Call `tool_activate({ namespace: "github" })`')
    expect(text).not.toContain('- `mcp__github__create_issue')
  })

  it('rebuilds the same page from the durable event stream alone', async () => {
    // The restriction is derived from the log, never from process memory: a
    // fresh plugin registration over the same events produces the same page.
    const events = activation('github', 'c1')
    const first = harness()
    const second = harness()
    const agentA = await agentOf(first, events)
    const agentB = await agentOf(second, events)
    expect(first.tools.sdkSchemas(agentA).map((tool: any) => tool.name))
      .toEqual(second.tools.sdkSchemas(agentB).map((tool: any) => tool.name))
    expect(await first.catalog(agentA)).toBe(await second.catalog(agentB))
    expect(first.tools.sdkSchemas(agentA).map((tool: any) => tool.name)).toContain('mcp__github__create_issue')
  })

  it('keeps the page installed across assemblies, in the ptc wording', async () => {
    // Given a paged scope, When a second assembly runs, Then it re-derives the
    // same page and the catalog still describes it as the collapsed transport:
    // activation, not another assembly, is what lifts a namespace.
    const h = harness()
    const agent = await agentOf(h)
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    await h.assemble(agent)
    await h.assemble(agent)
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    const text = await h.catalog(agent)
    expect(text).toContain('The page covers the whole surface here')
    expect(text).toContain('presents these tools through `run_code`')
  })

  it('does not accumulate restrictions across syncs', async () => {
    const h = harness()
    const agent = await agentOf(h)
    const once = h.tools.sdkSchemas(agent).map((tool: any) => tool.name)
    await h.emit('agent/created', { agent, source: 'resume' })
    await h.assemble(agent)
    await h.emit('tools/post-execute', { agent, name: 'read' }, {}, () => Promise.resolve({ kind: 'accept' }))
    // A stale filter left in place, or a re-sync that reads its own output,
    // would keep shrinking the surface instead of holding steady.
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toEqual(once)
    expect(once).toEqual(['bash', 'read'])
  })

  it("pages the 'native' roster too, since the waterfall can no longer filter it", async () => {
    const h = harness({ presentation: 'native' })
    const agent = await agentOf(h)
    await h.assemble(agent)
    // The native wire is rendered from the registry, so a restriction is the
    // only mechanism left that keeps a paged family off it.
    expect(h.wireNames(agent)).toEqual(['bash', 'read'])
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    const text = await h.catalog(agent)
    expect(text).toContain('<inactive_namespaces>')
    expect(text).not.toContain('run_code')
  })

  it('survives a registry that refuses the restriction, warning once and keeping every tool', async () => {
    const h = harness({}, { restrictThrows: true })
    const agent = await agentOf(h)
    await h.emit('agent/created', { agent, source: 'resume' })
    await h.assemble(agent)

    // The refusal is reported once and the session keeps its whole surface.
    const pagingWarnings = h.warnings.filter(message => message.includes('could not restrict'))
    expect(pagingWarnings).toHaveLength(1)
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()
    const text = await h.catalog(agent)
    expect(text).toContain('- `mcp__github__create_issue')
    expect(text).not.toContain('<inactive_namespaces>')
  })

  it('pages a native fallback deployment too, where no code runtime is mounted', async () => {
    // 'ptc' is configured but no PTC runtime is mounted, so the scope never
    // declares the collapse and the wire stays native. Before 0.2.2 that wire
    // carried paging by itself (the listener returned a narrowed array); the
    // harness now owns `tools`, so the registry restriction is the only page
    // left - and the catalog states exactly that page.
    const h = harness({ presentation: 'ptc' }, { ptcRuntime: false })
    const agent = await agentOf(h)

    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()

    await h.assemble(agent)
    expect(h.wireNames(agent)).toEqual(['bash', 'read'])

    const text = await h.catalog(agent)
    expect(text).toContain('<inactive_namespaces>')
    expect(text).toContain('This presentation carries no program transport')
    expect(text).not.toContain('run_code')
  })

  it('pages a scope whose composition selects the native roster', async () => {
    // No declaration is involved any more: the composition's executor row is
    // the transport, and the native roster is paged exactly the same way.
    const h = harness({ presentation: 'native' })
    const agent = await agentOf(h)

    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()

    await h.assemble(agent)
    expect(h.wireNames(agent)).toEqual(['bash', 'read'])
    expect(h.warnings).toEqual([])
  })

  it('never names the reserved transport in a restriction, even with nothing paged', async () => {
    const h = harness({}, { pageable: false })
    const agent = await agentOf(h)
    await h.assemble(agent)
    expect(h.wireNames(agent)).toEqual(['bash', 'read'])
    // Nothing matched the paging patterns, so no filter was installed at all —
    // and the transport survives.
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(h.warnings).toEqual([])
  })
})

/**
 * The plugin tool families the shipped patterns page. Every one of them is a
 * tool this preset's own rows mount, and each is claimed by a literal prefix
 * rather than by an `mcp__` bridge — so these tests pin the second derivation
 * the patterns learned, and that the host builtins beside them never page.
 */
describe('plugin tool families under the shipped patterns', () => {
  const PLUGIN_SURFACE = [...RESIDENT, ...PLUGIN]

  it('operator gets every shipped plugin family paged out before the first request', async () => {
    // Given a scope whose rows mount the plugin tool families
    // When the scope is created and the first request is assembled
    // Then the wire, the generated SDK and a program dispatch all carry the host
    //      builtins alone, and the catalog names each family with its own pointer
    const h = harness({}, { surface: PLUGIN_SURFACE })
    const agent = await agentOf(h)

    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    await h.assemble(agent)
    expect(h.wireNames(agent)).toEqual(['bash', 'read'])
    // A program's nested dispatch resolves against the same registry, so the
    // call is refused, not merely hidden from the SDK projection.
    expect(h.tools.get('task_board_list', agent)).toBeUndefined()
    expect(h.tools.get('ui_present', agent)).toBeUndefined()

    const text = await h.catalog(agent)
    for (const namespace of ['browser', 'squad', 'ssh', 'task_board', 'team', 'ui']) {
      expect(text).toContain(`Call \`tool_activate({ namespace: "${namespace}" })\``)
    }
    // One namespace, both squad spellings.
    expect(text).toContain('- `squad` (2 tools, e.g. `squad_member_add`): Add a squad member. Call `tool_activate({ namespace: "squad" })`')
    expect(text).not.toContain('- `task_board_list')
  })

  it('operator activates one family and gets exactly its tools back', async () => {
    // Given a paged plugin surface whose log already carries one activation
    // When the next request is assembled
    // Then that family reaches the program surface and the SDK projection while
    //      every other family stays paged
    const h = harness({}, { surface: PLUGIN_SURFACE })
    const agent = await agentOf(h, [...activation('task_board', 'c1')])
    await h.assemble(agent)

    expect(h.tools.get('task_board_list', agent)?.name).toBe('task_board_list')
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toContain('task_board_create')
    expect(h.tools.get('browser_navigate', agent)).toBeUndefined()
    expect(h.tools.get('squads_create', agent)).toBeUndefined()

    const text = await h.catalog(agent)
    expect(text).toContain('- namespace `task_board` (activated):')
    expect(text).not.toContain('Call `tool_activate({ namespace: "task_board" })`')
    expect(text).toContain('Call `tool_activate({ namespace: "squad" })`')
  })

  it('operator sees the oldest plugin family paged out once a fourth is activated', async () => {
    // Given four plugin families activated in the durable log
    // When the next assembly publishes the page
    // Then the least recently used family is withheld again while the newer three stay reachable
    const h = harness({}, { surface: PLUGIN_SURFACE })
    const agent = await agentOf(h, [
      ...activation('task_board', 'c1'),
      ...activation('squad', 'c2'),
      ...activation('browser', 'c3'),
      ...activation('ssh', 'c4'),
    ])
    await h.assemble(agent)

    expect(h.tools.get('task_board_list', agent)).toBeUndefined()
    expect(h.tools.get('squads_create', agent)?.name).toBe('squads_create')
    expect(h.tools.get('browser_navigate', agent)?.name).toBe('browser_navigate')
    expect(h.tools.get('ssh_exec', agent)?.name).toBe('ssh_exec')

    const text = await h.catalog(agent)
    expect(text).toContain('Call `tool_activate({ namespace: "task_board" })`')
    expect(text).not.toContain('- `task_board_list')
  })

  it('operator keeps a family used from inside a program on the wire past the LRU cap', async () => {
    // Given three active plugin families and a use of the OLDEST through a dispatch
    // When a fourth family is activated
    // Then the used family is still reachable and the untouched one is paged out
    const h = harness({}, { surface: PLUGIN_SURFACE })
    const agent = await agentOf(h, [
      ...activation('task_board', 'c1'),
      ...activation('squad', 'c2'),
      ...activation('browser', 'c3'),
      ptcToolDispatch('task_board_list', 'call_root:ptc:1'),
      ...activation('ssh', 'c4'),
    ])
    await h.assemble(agent)

    expect(h.tools.get('task_board_list', agent)?.name).toBe('task_board_list')
    expect(h.tools.get('browser_navigate', agent)?.name).toBe('browser_navigate')
    expect(h.tools.get('ssh_exec', agent)?.name).toBe('ssh_exec')
    expect(h.tools.get('squads_create', agent)).toBeUndefined()

    const text = await h.catalog(agent)
    expect(text).toContain('Call `tool_activate({ namespace: "squad" })`')
    expect(text).not.toContain('Call `tool_activate({ namespace: "task_board" })`')
  })

  it('operator gets MCP servers and plugin families paged side by side, each under its own name', async () => {
    // Given one surface carrying both an MCP bridge and the plugin families
    // When the shipped patterns page it and one MCP namespace is activated
    // Then the MCP derivation is untouched and one activation lifts one namespace
    const h = harness({}, { surface: [...RESIDENT, ...PAGED, ...PLUGIN] })
    const agent = await agentOf(h, [...activation('github', 'c1')])
    await h.assemble(agent)

    expect(h.tools.get('mcp__github__create_issue', agent)?.name).toBe('mcp__github__create_issue')
    expect(h.tools.get('mcp__codegraph__explore', agent)).toBeUndefined()
    expect(h.tools.get('squads_create', agent)).toBeUndefined()
    expect(h.tools.get('task_board_list', agent)).toBeUndefined()

    const text = await h.catalog(agent)
    expect(text).toContain('Call `tool_activate({ namespace: "codegraph" })`')
    expect(text).toContain('Call `tool_activate({ namespace: "task_board" })`')
    expect(text).toContain('Call `tool_activate({ namespace: "squad" })`')
  })

  it('operator keeps every host builtin resident in both presentations', async () => {
    // Given a scope carrying the plugin families beside the host builtins
    // When both presentations assemble
    // Then the builtins stay on the wire and reachable, whatever the transport
    await Promise.all(['native', 'ptc'].map(async (presentation) => {
      const h = harness({ presentation }, {
        surface: [...PLUGIN_SURFACE, { name: 'web_search', description: 'Search the web.' }],
      })
      const agent = await agentOf(h)
      await h.assemble(agent)
      expect(h.wireNames(agent), presentation).toEqual(['bash', 'read', 'web_search'])
      expect(h.tools.get('read', agent)?.name, presentation).toBe('read')
      expect(h.tools.get('web_search', agent)?.name, presentation).toBe('web_search')
      expect(h.warnings, presentation).toEqual([])
    }))
  })
})

/**
 * The activation tool has to offer exactly the namespaces the catalog
 * advertises, and under `ptc` those are the ones the live restriction already
 * removed from every scoped reader. The catalog pages the harness registry and
 * the activation row resolves its enumeration through that same registry via
 * `agent.ctx.tools` — only the row's own `ctx` is a capture stub — so the
 * activation faces the same filtered scope the production session does:
 * reading `tools.schemas(agent)` back would find an empty page and refuse a
 * namespace the same request's catalog names.
 */
/**
 * One ordinary tool call as the ptc runtime records it: under the default
 * presentation a top-level `tool/call` is always `run_code`, so a real tool
 * call reaches the log as a dispatch and nowhere else.
 */
function ptcToolDispatch(toolName: string, subCallId: string, isError = false) {
  return {
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
  }
}

/** One activation as the ptc runtime records it: a dispatch, not a tool call. */
function ptcDispatch(namespace: string, subCallId: string) {
  return {
    type: 'tool/ptc-dispatch',
    data: {
      rootCallId: 'call_root',
      parentCallId: 'call_root',
      subCallId,
      name: 'tool_activate',
      arguments: { namespace },
      isError: false,
      content: [{ type: 'text', text: 'Activated' }],
    },
  }
}

describe('tool_activate against the restricted ptc surface', () => {
  /** Mount the sibling row with one config and return its tool. */
  function activateToolWith(config: Record<string, unknown>): any {
    const registered: any[] = []
    applyActivate({ tools: { register: (spec: any) => registered.push(spec) }, get: () => undefined }, config)
    expect(registered).toHaveLength(1)
    return registered[0]
  }

  /** Mount the sibling row on its shipped default and return its tool. */
  function activateTool(): any {
    return activateToolWith({})
  }

  it('operator gets one eviction answer from the catalog and the activation tool under custom patterns', async () => {
    // Given a catalog and an activation tool mounted on ONE custom pattern list
    // When a use of the custom-only foo family refreshes it and a fourth
    //      activation pushes github past the cap
    // Then the activation tool agrees github was evicted and re-activates it,
    //      instead of refusing it as already active while the registry withholds it
    const custom = ['mcp__*', 'foo_*']
    const h = harness({ pagedToolPatterns: custom }, { surface: [...RESIDENT, ...PAGED, ...PLUGIN, FOO_TOOL] })
    const agent = await agentOf(h, [
      ...activation('foo', 'c1'),
      ...activation('github', 'c2'),
      ...activation('codegraph', 'c3'),
      // Only the custom list reads this name as a family: a row replaying the
      // log with the shipped list refreshes nothing here, and the two replays
      // part ways — which is how the deadlock opened.
      ptcToolDispatch('foo_exec', 'call_root:ptc:1'),
      ...activation('docker', 'c4'),
    ])
    await h.assemble(agent)

    // The registry withheld github while keeping the refreshed foo family.
    expect(h.tools.get('mcp__github__list_prs', agent)).toBeUndefined()
    expect(h.tools.get('foo_exec', agent)?.name).toBe('foo_exec')

    const tool = activateToolWith({ pagedToolPatterns: custom })
    // Re-activating the evicted family is the call that used to be refused.
    const result = await tool.execute({ namespace: 'github' }, { callId: 'call-2', agent })
    expect(result.text).toContain('Activated namespace "github" (2 tools): mcp__github__create_issue, mcp__github__list_prs')
    // A family that really is active keeps its refusal.
    await expect(tool.execute({ namespace: 'foo' }, { callId: 'call-3', agent }))
      .rejects.toThrow(/already active/)
  })

  it('activates a namespace the restriction hid from the scope projection', async () => {
    const h = harness()
    const agent = await agentOf(h)
    // The page is real: the projection the activation tool could read itself
    // no longer lists the paged names.
    expect(h.tools.schemas(agent).map((tool: any) => tool.name)).toEqual(['bash', 'read'])

    const result = await activateTool().execute({ namespace: 'github' }, { callId: 'call-1', agent })
    expect(result.text).toContain('Activated namespace "github" (2 tools): mcp__github__create_issue, mcp__github__list_prs')
  })

  it('lifts the page for a namespace activated from inside a program', async () => {
    // The end of the loop the paged wire depends on: the activation is recorded
    // as a dispatch, the catalog replays it, and the scope stops withholding it.
    const h = harness()
    const agent = await agentOf(h, [ptcDispatch('github', 'call_root:ptc:1')])

    const names = h.tools.schemas(agent).map((tool: any) => tool.name)
    expect(names).toContain('mcp__github__create_issue')
    expect(names).not.toContain('mcp__codegraph__explore')
  })

  it('still names a namespace whose tools are all already active', async () => {
    const h = harness()
    const agent = await agentOf(h, [...activation('github', 'call-a')])
    // Nothing of github is withheld any more, so that half of the page is not
    // in the projection at all — the publication is what keeps it nameable.
    expect(h.tools.schemas(agent).map((tool: any) => tool.name)).toContain('mcp__github__create_issue')
    await expect(activateTool().execute({ namespace: 'github' }, { callId: 'call-b', agent }))
      .rejects.toThrow(/already active/)
  })
})
