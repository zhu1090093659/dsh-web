import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachmentPathsOf, mediaTypeOfSignature, oldestSeqOf } from '../src/core/attachment-paths.ts'
import { ATTACHMENT_WHITELIST_SESSIONS, DEEP_HISTORY_WINDOW } from '../src/core/connection.ts'
import { MAX_FRAME_BYTES } from '../src/core/envelope.ts'
import { answerOf, makeConnection, requestFrame, type ConnectionHarness } from './support/harness.ts'

/** The head a real PNG declares; every fixture starts with it. */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** One image file's bytes: a PNG head, then padding to the length a case needs. */
function png(bytes: number): Buffer {
  return Buffer.concat([PNG_HEAD, Buffer.alloc(Math.max(0, bytes - PNG_HEAD.length), 0x20)])
}

/** One durable record as `session/page` answers it. */
function record(type: string, seq: number, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time: 100 + seq, data } }
}

/** The offload envelope the harness writes beside an image it kept out of a message. */
function envelope(path: string, bytes: number): string {
  return `<path>${path}</path>\n<type>image</type>\n<content>\nimage/png image, 4x4 px, ${bytes} bytes\n</content>`
}

/** One user message carrying an offload placeholder for `path` and its image block. */
function offloadedMessage(path: string, seq: number, bytes: number): unknown {
  return record('user/message', seq, {
    role: 'user',
    id: `message-${seq}`,
    content: [
      { type: 'text', text: envelope(path, bytes) },
      { type: 'image', attachment: { attachmentId: 'sha256:0', mediaType: 'image/png', bytes, width: 4, height: 4, name: 'shot.png' } },
    ],
  })
}

/**
 * A durable session store that pages the way `session/page` does.
 *
 * Only what the bridge can observe is modelled: the inclusive `throughSeq` cut,
 * the exclusive `beforeSeq` cut, and a page bound counted in user and assistant
 * messages. `messagesPerRead` below the span a case hands over is what makes the
 * store end a page short, so the bridge's own walk backwards is exercised.
 */
function storeOf(records: readonly unknown[], cursor: number, messagesPerRead = 10_000) {
  const events = records.map(entry => (entry as { event: { type: string } }).event)
  return {
    cursor,
    page(args: Readonly<Record<string, unknown>>) {
      const throughSeq = args.throughSeq as number
      const beforeSeq = args.beforeSeq as number | undefined
      const end = Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1)
      let cut = 0
      let messages = 0
      for (let index = end - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event === undefined) continue
        if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
        messages += 1
        if (messages >= messagesPerRead) {
          cut = index
          break
        }
      }
      return { records: records.slice(cut, end), hasMore: cut > 0 }
    },
  }
}

/** A connection whose host serves one durable store, with an empty roster. */
function attachmentHarness(store: ReturnType<typeof storeOf>): ConnectionHarness {
  const harness = makeConnection({ paired: true })
  harness.gateway.handler = async call => {
    if (call.method === 'list') return { items: [] }
    if (call.method === 'projections') return { kind: 'sequenced', asOfSeq: store.cursor, values: {} }
    if (call.method === 'page') return store.page(call.args.request as Readonly<Record<string, unknown>>)
    return { accepted: true }
  }
  return harness
}

/** One `session.attachment.path` call, and the answer it was given. */

/** The session id one gateway call names, wherever the endpoint carries it. */
function sessionIdOfCall(args: Readonly<Record<string, unknown>>): string | undefined {
  const request = args.request
  if (typeof request !== 'object' || request === null) return undefined
  const record = request as Record<string, unknown>
  if (typeof record.sessionId === 'string') return record.sessionId
  const address = record.address
  if (typeof address !== 'object' || address === null) return undefined
  const named = (address as Record<string, unknown>).sessionId
  return typeof named === 'string' ? named : undefined
}

/** A connection whose host serves one durable store per session id. */
function multiSessionHarness(stores: ReadonlyMap<string, ReturnType<typeof storeOf>>): ConnectionHarness {
  const harness = makeConnection({ paired: true })
  harness.gateway.handler = async call => {
    if (call.method === 'list') return { items: [] }
    const named = sessionIdOfCall(call.args)
    const store = named === undefined ? undefined : stores.get(named)
    if (call.method === 'projections') return store === undefined ? null : { kind: 'sequenced', asOfSeq: store.cursor, values: {} }
    if (call.method === 'page') return store === undefined ? { records: [], hasMore: false } : store.page(call.args.request as Readonly<Record<string, unknown>>)
    return { accepted: true }
  }
  return harness
}
async function ask(harness: ConnectionHarness, id: number, payload: Record<string, unknown>) {
  await harness.connection.handleText(requestFrame(id, 'session.attachment.path', payload))
  return answerOf(harness, id)
}

describe('attachment path over protocol v1', () => {
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-attachment-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('serves the bytes of an image the session offloaded, under the path it named', async () => {
    // Given a session that offloaded one PNG, and the file still where it was
    const file = join(root, 'shot.png')
    await writeFile(file, png(64))
    const harness = attachmentHarness(storeOf([offloadedMessage(file, 1, 64)], 1))
    // When the paired client asks for that exact path
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then the bytes cross as base64, beside the reference the session's own record stated
    expect(answer.ok).toBe(true)
    const body = answer.r as { image: Record<string, unknown>; data: string }
    expect(body.image).toEqual({ path: file, mediaType: 'image/png', width: 4, height: 4, bytes: 64 })
    expect(Buffer.from(body.data, 'base64')).toEqual(png(64))
    // And the base64 carries no data: prefix
    expect(body.data.startsWith('data:')).toBe(false)
    // And the whitelist came from the store, at the session's own address
    expect(harness.gateway.countOf('session', 'page')).toBe(1)
    expect(harness.gateway.lastArgs('session', 'page')).toEqual({
      request: {
        address: { kind: 'session', sessionId: 's-1' },
        throughSeq: 1,
        ...DEEP_HISTORY_WINDOW,
      },
    })
  })

  it('serves a paired client that never declared the capability', async () => {
    // Given a connection that sent no hello at all, so it declared no capability
    const file = join(root, 'no-hello.png')
    await writeFile(file, png(16))
    const harness = attachmentHarness(storeOf([offloadedMessage(file, 1, 16)], 1))
    // When it asks for an image its session offloaded
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then it is served: the capability name announces the method, it never gates it
    expect(answer.ok).toBe(true)
  })

  it('serves a PNG whose name claims nothing, because the extension is never read', async () => {
    // Given a whitelisted file whose name says it is text
    const file = join(root, 'not-an-image.txt')
    await writeFile(file, png(32))
    const harness = attachmentHarness(storeOf([offloadedMessage(file, 1, 32)], 1))
    // When the client asks for it
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then its own bytes decide, and they are a PNG
    expect(answer.ok).toBe(true)
    expect(Buffer.from((answer.r as { data: string }).data, 'base64')).toEqual(png(32))
  })

  it('answers a second request under the same watermark without walking the store again', async () => {
    // Given one whitelisted image and a session whose watermark does not move
    const file = join(root, 'twice.png')
    await writeFile(file, png(16))
    const harness = attachmentHarness(storeOf([offloadedMessage(file, 1, 16)], 1))
    // When the same path is asked for twice, as a screen of tool cards would
    const first = await ask(harness, 1, { sessionId: 's-1', path: file })
    const second = await ask(harness, 2, { sessionId: 's-1', path: file })
    // Then both are served from one walk
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(harness.gateway.countOf('session', 'page')).toBe(1)
    // And the watermark is still read every time, because it is what proves the set current
    expect(harness.gateway.countOf('session', 'projections')).toBe(2)
  })

  it('recomputes once the watermark advances', async () => {
    // Given a session whose watermark moves forward between two requests
    const file = join(root, 'advanced.png')
    await writeFile(file, png(16))
    const records: unknown[] = [offloadedMessage(file, 1, 16)]
    const store = storeOf(records, 1)
    const harness = attachmentHarness(store)
    await ask(harness, 1, { sessionId: 's-1', path: file })
    // When the store commits one more event and the client asks again
    store.cursor = 2
    records.push(record('assistant/message', 2, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }))
    const answer = await ask(harness, 2, { sessionId: 's-1', path: file })
    // Then the whitelist was walked again rather than trusted
    expect(answer.ok).toBe(true)
    expect(harness.gateway.countOf('session', 'page')).toBe(2)
  })

  it('keeps at most the declared number of sessions, evicting the least recently used', async () => {
    // Given one more session than the bound, each with an image of its own
    const files: string[] = []
    const stores = new Map<string, ReturnType<typeof storeOf>>()
    for (let index = 0; index <= ATTACHMENT_WHITELIST_SESSIONS; index += 1) {
      const file = join(root, + 'many-' + index + '.png')
      await writeFile(file, png(16))
      files.push(file)
      stores.set('s-' + index, storeOf([offloadedMessage(file, 1, 16)], 1))
    }
    const harness = multiSessionHarness(stores)
    // When each session is asked for once
    for (let index = 0; index <= ATTACHMENT_WHITELIST_SESSIONS; index += 1) {
      const answer = await ask(harness, 10 + index, { sessionId: 's-' + index, path: files[index] })
      expect(answer.ok).toBe(true)
    }
    expect(harness.gateway.countOf('session', 'page')).toBe(ATTACHMENT_WHITELIST_SESSIONS + 1)
    // Then the first session fell out of the memo and is walked again
    await ask(harness, 30, { sessionId: 's-0', path: files[0] })
    expect(harness.gateway.countOf('session', 'page')).toBe(ATTACHMENT_WHITELIST_SESSIONS + 2)
    // And the newest one is still held, so asking it again costs no walk
    await ask(harness, 31, { sessionId: 's-' + ATTACHMENT_WHITELIST_SESSIONS, path: files[ATTACHMENT_WHITELIST_SESSIONS] })
    expect(harness.gateway.countOf('session', 'page')).toBe(ATTACHMENT_WHITELIST_SESSIONS + 2)
  })

  it('refuses a path this session never named, byte for byte', async () => {
    // Given a session that offloaded one image, and a second image beside it
    const named = join(root, 'named.png')
    const other = join(root, 'other.png')
    await writeFile(named, png(16))
    await writeFile(other, png(16))
    const harness = attachmentHarness(storeOf([offloadedMessage(named, 1, 16)], 1))
    // When the client asks for the file next to it
    const answer = await ask(harness, 1, { sessionId: 's-1', path: other })
    // Then no bytes cross, and the refusal names the whitelist rather than the file
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('path-not-in-session')
    expect(answer.r).toBeUndefined()
    // And one byte away from the named path is a different path
    const near = await ask(harness, 2, { sessionId: 's-1', path: named + ' ' })
    expect(near.e?.code).toBe('path-not-in-session')
  })

  it('refuses a whitelisted path that resolves somewhere else', async () => {
    // Given a session that named a path which is a symlink to an image elsewhere
    const target = join(root, 'target.png')
    const link = join(root, 'link.png')
    await writeFile(target, png(16))
    await symlink(target, link)
    const harness = attachmentHarness(storeOf([offloadedMessage(link, 1, 16)], 1))
    // When the client asks for the path the session named
    const answer = await ask(harness, 1, { sessionId: 's-1', path: link })
    // Then the symlink is not followed: that path no longer resolves to itself
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('path-not-in-session')
    expect(answer.e?.msg).toContain(target)
    expect(answer.r).toBeUndefined()
  })

  it('refuses a path that is not absolute before reading any store', async () => {
    // Given a session that offloaded one image
    const harness = attachmentHarness(storeOf([offloadedMessage(join(root, 'named.png'), 1, 16)], 1))
    // When the client names a relative path
    const answer = await ask(harness, 1, { sessionId: 's-1', path: 'shot.png' })
    // Then the request is refused as an argument, before any store call exists
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('invalid-args')
    expect(harness.gateway.countOf('session', 'projections')).toBe(0)
    expect(harness.gateway.countOf('session', 'page')).toBe(0)
  })

  it('refuses a request that names no session or no path', async () => {
    // Given a session that would answer a well-formed request
    const harness = attachmentHarness(storeOf([], 0))
    // When the request is missing a member, or names an empty path
    expect((await ask(harness, 1, { path: '/tmp/x.png' })).e?.code).toBe('invalid-args')
    expect((await ask(harness, 2, { sessionId: 's-1' })).e?.code).toBe('invalid-args')
    expect((await ask(harness, 3, { sessionId: 's-1', path: '' })).e?.code).toBe('invalid-args')
  })

  it('answers not-found when the whitelisted file is gone', async () => {
    // Given a whitelisted image that was deleted after the session offloaded it
    const file = join(root, 'gone.png')
    await writeFile(file, png(16))
    const harness = attachmentHarness(storeOf([offloadedMessage(file, 1, 16)], 1))
    await rm(file)
    // When the client asks for it
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then the answer says the file is not there, not that the session never named it
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('not-found')
  })

  it('answers not-found when the whitelisted path is not a regular file', async () => {
    // Given a whitelisted path a directory now stands at
    const directory = join(root, 'a-directory.png')
    await mkdir(directory)
    const harness = attachmentHarness(storeOf([offloadedMessage(directory, 1, 0)], 1))
    // When the client asks for it
    const answer = await ask(harness, 1, { sessionId: 's-1', path: directory })
    // Then it is refused: a directory is not the file the session named
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('not-found')
  })

  it('answers not-an-image when the bytes declare no image', async () => {
    // Given a whitelisted file whose name says PNG and whose bytes say text
    const file = join(root, 'text.png')
    await writeFile(file, 'this is not an image, whatever the name says')
    const harness = attachmentHarness(storeOf([offloadedMessage(file, 1, 44)], 1))
    // When the client asks for it
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then the magic decides, and it is none of the four
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('not-an-image')
  })

  it('answers frame-too-large when the encoded answer cannot cross one frame', async () => {
    // Given a whitelisted image whose base64 alone is past the 10 MiB frame
    const size = 9 * 1024 * 1024
    const file = join(root, 'huge.png')
    await writeFile(file, png(size))
    const harness = attachmentHarness(storeOf([offloadedMessage(file, 1, size)], 1))
    // When the client asks for it
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then the answer is a refusal rather than a truncated image
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('frame-too-large')
    expect(answer.e?.msg).toContain(String(MAX_FRAME_BYTES))
  })

  it('reads the image reference of a durable tool result, and only when it carries an image', async () => {
    // Given one tool result that published an image, and one that only named a path
    const image = join(root, 'read-image.png')
    const text = join(root, 'read-text.png')
    await writeFile(image, png(24))
    await writeFile(text, png(24))
    const harness = attachmentHarness(storeOf([
      record('tool/result', 1, {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          toolCallId: 'call_1',
          content: [
            { type: 'text', text: envelope(image, 24) },
            { type: 'image', attachment: { attachmentId: 'sha256:1', mediaType: 'image/png', bytes: 24, width: 4, height: 4 } },
          ],
        },
        meta: { path: image },
      }),
      record('tool/result', 2, {
        turn: 1,
        step: 2,
        message: { role: 'tool', toolCallId: 'call_2', content: [{ type: 'text', text: 'read 4 lines' }] },
        meta: { path: text },
      }),
    ], 2))
    // When the client asks for the image the first result published
    const served = await ask(harness, 1, { sessionId: 's-1', path: image })
    // Then it crosses as the reference alone: a tool result states a path and no facts
    expect(served.ok).toBe(true)
    expect((served.r as { image: unknown }).image).toEqual({ path: image })
    // And a path a tool merely named in its meta is not an image this session has
    const refused = await ask(harness, 2, { sessionId: 's-1', path: text })
    expect(refused.ok).toBe(false)
    expect(refused.e?.code).toBe('path-not-in-session')
  })

  it('never reads an assistant message as a whitelist source', async () => {
    // Given a session whose assistant message merely wrote a placeholder down
    const file = join(root, 'written-by-the-model.png')
    await writeFile(file, png(16))
    const harness = attachmentHarness(storeOf([
      record('assistant/message', 1, { role: 'assistant', content: [{ type: 'text', text: envelope(file, 16) }] }),
    ], 1))
    // When the client asks for the path that message wrote
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then it is not an image this session offloaded
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('path-not-in-session')
  })

  it('never whitelists a plugin-namespace name no file stands behind', async () => {
    // Given a session whose only image is the virtual name browser_screenshot writes
    const virtual = 'browser-view:screenshot/FEEC6A33B1C2D3E4.png'
    const harness = attachmentHarness(storeOf([
      record('user/message', 1, {
        content: [
          { type: 'text', text: envelope(virtual, 93031) },
          { type: 'image', attachment: { attachmentId: 'sha256:2', mediaType: 'image/png', bytes: 93031, width: 4, height: 4 } },
        ],
      }),
      record('tool/ptc-dispatch', 2, { name: 'browser_screenshot', content: [{ type: 'image', attachment: {} }], meta: { path: virtual } }),
    ], 2))
    // When the client asks for that name
    const answer = await ask(harness, 1, { sessionId: 's-1', path: virtual })
    // Then it is refused as an argument, before any store read: the request side takes absolute paths only
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('invalid-args')
    expect(harness.gateway.countOf('session', 'page')).toBe(0)
    // And no absolute path is served from that session either, because it named none
    const absolute = await ask(harness, 2, { sessionId: 's-1', path: '/tmp/browser-view.png' })
    expect(absolute.ok).toBe(false)
    expect(absolute.e?.code).toBe('path-not-in-session')
  })

  it('reaches an image the session offloaded on an older page of its store', async () => {
    // Given a long session whose only image sits below several pages of prose
    const file = join(root, 'old.png')
    await writeFile(file, png(16))
    const records: unknown[] = [offloadedMessage(file, 1, 16)]
    for (let index = 0; index < 12; index += 1) {
      records.push(record('user/message', 2 + index * 2, { role: 'user', content: [{ type: 'text', text: `ask ${index}` }] }))
      records.push(record('assistant/message', 3 + index * 2, { role: 'assistant', content: [{ type: 'text', text: `answer ${index}` }] }))
    }
    const harness = attachmentHarness(storeOf(records, 25, 2))
    // When the client asks for it
    const answer = await ask(harness, 1, { sessionId: 's-1', path: file })
    // Then the walk reached it, one page at a time
    expect(answer.ok).toBe(true)
    expect(harness.gateway.countOf('session', 'page')).toBeGreaterThan(1)
  })

  it('answers unknown-session for a session this host does not have', async () => {
    // Given a host whose projections read answers null, as it does for an id it lacks
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async call => {
      if (call.method === 'list') return { items: [] }
      if (call.method === 'projections') return null
      return { accepted: true }
    }
    // When the client names a session this host does not have
    const answer = await ask(harness, 1, { sessionId: 'missing', path: '/tmp/x.png' })
    // Then the harness's own not-found crosses as this method's own code
    expect(answer.ok).toBe(false)
    expect(answer.e?.code).toBe('unknown-session')
    expect(harness.gateway.countOf('session', 'page')).toBe(0)
  })
})

describe('the whitelist one durable transcript states', () => {
  it('reads the offload placeholder and the facts it states', () => {
    const found = attachmentPathsOf([offloadedMessage('/tmp/a.png', 1, 93031)])
    expect([...found.keys()]).toEqual(['/tmp/a.png'])
    expect(found.get('/tmp/a.png')).toEqual({ path: '/tmp/a.png', mediaType: 'image/png', width: 4, height: 4, bytes: 93031 })
  })

  it('states no fact the envelope did not state', () => {
    const found = attachmentPathsOf([
      record('user/message', 1, { content: [{ type: 'text', text: '<path>/tmp/b.png</path>\n<type>image</type>' }] }),
    ])
    expect(found.get('/tmp/b.png')).toEqual({ path: '/tmp/b.png' })
  })

  it('reads no path from a placeholder that is not an image envelope', () => {
    const found = attachmentPathsOf([
      record('user/message', 1, { content: [{ type: 'text', text: '<path>/tmp/c.txt</path>\n<type>file</type>\n<content>\nhi\n</content>' }] }),
    ])
    expect(found.size).toBe(0)
  })

  it('reads the image reference of a ptc-dispatched tool result', () => {
    const found = attachmentPathsOf([
      record('tool/ptc-dispatch', 1, { name: 'read_image', content: [{ type: 'image', attachment: {} }], meta: { path: '/tmp/d.png' } }),
    ])
    expect([...found.keys()]).toEqual(['/tmp/d.png'])
  })

  it('keeps no name that is not a host absolute path', () => {
    const found = attachmentPathsOf([
      record('user/message', 1, { content: [{ type: 'text', text: envelope('browser-view:screenshot/FEEC6A33.png', 8) }] }),
      record('tool/ptc-dispatch', 2, { name: 'browser_screenshot', content: [{ type: 'image', attachment: {} }], meta: { path: 'browser-view:screenshot/8C3A41D0.png' } }),
      record('user/message', 3, { content: [{ type: 'text', text: envelope('/tmp/kept.png', 8) }] }),
    ])
    expect([...found.keys()]).toEqual(['/tmp/kept.png'])
  })

  it('keeps the reading that states more when one path is seen twice', () => {
    const found = attachmentPathsOf([
      record('tool/result', 1, { message: { content: [{ type: 'image', attachment: {} }] }, meta: { path: '/tmp/e.png' } }),
      record('user/message', 2, { content: [{ type: 'text', text: envelope('/tmp/e.png', 8) }] }),
    ])
    expect(found.get('/tmp/e.png')).toEqual({ path: '/tmp/e.png', mediaType: 'image/png', width: 4, height: 4, bytes: 8 })
  })

  it('reads the oldest entry seq of one store page', () => {
    expect(oldestSeqOf([record('user/message', 7, {}), record('user/message', 3, {})])).toBe(3)
    expect(oldestSeqOf([])).toBeUndefined()
    expect(oldestSeqOf([{ type: 'event' }])).toBeUndefined()
  })
})

describe('the four image signatures', () => {
  it('names the format from the head alone', () => {
    expect(mediaTypeOfSignature(png(4))).toBe('image/png')
    expect(mediaTypeOfSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(mediaTypeOfSignature(Buffer.from('GIF87a....', 'ascii'))).toBe('image/gif')
    expect(mediaTypeOfSignature(Buffer.from('GIF89a....', 'ascii'))).toBe('image/gif')
    const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')])
    expect(mediaTypeOfSignature(webp)).toBe('image/webp')
  })

  it('names nothing for a head that is none of them', () => {
    expect(mediaTypeOfSignature(Buffer.from('not an image at all', 'utf8'))).toBeUndefined()
    expect(mediaTypeOfSignature(Buffer.from('RIFF....WAVE', 'ascii'))).toBeUndefined()
    expect(mediaTypeOfSignature(Buffer.alloc(0))).toBeUndefined()
  })
})
