import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId as CallId } from '@deepseek-ai/dsh-llm/brand'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'
import { resolveConfig } from '../src/config-resolve.ts'
import { chatReply, FakeWebServer, jsonReply, PNG_BYTES, startMockServer } from './mock-server.ts'

describe('describe-image multi-endpoint rotation and failover (Issue #1234)', () => {
  const cleanup: Array<() => Promise<void>> = []
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
    await Promise.all(cleanup.splice(0).map(close => close()))
  })

  async function tempPng(): Promise<{ path: string; workspace: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-rotation-test-'))
    cleanup.push(async () => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'pixel.png')
    await writeFile(path, PNG_BYTES)
    return { path, workspace: dir }
  }

  function agentForWorkspace(workspace: string): Agent {
    return { session: { header: { cwd: workspace } } } as unknown as Agent
  }

  function callDescribe(ctx: Context, args: unknown, workspace: string) {
    return ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('vision-rotation-call'),
      name: 'describe_image',
      arguments: args,
      agent: agentForWorkspace(workspace),
    })
  }

  function errorText(result: { content: { type: string; text?: string }[] }): string {
    return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
  }

  async function mountPlugin(config: tool.Config): Promise<Context> {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(FakeWebServer)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, config)
    return ctx
  }

  describe('configuration resolution', () => {
    it('resolves multi-endpoint configuration with defaults inherited', () => {
      const resolved = resolveConfig({
        apiKeyEnv: 'GLOBAL_KEY',
        apiStyle: 'chat-completions',
        maxOutputTokens: 2048,
        endpoints: [
          { name: 'Zhipu', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v', apiKey: 'sk-zhipu' },
          { name: 'Qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max:off', apiKeyEnv: 'QWEN_KEY' },
        ],
      })

      expect(resolved.endpoints).toHaveLength(2)
      expect(resolved.rotationMode).toBe('round-robin')
      expect(resolved.retryNextOnFailure).toBe(true)

      const [ep1, ep2] = resolved.endpoints
      expect(ep1.name).toBe('Zhipu')
      expect(ep1.baseURL).toBe('https://open.bigmodel.cn/api/paas/v4')
      expect(ep1.model).toBe('glm-4v')
      expect(ep1.apiKey).toBe('sk-zhipu')
      expect(ep1.apiStyle).toBe('chat-completions')
      expect(ep1.maxOutputTokens).toBe(2048)
      expect(ep1.enabled).toBe(true)

      expect(ep2.name).toBe('Qwen')
      expect(ep2.baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
      expect(ep2.model).toBe('qwen-vl-max')
      expect(ep2.thinking).toBe('off')
      expect(ep2.apiKeyEnv).toBe('QWEN_KEY')
      expect(ep2.enabled).toBe(true)
    })

    it('rejects if all endpoints are disabled', () => {
      expect(() => {
        resolveConfig({
          endpoints: [
            { baseURL: 'https://api.example.com/v1', model: 'v1', enabled: false },
          ],
        })
      }).toThrow('at least one endpoint in endpoints must be enabled')
    })

    it('rejects invalid endpoint baseURL or model', () => {
      expect(() => {
        resolveConfig({
          endpoints: [
            { baseURL: 'invalid-url', model: 'm1' },
          ],
        })
      }).toThrow('describe-image: endpoint baseURL must be an absolute http(s) URL')

      expect(() => {
        resolveConfig({
          endpoints: [
            { baseURL: 'https://api.example.com', model: '   ' },
          ],
        })
      }).toThrow('describe-image: endpoint model must be a non-empty model id')
    })
  })

  describe('round-robin rotation across multiple endpoints', () => {
    it('cycles through configured endpoints on successive calls', async () => {
      const server1 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Answer from server 1 (glm-4v)'))
      })
      cleanup.push(server1.close)

      const server2 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Answer from server 2 (qwen-vl)'))
      })
      cleanup.push(server2.close)

      const ctx = await mountPlugin({
        rotationMode: 'round-robin',
        endpoints: [
          { name: 'Endpoint-1', baseURL: server1.url, model: 'glm-4v', apiKey: 'sk-1' },
          { name: 'Endpoint-2', baseURL: server2.url, model: 'qwen-vl', apiKey: 'sk-2' },
        ],
      })

      const { path, workspace } = await tempPng()

      // Call 1 -> hits server 1
      const res1 = await callDescribe(ctx, { image: path, prompt: 'Prompt 1' }, workspace)
      expect(res1.isError).toBe(false)
      expect(res1.value).toMatchObject({
        text: 'Answer from server 1 (glm-4v)',
        model: 'glm-4v',
      })
      expect(server1.requests).toHaveLength(1)
      expect(server2.requests).toHaveLength(0)

      // Call 2 -> hits server 2
      const res2 = await callDescribe(ctx, { image: path, prompt: 'Prompt 2' }, workspace)
      expect(res2.isError).toBe(false)
      expect(res2.value).toMatchObject({
        text: 'Answer from server 2 (qwen-vl)',
        model: 'qwen-vl',
      })
      expect(server1.requests).toHaveLength(1)
      expect(server2.requests).toHaveLength(1)

      // Call 3 -> cycles back to server 1
      const res3 = await callDescribe(ctx, { image: path, prompt: 'Prompt 3' }, workspace)
      expect(res3.isError).toBe(false)
      expect(res3.value).toMatchObject({
        text: 'Answer from server 1 (glm-4v)',
        model: 'glm-4v',
      })
      expect(server1.requests).toHaveLength(2)
      expect(server2.requests).toHaveLength(1)
    })

    it('skips disabled endpoints in rotation', async () => {
      const server1 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Disabled server 1'))
      })
      cleanup.push(server1.close)

      const server2 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Answer from server 2'))
      })
      cleanup.push(server2.close)

      const ctx = await mountPlugin({
        rotationMode: 'round-robin',
        endpoints: [
          { baseURL: server1.url, model: 'm1', apiKey: 'sk-1', enabled: false },
          { baseURL: server2.url, model: 'm2', apiKey: 'sk-2', enabled: true },
        ],
      })

      const { path, workspace } = await tempPng()
      const res = await callDescribe(ctx, { image: path, prompt: 'Test disabled' }, workspace)
      expect(res.isError).toBe(false)
      expect(res.value).toMatchObject({
        text: 'Answer from server 2',
        model: 'm2',
      })
      expect(server1.requests).toHaveLength(0)
      expect(server2.requests).toHaveLength(1)
    })
  })

  describe('failover and automatic retry next on failure', () => {
    it('automatically fails over to second endpoint when first endpoint returns 429 rate limit', async () => {
      const server1 = await startMockServer((_req, res) => {
        jsonReply(res, 429, { error: { message: 'Rate limit exceeded' } })
      })
      cleanup.push(server1.close)

      const server2 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Failover success from server 2'))
      })
      cleanup.push(server2.close)

      const ctx = await mountPlugin({
        rotationMode: 'failover',
        retryNextOnFailure: true,
        endpoints: [
          { name: 'Primary-Limited', baseURL: server1.url, model: 'primary-v1', apiKey: 'sk-1' },
          { name: 'Backup-Available', baseURL: server2.url, model: 'backup-v2', apiKey: 'sk-2' },
        ],
      })

      const { path, workspace } = await tempPng()
      const res = await callDescribe(ctx, { image: path, prompt: 'Check failover' }, workspace)

      expect(res.isError).toBe(false)
      expect(res.value).toMatchObject({
        text: 'Failover success from server 2',
        model: 'backup-v2',
      })
      expect(server1.requests).toHaveLength(1)
      expect(server2.requests).toHaveLength(1)
    })

    it('rethrows immediately on failure if retryNextOnFailure is false', async () => {
      const server1 = await startMockServer((_req, res) => {
        jsonReply(res, 500, { error: 'Internal Server Error' })
      })
      cleanup.push(server1.close)

      const server2 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Should not be reached'))
      })
      cleanup.push(server2.close)

      const ctx = await mountPlugin({
        rotationMode: 'failover',
        retryNextOnFailure: false,
        endpoints: [
          { baseURL: server1.url, model: 'primary-v1', apiKey: 'sk-1' },
          { baseURL: server2.url, model: 'backup-v2', apiKey: 'sk-2' },
        ],
      })

      const { path, workspace } = await tempPng()
      const res = await callDescribe(ctx, { image: path, prompt: 'No retry' }, workspace)
      expect(res.isError).toBe(true)
      expect(errorText(res)).toContain('HTTP 500')
      expect(server2.requests).toHaveLength(0)
    })

    it('summarizes all endpoint failures when every endpoint fails', async () => {
      const server1 = await startMockServer((_req, res) => {
        jsonReply(res, 429, { error: 'quota exceeded' })
      })
      cleanup.push(server1.close)

      const server2 = await startMockServer((_req, res) => {
        jsonReply(res, 503, { error: 'service unavailable' })
      })
      cleanup.push(server2.close)

      const ctx = await mountPlugin({
        rotationMode: 'round-robin',
        retryNextOnFailure: true,
        endpoints: [
          { name: 'ModelA', baseURL: server1.url, model: 'v1', apiKey: 'sk-1' },
          { name: 'ModelB', baseURL: server2.url, model: 'v2', apiKey: 'sk-2' },
        ],
      })

      const { path, workspace } = await tempPng()
      const res = await callDescribe(ctx, { image: path, prompt: 'All fail' }, workspace)
      expect(res.isError).toBe(true)
      const text = errorText(res)
      expect(text).toMatch(/all 2 vision endpoints failed:[\s\S]*\[ModelA\] v1.*429[\s\S]*\[ModelB\] v2.*503/)
    })
  })

  describe('endpoint-specific API key authorization header', () => {
    it('sends the specific API key for each endpoint', async () => {
      const server1 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Key 1 ok'))
      })
      cleanup.push(server1.close)

      const server2 = await startMockServer((_req, res) => {
        jsonReply(res, 200, chatReply('Key 2 ok'))
      })
      cleanup.push(server2.close)

      const ctx = await mountPlugin({
        rotationMode: 'round-robin',
        endpoints: [
          { baseURL: server1.url, model: 'm1', apiKey: 'sk-zhipu-special' },
          { baseURL: server2.url, model: 'm2', apiKey: 'sk-qwen-special' },
        ],
      })

      const { path, workspace } = await tempPng()
      await callDescribe(ctx, { image: path, prompt: 'Key test 1' }, workspace)
      await callDescribe(ctx, { image: path, prompt: 'Key test 2' }, workspace)

      expect(server1.request(0).authorization).toBe('Bearer sk-zhipu-special')
      expect(server2.request(0).authorization).toBe('Bearer sk-qwen-special')
    })
  })
})
