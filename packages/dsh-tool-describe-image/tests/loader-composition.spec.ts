// Proves describe-image is real configurability and not a constant: the config
// block is set in a cordis.yml booted through the real Loader, the tool
// registers on the tool runtime, and an end-to-end call reaches the configured
// endpoint — including the sanctioned `!!js process.env.X` inline-key pattern.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId as CallId } from '@deepseek-ai/dsh-llm/brand'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as DescribeImage from '../src/index.ts'

import { chatReply, FakeWebServer, jsonReply, PNG_BYTES, responsesReply, startMockServer } from './mock-server.ts'
import { agentForWorkspace } from './test-agent.ts'
import type { MockServer } from './mock-server.ts'

let root: string | undefined
let context: Context | undefined
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await Promise.all(cleanup.splice(0).map(close => close()))
})

/**
 * Boot a cordis.yml carrying the given describe-image config block.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-describe-image-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-tool-describe-image'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-describe-image', DescribeImage],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

async function tempPng(): Promise<{ path: string; workspace: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-image-loader-file-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pixel.png')
  await writeFile(path, PNG_BYTES)
  return { path, workspace: dir }
}

function callDescribe(ctx: Context, image: string, workspace?: string) {
  const agent = agentForWorkspace(workspace)
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('loader-vision-call'),
    name: 'describe_image',
    arguments: { image },
    ...(agent === undefined ? {} : { agent }),
  })
}

describe('describe-image real Loader composition through cordis.yml', () => {
  it('boots the configured endpoint and describes a local file end to end', async () => {
    const server: MockServer = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('Composed.')) })
    cleanup.push(server.close)
    const ctx = await boot([
      `    baseURL: ${server.url}`,
      "    model: 'loader-vision-1'",
      "    apiKey: 'sk-from-cordis'",
    ])
    const schema = ctx.tools.schemas().find(s => s.name === 'describe_image')
    expect(schema).toBeDefined()

    const { path, workspace } = await tempPng()
    const result = await callDescribe(ctx, path, workspace)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'Composed.', model: 'loader-vision-1' })
    expect(server.request(0).authorization).toBe('Bearer sk-from-cordis')
  }, 30_000)

  it('honors apiStyle: responses from cordis.yml and posts /responses', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, responsesReply('Composed responses.')) })
    cleanup.push(server.close)
    const ctx = await boot([
      `    baseURL: ${server.url}`,
      "    model: 'loader-vision-1'",
      "    apiKey: 'sk-from-cordis'",
      "    apiStyle: responses",
    ])

    const { path, workspace } = await tempPng()
    const result = await callDescribe(ctx, path, workspace)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'Composed responses.', model: 'loader-vision-1' })
    expect(server.request(0).path).toBe('/responses')
    const body = server.request(0).body as { max_output_tokens?: unknown }
    expect(body.max_output_tokens).toBe(DescribeImage.DEFAULT_MAX_OUTPUT_TOKENS)
  }, 30_000)

  it('feeds the inline apiKey from the environment through the sanctioned !!js pattern', async () => {
    process.env.DSH_DESCRIBE_E2E_KEY = 'sk-from-env'
    try {
      const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('Env key.')) })
      cleanup.push(server.close)
      const ctx = await boot([
        `    baseURL: ${server.url}`,
        "    model: 'loader-vision-1'",
        '    apiKey: !!js process.env.DSH_DESCRIBE_E2E_KEY',
      ])

      const { path, workspace } = await tempPng()
      await callDescribe(ctx, path, workspace)
      expect(server.request(0).authorization).toBe('Bearer sk-from-env')
    } finally {
      delete process.env.DSH_DESCRIBE_E2E_KEY
    }
  }, 30_000)

  it.each([
    { label: 'is omitted', configLines: ['    model: vision-1'], failure: 'describe-image: baseURL must be an absolute http(s) URL' },
    { label: 'is not http(s)', configLines: ['    baseURL: ftp://api.example.com', '    model: vision-1'], failure: 'baseURL must be an absolute http(s) URL' },
    { label: 'is empty', configLines: ['    baseURL: https://api.example.com', '    model: ""'], failure: 'model must be a non-empty model id' },
  ])('fails loading when baseURL/model $label', async ({ configLines, failure }) => {
    await expect(boot(configLines)).rejects.toThrow(failure)
  }, 30_000)

  it('mounts without configuration (family default) and fails per call with a clear message', async () => {
    const ctx = await boot([])
    const schema = ctx.tools.schemas().find(s => s.name === 'describe_image')
    expect(schema).toBeDefined()

    // The tool is registered; the first call fails on the missing endpoint,
    // before any image is loaded — the family aggregate mounts this way.
    const result = await callDescribe(ctx, '/tmp/unconfigured.png')
    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toContain('describe-image: baseURL must be an absolute http(s) URL')
  }, 30_000)
})