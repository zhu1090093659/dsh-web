/**
 * How a card's attachments reach its execution: the image parts of the prompt,
 * the readable paths of its files, and the preflight that refuses a route
 * which cannot read an image at all.
 */
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { TaskAttachment } from '../src/core/attachment.ts'
import { HostExecutionRunner } from '../src/host-runner.ts'
import type { TaskBoardAttachmentStore } from '../src/host/attachments.ts'
import { TaskBoardAttachmentError } from '../src/host/attachments.ts'

type GatewayRequest = {
  namespace: string
  method: string
  args: Record<string, unknown>
}

const NOW = new Date(2026, 7, 16, 10, 0, 30).getTime()
const roots: string[] = []

/**
 * A readable file on this host: the execution only injects a path the agent
 * can actually open, so the fixture is a real file.
 */
function readableFile(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-attachment-'))
  roots.push(root)
  const path = join(root, name)
  writeFileSync(path, 'notes', 'utf8')
  return path
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    for (const entry of readdirSync(root)) unlinkSync(join(root, entry))
    rmdirSync(root)
  }
})

/** One prompt the runner queued, with its content parts. */
interface PromptCall {
  content: Array<Record<string, unknown>>
}

/**
 * An attachment storage whose objects are already known: one image and one
 * file. The file path is what the execution injects, so the fake can withhold
 * it to model a deployment that serves no host-file-backed objects.
 */
function fakeStore(options: { filePath?: string | undefined; maxImagesPerMessage?: number; maxMessageImageBytes?: number } = {}) {
  const imageBytes = new Uint8Array([1, 2, 3])
  const fileBytes = new Uint8Array([4, 5, 6])
  const store: TaskBoardAttachmentStore = {
    imageLimits: {
      maxImageBytes: 10 * 1024 * 1024,
      maxImagesPerMessage: options.maxImagesPerMessage ?? 8,
      maxMessageImageBytes: options.maxMessageImageBytes ?? 32 * 1024 * 1024,
      maxImagePixels: 4_000_000,
      maxImageDimension: 4096,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    async validateImage() {},
    async saveImage() {
      throw new Error('not used')
    },
    async readImage(ref) {
      return {
        ref: {
          attachmentId: ref.attachmentId,
          mediaType: 'image/png' as never,
          bytes: imageBytes.byteLength,
          width: 10,
          height: 10,
          name: 'shot.png',
        },
        data: imageBytes,
      }
    },
    async saveFileStream() {
      throw new Error('not used')
    },
    readFileStream() {
      return (async function* () { yield fileBytes })()
    },
    fileHostPath() {
      return options.filePath
    },
  }
  return { store, imageBytes, fileBytes }
}

/** The image attachment of the fake storage. */
function imageAttachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    kind: 'image',
    attachmentId: 'image-1',
    name: 'shot.png',
    bytes: 3,
    mediaType: 'image/png',
    sha256: 'a1'.repeat(32),
    width: 10,
    height: 10,
    ...overrides,
  }
}

/** The file attachment of the fake storage. */
function fileAttachment(): TaskAttachment {
  return {
    kind: 'file',
    attachmentId: 'file-1',
    name: 'notes.txt',
    bytes: 3,
    mediaType: 'text/plain',
    sha256: 'b2'.repeat(32),
  }
}

/** A card that carries the given attachments. */
function cardWith(attachments: TaskAttachment[], extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Run me', description: '', prompt: 'do the work' }, NOW, 'task-a'),
    workspaceId: 'workspace-a',
    ...(attachments.length === 0 ? {} : { attachments }),
    ...extra,
  }
}

/** A gateway that records the prompts the runner queues. */
function recordingGateway(options: { modelSelection?: { provider: string; model: string } } = {}) {
  const prompts: PromptCall[] = []
  const gateway = {
    invoke: vi.fn(async (request: GatewayRequest) => {
      if (request.namespace === 'agentPresets') return { presets: [] }
      if (request.method === 'create') return { sessionId: 'session-a' }
      if (request.method === 'rename') return { title: 'Run me', seq: 1 }
      if (request.method === 'selectModel') return { ok: true }
      if (request.method === 'projections') {
        return { values: { modelSelection: { lastUsed: options.modelSelection ?? null, next: null } } }
      }
      if (request.method === 'prompt') {
        const payload = request.args.request as { content: Array<Record<string, unknown>> }
        prompts.push({ content: payload.content })
        return { accepted: true }
      }
      if (request.method === 'list') return { items: [] }
      return {}
    }),
  }
  return { gateway, prompts }
}

/** The workspace registry the runner resolves a pinned workspace against. */
function workspaceRegistry() {
  return { list: vi.fn(() => [{ id: 'workspace-a' } as unknown as Workspace]) }
}

describe('the attachments of an execution', () => {
  it('operator running a card with an image sends the image after the text part', async () => {
    // Given a card carrying one image
    const { store, imageBytes } = fakeStore()
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
    })
    // When the card runs
    await runner.launch(cardWith([imageAttachment()]), {})
    // Then the prompt carries the text part first and the image part after it
    expect(prompts).toHaveLength(1)
    expect(prompts[0].content[0].type).toBe('text')
    expect(prompts[0].content[1].type).toBe('image')
    expect(prompts[0].content[1].mediaType).toBe('image/png')
    expect(prompts[0].content[1].data).toBe(Buffer.from(imageBytes).toString('base64'))
  })

  it('operator running a card with a file injects the readable path in a section of its own', async () => {
    // Given a card carrying one file
    const path = readableFile('notes.txt')
    const { store } = fakeStore({ filePath: path })
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
    })
    // When the card runs
    await runner.launch(cardWith([fileAttachment()]), {})
    // Then the prompt names the readable path in the attachment section
    const text = String(prompts[0].content[0].text)
    expect(text).toContain(path)
    expect(text).toContain('notes.txt')
    // And the section is not folded into the handover preamble
    expect(text).not.toContain('交接包引用')
  })

  it('operator running a card whose file has no readable path fails before the prompt', async () => {
    // Given a card carrying a file this deployment cannot hand out as a path
    const { store } = fakeStore({ filePath: undefined })
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
    })
    // When the card runs
    await expect(runner.launch(cardWith([fileAttachment()]), {})).rejects.toThrow('no readable path')
    // Then no prompt was queued and the attachment was not silently dropped
    expect(prompts).toHaveLength(0)
  })

  it('operator running a card with an image on a route that cannot read images is refused before the prompt', async () => {
    // Given a card carrying an image and a route that declares no image input
    const { store } = fakeStore()
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
      llm: () => async () => ({ inputModalities: ['text'] }),
    })
    // When the card runs
    await expect(runner.launch(cardWith([imageAttachment()], { model: 'test-provider/test-model' }), {}))
      .rejects.toThrow('does not accept image input')
    // Then no prompt was queued
    expect(prompts).toHaveLength(0)
  })

  it('operator running a card with an image on a route of unknown modality is allowed', async () => {
    // Given a card carrying an image and a route that declares no modalities
    const { store } = fakeStore()
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
      llm: () => async () => ({}),
    })
    // When the card runs
    await runner.launch(cardWith([imageAttachment()], { model: 'test-provider/test-model' }), {})
    // Then the image travelled with the prompt
    expect(prompts).toHaveLength(1)
    expect(prompts[0].content[1].type).toBe('image')
  })

  it('operator reusing a session checks the image capability against the route the session runs at', async () => {
    // Given a card carrying an image and a session that currently runs another route
    const { store } = fakeStore()
    const { gateway, prompts } = recordingGateway({ modelSelection: { provider: 'other-provider', model: 'other-model' } })
    const checked: string[] = []
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
      llm: () => async (provider: string, model: string) => {
        checked.push(`${provider}/${model}`)
        return { inputModalities: ['text'] }
      },
    })
    // When the card runs again in that session
    await expect(runner.launch(cardWith([imageAttachment()]), { reuseSessionId: 'session-a' }))
      .rejects.toThrow('does not accept image input')
    // Then the capability was judged for the session's own route
    expect(checked).toEqual(['other-provider/other-model'])
    expect(prompts).toHaveLength(0)
  })

  it('operator running a card twice resolves its attachments afresh for every run', async () => {
    // Given a card carrying one image and a storage that counts the reads
    const { store } = fakeStore()
    let reads = 0
    const counting: TaskBoardAttachmentStore = {
      ...store,
      async readImage(ref) {
        reads += 1
        return await store.readImage(ref)
      },
    }
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => counting,
    })
    // When the card runs twice
    await runner.launch(cardWith([imageAttachment()]), {})
    await runner.launch(cardWith([imageAttachment()]), { reuseSessionId: 'session-a' })
    // Then every run resolved the attachment from the storage again
    expect(reads).toBe(2)
    expect(prompts).toHaveLength(2)
    expect(prompts[1].content[1].type).toBe('image')
  })

  it('operator running a card whose images exceed the deployment message budget fails before the prompt', async () => {
    // Given a card carrying more images than the deployment admits per message
    const { store } = fakeStore({ maxImagesPerMessage: 2 })
    const images = Array.from({ length: 3 }, (_, index) =>
      imageAttachment({ attachmentId: `image-${index}` }))
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
    })
    // When the card runs
    await expect(runner.launch(cardWith(images), {})).rejects.toThrow('per message')
    // Then no prompt was queued: the card never reaches prompt admission
    expect(prompts).toHaveLength(0)
  })

  it('operator running a card whose image record carries no pixel size fails before the prompt', async () => {
    // Given a card whose image record lost its pixel size
    const { store } = fakeStore()
    const { width: _width, height: _height, ...withoutSize } = imageAttachment()
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => store,
    })
    // When the card runs
    await expect(runner.launch(cardWith([withoutSize as TaskAttachment]), {})).rejects.toThrow('image dimensions')
    // Then no prompt was queued
    expect(prompts).toHaveLength(0)
  })

  it('operator running a card whose attachment storage is gone fails before the prompt', async () => {
    // Given a card carrying an image and a deployment that serves no storage
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => undefined,
    })
    // When the card runs
    await expect(runner.launch(cardWith([imageAttachment()]), {})).rejects.toThrow('no attachment storage')
    // Then no prompt was queued
    expect(prompts).toHaveLength(0)
  })

  it('operator reading an attachment the storage refuses sees the refusal readably', async () => {
    // Given a storage that refuses to read the image back
    const { store } = fakeStore()
    const failing: TaskBoardAttachmentStore = {
      ...store,
      async readImage() {
        throw new TaskBoardAttachmentError('unreadable', 'the stored attachment could not be read back')
      },
    }
    const { gateway, prompts } = recordingGateway()
    const runner = new HostExecutionRunner(gateway, undefined, workspaceRegistry(), undefined, undefined, {
      attachments: () => failing,
    })
    // When the card runs
    await expect(runner.launch(cardWith([imageAttachment()]), {})).rejects.toThrow('could not be read back')
    // Then no prompt was queued
    expect(prompts).toHaveLength(0)
  })
})
