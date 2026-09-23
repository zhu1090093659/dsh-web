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

type Listener = (first: any, second: any, third: any) => Promise<any>

/** The run_code transport the registry reserves for a code presentation. */
const RUN_CODE = {
  name: 'run_code',
  description: 'Execute a TypeScript program against the available tools.',
  parameters: { type: 'object', properties: { code: { type: 'string' }, description: { type: 'string' } } },
}

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

interface RegistryOptions {
  restrictThrows?: boolean
  presentThrows?: boolean
}

/**
 * The miniature registry: one global surface, per-scope restriction layers, and
 * the reserved transport appended for any scope presenting through code.
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
      presentAs(mode: string) {
        // A host that declines the declaration: the scope keeps the native wire.
        if (options.presentThrows === true) throw new Error('presentation declaration rejected by host policy')
        agent.mode = mode
        return () => { agent.mode = undefined }
      },
      schemas: () => (agent.mode === undefined || agent.mode === 'native' ? visible(agent) : [...visible(agent), RUN_CODE]),
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
  /** The durable catalog message this session would publish next step. */
  catalog(agent: any): Promise<string>
}

interface HarnessOptions {
  restrictThrows?: boolean
  pageable?: boolean
  /** Omit the PTC runtime, as a deployment without one does. */
  ptcRuntime?: boolean
  /** Refuse the presentation declaration, as host policy can. */
  presentThrows?: boolean
}

function harness(config: Record<string, unknown> = {}, options: HarnessOptions = {}): Harness {
  const surface = options.pageable === false ? RESIDENT : [...RESIDENT, ...PAGED]
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
      // The harness collects the tool providers BEFORE the waterfall: the wire
      // this assembly carries is decided by the presentation the scope had.
      const wire = agent.mode === 'ptc'
        ? [{ ...RUN_CODE }]
        : agent.mode === 'both'
          ? [...tools.schemas(agent), { ...RUN_CODE }]
          : tools.schemas(agent)
      return listeners.get('system-prompt/assemble')!.listener(
        { sections: [] },
        { agent },
        async () => ({ sections: [], contexts: [], tools: wire, variables: {} }),
      )
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
  it('pages the scope before its FIRST request, so that request renders a consistent SDK section', async () => {
    const h = harness()
    const agent = await agentOf(h)

    // No assembly has run yet. The official tools:sdk section renders exactly
    // this list, so the first request already excludes the withheld namespaces
    // instead of listing them one request too long.
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    expect(h.tools.get('mcp__codegraph__explore', agent)).toBeUndefined()

    const assembled = await h.assemble(agent)
    // The wire itself is the collapsed transport, as always.
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['run_code'])
    // The registry is where paging bites: a program cannot reach the paged
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

  it('activates a namespace through the post-call hook, onto the program surface and into the SDK projection', async () => {
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

  it('withholds the evicted namespace again once a fourth activation pages it out', async () => {
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

  it('drops the page once the wire stops being the collapsed transport', async () => {
    const h = harness()
    const agent = await agentOf(h)
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeUndefined()
    // The declaration is reverted (or the presentation changed): the native
    // roster comes back, so a filter left behind would keep hiding tool families
    // that wire now hands back.
    agent.mode = 'native'
    await h.assemble(agent)
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toContain('mcp__codegraph__explore')
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

  it("leaves 'both' untouched: no restriction, and the SDK note still reaches paged namespaces", async () => {
    const h = harness({ presentation: 'both' })
    const agent = await agentOf(h)
    const assembled = await h.assemble(agent)

    // The native roster rides beside run_code, and the paged families come off
    // it exactly as they do under 'native'.
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read', 'run_code'])
    // Unrestricted at the registry: the documented escape hatch through the SDK
    // inside a program survives, from the FIRST request on.
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toContain('mcp__codegraph__explore')

    const text = await h.catalog(agent)
    expect(text).toContain('<inactive_namespaces>')
    expect(text).toContain('stay reachable through the SDK inside a program even before activation')
    expect(text).toContain('Call `tool_activate({ namespace: "github" })`')
  })

  it("leaves 'native' untouched: paging stays a wire-only concern", async () => {
    const h = harness({ presentation: 'native' })
    const agent = await agentOf(h)
    const assembled = await h.assemble(agent)
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()
    const text = await h.catalog(agent)
    expect(text).toContain('<inactive_namespaces>')
    expect(text).not.toContain('run_code')
  })

  it('survives a registry that refuses the restriction, warning once and keeping every tool', async () => {
    const h = harness({}, { restrictThrows: true })
    const agent = await agentOf(h)
    await h.emit('agent/created', { agent, source: 'resume' })
    const assembled = await h.assemble(agent)

    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['run_code'])
    // The refusal is reported once and the session keeps its whole surface.
    const pagingWarnings = h.warnings.filter(message => message.includes('could not restrict'))
    expect(pagingWarnings).toHaveLength(1)
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()
    const text = await h.catalog(agent)
    expect(text).toContain('- `mcp__github__create_issue')
    expect(text).not.toContain('<inactive_namespaces>')
  })

  it('installs no page at all when the deployment has no PTC runtime', async () => {
    // The documented fallback: 'ptc' is configured but no PTC runtime is
    // mounted, so the scope never declares the collapse and the wire stays
    // native. The assembled array already carries paging by itself, so a
    // registry restriction here would strip the paged families from a wire that
    // is supposed to carry them — and the catalog would announce namespaces as
    // withheld that nothing withheld.
    const h = harness({ presentation: 'ptc' }, { ptcRuntime: false })
    const agent = await agentOf(h)

    // No declaration, therefore no restriction, therefore no page.
    expect(agent.mode).toBeUndefined()
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toContain('mcp__codegraph__explore')
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()

    const assembled = await h.assemble(agent)
    // The wire is the native one, and paging there is the wire partition's own
    // job — that is what keeps the paged families off a native roster. What must
    // NOT happen is the registry losing them: an unrunnable collapse means no
    // page, so the scope keeps reaching every tool it was given.
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toContain('mcp__codegraph__explore')

    const text = await h.catalog(agent)
    expect(text).toContain('<inactive_namespaces>')
    expect(text).not.toContain('run_code')
  })

  it('installs no page when the host declines the presentation declaration', async () => {
    // A declined declaration keeps the native wire exactly like a missing
    // runtime does, and paging must not engage on a wire that cannot collapse.
    const h = harness({ presentation: 'ptc' }, { presentThrows: true })
    const agent = await agentOf(h)

    expect(agent.mode).toBeUndefined()
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()

    const assembled = await h.assemble(agent)
    // Same as the missing runtime: the native wire pages through the assembled
    // array, and the registry is left alone.
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(h.tools.get('mcp__github__create_issue', agent)).toBeDefined()
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toContain('mcp__codegraph__explore')
    expect(h.warnings.some(w => w.includes('presentation was declined'))).toBe(true)
  })

  it('never names the reserved transport in a restriction, even with nothing paged', async () => {
    const h = harness({}, { pageable: false })
    const agent = await agentOf(h)
    const assembled = await h.assemble(agent)
    expect(assembled.tools.map((tool: any) => tool.name)).toEqual(['run_code'])
    // Nothing matched the paging patterns, so no filter was installed at all —
    // and the transport survives.
    expect(h.tools.sdkSchemas(agent).map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(h.warnings).toEqual([])
  })
})
