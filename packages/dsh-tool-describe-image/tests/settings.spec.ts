/** The settings-section wiring: the Plugins card's committed changes drive the next call. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'
import { chatReply, FakeWebServer, jsonReply, PNG_BYTES, startMockServer } from './mock-server.ts'
import type { MockServer } from './mock-server.ts'

/** A provider implementing only the three primitives, backed by an in-memory document. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const cleanup: Array<() => Promise<void>> = []

async function boot(doc: Record<string, unknown> = {}): Promise<{ ctx: Context; server: MockServer }> {
  const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
  cleanup.push(server.close)
  const ctx = new Context()
  await ctx.plugin(MemorySettings, { doc })
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, { baseURL: server.url, model: 'entry-model', apiKey: 'sk-entry' })
  return { ctx, server }
}

async function tempPng(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-image-settings-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pixel.png')
  await writeFile(path, PNG_BYTES)
  return path
}

function callDescribe(ctx: Context, image: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('settings-vision-call'),
    name: 'describe_image',
    arguments: { image },
  })
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
})

describe('describe-image settings section', () => {
  it('overlays the composition entry from the stored section', async () => {
    const { ctx, server } = await boot({ 'describe-image': { model: 'settings-model', maxOutputTokens: 7 } })
    const path = await tempPng()

    const result = await callDescribe(ctx, path)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ model: 'settings-model' })
    const body = server.request(0).body as { model?: unknown; max_tokens?: unknown }
    expect(body.model).toBe('settings-model')
    expect(body.max_tokens).toBe(7)
  })

  it('reaches the next call after a committed update, without re-registration', async () => {
    const { ctx, server } = await boot()
    const path = await tempPng()

    await ctx.settings.update(tool.DESCRIBE_IMAGE_SETTINGS_NAMESPACE, { model: 'live-model' })

    const result = await callDescribe(ctx, path)
    expect(result.isError).toBe(false)
    expect((server.request(0).body as { model?: unknown }).model).toBe('live-model')
  })

  it('an inline apiKey committed through the section drives the next call', async () => {
    const { ctx, server } = await boot({ 'describe-image': { apiKey: 'sk-settings' } })
    const path = await tempPng()

    await callDescribe(ctx, path)
    expect(server.request(0).authorization).toBe('Bearer sk-settings')
  })

  it('rejects an incoherent section at write time', async () => {
    const { ctx } = await boot()

    await expect(ctx.settings.update(tool.DESCRIBE_IMAGE_SETTINGS_NAMESPACE, { baseURL: 'ftp://example.com' }))
      .rejects.toThrow(/describe-image: baseURL must be an absolute http\(s\) URL/)
  })

  it('keeps the composition entry authoritative while the settings service is absent', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = new Context()
    await ctx.plugin(FakeWebServer)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, { baseURL: server.url, model: 'entry-only', apiKey: 'sk-entry' })
    const path = await tempPng()

    await callDescribe(ctx, path)
    expect((server.request(0).body as { model?: unknown }).model).toBe('entry-only')
  })
})
