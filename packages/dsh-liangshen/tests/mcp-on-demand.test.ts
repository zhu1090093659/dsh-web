import { describe, expect, it } from 'vitest'
import {
  apply as applyMinimalPrompt,
  isMcpOnDemandToolsSection,
} from '../presets/liangshen/minimal-prompt.mjs'
import {
  DEFAULT_PAGED_TOOL_PATTERNS,
  isMcpOnDemandLoader,
  mcpOnDemandServerOf,
  namespaceOf,
  partitionWireTools,
  withheldToolNames,
} from '../presets/liangshen/paging.mjs'

function createPromptHarness(config = {}) {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    on(event: string, fn: (...args: unknown[]) => unknown) {
      listeners.set(event, fn)
      return () => {}
    },
    logger: { warn: () => {} },
  }
  applyMinimalPrompt(ctx, config)
  return listeners
}

describe('official MCP on-demand tool loading compatibility', () => {
  it('user configuring an on-demand MCP server keeps its loader and loaded tools resident while eager MCP servers stay paged', () => {
    // Given a tool surface mixing an on-demand MCP server (loader + loaded tool) and an eager MCP server
    const tools = [
      { name: 'read', description: 'Read a file' },
      { name: 'mcp__github__load_tools', description: 'Load GitHub tools on demand' },
      { name: 'mcp__github__create_issue', description: 'Create a GitHub issue' },
      { name: 'mcp__codegraph__explore', description: 'Explore code graph' },
    ]
    // When LiangShen partitions the surface and computes withheld tools with no active namespaces
    const { resident, inactive } = partitionWireTools(tools, DEFAULT_PAGED_TOOL_PATTERNS, [])
    const withheld = withheldToolNames(tools, DEFAULT_PAGED_TOOL_PATTERNS, [])
    // Then the on-demand loader and its loaded tool stay resident while the eager MCP server is still paged
    expect(isMcpOnDemandLoader('mcp__github__load_tools')).toBe(true)
    expect(mcpOnDemandServerOf('mcp__github__load_tools')).toBe('github')
    expect(namespaceOf('mcp__github__load_tools', DEFAULT_PAGED_TOOL_PATTERNS)).toBeUndefined()
    expect(resident.map(tool => tool.name)).toEqual([
      'read',
      'mcp__github__load_tools',
      'mcp__github__create_issue',
    ])
    expect([...inactive.keys()]).toEqual(['codegraph'])
    expect(withheld).toEqual(['mcp__codegraph__explore'])
  })

  it('user using an on-demand MCP server retains its mcp:<server>:tools prompt catalog in minimal-prompt', async () => {
    // Given an assembled system prompt carrying persona, an official on-demand MCP catalog, and unrelated sections
    const listeners = createPromptHarness({ dispatcher: false })
    const assemble = listeners.get('system-prompt/assemble') as (
      assembly: unknown,
      context: unknown,
      next: () => Promise<{ sections: Array<{ name: string; text: string }>; contexts: unknown[]; variables: Record<string, unknown> }>,
    ) => Promise<{ sections: Array<{ name: string; text: string }> }>
    // When minimal-prompt filters the assembled prompt sections
    const result = await assemble(
      undefined,
      { agent: { session: { header: { cwd: '/repo' } } } },
      async () => ({
        sections: [
          { name: 'deployment:persona-prefix', text: 'You are a helpful software engineer assistant.' },
          { name: 'mcp:github:tools', text: 'On-demand tools from MCP server github:\n- create_issue' },
          { name: 'mcp:github:instructions', text: 'Unrelated verbose instructions' },
          { name: 'harness:identity', text: 'Harness banner' },
        ],
        contexts: [],
        variables: {},
      }),
    )
    // Then the persona and on-demand MCP catalog survive while unrelated sections remain filtered out
    expect(isMcpOnDemandToolsSection('mcp:github:tools')).toBe(true)
    expect(isMcpOnDemandToolsSection('mcp:github:instructions')).toBe(false)
    expect(result.sections.map(section => section.name)).toEqual([
      'deployment:persona-prefix',
      'mcp:github:tools',
    ])
  })
})
