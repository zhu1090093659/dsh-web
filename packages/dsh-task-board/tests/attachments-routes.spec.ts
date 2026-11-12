/**
 * The trusted attachment surface: the raw upload route, the image read route,
 * and the verification that runs before the ledger commits an attachment.
 */
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTaskBoardRoutes } from '../src/host-routes.ts'
import type { TaskBoardHostService } from '../src/host-service.ts'
import type { HostTaskLedger } from '../src/host-ledger.ts'
import {
  sha256Hex,
  TaskBoardAttachmentError,
  verifyAttachments,
  type TaskBoardAttachmentStore,
} from '../src/host/attachments.ts'
import type { TaskAttachment } from '../src/core/attachment.ts'
import type { TaskBoardSnapshot } from '../src/protocol.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 7,
  revision: 0,
  tasks: [],
  scheduler: { timeZone: 'UTC' },
  power: {
    platform: 'linux', phase: 'unsupported', enabled: false,
    runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
  },
}

/** One stored object of the fake attachment storage. */
interface StoredObject {
  bytes: Uint8Array
  mediaType: string
  width: number
  height: number
  name: string
}

/**
 * An in-memory attachment storage: it keeps the bytes it was given, computes
 * the reference the board records, and can be told to refuse an image.
 */
function fakeStore(options: { refuseImages?: boolean } = {}) {
  const objects = new Map<string, StoredObject>()
  const files = new Map<string, { bytes: Uint8Array; name: string }>()
  const store: TaskBoardAttachmentStore = {
    imageLimits: {
      maxImageBytes: 1024,
      maxImagesPerMessage: 8,
      maxMessageImageBytes: 8192,
      maxImagePixels: 4_000_000,
      maxImageDimension: 4096,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    async validateImage(input) {
      if (options.refuseImages === true) {
        throw new TaskBoardAttachmentError('unsupported-type', 'the attachment storage refuses images')
      }
      if (!input.mediaType.startsWith('image/')) {
        throw new TaskBoardAttachmentError('unsupported-type', 'not an image')
      }
    },
    async saveImage(input) {
      const attachmentId = `image-${objects.size + 1}`
      objects.set(attachmentId, {
        bytes: input.data,
        mediaType: input.mediaType,
        width: 10,
        height: 10,
        name: input.name ?? 'image',
      })
      return {
        attachmentId: attachmentId as never,
        mediaType: input.mediaType as never,
        bytes: input.data.byteLength,
        width: 10,
        height: 10,
        ...(input.name === undefined ? {} : { name: input.name }),
      }
    },
    async readImage(ref) {
      const stored = objects.get(String(ref.attachmentId))
      if (stored === undefined) throw Object.assign(new Error('the durable reference is unknown'), { code: 'ATTACHMENT_NOT_FOUND' })
      return {
        ref: {
          attachmentId: ref.attachmentId,
          mediaType: stored.mediaType as never,
          bytes: stored.bytes.byteLength,
          width: stored.width,
          height: stored.height,
          name: stored.name,
        },
        data: stored.bytes,
      }
    },
    async saveFileStream(input) {
      const chunks: Uint8Array[] = []
      for await (const chunk of input.data) chunks.push(chunk)
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const attachmentId = `file-${files.size + 1}`
      const name = input.name ?? 'file'
      files.set(attachmentId, { bytes, name })
      return { attachmentId: attachmentId as never, name, bytes: total }
    },
    readFileStream(ref) {
      const stored = files.get(String(ref.attachmentId))
      return (async function* () {
        if (stored === undefined) throw Object.assign(new Error('the durable reference is unknown'), { code: 'ATTACHMENT_NOT_FOUND' })
        yield stored.bytes
      })()
    },
    fileHostPath(ref) {
      return `/host/objects/${String(ref.attachmentId)}`
    },
  }
  return { store, objects, files }
}

describe('the attachment routes', () => {
  let server: Server
  let base: string
  let store: ReturnType<typeof fakeStore>
  let referenced: TaskAttachment[]
  let applyVerified: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    store = fakeStore()
    referenced = []
    applyVerified = vi.fn(async () => snapshot)
    const service = {
      snapshot: () => snapshot,
      apply: vi.fn(() => snapshot),
      applyVerified,
      ledger: { allTasks: () => [{ id: 'task-a', attachments: referenced }] },
      subscribe: () => () => undefined,
    } as unknown as TaskBoardHostService
    const routes = makeTaskBoardRoutes(service, {}, { attachments: () => store.store })
    server = createServer((req, res) => {
      const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    base = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) })
  })

  it('operator submitting an action reaches the verified attachment path', async () => {
    // Given an ordinary action on the board
    const response = await fetch(`${base}/api/task-board/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({
        requestId: 'request-a',
        action: { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } },
      }),
    })
    // When the route applies it
    // Then the verified path handled it, not the plain one
    expect(response.status).toBe(200)
    expect(applyVerified).toHaveBeenCalledOnce()
  })

  it('operator uploading an attachment without the browser marker is refused', async () => {
    // Given an upload request that carries no browser same-origin marker
    const response = await fetch(`${base}/api/task-board/attachments/upload?kind=file&name=a.txt`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'hello',
    })
    // When the route fence reads it
    // Then the request is refused and nothing is stored
    expect(response.status).toBe(403)
    expect(store.files.size).toBe(0)
  })

  it('operator uploading a file receives the host-computed metadata', async () => {
    // Given an upload request carrying the raw bytes of a file
    const response = await fetch(`${base}/api/task-board/attachments/upload?kind=file&name=notes.txt&mediaType=text/plain`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
      body: 'hello world',
    })
    // When the route stores it
    const body = await response.json() as { ok: boolean; attachment: TaskAttachment }
    // Then the answer carries the metadata the Host computed
    expect(response.status).toBe(200)
    expect(body.attachment.kind).toBe('file')
    expect(body.attachment.name).toBe('notes.txt')
    expect(body.attachment.bytes).toBe(11)
    expect(body.attachment.sha256).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    )
  })

  it('operator uploading an image receives the host-computed metadata', async () => {
    // Given an upload request for an image with a declared media type
    const response = await fetch(`${base}/api/task-board/attachments/upload?kind=image&name=shot.png&mediaType=image/png`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
      body: new Uint8Array([1, 2, 3]),
    })
    const body = await response.json() as { ok: boolean; attachment: TaskAttachment }
    // When the route stores it
    // Then the answer carries the metadata the Host computed for the image
    expect(response.status).toBe(200)
    expect(body.attachment.kind).toBe('image')
    expect(body.attachment.mediaType).toBe('image/png')
    expect(body.attachment.bytes).toBe(3)
    expect(body.attachment.width).toBe(10)
    expect(body.attachment.height).toBe(10)
  })

  it('operator uploading an image without a declared media type is refused', async () => {
    // Given an upload request for an image that declares no type
    const response = await fetch(`${base}/api/task-board/attachments/upload?kind=image&name=shot.png`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
      body: new Uint8Array([1, 2, 3]),
    })
    const body = await response.json() as { code: string }
    // When the route reads the request
    // Then the request is refused and nothing is stored
    expect(response.status).toBe(400)
    expect(body.code).toBe('invalid-request')
    expect(store.objects.size).toBe(0)
  })

  it('operator uploading an image past the deployment limit is refused', async () => {
    // Given an upload request that carries more image bytes than the
    // deployment's own image policy allows
    const response = await fetch(`${base}/api/task-board/attachments/upload?kind=image&name=big.png&mediaType=image/png`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
      body: new Uint8Array(2048),
    })
    // When the route measures the stream
    // Then the request is refused and nothing is stored
    expect(response.status).toBe(413)
    expect(store.objects.size).toBe(0)
  })

  it('operator uploading a file past the card limit is refused', async () => {
    // Given an upload request that carries more bytes than one attachment may hold
    const response = await fetch(`${base}/api/task-board/attachments/upload?kind=file&name=big.bin`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
      body: new Uint8Array(10 * 1024 * 1024 + 1),
    })
    // When the route measures the stream
    // Then the request is refused and nothing is stored
    expect(response.status).toBe(413)
    expect(store.files.size).toBe(0)
  })

  it('operator uploading an image the storage refuses is told why', async () => {
    // Given an upload request for an image the storage rejects
    const routes = makeTaskBoardRoutes(
      { snapshot: () => snapshot, apply: vi.fn(() => snapshot), applyVerified: vi.fn(async () => snapshot), ledger: { allTasks: () => [] }, subscribe: () => () => undefined } as unknown as TaskBoardHostService,
      {},
      { attachments: () => fakeStore({ refuseImages: true }).store },
    )
    const refusing = createServer((req, res) => {
      const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { refusing.listen(0, '127.0.0.1', resolve) })
    const address = refusing.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/task-board/attachments/upload?kind=image&name=shot.png&mediaType=image/png`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
        body: new Uint8Array([1, 2, 3]),
      })
      const body = await response.json() as { code: string }
      // When the route maps the refusal onto a status
      // Then the route answers with the storage's own refusal class
      expect(response.status).toBe(415)
      expect(body.code).toBe('unsupported-type')
    } finally {
      await new Promise<void>((resolve, reject) => { refusing.close(error => { if (error) reject(error); else resolve() }) })
    }
  })

  it('operator in a deployment without attachment storage sees a typed failure', async () => {
    // Given a board whose deployment serves no attachment storage
    const routes = makeTaskBoardRoutes(
      { snapshot: () => snapshot, apply: vi.fn(() => snapshot), applyVerified: vi.fn(async () => snapshot), ledger: { allTasks: () => [] }, subscribe: () => () => undefined } as unknown as TaskBoardHostService,
      {},
      {},
    )
    const bare = createServer((req, res) => {
      const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { bare.listen(0, '127.0.0.1', resolve) })
    const address = bare.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/task-board/attachments/upload?kind=file&name=a.txt`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
        body: 'hello',
      })
      const body = await response.json() as { code: string }
      // When the route answers the request
      // Then the route answers with a typed storage failure
      expect(response.status).toBe(503)
      expect(body.code).toBe('storage-unavailable')
    } finally {
      await new Promise<void>((resolve, reject) => { bare.close(error => { if (error) reject(error); else resolve() }) })
    }
  })

  it('operator uploading a file with a forged name receives the canonical name', async () => {
    // Given an upload request whose name carries a path and a newline
    const response = await fetch(`${base}/api/task-board/attachments/upload?kind=file&name=${encodeURIComponent('dir\\notes\n.txt')}&mediaType=text/plain`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin' },
      body: 'hello world',
    })
    const body = await response.json() as { attachment: TaskAttachment }
    // When the route stores it
    // Then the recorded name is the canonical leaf on one line
    expect(response.status).toBe(200)
    expect(body.attachment.name).toBe('notes .txt')
    expect(body.attachment.name).not.toContain('\\')
    expect(body.attachment.name).not.toContain('\n')
  })

  it('operator submitting an action whose storage is unavailable sees the storage failure class', async () => {
    // Given a board whose verified path reports the storage as unavailable
    const service = {
      snapshot: () => snapshot,
      apply: vi.fn(() => snapshot),
      applyVerified: vi.fn(async () => {
        throw new TaskBoardAttachmentError('storage-unavailable', 'the attachment storage is unavailable')
      }),
      ledger: { allTasks: () => [] },
      subscribe: () => () => undefined,
    } as unknown as TaskBoardHostService
    const failingRoutes = makeTaskBoardRoutes(service, {}, { attachments: () => store.store })
    const server2 = createServer((req, res) => {
      const route = failingRoutes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { server2.listen(0, '127.0.0.1', resolve) })
    const address = server2.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/task-board/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({
          requestId: 'request-a',
          action: { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } },
        }),
      })
      const body = await response.json() as { code: string }
      // When the route answers the refused action
      // Then the storage class survives: the answer is 503, not a flat 400
      expect(response.status).toBe(503)
      expect(body.code).toBe('storage-unavailable')
    } finally {
      await new Promise<void>((resolve, reject) => { server2.close(error => { if (error) reject(error); else resolve() }) })
    }
  })

  it('operator reading an image no card references is refused', async () => {
    // Given a stored image that no card of this board references
    const stored = await store.store.saveImage({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: 'shot.png' })
    // When the operator asks for it
    const response = await fetch(`${base}/api/task-board/attachments/image?id=${String(stored.attachmentId)}`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    // Then the route refuses to serve it
    expect(response.status).toBe(404)
  })

  it('operator reading an image a card references receives the stored bytes', async () => {
    // Given a stored image a card of this board references
    const stored = await store.store.saveImage({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: 'shot.png' })
    referenced.push({
      kind: 'image',
      attachmentId: String(stored.attachmentId),
      name: 'shot.png',
      bytes: 3,
      mediaType: 'image/png',
      sha256: 'a1'.repeat(32),
      width: 10,
      height: 10,
    })
    // When the operator asks for it
    const response = await fetch(`${base}/api/task-board/attachments/image?id=${String(stored.attachmentId)}`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    // Then the route serves the stored object with its media type
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Array.from(bytes)).toEqual([1, 2, 3])
  })
})

describe('the attachment verification', () => {
  it('operator attaching an object the storage does not hold is refused', async () => {
    // Given an attachment whose reference the storage does not know
    const { store } = fakeStore()
    const attachment: TaskAttachment = {
      kind: 'file',
      attachmentId: 'file-missing',
      name: 'notes.txt',
      bytes: 5,
      mediaType: 'text/plain',
      sha256: 'a1'.repeat(32),
    }
    // When the Host proves the claim against the storage
    // Then the claim is refused
    await expect(verifyAttachments(store, [attachment])).rejects.toThrow('not in the storage')
  })

  it('operator attaching an object whose digest does not match the stored bytes is refused', async () => {
    // Given a stored file whose recorded digest does not match its bytes
    const { store, files } = fakeStore()
    const stored = await store.saveFileStream({
      data: (async function* () { yield new Uint8Array([1, 2, 3]) })(),
      name: 'notes.txt',
    })
    const attachment: TaskAttachment = {
      kind: 'file',
      attachmentId: String(stored.attachmentId),
      name: 'notes.txt',
      bytes: 3,
      mediaType: 'text/plain',
      sha256: 'b2'.repeat(32),
    }
    // When the Host proves the claim against the storage
    // Then the claim is refused
    await expect(verifyAttachments(store, [attachment])).rejects.toThrow('does not match the stored object')
    expect(files.size).toBe(1)
  })

  it('operator renaming a stored image is refused', async () => {
    // Given a stored image and a record that claims another name for it
    const { store } = fakeStore()
    const stored = await store.saveImage({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: 'shot.png' })
    const attachment: TaskAttachment = {
      kind: 'image',
      attachmentId: String(stored.attachmentId),
      name: 'renamed.png',
      bytes: 3,
      mediaType: 'image/png',
      sha256: sha256Hex(new Uint8Array([1, 2, 3])),
      width: 10,
      height: 10,
    }
    // When the Host proves the claim against the storage
    // Then the claim is refused: the storage owns the display name
    await expect(verifyAttachments(store, [attachment])).rejects.toThrow('does not match the stored object')
  })

  it('operator attaching an object the storage proves is accepted', async () => {
    // Given a stored file and the metadata that describes it exactly
    const { store } = fakeStore()
    const stored = await store.saveFileStream({
      data: (async function* () { yield new Uint8Array([1, 2, 3]) })(),
      name: 'notes.txt',
    })
    const attachment: TaskAttachment = {
      kind: 'file',
      attachmentId: String(stored.attachmentId),
      name: 'notes.txt',
      bytes: 3,
      mediaType: 'text/plain',
      sha256: sha256Hex(new Uint8Array([1, 2, 3])),
    }
    // When the Host proves the claim against the storage
    // Then the claim passes
    await expect(verifyAttachments(store, [attachment])).resolves.toBeUndefined()
  })
})

describe('the host ledger face', () => {
  it('operator applying an action with attachments through the in-process face is refused', async () => {
    // Given a board whose in-process face is asked to commit an attachment
    const ledger = {
      applyRequest: vi.fn(() => ({ state: { revision: 1, tasks: [], scheduler: { timeZone: 'UTC' } } })),
      state: () => ({ revision: 1, tasks: [], scheduler: { timeZone: 'UTC' } }),
      allTasks: () => [],
      sessionDefaultPermission: 'read-only',
      maxSubtaskDepth: 1,
      nextArmedRunAt: () => undefined,
      armedScheduleCount: () => 0,
      dueSchedules: () => [],
      subscribe: () => () => undefined,
    } as unknown as HostTaskLedger
    const { TaskBoardHostService } = await import('../src/host-service.ts')
    const service = new TaskBoardHostService({ invoke: vi.fn() } as never, { ledger, attachments: () => fakeStore().store })
    // When the face is asked to commit it
    // Then the face refuses the action instead of committing an unverified claim
    expect(() => service.apply('request-a', {
      kind: 'create',
      id: 'task-a',
      input: {
        title: 'A',
        description: '',
        prompt: '',
        attachments: [{
          kind: 'file',
          attachmentId: 'file-1',
          name: 'notes.txt',
          bytes: 3,
          mediaType: 'text/plain',
          sha256: 'a1'.repeat(32),
        }],
      },
    })).toThrow('verified attachment action route')
    expect(ledger.applyRequest).not.toHaveBeenCalled()
  })

  it('operator applying an action without attachments through the in-process face still works', async () => {
    // Given a board whose in-process face is asked to create an ordinary card
    const ledger = {
      applyRequest: vi.fn(() => ({ state: { revision: 1, tasks: [], scheduler: { timeZone: 'UTC' } } })),
      state: () => ({ revision: 1, tasks: [], scheduler: { timeZone: 'UTC' } }),
      allTasks: () => [],
      sessionDefaultPermission: 'read-only',
      maxSubtaskDepth: 1,
      nextArmedRunAt: () => undefined,
      armedScheduleCount: () => 0,
      dueSchedules: () => [],
      subscribe: () => () => undefined,
    } as unknown as HostTaskLedger
    const { TaskBoardHostService } = await import('../src/host-service.ts')
    const service = new TaskBoardHostService({ invoke: vi.fn() } as never, { ledger, attachments: () => fakeStore().store })
    // When the face applies it
    // Then the card is committed as before
    service.apply('request-a', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    expect(ledger.applyRequest).toHaveBeenCalledOnce()
  })
})
